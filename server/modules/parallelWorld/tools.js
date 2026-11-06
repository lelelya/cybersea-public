const db = require('../../db');
module.exports = function registerTools(register) {
register({
  name: 'query_story_saves',
  description: '查询平行世界（文字冒险游戏）的剧情存档列表。可查看所有存档或某个特定存档的剧情节点摘要。',
  parameters: {
    type: 'object',
    properties: {
      save_id: { type: 'number', description: '指定存档ID查详情，不传则列出所有存档' },
    },
    required: [],
  },
  is_write: false,
  handler(args) {
    // 兼容新旧两种数据格式
    function worldLabel(ws) {
      if (ws.description) return ws.description.slice(0, 30) + (ws.description.length > 30 ? '...' : '');
      return ws.era || ws.background || '未命名世界';
    }
    function charLabel(c) {
      if (c.description) return c.description.slice(0, 20) + (c.description.length > 20 ? '...' : '');
      return c.name || '他/我';
    }

    if (args.save_id) {
      const save = db.prepare('SELECT * FROM story_saves WHERE id = ?').get(args.save_id);
      if (!save) return { error: '存档不存在' };

      const nodes = db.prepare(
        'SELECT node_index, narration, his_words, my_description, user_choice, user_free_input, created_at FROM story_nodes WHERE save_id = ? ORDER BY node_index ASC'
      ).all(args.save_id);

      const aiChar = JSON.parse(save.ai_character || '{}');
      const userChar = JSON.parse(save.user_character || '{}');
      const worldSetting = JSON.parse(save.world_setting || '{}');

      return {
        save: {
          id: save.id,
          world_label: worldLabel(worldSetting),
          ai_name: charLabel(aiChar),
          user_name: charLabel(userChar),
          status: save.status === 'ongoing' ? '进行中' : '已完结',
          ending_name: save.ending_name || '',
          created_at: save.created_at,
          updated_at: save.updated_at,
        },
        nodes: nodes.map((n) => ({
          node_index: n.node_index,
          summary: n.his_words.slice(0, 60) + (n.his_words.length > 60 ? '...' : ''),
          user_choice: n.user_choice || n.user_free_input || '',
        })),
        total_nodes: nodes.length,
      };
    }

    // 列出所有存档
    const saves = db.prepare('SELECT * FROM story_saves ORDER BY updated_at DESC').all();
    return {
      saves: saves.map((s) => {
        const aiChar = JSON.parse(s.ai_character || '{}');
        const worldSetting = JSON.parse(s.world_setting || '{}');
        const nodeCount = db.prepare('SELECT COUNT(*) as c FROM story_nodes WHERE save_id = ?').get(s.id).c;
        return {
          id: s.id,
          world_label: worldLabel(worldSetting),
          ai_name: charLabel(aiChar),
          status: s.status === 'ongoing' ? '进行中' : '已完结',
          ending_name: s.ending_name || '',
          node_count: nodeCount,
          created_at: s.created_at,
        };
      }),
      total_saves: saves.length,
    };
  },
});
};
