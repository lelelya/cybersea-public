const db = require('../../db');
module.exports = function registerTools(register) {
register({
  name: 'create_story',
  description: '创建一个睡前故事并保存。',
  parameters: {
    type: 'object',
    properties: {
      title: { type: 'string', description: '故事标题' },
      content: { type: 'string', description: '故事完整内容，可以较长' },
    },
    required: ['title', 'content'],
  },
  is_write: true,
  handler(args) {
    const result = db.prepare(
      'INSERT INTO stories (title, content) VALUES (?, ?)'
    ).run(args.title, args.content);
    const row = db.prepare('SELECT id, title, created_at FROM stories WHERE id = ?')
      .get(result.lastInsertRowid);
    return { created: row, message: '已创建睡前故事「' + args.title + '」，已保存到睡前故事中。' };
  },
});
};
