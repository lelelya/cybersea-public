// server/modules/calendar/routes.js
// 日历模块 API — events + todos

const express = require('express');
const db = require('../../db');

const router = express.Router();
const {dateValid,validateDates} = require('../../utils/dates');
const DATE_RE = {test:dateValid};

// ==================== Events ====================

// GET /api/calendar/events?date=YYYY-MM-DD  或  ?start=YYYY-MM-DD&end=YYYY-MM-DD
router.get('/events', (req, res) => {
  try {
    const { date, start, end } = req.query;
    let rows;
    if (date && DATE_RE.test(date)) {
      rows = db.prepare('SELECT * FROM events WHERE date = ? ORDER BY start_time ASC, id ASC').all(date);
    } else if (start && end && DATE_RE.test(start) && DATE_RE.test(end)) {
      rows = db.prepare('SELECT * FROM events WHERE date >= ? AND date <= ? ORDER BY date ASC, start_time ASC, id ASC').all(start, end);
    } else {
      return res.status(400).json({ error: '需要 date 或 start+end 参数' });
    }
    res.json({ events: rows });
  } catch (err) {
    console.error('[calendar] GET events 失败:', err.message);
    res.status(err.status || 500).json({ error: err.status ? err.message : '获取日程失败' });
  }
});

// POST /api/calendar/events
router.post('/events', (req, res) => {
  try {
    const { date, start_time, end_time, title, note, remind } = req.body || {};
    validateDates(req.body || {}, ['date'], ['start_time','end_time']);
    if (!date || !DATE_RE.test(date)) return res.status(400).json({ error: 'date 格式 YYYY-MM-DD' });
    if (!title || !title.trim()) return res.status(400).json({ error: 'title 必填' });

    const result = db.prepare(
      'INSERT INTO events (date, start_time, end_time, title, note, remind) VALUES (?,?,?,?,?,?)'
    ).run(date, start_time || null, end_time || null, title.trim(), (note || '').trim(), remind ? 1 : 0);

    const row = db.prepare('SELECT * FROM events WHERE id = ?').get(result.lastInsertRowid);
    res.json({ event: row });
  } catch (err) {
    console.error('[calendar] POST event 失败:', err.message);
    res.status(err.status || 500).json({ error: err.status ? err.message : '创建日程失败' });
  }
});

// PUT /api/calendar/events/:id
router.put('/events/:id', (req, res) => {
  try {
    const { id } = req.params;
    if (req.body?.date !== undefined && !dateValid(req.body.date)) return res.status(400).json({ error: 'date 必须是有效的 YYYY-MM-DD' });
    validateDates(req.body || {}, [], ['start_time', 'end_time']);
    const existing = db.prepare('SELECT * FROM events WHERE id = ?').get(id);
    if (!existing) return res.status(404).json({ error: '日程不存在' });

    const fields = ['date','start_time','end_time','title','note','remind'];
    const sets = [];
    const vals = {};
    for (const f of fields) {
      if (req.body && req.body[f] !== undefined) {
        sets.push(`${f} = @${f}`);
        vals[f] = f === 'remind' ? (req.body[f] ? 1 : 0) : (req.body[f] || '');
      }
    }
    if (!sets.length) return res.status(400).json({ error: '无更新字段' });

    sets.push("updated_at = datetime('now', 'localtime')");
    vals.id = id;
    db.prepare(`UPDATE events SET ${sets.join(', ')} WHERE id = @id`).run(vals);

    const row = db.prepare('SELECT * FROM events WHERE id = ?').get(id);
    res.json({ event: row });
  } catch (err) {
    console.error('[calendar] PUT event 失败:', err.message);
    res.status(err.status || 500).json({ error: err.status ? err.message : '更新日程失败' });
  }
});

// DELETE /api/calendar/events/:id
router.delete('/events/:id', (req, res) => {
  try {
    const { id } = req.params;
    const existing = db.prepare('SELECT * FROM events WHERE id = ?').get(id);
    if (!existing) return res.status(404).json({ error: '日程不存在' });
    db.prepare('DELETE FROM events WHERE id = ?').run(id);
    res.json({ deleted: true });
  } catch (err) {
    console.error('[calendar] DELETE event 失败:', err.message);
    res.status(err.status || 500).json({ error: err.status ? err.message : '删除日程失败' });
  }
});

// ==================== Todos ====================

// GET /api/calendar/todos?due_before=YYYY-MM-DD
router.get('/todos', (req, res) => {
  try {
    const { due_before } = req.query;
    let rows;
    if (due_before && DATE_RE.test(due_before)) {
      rows = db.prepare(
        "SELECT * FROM todos WHERE completed = 0 AND (due_date <= ? OR due_date IS NULL) ORDER BY due_date ASC, id ASC"
      ).all(due_before);
    } else {
      rows = db.prepare('SELECT * FROM todos ORDER BY completed ASC, due_date ASC, id ASC').all();
    }
    res.json({ todos: rows });
  } catch (err) {
    console.error('[calendar] GET todos 失败:', err.message);
    res.status(err.status || 500).json({ error: err.status ? err.message : '获取待办失败' });
  }
});

// POST /api/calendar/todos
router.post('/todos', (req, res) => {
  try {
    const { title, start_date, due_date } = req.body || {};
    validateDates(req.body || {}, ['start_date','due_date']);
    if (!title || !title.trim()) return res.status(400).json({ error: 'title 必填' });

    const result = db.prepare(
      'INSERT INTO todos (title, start_date, due_date) VALUES (?,?,?)'
    ).run(title.trim(), start_date || null, due_date || null);

    const row = db.prepare('SELECT * FROM todos WHERE id = ?').get(result.lastInsertRowid);
    res.json({ todo: row });
  } catch (err) {
    console.error('[calendar] POST todo 失败:', err.message);
    res.status(err.status || 500).json({ error: err.status ? err.message : '创建待办失败' });
  }
});

// PUT /api/calendar/todos/:id
router.put('/todos/:id', (req, res) => {
  try {
    const { id } = req.params;
    validateDates(req.body || {}, ['start_date', 'due_date']);
    const existing = db.prepare('SELECT * FROM todos WHERE id = ?').get(id);
    if (!existing) return res.status(404).json({ error: '待办不存在' });

    const fields = ['title','start_date','due_date','completed'];
    const sets = [];
    const vals = {};
    for (const f of fields) {
      if (req.body && req.body[f] !== undefined) {
        sets.push(`${f} = @${f}`);
        vals[f] = f === 'completed' ? (req.body[f] ? 1 : 0) : (req.body[f] || '');
      }
    }
    if (!sets.length) return res.status(400).json({ error: '无更新字段' });

    sets.push("updated_at = datetime('now', 'localtime')");
    vals.id = id;
    db.prepare(`UPDATE todos SET ${sets.join(', ')} WHERE id = @id`).run(vals);

    const row = db.prepare('SELECT * FROM todos WHERE id = ?').get(id);
    res.json({ todo: row });
  } catch (err) {
    console.error('[calendar] PUT todo 失败:', err.message);
    res.status(err.status || 500).json({ error: err.status ? err.message : '更新待办失败' });
  }
});

// DELETE /api/calendar/todos/:id
router.delete('/todos/:id', (req, res) => {
  try {
    const { id } = req.params;
    const existing = db.prepare('SELECT * FROM todos WHERE id = ?').get(id);
    if (!existing) return res.status(404).json({ error: '待办不存在' });
    db.prepare('DELETE FROM todos WHERE id = ?').run(id);
    res.json({ deleted: true });
  } catch (err) {
    console.error('[calendar] DELETE todo 失败:', err.message);
    res.status(err.status || 500).json({ error: err.status ? err.message : '删除待办失败' });
  }
});

module.exports = router;
