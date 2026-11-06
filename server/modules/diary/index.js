// server/modules/diary/index.js
// 日记模块入口。对外暴露 { router, getContextSnippet, startScheduler }。

const db = require('../../db');
const router = require('./routes');
const { chatCompletion } = require('../../llmClient');
const { fetchTodayWeather } = require('../weather/weatherClient');

/**
 * 返回最近7天日记摘要，注入聊天 system prompt。
 */
function getContextSnippet() {
  return null;
}

// ============================================================
// AI 日记自动生成定时器（每天 02:00）
// ============================================================
const CHECK_INTERVAL_MS = 60 * 1000;
let lastTriggeredDate = null;

function todayStr() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function yesterdayStr() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getDayOfWeek(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const days = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
  return days[d.getDay()];
}

async function generateAiDiary() {
  const targetDate = yesterdayStr();
  const dayOfWeek = getDayOfWeek(targetDate);

  console.log(`[diary scheduler] 开始为 ${targetDate} 生成AI日记...`);

  try {
    // 检查统计区间内是否有聊天记录
    // 统计范围：昨天 02:00 ~ 今天 02:00
    const today = todayStr();
    const startTime = `${targetDate} 02:00:00`;
    const endTime = `${today} 02:00:00`;

    const chatCount = db.prepare(
      "SELECT COUNT(*) as c FROM messages WHERE created_at >= ? AND created_at < ? AND role = 'user' AND hidden = 0"
    ).get(startTime, endTime);

    if (!chatCount || chatCount.c === 0) {
      console.log(`[diary scheduler] ${targetDate} 无聊天记录，跳过AI日记生成`);
      return;
    }

    // 获取聊天消息
    const messages = db.prepare(
      "SELECT role, content FROM messages WHERE created_at >= ? AND created_at < ? AND hidden = 0 ORDER BY id ASC"
    ).all(startTime, endTime);

    // 获取角色设定
    const persona = db.prepare('SELECT * FROM persona WHERE id = 1').get();

    // 获取天气
    let weatherText = '未知';
    try {
      const weatherConfig = db.prepare('SELECT * FROM weather_config WHERE id = 1').get();
      if (weatherConfig && weatherConfig.city) {
        const weather = await fetchTodayWeather(weatherConfig.city);
        weatherText = weather.text || weather.desc || '未知';
      }
    } catch (wErr) {
      console.log('[diary scheduler] 获取天气失败:', wErr.message);
    }

    // 构建聊天摘要
    const chatSummary = messages.map(m =>
      `${m.role === 'user' ? (persona.user_name || '对方') : (persona.ai_name || 'AI')}：${m.content}`
    ).join('\n');

    // 构建 system prompt
    const aiIdentity = [persona.ai_gender, persona.ai_age ? `${persona.ai_age}岁` : '', persona.ai_height, persona.ai_appearance].filter(Boolean).join('，');
    const systemPrompt =
      `你叫"${persona.ai_name}"。` +
      `${aiIdentity ? '你的基本信息：' + aiIdentity + '。' : ''}` +
      `请以第一人称「我」写一篇日记，记录${targetDate}（${dayOfWeek}）这一天。` +
      `要像真实的人写日记一样：有感受、有细节、有情绪，自然地提到当天和${persona.user_name || '对方'}的聊天内容。` +
      `第一行写上日期和天气：${targetDate} ${dayOfWeek} 天气：${weatherText}` +
      `\n\n只输出日记正文，不要加"日记："等多余的标题或说明。`;

    const userPrompt = `以下是${targetDate}的聊天记录：\n\n${chatSummary || '（无聊天记录）'}\n\n请写一篇属于你自己的日记。`;

    const diary = await chatCompletion([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ], null, { maxTokensOverride: 4096 });

    if (diary && diary.trim()) {
      const existing = db.prepare("SELECT id FROM diaries WHERE owner = 'ai' AND date = ?").get(targetDate);
      if (existing) {
        db.prepare("UPDATE diaries SET content = ?, weather = ?, updated_at = datetime('now', 'localtime') WHERE owner = 'ai' AND date = ?")
          .run(diary.trim(), weatherText, targetDate);
      } else {
        db.prepare("INSERT INTO diaries (owner, date, content, weather) VALUES ('ai', ?, ?, ?)")
          .run(targetDate, diary.trim(), weatherText);
      }
      console.log(`[diary scheduler] ${targetDate} AI日记已生成 (${diary.length} 字)`);
    }
  } catch (err) {
    console.error('[diary scheduler] AI日记生成失败:', err.message);
  }
}

function checkAndTrigger() {
  const now = new Date();
  const todayKey = todayStr();
  // 每天 02:00 触发一次
  if (now.getHours() === 2 && lastTriggeredDate !== todayKey) {
    lastTriggeredDate = todayKey;
    generateAiDiary().catch(err => {
      console.error('[diary scheduler] 定时任务异常:', err.message);
    });
  }
}

function startScheduler() {
  console.log('[diary scheduler] AI日记定时器已启动（每天02:00触发）');
  setInterval(checkAndTrigger, CHECK_INTERVAL_MS);
}

module.exports = { router, getContextSnippet, startScheduler };
