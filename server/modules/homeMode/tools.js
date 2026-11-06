const db = require('../../db');
module.exports = function registerTools(register) {
register({
  name: 'update_home_description',
  description: '更新"家"的基本情况描述。家的描述应该是自然语言，列出家中的物品、布局、氛围等，用于生成环境描写。',
  parameters: {
    type: 'object',
    properties: {
      description: { type: 'string', description: '更新后的家描述全文（会完全替换旧内容），用自然语言描述家中的物品、布局和氛围' },
    },
    required: ['description'],
  },
  is_write: true,
  handler(args) {
    const desc = (args.description || '').trim();
    if (!desc) return { error: '家描述不能为空' };
    db.prepare('UPDATE app_config SET home_description = ? WHERE id = 1').run(desc);
    return { updated: true, home_description: desc, message: '已更新家的描述。' };
  },
});
};
