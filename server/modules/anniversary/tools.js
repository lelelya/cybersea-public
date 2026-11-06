const db = require('../../db');
const {dateValid}=require('../../utils/dates');
module.exports = function registerTools(register) {
register({
  name: 'query_anniversaries',
  description: '查询所有纪念日列表，包含名称、日期、已过去天数。',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  is_write: false,
  handler() {
    const rows = db.prepare('SELECT id, name, date, subtitle FROM anniversaries ORDER BY date ASC').all();
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const MS_PER_DAY = 24 * 60 * 60 * 1000;
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      date: r.date,
      subtitle: r.subtitle || '',
      days_passed: Math.max(0, Math.floor((today - new Date(r.date + 'T00:00:00')) / MS_PER_DAY)),
    }));
  },
});

register({
  name: 'create_anniversary',
  description: '创建一个新的纪念日。',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: '纪念日名称，如"第一次见面"' },
      date: { type: 'string', description: '日期，格式YYYY-MM-DD' },
      subtitle: { type: 'string', description: '副标题/备注，可选' },
    },
    required: ['name', 'date'],
  },
  is_write: true,
  handler(args) {
    if (!dateValid(args.date)) return {error:'日期必须是有效的 YYYY-MM-DD'};
    const result = db.prepare('INSERT INTO anniversaries (name, date, subtitle) VALUES (?, ?, ?)').run(args.name, args.date, args.subtitle || '');
    const row = db.prepare('SELECT id, name, date, subtitle FROM anniversaries WHERE id = ?').get(result.lastInsertRowid);
    return { created: row, message: `已创建纪念日「${args.name}」，日期${args.date}` };
  },
});
};
