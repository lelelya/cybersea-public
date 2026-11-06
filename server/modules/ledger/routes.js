// server/modules/ledger/routes.js
// 记账本模块的CRUD路由 + 每日总结查询/手动触发。
// 只操作 ledger_entries / ledger_summaries 两张表。

const express = require('express');
const db = require('../../db');
const { generateSummaryForDate } = require('./summary');

const router = express.Router();

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function todayStr() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

// 列出某个月的记账记录（默认当月）
router.get('/', (req, res) => {
  const { year, month } = req.query;
  let prefix;
  if (year && month) {
    prefix = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
  } else {
    prefix = todayStr().slice(0, 7);
  }
  const rows = db
    .prepare('SELECT * FROM ledger_entries WHERE date LIKE ? ORDER BY date ASC, id ASC')
    .all(`${prefix}%`);
  res.json({ entries: rows });
});

router.post('/', (req, res) => {
  const { amount, type, subType, note, date } = req.body || {};
  if (typeof amount !== 'number' || !['income', 'expense'].includes(type)) {
    return res.status(400).json({ error: '缺少或非法的 amount/type 字段' });
  }
  const entryDate = date && DATE_RE.test(date) ? date : todayStr();

  const result = db
    .prepare('INSERT INTO ledger_entries (amount, type, sub_type, note, date) VALUES (?, ?, ?, ?, ?)')
    .run(amount, type, subType || '', note || '', entryDate);
  const row = db.prepare('SELECT * FROM ledger_entries WHERE id = ?').get(result.lastInsertRowid);
  res.json(row);
});

router.put('/:id', (req, res) => {
  const { id } = req.params;
  const existing = db.prepare('SELECT * FROM ledger_entries WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: '记录不存在' });

  const { amount, type, subType, note, date } = req.body || {};
  db.prepare(
    `UPDATE ledger_entries SET
      amount = COALESCE(@amount, amount),
      type = COALESCE(@type, type),
      sub_type = COALESCE(@subType, sub_type),
      note = COALESCE(@note, note),
      date = COALESCE(@date, date)
     WHERE id = @id`
  ).run({
    id,
    amount: typeof amount === 'number' ? amount : null,
    type: type ?? null,
    subType: subType ?? null,
    note: note ?? null,
    date: date ?? null,
  });

  const row = db.prepare('SELECT * FROM ledger_entries WHERE id = ?').get(id);
  res.json(row);
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM ledger_entries WHERE id = ?').run(req.params.id);
  res.json({ deleted: true });
});

// 获取某一天的总结（如果当天总结还没生成，返回 null，不强行现算——总结只在定时任务/手动触发时生成）
router.get('/summary/:date', (req, res) => {
  const { date } = req.params;
  if (!DATE_RE.test(date)) {
    return res.status(400).json({ error: '日期格式应为 YYYY-MM-DD' });
  }
  const row = db.prepare('SELECT * FROM ledger_summaries WHERE date = ?').get(date);
  res.json(row || null);
});

// 手动触发生成某一天的总结（正常情况下由每日零点的定时任务自动调用，这里留一个手动入口方便测试/补生成）
router.post('/summary/:date/generate', async (req, res) => {
  const { date } = req.params;
  if (!DATE_RE.test(date)) {
    return res.status(400).json({ error: '日期格式应为 YYYY-MM-DD' });
  }
  try {
    const summary = await generateSummaryForDate(date);
    res.json(summary);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || '总结生成失败' });
  }
});

module.exports = router;
