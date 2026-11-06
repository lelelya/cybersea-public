// server/modules/favorites/routes.js
// 收藏模块 API 路由

const express = require('express');
const db = require('../../db');

const router = express.Router();

// POST / — 收藏消息
router.post('/', (req, res) => {
  try {
    const { messageId, tag } = req.body || {};
    if (!messageId) {
      return res.status(400).json({ error: '缺少必填字段: messageId' });
    }

    // 读取原始消息
    const msg = db.prepare(
      'SELECT id, content, role, type, image_path, voice_path, transcript FROM messages WHERE id = ?'
    ).get(messageId);
    if (!msg) {
      return res.status(404).json({ error: '消息不存在' });
    }

    // 检查重复收藏
    const existing = db.prepare('SELECT id FROM favorites WHERE message_id = ?').get(messageId);
    if (existing) {
      return res.status(409).json({ error: '已收藏过该消息', existingId: existing.id });
    }

    const result = db.prepare(
      `INSERT INTO favorites (message_id, content, role, type, image_path, voice_path, transcript, tag)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      msg.id,
      msg.content || '',
      msg.role,
      msg.type || 'text',
      msg.image_path || '',
      msg.voice_path || '',
      msg.transcript || '',
      tag || null
    );

    const row = db.prepare('SELECT * FROM favorites WHERE id = ?').get(result.lastInsertRowid);
    res.json({ item: row });
  } catch (err) {
    console.error('[favorites] POST 失败:', err.message);
    res.status(500).json({ error: '收藏失败' });
  }
});

// GET / — 获取收藏列表（支持 ?tag=xxx 过滤）
router.get('/', (req, res) => {
  try {
    const { tag } = req.query;
    let rows;
    if (tag) {
      rows = db.prepare(
        'SELECT * FROM favorites WHERE tag = ? ORDER BY created_at DESC'
      ).all(tag);
    } else {
      rows = db.prepare('SELECT * FROM favorites ORDER BY created_at DESC').all();
    }
    res.json({ items: rows });
  } catch (err) {
    console.error('[favorites] GET 失败:', err.message);
    res.status(500).json({ error: '获取收藏列表失败' });
  }
});

// GET /tags — 获取所有已用标签（去重）
router.get('/tags', (req, res) => {
  try {
    const rows = db.prepare(
      "SELECT DISTINCT tag FROM favorites WHERE tag IS NOT NULL AND tag != '' ORDER BY tag ASC"
    ).all();
    res.json({ tags: rows.map(r => r.tag) });
  } catch (err) {
    console.error('[favorites] GET /tags 失败:', err.message);
    res.status(500).json({ error: '获取标签列表失败' });
  }
});

// DELETE /:id — 取消收藏
router.delete('/:id', (req, res) => {
  try {
    const { id } = req.params;
    const existing = db.prepare('SELECT * FROM favorites WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({ error: '收藏记录不存在' });
    }
    db.prepare('DELETE FROM favorites WHERE id = ?').run(id);
    res.json({ deleted: true });
  } catch (err) {
    console.error('[favorites] DELETE 失败:', err.message);
    res.status(500).json({ error: '取消收藏失败' });
  }
});

// PATCH /:id — 修改标签
router.patch('/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { tag } = req.body || {};

    const existing = db.prepare('SELECT * FROM favorites WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({ error: '收藏记录不存在' });
    }

    db.prepare('UPDATE favorites SET tag = ? WHERE id = ?').run(tag || null, id);
    const updated = db.prepare('SELECT * FROM favorites WHERE id = ?').get(id);
    res.json({ item: updated });
  } catch (err) {
    console.error('[favorites] PATCH 失败:', err.message);
    res.status(500).json({ error: '更新标签失败' });
  }
});

module.exports = router;
