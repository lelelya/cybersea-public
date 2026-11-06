const db = require('../../db');
module.exports = function registerTools(register) {
register({
  name: 'read_diary',
  description: '读取用户某一天的日记内容。',
  parameters: {
    type: 'object',
    properties: {
      date: { type: 'string', description: '日记日期，格式YYYY-MM-DD' },
    },
    required: ['date'],
  },
  is_write: false,
  handler(args) {
    const row = db.prepare("SELECT * FROM diaries WHERE owner = 'user' AND date = ?").get(args.date);
    if (!row || !row.content) {
      return { found: false, date: args.date, message: `没有找到${args.date}的日记。` };
    }
    return {
      found: true,
      date: row.date,
      content: row.content,
      weather: row.weather || '',
    };
  },
});

register({
  name: 'annotate_diary',
  description: '在用户的日记上添加批画标记（红圈/波浪线/双横线/单横线），可附带批注文字。',
  parameters: {
    type: 'object',
    properties: {
      date: { type: 'string', description: '日记日期，格式YYYY-MM-DD' },
      selected_text: { type: 'string', description: '要标记的原文片段，必须和日记中出现的文本完全一致' },
      mark_type: { type: 'string', enum: ['circle', 'wavy', 'double_line', 'single_line'], description: '标记类型：circle=红圈, wavy=波浪线, double_line=双横线, single_line=单横线' },
      note: { type: 'string', description: '批注文字，可选。写你想对这段话的评语或感受。' },
    },
    required: ['date', 'selected_text', 'mark_type'],
  },
  is_write: true,
  handler(args) {
    const row = db.prepare("SELECT * FROM diaries WHERE owner = 'user' AND date = ?").get(args.date);
    if (!row || !row.content) {
      return { error: `没有找到${args.date}的日记，无法批画。` };
    }
    if (!row.content.includes(args.selected_text)) {
      return { error: '选中的文本在日记中未找到，请检查文本是否完全一致。' };
    }
    const result = db.prepare(
      "INSERT INTO annotations (source_type, source_id, annotator, selected_text, mark_type, note) VALUES ('diary_user', ?, 'ai', ?, ?, ?)"
    ).run(args.date, args.selected_text, args.mark_type, args.note || '');
    const annotation = db.prepare('SELECT * FROM annotations WHERE id = ?').get(result.lastInsertRowid);
    return {
      created: annotation,
      message: `已在${args.date}的日记中标记了一处${args.mark_type === 'circle' ? '红圈' : args.mark_type === 'wavy' ? '波浪线' : '双横线'}批画${args.note ? '，附注：「' + args.note + '」' : ''}。`,
    };
  },
});
};
