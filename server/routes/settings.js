// routes/settings.js
// API接入配置的读取与保存（只支持保存一组配置）

const express = require('express');
const db = require('../db');

const router = express.Router();

router.get('/', (req, res) => {
  const settings = db.prepare('SELECT * FROM settings WHERE id = 1').get();
  // 出于安全考虑，密钥仍然原样返回给前端（单用户本地场景，前端设置页需要回显）
  res.json(settings);
});

router.put('/', (req, res) => {
  const { api_base_url, api_key, model, temperature, max_tokens,
          vision_api_base_url, vision_api_key, vision_model,
          image_gen_api_base_url, image_gen_api_key, image_gen_model,
          tts_api_url, tts_api_key } = req.body || {};

  db.prepare(
    `UPDATE settings SET
      api_base_url = COALESCE(@api_base_url, api_base_url),
      api_key = COALESCE(@api_key, api_key),
      model = COALESCE(@model, model),
      temperature = COALESCE(@temperature, temperature),
      max_tokens = COALESCE(@max_tokens, max_tokens),
      vision_api_base_url = COALESCE(@vision_api_base_url, vision_api_base_url),
      vision_api_key = COALESCE(@vision_api_key, vision_api_key),
      vision_model = COALESCE(@vision_model, vision_model),
      image_gen_api_base_url = COALESCE(@image_gen_api_base_url, image_gen_api_base_url),
      image_gen_api_key = COALESCE(@image_gen_api_key, image_gen_api_key),
      image_gen_model = COALESCE(@image_gen_model, image_gen_model),
      tts_api_url = COALESCE(@tts_api_url, tts_api_url),
      tts_api_key = COALESCE(@tts_api_key, tts_api_key)
    WHERE id = 1`
  ).run({
    api_base_url: api_base_url ?? null,
    api_key: api_key ?? null,
    model: model ?? null,
    temperature: temperature ?? null,
    max_tokens: max_tokens ?? null,
    vision_api_base_url: vision_api_base_url ?? null,
    vision_api_key: vision_api_key ?? null,
    vision_model: vision_model ?? null,
    image_gen_api_base_url: image_gen_api_base_url ?? null,
    image_gen_api_key: image_gen_api_key ?? null,
    image_gen_model: image_gen_model ?? null,
    tts_api_url: tts_api_url ?? null,
    tts_api_key: tts_api_key ?? null,
  });

  const updated = db.prepare('SELECT * FROM settings WHERE id = 1').get();
  res.json(updated);
});

module.exports = router;
