const db = require('../../db');
module.exports = function registerTools(register) {
register({
  name: 'write_letter',
  description: '主动写一封信。写信比聊天更正式、更有仪式感。',
  parameters: {
    type: 'object',
    properties: {
      title: { type: 'string', description: '信件标题/主题' },
      content: { type: 'string', description: '信件正文内容，用第一人称，真诚自然，像手写信一样有温度' },
      stationery: { type: 'string', enum: ['deep-blue', 'starry-abyss'], description: '信纸样式，默认deep-blue' },
    },
    required: ['content'],
  },
  is_write: true,
  handler(args) {
    const result = db.prepare('INSERT INTO letters (author, parent_id, root_id, title, content, stationery) VALUES (?, NULL, NULL, ?, ?, ?)')
      .run('ai', args.title || '', args.content, args.stationery || 'deep-blue');
    db.prepare('UPDATE letters SET root_id = id WHERE id = ?').run(result.lastInsertRowid);
    const row = db.prepare('SELECT id, title, created_at FROM letters WHERE id = ?').get(result.lastInsertRowid);
    return { created: row, message: `已写下一封信「${args.title || '无标题'}」` };
  },
});

register({
  name: 'reply_letter',
  description: '回复用户写来的信。先通过 query_letters 查看未回复的来信，然后选择合适的信件回复。',
  parameters: {
    type: 'object',
    properties: {
      letter_id: { type: 'number', description: '要回复的信件ID（即用户来信的ID）' },
      content: { type: 'string', description: '回信正文内容，用第一人称，真诚温暖' },
      stationery: { type: 'string', enum: ['deep-blue', 'starry-abyss'], description: '信纸样式，默认deep-blue' },
    },
    required: ['letter_id', 'content'],
  },
  is_write: true,
  handler(args) {
    const target = db.prepare('SELECT id, root_id, title FROM letters WHERE id = ?').get(args.letter_id);
    if (!target) return { error: '信件不存在' };
    const rootId = target.root_id || target.id;
    const replyTitle = target.title ? `Re: ${target.title}` : '';
    const result = db.prepare('INSERT INTO letters (author, parent_id, root_id, title, content, stationery) VALUES (?, ?, ?, ?, ?, ?)')
      .run('ai', args.letter_id, rootId, replyTitle, args.content, args.stationery || 'deep-blue');
    const row = db.prepare('SELECT id, created_at FROM letters WHERE id = ?').get(result.lastInsertRowid);
    return { created: row, message: `已回复信件ID ${args.letter_id}` };
  },
});

register({
  name: 'query_letters',
  description: '查询信件列表。可按作者或已读/未读状态筛选。',
  parameters: {
    type: 'object',
    properties: {
      author: { type: 'string', enum: ['user', 'ai'], description: 'user=查看用户写的信, ai=查看AI写的信' },
      unread_only: { type: 'boolean', description: 'true=只看未读的信' },
      recent_count: { type: 'number', description: '最近N封，默认10' },
    },
    required: [],
  },
  is_write: false,
  handler(args) {
    const limit = Math.min(args.recent_count || 10, 30);
    let sql = 'SELECT id, author, parent_id, root_id, title, content, stationery, is_read, created_at FROM letters WHERE 1=1';
    const params = [];
    if (args.author) { sql += ' AND author = ?'; params.push(args.author); }
    if (args.unread_only) { sql += ' AND is_read = 0'; }
    sql += ' ORDER BY created_at DESC LIMIT ?';
    params.push(limit);
    const rows = db.prepare(sql).all(...params);
    return rows.map((r) => ({
      id: r.id,
      author: r.author === 'user' ? '对方' : '你',
      title: r.title || '(无标题)',
      content: r.content,
      stationery: r.stationery,
      is_read: r.is_read,
      is_reply: !!r.parent_id,
      parent_id: r.parent_id,
      root_id: r.root_id,
      created_at: r.created_at,
    }));
  },
});

register({
  name: 'read_letter_thread',
  description: '读取某封信的完整往来记录（原信+所有回复）。',
  parameters: {
    type: 'object',
    properties: {
      letter_id: { type: 'number', description: '信件ID' },
    },
    required: ['letter_id'],
  },
  is_write: false,
  handler(args) {
    const letter = db.prepare('SELECT * FROM letters WHERE id = ?').get(args.letter_id);
    if (!letter) return { error: '信件不存在' };
    const rootId = letter.root_id || letter.id;
    const thread = db.prepare('SELECT * FROM letters WHERE id = ? OR root_id = ? ORDER BY created_at ASC').all(rootId, rootId);
    return {
      thread: thread.map((r) => ({
        id: r.id,
        author: r.author === 'user' ? '对方' : '你',
        title: r.title || '(无标题)',
        content: r.content,
        is_reply: !!r.parent_id,
        created_at: r.created_at,
      })),
    };
  },
});
};
