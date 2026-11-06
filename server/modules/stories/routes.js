// server/modules/stories/routes.js
// 睡前故事模块 API 路由

const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const db = require('../../db');
const ttsRouter = require('../../routes/tts');
const {removeUnusedUpload}=require('../../utils/uploads');

const router = express.Router();

const UPLOADS_DIR = path.join(__dirname, '..', '..', '..', 'uploads');
const STORIES_AUDIO_DIR = path.join(UPLOADS_DIR, 'stories');

function ensureStoriesAudioDir() {
  if (!fs.existsSync(STORIES_AUDIO_DIR)) {
    fs.mkdirSync(STORIES_AUDIO_DIR, { recursive: true });
  }
}

// POST / — 创建故事
router.post('/', (req, res) => {
  try {
    const { title, content } = req.body || {};
    if (!title || !content) {
      return res.status(400).json({ error: '缺少必填字段: title, content' });
    }

    const result = db.prepare(
      'INSERT INTO stories (title, content) VALUES (?, ?)'
    ).run(title, content);

    const row = db.prepare('SELECT * FROM stories WHERE id = ?').get(result.lastInsertRowid);
    res.json({ item: row });
  } catch (err) {
    console.error('[stories] POST 失败:', err.message);
    res.status(500).json({ error: '创建故事失败' });
  }
});

// GET / — 获取故事列表（不含 content 全文）
router.get('/', (req, res) => {
  try {
    const rows = db.prepare(
      'SELECT id, title, audio_path, created_at FROM stories ORDER BY created_at ASC'
    ).all();
    res.json({ items: rows });
  } catch (err) {
    console.error('[stories] GET 失败:', err.message);
    res.status(500).json({ error: '获取故事列表失败' });
  }
});

// GET /:id — 获取单个故事详情（含 content）
router.get('/:id', (req, res) => {
  try {
    const { id } = req.params;
    const row = db.prepare('SELECT * FROM stories WHERE id = ?').get(id);
    if (!row) {
      return res.status(404).json({ error: '故事不存在' });
    }
    res.json({ item: row });
  } catch (err) {
    console.error('[stories] GET :id 失败:', err.message);
    res.status(500).json({ error: '获取故事详情失败' });
  }
});

// PUT /:id — 更新故事标题和内容
router.put('/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { title, content } = req.body || {};

    const existing = db.prepare('SELECT * FROM stories WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({ error: '故事不存在' });
    }

    const newTitle = title !== undefined ? title : existing.title;
    const newContent = content !== undefined ? content : existing.content;

    db.prepare('UPDATE stories SET title = ?, content = ?, audio_path = ? WHERE id = ?')
      .run(newTitle, newContent, newContent===existing.content?existing.audio_path:'', id);
    if(newContent!==existing.content&&existing.audio_path)removeUnusedUpload(db,existing.audio_path);

    const row = db.prepare('SELECT * FROM stories WHERE id = ?').get(id);
    res.json({ item: row });
  } catch (err) {
    console.error('[stories] PUT 失败:', err.message);
    res.status(500).json({ error: '更新故事失败' });
  }
});

// DELETE /:id — 删除故事（同时删除关联音频文件）
router.delete('/:id', (req, res) => {
  try {
    const { id } = req.params;
    const existing = db.prepare('SELECT * FROM stories WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({ error: '故事不存在' });
    }

    // 删除关联音频文件
    if (existing.audio_path) {
      const audioFile = path.join(UPLOADS_DIR, '..', existing.audio_path.replace(/^\//, ''));
      try {
        if (fs.existsSync(audioFile)) fs.unlinkSync(audioFile);
      } catch (_) { /* 文件可能已不存在 */ }
    }

    db.prepare('DELETE FROM stories WHERE id = ?').run(id);
    res.json({ deleted: true });
  } catch (err) {
    console.error('[stories] DELETE 失败:', err.message);
    res.status(500).json({ error: '删除故事失败' });
  }
});

// POST /:id/tts — 生成 TTS 音频
router.post('/:id/tts', async (req, res) => {
  try {
    const { id } = req.params;
    const story = db.prepare('SELECT * FROM stories WHERE id = ?').get(id);
    if (!story) {
      return res.status(404).json({ error: '故事不存在' });
    }

    // 已有音频则直接返回
    if (story.audio_path) {
      return res.json({ audio_path: story.audio_path });
    }

    // 检查 TTS 是否已配置
    if (!ttsRouter.isConfigured()) {
      return res.status(400).json({ error: '未配置 TTS API，请在设置页填写' });
    }

    // 调用 TTS 生成整篇故事音频
    ensureStoriesAudioDir();
    const audioBuf = await ttsRouter.generateAudio(story.content.replace(/\s*---PAGE---\s*/g,'\n\n'));
    const current=db.prepare('SELECT * FROM stories WHERE id=?').get(id);
    if(!current)return res.status(404).json({error:'故事已被删除'});
    if(current.content!==story.content)return res.status(409).json({error:'故事已修改，请重新合成'});

    const filename = 'story_' + id + '_' + Date.now() + '.wav';
    const filePath = path.join(STORIES_AUDIO_DIR, filename);
    fs.writeFileSync(filePath, audioBuf);

    const audioPath = '/uploads/stories/' + filename;
    db.prepare('UPDATE stories SET audio_path = ? WHERE id = ?').run(audioPath, id);

    res.json({ audio_path: audioPath });
  } catch (err) {
    console.error('[stories] TTS 生成失败:', err.message);
    res.status(500).json({ error: err.message || 'TTS 生成失败' });
  }
});

module.exports = router;
