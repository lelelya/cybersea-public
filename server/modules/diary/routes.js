// server/modules/diary/routes.js
// 日记模块 API 路由

const express = require('express');
const db = require('../../db');

const router = express.Router();

// GET /api/diary?owner=user|ai&date=YYYY-MM-DD — 获取某天日记
router.get('/', (req, res) => {
  try {
    const { owner, date } = req.query;
    if (!owner || !['user', 'ai'].includes(owner)) {
      return res.status(400).json({ error: '参数 owner 必须为 user 或 ai' });
    }
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: '参数 date 格式必须为 YYYY-MM-DD' });
    }
    const row = db.prepare('SELECT * FROM diaries WHERE owner = ? AND date = ?').get(owner, date);
    res.json({ diary: row || null });
  } catch (err) {
    console.error('[diary] GET 失败:', err.message);
    res.status(500).json({ error: '获取日记失败' });
  }
});

// POST /api/diary — 创建/更新日记 { owner, date, content }
router.post('/', (req, res) => {
  try {
    const { owner, date, content } = req.body || {};
    if (!owner || !['user', 'ai'].includes(owner)) {
      return res.status(400).json({ error: '参数 owner 必须为 user 或 ai' });
    }
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: '参数 date 格式必须为 YYYY-MM-DD' });
    }
    if (content === undefined || content === null) {
      return res.status(400).json({ error: '缺少 content' });
    }

    // AI日记不可被用户编辑
    if (owner === 'ai') {
      return res.status(403).json({ error: 'AI日记不可手动编辑' });
    }

    const existing = db.prepare('SELECT id FROM diaries WHERE owner = ? AND date = ?').get(owner, date);
    if (existing) {
      db.prepare("UPDATE diaries SET content = ?, updated_at = datetime('now', 'localtime') WHERE owner = ? AND date = ?")
        .run(content, owner, date);
    } else {
      db.prepare('INSERT INTO diaries (owner, date, content) VALUES (?, ?, ?)')
        .run(owner, date, content);
    }

    const row = db.prepare('SELECT * FROM diaries WHERE owner = ? AND date = ?').get(owner, date);
    res.json({ diary: row });
  } catch (err) {
    console.error('[diary] POST 失败:', err.message);
    res.status(500).json({ error: '保存日记失败' });
  }
});

// GET /api/diary/dates?owner=user|ai — 获取有日记的日期列表
router.get('/dates', (req, res) => {
  try {
    const { owner } = req.query;
    if (!owner || !['user', 'ai'].includes(owner)) {
      return res.status(400).json({ error: '参数 owner 必须为 user 或 ai' });
    }
    const rows = db.prepare(
      'SELECT date FROM diaries WHERE owner = ? AND content != \'\' ORDER BY date ASC'
    ).all(owner);
    res.json({ dates: rows.map(r => r.date) });
  } catch (err) {
    console.error('[diary] GET dates 失败:', err.message);
    res.status(500).json({ error: '获取日期列表失败' });
  }
});

module.exports = router;
