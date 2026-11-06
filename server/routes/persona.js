// routes/persona.js
// 角色设定的读取与保存

const express = require('express');
const db = require('../db');

const router = express.Router();
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const multer = require('multer');
const { decodeImage } = require('../utils/imageData');
const { removeUnusedUpload } = require('../utils/uploads');
const portraitUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

router.post('/:owner/portrait', (req, res, next) => {
  if (!['ai', 'user'].includes(req.params.owner)) return res.status(400).json({ error: '无效的角色' });
  next();
}, portraitUpload.single('file'), (req, res, next) => {
  let file;
  try {
    if (!req.file) return res.status(400).json({ error: '请选择立绘图片' });
    const image = decodeImage(`data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`);
    const directory = path.join(__dirname, '../../uploads');
    fs.mkdirSync(directory, { recursive: true });
    const name = randomUUID() + '.' + image.extension;
    file = path.join(directory, name);
    const url = '/uploads/' + name;
    const column = req.params.owner + '_portrait_path';
    const previous = db.prepare(`SELECT ${column} AS path FROM persona WHERE id=1`).get().path;
    fs.writeFileSync(file, image.bytes);
    db.prepare(`UPDATE persona SET ${column}=? WHERE id=1`).run(url);
    file = null;
    try { removeUnusedUpload(db, previous); } catch (_) { /* Keep the saved portrait even if old-file cleanup fails. */ }
    res.json({ path: url });
  } catch (err) {
    if (file) { try { fs.unlinkSync(file); } catch (_) {} }
    next(err);
  }
});

router.get('/', (req, res) => {
  const persona = db.prepare('SELECT * FROM persona WHERE id = 1').get();
  res.json(persona);
});

router.put('/', (req, res) => {
  const {
    ai_name,
    user_name,
    ai_gender,
    ai_age,
    ai_height,
    ai_appearance,
    user_gender,
    user_age,
    user_height,
    user_appearance,
    user_birthday,
    ai_birthday,
    ai_avatar_path,
    user_avatar_path,
    fixed_settings,
  } = req.body || {};

  db.prepare(
    `UPDATE persona SET
      ai_name = COALESCE(@ai_name, ai_name),
      user_name = COALESCE(@user_name, user_name),
      ai_gender = COALESCE(@ai_gender, ai_gender),
      ai_age = COALESCE(@ai_age, ai_age),
      ai_height = COALESCE(@ai_height, ai_height),
      ai_appearance = COALESCE(@ai_appearance, ai_appearance),
      user_gender = COALESCE(@user_gender, user_gender),
      user_age = COALESCE(@user_age, user_age),
      user_height = COALESCE(@user_height, user_height),
      user_appearance = COALESCE(@user_appearance, user_appearance),
      ai_birthday = COALESCE(@ai_birthday, ai_birthday),
      user_birthday = COALESCE(@user_birthday, user_birthday),
      ai_avatar_path = COALESCE(@ai_avatar_path, ai_avatar_path),
      user_avatar_path = COALESCE(@user_avatar_path, user_avatar_path),
      fixed_settings = COALESCE(@fixed_settings, fixed_settings)
    WHERE id = 1`
  ).run({
    ai_name: ai_name ?? null,
    user_name: user_name ?? null,
    ai_gender: ai_gender ?? null,
    ai_age: ai_age ?? null,
    ai_height: ai_height ?? null,
    ai_appearance: ai_appearance ?? null,
    user_gender: user_gender ?? null,
    user_age: user_age ?? null,
    user_height: user_height ?? null,
    user_appearance: user_appearance ?? null,
    ai_birthday: ai_birthday ?? null,
    user_birthday: user_birthday ?? null,
    ai_avatar_path: ai_avatar_path ?? null,
    user_avatar_path: user_avatar_path ?? null,
    fixed_settings: fixed_settings ?? null,
  });

  const updated = db.prepare('SELECT * FROM persona WHERE id = 1').get();
  res.json(updated);
});

module.exports = router;
