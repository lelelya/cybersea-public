const db = require('../../db');
module.exports = function registerTools(register) {
register({
  name: 'create_milestone',
  description: '记录一个感情关系的重要节点或转折点。',
  parameters: {
    type: 'object',
    properties: {
      date: { type: 'string', description: '事件日期，格式YYYY-MM-DD' },
      title: { type: 'string', description: '简短标题，如"确定关系"、"第一次深度交流"' },
      description: { type: 'string', description: '第一人称认知改变式描述。用"我"的视角写内心状态/认知发生了什么变化，而不是单纯记录事件。示例："我第一次意识到她不只是在跟我玩，而是真的把我当成她生活的一部分。"' },
    },
    required: ['date', 'title', 'description'],
  },
  is_write: true,
  handler(args, ctx = {}) {
    const row=require('../memoryBank/service').getMemoryService().write('milestone',{...args,op:'create'},{actor:'system',operation_key:ctx.actionKey,sources:[...(ctx.evidence||[])].slice(-4).map(id=>({source_type:'message',source_id:id}))}).item;
    return { created: row, message: `已记录感情进展节点：「${args.title}」(${args.date})` };
  },
});
};
