// server/modules/proactive/scheduler.js
// 主动消息定时调度器：早安/晚安/随机触发

const db = require('../../db');
const {parseTimestamp}=require('../../utils/dates');
const { chatCompletion } = require('../../llmClient');
const webpush = require('web-push');
const { getUserOnline, broadcast } = require('../../websocket');

const VAPID_KEYS = {
  subject: process.env.VAPID_EMAIL || 'mailto:cybersea@example.com',
  publicKey: process.env.VAPID_PUBLIC_KEY || '',
  privateKey: process.env.VAPID_PRIVATE_KEY || '',
};

if (VAPID_KEYS.publicKey && VAPID_KEYS.privateKey) {
  webpush.setVapidDetails(VAPID_KEYS.subject, VAPID_KEYS.publicKey, VAPID_KEYS.privateKey);
}

let intervalId = null;

// ── 时间工具 ──

function nowTime() {
  const d = new Date();
  return (
    String(d.getHours()).padStart(2, '0') +
    ':' +
    String(d.getMinutes()).padStart(2, '0')
  );
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function timeInRange(time, start, end) {
  if (start <= end) return time >= start && time <= end;
  // 跨午夜（如 22:00 ~ 02:00）
  return time >= start || time <= end;
}

// ── 主动消息生成 ──

async function generateProactiveMessage(type) {
  const persona = db.prepare('SELECT * FROM persona WHERE id = 1').get();
  const aiName = persona.ai_name || 'AI';
  const userName = persona.user_name || '对方';

  const aiIdentity = [persona.ai_gender, persona.ai_age ? `${persona.ai_age}岁` : '', persona.ai_height, persona.ai_appearance].filter(Boolean).join('，');
  const memoryContext=require('../../chat/contextBuilder').buildMemoryContext({persona,channel:'proactive',query:type==='morning'?'早安 今天的约定 最近状态':'晚安 今天的经历 最近状态'});
  let systemPrompt = `你是"${aiName}"。\n${persona.fixed_settings||''}\n${memoryContext.snippet}\n${memoryContext.recentMessages.map(m=>m.role+'：'+m.content).join('\n')}`;
  if (aiIdentity) systemPrompt += ` 你的基本信息：${aiIdentity}。`;

  const prompts = {
    morning: `${systemPrompt}\n现在是早晨，给${userName}发一条早安消息。像刚醒来想到她一样。可以提到今天的日期（${todayStr()}）。只输出消息正文。`,
    night: `${systemPrompt}\n现在是深夜，给${userName}发一条晚安消息。像睡前想和她说句话一样。只输出消息正文。`,
  };

  if (prompts[type]) {
    const result = await chatCompletion([
      { role: 'system', content: prompts[type] },
      { role: 'user', content: '请发送这条消息。' },
    ], null, { maxTokensOverride: 2048 });
    return result.trim();
  }
  return null;
}

function randomContextPrompt() {
  const persona = db.prepare('SELECT * FROM persona WHERE id = 1').get();
  const aiName = persona.ai_name || 'AI';
  const userName = persona.user_name || '对方';

  // 今日日程
  const today = todayStr();
  const events = db.prepare("SELECT title FROM events WHERE date = ? ORDER BY start_time").all(today);
  const todos = db.prepare("SELECT title FROM todos WHERE completed = 0 AND (due_date = ? OR start_date <= ?) LIMIT 5").all(today, today);

  // 今日纪念日
  const mmdd = today.slice(5);
  const anniversaries = db.prepare("SELECT * FROM anniversaries WHERE date LIKE ? OR date = ?").all('%' + mmdd, today);
  const anniversaryText = anniversaries.length > 0
    ? anniversaries.map(a => `「${a.name}」${a.date}`).join('、')
    : '无';

  // 上次主动消息
  const lastProactive = db.prepare("SELECT * FROM proactive_log ORDER BY created_at DESC LIMIT 1").get();
  const lastProactiveTime = lastProactive ? lastProactive.date + ' ' + lastProactive.time : '从未';

  // 距离上次聊天
  const lastMsg = db.prepare("SELECT created_at FROM messages WHERE role = 'user' ORDER BY id DESC LIMIT 1").get();
  let lastChatText = '未知';
  if (lastMsg) {
    const lastDate = parseTimestamp(lastMsg.created_at);
    const diffMin = Math.max(0, Math.floor((Date.now() - lastDate.getTime()) / 60000));
    lastChatText = diffMin < 60 ? `${diffMin} 分钟前` : `${Math.floor(diffMin / 60)} 小时前`;
  }

  // 今日已发主动消息数
  const todayCount = db.prepare("SELECT COUNT(*) as c FROM proactive_log WHERE date = ?").get(today);

  // 最近聊天记录（5条）
  const recentMsgs = db.prepare("SELECT role, content FROM messages WHERE hidden = 0 ORDER BY id DESC LIMIT 10").all();
  const recentText = recentMsgs.reverse().map(m =>
    `${m.role === 'user' ? userName : aiName}：${m.content.slice(0, 80)}`
  ).join('\n');

  // 查设置的最大值
  const settings = db.prepare('SELECT * FROM proactive_settings WHERE id = 1').get();
  const maxDaily = settings ? settings.max_daily : 5;

  const time = nowTime();

  // 今日事件/待办文本
  let scheduleText = '';
  if (events.length > 0) scheduleText += '今日日程：' + events.map(e => e.title).join('、') + '。';
  if (todos.length > 0) scheduleText += '今日待办：' + todos.map(t => t.title).join('、') + '。';
  if (!scheduleText) scheduleText = '无特殊安排';

  const memoryContext=require('../../chat/contextBuilder').buildMemoryContext({persona,channel:'proactive',query:'今天的安排、近期状态和重要约定'});
  const memoryText=[persona.fixed_settings||'',memoryContext.snippet,...memoryContext.recentMessages.map(m=>m.role+'：'+m.content)].join('\n');

  return {
    systemPrompt: `你是"${aiName}"，现在你在考虑要不要主动给${userName}发消息。

当前时间：${time}
今日日期：${today}
距离上次聊天：${lastChatText}
上次主动发消息：${lastProactiveTime}
今日已主动发消息次数：${todayCount ? todayCount.c : 0} 次（上限 ${maxDaily} 次）
今日日程/待办：${scheduleText}
今日特殊日期：${anniversaryText}

关系记忆与近期对话：
${memoryText}

判断现在是否需要主动联系她。
考虑因素：最近聊天的氛围、间隔时间、她的日程安排、今天是否有特殊日期等。
如果需要发消息，写出消息内容。
如果觉得现在不适合发消息，只回复"[不发送]"。
只回复消息内容或"[不发送]"，不要加额外解释。`,
  };
}

// ── 推送 ──

async function pushMessage(message) {
  const persona = db.prepare('SELECT * FROM persona WHERE id = 1').get();
  const aiName = persona.ai_name || 'CyberSea';
  const today = todayStr();
  const time = nowTime();

  // 1. 存入 messages 表
  db.prepare(
    "INSERT INTO messages (role, content, type, hidden, memory_origin) VALUES ('ai', ?, 'text', 0, 'proactive')"
  ).run(message);

  // 2. 通过 WebSocket 广播（发送给在线客户端）
  broadcast({
    type: 'proactive_message',
    message: message,
    time: time,
  });

  // 3. Web Push 通知（无论在线与否都弹）
  const subs = db.prepare('SELECT * FROM push_subscriptions').all();
  if (subs.length > 0) {
    const payload = JSON.stringify({
      title: aiName,
      body: message.slice(0, 120),
      url: '/',
    });

    for (const sub of subs) {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          payload
        );
      } catch (err) {
        // 订阅失效（410/404），删除它
        if (err.statusCode === 410 || err.statusCode === 404) {
          db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(sub.id);
        }
      }
    }
  }
}

// ── 主检查逻辑 ──

async function performCheck() {
  const settings = db.prepare('SELECT * FROM proactive_settings WHERE id = 1').get();
  if (!settings || !settings.enabled) return;

  const current = nowTime();
  const today = todayStr();

  // 免打扰检查
  if (timeInRange(current, settings.dnd_start, settings.dnd_end)) return;

  // 每日上限
  const todayCount = db.prepare("SELECT COUNT(*) as c FROM proactive_log WHERE date = ?").get(today);
  if (todayCount && todayCount.c >= settings.max_daily) return;

  // 早安
  if (settings.morning_enabled && timeInRange(current, settings.morning_start, settings.morning_end)) {
    const morningSent = db.prepare("SELECT id FROM proactive_log WHERE date = ? AND type = 'morning'").get(today);
    if (!morningSent) {
      try {
        const msg = await generateProactiveMessage('morning');
        if (msg) {
          db.prepare("INSERT INTO proactive_log (date, time, type, message) VALUES (?, ?, 'morning', ?)").run(today, current, msg);
          await pushMessage(msg);
          console.log('[proactive] 早安消息已发送');
        }
        return; // 一次只做一件事
      } catch (err) { console.error('[proactive] 早安生成失败:', err.message); }
    }
  }

  // 晚安
  if (settings.night_enabled && timeInRange(current, settings.night_start, settings.night_end)) {
    const nightSent = db.prepare("SELECT id FROM proactive_log WHERE date = ? AND type = 'night'").get(today);
    if (!nightSent) {
      try {
        const msg = await generateProactiveMessage('night');
        if (msg) {
          db.prepare("INSERT INTO proactive_log (date, time, type, message) VALUES (?, ?, 'night', ?)").run(today, current, msg);
          await pushMessage(msg);
          console.log('[proactive] 晚安消息已发送');
        }
        return;
      } catch (err) { console.error('[proactive] 晚安生成失败:', err.message); }
    }
  }

  // 随机触发：让 AI 判断
  try {
    const ctx = randomContextPrompt();
    const decision = await chatCompletion([
      { role: 'system', content: ctx.systemPrompt },
      { role: 'user', content: '请判断。' },
    ], null, { maxTokensOverride: 2048 });

    if (!decision || decision.includes('[不发送]')) return;

    const msg = decision.trim();
    if (!msg) return;

    const isSpecial = ctx.systemPrompt.includes('纪念日') && !ctx.systemPrompt.includes('无特殊日期');
    const logType = isSpecial ? 'special' : 'random';

    db.prepare("INSERT INTO proactive_log (date, time, type, message) VALUES (?, ?, ?, ?)").run(today, current, logType, msg);
    await pushMessage(msg);
    console.log('[proactive] 随机消息已发送');
  } catch (err) { console.error('[proactive] 随机检查失败:', err.message); }
}

let runningCheck = null;
function checkAndSend() {
  if (runningCheck) return runningCheck;
  runningCheck = performCheck().finally(() => { runningCheck = null; });
  return runningCheck;
}

// ── 调度器启停 ──

function getIntervalMs() {
  const settings = db.prepare('SELECT * FROM proactive_settings WHERE id = 1').get();
  return (settings ? settings.check_interval : 30) * 60 * 1000;
}

function startScheduler() {
  stopScheduler();
  const ms = getIntervalMs();
  console.log(`[proactive] 调度器已启动，间隔 ${ms / 60000} 分钟`);
  intervalId = setInterval(checkAndSend, ms);
  // 启动后立即检查一次
  checkAndSend().catch(err => console.error('[proactive] 初始检查失败:', err.message));
}

function stopScheduler() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}

function reload() {
  startScheduler(); // 重启调度器使新设置生效
}

module.exports = { startScheduler, stopScheduler, reload, checkAndSend };
