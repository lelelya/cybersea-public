const {hash,parse,fail,estimate,dateInZone}=require('./constants');
const {normalize}=require('./messageNormalizer');
const {extractionPrompt,parseOutput}=require('./extractor');
function createJobs(api,{llm}={}) {
  const {db,id,now,atomic,repo}=api;let timer=null,busy=false;const owner=id();
  function enqueueObject(pipeline,payload,key){const existing=db.prepare('SELECT * FROM memory_jobs WHERE idempotency_key=?').get(key);if(existing)return existing;const j={id:id(),group_id:id(),pipeline,mode:'live',range_start:null,range_end:null,idempotency_key:key,payload_json:JSON.stringify(payload),state:'queued',attempts:0,next_attempt_at:null,lease_owner:null,lease_until:null,input_hash:hash(payload),result_json:null,error_code:null,error_message:null,created_at:now(),updated_at:now()};repo.insert('memory_jobs',j);return j;}
  function enqueueMaintenance({pipelines,mode='live',from_id,to_id,automatic=false}={}){return atomic(()=>{
    const s=api.settings();pipelines=pipelines||['events',...(s.profile_mode==='off'?[]:['profile'])];
    if(!Array.isArray(pipelines)||pipelines.some(p=>!['events','profile'].includes(p))||!['live','backfill'].includes(mode))fail('INVALID_JOB','任务范围无效');
    if(pipelines.includes('profile')&&s.profile_mode==='off')fail('PROFILE_DISABLED','画像维护已暂停，请先在记忆设置中启用',409);
    const H=Number(to_id||db.prepare('SELECT COALESCE(MAX(id),0) n FROM messages').get().n);if(mode==='backfill'&&(!Number.isSafeInteger(Number(from_id))||Number(from_id)<0||H<Number(from_id)))fail('INVALID_JOB','回填范围无效');
    const group=id(),jobs=[];let deduplicated=false;
    for(const pipeline of [...new Set(pipelines)]){
      const active=db.prepare("SELECT * FROM memory_jobs WHERE pipeline=? AND mode=? AND state IN ('queued','running','retry_wait','failed') ORDER BY range_start LIMIT 1").get(pipeline,mode);
      if(active){jobs.push(active);deduplicated=true;continue;}
      const cursor=mode==='backfill'?Math.max(0,Number(from_id)-1):db.prepare('SELECT last_contiguous_message_id n FROM memory_cursors WHERE pipeline=?').get(pipeline).n;
      if(automatic){
        if(pipeline==='events'&&!s.events_auto_enabled)continue;
        const latest=db.prepare("SELECT updated_at FROM memory_jobs WHERE pipeline=? AND state='succeeded' AND mode='live' ORDER BY updated_at DESC LIMIT 1").get(pipeline);
        if(pipeline==='profile'&&latest&&api.clock()-new Date(latest.updated_at)<s.profile_min_interval_minutes*60000)continue;
        const countRows=db.prepare('SELECT * FROM messages WHERE id>? AND id<=? ORDER BY id LIMIT ?').all(cursor,H,Math.max(s.message_threshold*4,120));
        if(countRows.map(m=>normalize(m,{extraction:true})).filter(Boolean).length<s.message_threshold)continue;
      }
      let start=cursor;
      while(start<H){
        const raw=db.prepare('SELECT * FROM messages WHERE id>? AND id<=? ORDER BY id LIMIT 120').all(start,H);if(!raw.length)break;
        const selected=[];let tokens=0;
        for(const m of raw){const n=estimate(m.memory_text||m.content)+30;if(selected.length&&tokens+n>s.extraction_input_budget_tokens)break;selected.push(m);tokens+=n;}
        const end=selected.at(-1).id,sources=selected.map(m=>({id:m.id,revision:m.revision,hash:hash(m.content)}));const payload={sources},inputHash=hash(sources),key=`${pipeline}:${mode}:${start}:${end}:${inputHash}`;
        let j=db.prepare('SELECT * FROM memory_jobs WHERE idempotency_key=?').get(key);
        if(!j){j={id:id(),group_id:group,pipeline,mode,range_start:start,range_end:end,idempotency_key:key,payload_json:JSON.stringify(payload),state:'queued',attempts:0,next_attempt_at:null,lease_owner:null,lease_until:null,input_hash:inputHash,result_json:null,error_code:null,error_message:null,created_at:now(),updated_at:now()};repo.insert('memory_jobs',j);}
        jobs.push(j);start=end;
        if(jobs.length>=100)break; // Subsequent ticks resume from the contiguous cursor.
      }
    }
    return {group_id:jobs[0]?.group_id||group,jobs,deduplicated};
  });}
  function listJobs({group_id,state,limit=50}={}){let sql='SELECT * FROM memory_jobs WHERE 1=1',args=[];if(group_id)sql+=' AND group_id=?',args.push(group_id);if(state)sql+=' AND state=?',args.push(state);sql+=' ORDER BY created_at DESC,id DESC LIMIT ?';return {jobs:db.prepare(sql).all(...args,Math.min(100,Number(limit)||50)).map(j=>({...j,result:parse(j.result_json),processed_messages:j.state==='succeeded'?(j.range_end-j.range_start):0,payload_json:undefined,result_json:undefined}))};}
  function retryJob(jobId){const j=db.prepare('SELECT * FROM memory_jobs WHERE id=?').get(jobId);if(!j)fail('NOT_FOUND','任务不存在',404);if(['failed','retry_wait'].includes(j.state))db.prepare("UPDATE memory_jobs SET state='queued',attempts=0,next_attempt_at=NULL,error_code=NULL,error_message=NULL WHERE id=?").run(j.id);return db.prepare('SELECT * FROM memory_jobs WHERE id=?').get(j.id);}
  function revalidate(payload){const item=repo.get(payload.type,payload.id);if(!item)return;const refs=repo.sources(payload.type,payload.id),valid=refs.filter(r=>r.status==='valid'&&r.source_type==='message');
    // Partial source loss cannot prove that every clause is still supported.
    if(refs.length&&refs.every(r=>r.status==='valid'))db.prepare(`UPDATE ${repo.table(payload.type)} SET status='active' WHERE id=?`).run(item.id);
    else if(!valid.length&&item.origin==='ai')db.prepare(`UPDATE ${repo.table(payload.type)} SET status='archived' WHERE id=?`).run(item.id);
    repo.index(payload.type,repo.get(payload.type,payload.id));
  }
  async function runJob(jobId){
    const lease=atomic(()=>{const j=db.prepare('SELECT * FROM memory_jobs WHERE id=?').get(jobId);if(!j||j.state==='succeeded'||j.state==='cancelled')return null;
      if(j.state==='running'&&j.lease_until>now())return null;
      if(j.state==='retry_wait'&&j.next_attempt_at>now())return null;
      const earlier=j.range_start!=null?db.prepare("SELECT id FROM memory_jobs WHERE pipeline=? AND mode=? AND range_start<? AND state NOT IN ('succeeded','cancelled') LIMIT 1").get(j.pipeline,j.mode,j.range_start):null;if(earlier)return null;
      const until=new Date(api.clock().getTime()+180000).toISOString();db.prepare("UPDATE memory_jobs SET state='running',attempts=attempts+1,lease_owner=?,lease_until=?,updated_at=? WHERE id=?").run(owner,until,now(),jobId);return {...j,lease_owner:owner,lease_until:until,attempts:j.attempts+1};});
    if(!lease)return;
    const heartbeat=setInterval(()=>db.prepare("UPDATE memory_jobs SET lease_until=? WHERE id=? AND state='running' AND lease_owner=?").run(new Date(api.clock().getTime()+180000).toISOString(),jobId,owner),30000);heartbeat.unref?.();
    try{
      const payload=parse(lease.payload_json,{});let output=parse(lease.result_json),messages=[],profileHash;
      if(['events','profile'].includes(lease.pipeline)){
        if(lease.pipeline==='profile'&&api.settings().profile_mode==='off'){db.prepare("UPDATE memory_jobs SET state='queued',lease_owner=NULL,lease_until=NULL WHERE id=? AND lease_owner=?").run(jobId,owner);return;}
        const rows=payload.sources.map(s=>db.prepare('SELECT * FROM messages WHERE id=?').get(s.id));
        const changed=rows.some((m,i)=>!m||m.revision!==payload.sources[i].revision||hash(m.content)!==payload.sources[i].hash);
        if(changed){const fresh=rows.filter(Boolean).map(m=>({id:m.id,revision:m.revision,hash:hash(m.content)}));db.prepare('UPDATE memory_jobs SET payload_json=?,input_hash=?,result_json=NULL WHERE id=?').run(JSON.stringify({sources:fresh}),hash(fresh),jobId);fail('SOURCE_CHANGED','批次来源已变化，将重新整理',409);}
        messages=rows.map(m=>normalize(m,{extraction:true,backfill:lease.mode==='backfill'})).filter(Boolean);
        const items=api.getProfile().profile.flatMap(s=>s.items);profileHash=hash(items);
        if(!output){if(messages.length){if(!llm)fail('NO_MODEL','未配置记忆模型');const response=await llm(extractionPrompt(lease.pipeline,{messages,items,persona:db.prepare('SELECT * FROM persona WHERE id=1').get(),settings:api.settings()}),{maxTokensOverride:api.settings().extraction_max_tokens,temperatureOverride:.2,signal:AbortSignal.timeout(90000)});output=parseOutput(response,lease.pipeline);}else output=lease.pipeline==='profile'?{operations:[]}:{events:[]};
          db.prepare("UPDATE memory_jobs SET result_json=? WHERE id=? AND state='running' AND lease_owner=?").run(JSON.stringify(output),jobId,owner);}
      }
      atomic(()=>{
        const current=db.prepare('SELECT * FROM memory_jobs WHERE id=?').get(jobId);if(current.state!=='running'||current.lease_owner!==owner||current.lease_until<=now())fail('LEASE_LOST','任务租约已变化',409);
        for(const source of parse(current.payload_json,{}).sources||[]){const m=db.prepare('SELECT * FROM messages WHERE id=?').get(source.id);if(!m||m.revision!==source.revision||hash(m.content)!==source.hash)fail('SOURCE_CHANGED','提交前原消息已变化',409);}
        if(lease.pipeline==='profile'&&profileHash!==hash(api.getProfile().profile.flatMap(s=>s.items)))fail('REVISION_CONFLICT','画像已变化，将重新读取后整理',409);
        const evidence=new Set(messages.map(m=>Number(m.id))),ctx={actor:'ai',evidence,group_id:lease.group_id,job_id:jobId,operation_key:jobId,backfill:lease.mode==='backfill'};
        if(lease.pipeline==='profile')api.updateProfileItems(output.operations,ctx);
        if(lease.pipeline==='events')for(const [i,e]of output.events.entries())api.write('event',{...e,op:'create'},{...ctx,sources:e.source_message_ids.map(m=>({source_type:'message',source_id:m})),operation_key:`${jobId}:${i}`,dedup_key:`job:${jobId}:${i}`});
        if(lease.pipeline==='revalidate')revalidate(payload);
        if(lease.pipeline==='action_narration'){
          // Verified facts stay available without depending on another model call.
          output={action_id:payload.id,recorded:true};
        }
        if(lease.mode==='live'&&lease.range_end!=null){const c=db.prepare('SELECT * FROM memory_cursors WHERE pipeline=?').get(lease.pipeline);if(c.last_contiguous_message_id!==lease.range_start)fail('CURSOR_GAP','前序区间尚未完成',409);db.prepare('UPDATE memory_cursors SET last_contiguous_message_id=?,updated_at=? WHERE pipeline=?').run(lease.range_end,now(),lease.pipeline);}
        db.prepare("UPDATE memory_jobs SET state='succeeded',result_json=?,error_code=NULL,error_message=NULL,lease_owner=NULL,lease_until=NULL,updated_at=? WHERE id=?").run(JSON.stringify({...output,processed_messages:messages.length}),now(),jobId);
      });
    }catch(err){const conflict=['SOURCE_CHANGED','REVISION_CONFLICT'].includes(err.code);db.prepare("UPDATE memory_jobs SET state=?,next_attempt_at=?,error_code=?,error_message=?,result_json=CASE WHEN ? THEN NULL ELSE result_json END,lease_owner=NULL,lease_until=NULL,updated_at=? WHERE id=? AND lease_owner=? AND state='running'").run(lease.attempts>=3?'failed':'retry_wait',new Date(api.clock().getTime()+(lease.attempts===1?5000:30000)).toISOString(),err.code||'MODEL_ERROR',err.status?err.message:'记忆整理调用失败，请检查模型配置后重试',conflict?1:0,now(),jobId,owner);
    }finally{clearInterval(heartbeat);}
    return db.prepare('SELECT * FROM memory_jobs WHERE id=?').get(jobId);
  }
  async function tick(){if(busy)return;busy=true;try{
    db.prepare("UPDATE memory_jobs SET state='queued',lease_owner=NULL WHERE state='running' AND lease_until<=?").run(now());
    const s=api.settings();const pipelines=[...(s.events_auto_enabled?['events']:[]),...(s.profile_mode!=='off'?['profile']:[])];if(pipelines.length)enqueueMaintenance({pipelines,automatic:true});
    const rows=db.prepare("SELECT * FROM memory_jobs WHERE state='queued' OR (state='retry_wait' AND next_attempt_at<=?) ORDER BY created_at,range_start LIMIT 50").all(now());for(const j of rows){if(j.pipeline==='profile'&&s.profile_mode==='off')continue;await runJob(j.id);}
  }finally{busy=false;}}
  function start(){if(!timer){timer=setInterval(()=>tick().catch(e=>console.error('[记忆维护]',e.code||'失败')),5000);timer.unref?.();}}
  function stop(){clearInterval(timer);timer=null;}
  function recordToolAction({actionKey,toolName,args,result,messageId,description,status='succeeded'}){return atomic(()=>{
    const old=db.prepare('SELECT * FROM memory_actions WHERE action_key=?').get(actionKey);if(old)return old;
    const a={id:id(),action_key:actionKey,tool_name:toolName,args_json:JSON.stringify(args||{}),result_json:JSON.stringify(result||{}),status,message_id:messageId||null,occurred_at:now(),updated_at:now()};repo.insert('memory_actions',a);
    if(status==='succeeded'&&api.settings().tool_memory_enabled){const content=description||`我完成了${toolName}操作。`;api.write('event',{op:'create',date:dateInZone(api.clock(),api.settings().timezone),content,factual_content:JSON.stringify({tool:toolName,result})},{actor:'system',sources:[{source_type:'action',source_id:a.id}],dedup_key:`action:${a.id}`,operation_key:`action-event:${a.id}`});}
    return a;
  });}
  return {enqueueObject,enqueueMaintenance,listJobs,retryJob,runJob,tick,start,stop,recordToolAction};
}
module.exports={createJobs};
