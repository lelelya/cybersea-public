// server/modules/moments/trigger.js
// 朋友圈的"AI主动行为"触发逻辑：
// maybeReactToMoment —— 你发了一条动态后，AI以一定概率点赞/评论。
//
// 注意：AI 主动发朋友圈（post_moment）不再在这里随机触发，
// 改由聊天里的 post_moment FC 工具由 AI 自主决定何时调用（与写信 write_letter 一致）。

const db = require('../../db');
const { chatCompletion } = require('../../llmClient');

const REACT_TO_USER_MOMENT_PROBABILITY = 0.7; // 你发动态后AI点赞/评论的概率

function personaOf() {
  return db.prepare('SELECT * FROM persona WHERE id = 1').get();
}

/**
 * 拼装 AI 的完整人设描述：基本信息 + 固定设定 + 记忆库关系画像（性格/关系/说话风格）。
 * 与聊天 system prompt 保持一致，避免生成"不符合人设"的动态/评论。
 * 供本模块内部及 routes.js（评论回复）复用。
 */
function buildPersonaPrompt() {
  const persona = personaOf();
  const aiIdentity = [persona.ai_gender, persona.ai_age ? `${persona.ai_age}岁` : '', persona.ai_height, persona.ai_appearance].filter(Boolean).join('，');
  const parts = [];
  parts.push(`你叫"${persona.ai_name}"。${aiIdentity ? '你的基本信息：' + aiIdentity + '。' : ''}`);

  // 固定设定
  const fixedSettings = JSON.parse(persona.fixed_settings || '[]');
  if (fixedSettings.length > 0) {
    parts.push('【关于你和对方的关系，你需要记住】');
    fixedSettings.forEach(s => {
      const text = typeof s === 'string' ? s : (s.value || s.key || '');
      if (text) parts.push(`- ${text}`);
    });
  }

  const memoryContext=require('../../chat/contextBuilder').buildMemoryContext({persona,channel:'moment',query:'我们的关系、表达方式和最近的相处'});
  if(memoryContext.snippet)parts.push(memoryContext.snippet);
  return parts.join('\n');
}

/**
 * 你发了一条新动态后调用，AI以一定概率点赞和/或评论。
 */
async function maybeReactToMoment(momentId) {
  if (Math.random() >= REACT_TO_USER_MOMENT_PROBABILITY) return;

  const moment = db.prepare('SELECT * FROM moments WHERE id = ?').get(momentId);
  if (!moment) return;

  // 点赞
  db.prepare('INSERT OR IGNORE INTO moments_likes (moment_id, author) VALUES (?, ?)').run(momentId, 'ai');

  // 评论（再单独判断一次，不是每次点赞都评论）
  if (Math.random() < 0.6) {
    const systemPrompt =
      buildPersonaPrompt() +
      '\n\n对方刚刚发了一条朋友圈动态，请你评论一句，符合你的人设，只输出评论内容本身。';

    const comment = await chatCompletion([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `对方发的动态："${moment.content}"` },
    ], null, {signal:AbortSignal.timeout(30000)});

    if (typeof comment === 'string' && comment.trim() && db.prepare('SELECT id FROM moments WHERE id = ?').get(momentId)) db.prepare('INSERT INTO moments_comments (moment_id, author, content) VALUES (?, ?, ?)').run(
      momentId,
      'ai',
      comment.trim()
    );
  }
}

module.exports = { maybeReactToMoment, buildPersonaPrompt };
