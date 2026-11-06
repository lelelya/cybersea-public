const db = require('../../db');
const {validateDates,dateValid}=require('../../utils/dates');
module.exports = function registerTools(register) {
register({
  name: 'query_events',
  description: '查询某一天或某个日期范围内的日程安排。',
  parameters: {
    type: 'object',
    properties: {
      date: { type: 'string', description: '查询某一天，格式YYYY-MM-DD' },
      start: { type: 'string', description: '范围起始日期，格式YYYY-MM-DD' },
      end: { type: 'string', description: '范围结束日期，格式YYYY-MM-DD' },
    },
    required: [],
  },
  is_write: false,
  handler(args) {
    validateDates(args, ['date', 'start', 'end']);
    let rows;
    if (args.date) {
      rows = db.prepare('SELECT * FROM events WHERE date = ? ORDER BY start_time ASC').all(args.date);
    } else if (args.start && args.end) {
      rows = db.prepare('SELECT * FROM events WHERE date >= ? AND date <= ? ORDER BY date ASC, start_time ASC').all(args.start, args.end);
    } else {
      const today = new Date();
      const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      rows = db.prepare('SELECT * FROM events WHERE date = ? ORDER BY start_time ASC').all(dateStr);
    }
    return rows.map(e => ({
      id: e.id, date: e.date, start_time: e.start_time || '', end_time: e.end_time || '',
      title: e.title, note: e.note || '', remind: !!e.remind,
    }));
  },
});

register({
  name: 'add_event',
  description: '新建一个日程安排。',
  parameters: {
    type: 'object',
    properties: {
      date: { type: 'string', description: '日期，格式YYYY-MM-DD' },
      start_time: { type: 'string', description: '开始时间，格式HH:MM，全天事件可不传' },
      end_time: { type: 'string', description: '结束时间，格式HH:MM，可选' },
      title: { type: 'string', description: '日程标题' },
      note: { type: 'string', description: '备注，可选' },
    },
    required: ['date', 'title'],
  },
  is_write: true,
  handler(args) {
    if (!dateValid(args.date)) return {error:'日期必须是有效的 YYYY-MM-DD'};
    validateDates(args, [], ['start_time', 'end_time']);
    const result = db.prepare(
      'INSERT INTO events (date, start_time, end_time, title, note) VALUES (?,?,?,?,?)'
    ).run(args.date, args.start_time || null, args.end_time || null, args.title, args.note || '');
    const row = db.prepare('SELECT * FROM events WHERE id = ?').get(result.lastInsertRowid);
    return { created: row, message: `已添加日程「${args.title}」(${args.date})` };
  },
});

register({
  name: 'update_event',
  description: '修改已有的日程安排。',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'number', description: '日程ID' },
      date: { type: 'string', description: '新日期' },
      start_time: { type: 'string', description: '新开始时间' },
      end_time: { type: 'string', description: '新结束时间' },
      title: { type: 'string', description: '新标题' },
      note: { type: 'string', description: '新备注' },
    },
    required: ['id'],
  },
  is_write: true,
  handler(args) {
    if (args.date !== undefined && !dateValid(args.date)) return {error:'日期必须是有效的 YYYY-MM-DD'};
    validateDates(args, [], ['start_time', 'end_time']);
    const existing = db.prepare('SELECT * FROM events WHERE id = ?').get(args.id);
    if (!existing) return { error: '日程不存在' };
    const fields = ['date','start_time','end_time','title','note'];
    const sets = []; const vals = {};
    for (const f of fields) {
      if (args[f] !== undefined) { sets.push(f + '=@' + f); vals[f] = args[f] || ''; }
    }
    if (!sets.length) return { error: '无更新字段' };
    sets.push("updated_at = datetime('now','localtime')");
    vals.id = args.id;
    db.prepare('UPDATE events SET ' + sets.join(',') + ' WHERE id=@id').run(vals);
    const row = db.prepare('SELECT * FROM events WHERE id = ?').get(args.id);
    return { updated: row, message: `已更新日程「${row.title}」` };
  },
});

register({
  name: 'delete_event',
  description: '删除一个日程。',
  parameters: {
    type: 'object',
    properties: { id: { type: 'number', description: '日程ID' } },
    required: ['id'],
  },
  is_write: true,
  handler(args) {
    const existing = db.prepare('SELECT * FROM events WHERE id = ?').get(args.id);
    if (!existing) return { error: '日程不存在' };
    db.prepare('DELETE FROM events WHERE id = ?').run(args.id);
    return { deleted: true, message: `已删除日程「${existing.title}」` };
  },
});

register({
  name: 'add_todo',
  description: '新建一个待办事项。',
  parameters: {
    type: 'object',
    properties: {
      title: { type: 'string', description: '待办内容' },
      start_date: { type: 'string', description: '开始日期，格式YYYY-MM-DD，可选' },
      due_date: { type: 'string', description: '截止日期，格式YYYY-MM-DD，可选' },
    },
    required: ['title'],
  },
  is_write: true,
  handler(args) {
    validateDates(args, ['start_date', 'due_date']);
    const result = db.prepare(
      'INSERT INTO todos (title, start_date, due_date) VALUES (?,?,?)'
    ).run(args.title, args.start_date || null, args.due_date || null);
    const row = db.prepare('SELECT * FROM todos WHERE id = ?').get(result.lastInsertRowid);
    return { created: row, message: `已添加待办「${args.title}」` };
  },
});

register({
  name: 'update_todo',
  description: '修改待办事项（含标记完成）。completed=1表示完成。',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'number', description: '待办ID' },
      title: { type: 'string', description: '新内容' },
      due_date: { type: 'string', description: '新截止日期' },
      completed: { type: 'number', description: '1=已完成, 0=未完成' },
    },
    required: ['id'],
  },
  is_write: true,
  handler(args) {
    validateDates(args, ['start_date', 'due_date']);
    const existing = db.prepare('SELECT * FROM todos WHERE id = ?').get(args.id);
    if (!existing) return { error: '待办不存在' };
    const fields = ['title','start_date','due_date','completed'];
    const sets = []; const vals = {};
    for (const f of fields) {
      if (args[f] !== undefined) { sets.push(f + '=@' + f); vals[f] = f === 'completed' ? (args[f] ? 1 : 0) : (args[f] || ''); }
    }
    if (!sets.length) return { error: '无更新字段' };
    sets.push("updated_at = datetime('now','localtime')");
    vals.id = args.id;
    db.prepare('UPDATE todos SET ' + sets.join(',') + ' WHERE id=@id').run(vals);
    const row = db.prepare('SELECT * FROM todos WHERE id = ?').get(args.id);
    return { updated: row, message: args.completed ? `已完成待办「${row.title}」` : `已更新待办「${row.title}」` };
  },
});

register({
  name: 'delete_todo',
  description: '删除一个待办。',
  parameters: {
    type: 'object',
    properties: { id: { type: 'number', description: '待办ID' } },
    required: ['id'],
  },
  is_write: true,
  handler(args) {
    const existing = db.prepare('SELECT * FROM todos WHERE id = ?').get(args.id);
    if (!existing) return { error: '待办不存在' };
    db.prepare('DELETE FROM todos WHERE id = ?').run(args.id);
    return { deleted: true, message: `已删除待办「${existing.title}」` };
  },
});
};
