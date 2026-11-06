// server/modules/weather/scheduler.js
// 每天早上时段（不需要精确到分钟）自动触发一次：查天气 -> 让AI结合天气自由发挥写一句关心/提醒 ->
// 作为一条AI消息插入聊天记录（messages表是核心聊天数据，所有模块共用同一份存储，
// 这里只是"写入一条消息"，不依赖chat.js的任何内部实现）。

const db = require('../../db');
const { chatCompletion } = require('../../llmClient');
const { fetchTodayWeather } = require('./weatherClient');

const CHECK_INTERVAL_MS = 60 * 1000;
const MORNING_HOUR = 8; // "早上时段"，不需要精确到分钟，8点这个小时内触发一次
let lastTriggeredDate = null;

function todayStr(base) {
  return `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, '0')}-${String(base.getDate()).padStart(2, '0')}`;
}

async function sendMorningReminder() {
  const config = db.prepare('SELECT * FROM weather_config WHERE id = 1').get();
  if (!config.city) {
    console.log('[天气提醒] 尚未设置城市，跳过今天的提醒');
    return;
  }

  const weather = await fetchTodayWeather(config.city);
  const persona = db.prepare('SELECT * FROM persona WHERE id = 1').get();

  const aiIdentity = [persona.ai_gender, persona.ai_age ? `${persona.ai_age}岁` : '', persona.ai_height, persona.ai_appearance].filter(Boolean).join('，');
  const systemPrompt =
    `你叫"${persona.ai_name}"。${aiIdentity ? '你的基本信息：' + aiIdentity + '。' : ''}` +
    `请结合今天${config.city}的天气情况，主动跟"${persona.user_name}"说一句早安问候，` +
    '自然地表达关心或提醒（比如穿衣、带伞等），措辞自由发挥，符合你的人设，不要生硬地照抄天气数据。只输出这句话本身。';

  const message = await chatCompletion([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `今天${config.city}的天气：${weather.text}` },
  ]);

  db.prepare(`INSERT INTO messages (role, content, memory_origin) VALUES (?, ?, 'notification')`).run('ai', message);
  console.log(`[天气提醒] 已发送今日问候: ${message}`);
}

async function checkAndTrigger() {
  const now = new Date();
  const todayKey = todayStr(now);

  if (now.getHours() === MORNING_HOUR && lastTriggeredDate !== todayKey) {
    lastTriggeredDate = todayKey;
    try {
      await sendMorningReminder();
    } catch (err) {
      console.error('[天气提醒] 发送失败:', err.message);
    }
  }
}

function start() {
  setInterval(checkAndTrigger, CHECK_INTERVAL_MS);
}

module.exports = { start, sendMorningReminder };
