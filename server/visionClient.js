// server/visionClient.js
// 视觉识别模块：发送图片到多模态模型，获取文字描述。

const db = require('./db');

/**
 * 识别图片内容
 * @param {string} base64Data - 完整的 data:image/xxx;base64,... 字符串
 * @returns {Promise<string|null>} 图片描述，失败返回 null
 */
async function describeImage(base64Data) {
  const settings = db.prepare('SELECT * FROM settings WHERE id = 1').get();
  if (!settings) return null;

  // 视觉 API 配置：优先用视觉专用配置，否则退回主配置
  const apiUrl = settings.vision_api_base_url || settings.api_base_url;
  const apiKey = settings.vision_api_key || settings.api_key;
  const model = settings.vision_model;

  if (!apiUrl || !apiKey || !model) return null;

  const url = apiUrl.replace(/\/+$/, '') + '/chat/completions';

  const payload = JSON.stringify({
    model,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image_url',
            image_url: { url: base64Data },
          },
          {
            type: 'text',
            text: '请用一两句话简要描述这张图片的内容。只输出描述，不要任何额外文字。',
          },
        ],
      },
    ],
    max_tokens: 200,
    temperature: 0.3,
  });

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: payload,
      signal: AbortSignal.timeout(30000),
    });

    if (!resp.ok) {
      console.error('[vision] API 返回错误:', resp.status);
      return null;
    }

    const data = await resp.json();
    const content = data?.choices?.[0]?.message?.content;
    return content?.trim() || null;
  } catch (err) {
    console.error('[vision] 识别失败:', err.message);
    return null;
  }
}

module.exports = { describeImage };
