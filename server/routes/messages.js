// routes/messages.js
// 聊天记录的查询、导出、导入（导入接口本期只做占位/预留）

const express = require('express');
const db = require('../db');
const memoryService = () => require('../modules/memoryBank/service').getMemoryService();

const router = express.Router();

// 分页拉取消息，默认返回最近的一页；前端可传 before_id 向上翻页加载更早的消息
router.get('/', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 10000);
  const beforeId = req.query.before_id ? parseInt(req.query.before_id, 10) : null;

  let rows;
  if (beforeId) {
    rows = db
      .prepare(
        'SELECT id, role, content, type, duration, image_path, voice_path, transcript, created_at FROM messages WHERE id < ? AND hidden = 0 ORDER BY id DESC LIMIT ?'
      )
      .all(beforeId, limit);
  } else {
    rows = db
      .prepare(
        'SELECT id, role, content, type, duration, image_path, voice_path, transcript, created_at FROM messages WHERE hidden = 0 ORDER BY id DESC LIMIT ?'
      )
      .all(limit);
  }
  res.json({ messages: rows.reverse() });
});

// 搜索全部消息（服务端 SQL LIKE，不设条数上限）
router.get('/search', (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json({ messages: [] });

  const keyword = `%${q}%`;
  const rows = db
    .prepare(
      `SELECT id, role, COALESCE(NULLIF(content,''),NULLIF(transcript,''),memory_text,'') AS content, type, created_at FROM messages WHERE type IN ('text','voice','image','sticker') AND (content LIKE ? OR transcript LIKE ? OR memory_text LIKE ?) AND hidden = 0 ORDER BY id DESC`
    )
    .all(keyword, keyword, keyword);

  res.json({ messages: rows });
});

// 一键导出全部聊天记录为JSON
router.get('/export', (req, res) => {
  const rows = db
    .prepare('SELECT id, role, content, type, duration, image_path, voice_path, transcript, created_at FROM messages ORDER BY id ASC')
    .all();
  // 添加人类可读的格式化字段
  const formatted = rows.map((m) => {
    let display = m.content || '';
    if (m.type === 'voice') {
      display = `[语音] ${m.transcript || m.content || ''}`;
    } else if (m.type === 'image') {
      const pathLine = `[图片] ${m.image_path || ''}`;
      display = m.content ? `${pathLine}\n${m.content}` : pathLine;
    }
    return { ...m, display };
  });
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="chat_export_${Date.now()}.json"`
  );
  res.send(JSON.stringify({ messages: formatted }, null, 2));
});

// 预留的历史数据导入入口。v1.0 只做基础格式校验 + 批量写入 messages 表，
// 不对接 process_chat.py 生成的 events/profile 格式（那是另一套长期记忆方案，后续再对接）。
router.post('/import', (req, res) => {
  const { messages } = req.body || {};
  if (!Array.isArray(messages)) {
    return res.status(400).json({
      error: '导入格式错误：请提供 { messages: [{role, content, created_at?}, ...] }',
    });
  }

  const insert = db.prepare(
    "INSERT INTO messages (role, content, created_at, memory_origin) VALUES (@role, @content, COALESCE(@created_at, datetime('now', 'localtime')), 'import')"
  );
  let imported = 0;
  const insertMany = db.transaction((items) => {
    for (const item of items) {
      if (!item || (item.role !== 'user' && item.role !== 'ai') || typeof item.content !== 'string' || !item.content.trim()) {
        continue; // 跳过格式不对的条目
      }
      insert.run({
        role: item.role,
        content: String(item.content),
        created_at: item.created_at || null,
      });
      imported++;
    }
  });

  insertMany(messages);
  res.json({ imported, skipped:messages.length-imported });
});

// 编辑一条消息内容（你或AI的都可以编辑，比如AI回复有错别字想改一下）
router.put('/:id', (req, res) => {
  const { content } = req.body || {};
  if (!content || !content.trim()) {
    return res.status(400).json({ error: '消息内容不能为空' });
  }

  const existing = db.prepare('SELECT * FROM messages WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: '消息不存在' });

  db.transaction(() => {
    memoryService().invalidateSource(req.params.id, 'changed');
    db.prepare('UPDATE messages SET content=?,revision=revision+1,memory_text=NULL,transcript=CASE WHEN type=\'voice\' THEN ? ELSE transcript END WHERE id=?').run(content,content,req.params.id);
  })();
  res.json(db.prepare('SELECT id, role, content, type, duration, image_path, voice_path, transcript, created_at FROM messages WHERE id = ?').get(req.params.id));
});

// 删除一条消息
router.delete('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM messages WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: '消息不存在' });

  db.transaction(() => {
    memoryService().invalidateSource(req.params.id, 'deleted', {purge:req.query.memory==='purge',...req.body});
    db.prepare('DELETE FROM favorites WHERE message_id = ?').run(req.params.id);
    db.prepare('DELETE FROM messages WHERE id = ?').run(req.params.id);
  })();
  res.json({ deleted: true });
});

// 系统通知（hidden消息，不在聊天界面显示，AI可读）
router.post('/notify', (req, res) => {
  const { content } = req.body || {};
  if (!content || !content.trim()) {
    return res.status(400).json({ error: 'content 不能为空' });
  }
  const result = db.prepare(
    "INSERT INTO messages (role, content, type, hidden, memory_origin) VALUES ('ai', ?, 'text', 1, 'notification')"
  ).run(content.trim());
  res.json({ inserted: result.lastInsertRowid });
});

module.exports = router;
