// routes/config.js
// 全局外观配置（当前只有自定义背景图路径）

const express = require('express');
const db = require('../db');

const router = express.Router();

router.get('/', (req, res) => {
  const config = db.prepare('SELECT * FROM app_config WHERE id = 1').get();
  res.json(config);
});

router.put('/', (req, res) => {
  const { background_path, theme, home_description } = req.body || {};
  db.prepare(
    'UPDATE app_config SET background_path = COALESCE(@bg, background_path), theme = COALESCE(@theme, theme), home_description = COALESCE(@hd, home_description) WHERE id = 1'
  ).run({ bg: background_path ?? null, theme: theme ?? null, hd: home_description ?? null });
  const updated = db.prepare('SELECT * FROM app_config WHERE id = 1').get();
  res.json(updated);
});

module.exports = router;
