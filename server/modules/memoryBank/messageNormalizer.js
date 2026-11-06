const { parse } = require('./constants');
function normalize(row,{extraction=false,backfill=false}={}) {
  if(row.memory_scope && row.memory_scope!=='main') return null;
  if(['notification','call_transcript'].includes(row.memory_origin)) return null;
  if(row.memory_origin==='import'&&!backfill) return null;
  if(['tool_notification','home_env','call'].includes(row.type)) return null;
  if(row.type==='mode_switch') {
    if(extraction) return null;
    const value=parse(row.content); if(!value) return null;
    return {...row,role:'system',content:value.action==='home_enter'?'[你们回到了家。]':'[你们回到了线上聊天。]'};
  }
  if(!['user','ai'].includes(row.role)) return null;
  if(extraction && ['red_packet','gift','food_delivery'].includes(row.type)) return null;
  let content=row.memory_text || (row.type==='voice'?row.transcript||row.content:row.content);
  if(row.type==='image') content=row.memory_text?`[图片识别描述，可能有误] ${row.memory_text}`:'[发送了一张图片]';
  if(row.type==='sticker') content=`[表情贴图] ${content}`;
  if(['red_packet','gift','food_delivery'].includes(row.type)) content=`[虚拟互动] ${row.content}`;
  if(!content?.trim()) return null;
  return {...row,content};
}
module.exports={normalize};
