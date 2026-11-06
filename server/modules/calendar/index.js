// server/modules/calendar/index.js
// 日历模块入口 — 日程 + 待办

const db = require('../../db');
const router = require('./routes');

/**
 * 返回今日日程和待办摘要，注入聊天 system prompt。
 */
function getContextSnippet() {
  const today = new Date();
  const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  const events = db.prepare('SELECT * FROM events WHERE date = ? ORDER BY start_time ASC').all(dateStr);
  const todos = db.prepare("SELECT * FROM todos WHERE completed = 0 AND (due_date = ? OR due_date IS NULL OR (start_date <= ? AND due_date >= ?)) ORDER BY due_date ASC").all(dateStr, dateStr, dateStr);

  if (!events.length && !todos.length) return null;

  const lines = [];
  if (events.length) {
    lines.push('【今日日程】');
    events.forEach(e => {
      const time = e.start_time ? (e.start_time + (e.end_time ? '~' + e.end_time : '')) : '全天';
      lines.push(`- ${time} ${e.title}${e.note ? '（' + e.note + '）' : ''}`);
    });
  }
  if (todos.length) {
    lines.push('【待办事项】');
    todos.forEach(t => lines.push(`- ${t.completed ? '✓' : '○'} ${t.title}`));
  }

  return lines.join('\n');
}

module.exports = { router, getContextSnippet };
