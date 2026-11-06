// server/modules/annotations/routes.js
// 批画模块 API 路由

const express = require('express');
const db = require('../../db');

const router = express.Router();

// GET /api/annotations?source_type=&source_id= — 获取某页面的所有批画
router.get('/', (req, res) => {
  try {
    const { source_type, source_id } = req.query;
    if (!source_type || !['diary_user', 'diary_ai', 'story', 'book'].includes(source_type)) {
      return res.status(400).json({ error: '参数 source_type 无效' });
    }
    if (!source_id) {
      return res.status(400).json({ error: '缺少 source_id' });
    }

    const rows = db.prepare(
      'SELECT * FROM annotations WHERE source_type = ? AND source_id = ? ORDER BY created_at ASC'
    ).all(source_type, source_id);

    res.json({ annotations: rows });
  } catch (err) {
    console.error('[annotations] GET 失败:', err.message);
    res.status(500).json({ error: '获取批画失败' });
  }
});

// POST /api/annotations — 创建批画
router.post('/', (req, res) => {
  try {
    const { source_type, source_id, annotator, selected_text, mark_type, note } = req.body || {};

    if (!source_type || !['diary_user', 'diary_ai', 'story', 'book'].includes(source_type)) {
      return res.status(400).json({ error: '参数 source_type 无效' });
    }
    if (!source_id) {
      return res.status(400).json({ error: '缺少 source_id' });
    }
    if (!annotator || !['user', 'ai'].includes(annotator)) {
      return res.status(400).json({ error: '参数 annotator 必须为 user 或 ai' });
    }
    if (!selected_text || !selected_text.trim()) {
      return res.status(400).json({ error: 'selected_text 不能为空' });
    }
    if (!mark_type || !['circle', 'wavy', 'double_line', 'single_line'].includes(mark_type)) {
      return res.status(400).json({ error: '参数 mark_type 无效' });
    }

    const result = db.prepare(
      'INSERT INTO annotations (source_type, source_id, annotator, selected_text, mark_type, note) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(source_type, String(source_id), annotator, selected_text.trim(), mark_type, (note || '').trim());

    const row = db.prepare('SELECT * FROM annotations WHERE id = ?').get(result.lastInsertRowid);
    res.json({ annotation: row });
  } catch (err) {
    console.error('[annotations] POST 失败:', err.message);
    res.status(500).json({ error: '创建批画失败' });
  }
});

// DELETE /api/annotations/:id — 删除批画
router.delete('/:id', (req, res) => {
  try {
    const { id } = req.params;
    const existing = db.prepare('SELECT id FROM annotations WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({ error: '批画不存在' });
    }
    db.prepare('DELETE FROM annotations WHERE id = ?').run(id);
    res.json({ deleted: true });
  } catch (err) {
    console.error('[annotations] DELETE 失败:', err.message);
    res.status(500).json({ error: '删除批画失败' });
  }
});

module.exports = router;
