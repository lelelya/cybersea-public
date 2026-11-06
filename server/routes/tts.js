// routes/tts.js
// TTS 语音合成端点：调用用户配置的 TTS API 将文字转为 WAV 音频，缓存到 uploads/

const express = require('express');
const db = require('../db');

const router = express.Router();

function getTtsConfig() {
  const s = db.prepare('SELECT tts_api_url, tts_api_key FROM settings WHERE id = 1').get();
  return { url: s?.tts_api_url || '', key: s?.tts_api_key || '' };
}

function isConfigured() {
  return !!getTtsConfig().url;
}

/**
 * 调用 TTS API 生成 WAV 音频，返回 Buffer。
 */
async function generateAudio(text) {
  const cfg = getTtsConfig();
  if (!cfg.url) {
    throw new Error('未配置 TTS API');
  }

  const headers = { 'Content-Type': 'application/json' };
  if (cfg.key) headers['Authorization'] = `Bearer ${cfg.key}`;

  const resp = await fetch(cfg.url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ text }),
  });

  if (!resp.ok) {
    let detail = '';
    try { const err = await resp.json(); detail = err.message || err.detail || ''; } catch (_) {}
    throw new Error('TTS 合成失败（HTTP ' + resp.status + '）' + (detail ? '：' + detail : ''));
  }

  return Buffer.from(await resp.arrayBuffer());
}

// Playback without persisting a message (voice calls and read-aloud).
router.post('/synthesize', async (req, res) => {
  const text = req.body?.text;
  if (typeof text !== 'string' || !text.trim() || text.length > 20000) {
    return res.status(400).json({ error: '需要 1 到 20000 字的 text' });
  }
  if (!isConfigured()) return res.status(400).json({ error: '请先在设置页配置 TTS API' });
  try {
    res.type('audio/wav').send(await generateAudio(text));
  } catch (error) {
    res.status(502).json({ error: error.message || 'TTS 合成失败' });
  }
});

router.post('/', async (req, res) => {
  const { text, message_id } = req.body || {};
  if (!text || !message_id) {
    return res.status(400).json({ error: '需要 text 和 message_id' });
  }
  const original=db.prepare('SELECT * FROM messages WHERE id=?').get(message_id);
  if(!original)return res.status(404).json({error:'消息不存在'});

  if (!isConfigured()) {
    return res.status(400).json({ error: '未配置 TTS API，请在设置页填写 TTS 地址' });
  }

  try {
    const audioBuf = await generateAudio(text);
    const current=db.prepare('SELECT * FROM messages WHERE id=?').get(message_id);
    if(!current)return res.status(404).json({error:'消息已删除'});
    if(current.revision!==original.revision)return res.status(409).json({error:'消息已修改，请重新合成'});

    const crypto = require('crypto');
    const path = require('path');
    const fs = require('fs');
    const name = crypto.randomBytes(16).toString('hex') + '.wav';
    const dir = path.join(__dirname, '..', '..', 'uploads');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, name), audioBuf);

    const voicePath = '/uploads/' + name;
    db.prepare('UPDATE messages SET voice_path = ? WHERE id = ?').run(voicePath, message_id);

    res.json({ voice_path: voicePath });
  } catch (err) {
    console.error('[TTS] 生成失败:', err.message);
    res.status(500).json({ error: err.message || 'TTS生成失败' });
  }
});

module.exports = router;
module.exports.generateAudio = generateAudio;
module.exports.isConfigured = isConfigured;
