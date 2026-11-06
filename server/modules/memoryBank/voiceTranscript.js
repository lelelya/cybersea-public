const {hash}=require('./constants');
function saveTranscript(service,{session_id,started_at,rounds}){
  const {db}=service,session=String(session_id||hash(started_at)).slice(0,128),prefix=`voice:${session}:`;
  return service.atomic(()=>{
    const existing=db.prepare("SELECT id FROM messages WHERE substr(memory_source_key,1,?)=? LIMIT 1").get(prefix.length,prefix);
    if(existing)return {inserted:0,deduplicated:true,session_id:session};
    let inserted=0;
    for(const [i,round]of rounds.entries())for(const [role,key]of [['user','user'],['ai','ai']]){
      if(typeof round[key]!=='string'||!round[key].trim())continue;
      db.prepare("INSERT OR IGNORE INTO messages(role,content,type,hidden,memory_origin,memory_source_key,occurred_at) VALUES(?,?,'text',1,'voice',?,?)").run(role,round[key],`${prefix}fallback-${i}:${role}`,started_at);inserted++;
    }
    return {inserted,session_id:session};
  });
}
module.exports={saveTranscript};
