// server/modules/anniversary/index.js
// 纪念日模块入口。对外只暴露 { router, getContextSnippet }，供 moduleRegistry 统一接入。
// 本模块完全不 require 任何其他附加功能模块，也不知道 chat.js / memory.js 的存在。

const db = require('../../db');
const router = require('./routes');

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function daysSince(dateStr) {
  const start = new Date(dateStr + 'T00:00:00');
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.max(0, Math.floor((today - start) / MS_PER_DAY));
}

/**
 * 返回一段描述"当前所有纪念日"的文字，供拼进system prompt，
 * 让AI能在聊天中自然地感知/回应纪念日相关的话题。
 * 没有任何纪念日记录时返回 null（调用方应过滤掉）。
 */
function getContextSnippet() {
  const rows = db.prepare('SELECT name, date FROM anniversaries ORDER BY date ASC').all();
  if (rows.length === 0) return null;

  const lines = rows.map(
    (r) => `- ${r.name}：${r.date}（已经过去 ${daysSince(r.date)} 天）`
  );
  return `纪念日记录：\n${lines.join('\n')}`;
}

module.exports = { router, getContextSnippet };
