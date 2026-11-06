// server/modules/anniversary/routes.js
// 纪念日模块的CRUD路由。只操作 anniversaries 表，不涉及其他模块。

const express = require('express');
const db = require('../../db');

const router = express.Router();
const {dateValid}=require('../../utils/dates');

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function daysSince(dateStr) {
  const start = new Date(dateStr + 'T00:00:00');
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.max(0, Math.floor((today - start) / MS_PER_DAY));
}

function withDaysPassed(row) {
  return { ...row, days_passed: daysSince(row.date) };
}

// 列出全部纪念日，按日期从早到晚排序，附带计算好的"已经过去的天数"
router.get('/', (req, res) => {
  const rows = db
    .prepare('SELECT * FROM anniversaries ORDER BY date ASC')
    .all();
  res.json({ anniversaries: rows.map(withDaysPassed) });
});

router.post('/', (req, res) => {
  const { name, date, subtitle } = req.body || {};
  if (!name || !dateValid(date)) {
    return res.status(400).json({ error: '缺少必填字段: name, date' });
  }
  const result = db
    .prepare('INSERT INTO anniversaries (name, date, subtitle) VALUES (?, ?, ?)')
    .run(name, date, subtitle || '');
  const row = db
    .prepare('SELECT * FROM anniversaries WHERE id = ?')
    .get(result.lastInsertRowid);
  res.json(withDaysPassed(row));
});

router.put('/:id', (req, res) => {
  const { id } = req.params;
  const { name, date, subtitle } = req.body || {};

  if (date !== undefined && !dateValid(date)) return res.status(400).json({error:'日期必须是有效的 YYYY-MM-DD'});
  const existing = db.prepare('SELECT * FROM anniversaries WHERE id = ?').get(id);
  if (!existing) {
    return res.status(404).json({ error: '纪念日不存在' });
  }

  db.prepare(
    'UPDATE anniversaries SET name = COALESCE(?, name), date = COALESCE(?, date), subtitle = COALESCE(?, subtitle) WHERE id = ?'
  ).run(name ?? null, date ?? null, subtitle ?? null, id);

  const updated = db.prepare('SELECT * FROM anniversaries WHERE id = ?').get(id);
  res.json(withDaysPassed(updated));
});

router.delete('/:id', (req, res) => {
  const { id } = req.params;
  db.prepare('DELETE FROM anniversaries WHERE id = ?').run(id);
  res.json({ deleted: true });
});

module.exports = router;
