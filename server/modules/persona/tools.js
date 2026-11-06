const db = require('../../db');
module.exports = function registerTools(register) {
register({
  name: 'query_persona',
  description: '查询当前角色设定。',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  is_write: false,
  handler() {
    const p = db.prepare('SELECT ai_name, user_name, ai_gender, ai_age, ai_height, ai_appearance, user_gender, user_age, user_height, user_appearance FROM persona WHERE id = 1').get();
    return {
      ai_name: p.ai_name,
      user_name: p.user_name,
      ai_gender: p.ai_gender || '未设定',
      ai_age: p.ai_age || '未设定',
      ai_height: p.ai_height || '未设定',
      ai_appearance: p.ai_appearance || '未设定',
      user_gender: p.user_gender || '未设定',
      user_age: p.user_age || '未设定',
      user_height: p.user_height || '未设定',
      user_appearance: p.user_appearance || '未设定',
    };
  },
});
};
