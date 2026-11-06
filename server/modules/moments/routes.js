// server/modules/moments/routes.js
// 朋友圈模块路由：发动态（图文）、点赞、评论、个性签名读写、图片上传。

const express = require('express');
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const db = require('../../db');
const { chatCompletion } = require('../../llmClient');
const { maybeReactToMoment, buildPersonaPrompt } = require('./trigger');
const { validatePost } = require('./validation');

const router = express.Router();
const asyncRoute = handler => (req, res, next) => Promise.resolve(handler(req, res)).catch(next);

const UPLOAD_DIR = path.join(__dirname, '..', '..', '..', 'uploads', 'moments');

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    try { require('fs').mkdirSync(UPLOAD_DIR, {recursive:true}); cb(null, UPLOAD_DIR); }
    catch (error) { cb(error); }
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, 'moment_' + crypto.randomBytes(12).toString('hex') + ext);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) return cb(new Error('只支持上传图片文件'));
    cb(null, true);
  },
});

function withDetails(moment) {
  const likes = db.prepare('SELECT author FROM moments_likes WHERE moment_id = ?').all(moment.id);
  const comments = db
    .prepare('SELECT * FROM moments_comments WHERE moment_id = ? ORDER BY created_at ASC')
    .all(moment.id);
  return { ...moment, likes, comments };
}

// 图片上传（最多 9 张）
router.post('/upload', upload.array('files', 9), (req, res) => {
  const paths = (req.files || []).map((f) => '/uploads/moments/' + f.filename);
  res.json({ paths });
});

router.get('/', (req, res) => {
  const { owner } = req.query;
  const rows = owner
    ? db.prepare('SELECT * FROM moments WHERE owner = ? ORDER BY created_at DESC').all(owner)
    : db.prepare('SELECT * FROM moments ORDER BY created_at DESC').all();
  res.json({ moments: rows.map(withDetails) });
});

// 你自己发一条动态；发完之后AI会（有一定概率地）点赞/评论一下，模拟"看到了朋友圈会互动"
router.post('/', asyncRoute(async (req, res) => {
  const { content, images } = validatePost(req.body);

  // images 存为 JSON 数组到 image_path（兼容旧单图字符串）
  const imagePath = (Array.isArray(images) && images.length > 0)
    ? JSON.stringify(images)
    : '';

  const result = db
    .prepare('INSERT INTO moments (owner, content, image_path) VALUES (?, ?, ?)')
    .run('user', content, imagePath);
  const moment = db.prepare('SELECT * FROM moments WHERE id = ?').get(result.lastInsertRowid);

  // AI对你发的动态做出反应（点赞/评论其中一种或都做），失败不影响动态本身发布成功
  try {
    await maybeReactToMoment(moment.id);
  } catch (err) {
    console.error('[朋友圈] AI互动生成失败:', err.message);
  }

  const current = db.prepare('SELECT * FROM moments WHERE id = ?').get(moment.id);
  if (!current) return res.status(404).json({error:'动态已被删除'});
  res.json(withDetails(current));
}));

router.delete('/:id', (req, res) => {
  if (!db.prepare('SELECT id FROM moments WHERE id=?').get(req.params.id)) return res.status(404).json({error:'动态不存在'});
  db.prepare('DELETE FROM moments WHERE id = ?').run(req.params.id);
  res.json({ deleted: true });
});

// 点赞/取消点赞。author: 'user' | 'ai'（前端点赞按钮固定传'user'；'ai'点赞由系统内部逻辑调用）
router.post('/:id/like', (req, res) => {
  const { author } = req.body || {};
  if (!['user', 'ai'].includes(author)) return res.status(400).json({ error: '需要合法的 author' });
  if (!db.prepare('SELECT id FROM moments WHERE id = ?').get(req.params.id)) return res.status(404).json({error:'动态不存在'});

  const existing = db
    .prepare('SELECT * FROM moments_likes WHERE moment_id = ? AND author = ?')
    .get(req.params.id, author);

  if (existing) {
    db.prepare('DELETE FROM moments_likes WHERE id = ?').run(existing.id);
  } else {
    db.prepare('INSERT INTO moments_likes (moment_id, author) VALUES (?, ?)').run(req.params.id, author);
  }

  res.json(withDetails(db.prepare('SELECT * FROM moments WHERE id = ?').get(req.params.id)));
});

// 你评论一条动态——如果这条动态存在，AI会实时自动回复你的评论
router.post('/:id/comments', asyncRoute(async (req, res) => {
  const { content } = req.body || {};
  if (typeof content !== 'string' || !content.trim()) return res.status(400).json({ error: '评论内容不能为空' });

  const moment = db.prepare('SELECT * FROM moments WHERE id = ?').get(req.params.id);
  if (!moment) return res.status(404).json({ error: '动态不存在' });

  db.prepare('INSERT INTO moments_comments (moment_id, author, content) VALUES (?, ?, ?)').run(
    req.params.id,
    'user',
    content.trim()
  );

  // AI实时自动回复这条评论
  try {
    const persona = db.prepare('SELECT * FROM persona WHERE id = 1').get();
    const allComments = db
      .prepare('SELECT * FROM moments_comments WHERE moment_id = ? ORDER BY created_at ASC')
      .all(req.params.id);
    const history = allComments
      .map((c) => `${c.author === 'ai' ? persona.ai_name : persona.user_name}: ${c.content}`)
      .join('\n');

    const systemPrompt =
      buildPersonaPrompt() +
      `\n\n这是${moment.owner === 'ai' ? '你发布' : '对方发布'}的一条朋友圈动态："${moment.content}"。` +
      '现在对方在评论区发来了新评论，请结合动态归属和评论记录自然地回一句话，符合你的人设，只输出回复内容本身。';

    const reply = await chatCompletion([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `评论区对话记录：\n${history}` },
    ], null, {signal:AbortSignal.timeout(30000)});

    if (typeof reply === 'string' && reply.trim() && db.prepare('SELECT id FROM moments WHERE id = ?').get(req.params.id)) db.prepare('INSERT INTO moments_comments (moment_id, author, content) VALUES (?, ?, ?)').run(
      req.params.id,
      'ai',
      reply.trim()
    );
  } catch (err) {
    console.error('[朋友圈] AI自动回复评论失败:', err.message);
  }

  const current = db.prepare('SELECT * FROM moments WHERE id = ?').get(req.params.id);
  if (!current) return res.status(404).json({error:'动态已被删除'});
  res.json(withDetails(current));
}));

// 个性签名
router.get('/bio', (req, res) => {
  res.json(db.prepare('SELECT * FROM moments_profile WHERE id = 1').get());
});

router.put('/bio', (req, res) => {
  const { user_bio, ai_bio } = req.body || {};
  db.prepare(
    'UPDATE moments_profile SET user_bio = COALESCE(@user_bio, user_bio), ai_bio = COALESCE(@ai_bio, ai_bio) WHERE id = 1'
  ).run({ user_bio: user_bio ?? null, ai_bio: ai_bio ?? null });
  res.json(db.prepare('SELECT * FROM moments_profile WHERE id = 1').get());
});

// 获取单条动态详情（含点赞列表和评论列表）
router.get('/:id', (req, res) => {
  const moment = db.prepare('SELECT * FROM moments WHERE id = ?').get(req.params.id);
  if (!moment) return res.status(404).json({ error: '动态不存在' });
  var detail = withDetails(moment);
  var comments = db.prepare('SELECT * FROM moments_comments WHERE moment_id = ? ORDER BY created_at ASC').all(req.params.id);
  detail.comments = comments.map(function(c) {
    return { id: c.id, author: c.author, content: c.content, created_at: c.created_at };
  });
  res.json({ moment: detail });
});

module.exports = router;
