const db = require('../../db');
module.exports = function registerTools(register) {
register({
  name: 'query_ledger_entries',
  description: '查询某一天或某个月的收支明细。',
  parameters: {
    type: 'object',
    properties: {
      date: { type: 'string', description: '日期，格式YYYY-MM-DD，查某一天' },
      month: { type: 'string', description: '月份，格式YYYY-MM，查整个月' },
      recent_days: { type: 'number', description: '查最近N天，默认不传' },
    },
    required: [],
  },
  is_write: false,
  handler(args) {
    let rows;
    if (args.date) {
      rows = db.prepare('SELECT id, date, amount, type, sub_type, note FROM ledger_entries WHERE date = ? ORDER BY id ASC').all(args.date);
    } else if (args.month) {
      rows = db.prepare("SELECT id, date, amount, type, sub_type, note FROM ledger_entries WHERE date LIKE ? ORDER BY date ASC, id ASC").all(args.month + '%');
    } else if (args.recent_days) {
      const days = Math.min(args.recent_days, 90);
      rows = db.prepare("SELECT id, date, amount, type, sub_type, note FROM ledger_entries WHERE date >= date('now', 'localtime', ?) ORDER BY date DESC, id DESC").all(`-${days} days`);
    } else {
      rows = db.prepare("SELECT id, date, amount, type, sub_type, note FROM ledger_entries WHERE date >= date('now', 'localtime', '-7 days') ORDER BY date DESC, id DESC").all();
    }
    return rows.map((r) => ({ ...r, type: r.type === 'income' ? '收入' : '支出' }));
  },
});

register({
  name: 'query_ledger_summaries',
  description: '查询某一天或最近N天的收支总结和AI评价。',
  parameters: {
    type: 'object',
    properties: {
      date: { type: 'string', description: '日期，格式YYYY-MM-DD' },
      recent_days: { type: 'number', description: '查最近N天，默认7' },
    },
    required: [],
  },
  is_write: false,
  handler(args) {
    if (args.date) {
      const row = db.prepare('SELECT date, total_income, total_expense, balance, ai_comment FROM ledger_summaries WHERE date = ?').get(args.date);
      return row ? [row] : [];
    }
    const days = Math.min(args.recent_days || 7, 30);
    return db.prepare("SELECT date, total_income, total_expense, balance, ai_comment FROM ledger_summaries WHERE date >= date('now', 'localtime', ?) ORDER BY date DESC").all(`-${days} days`);
  },
});
};
