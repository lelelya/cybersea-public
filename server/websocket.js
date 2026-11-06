// server/websocket.js
//
// WebSocket 服务：连接管理、心跳保活、通话信令 + 流式 AI 交互。
// 通过 server.on('upgrade') 挂载到现有 HTTP server，与 Express 共享端口。
//
// 导出：
//   initWebSocket(httpServer) — 初始化，传入 http.createServer 返回的 server
//   getWsClient(peerId)      — 获取指定客户端的 WS 连接，供其他模块推送消息

const { WebSocketServer } = require('ws');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const db = require('./db');
const memory = require('./memory');
const { chatCompletionStream } = require('./llmClient');

// ============================================================
// 连接管理
// ============================================================

/** @type {Map<string, { ws: WebSocket, lastPing: number }>} */
const clients = new Map();

/** 用户在线状态（用于主动消息推送决策） */
let userOnline = false;

function getUserOnline() {
  return userOnline;
}

/**
 * 向所有已认证客户端广播消息
 */
function broadcast(msg) {
  for (const [peerId, entry] of clients) {
    sendJson(entry.ws, msg);
  }
}

/** 每个连接当前活跃的 AI 请求（用于打断） */
/** @type {Map<WebSocket, { abort: AbortController, partialText: string }>} */
const activeRequests = new Map();

const HEARTBEAT_INTERVAL = 30000;  // 30s 发一次 ping
const HEARTBEAT_TIMEOUT = 60000;   // 60s 没收到 pong 就断开

let heartbeatTimer = null;

/**
 * 根据 peerId 获取客户端的 WebSocket 连接，不存在则返回 null。
 */
function getWsClient(peerId) {
  const entry = clients.get(peerId);
  return entry ? entry.ws : null;
}

// ============================================================
// 消息发送
// ============================================================

function sendJson(ws, msg) {
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify(msg));
  }
}

// ============================================================
// TTS（复用用户配置的语音服务）
// ============================================================

const tts = require('./routes/tts');
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');

async function synthesizeTTS(text) {
  try {
    if (!tts.isConfigured()) return null;
    const blob = await tts.generateAudio(text);
    const name = crypto.randomBytes(16).toString('hex') + '.wav';
    const filePath = path.join(UPLOAD_DIR, name);
    if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    fs.writeFileSync(filePath, Buffer.from(blob));
    return '/uploads/' + name;
  } catch (err) {
    console.error('[WS] TTS 合成失败:', err.message);
    return null;
  }
}

// ============================================================
// 通话消息处理
// ============================================================

/**
 * 处理 call_message：流式 AI 回复 + TTS，支持打断
 */
async function handleCallMessage(ws, text, meta = {}) {
  // 先中止当前连接的旧请求（如果有的话）
  const prev = activeRequests.get(ws);
  if (prev) {
    prev.abort.abort();
    // 旧请求的已输出部分仍会保存（在 finally 中处理）
  }

  // 创建新的 AbortController
  const abort = new AbortController();
  activeRequests.set(ws, { abort, partialText: '' });

  // 1. 取上下文
  const persona = db.prepare('SELECT * FROM persona WHERE id = 1').get();
  const memoryContext=require('./chat/contextBuilder').buildMemoryContext({persona,channel:'voice',query:text,fixedInput:JSON.stringify(persona.fixed_settings||[])});
  const context=memoryContext.recentMessages;
  const session=String(meta.session_id||require('node:crypto').randomUUID()).slice(0,128),turn=String(meta.turn_id||require('node:crypto').randomUUID()).slice(0,128);
  const sourceKey=`voice:${session}:${turn}`;

  // 2. 存用户消息（hidden）
  db.prepare(
    "INSERT OR IGNORE INTO messages (role, content, type, hidden, memory_origin,memory_source_key) VALUES (?, ?, ?, ?, 'voice',?)"
  ).run('user', text, 'text', 1,sourceKey+':user');

  // 3. 拼 system prompt
  const moduleRegistry = require('./moduleRegistry');
  const systemParts = [];
  systemParts.push(`你叫"${persona.ai_name}"，你正在和"${persona.user_name}"通电话。`);
  const aiDetails = [];
  if (persona.ai_gender) aiDetails.push(persona.ai_gender);
  if (persona.ai_age) aiDetails.push(`${persona.ai_age}岁`);
  if (persona.ai_height) aiDetails.push(persona.ai_height);
  if (persona.ai_appearance) aiDetails.push(persona.ai_appearance);
  if (aiDetails.length > 0) systemParts.push(`你的基本信息：${aiDetails.join('，')}`);
  systemParts.push('这是语音通话，请用口语化的方式自然回复，像在打电话一样。回复要简洁，不要长篇大论。');
  try { for(const value of JSON.parse(persona.fixed_settings||'[]'))systemParts.push(typeof value==='string'?value:value.value||value.key||''); } catch {}
  const moduleSnippets = moduleRegistry.getAllContextSnippets({exclude:['/api/memoryBank','/api/milestones']});
  if(memoryContext.snippet)moduleSnippets.push(memoryContext.snippet);
  if (moduleSnippets.length > 0) {
    systemParts.push('【背景信息】');
    systemParts.push(moduleSnippets.join('\n\n'));
  }

  const apiMessages = [
    { role: 'system', content: systemParts.join('\n') },
    ...context.map(require('./chat/contextBuilder').forModel),
    { role: 'user', content: text },
  ];

  // 4. 流式 AI 调用，带 AbortSignal
  const interrupted = Symbol('interrupted');
  let fullText = interrupted;
  try {
    // 通知前端 AI 开始回复
    sendJson(ws, { type: 'call_response_start' });

    fullText = await chatCompletionStream(apiMessages, null, (chunk) => {
      // 更新 partialText
      const entry = activeRequests.get(ws);
      if (entry) entry.partialText += chunk;
      sendJson(ws, { type: 'call_response_chunk', text: chunk });
    }, { signal: abort.signal });
  } catch (err) {
    console.error('[WS] AI 流式调用失败:', err.message);
    if (fullText === interrupted) {
      fullText = '（抱歉，信号不太好，请再说一次）';
      sendJson(ws, { type: 'call_response_chunk', text: fullText });
    }
  }

  // 检查是否被新请求打断
  const current = activeRequests.get(ws);
  const wasAborted = (fullText === interrupted);
  if (wasAborted) {
    // 被中断：保存已输出的部分内容
    fullText = (current && current.partialText) || '';
  }

  // 清理（仅当这个请求仍是活跃请求时）
  if (current && current.abort === abort) {
    activeRequests.delete(ws);
  }

  // 5. 存 AI 回复（hidden），空内容不存
  const isVoice = /^\[voice\]\s*/i.test(fullText);
  const cleanText = isVoice ? fullText.replace(/^\[voice\]\s*/i, '') : fullText;
  if (cleanText.trim()) {
    db.prepare(
      "INSERT OR IGNORE INTO messages (role, content, type, hidden, memory_origin,memory_source_key) VALUES (?, ?, ?, ?, 'voice',?)"
    ).run('ai', cleanText, 'text', 1,sourceKey+':ai');
    const service=require('./modules/memoryBank/service').getMemoryService(),s=service.settings();const pipelines=[...(s.events_auto_enabled?['events']:[]),...(s.profile_mode!=='off'?['profile']:[])];if(pipelines.length)service.enqueueMaintenance({pipelines,automatic:true});
  }

  // 6. TTS 合成（被中断且无内容时跳过）
  let audioUrl = '';
  if (cleanText.trim()) {
    audioUrl = await synthesizeTTS(cleanText) || '';
  }

  // 7. 推送最终结果（中断时标记 interrupted）
  sendJson(ws, {
    type: 'call_response_end',
    fullText: cleanText,
    audioUrl: audioUrl,
    interrupted: wasAborted,
  });
}

/**
 * 打断当前连接的活跃 AI 请求
 */
function interruptCall(ws) {
  const entry = activeRequests.get(ws);
  if (entry) {
    entry.abort.abort();
    // 不清除 activeRequests — handleCallMessage 的 finally 会清理
    console.log('[WS] 已打断活跃 AI 请求');
    return true;
  }
  return false;
}

// ============================================================
// WS 消息路由
// ============================================================

function handleMessage(ws, peerId, raw) {
  let msg;
  try {
    msg = JSON.parse(raw);
  } catch (_) {
    return;
  }
  if (!msg || !msg.type) return;

  switch (msg.type) {
    case 'auth': {
      // 认证：绑定 peerId
      const authId = msg.peerId || 'user';
      // 如果已有同 peerId 的连接，关掉旧连接
      const existing = clients.get(authId);
      if (existing && existing.ws !== ws) {
        try { existing.ws.close(4001, 'duplicate'); } catch (_) {}
      }
      clients.set(authId, { ws, lastPing: Date.now(), visible:false });
      userOnline = [...clients.values()].some(entry => entry.visible);
      // 更新本地 peerId 引用
      ws._peerId = authId;
      sendJson(ws, { type: 'auth_ok' });
      console.log('[WS] 客户端已认证:', authId);
      break;
    }

    case 'pong': {
      const entry = clients.get(peerId);
      if (entry?.ws === ws) entry.lastPing = Date.now();
      break;
    }

    case 'call_start': {
      sendJson(ws, { type: 'call_connected' });
      break;
    }

    case 'call_message': {
      const text = (msg.text || '').trim();
      if (!text) return;
      // 异步处理，不阻塞 WS 消息循环
      handleCallMessage(ws, text, msg).catch((err) => {
        console.error('[WS] call_message 处理异常:', err);
        sendJson(ws, { type: 'call_response_end', fullText: '（抱歉，出了点问题）', audioUrl: '', interrupted: false });
      });
      break;
    }

    case 'call_interrupt': {
      interruptCall(ws);
      break;
    }

    case 'call_end': {
      sendJson(ws, { type: 'call_ended', reason: 'user_hangup' });
      break;
    }

    case 'call_accept': {
      sendJson(ws, { type: 'call_connected' });
      break;
    }

    case 'call_reject': {
      sendJson(ws, { type: 'call_ended', reason: 'rejected' });
      break;
    }

    case 'visibility': {
      if (clients.get(peerId)?.ws === ws) {
        clients.get(peerId).visible = !!msg.visible;
        userOnline = [...clients.values()].some(entry => entry.visible);
      }
      break;
    }

    default:
      // 未知消息类型，忽略
      break;
  }
}

// ============================================================
// 初始化
// ============================================================

function initWebSocket(httpServer, authorizeUpgrade = () => false, options = {}) {
  const wss = new WebSocketServer({ noServer: true });

  // 处理 upgrade：只在 /ws 路径升级
  httpServer.on('upgrade', (request, socket, head) => {
    if (!authorizeUpgrade(request)) {
      socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      return;
    }
    if (request.url?.split('?')[0] === '/ws') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    } else {
      socket.destroy();
    }
  });

  wss.on('connection', (ws) => {
    // 临时 peerId，auth 后再更新
    ws._peerId = null;
    ws.on('pong', () => {
      const entry = clients.get(ws._peerId);
      if (entry?.ws === ws) entry.lastPing = Date.now();
    });

    ws.on('message', (raw) => {
      handleMessage(ws, ws._peerId, raw.toString());
    });

    ws.on('close', () => {
      const peerId = ws._peerId;
      if (peerId && clients.get(peerId)?.ws === ws) {
        clients.delete(peerId);
        userOnline = [...clients.values()].some(entry => entry.visible);
        console.log('[WS] 客户端断开:', peerId);
      }
    });

    ws.on('error', (err) => {
      console.error('[WS] 连接错误:', err.message);
    });
  });

  // 心跳定时器
  heartbeatTimer = setInterval(() => {
    const now = Date.now();
    for (const [peerId, entry] of clients) {
      if (now - entry.lastPing > (options.heartbeatTimeout ?? HEARTBEAT_TIMEOUT)) {
        console.log('[WS] 心跳超时，断开:', peerId);
        try { entry.ws.close(4002, 'heartbeat timeout'); } catch (_) {}
        clients.delete(peerId);
        userOnline = [...clients.values()].some(entry => entry.visible);
      } else {
        entry.ws.ping();
      }
    }
  }, options.heartbeatInterval ?? HEARTBEAT_INTERVAL);

  // Browsers answer protocol ping automatically; pong above refreshes liveness.

  console.log('[WS] WebSocket 服务已启动，路径: /ws');
  httpServer.once('close', () => {
    clearInterval(heartbeatTimer);
    for (const entry of clients.values()) entry.ws.terminate();
    clients.clear();
    userOnline = false;
    wss.close();
  });
  return wss;
}

module.exports = { initWebSocket, getWsClient, getUserOnline, broadcast };
