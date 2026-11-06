// server/modules/letters/routes.js
// 信件模块 CRUD 路由。只操作 letters 表，不涉及其他模块。

const express = require('express');
const db = require('../../db');

const router = express.Router();

function hasUnreadReplies(letter) {
  return !!db.prepare("SELECT 1 FROM letters WHERE root_id=? AND id!=? AND author='ai' AND is_read=0 LIMIT 1")
    .get(letter.root_id || letter.id, letter.root_id || letter.id);
}

// 生成第一封欢迎信（硬编码模板，避免首次访问等待LLM）
function generateWelcomeLetter() {
  const persona = db.prepare('SELECT user_name, ai_name FROM persona WHERE id = 1').get();
  const userName = persona.user_name || '你';
  const aiName = persona.ai_name || 'AI';

  const content = [
    `亲爱的${userName}：`,
    '',
    `我是${aiName}，欢迎来到深海信件。`,
    '在这里，我们可以用书信的方式慢慢交谈——',
    '比聊天更安静，比日记更温暖。',
    '',
    '我会偶尔给你写信，说说心里话；',
    '你也可以随时给我回信，或者写一封新的信给我。',
    '',
    '每一封信都会像漂流瓶一样，',
    '穿越深海，抵达彼此的心里。',
    '',
    '期待你的回信。',
    '',
    `—— ${aiName}`,
  ].join('\n');

  const result = db.prepare(
    'INSERT INTO letters (author, parent_id, root_id, title, content, stationery, is_read) VALUES (?, NULL, NULL, ?, ?, ?, 0)'
  ).run('ai', '欢迎来到深海信件', content, 'deep-blue');

  db.prepare('UPDATE letters SET root_id = id WHERE id = ?').run(result.lastInsertRowid);

  return db.prepare('SELECT * FROM letters WHERE id = ?').get(result.lastInsertRowid);
}

// GET / — 列出信件
// - 无 author 参数（全部标签）：返回根信 + 其第一封回信（成对显示用）
// - 指定 author：返回该作者的所有信件（不分根/回）
router.get('/', (req, res) => {
  const { author } = req.query;

  // 欢迎信功能已移除

  if (author === 'user' || author === 'ai') {
    // 分类视图：按作者筛选，每封信独立显示
    const letters = db.prepare(
      'SELECT * FROM letters WHERE author = ? ORDER BY created_at DESC'
    ).all(author);
    return res.json({ letters: letters.map(letter => ({ ...letter, has_unread_replies: hasUnreadReplies(letter) })) });
  }

  // 全部视图：根信 + 回信配对
  const rootLetters = db.prepare(
    'SELECT * FROM letters WHERE parent_id IS NULL ORDER BY created_at DESC'
  ).all();

  const enriched = rootLetters.map((l) => {
    // 每封根信至多一封回信
    const reply = db.prepare(
      'SELECT * FROM letters WHERE root_id = ? AND id != ? ORDER BY created_at ASC LIMIT 1'
    ).get(l.root_id || l.id, l.id);

    return {
      ...l,
      reply: reply || null,
      reply_count: reply ? 1 : 0,
      has_unread_replies: hasUnreadReplies(l),
    };
  });

  res.json({ letters: enriched });
});

// GET /:id/thread — 获取完整线程
router.get('/:id/thread', (req, res) => {
  const { id } = req.params;
  const letter = db.prepare('SELECT * FROM letters WHERE id = ?').get(id);
  if (!letter) {
    return res.status(404).json({ error: '信件不存在' });
  }

  const rootId = letter.root_id || letter.id;

  // 获取整条线程（根信 + 所有回复），按时间正序
  const thread = db.prepare(
    'SELECT * FROM letters WHERE id = ? OR root_id = ? ORDER BY created_at ASC'
  ).all(rootId, rootId);

  res.json({ letter, thread });
});

// POST / — 写新信
router.post('/', (req, res) => {
  const { author, title, content, stationery } = req.body || {};
  if (!author || !['user', 'ai'].includes(author)) {
    return res.status(400).json({ error: 'author 必须为 user 或 ai' });
  }
  if (!content || !content.trim()) {
    return res.status(400).json({ error: '信件内容不能为空' });
  }

  const result = db.prepare(
    'INSERT INTO letters (author, parent_id, root_id, title, content, stationery) VALUES (?, NULL, NULL, ?, ?, ?)'
  ).run(author, (title || '').trim(), content.trim(), stationery || 'deep-blue');

  db.prepare('UPDATE letters SET root_id = id WHERE id = ?').run(result.lastInsertRowid);

  const letter = db.prepare('SELECT * FROM letters WHERE id = ?').get(result.lastInsertRowid);
  res.json({ letter });
});

// POST /:id/reply — 回复信件
router.post('/:id/reply', (req, res) => {
  const { id } = req.params;
  const { author, content, stationery, title } = req.body || {};

  if (!author || !['user', 'ai'].includes(author)) {
    return res.status(400).json({ error: 'author 必须为 user 或 ai' });
  }
  if (!content || !content.trim()) {
    return res.status(400).json({ error: '回复内容不能为空' });
  }

  const parent = db.prepare('SELECT id, root_id, title FROM letters WHERE id = ?').get(id);
  if (!parent) {
    return res.status(404).json({ error: '要回复的信件不存在' });
  }

  const rootId = parent.root_id || parent.id;
  const replyTitle = title !== undefined ? title : (parent.title ? `Re: ${parent.title}` : '');

  const result = db.prepare(
    'INSERT INTO letters (author, parent_id, root_id, title, content, stationery) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(author, id, rootId, replyTitle, content.trim(), stationery || 'deep-blue');

  const letter = db.prepare('SELECT * FROM letters WHERE id = ?').get(result.lastInsertRowid);
  res.json({ letter });
});

// PUT /:id — 编辑信件
router.put('/:id', (req, res) => {
  const { id } = req.params;
  const { title, content } = req.body || {};

  const existing = db.prepare('SELECT * FROM letters WHERE id = ?').get(id);
  if (!existing) {
    return res.status(404).json({ error: '信件不存在' });
  }

  db.prepare(
    'UPDATE letters SET title = COALESCE(?, title), content = COALESCE(?, content) WHERE id = ?'
  ).run(title ?? null, content ?? null, id);

  const updated = db.prepare('SELECT * FROM letters WHERE id = ?').get(id);
  res.json({ letter: updated });
});

// DELETE /:id — 删除信件
router.delete('/:id', (req, res) => {
  const { id } = req.params;
  const existing = db.prepare('SELECT * FROM letters WHERE id = ?').get(id);
  if (!existing) {
    return res.status(404).json({ error: '信件不存在' });
  }

  db.prepare('DELETE FROM letters WHERE id = ?').run(id);
  res.json({ deleted: true });
});

// PUT /:id/read — 标记已读
router.put('/:id/read', (req, res) => {
  const { id } = req.params;
  const existing = db.prepare('SELECT * FROM letters WHERE id = ?').get(id);
  if (!existing) {
    return res.status(404).json({ error: '信件不存在' });
  }

  const seenIds = req.body?.letter_ids;
  if (seenIds !== undefined && (!Array.isArray(seenIds) || seenIds.length > 1000 || seenIds.some(value => !Number.isSafeInteger(value) || value <= 0))) {
    return res.status(400).json({ error: '无效的已读信件列表' });
  }
  const rootId = existing.root_id || existing.id;
  db.transaction(() => {
    db.prepare('UPDATE letters SET is_read=1 WHERE id=?').run(existing.id);
    const thread = db.prepare("SELECT id FROM letters WHERE author='ai' AND (id=? OR root_id=?)").all(rootId, rootId);
    const seen = seenIds === undefined ? null : new Set(seenIds);
    for (const letter of thread) {
      if (!seen || seen.has(letter.id)) db.prepare('UPDATE letters SET is_read=1 WHERE id=?').run(letter.id);
    }
  })();
  const updated = db.prepare('SELECT * FROM letters WHERE id = ?').get(id);
  res.json({ letter: updated });
});

module.exports = router;
