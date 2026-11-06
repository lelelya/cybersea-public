// server/imageGenClient.js
// AI 图片生成模块：调生图 API，下载结果保存到本地。
// 支持传入参考图（形象照），API 会将其作为参考。

const fs = require('fs');
const path = require('path');
const db = require('./db');

const APP_DIR = path.join(__dirname, '..');
const UPLOADS_DIR = path.join(APP_DIR, 'uploads');
const GEN_DIR = path.join(UPLOADS_DIR, 'ai_generated');

function ensureDir() {
  if (!fs.existsSync(GEN_DIR)) {
    fs.mkdirSync(GEN_DIR, { recursive: true });
  }
}

/**
 * 根据文字描述生成一张图片
 * @param {string} prompt - 图片描述
 * @param {string[]} [referencePaths] - 参考图的本地绝对路径（形象照）
 * @returns {Promise<{image_path: string}|null>}
 */
async function generateImage(prompt, referencePaths) {
  const settings = db.prepare('SELECT * FROM settings WHERE id = 1').get();
  if (!settings) return null;

  const apiUrl = settings.image_gen_api_base_url || settings.api_base_url;
  const apiKey = settings.image_gen_api_key || settings.api_key;
  const model = settings.image_gen_model;

  if (!apiUrl || !apiKey || !model) return null;

  ensureDir();

  const url = apiUrl.replace(/\/+$/, '') + '/images/generations';

  const payloadObj = {
    model,
    prompt,
    n: 1,
    size: '1024x1024',
    response_format: 'b64_json',
  };

  // 如果有参考图，读取并转为 base64 传入
  if (referencePaths && referencePaths.length > 0) {
    const refImages = [];
    for (const refPath of referencePaths) {
      try {
        const buf = fs.readFileSync(refPath);
        const ext = path.extname(refPath).slice(1) || 'png';
        const b64 = buf.toString('base64');
        refImages.push(`data:image/${ext};base64,${b64}`);
      } catch (_) { /* 某张读不到就跳过 */ }
    }
    if (refImages.length > 0) {
      payloadObj.reference_images = refImages;
      payloadObj.reference_strength = 0.6;
    }
  }

  const payload = JSON.stringify(payloadObj);

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: payload,
      signal: AbortSignal.timeout(60000),
    });

    if (!resp.ok) {
      console.error('[imageGen] API 返回错误:', resp.status);
      return null;
    }

    const data = await resp.json();
    const b64 = data?.data?.[0]?.b64_json;
    if (!b64) return null;

    const filename = `gen_${Date.now()}.png`;
    const filePath = path.join(GEN_DIR, filename);
    fs.writeFileSync(filePath, Buffer.from(b64, 'base64'));

    const imagePath = '/uploads/ai_generated/' + filename;
    console.log('[imageGen] 生成成功:', imagePath);
    return { image_path: imagePath };
  } catch (err) {
    console.error('[imageGen] 生成失败:', err.message);
    return null;
  }
}

module.exports = { generateImage };
