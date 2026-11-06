// routes/bookshelfConfig.js
// 书架背景配置 API

const express = require('express');
const db = require('../db');

const router = express.Router();

// GET /api/bookshelf-config — 获取书架背景配置
router.get('/', (req, res) => {
  try {
    const config = db.prepare(
      'SELECT bookshelf_page_bg, bookshelf_card_diary_user_bg, bookshelf_card_diary_ai_bg, bookshelf_card_stories_bg, bookshelf_card_books_bg FROM app_config WHERE id = 1'
    ).get();
    res.json(config || {});
  } catch (err) {
    console.error('[bookshelf-config] GET 失败:', err.message);
    res.status(500).json({ error: '读取配置失败' });
  }
});

// PUT /api/bookshelf-config — 更新书架背景配置
router.put('/', (req, res) => {
  try {
    const fields = [
      'bookshelf_page_bg',
      'bookshelf_card_diary_user_bg',
      'bookshelf_card_diary_ai_bg',
      'bookshelf_card_stories_bg',
      'bookshelf_card_books_bg',
    ];

    const sets = [];
    const vals = {};

    for (const field of fields) {
      if (req.body && req.body[field] !== undefined) {
        sets.push(`${field} = @${field}`);
        vals[field] = req.body[field] || '';
      }
    }

    if (sets.length > 0) {
      db.prepare(
        `UPDATE app_config SET ${sets.join(', ')} WHERE id = 1`
      ).run(vals);
    }

    const updated = db.prepare(
      'SELECT bookshelf_page_bg, bookshelf_card_diary_user_bg, bookshelf_card_diary_ai_bg, bookshelf_card_stories_bg, bookshelf_card_books_bg FROM app_config WHERE id = 1'
    ).get();
    res.json(updated || {});
  } catch (err) {
    console.error('[bookshelf-config] PUT 失败:', err.message);
    res.status(500).json({ error: '更新配置失败' });
  }
});

module.exports = router;
