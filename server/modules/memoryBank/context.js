const {estimate,fail}=require('./constants');
const {normalize}=require('./messageNormalizer');
function createContext(api){
  function recentMessages({beforeMessageId=Number.MAX_SAFE_INTEGER,limit=200}={}) {
    const rows=api.db.prepare("SELECT * FROM messages WHERE id<? AND memory_scope='main' AND memory_origin NOT IN ('import','call_transcript','notification') AND type NOT IN ('tool_notification','home_env') ORDER BY id DESC LIMIT ?").all(beforeMessageId,Math.min(limit,500));
    return rows.map(r=>normalize(r)).filter(Boolean).reverse();
  }
  function buildContext({channel='chat',query='',beforeMessageId,currentMessageId,budget={},now=api.clock()}={}) {
    const s=api.settings(),all=api.db.prepare("SELECT * FROM memory_profile_items WHERE scope='main' AND status='active' AND (valid_until IS NULL OR valid_until>?) ORDER BY sort_order,id").all(now.toISOString());
    const coreItems=all.filter(x=>x.pinned||x.kind==='commitment');
    const milestones=api.db.prepare("SELECT * FROM relationship_milestones WHERE scope='main' AND status='active' AND pinned=1 ORDER BY date,id").all();
    const format=(type,x)=>`[${type} ${x.id} v${x.revision}${x.section_key?' '+x.section_key:''}] ${x.date||''}\n${x.title||''}${x.content||x.description||''}`;
    const core=[...coreItems.map(x=>format('profile_item',x)),...milestones.map(x=>format('milestone',x))].join('\n\n');
    let history=recentMessages({beforeMessageId:beforeMessageId||currentMessageId||Number.MAX_SAFE_INTEGER});
    const scale=channel==='moment'?.35:channel==='proactive'?.5:1;
    const reserved=(budget.outputReserve||0)+(budget.tools||s.tool_result_budget_tokens)+(budget.fixedInput||0)+Math.ceil((budget.hardWindow||s.context_window_tokens||0)*.08);
    const hard=budget.hardWindow||s.context_window_tokens;
    const available=hard?hard-reserved:Infinity;
    if(estimate(core)>available)fail('CONTEXT_BUDGET_EXCEEDED','核心记忆超过模型窗口，请调整固定内容或窗口配置',400);
    const recentCap=Math.min((budget.recent||s.recent_budget_tokens)*scale,available-estimate(core));
    let used=0;history=history.reverse().filter(m=>{const n=estimate(m.content)+12;if(used+n>recentCap)return false;used+=n;return true;}).reverse();
    const candidates=[],seen=new Set(coreItems.map(x=>`profile_item:${x.id}`).concat(milestones.map(x=>`milestone:${x.id}`)));
    const words=String(query).match(/[\p{Script=Han}]{2,12}|[\p{L}\p{N}_]{2,}/gu)||[];
    const queries=[String(query).slice(0,100),...words.slice(0,5)].filter(Boolean);
    for(const q of queries)for(const r of api.searchMemories({query:q,limit:30}).items)if(!seen.has(`${r.type}:${r.id}`)){seen.add(`${r.type}:${r.id}`);candidates.push(r);}
    // Keep recent state available even when the current utterance has no useful search words.
    for(const item of all.filter(x=>x.kind==='state'))if(!seen.has(`profile_item:${item.id}`)){seen.add(`profile_item:${item.id}`);candidates.push({type:'profile_item',item,id:item.id});}
    const memoryCap=Math.max(0,Math.min((budget.memory||s.memory_budget_tokens)*scale,available-used-estimate(core)));
    const recalled=[];let memoryUsed=0;
    for(const c of candidates.slice(0,30)){const text=format(c.type,c.item),n=estimate(text);if(recalled.length<8&&memoryUsed+n<=memoryCap){recalled.push({...c,text});memoryUsed+=n;}}
    const refs=[...coreItems.map(item=>({type:'profile_item',id:item.id,revision:item.revision})),...recalled.map(r=>({type:r.type,id:r.id,revision:r.item.revision}))];
    return {core,state:'',recalled:recalled.map(r=>r.text).join('\n\n'),recentMessages:history,refs,usage:{estimated:true,core:estimate(core),recent:used,recalled:memoryUsed},truncated:history.length<200||recalled.length<candidates.length,warnings:hard?[]:['模型窗口未配置，长度使用估算']};
  }
  return {recentMessages,buildContext};
}
function fitToolMessages(messages,functions,{hardWindow,outputReserve=4096,resultBudget=3000}={}){
  const result=messages.map(m=>({...m}));
  for(const m of result)if(m.role==='function'&&estimate(m.content)>resultBudget)m.content=JSON.stringify({truncated:true,note:'工具结果较长，请缩小范围或分页查询',preview:String(m.content).slice(0,Math.max(100,resultBudget)),has_more:true});
  if(hardWindow){
    const total=()=>estimate(result)+estimate(functions)+outputReserve+Math.ceil(hardWindow*.08);
    while(total()>hardWindow){const index=result.findIndex((m,i)=>i>0&&i!==result.findLastIndex(x=>x.role==='user')&&m.role!=='system'&&m.role!=='function'&&!m.function_call&&i<result.length-1);if(index<0)fail('CONTEXT_BUDGET_EXCEEDED','当前对话和工具超出模型窗口，请缩小查询范围');result.splice(index,1);}
  }
  return result;
}
module.exports={createContext,fitToolMessages};
