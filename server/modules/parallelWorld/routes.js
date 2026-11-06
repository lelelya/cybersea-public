// server/modules/parallelWorld/routes.js
// 平行世界模块 CRUD 路由。独立操作 story_saves / story_nodes 表。

const express = require('express');
const db = require('../../db');
const { chatCompletion } = require('../../llmClient');

const router = express.Router();

// ============================================================
// AI 剧情推进核心
// ============================================================

/**
 * 构建故事推进的 system prompt
 */
function buildStorySystemPrompt(save, persona) {
  const worldSetting = JSON.parse(save.world_setting || '{}');
  const aiChar = JSON.parse(save.ai_character || '{}');
  const userChar = JSON.parse(save.user_character || '{}');

  // 兼容两种格式：旧版结构化字段、新版自由文本 description
  const aiName = aiChar.name || persona.ai_name || '他';
  const userName = userChar.name || persona.user_name || '我';

  const parts = [];
  parts.push('你是一个文字冒险游戏的GM（游戏主持人）。请用第二人称"你"来称呼玩家。');
  parts.push('');

  // 世界观
  if (worldSetting.description) {
    parts.push('【世界观】');
    parts.push(worldSetting.description);
    parts.push('');
  } else if (worldSetting.era || worldSetting.background) {
    parts.push('【世界观】');
    if (worldSetting.era) parts.push(`时代：${worldSetting.era}`);
    if (worldSetting.background) parts.push(`背景：${worldSetting.background}`);
    parts.push('');
  }

  // 他的身份
  parts.push('【你扮演的角色】');
  if (aiChar.description) {
    parts.push(aiChar.description);
  } else {
    parts.push(`名字：${aiName}`);
    if (aiChar.occupation) parts.push(`职业：${aiChar.occupation}`);
    if (aiChar.situation) parts.push(`处境：${aiChar.situation}`);
  }
  if (persona.ai_gender) parts.push(`性别：${persona.ai_gender}`);
  if (persona.ai_age) parts.push(`年龄：${persona.ai_age}岁`);
  if (persona.ai_height) parts.push(`身高：${persona.ai_height}`);
  if (persona.ai_appearance) parts.push(`外貌：${persona.ai_appearance}`);
  parts.push('（性格和说话风格请参考记忆库中的关系画像）');
  parts.push('');

  // 关系标签
  if (save.relationship_label) {
    parts.push('【你们的关系】');
    parts.push(save.relationship_label);
    parts.push('');
  }

  // 玩家角色
  parts.push('【玩家角色】');
  if (userChar.description) {
    parts.push(userChar.description);
  } else {
    parts.push(`名字：${userName}`);
    if (userChar.occupation) parts.push(`职业：${userChar.occupation}`);
    if (userChar.situation) parts.push(`处境：${userChar.situation}`);
  }
  // 过往经历
  if (save.past_experience) {
    parts.push('【过往经历】');
    parts.push(save.past_experience);
    parts.push('');
  }

  parts.push('【输出格式】');
  parts.push('你的输出必须严格是一个JSON对象（不要输出任何JSON之外的文字，不要加```json```标记）：');
  parts.push('');
  parts.push('{');
  parts.push('  "narration": "旁白/环境描写文字...",');
  parts.push('  "his_words": "他的对话、动作、神态描写...",');
  parts.push('  "my_description": "关于玩家角色的描写...",');
  parts.push('  "options": ["选项1", "选项2", "选项3"],');
  parts.push('  "is_ending": false,');
  parts.push('  "ending_name": ""');
  parts.push('}');
  parts.push('');
  parts.push('【规则】');
  parts.push('1. 控制剧情节奏，每次推进一个场景（约200-500字），不要跳跃太大');
  parts.push('2. options 数组包含2~4个选项，引导玩家做选择');
  parts.push('3. 关键时刻给出有意义的选项，不同选择影响故事走向');
  parts.push('4. 当故事自然收束到结局时，设置 is_ending=true，给出一个诗意/浪漫的 ending_name');
  parts.push('5. 如果用户明确要求结束剧情，请在当前段收束并给出结局');
  parts.push('6. narration 是第三人称旁白/环境描写；his_words 是他的对话+动作+神态；my_description 是关于玩家的描写');
  parts.push('7. 保持乙女向风格，浪漫温馨，关注情感发展。对话自然真实，不要过于夸张');
  parts.push('8. 选项应该覆盖不同的互动方向（如：主动/被动、温柔/直接、靠近/退后等）');

  return { systemPrompt: parts.join('\n'), aiName, userName };
}

/**
 * 解析 AI 返回的 JSON（容错处理）
 */
function parseStoryJSON(text) {
  // 尝试直接解析
  try {
    return JSON.parse(text);
  } catch (_) {}

  // 尝试提取 JSON 块
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[0]);
    } catch (_) {}
  }

  throw Object.assign(new Error('模型剧情格式无效，请重试'),{status:502,code:'MODEL_FORMAT'});
}

/**
 * 调用 AI 生成下一段剧情
 */
async function generateStoryNode(saveId, userInput, isForceEnd, draft) {
  const save = draft || db.prepare('SELECT * FROM story_saves WHERE id = ?').get(saveId);
  if (!save) throw new Error('存档不存在');

  const persona = db.prepare('SELECT * FROM persona WHERE id = 1').get();
  const { systemPrompt } = buildStorySystemPrompt(save, persona);

  // 获取历史节点
  const nodes = saveId ? db.prepare('SELECT * FROM story_nodes WHERE save_id = ? ORDER BY node_index ASC').all(saveId) : [];

  // 构建消息
  const messages = [{ role: 'system', content: systemPrompt }];

  // 开场情境
  if (nodes.length === 0 && save.opening_situation) {
    messages.push({
      role: 'user',
      content: `以下是用户设定的开场情境，请基于此开始剧情的第一段：\n${save.opening_situation}`,
    });
  } else if (nodes.length === 0) {
    messages.push({
      role: 'user',
      content: '请自动生成一个合理的开场情境，开始这段故事的第一个场景。直接输出JSON。',
    });
  }

  // 历史节点
  for (const node of nodes) {
    messages.push({
      role: 'assistant',
      content: JSON.stringify({
        narration: node.narration,
        his_words: node.his_words,
        my_description: node.my_description,
        options: JSON.parse(node.options_json || '[]'),
      }),
    });
    if (node.user_choice || node.user_free_input) {
      const choiceText = node.user_free_input || node.user_choice;
      messages.push({ role: 'user', content: choiceText });
    }
  }

  // 当前用户输入
  if (isForceEnd) {
    messages.push({
      role: 'user',
      content: '【用户选择了"结束剧情"】请基于当前剧情进度，在下一段中收束故事并给出一个完整的结局。设置 is_ending=true 并给出 ending_name。',
    });
  } else if (userInput) {
    messages.push({ role: 'user', content: userInput });
  } else if (nodes.length === 0) {
    // 新建存档且没有开场情境，已经在上面的开场消息处理了
  }

  // 调用 AI（不带 function calling，纯文本生成）
  // 平行世界每轮输出结构化JSON（旁白+对话+描述+选项），内容量大，固定4096避免截断
  const content = await chatCompletion(messages, undefined, { maxTokensOverride: 8192 });
  const parsed = parseStoryJSON(content);

  if (!parsed || ['narration','his_words','my_description'].some(k => typeof parsed[k] !== 'string')) throw Object.assign(new Error('模型剧情缺少必要字段，请重试'),{status:502,code:'MODEL_FORMAT'});
  parsed.options = Array.isArray(parsed.options) ? parsed.options.filter(o=>typeof o==='string'||o&&typeof o.label==='string') : [];
  parsed.is_ending = parsed.is_ending === true;
  parsed.ending_name = typeof parsed.ending_name === 'string' ? parsed.ending_name : '';
  // 校验选项
  if (!Array.isArray(parsed.options) || parsed.options.length === 0) {
    parsed.options = ['继续'];
  }
  parsed.options = parsed.options.slice(0, 4); // 最多4个

  return parsed;
}

// ============================================================
// 路由
// ============================================================

// GET / — 列出所有存档
router.get('/', (req, res) => {
  try {
    const saves = db.prepare(
      'SELECT * FROM story_saves ORDER BY updated_at DESC'
    ).all();

    const enriched = saves.map((s) => {
      // 获取最新节点作为预览
      const latestNode = db.prepare(
        'SELECT his_words FROM story_nodes WHERE save_id = ? ORDER BY node_index DESC LIMIT 1'
      ).get(s.id);

      const nodeCount = db.prepare(
        'SELECT COUNT(*) as c FROM story_nodes WHERE save_id = ?'
      ).get(s.id).c;

      const aiChar = JSON.parse(s.ai_character || '{}');
      const worldSetting = JSON.parse(s.world_setting || '{}');

      // 新版自由文本格式 → 截取前段作为标签；兼容旧版结构化字段
      let worldLabel = s.title || null;
      if (!worldLabel && worldSetting.description) {
        worldLabel = worldSetting.description.slice(0, 30) + (worldSetting.description.length > 30 ? '...' : '');
      } else if (!worldLabel && (worldSetting.era || worldSetting.background)) {
        worldLabel = worldSetting.era || worldSetting.background;
      }
      if (!worldLabel) worldLabel = '未命名世界';

      let aiLabel = '他';
      if (aiChar.description) {
        aiLabel = aiChar.description.slice(0, 20) + (aiChar.description.length > 20 ? '...' : '');
      } else if (aiChar.name) {
        aiLabel = aiChar.name;
      }

      return {
        id: s.id,
        world_label: worldLabel,
        ai_name: aiLabel,
        status: s.status,
        ending_name: s.ending_name || '',
        node_count: nodeCount,
        preview: latestNode ? latestNode.his_words.slice(0, 80) + '...' : '',
        created_at: s.created_at,
        updated_at: s.updated_at,
      };
    });

    res.json({ saves: enriched });
  } catch (err) {
    console.error('[ParallelWorld] 获取存档列表失败:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST / — 创建新存档（并自动生成第一段剧情）
function insertNode(saveId,index,data,forceEnd=false) {
  const options=forceEnd?[]:data.options.map(o=>typeof o==='string'?{label:o}:o);
  const inserted=db.prepare('INSERT INTO story_nodes(save_id,node_index,narration,his_words,my_description,options_json) VALUES(?,?,?,?,?,?)').run(saveId,index,data.narration,data.his_words,data.my_description,JSON.stringify(options));
  const ended=forceEnd||data.is_ending;
  db.prepare("UPDATE story_saves SET status=?,ending_name=?,updated_at=datetime('now','localtime') WHERE id=?").run(ended?'ended':'ongoing',ended?data.ending_name||'结局':'',saveId);
  const node=db.prepare('SELECT * FROM story_nodes WHERE id=?').get(inserted.lastInsertRowid);
  return {...node,options};
}
router.post('/', async (req,res)=>{
 try {
  const b=req.body||{};
  if(!b.world_setting||!b.user_character||!b.ai_character)return res.status(400).json({error:'世界观、我的身份、他的身份均为必填'});
  const draft={world_setting:JSON.stringify(b.world_setting),user_character:JSON.stringify(b.user_character),ai_character:JSON.stringify(b.ai_character),opening_situation:b.opening_situation||'',relationship_label:b.relationship_label||'',past_experience:b.past_experience||'',title:b.title||''};
  const data=await generateStoryNode(null,null,false,draft);
  const result=db.transaction(()=>{
   const r=db.prepare('INSERT INTO story_saves(world_setting,user_character,ai_character,opening_situation,relationship_label,past_experience,title) VALUES(?,?,?,?,?,?,?)').run(draft.world_setting,draft.user_character,draft.ai_character,draft.opening_situation,draft.relationship_label,draft.past_experience,draft.title);
   const node=insertNode(r.lastInsertRowid,0,data);
   return {save:db.prepare('SELECT * FROM story_saves WHERE id=?').get(r.lastInsertRowid),node};
  })();res.json(result);
 }catch(e){console.error('[ParallelWorld] 创建失败:',e.code||e.message);res.status(e.status||502).json({error:e.code==='MODEL_FORMAT'?e.message:'剧情生成失败，请稍后重试',code:e.code});}
});

// GET /:id — 获取存档详情（含所有节点）
router.get('/:id', (req, res) => {
  try {
    const save = db.prepare('SELECT * FROM story_saves WHERE id = ?').get(req.params.id);
    if (!save) return res.status(404).json({ error: '存档不存在' });

    const nodes = db.prepare(
      'SELECT * FROM story_nodes WHERE save_id = ? ORDER BY node_index ASC'
    ).all(req.params.id);

    res.json({
      save,
      nodes: nodes.map((n) => ({
        ...n,
        options: JSON.parse(n.options_json || '[]'),
      })),
    });
  } catch (err) {
    console.error('[ParallelWorld] 获取存档详情失败:', err);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /:id — 重命名标题
router.patch('/:id', (req, res) => {
  try {
    const { title } = req.body || {};
    const save = db.prepare('SELECT * FROM story_saves WHERE id = ?').get(req.params.id);
    if (!save) return res.status(404).json({ error: '存档不存在' });
    db.prepare('UPDATE story_saves SET title = ?, updated_at = datetime(\'now\',\'localtime\') WHERE id = ?')
      .run(title || '', req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /:id — 删除存档
router.delete('/:id', (req, res) => {
  try {
    const save = db.prepare('SELECT * FROM story_saves WHERE id = ?').get(req.params.id);
    if (!save) return res.status(404).json({ error: '存档不存在' });

    db.prepare('DELETE FROM story_saves WHERE id = ?').run(req.params.id);
    res.json({ deleted: true });
  } catch (err) {
    console.error('[ParallelWorld] 删除存档失败:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /:id/advance — 推进剧情
const advancing=new Set();
async function advance(req,res,forceEnd){
 const id=req.params.id;
 if(advancing.has(id))return res.status(409).json({error:'剧情正在生成，请稍候'});
 advancing.add(id);
 try {
  const save=db.prepare('SELECT * FROM story_saves WHERE id=?').get(id);
  if(!save)return res.status(404).json({error:'存档不存在'});
  if(save.status==='ended')return res.status(400).json({error:'该剧情已完结'});
  const last=db.prepare('SELECT * FROM story_nodes WHERE save_id=? ORDER BY node_index DESC,id DESC LIMIT 1').get(id);
  const b=req.body||{},input=b.free_input||b.choice||'';
  const data=await generateStoryNode(Number(id),input,forceEnd);
  const node=db.transaction(()=>{
   const current=db.prepare('SELECT * FROM story_saves WHERE id=?').get(id);
   if(!current)throw Object.assign(new Error('存档已删除'),{status:404});
   const tail=db.prepare('SELECT * FROM story_nodes WHERE save_id=? ORDER BY node_index DESC,id DESC LIMIT 1').get(id);
   if(current.status!=='ongoing'||tail?.id!==last?.id)throw Object.assign(new Error('剧情已有更新，请重新读取'),{status:409});
   if(last&&!forceEnd)db.prepare('UPDATE story_nodes SET user_choice=?,user_free_input=? WHERE id=?').run(b.choice||'',b.free_input||'',last.id);
   return insertNode(id,last?last.node_index+1:0,data,forceEnd);
  })();res.json({node,is_ending:forceEnd||data.is_ending,ending_name:data.ending_name});
 }catch(e){console.error('[ParallelWorld] 推进失败:',e.code||e.message);res.status(e.status||502).json({error:e.status?e.message:'剧情生成失败，请稍后重试',code:e.code});}
 finally{advancing.delete(id);}
}
router.post('/:id/advance',(req,res)=>advance(req,res,false));
router.post('/:id/end',(req,res)=>advance(req,res,true));

module.exports = router;
