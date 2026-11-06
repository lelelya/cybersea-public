// routes/chat.js
// 处理聊天消息：存用户消息 -> 通过memory模块取上下文 -> 拼system prompt ->
//   function calling 循环（AI可查询/写入各功能模块）-> 存AI回复 -> 返回
//
// 写入操作（发朋友圈、写日记、新建计划等）完成后自动在记忆库生成第一人称事件日志。

const express = require('express');
const db = require('../db');
const memory = require('../memory');
const { buildSystemPrompt } = require('../chat/systemPrompt');
const { runToolLoop } = require('../chat/toolLoop');
const moduleRegistry = require('../moduleRegistry');
const functionCalling = require('../modules/functionCalling');
const mcpClient = require('../mcpClient');
const visionClient = require('../visionClient');
const { buildMemoryContext, forModel } = require('../chat/contextBuilder');
const { getMemoryService } = require('../modules/memoryBank/service');

const router = express.Router();
const {decodeImage}=require('../utils/imageData');
const {removeUnusedUpload}=require('../utils/uploads');

router.post('/', async (req, res) => {
  const body = req.body || {};
  if(body.message!==undefined&&typeof body.message!=='string')return res.status(400).json({error:'消息必须是文字'});
  const userMessage = (body.message || '').trim();
  const msgType = body.type || 'text';
  const duration = body.duration || null;
  const imageData = body.image_data || null; // base64 图片数据
  const audioData = body.audio_data || null; // base64 音频数据（webm）
  const mcpServers = body.mcpServers || [];
  const hiddenMode = body.hidden_mode || false; // 通话中等场景：存为hidden消息（AI可读但UI不显示），跳过模块通知
  const homeMode = body.home_mode || false; // 回家模式：AI与用户共处一室
  const homeEnv = body.home_env || ''; // 回家模式下的环境描写
  const stickerPath = body.sticker_path || ''; // 表情包图片路径

  // 图片消息不需要文字内容，语音消息的 message 就是 transcript
  if (msgType === 'image') {
    if (!imageData && !userMessage) {
      return res.status(400).json({ error: '图片消息需要提供 image_data 或 message' });
    }
  } else if (msgType === 'sticker') {
    if (!userMessage) {
      return res.status(400).json({ error: '表情消息需要提供名称' });
    }
  } else if (!userMessage) {
    return res.status(400).json({ error: '消息内容不能为空' });
  }

  if (!['text', 'voice', 'image', 'sticker'].includes(msgType)) {
    return res.status(400).json({ error: '不支持的消息类型: ' + msgType });
  }

  let insertedUserId=null;
  const createdUploads=[];
  try {
    const decodedImage=imageData?decodeImage(imageData):null;
    // 1. 处理图片保存（base64 → uploads 目录）
    let imagePath = '';
    if (msgType === 'image' && imageData) {
      try {
        const crypto = require('crypto');
        const path = require('path');
        const fs = require('fs');
        const buf=decodedImage.bytes;
        const ext=decodedImage.extension;
        const name = crypto.randomBytes(16).toString('hex') + '.' + ext;
        const dir = path.join(__dirname, '..', '..', 'uploads');
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, name), buf);
        imagePath = '/uploads/' + name;
        createdUploads.push(imagePath);
      } catch (err) {
        console.error('[chat] 图片保存失败:', err.message);
      }
    }

    // 处理音频保存（base64 → uploads 目录）
    let voicePath = '';
    if (msgType === 'voice' && audioData) {
      try {
        const crypto = require('crypto');
        const path = require('path');
        const fs = require('fs');
        // 可靠提取 base64：data URL 格式为 data:...;base64,<数据>
        const commaIdx = audioData.indexOf(',');
        const rawBase64 = commaIdx >= 0 ? audioData.slice(commaIdx + 1) : audioData;
        const buf = Buffer.from(rawBase64, 'base64');
        // 验证解码后数据量合理（至少应该有几百字节的webm头）
        if (buf.length < 100) {
          throw new Error(`解码后数据异常小 (${buf.length} bytes)，可能base64已损坏`);
        }
        const name = crypto.randomBytes(16).toString('hex') + '.webm';
        const dir = path.join(__dirname, '..', '..', 'uploads');
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, name), buf);
        voicePath = '/uploads/' + name;
        createdUploads.push(voicePath);
      } catch (err) {
        console.error('[chat] 音频保存失败:', err.message);
      }
    }

    // 2. 取上下文 + 存用户消息（hidden_mode 时存为 hidden=1，AI可读但UI不显示）
    const persona = db.prepare('SELECT * FROM persona WHERE id = 1').get();
    const fixedPrompt = buildSystemPrompt(persona, homeMode, homeEnv);
    const memoryContext = buildMemoryContext({persona,channel:homeMode?'home':hiddenMode?'voice':'chat',query:userMessage,fixedInput:fixedPrompt,functions:functionCalling.getDefinitions(),outputReserve:db.prepare('SELECT max_tokens FROM settings WHERE id=1').get().max_tokens});
    const context = memoryContext.recentMessages;

    const insertUser = db.prepare(
      `INSERT INTO messages (role, content, type, duration, image_path, voice_path, transcript, hidden, memory_origin) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'chat')`
    );
    const transcript = msgType === 'voice' ? userMessage : ''; // voice的message就是transcript
    const userInsertResult = insertUser.run(
      'user',
      userMessage,
      msgType,
      duration,
      msgType === 'sticker' ? stickerPath : imagePath,
      voicePath,
      transcript,
      hiddenMode ? 1 : 0
    );

    insertedUserId=Number(userInsertResult.lastInsertRowid);
    // 3. 拼装 system prompt + 消息列表
    const systemPrompt = buildSystemPrompt(persona, homeMode, homeEnv, memoryContext);
    db.prepare('UPDATE messages SET memory_origin=? WHERE id=?').run(hiddenMode?'voice':'chat',userInsertResult.lastInsertRowid);

    let userApiContent = userMessage;
    // 图片消息：先识别内容，再告知AI
    if (msgType === 'image') {
      let desc = '';
      if (imageData) {
        try {
          desc = await visionClient.describeImage(imageData);
        } catch (_) { /* 识别失败不阻塞 */ }
      }
      if (desc) {
        db.prepare('UPDATE messages SET memory_text=? WHERE id=?').run(desc,userInsertResult.lastInsertRowid);
        userApiContent = `[用户发了一张图片，内容描述：${desc}]`;
      } else {
        userApiContent = userMessage
          ? `[用户发了一张图片，说明：${userMessage}]`
          : '[用户发了一张图片]';
      }
      if (imagePath) userApiContent += ` (图片路径: ${imagePath})`;
    }
    // 语音消息：告知AI这是语音转文字
    if (msgType === 'voice') {
      userApiContent = `[语音消息，时长${Math.round(duration || 0)}秒]: ${userMessage}`;
    }
    // 表情消息：告知AI这是表情贴图
    if (msgType === 'sticker') {
      userApiContent = `[用户发了一个表情贴图：${userMessage}]`;
      if (stickerPath) userApiContent += ` (图片路径: ${stickerPath})`;
    }

    const apiMessages = [
      { role: 'system', content: systemPrompt },
      ...context.map(forModel),
      { role: 'user', content: `[消息 ${userInsertResult.lastInsertRowid} v1]\n${userApiContent}` },
    ];

    // 3a. 连接 MCP 服务器并发现工具
    let mcpTools = [];
    if (mcpServers.length > 0) {
      try {
        const mcpConfig = db.prepare('SELECT global_enabled FROM mcp_config WHERE id = 1').get();
        if (mcpConfig && mcpConfig.global_enabled) {
          const result = await mcpClient.getConnectedTools(mcpServers);
          mcpTools = result.tools;
        }
      } catch (err) {
        console.warn('[chat] MCP tool discovery failed, continuing without MCP tools:', err.message);
      }
    }

    memoryContext.evidence.add(Number(userInsertResult.lastInsertRowid));
    const { aiReply, toolCalls, writeCalls, economyMessages, warnings } = await runToolLoop(apiMessages, mcpTools, {executionContext:{requestId:String(userInsertResult.lastInsertRowid),userMessageId:Number(userInsertResult.lastInsertRowid),evidence:memoryContext.evidence}});

    // 过滤静默工具
    const SILENT_TOOLS = new Set([
      'query_memory_events', 'query_memory_profile',
      'read_memory_detail', 'propose_profile_change',
      'initiate_call', 'start_call', 'end_call',
      'send_red_packet', 'send_gift', 'send_food_delivery',
    ]);
    const visibleToolCalls = toolCalls.filter(name => !SILENT_TOOLS.has(name));

    // 将可见通知存入 messages 表（始终存入，即使 hidden_mode）
    if (visibleToolCalls.length > 0) {
      const insertNotification = db.prepare(
        "INSERT INTO messages (role, content, type, hidden, memory_origin) VALUES ('system', ?, 'tool_notification', 0, 'chat')"
      );
      for (const name of visibleToolCalls) {
        insertNotification.run(name);
      }
    }

    // 4. 存 AI 回复（始终可见；hidden_mode 只隐藏用户消息）
    const aiIsVoice = /^\[voice\]\s*/i.test(aiReply);
    const aiCleanContent = aiIsVoice ? aiReply.replace(/^\[voice\]\s*/i, '') : aiReply;
    const aiInsertResult = db.prepare(
      `INSERT INTO messages (role, content, type, transcript, hidden, memory_origin) VALUES (?, ?, ?, ?, ?, 'chat')`
    ).run('ai', aiCleanContent, aiIsVoice ? 'voice' : 'text', aiIsVoice ? aiCleanContent : '', 0);

    // 5. 通知附加功能模块（hidden_mode 时跳过，避免触发自动总结/发动态等副作用）
    if (!hiddenMode) {
      moduleRegistry.notifyChatExchange(userMessage);
    } else {
      const s=getMemoryService().settings();const pipelines=[...(s.events_auto_enabled?['events']:[]),...(s.profile_mode!=='off'?['profile']:[])];if(pipelines.length)getMemoryService().enqueueMaintenance({pipelines,automatic:true});
    }

    // 6. 为写入操作生成记忆日志（异步，不阻塞响应）
    if (writeCalls.length > 0) {
      functionCalling.finalizeWrites(writeCalls).then((count) => {
        if (count > 0) console.log(`[FunctionCalling] 已为 ${count} 个写入操作生成记忆日志`);
      }).catch((err) => {
        console.error('[FunctionCalling] 记忆日志生成失败:', err.message);
      });
    }

    res.json({
      reply: aiReply,
      user_message_id: userInsertResult.lastInsertRowid,
      ai_message_id: aiInsertResult.lastInsertRowid,
      voice_path: voicePath || undefined,
      image_path: imagePath || undefined,
      sticker_path: stickerPath || undefined,
      tool_calls: visibleToolCalls,
      warnings,
      economy_messages: economyMessages,
    });
  } catch (err) {
    console.error(err);
    const hasActions=insertedUserId&&db.prepare('SELECT 1 FROM memory_actions WHERE message_id=? LIMIT 1').get(insertedUserId);
    if(insertedUserId&&!hasActions)db.prepare('DELETE FROM messages WHERE id=?').run(insertedUserId);
    if(!hasActions)for(const file of createdUploads)removeUnusedUpload(db,file);
    res.status(err.status||500).json({error:err.message||'服务器内部错误',code:err.code,user_message_id:hasActions?insertedUserId:undefined,partial_actions:!!hasActions});
  }
});

module.exports = router;
