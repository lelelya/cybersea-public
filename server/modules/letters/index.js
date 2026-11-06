// server/modules/letters/index.js
// 信件模块入口。对外只暴露 { router, getContextSnippet }，供 moduleRegistry 统一接入。

const db = require('../../db');
const router = require('./routes');

/**
 * 返回当前信件概况，供 AI 感知未读来信和最近的信件往来。
 * 没有信件时返回 null。
 */
function getContextSnippet() {
  const persona = db.prepare('SELECT ai_name FROM persona WHERE id = 1').get();
  const aiName = persona.ai_name || 'AI';

  const unreadCount = db.prepare(
    "SELECT COUNT(*) as c FROM letters WHERE author = 'user' AND is_read = 0"
  ).get().c;

  const recentUserLetters = db.prepare(
    "SELECT id, title, created_at FROM letters WHERE author = 'user' ORDER BY created_at DESC LIMIT 3"
  ).all();

  const recentAiLetters = db.prepare(
    "SELECT id, title, created_at FROM letters WHERE author = 'ai' ORDER BY created_at DESC LIMIT 3"
  ).all();

  const parts = [];

  if (unreadCount > 0) {
    parts.push(`${aiName}有 ${unreadCount} 封未读的用户来信，记得用 reply_letter 回复。`);
  }

  if (recentUserLetters.length > 0) {
    parts.push('最近收到的用户来信：');
    recentUserLetters.forEach((l) => {
      parts.push(`  [ID:${l.id}] ${l.title || '(无标题)'} — ${l.created_at}`);
    });
  }

  if (recentAiLetters.length > 0) {
    parts.push(`最近${aiName}写过的信：`);
    recentAiLetters.forEach((l) => {
      parts.push(`  [ID:${l.id}] ${l.title || '(无标题)'} — ${l.created_at}`);
    });
  }

  if (parts.length === 0) return null;
  return `【信件】\n${parts.join('\n')}`;
}

module.exports = { router, getContextSnippet };
