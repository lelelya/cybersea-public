// server/modules/weather/routes.js
// 天气+提醒模块路由：城市设置的读写、手动查询当天天气（调试用）。

const express = require('express');
const db = require('../../db');
const { fetchTodayWeather } = require('./weatherClient');
const { sendMorningReminder } = require('./scheduler');

const router = express.Router();

router.get('/config', (req, res) => {
  const config = db.prepare('SELECT * FROM weather_config WHERE id = 1').get();
  res.json(config);
});

router.put('/config', (req, res) => {
  const { city } = req.body || {};
  db.prepare('UPDATE weather_config SET city = COALESCE(@city, city) WHERE id = 1').run({
    city: city ?? null,
  });
  res.json(db.prepare('SELECT * FROM weather_config WHERE id = 1').get());
});

// 查看当天天气（供设置页测试城市是否填对，不产生聊天消息）
router.get('/today', async (req, res) => {
  try {
    const config = db.prepare('SELECT * FROM weather_config WHERE id = 1').get();
    const weather = await fetchTodayWeather(config.city);
    res.json({ city: config.city, weather });
  } catch (err) {
    res.status(500).json({ error: err.message || '天气查询失败' });
  }
});

// 手动触发一次"早安提醒"（正常情况下由定时任务在早上时段自动调用），方便测试
router.post('/trigger-reminder', async (req, res) => {
  try {
    await sendMorningReminder();
    res.json({ triggered: true });
  } catch (err) {
    res.status(500).json({ error: err.message || '触发失败' });
  }
});

module.exports = router;
