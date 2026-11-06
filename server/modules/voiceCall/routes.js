// server/modules/voiceCall/routes.js
// 语音通话模块路由：通话记录 CRUD + 录音上传

const express = require('express');
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const db = require('../../db');

const router = express.Router();

const UPLOAD_DIR = path.join(__dirname, '..', '..', '..', 'uploads');

// ---- 录音上传（multer：仅接受 audio/webm） ----

const recordingStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const name = crypto.randomBytes(16).toString('hex') + '.webm';
    cb(null, name);
  },
});

const recordingUpload = multer({
  storage: recordingStorage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB 录音上限
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'audio/webm' || file.mimetype === 'audio/webm;codecs=opus') {
      return cb(null, true);
    }
    cb(new Error('只支持上传 webm 音频文件'));
  },
});

router.post('/upload-recording', recordingUpload.single('recording'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: '未收到录音文件' });
  }
  res.json({ path: `/uploads/${req.file.filename}` });
});

// ---- 通话记录 CRUD ----

// GET /api/voice-call/history — 全部记录（按开始时间降序）
router.get('/history', (req, res) => {
  try {
    const rows = db.prepare(
      'SELECT id, started_at, duration_seconds, audio_path, created_at FROM call_history ORDER BY started_at DESC'
    ).all();
    res.json({ calls: rows });
  } catch (err) {
    console.error('[voiceCall] 获取通话记录失败:', err);
    res.status(500).json({ error: '获取通话记录失败' });
  }
});

// POST /api/voice-call/save — 保存通话记录
router.post('/save', (req, res) => {
  try {
    const { started_at, duration_seconds, audio_path } = req.body;
    if (!started_at || duration_seconds == null) {
      return res.status(400).json({ error: '缺少必填字段 started_at / duration_seconds' });
    }
    const result = db.prepare(
      'INSERT INTO call_history (started_at, duration_seconds, audio_path) VALUES (?, ?, ?)'
    ).run(started_at, Math.max(0, Math.floor(duration_seconds)), audio_path || '');
    const row = db.prepare('SELECT * FROM call_history WHERE id = ?').get(result.lastInsertRowid);
    res.json({ call: row });
  } catch (err) {
    console.error('[voiceCall] 保存通话记录失败:', err);
    res.status(500).json({ error: '保存通话记录失败' });
  }
});

// POST /api/voice-call/transcript — 保存通话文字记录到聊天记忆库（hidden消息，UI不显示但AI可读）
router.post('/transcript', (req, res) => {
  try {
    const { started_at, duration_seconds, rounds } = req.body;
    if (!started_at || !rounds || !Array.isArray(rounds)) {
      return res.status(400).json({ error: '缺少必填字段 started_at / rounds' });
    }

    const service=require('../memoryBank/service').getMemoryService();
    const result=require('../memoryBank/voiceTranscript').saveTranscript(service,req.body);
    const s=service.settings();const pipelines=[...(s.events_auto_enabled?['events']:[]),...(s.profile_mode!=='off'?['profile']:[])];if(pipelines.length)service.enqueueMaintenance({pipelines,automatic:true});
    res.json({...result,message:'通话记录已保存'});
  } catch (err) {
    console.error('[voiceCall] 保存通话记录失败:', err);
    res.status(500).json({ error: '保存通话记录失败' });
  }
});

// POST /api/voice-call/call-bubble — 挂断后在聊天中插入通话气泡
router.post('/call-bubble', (req, res) => {
  try {
    const { started_at, duration_seconds, audio_path, incoming, missed } = req.body;
    if (!started_at) {
      return res.status(400).json({ error: '缺少必填字段 started_at' });
    }

    const secs = Math.max(0, Math.floor(duration_seconds || 0));
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    const pad2 = (n) => String(n).padStart(2, '0');
    const durationStr = pad2(m) + ':' + pad2(s);

    // incoming=true 表示AI来电，气泡在AI侧（role='ai'）；否则用户拨出，气泡在用户侧
    const role = incoming ? 'ai' : 'user';

    let content;
    if (missed) {
      content = '[通话] 未接来电';
    } else if (secs > 0) {
      content = '[通话] 通话时长 ' + durationStr + (audio_path ? ' | ' + audio_path : '');
    } else {
      content = '[通话] 未接通';
    }

    const result = db.prepare(
      `INSERT INTO messages (role, content, type, hidden, memory_origin) VALUES (?, ?, ?, 0, 'voice')`
    ).run(role, content, 'text');

    res.json({ inserted: result.lastInsertRowid, content: content });
  } catch (err) {
    console.error('[voiceCall] 插入通话气泡失败:', err);
    res.status(500).json({ error: '插入通话气泡失败' });
  }
});

// DELETE /api/voice-call/history/:id — 删除单条记录
router.delete('/history/:id', (req, res) => {
  try {
    const row = db.prepare('SELECT * FROM call_history WHERE id = ?').get(req.params.id);
    if (!row) {
      return res.status(404).json({ error: '记录不存在' });
    }
    db.prepare('DELETE FROM call_history WHERE id = ?').run(req.params.id);
    res.json({ deleted: row });
  } catch (err) {
    console.error('[voiceCall] 删除通话记录失败:', err);
    res.status(500).json({ error: '删除通话记录失败' });
  }
});

module.exports = router;
