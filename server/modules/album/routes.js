// server/modules/album/routes.js
// 相册模块路由。"我的相册"(owner=user) 和 "他的相册"(owner=ai) 严格通过 owner 字段隔离查询，
// 前端两个区域调用同样的接口，只是传不同的 owner 参数。

const express = require('express');
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const db = require('../../db');
const {removeUnusedUpload}=require('../../utils/uploads');

const router = express.Router();

const UPLOAD_DIR = path.join(__dirname, '..', '..', '..', 'uploads');

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.png';
    cb(null, crypto.randomBytes(16).toString('hex') + ext);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) return cb(new Error('只支持上传图片文件'));
    cb(null, true);
  },
});

function validOwner(owner) {
  return owner === 'user' || owner === 'ai';
}

// ---------------- 文件夹（手动创建，只能你来创建，AI不建文件夹） ----------------

router.get('/folders', (req, res) => {
  const { owner } = req.query;
  if (!validOwner(owner)) return res.status(400).json({ error: 'owner 必须是 user 或 ai' });
  const rows = db.prepare('SELECT * FROM album_folders WHERE owner = ? ORDER BY created_at ASC').all(owner);
  res.json({ folders: rows });
});

router.post('/folders', (req, res) => {
  const { owner, name } = req.body || {};
  if (!validOwner(owner) || !name) return res.status(400).json({ error: '需要 owner 和 name' });
  const result = db.prepare('INSERT INTO album_folders (owner, name) VALUES (?, ?)').run(owner, name);
  res.json(db.prepare('SELECT * FROM album_folders WHERE id = ?').get(result.lastInsertRowid));
});

router.put('/folders/:id', (req, res) => {
  const { name } = req.body || {};
  if (!name) return res.status(400).json({ error: '需要 name' });
  db.prepare('UPDATE album_folders SET name = ? WHERE id = ?').run(name, req.params.id);
  res.json(db.prepare('SELECT * FROM album_folders WHERE id = ?').get(req.params.id));
});

router.delete('/folders/:id', (req, res) => {
  // 删除文件夹时，同时把里面的照片移出（变成未分类），避免照片丢失；如果想连照片一起删，可以改成级联删除
  db.prepare('UPDATE album_photos SET folder_id = NULL WHERE folder_id = ?').run(req.params.id);
  db.prepare('DELETE FROM album_folders WHERE id = ?').run(req.params.id);
  res.json({ deleted: true });
});

// ---------------- 照片 ----------------

// 列出某个owner（可选folder_id）下的照片
router.get('/photos', (req, res) => {
  const { owner, folder_id } = req.query;
  if (!validOwner(owner)) return res.status(400).json({ error: 'owner 必须是 user 或 ai' });

  let rows;
  if (folder_id) {
    rows = db
      .prepare('SELECT * FROM album_photos WHERE owner = ? AND folder_id = ? ORDER BY created_at DESC')
      .all(owner, folder_id);
  } else {
    rows = db
      .prepare('SELECT * FROM album_photos WHERE owner = ? ORDER BY created_at DESC')
      .all(owner);
  }
  res.json({ photos: rows });
});

// 你手动上传照片到"我的相册"
router.post('/photos/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: '未收到文件' });
  const { folder_id, caption } = req.body || {};
  const filePath = `/uploads/${req.file.filename}`;

  const result = db
    .prepare('INSERT INTO album_photos (owner, folder_id, path, caption) VALUES (?, ?, ?, ?)')
    .run('user', folder_id || null, filePath, caption || '');

  res.json(db.prepare('SELECT * FROM album_photos WHERE id = ?').get(result.lastInsertRowid));
});

// 把照片移动到某个文件夹（你自己整理"我的相册"用）
router.put('/photos/:id', (req, res) => {
  const { folder_id, caption } = req.body || {};
  db.prepare(
    'UPDATE album_photos SET folder_id = COALESCE(@folder_id, folder_id), caption = COALESCE(@caption, caption) WHERE id = @id'
  ).run({ id: req.params.id, folder_id: folder_id ?? null, caption: caption ?? null });
  res.json(db.prepare('SELECT * FROM album_photos WHERE id = ?').get(req.params.id));
});

router.delete('/photos/:id', (req, res) => {
  const photo=db.prepare('SELECT * FROM album_photos WHERE id=?').get(req.params.id);
  if(!photo)return res.status(404).json({error:'照片不存在'});
  db.prepare('DELETE FROM album_photos WHERE id = ?').run(req.params.id);
  removeUnusedUpload(db,photo.path);
  res.json({ deleted: true });
});

// AI保存图片进"他的相册"——三种来源：AI自己画的(drawn) / 从网上下载(downloaded) / 聊天中收到并保留的(kept_from_chat)
// v1.0还没有接入绘图/联网下载能力，这里先提供保存接口本身，供后续接入时调用；
// 也可以手动传一个已有的图片URL/本地路径测试。
router.post('/photos/ai-save', async (req, res) => {
  const { path: photoPath, source, caption, folder_id } = req.body || {};
  if (!photoPath || !['drawn', 'downloaded', 'kept_from_chat'].includes(source)) {
    return res.status(400).json({ error: '需要 path 和合法的 source(drawn/downloaded/kept_from_chat)' });
  }
  const result = db
    .prepare('INSERT INTO album_photos (owner, folder_id, path, source, caption) VALUES (?, ?, ?, ?, ?)')
    .run('ai', folder_id || null, photoPath, source, caption || '');
  res.json(db.prepare('SELECT * FROM album_photos WHERE id = ?').get(result.lastInsertRowid));
});

module.exports = router;
