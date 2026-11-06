const db = require('../../db');
const { validatePost } = require('./validation');
module.exports = function registerTools(register) {
register({
  name: 'query_recent_moments',
  description: '查询最近N条朋友圈动态概览（含点赞数和评论数）。',
  parameters: {
    type: 'object',
    properties: {
      limit: { type: 'number', description: '返回条数，默认10' },
      owner: { type: 'string', enum: ['user', 'ai'], description: 'user=看用户的, ai=看AI的, 不传=全部' },
    },
    required: [],
  },
  is_write: false,
  handler(args) {
    const limit = Math.min(args.limit || 10, 30);
    let rows;
    if (args.owner) {
      rows = db.prepare('SELECT * FROM moments WHERE owner = ? ORDER BY created_at DESC LIMIT ?').all(args.owner, limit);
    } else {
      rows = db.prepare('SELECT * FROM moments ORDER BY created_at DESC LIMIT ?').all(limit);
    }
    return rows.map((m) => {
      const likeCount = db.prepare('SELECT COUNT(*) as c FROM moments_likes WHERE moment_id = ?').get(m.id).c;
      const commentCount = db.prepare('SELECT COUNT(*) as c FROM moments_comments WHERE moment_id = ?').get(m.id).c;
      return { id: m.id, owner: m.owner === 'user' ? '对方' : '你', content: m.content, image_path: m.image_path || '', created_at: m.created_at, like_count: likeCount, comment_count: commentCount };
    });
  },
});

register({
  name: 'query_moment_detail',
  description: '查看某一条朋友圈动态的完整内容、所有点赞和评论。',
  parameters: {
    type: 'object',
    properties: {
      moment_id: { type: 'number', description: '动态ID' },
    },
    required: ['moment_id'],
  },
  is_write: false,
  handler(args) {
    const m = db.prepare('SELECT * FROM moments WHERE id = ?').get(args.moment_id);
    if (!m) return { error: '动态不存在' };
    const likes = db.prepare('SELECT author FROM moments_likes WHERE moment_id = ?').all(args.moment_id);
    const comments = db.prepare('SELECT author, content, created_at FROM moments_comments WHERE moment_id = ? ORDER BY created_at ASC').all(args.moment_id);
    return { id: m.id, owner: m.owner === 'user' ? '对方' : '你', content: m.content, image_path: m.image_path || '', created_at: m.created_at, likes: likes.map((l) => l.author === 'user' ? '对方' : '你'), comments: comments.map((c) => ({ author: c.author === 'user' ? '对方' : '你', content: c.content, created_at: c.created_at })) };
  },
});

register({
  name: 'post_moment',
  description: '发一条朋友圈动态。可以附带图片。',
  parameters: {
    type: 'object',
    properties: {
      content: { type: 'string', description: '动态正文内容' },
      images: { type: 'array', items: { type: 'string' }, description: '图片URL数组（可选，暂不支持，未来接入图片生成后可用）' },
    },
    required: ['content'],
  },
  is_write: true,
  handler(args) {
    const {content, images} = validatePost(args);
    const imagePath = images.length > 0
      ? JSON.stringify(images)
      : '';
    const result = db.prepare('INSERT INTO moments (owner, content, image_path) VALUES (?, ?, ?)').run('ai', content, imagePath);
    const row = db.prepare('SELECT id, content, image_path, created_at FROM moments WHERE id = ?').get(result.lastInsertRowid);
    return { created: row, message: '已发布朋友圈动态' };
  },
});
};
