// server/modules/ledger/scheduler.js
// 记账本模块的每日定时任务：每天零点自动生成"前一天"的收支总结。
// 这是本项目第一个用到"定时任务"的模块，用最简单的方式实现——
// 不引入额外的cron依赖，用 setInterval 每分钟检查一次当前时间是否到点。

const { generateSummaryForDate } = require('./summary');

const CHECK_INTERVAL_MS = 60 * 1000; // 每分钟检查一次
let lastTriggeredDate = null;

function yesterdayStr(base) {
  const d = new Date(base);
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function todayStr(base) {
  return `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, '0')}-${String(base.getDate()).padStart(2, '0')}`;
}

async function checkAndTrigger() {
  const now = new Date();
  const todayKey = todayStr(now);

  // 每天0点~0点59分之间触发一次（避免依赖精确的0点0分那一刻），当天只触发一次
  if (now.getHours() === 0 && lastTriggeredDate !== todayKey) {
    lastTriggeredDate = todayKey;
    const target = yesterdayStr(now);
    try {
      await generateSummaryForDate(target);
      console.log(`[记账本] 已自动生成 ${target} 的收支总结`);
    } catch (err) {
      console.error(`[记账本] 自动生成 ${target} 总结失败:`, err.message);
    }
  }
}

function start() {
  setInterval(checkAndTrigger, CHECK_INTERVAL_MS);
}

module.exports = { start };
