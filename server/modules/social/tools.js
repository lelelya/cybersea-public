const db = require('../../db');
module.exports = function registerTools(register) {
register({
  name: 'update_profile',
  description: '修改社交资料（昵称或个性签名）。可以只改其中一个。',
  parameters: {
    type: 'object',
    properties: {
      nickname: { type: 'string', description: '新昵称，不传则不改' },
      signature: { type: 'string', description: '新个性签名，不传则不改' },
    },
    required: [],
  },
  is_write: true,
  handler(args) {
    if (!args.nickname && !args.signature) {
      return { error: '至少需要 nickname 或 signature 之一' };
    }
    const sets = [];
    const vals = [];
    if (args.nickname) { sets.push('nickname = ?'); vals.push(args.nickname); }
    if (args.signature) { sets.push('signature = ?'); vals.push(args.signature); }
    sets.push("updated_at = datetime('now', 'localtime')");
    vals.push('ai');
    db.prepare(`UPDATE social_profile SET ${sets.join(', ')} WHERE owner = ?`).run(...vals);
    const row = db.prepare("SELECT * FROM social_profile WHERE owner = 'ai'").get();
    return { updated: row, message: args.nickname ? `昵称已更新为「${args.nickname}」` : '签名已更新' };
  },
});
};
