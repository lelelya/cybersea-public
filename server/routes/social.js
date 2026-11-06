// routes/social.js
// 社交资料 + AI 备注 API

const express = require('express');
const db = require('../db');
const router = express.Router();

// ---- 社交资料（user / ai 各一条） ----

router.get('/profile/:owner', (req, res) => {
  const { owner } = req.params;
  if (owner !== 'user' && owner !== 'ai') {
    return res.status(400).json({ error: 'owner 必须是 user 或 ai' });
  }
  const row = db.prepare('SELECT * FROM social_profile WHERE owner = ?').get(owner);
  res.json({ profile: row || { owner, nickname: '', signature: '' } });
});

router.put('/profile/:owner', (req, res) => {
  const { owner } = req.params;
  if (owner !== 'user' && owner !== 'ai') {
    return res.status(400).json({ error: 'owner 必须是 user 或 ai' });
  }
  const { nickname, signature } = req.body || {};
  const sets = [];
  const vals = [];
  if (nickname !== undefined) { sets.push('nickname = ?'); vals.push(String(nickname)); }
  if (signature !== undefined) { sets.push('signature = ?'); vals.push(String(signature)); }
  if (sets.length === 0) return res.status(400).json({ error: '至少需要 nickname 或 signature 之一' });

  sets.push("updated_at = datetime('now', 'localtime')");
  vals.push(owner);
  db.prepare(`UPDATE social_profile SET ${sets.join(', ')} WHERE owner = ?`).run(...vals);
  const row = db.prepare('SELECT * FROM social_profile WHERE owner = ?').get(owner);
  res.json({ profile: row });
});

// ---- AI 备注（用户给 AI 起的备注名） ----

router.get('/ai-remark', (req, res) => {
  const row = db.prepare('SELECT remark FROM ai_remark WHERE id = 1').get();
  res.json({ remark: row ? (row.remark || '') : '' });
});

router.put('/ai-remark', (req, res) => {
  const { remark } = req.body || {};
  db.prepare('UPDATE ai_remark SET remark = ? WHERE id = 1').run(String(remark || ''));
  res.json({ remark: remark || '' });
});

module.exports = router;
