// routes/stickers.js
// 自定义表情包管理：CRUD + 图片上传

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const db = require('../db');

const router = express.Router();

// 确保 stickers 上传目录存在
const STICKERS_DIR = path.join(__dirname, '..', '..', 'uploads', 'stickers');
if (!fs.existsSync(STICKERS_DIR)) {
  fs.mkdirSync(STICKERS_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, STICKERS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.png';
    const name = crypto.randomBytes(16).toString('hex') + ext;
    cb(null, name);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    const allowed = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('不支持的文件类型，只允许 png/jpg/jpeg/gif/webp/bmp'));
    }
  },
});

// 列表
router.get('/', (req, res) => {
  const stickers = db.prepare('SELECT id, name, path, created_at FROM stickers ORDER BY created_at ASC').all();
  res.json({ stickers });
});

// 上传新表情（multipart: image + name 字段）
router.post('/', upload.single('image'), (req, res) => {
  try {
    const name = (req.body.name || '').trim();
    if (!name) {
      return res.status(400).json({ error: '表情名称不能为空' });
    }
    if (name.length > 20) {
      return res.status(400).json({ error: '表情名称不超过20个字符' });
    }
    if (!req.file) {
      return res.status(400).json({ error: '请选择图片文件' });
    }

    const filePath = '/uploads/stickers/' + req.file.filename;
    const result = db.prepare(
      'INSERT INTO stickers (name, path) VALUES (?, ?)'
    ).run(name, filePath);

    const sticker = db.prepare('SELECT * FROM stickers WHERE id = ?').get(result.lastInsertRowid);
    res.json(sticker);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 删除
router.delete('/:id', (req, res) => {
  try {
    const sticker = db.prepare('SELECT * FROM stickers WHERE id = ?').get(parseInt(req.params.id));
    if (!sticker) {
      return res.status(404).json({ error: '表情不存在' });
    }

    // 删除文件
    const absPath = path.join(__dirname, '..', '..', sticker.path);
    try { if (fs.existsSync(absPath)) fs.unlinkSync(absPath); } catch (_) {}

    db.prepare('DELETE FROM stickers WHERE id = ?').run(sticker.id);
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
