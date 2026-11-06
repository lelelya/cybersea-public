const {getMemoryService}=require('../modules/memoryBank/service');
const {estimate}=require('../modules/memoryBank/constants');
function buildMemoryContext({persona,channel='chat',query='',beforeMessageId,currentMessageId,fixedInput='',functions=[],outputReserve=4096}={}){
  const service=getMemoryService(),settings=service.settings();
  const context=service.buildContext({channel,query,beforeMessageId,currentMessageId,budget:{fixedInput:estimate(fixedInput)+estimate(functions)+estimate(query),outputReserve,hardWindow:settings.context_window_tokens}});
  context.snippet=[context.core,context.recalled].filter(Boolean).join('\n\n');
  context.evidence=new Set(context.recentMessages.filter(m=>['user','ai'].includes(m.role)).map(m=>Number(m.id)));
  return context;
}
function forModel(m){return {role:m.role==='ai'?'assistant':m.role==='system'?'system':'user',content:`[消息 ${m.id} v${m.revision||1} ${m.created_at||''}]\n${m.content}`};}
module.exports={buildMemoryContext,forModel};
