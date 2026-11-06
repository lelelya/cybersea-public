// routes/homeMode.js
// 回家模式：环境描写生成、模式切换消息存储、家设定读写

const express = require('express');
const db = require('../db');
const { chatCompletion } = require('../llmClient');

const router = express.Router();

function getTimeOfDay() {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 8) return '清晨';
  if (hour >= 8 && hour < 12) return '上午';
  if (hour >= 12 && hour < 14) return '午后';
  if (hour >= 14 && hour < 18) return '下午';
  if (hour >= 18 && hour < 21) return '傍晚';
  return '深夜';
}

// 进入回家模式：生成环境描写 + 存储分隔线消息
router.post('/enter', async (req, res) => {
  try {
    const persona = db.prepare('SELECT user_name, ai_name FROM persona WHERE id = 1').get();
    const config = db.prepare('SELECT home_description FROM app_config WHERE id = 1').get();
    const homeDesc = (config && config.home_description) || '';
    const userName = (persona && persona.user_name) || '我';
    const aiName = (persona && persona.ai_name) || 'AI';
    const timeOfDay = getTimeOfDay();

    // 生成环境描写
    let envPrompt;
    if (homeDesc) {
      envPrompt = `根据以下家的描述和当前时间，写一段简短的环境描写（2-3句话），像小说一样有画面感。不要提"环境描写"这个词，直接描写。当前是${timeOfDay}。

家的基本情况：${homeDesc}

环境描写：`;
    } else {
      envPrompt = `根据当前时间（${timeOfDay}），写一段简短的家的环境描写（2-3句话），一个温馨的深海主题小屋。像小说一样有画面感。不要提"环境描写"这个词，直接描写。

环境描写：`;
    }

    let envDesc = '';
    try {
      const result = await chatCompletion([
        { role: 'system', content: '你是一个擅长写环境描写的作家。用中文写作，简短精炼，2-3句话，有画面感。只输出描写，不要加任何前缀或引号。' },
        { role: 'user', content: envPrompt },
      ], [], { maxTokensOverride: 256 });
      envDesc = (result.content || '').trim();
    } catch (err) {
      console.error('[homeMode] 生成环境描写失败:', err.message);
      envDesc = homeDesc ? `家还是老样子。${homeDesc}` : '家还是老样子。';
    }

    // 存储 mode_switch 消息（回家）
    const switchContent = JSON.stringify({ action: 'home_enter', user_name: userName, ai_name: aiName });
    db.prepare(
      "INSERT INTO messages (role, content, type, hidden, memory_origin) VALUES ('system', ?, 'mode_switch', 0, 'notification')"
    ).run(switchContent);

    // 存储环境描写消息
    db.prepare(
      "INSERT INTO messages (role, content, type, hidden, memory_origin) VALUES ('system', ?, 'home_env', 0, 'notification')"
    ).run(envDesc);

    res.json({
      environment_description: envDesc,
      home_description: homeDesc,
      user_name: userName,
      ai_name: aiName,
    });
  } catch (err) {
    console.error('[homeMode] enter 失败:', err);
    res.status(500).json({ error: err.message });
  }
});

// 离开回家模式：存储分隔线消息
router.post('/leave', (req, res) => {
  try {
    const persona = db.prepare('SELECT user_name, ai_name FROM persona WHERE id = 1').get();
    const userName = (persona && persona.user_name) || '我';
    const aiName = (persona && persona.ai_name) || 'AI';

    const switchContent = JSON.stringify({ action: 'home_leave', user_name: userName, ai_name: aiName });
    const result = db.prepare(
      "INSERT INTO messages (role, content, type, hidden, memory_origin) VALUES ('system', ?, 'mode_switch', 0, 'notification')"
    ).run(switchContent);

    res.json({
      id: result.lastInsertRowid,
      user_name: userName,
      ai_name: aiName,
    });
  } catch (err) {
    console.error('[homeMode] leave 失败:', err);
    res.status(500).json({ error: err.message });
  }
});

// 读取家设定
router.get('/description', (req, res) => {
  const config = db.prepare('SELECT home_description FROM app_config WHERE id = 1').get();
  res.json({ home_description: (config && config.home_description) || '' });
});

// 更新家设定（用户编辑 或 AI 调用）
router.put('/description', (req, res) => {
  const { home_description } = req.body || {};
  db.prepare('UPDATE app_config SET home_description = ? WHERE id = 1').run(home_description ?? '');
  const updated = db.prepare('SELECT home_description FROM app_config WHERE id = 1').get();
  res.json(updated);
});

// 重新生成环境描写（家设定变更后）
router.post('/regenerate-env', async (req, res) => {
  try {
    const config = db.prepare('SELECT home_description FROM app_config WHERE id = 1').get();
    const homeDesc = (config && config.home_description) || '';
    const timeOfDay = getTimeOfDay();

    let envPrompt;
    if (homeDesc) {
      envPrompt = `根据以下家的描述和当前时间，写一段简短的环境描写（2-3句话），像小说一样有画面感。不要提"环境描写"这个词，直接描写。当前是${timeOfDay}。

家的基本情况：${homeDesc}

环境描写：`;
    } else {
      envPrompt = `根据当前时间（${timeOfDay}），写一段简短的家的环境描写（2-3句话），一个温馨的深海主题小屋。像小说一样有画面感。不要提"环境描写"这个词，直接描写。

环境描写：`;
    }

    let envDesc = '';
    try {
      const result = await chatCompletion([
        { role: 'system', content: '你是一个擅长写环境描写的作家。用中文写作，简短精炼，2-3句话，有画面感。只输出描写，不要加任何前缀或引号。' },
        { role: 'user', content: envPrompt },
      ], [], { maxTokensOverride: 256 });
      envDesc = (result.content || '').trim();
    } catch (err) {
      console.error('[homeMode] 重新生成环境描写失败:', err.message);
      envDesc = homeDesc ? `家还是老样子。${homeDesc}` : '家还是老样子。';
    }

    // 存储新的环境描写消息
    db.prepare(
      "INSERT INTO messages (role, content, type, hidden, memory_origin) VALUES ('system', ?, 'home_env', 0, 'notification')"
    ).run(envDesc);

    res.json({ environment_description: envDesc });
  } catch (err) {
    console.error('[homeMode] regenerate-env 失败:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
