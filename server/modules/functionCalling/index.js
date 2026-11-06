// server/modules/functionCalling/index.js
//
// OpenAI Function Calling 模块
// ─────────────────────────────
// 让 AI 在聊天中按需查询各功能模块数据（11个查询函数），
// 并支持主动写入操作（6个写入函数），所有写入操作自动在记忆库生成
// 第一人称事件日志。
//
// 集成方式：chat.js 在调用 chatCompletion 时传入本模块的函数定义，
// 收到 function_call 后交给本模块 execute() 执行，再把结果发回 AI。
// 对话结束后，chat.js 调用 finalizeWrites() 为所有写入操作生成记忆日志。

const db = require('../../db');
const { chatCompletion } = require('../../llmClient');

// ============================================================
// 函数注册表
// ============================================================
const registry = {};

function register(def) {
  registry[def.name] = def;
}

// ============================================================
// 11 个查询函数 + 6 个写入函数
// ============================================================

// ---- 纪念日 ----

const definitions = new Map();
require('../anniversary/tools')(def => definitions.set(def.name, def));
require('../ledger/tools')(def => definitions.set(def.name, def));
require('../plan/tools')(def => definitions.set(def.name, def));
require('../moments/tools')(def => definitions.set(def.name, def));
require('../calendar/tools')(def => definitions.set(def.name, def));
require('../memoryBank/tools')(def => definitions.set(def.name, def));
require('../milestones/tools')(def => definitions.set(def.name, def));
require('../album/tools')(def => definitions.set(def.name, def));
require('../persona/tools')(def => definitions.set(def.name, def));
require('../letters/tools')(def => definitions.set(def.name, def));
require('../parallelWorld/tools')(def => definitions.set(def.name, def));
require('../social/tools')(def => definitions.set(def.name, def));
require('../voiceCall/tools')(def => definitions.set(def.name, def));
require('../stories/tools')(def => definitions.set(def.name, def));
require('../diary/tools')(def => definitions.set(def.name, def));
require('../economy/tools')(def => definitions.set(def.name, def));
require('../homeMode/tools')(def => definitions.set(def.name, def));
register(definitions.get('query_anniversaries'));
register(definitions.get('query_ledger_entries'));
register(definitions.get('query_ledger_summaries'));
register(definitions.get('query_plans'));
register(definitions.get('query_recent_moments'));
register(definitions.get('query_moment_detail'));
register(definitions.get('query_events'));
register(definitions.get('add_event'));
register(definitions.get('update_event'));
register(definitions.get('delete_event'));
register(definitions.get('add_todo'));
register(definitions.get('update_todo'));
register(definitions.get('delete_todo'));
register(definitions.get('query_memory_events'));
register(definitions.get('query_memory_profile'));
register(definitions.get('read_memory_detail'));
register(definitions.get('propose_profile_change'));
register(definitions.get('create_milestone'));
register(definitions.get('query_album_photos'));
register(definitions.get('query_persona'));
register(definitions.get('create_anniversary'));
register(definitions.get('post_moment'));
register(definitions.get('create_plan_item'));
register(definitions.get('check_plan'));
register(definitions.get('save_album_photo'));
register(definitions.get('send_album_photo'));
register(definitions.get('generate_image'));
register(definitions.get('write_letter'));
register(definitions.get('reply_letter'));
register(definitions.get('query_letters'));
register(definitions.get('read_letter_thread'));
register(definitions.get('query_story_saves'));
register(definitions.get('update_profile'));
register(definitions.get('initiate_call'));
register(definitions.get('create_story'));
register(definitions.get('read_diary'));
register(definitions.get('annotate_diary'));
register(definitions.get('send_red_packet'));
register(definitions.get('send_gift'));
register(definitions.get('send_food_delivery'));
register(definitions.get('update_home_description'));

// ============================================================
// 导出：供 chat.js 使用
// ============================================================

/**
 * 返回 OpenAI Function Calling 格式的函数定义列表。
 */
function getDefinitions() {
  return Object.values(registry).map((def) => ({
    name: def.name,
    description: def.description,
    parameters: def.parameters,
  }));
}

/**
 * 执行一个函数调用，返回结果。
 * @param {string} name 函数名
 * @param {string} arguments JSON字符串参数
 * @returns {Promise<object>} { result, is_write, fn_name, fn_args }
 */
async function execute(name, argumentsJson, executionContext = {}) {
  const def=registry[name];if(!def)return {error:`未知函数: ${name}`};
  let args;try{args=JSON.parse(argumentsJson||'{}');}catch{return {error:'工具参数不是有效JSON',fn_name:name};}
  const service=require('../memoryBank/service').getMemoryService();
  const actionKey=`${executionContext.requestId||require('node:crypto').randomUUID()}:${executionContext.iteration||0}:${name}`;
  const ctx={...executionContext,actionKey};
  const bad=r=>r?.error||r?.success===false;
  const record=r=>service.recordToolAction({actionKey,toolName:name,args,result:r,messageId:ctx.userMessageId,description:'我'+describeCall({fn_name:name,fn_args:args,result:r})+'。'});
  try {
    let result;
    const internal=def.memory_internal||name==='create_milestone';
    const prior=def.is_write&&!internal?db.prepare('SELECT * FROM memory_actions WHERE action_key=?').get(actionKey):null;
    if(prior?.status==='succeeded')return {result:JSON.parse(prior.result_json),is_write:def.is_write,fn_name:name,fn_args:args};
    if(def.is_write&&!internal&&def.handler.constructor.name!=='AsyncFunction'){
      result=db.transaction(()=>{const r=def.handler(args,ctx);if(r?.then)throw Error('同步工具返回了异步任务');if(bad(r))throw Error(r.error||'操作未完成');record(r);return r;})();
    }else if(def.is_write&&!internal){
      const old=db.prepare('SELECT * FROM memory_actions WHERE action_key=?').get(actionKey);
      if(old?.status==='succeeded')result=JSON.parse(old.result_json);
      else {
        if(old)throw Error('操作结果尚未确认，请先核对，不能自动重复');
        service.recordToolAction({actionKey,toolName:name,args,status:'pending'});
        try {result=await def.handler(args,ctx);if(bad(result))throw Error(result.error||'操作未完成');
          db.prepare("UPDATE memory_actions SET status='succeeded',result_json=?,updated_at=? WHERE action_key=?").run(JSON.stringify(result),new Date().toISOString(),actionKey);
          // A separate verified receipt is safe to retry; the business handler is never repeated.
          service.recordToolAction({actionKey:actionKey+':receipt',toolName:name,args,result,messageId:ctx.userMessageId,description:'我'+describeCall({fn_name:name,fn_args:args,result})+'。'});
        }catch(e){db.prepare("UPDATE memory_actions SET status='unknown',updated_at=? WHERE action_key=?").run(new Date().toISOString(),actionKey);throw e;}
      }
    }else result=await def.handler(args,ctx);
    return {result,is_write:def.is_write,fn_name:name,fn_args:args,...(bad(result)?{error:result.error||'操作未完成'}:{})};
  }catch(err){return {error:err.message,is_write:def.is_write,fn_name:name};}
}
// Operation facts are now committed by execute, rather than regenerated after the reply.
async function finalizeWrites(){return 0;}

/** 将函数调用转成人类可读的描述 */
function describeCall(call) {
  const { fn_name, fn_args, result } = call;
  const CAT_LABELS = { mine: '我的计划（对用户的期许）', his: '他的计划（AI自己的）', shared: '共同计划' };

  switch (fn_name) {
    case 'create_anniversary':
      return `创建了纪念日「${fn_args.name}」，日期${fn_args.date}${fn_args.subtitle ? '（' + fn_args.subtitle + '）' : ''}`;
    case 'post_moment':
      return `发了一条朋友圈动态，内容：「${fn_args.content}」`;
    case 'add_event':
      return `添加了日程「${fn_args.title}」(${fn_args.date})`;
    case 'update_event':
      return `修改了日程（ID: ${fn_args.id}）`;
    case 'delete_event':
      return `删除了一个日程`;
    case 'add_todo':
      return `添加了待办「${fn_args.title}」`;
    case 'update_todo':
      return `更新了待办（ID: ${fn_args.id}）${fn_args.completed ? '（已完成）' : ''}`;
    case 'delete_todo':
      return `删除了一个待办`;
    case 'create_plan_item':
      return `在「${CAT_LABELS[fn_args.category] || fn_args.category}」中新建了计划：「${fn_args.content}」`;
    case 'check_plan':
      return `${fn_args.checked ? '标记完成' : '取消完成'}了计划（ID: ${fn_args.plan_id}）${result && result.updated ? '：「' + result.updated.content + '」' : ''}`;
    case 'save_album_photo':
      return `保存了一张图片到相册（来源：${fn_args.source}）${fn_args.caption ? '，说明：「' + fn_args.caption + '」' : ''}`;
    case 'write_letter':
      return `主动给对方写了一封信：「${fn_args.title || '无标题'}」`;
    case 'reply_letter':
      return `回复了信件（ID: ${fn_args.letter_id}）`;
    case 'initiate_call':
      return `尝试给用户打电话（原因：${fn_args.reason || '未说明'}）`;
    case 'create_story':
      return `创建了睡前故事「${fn_args.title}」`;
    case 'create_milestone':
      return `记录了感情进展节点「${fn_args.title}」(${fn_args.date})`;
    case 'read_diary':
      return `读取了${fn_args.date}的日记`;
    case 'annotate_diary':
      return `在${fn_args.date}的日记中标记了${fn_args.mark_type === 'circle' ? '红圈' : fn_args.mark_type === 'wavy' ? '波浪线' : '双横线'}批画`;
    case 'send_red_packet':
      return `给用户发了一个${fn_args.amount}元的红包`;
    case 'send_gift':
      return `给用户送了一份${fn_args.item_name || '礼物'}（价值${fn_args.amount}元）`;
    case 'send_food_delivery':
      return `给用户点了一份${fn_args.item_name || '外卖'}（价值${fn_args.amount}元）`;
    case 'update_home_description':
      return `更新了家的描述：「${fn_args.description}」`;
    default:
      return `执行了${fn_name}操作`;
  }
}

module.exports = { getDefinitions, execute, finalizeWrites };
