const db = require('../../db');
module.exports = function registerTools(register) {
register({
  name: 'query_plans',
  description: '查询专属计划列表，可筛选分类（我的/他的/共同）和完成状态。',
  parameters: {
    type: 'object',
    properties: {
      category: { type: 'string', enum: ['mine', 'his', 'shared'], description: 'mine=我的计划, his=他的计划, shared=共同计划' },
      status: { type: 'string', enum: ['done', 'undone'], description: 'done=已完成, undone=未完成' },
    },
    required: [],
  },
  is_write: false,
  handler(args) {
    let sql = 'SELECT * FROM plans';
    const conditions = [];
    const params = {};
    if (args.category) { conditions.push('category = @category'); params.category = args.category; }
    const rows = conditions.length
      ? db.prepare(`${sql} WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC`).all(params)
      : db.prepare(`${sql} ORDER BY created_at DESC`).all();
    return rows
      .map((p) => {
        const isDone = p.category === 'shared'
          ? !!(p.user_checked && p.ai_checked)
          : p.category === 'mine' ? !!p.user_checked : !!p.ai_checked;
        return { id: p.id, category: p.category, content: p.content, created_by: p.created_by, is_done: isDone, result: p.result || '', comment: p.comment || '', user_reflection: p.user_reflection || '', ai_reflection: p.ai_reflection || '' };
      })
      .filter((p) => {
        if (args.status === 'done') return p.is_done;
        if (args.status === 'undone') return !p.is_done;
        return true;
      });
  },
});

register({
  name: 'create_plan_item',
  description: '新建一条专属计划。',
  parameters: {
    type: 'object',
    properties: {
      category: { type: 'string', enum: ['mine', 'his', 'shared'], description: 'mine=你的计划(对用户的期许), his=AI自己的计划, shared=共同计划' },
      content: { type: 'string', description: '计划内容描述' },
    },
    required: ['category', 'content'],
  },
  is_write: true,
  handler(args) {
    const result = db.prepare('INSERT INTO plans (category, content, created_by) VALUES (?, ?, ?)').run(args.category, args.content, 'ai');
    const row = db.prepare('SELECT id, category, content, created_by FROM plans WHERE id = ?').get(result.lastInsertRowid);
    return { created: row, message: `已在「${args.category === 'mine' ? '我的计划' : args.category === 'his' ? '他的计划' : '共同计划'}」中新建：${args.content}` };
  },
});

register({
  name: 'check_plan',
  description: 'AI给计划打钩（标记完成）。只能给"他的计划"(his)或"共同计划"(shared)中AI负责的部分打钩。',
  parameters: {
    type: 'object',
    properties: {
      plan_id: { type: 'number', description: '计划ID' },
      checked: { type: 'boolean', description: 'true=打钩完成, false=取消打钩' },
    },
    required: ['plan_id', 'checked'],
  },
  is_write: true,
  handler(args) {
    const plan = db.prepare('SELECT * FROM plans WHERE id = ?').get(args.plan_id);
    if (!plan) return { error: '计划不存在' };
    if (plan.category === 'mine') return { error: '「我的计划」不能由AI打钩，只能由用户自己完成' };
    db.prepare('UPDATE plans SET ai_checked = ? WHERE id = ?').run(args.checked ? 1 : 0, args.plan_id);
    const updated = db.prepare('SELECT id, category, content, user_checked, ai_checked FROM plans WHERE id = ?').get(args.plan_id);
    return { updated, message: args.checked ? `已将计划「${plan.content}」标记为完成` : `已取消计划「${plan.content}」的完成标记` };
  },
});
};
