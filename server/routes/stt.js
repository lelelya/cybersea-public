// routes/stt.js
// STT 语音识别端点：转发音频到 SenseVoice，返回识别文本 + 情绪标签

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const os = require('os');

const router = express.Router();

const SENSEVOICE_URL = process.env.SENSEVOICE_URL || 'http://localhost:50000/api/v1/asr';

// 临时文件存储（用完后立即删除）
const tmpDir = path.join(os.tmpdir(), 'cybersea_stt');
if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

const upload = multer({ dest: tmpDir, limits: { fileSize: 10 * 1024 * 1024 } });

// 情绪中文映射
const EMOTION_MAP = {
  NEUTRAL: null,
  HAPPY: '开心',
  SAD: '低落',
  ANGRY: '生气',
  FEARFUL: '紧张',
  DISGUSTED: '反感',
  SURPRISED: '惊讶',
};

/**
 * 从 raw_text 中提取情绪标签
 * raw_text 格式示例: <|zh|><|NEUTRAL|><|Speech|><|woitn|>文本内容
 * 正则匹配所有 <|xxx|> 标签，第二个匹配项即为情绪
 */
function extractEmotion(rawText) {
  if (!rawText) return null;
  const matches = [...rawText.matchAll(/<\|(\w+)\|>/g)];
  if (matches.length >= 2) {
    const tag = matches[1][1];
    return EMOTION_MAP[tag] || null;
  }
  return null;
}

router.post('/', upload.single('audio'), async (req, res) => {
  const file = req.file;
  if (!file) {
    return res.status(400).json({ error: '缺少音频文件' });
  }

  try {
    // 构建 FormData 转发到 SenseVoice
    const fileBuffer = fs.readFileSync(file.path);
    const blob = new Blob([fileBuffer], { type: file.mimetype || 'audio/webm' });

    const formData = new FormData();
    formData.append('files', blob, file.originalname || 'audio.webm');
    formData.append('lang', 'auto');

    const senseResp = await fetch(SENSEVOICE_URL, {
      method: 'POST',
      body: formData,
    });

    if (!senseResp.ok) {
      const errText = await senseResp.text().catch(() => '');
      throw new Error(`SenseVoice 返回 ${senseResp.status}${errText ? ': ' + errText.slice(0, 300) : ''}`);
    }

    const data = await senseResp.json();
    const result = data.result?.[0];
    if (!result) {
      throw new Error('SenseVoice 返回数据为空');
    }

    const text = result.text || result.clean_text || '';
    const emotion = extractEmotion(result.raw_text || '');

    res.json({ text, emotion: emotion || null });
  } catch (err) {
    console.error('[STT] 识别失败:', err.message);
    res.status(500).json({ error: err.message || '语音识别失败' });
  } finally {
    // 清理临时文件
    try { fs.unlinkSync(file.path); } catch (_) { /* ignore */ }
  }
});

module.exports = router;
