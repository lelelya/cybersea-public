// server/modules/ledger/index.js
// 记账本模块入口。对外只暴露 { router, getContextSnippet, startScheduler }。
// startScheduler 是记账本独有的启动钩子（其他模块目前不需要），由 server/index.js 显式调用。

const db = require('../../db');
const router = require('./routes');
const scheduler = require('./scheduler');

/**
 * 返回最近几天的收支总结概况，供拼进system prompt。
 * 不包含日历/心情数据——记账本与日历完全独立，不做数据关联。
 * 没有任何总结记录时返回 null。
 */
function getContextSnippet() {
  return null;
}

module.exports = {
  router,
  getContextSnippet,
  startScheduler: scheduler.start,
};
