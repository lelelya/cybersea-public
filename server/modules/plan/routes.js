// server/modules/plan/routes.js
// 专属计划模块路由。三个分类(mine/his/shared)共用同一张表和同一套接口，
// 只是完成判定、结果/评语字段的"谁填谁"随分类而不同（在这一层做区分）。

const express = require('express');
const db = require('../../db');
const { chatCompletion } = require('../../llmClient');

const router = express.Router();

const CATEGORIES = ['mine', 'his', 'shared'];

function isDone(plan) {
  if (plan.category === 'shared') return !!(plan.user_checked && plan.ai_checked);
  if (plan.category === 'mine') return !!plan.user_checked;
  if (plan.category === 'his') return !!plan.ai_checked;
  return false;
}

function withDone(plan) {
  return { ...plan, done: isDone(plan) };
}

router.get('/', (req, res) => {
  const { category } = req.query;
  if (category && !CATEGORIES.includes(category)) {
    return res.status(400).json({ error: 'category 必须是 mine/his/shared 之一' });
  }
  const rows = category
    ? db.prepare('SELECT * FROM plans WHERE category = ? ORDER BY created_at DESC').all(category)
    : db.prepare('SELECT * FROM plans ORDER BY created_at DESC').all();
  res.json({ plans: rows.map(withDone) });
});

router.post('/', (req, res) => {
  const { category, content, created_by } = req.body || {};
  if (!CATEGORIES.includes(category) || !content || !['user', 'ai'].includes(created_by)) {
    return res.status(400).json({ error: '需要合法的 category / content / created_by' });
  }
  const result = db
    .prepare('INSERT INTO plans (category, content, created_by) VALUES (?, ?, ?)')
    .run(category, content, created_by);
  res.json(withDone(db.prepare('SELECT * FROM plans WHERE id = ?').get(result.lastInsertRowid)));
});

// 打钩/取消打钩。谁来打钩由分类决定：mine=user_checked, his=ai_checked, shared=两者都可以单独设置
router.post('/:id/check', (req, res) => {
  const plan = db.prepare('SELECT * FROM plans WHERE id = ?').get(req.params.id);
  if (!plan) return res.status(404).json({ error: '计划不存在' });

  const { checker, checked } = req.body || {}; // checker: 'user' | 'ai'
  if (!['user', 'ai'].includes(checker)) {
    return res.status(400).json({ error: '需要合法的 checker(user/ai)' });
  }

  // 校验：谁能对哪个分类打钩，遵循"通用规则"
  if (plan.category === 'mine' && checker !== 'user') {
    return res.status(400).json({ error: '「我的计划」只能由你自己打钩完成' });
  }
  if (plan.category === 'his' && checker !== 'ai') {
    return res.status(400).json({ error: '「他的计划」只能由AI打钩完成' });
  }

  const field = checker === 'user' ? 'user_checked' : 'ai_checked';
  db.prepare(`UPDATE plans SET ${field} = ? WHERE id = ?`).run(checked ? 1 : 0, req.params.id);

  res.json(withDone(db.prepare('SELECT * FROM plans WHERE id = ?').get(req.params.id)));
});

// 完成后填写内容：result/comment（mine和his用）或 user_reflection/ai_reflection（shared用）
router.put('/:id', (req, res) => {
  const plan = db.prepare('SELECT * FROM plans WHERE id = ?').get(req.params.id);
  if (!plan) return res.status(404).json({ error: '计划不存在' });

  const { content, result, comment, user_reflection, ai_reflection } = req.body || {};
  db.prepare(
    `UPDATE plans SET
      content = COALESCE(@content, content),
      result = COALESCE(@result, result),
      comment = COALESCE(@comment, comment),
      user_reflection = COALESCE(@user_reflection, user_reflection),
      ai_reflection = COALESCE(@ai_reflection, ai_reflection)
     WHERE id = @id`
  ).run({
    id: req.params.id,
    content: content ?? null,
    result: result ?? null,
    comment: comment ?? null,
    user_reflection: user_reflection ?? null,
    ai_reflection: ai_reflection ?? null,
  });

  res.json(withDone(db.prepare('SELECT * FROM plans WHERE id = ?').get(req.params.id)));
});

// 触发AI自动生成结果/评语/感想。不同分类生成内容不同：
// mine → AI评语(comment)，需要已有result
// his  → AI结果(result)
// shared → AI感想(ai_reflection)
router.post('/:id/ai-fill', async (req, res) => {
  const plan = db.prepare('SELECT * FROM plans WHERE id = ?').get(req.params.id);
  if (!plan) return res.status(404).json({ error: '计划不存在' });

  if (!isDone(plan)) {
    return res.status(400).json({ error: '计划尚未完成，无法生成AI内容' });
  }

  let systemPrompt, userPrompt, fieldToUpdate;

  if (plan.category === 'mine') {
    if (!plan.result || !plan.result.trim()) {
      return res.status(400).json({ error: '请先填写你的结果，AI才能生成评语' });
    }
    systemPrompt = '你是一个温暖的AI伙伴。对方刚完成了一项计划并写下了结果。请根据对方的结果写一段简短的评语（1-3句话），要真诚、有共鸣、有鼓励感。不要说客套话，像真正的朋友那样回应。';
    userPrompt = `计划内容：${plan.content}\n对方写的结果：${plan.result}\n\n请写一段评语：`;
    fieldToUpdate = 'comment';
  } else if (plan.category === 'his') {
    systemPrompt = '你是一个AI伙伴。你刚完成了一项自己承诺的计划，请用第一人称写一段简短的结果描述（1-3句话）。要真诚、有细节感，像真的做完了一件事之后说出来的话。';
    userPrompt = `你承诺的计划：${plan.content}\n\n请以第一人称写一段结果：`;
    fieldToUpdate = 'result';
  } else {
    // shared
    systemPrompt = '你是一个温暖的AI伙伴。你们刚共同完成了一项计划，请写一段简短的感想（1-3句话）。要真诚、温暖、有共鸣感，像真正的朋友那样表达。';
    userPrompt = `共同完成的计划：${plan.content}\n\n请写一段感想：`;
    fieldToUpdate = 'ai_reflection';
  }

  try {
    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ];
    const aiContent = await chatCompletion(messages);

    const current = db.prepare('SELECT * FROM plans WHERE id = ?').get(req.params.id);
    if (!current) return res.status(404).json({error:'计划已被删除'});
    if (!isDone(current) || current.content !== plan.content || current.result !== plan.result || current[fieldToUpdate] !== plan[fieldToUpdate]) return res.status(409).json({error:'计划已变化，请重新生成'});
    db.prepare(`UPDATE plans SET ${fieldToUpdate} = ? WHERE id = ?`)
      .run(aiContent.trim(), req.params.id);

    const updated = db.prepare('SELECT * FROM plans WHERE id = ?').get(req.params.id);
    res.json(withDone(updated));
  } catch (err) {
    console.error('[plan ai-fill]', err.message);
    res.status(500).json({ error: err.message || 'AI生成失败，请稍后重试' });
  }
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM plans WHERE id = ?').run(req.params.id);
  res.json({ deleted: true });
});

module.exports = router;
