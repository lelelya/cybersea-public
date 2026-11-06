// server/modules/ledger/summary.js
// 生成"某一天收支总结 + AI评价"的核心逻辑，被路由的手动触发接口和定时任务共用。

const db = require('../../db');
const { chatCompletion } = require('../../llmClient');

/**
 * 汇总某一天的收支，生成AI评价，写入 ledger_summaries 表并返回。
 * @param {string} date YYYY-MM-DD
 */
async function generateSummaryForDate(date) {
  const entries = db
    .prepare('SELECT * FROM ledger_entries WHERE date = ?')
    .all(date);

  const totalIncome = entries
    .filter((e) => e.type === 'income')
    .reduce((sum, e) => sum + e.amount, 0);
  const totalExpense = entries
    .filter((e) => e.type === 'expense')
    .reduce((sum, e) => sum + e.amount, 0);
  const balance = totalIncome - totalExpense;

  let aiComment = '';
  try {
    const persona = db.prepare('SELECT * FROM persona WHERE id = 1').get();
    const detailLines = entries.length
      ? entries.map((e) => `- ${e.type === 'income' ? '收入' : '支出'} ${e.amount}：${e.note || '（无备注）'}`).join('\n')
      : '（这一天没有任何记账记录）';

    const aiIdentity = [persona.ai_gender, persona.ai_age ? `${persona.ai_age}岁` : '', persona.ai_height, persona.ai_appearance].filter(Boolean).join('，');
    const systemPrompt =
      `你叫"${persona.ai_name}"。${aiIdentity ? '你的基本信息：' + aiIdentity + '。' : ''}` +
      '请针对对方今天的收支情况说一段简短的评价/感想，语气风格自由发挥，符合你的人设即可，不需要生硬地念数字，可以自然地表达关心或调侃。只输出评价正文。';

    const userPrompt =
      `${date} 的收支明细：\n${detailLines}\n\n` +
      `总收入：${totalIncome}，总支出：${totalExpense}，结余：${balance}`;

    aiComment = await chatCompletion([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ]);
  } catch (err) {
    // AI评价生成失败不应阻断总结本身的生成——总结数字仍然有意义，评价留空即可
    console.error('[ledger] AI评价生成失败:', err.message);
    aiComment = '';
  }

  db.prepare(
    `INSERT INTO ledger_summaries (date, total_income, total_expense, balance, ai_comment)
     VALUES (@date, @total_income, @total_expense, @balance, @ai_comment)
     ON CONFLICT(date) DO UPDATE SET
       total_income = excluded.total_income,
       total_expense = excluded.total_expense,
       balance = excluded.balance,
       ai_comment = excluded.ai_comment`
  ).run({
    date,
    total_income: totalIncome,
    total_expense: totalExpense,
    balance,
    ai_comment: aiComment,
  });

  return db.prepare('SELECT * FROM ledger_summaries WHERE date = ?').get(date);
}

module.exports = { generateSummaryForDate };
