// server/modules/plan/index.js
// 专属计划模块入口。对外只暴露 { router, getContextSnippet }。

const db = require('../../db');
const router = require('./routes');

const CATEGORY_LABELS = { mine: '我的计划', his: '他的计划', shared: '共同计划' };

function isDone(plan) {
  if (plan.category === 'shared') return !!(plan.user_checked && plan.ai_checked);
  if (plan.category === 'mine') return !!plan.user_checked;
  if (plan.category === 'his') return !!plan.ai_checked;
  return false;
}

/**
 * 返回三类计划的进行中/已完成概况，供AI在聊天中自然提及。
 * 没有任何计划时返回 null。
 */
function getContextSnippet() {
  return null;
}

module.exports = { router, getContextSnippet };
