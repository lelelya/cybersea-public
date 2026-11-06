// server/modules/books/routes.js
// 书架（导入书）模块 API 路由

const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const crypto = require('crypto');
const db = require('../../db');

const router = express.Router();

const UPLOAD_DIR = path.join(__dirname, '..', '..', '..', 'uploads', 'books');
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// multer 配置：.txt 文件上传
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.txt';
    const name = crypto.randomBytes(16).toString('hex') + ext;
    cb(null, name);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    if (path.extname(file.originalname).toLowerCase() !== '.txt') {
      return cb(new Error('只支持上传 .txt 文件'));
    }
    cb(null, true);
  },
});

// PATCH /:id — 更新书名或排序
router.patch('/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { title, sort_order } = req.body || {};
    const book = db.prepare('SELECT * FROM books WHERE id = ?').get(id);
    if (!book) return res.status(404).json({ error: '书不存在' });

    if (title !== undefined) {
      db.prepare('UPDATE books SET title = ? WHERE id = ?').run(String(title).trim(), id);
    }
    if (sort_order !== undefined) {
      db.prepare('UPDATE books SET sort_order = ? WHERE id = ?').run(Number(sort_order), id);
    }

    const updated = db.prepare('SELECT * FROM books WHERE id = ?').get(id);
    res.json({ book: updated });
  } catch (err) {
    console.error('[books] PATCH 失败:', err.message);
    res.status(500).json({ error: '更新失败' });
  }
});

// POST / — 创建书 { title }
router.post('/', (req, res) => {
  try {
    const { title } = req.body || {};
    if (!title || !title.trim()) {
      return res.status(400).json({ error: '书名不能为空' });
    }

    // 随机书脊颜色
    const SPINE_COLORS = [
      '#4a6fa5', '#5b8c5a', '#8b5a5a', '#7a6a9a',
      '#5a7a8a', '#9a6a5a', '#6a8a6a', '#5a5a8a',
      '#8a6a7a', '#4a7a7a', '#7a4a6a', '#6a5a4a',
    ];
    const spineColor = SPINE_COLORS[Math.floor(Math.random() * SPINE_COLORS.length)];

    // 新书排到最后
    const maxOrder = db.prepare('SELECT MAX(sort_order) as m FROM books').get();
    const nextOrder = (maxOrder && maxOrder.m != null) ? maxOrder.m + 1 : 0;

    const result = db.prepare(
      'INSERT INTO books (title, spine_color, sort_order) VALUES (?, ?, ?)'
    ).run(title.trim(), spineColor, nextOrder);

    const row = db.prepare('SELECT * FROM books WHERE id = ?').get(result.lastInsertRowid);
    res.json({ book: row });
  } catch (err) {
    console.error('[books] POST 失败:', err.message);
    res.status(500).json({ error: '创建书失败' });
  }
});

// GET / — 获取书列表（不含 content 全文）
router.get('/', (req, res) => {
  try {
    const rows = db.prepare(
      'SELECT id, title, spine_color, sort_order, created_at, length(content) AS content_length FROM books ORDER BY sort_order ASC, created_at ASC'
    ).all();
    res.json({ books: rows });
  } catch (err) {
    console.error('[books] GET 失败:', err.message);
    res.status(500).json({ error: '获取书列表失败' });
  }
});

// GET /:id — 获取书详情（含 content）
router.get('/:id', (req, res) => {
  try {
    const { id } = req.params;
    const row = db.prepare('SELECT * FROM books WHERE id = ?').get(id);
    if (!row) {
      return res.status(404).json({ error: '书不存在' });
    }
    res.json({ book: row });
  } catch (err) {
    console.error('[books] GET :id 失败:', err.message);
    res.status(500).json({ error: '获取书详情失败' });
  }
});

// POST /:id/import — 上传 .txt 文件导入内容
router.post('/:id/import', upload.single('file'), (req, res) => {
  try {
    const { id } = req.params;
    const book = db.prepare('SELECT * FROM books WHERE id = ?').get(id);
    if (!book) {
      return res.status(404).json({ error: '书不存在' });
    }

    if (!req.file) {
      return res.status(400).json({ error: '未收到文件' });
    }

    // 读取 txt 文件内容
    const filePath = req.file.path;
    const content = fs.readFileSync(filePath, 'utf-8');

    // 存入数据库
    db.prepare('UPDATE books SET content = ? WHERE id = ?').run(content, id);

    // 清理上传的临时文件（内容已存入DB）
    try { fs.unlinkSync(filePath); } catch (_) { /* ignore */ }

    const updated = db.prepare('SELECT * FROM books WHERE id = ?').get(id);
    res.json({ book: updated, message: `已导入 ${content.length} 字` });
  } catch (err) {
    console.error('[books] import 失败:', err.message);
    res.status(500).json({ error: err.message || '导入失败' });
  }
});

// DELETE /:id — 删除书
router.delete('/:id', (req, res) => {
  try {
    const { id } = req.params;
    const book = db.prepare('SELECT id FROM books WHERE id = ?').get(id);
    if (!book) {
      return res.status(404).json({ error: '书不存在' });
    }
    db.prepare('DELETE FROM books WHERE id = ?').run(id);
    // 同时删除关联批画
    db.prepare("DELETE FROM annotations WHERE source_type = 'book' AND source_id = ?").run(String(id));
    res.json({ deleted: true });
  } catch (err) {
    console.error('[books] DELETE 失败:', err.message);
    res.status(500).json({ error: '删除书失败' });
  }
});

module.exports = router;
