// server/modules/weather/index.js
// 天气+提醒模块入口。对外只暴露 { router, getContextSnippet, startScheduler }。

const db = require('../../db');
const router = require('./routes');
const scheduler = require('./scheduler');

/**
 * 返回当前设置的城市，供AI感知（比如聊天中提到天气/城市时能对上）。
 * 没有设置城市时返回 null。
 */
function getContextSnippet() {
  const config = db.prepare('SELECT * FROM weather_config WHERE id = 1').get();
  if (!config.city) return null;
  return `对方所在城市：${config.city}`;
}

module.exports = {
  router,
  getContextSnippet,
  startScheduler: scheduler.start,
};
