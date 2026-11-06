const {randomUUID}=require('node:crypto');
const {PROFILE_KEYS,DEFAULTS,TABLES,fail,hash,parse,dateValid,dateInZone}=require('./constants');
const {createRepository}=require('./repository');
function createMemoryService({db,llm,clock=()=>new Date(),idFactory=randomUUID,fts=true}={}) {
  const repo=createRepository(db); const id=idFactory, now=()=>clock().toISOString(); let depth=0;
  function atomic(fn) {
    if(db.transaction) return db.transaction(fn)();
    const n=depth++,point=`memory_${n}`; db.exec(n?`SAVEPOINT ${point}`:'BEGIN IMMEDIATE');
    try { const v=fn(); if(v?.then) throw Error('事务中不能等待网络'); db.exec(n?`RELEASE ${point}`:'COMMIT'); return v; }
    catch(e){db.exec(n?`ROLLBACK TO ${point}`:'ROLLBACK');if(n)db.exec(`RELEASE ${point}`);throw e;} finally{depth--;}
  }
  function settings() { const s={...DEFAULTS,...db.prepare('SELECT * FROM memory_settings WHERE id=1').get()}; for(const k of ['events_auto_enabled','tool_memory_enabled','protect_imported'])s[k]=!!s[k]; return s; }
  function setSettings(body) {
    const row={};
    for(const [k,v] of Object.entries(body)) {
      if(!(k in DEFAULTS)) continue;
      if(['events_auto_enabled','tool_memory_enabled','protect_imported'].includes(k)){if(typeof v!=='boolean')fail('INVALID_SETTINGS','开关必须为布尔值');row[k]=v?1:0;}
      else if(k==='profile_mode'){if(!['off','suggest','auto'].includes(v))fail('INVALID_SETTINGS','未知画像维护模式');row[k]=v;}
      else if(k==='timezone'){try{new Intl.DateTimeFormat('en',{timeZone:v}).format();}catch{fail('INVALID_SETTINGS','时区无效');}row[k]=v;}
      else if(k==='context_window_tokens'&&v===null) row[k]=null;
      else {const ranges={message_threshold:[1,1000],profile_min_interval_minutes:[0,1440],state_review_days:[1,365]};const [min,max]=ranges[k]||[256,1000000];if(!Number.isInteger(v)||v<min||v>max)fail('INVALID_SETTINGS',`${k} 超出允许范围`);row[k]=v;}
    }
    if(Object.keys(row).length)db.prepare(`UPDATE memory_settings SET ${Object.keys(row).map(k=>`${k}=?`).join(',')} WHERE id=1`).run(...Object.values(row));
    return settings();
  }
  function checkVersion(old,expected) { if(expected==null)fail('PRECONDITION_REQUIRED','请提供内容版本',428);if(Number(expected)!==old.revision)fail('REVISION_CONFLICT','内容已更新，请查看对照后再保存',409,{current:old}); }
  function getProfile() { return {profile:db.prepare('SELECT * FROM memory_profile').all().filter(s=>PROFILE_KEYS.includes(s.section_key)).sort((a,b)=>PROFILE_KEYS.indexOf(a.section_key)-PROFILE_KEYS.indexOf(b.section_key)).map(s=>({...s,items:db.prepare("SELECT * FROM memory_profile_items WHERE section_key=? AND status!='archived' ORDER BY sort_order,id").all(s.section_key)}))}; }
  function validateSources(refs=[],actor='user',evidence) {
    if(actor==='ai'&&!refs.length) fail('SOURCE_REQUIRED','AI 修改必须有来源');
    return refs.map(ref=>{
      const type=ref.source_type||'message',sourceId=String(ref.source_id??ref.id);
      if(type==='message') {
        const m=db.prepare('SELECT * FROM messages WHERE id=?').get(sourceId);
        if(!m||m.memory_scope!=='main'||(actor==='ai'&&(!evidence||!evidence.has(Number(sourceId)))))fail('INVALID_SOURCE','来源未提供或已不可用');
        if(ref.source_revision!=null&&Number(ref.source_revision)!==m.revision)fail('SOURCE_CHANGED','来源已被编辑',409);
        return {source_type:type,source_id:sourceId,source_revision:m.revision,content_hash:hash(m.content),status:'valid'};
      }
      if(actor==='ai'&&type!=='action')fail('INVALID_SOURCE','无效来源类型');
      if(type==='action'&&!db.prepare("SELECT id FROM memory_actions WHERE id=? AND status='succeeded'").get(sourceId))fail('INVALID_SOURCE','操作尚未确认成功');
      return {source_type:type,source_id:sourceId,source_revision:ref.source_revision??null,content_hash:ref.content_hash??null,status:'valid'};
    });
  }
  function changes({target_type,target_id,status,cursor,limit=20}={}) {
    const where=['1=1'],params=[];for(const [k,v] of Object.entries({target_type,target_id,status}))if(v){where.push(`${k}=?`);params.push(String(v));}
    if(cursor){const c=parse(Buffer.from(cursor,'base64url').toString());if(!c||c.filter!==hash({target_type,target_id,status}))fail('INVALID_CURSOR','分页条件已改变');where.push('(created_at<? OR (created_at=? AND id<?))');params.push(c.at,c.at,c.id);}
    limit=Math.max(1,Math.min(Number(limit)||20,50));const rows=db.prepare(`SELECT * FROM memory_changes WHERE ${where.join(' AND ')} ORDER BY created_at DESC,id DESC LIMIT ?`).all(...params,limit+1);const has=rows.length>limit,items=rows.slice(0,limit),last=items.at(-1);
    return {changes:items.map(r=>({...r,before:parse(r.before_json),after:parse(r.after_json),operation:parse(r.operation_json),sources:db.prepare('SELECT * FROM memory_sources WHERE change_id=?').all(r.id)})),has_more:has,next_cursor:has?Buffer.from(JSON.stringify({at:last.created_at,id:last.id,filter:hash({target_type,target_id,status})})).toString('base64url'):null};
  }
  function write(type,operation,ctx={}) {
    return atomic(()=>{
      const actor=ctx.actor||'user', opKey=ctx.operation_key||id();
      const existing=db.prepare('SELECT * FROM memory_changes WHERE operation_key=?').get(opKey);if(existing)return {status:existing.status,change:existing,item:repo.get(existing.target_type,existing.target_id),deduplicated:true};
      const table=repo.table(type),targetId=String(operation.item_id||operation.id||id()),old=repo.get(type,targetId);
      if(db.prepare('SELECT 1 FROM memory_tombstones WHERE target_type=? AND target_id=?').get(type,targetId))fail('DELETED_TARGET','该记忆已被删除',409);
      const adding=['add_item','create'].includes(operation.op);if(!adding&&!old)fail('NOT_FOUND','记忆不存在',404);if(adding&&old)fail('REVISION_CONFLICT','记忆已存在',409);
      if(old)checkVersion(old,operation.expected_revision);
      const refs=validateSources(ctx.sources?.length?ctx.sources:actor==='ai'?[]:[{source_type:'manual',source_id:opKey}],actor,ctx.evidence);
      const inherited=old&&actor!=='user'?repo.sources(type,old.id):[];
      let after;
      if(type==='profile_item') {
        const key=operation.section_key||old?.section_key;if(!PROFILE_KEYS.includes(key))fail('INVALID_SECTION','未知画像板块');
        after={...(old||{id:targetId,section_key:key,separator_before:db.prepare("SELECT id FROM memory_profile_items WHERE section_key=? AND status!='archived'").get(key)?'\n\n':'',sort_order:db.prepare('SELECT COALESCE(MAX(sort_order),-1)+1 n FROM memory_profile_items WHERE section_key=?').get(key).n,kind:'stable',status:'active',origin:actor==='ai'?'ai':actor==='import'?'import':'manual',edit_policy:actor==='ai'?'auto':actor==='import'&&!settings().protect_imported?'auto':'protected',pinned:0,scope:'main',valid_from:null,valid_until:null,created_at:now()})};
        for(const field of ['content','kind','valid_from','valid_until'])if(operation[field]!==undefined)after[field]=operation[field];
        if(actor!=='ai')for(const field of ['edit_policy','pinned','status'])if(operation[field]!==undefined)after[field]=operation[field];
        if(actor==='user'&&operation.content!==undefined)after.status='active';
        if(!['stable','state','commitment','reflection'].includes(after.kind)||!['auto','protected'].includes(after.edit_policy)||!['active','archived','needs_review'].includes(after.status))fail('INVALID_ITEM','画像属性无效');
        after.pinned=after.pinned?1:0;
        if(after.kind==='state'&&adding&&!after.valid_until)after.valid_until=new Date(clock().getTime()+settings().state_review_days*86400000).toISOString();
        if(after.valid_until&&!Number.isFinite(Date.parse(after.valid_until)))fail('INVALID_DATE','有效期无效');
        if(operation.op==='archive_item')after.status='archived';
      } else {
        const fields=type==='event'?['date','content','factual_content']:['date','title','description','pinned'];
        after={...(old||{status:'active',scope:'main',created_at:now(),...(type==='event'?{source:actor==='import'?'import':actor==='user'?'manual':'auto',factual_content:null,dedup_key:ctx.dedup_key||null}:{created_by:actor==='user'?'user':'ai',pinned:0})})};
        for(const key of fields)if(operation[key]!==undefined)after[key]=operation[key];
        if(operation.status!==undefined&&actor!=='ai')after.status=operation.status;
        if(operation.op==='archive_item')after.status='archived';
        if(!dateValid(after.date))fail('INVALID_DATE','日期必须为有效的 YYYY-MM-DD');
        if(type==='event'&&after.dedup_key){const prior=db.prepare('SELECT * FROM memory_events WHERE dedup_key=?').get(after.dedup_key);if(prior)return {status:'applied',item:prior,deduplicated:true};if(db.prepare("SELECT 1 FROM memory_tombstones WHERE dedup_keys_json LIKE ?").get(`%${after.dedup_key}%`))fail('DELETED_TARGET','该事件已删除',409);}
      }
      const body=type==='milestone'?after.description:after.content;
      if(typeof body!=='string'||!body.trim()||body.length>100000)fail('INVALID_CONTENT','请输入有效的记忆正文（最多十万字符）');
      if(type==='milestone'&&(typeof after.title!=='string'||!after.title.trim()))fail('INVALID_CONTENT','请填写标题');
      after.revision=(old?.revision||0)+1;after.updated_at=now();
      let pending=false,reason=ctx.reason||operation.reason||'手动修改';
      if(actor==='ai'&&type==='profile_item'){
        const mode=settings().profile_mode;if(mode==='off')fail('PROFILE_DISABLED','画像自动更新已暂停',409);
        const shrink=old?.content.length>=80&&Array.from(body).length<Array.from(old.content).length*.65;
        pending=mode==='suggest'||ctx.backfill||old?.edit_policy==='protected'||shrink||ctx.largeBatch;
        if(pending)reason+=`（${old?.edit_policy==='protected'?'原文由用户维护':shrink?'正文缩短较多':'待确认'}）`;
      }
      const changeId=id(),change={id:changeId,group_id:ctx.group_id||id(),operation_key:opKey,target_type:type,target_id:targetId,expected_revision:old?.revision??null,new_revision:pending?null:after.revision,operation_json:JSON.stringify(operation),before_json:old?JSON.stringify(old):null,after_json:JSON.stringify(after),reason,actor,status:pending?'pending':'applied',job_id:ctx.job_id||null,reverts_change_id:ctx.reverts_change_id||null,created_at:now(),applied_at:pending?null:now()};
      if(!pending){
        if(old)repo.update(table,targetId,after,old.revision);
        else {const row={...after};if(type==='profile_item')row.id=targetId;repo.insert(table,row);if(type!=='profile_item'){after.id=Number(db.prepare('SELECT last_insert_rowid() n').get().n);change.target_id=String(after.id);change.after_json=JSON.stringify(after);}}
        repo.index(type,after);if(type==='profile_item')repo.refreshSection(after.section_key,now());
      }
      repo.insert('memory_changes',change);
      for(const source of [...inherited,...refs])repo.insert('memory_sources',{id:id(),change_id:changeId,source_type:source.source_type,source_id:source.source_id,source_revision:source.source_revision,content_hash:source.content_hash,status:source.status});
      return {status:change.status,item:pending?old:after,change,proposal:pending?after:null};
    });
  }
  function updateProfileItems(operations,ctx={}) {
    if(!Array.isArray(operations)||operations.length>30)fail('INVALID_OPERATIONS','画像操作格式错误');
    return atomic(()=>{const group_id=ctx.group_id||id();const result=operations.map((o,i)=>{if(!['add_item','update_item','archive_item'].includes(o.op))fail('INVALID_OPERATION','仅支持条目局部增改');const sources=o.source_message_ids?.map(m=>({source_type:'message',source_id:m}))||ctx.sources||[];return write('profile_item',o,{...ctx,group_id,sources,largeBatch:operations.filter(x=>x.op!=='add_item').length>3,operation_key:ctx.operation_key?`${ctx.operation_key}:${i}`:id()});});return {results:result,applied_count:result.filter(r=>r.status==='applied').length,pending_count:result.filter(r=>r.status==='pending').length};});
  }
  function replaceProfileSections(sections,ctx={}) {
    if(!Array.isArray(sections)||!sections.length||sections.length>10)fail('INVALID_SECTION','板块格式错误');
    return atomic(()=>{
      for(const s of sections){if(!PROFILE_KEYS.includes(s.section_key)||typeof s.content!=='string')fail('INVALID_SECTION','板块或正文无效');checkVersion(db.prepare('SELECT * FROM memory_profile WHERE section_key=?').get(s.section_key),s.expected_revision);}
      for(const s of sections){const old=db.prepare('SELECT * FROM memory_profile WHERE section_key=?').get(s.section_key);if(old.content===s.content)continue;for(const item of db.prepare("SELECT * FROM memory_profile_items WHERE section_key=? AND status!='archived'").all(s.section_key))write('profile_item',{op:'archive_item',item_id:item.id,expected_revision:item.revision},{...ctx,actor:ctx.actor||'user'});if(s.content!=='')write('profile_item',{op:'add_item',section_key:s.section_key,content:s.content,kind:s.section_key.includes('最近的状态')?'state':'stable',pinned:1,valid_until:null},{...ctx,actor:ctx.actor||'user'});}
      return getProfile();
    });
  }
  function acceptChange(changeId,expected_revision){return atomic(()=>{
    const c=db.prepare("SELECT * FROM memory_changes WHERE id=? AND status='pending'").get(changeId);if(!c)fail('NOT_FOUND','待处理修改不存在',404);
    const op=parse(c.operation_json),old=repo.get(c.target_type,c.target_id);if(old){checkVersion(old,expected_revision);if(old.revision!==c.expected_revision)fail('REVISION_CONFLICT','提议依据的版本已过期',409);}
    const refs=db.prepare('SELECT * FROM memory_sources WHERE change_id=?').all(c.id);if(refs.some(r=>r.status!=='valid'))fail('SOURCE_CHANGED','提议来源已变化',409);
    const result=write(c.target_type,{...op,item_id:c.target_id,expected_revision},{actor:'user',sources:refs,reason:`接受提议：${c.reason}`,operation_key:`accept:${c.id}`});db.prepare("UPDATE memory_changes SET status='rejected',reason=reason||'（已接受，见应用记录）' WHERE id=?").run(c.id);return result;
  });}
  function rejectChange(changeId){const c=db.prepare("SELECT id FROM memory_changes WHERE id=? AND status='pending'").get(changeId);if(!c)fail('NOT_FOUND','提议不存在',404);db.prepare("UPDATE memory_changes SET status='rejected' WHERE id=?").run(changeId);return {rejected:true};}
  function revertChange(changeId,expected_revision){return atomic(()=>{
    const c=db.prepare("SELECT * FROM memory_changes WHERE id=? AND status='applied'").get(changeId);if(!c)fail('NOT_FOUND','修改不存在',404);const old=repo.get(c.target_type,c.target_id);if(!old)fail('DELETED_TARGET','原记忆已删除',409);checkVersion(old,expected_revision);if(old.revision!==c.new_revision)fail('REVISION_CONFLICT','已有后续修改，请先查看对照',409);
    const before=parse(c.before_json);if(!before)return write(c.target_type,{op:'archive_item',item_id:old.id,expected_revision},{actor:'user',reason:'撤销新增',reverts_change_id:c.id});
    return write(c.target_type,{...before,op:'update_item',item_id:old.id,expected_revision},{actor:'user',reason:'撤销本次修改',reverts_change_id:c.id});
  });}
  function readMemory(type,targetId,{offset=0,limit=12000}={}) {
    const item=repo.get(type,targetId);if(!item)fail('NOT_FOUND','记忆不存在',404);const field=type==='milestone'?'description':'content',body=item[field]||'',start=Math.max(0,Number(offset)||0),size=Math.min(12000,Math.max(1,Number(limit)||12000));
    return {type,item:{...item,[field]:body.slice(start,start+size)},sources:repo.sources(type,targetId),has_more:start+size<body.length,next_offset:start+size<body.length?start+size:null};
  }
  function purge(type,targetId,expected_revision){return atomic(()=>{
    const old=repo.get(type,targetId);if(!old)fail('NOT_FOUND','记忆不存在',404);checkVersion(old,expected_revision);const tomb={target_type:type,target_id:String(targetId),deleted_revision:old.revision,operation_key:id(),dedup_keys_json:JSON.stringify(old.dedup_key?[old.dedup_key]:[]),deleted_at:now()};repo.insert('memory_tombstones',tomb);
    const affectedJobs=db.prepare('SELECT DISTINCT job_id FROM memory_changes WHERE target_type=? AND target_id=? AND job_id IS NOT NULL').all(type,String(targetId));for(const j of affectedJobs)db.prepare("UPDATE memory_jobs SET result_json=NULL,state=CASE WHEN state='succeeded' THEN state ELSE 'cancelled' END WHERE id=?").run(j.job_id);
    db.prepare('UPDATE memory_changes SET before_json=NULL,after_json=NULL,operation_json=? WHERE target_type=? AND target_id=?').run(JSON.stringify({op:'purged'}),type,String(targetId));
    db.prepare(`DELETE FROM ${repo.table(type)} WHERE id=?`).run(targetId);if(repo.fts)db.prepare('DELETE FROM memory_search_fts WHERE type=? AND id=?').run(type,String(targetId));if(type==='profile_item')repo.refreshSection(old.section_key,now());return {deleted:true};
  });}
  function sourceImpact(messageId){
    const m=db.prepare('SELECT * FROM messages WHERE id=?').get(messageId);if(!m)fail('NOT_FOUND','原消息不存在',404);
    const refs=db.prepare("SELECT DISTINCT c.target_type type,c.target_id id FROM memory_sources s JOIN memory_changes c ON c.id=s.change_id WHERE s.source_type='message' AND s.source_id=?").all(String(messageId));
    const targets=refs.map(r=>({type:r.type,item:repo.get(r.type,r.id)})).filter(r=>r.item).map(r=>({...r,sources:repo.sources(r.type,r.item.id)}));
    return {message_id:Number(messageId),revision:m.revision,targets,impact_token:hash([m.revision,targets.map(t=>[t.type,t.item.id,t.item.revision])]),legacy_unknown:true};
  }
  function invalidateSource(messageId,status='changed',options={}) {return atomic(()=>{
    const impact=sourceImpact(messageId);
    if(options.purge){if(options.impact_token!==impact.impact_token||Number(options.expected_revision)!==impact.revision)fail('REVISION_CONFLICT','影响范围已改变，请重新查看',409);const selected=new Set(options.target_ids||[]);for(const t of impact.targets)if(selected.has(`${t.type}:${t.item.id}`))purge(t.type,t.item.id,t.item.revision);}
    db.prepare("UPDATE memory_sources SET status=? WHERE source_type='message' AND source_id=?").run(status,String(messageId));
    for(const t of impact.targets){const current=repo.get(t.type,t.item.id);if(!current)continue;db.prepare(`UPDATE ${repo.table(t.type)} SET status='needs_review' WHERE id=?`).run(current.id);repo.index(t.type,{...current,status:'needs_review'});api.enqueueObject('revalidate',{type:t.type,id:String(current.id)},`revalidate:${messageId}:${status}:${impact.revision}:${t.type}:${current.id}`);}
    // Invalidate cached outputs that read this source; old workers also compare live hashes before commit.
    for(const job of db.prepare("SELECT * FROM memory_jobs WHERE result_json IS NOT NULL").all())if(parse(job.payload_json,{}).sources?.some(s=>Number(s.id)===Number(messageId)))db.prepare('UPDATE memory_jobs SET result_json=NULL WHERE id=?').run(job.id);
    return impact;
  });}
  function getSource(sourceId){const s=db.prepare('SELECT * FROM memory_sources WHERE id=?').get(sourceId);if(!s)fail('NOT_FOUND','来源不存在',404);if(s.source_type==='message'){const m=db.prepare('SELECT * FROM messages WHERE id=?').get(s.source_id);if(!m)return {source:s,available:false,messages:[]};return {source:s,available:true,changed:m.revision!==s.source_revision,messages:db.prepare("SELECT id,role,content,memory_text,created_at,revision FROM messages WHERE id BETWEEN ? AND ? AND type NOT IN ('tool_notification','home_env') ORDER BY id LIMIT 7").all(Math.max(0,m.id-2),m.id+2)};}return {source:s,available:s.source_type==='action',action:s.source_type==='action'?db.prepare('SELECT * FROM memory_actions WHERE id=?').get(s.source_id):null};}
  function importData(input,{mode='append',revisions={}}={}) {return atomic(()=>{
    let data=input;if(Array.isArray(data))data=data[0]?.title!==undefined?{milestones:data}:{events:data};else if(data&&Object.keys(data).some(k=>PROFILE_KEYS.includes(k)))data={profile:data};
    if(!data||typeof data!=='object')fail('INVALID_IMPORT','无法识别记忆数据');const counts={imported:true,importedEvents:0,updatedSections:0,milestones:0,duplicates:0,invalid:0,pending:0};const importId=id();
    const ctx={actor:'import',sources:[{source_type:'import',source_id:importId}],group_id:importId};
    if(data.events!==undefined&&!Array.isArray(data.events))fail('INVALID_IMPORT','events 必须是数组');
    for(const e of data.events||[]){if(!dateValid(e.date)||typeof e.content!=='string'||!e.content.trim()){counts.invalid++;continue;}if(db.prepare('SELECT id FROM memory_events WHERE date=? AND content=?').get(e.date,e.content)){counts.duplicates++;continue;}write('event',{...e,op:'create'},ctx);counts.importedEvents++;}
    for(const m of data.milestones||[]){if(!dateValid(m.date)||!m.title||!m.description){counts.invalid++;continue;}if(db.prepare('SELECT id FROM relationship_milestones WHERE date=? AND title=?').get(m.date,m.title)){counts.duplicates++;continue;}write('milestone',{...m,op:'create'},ctx);counts.milestones++;}
    for(const [key,content] of Object.entries(data.profile||{})){if(!PROFILE_KEYS.includes(key)||typeof content!=='string'||content===''){counts.invalid++;continue;}if(db.prepare("SELECT id FROM memory_profile_items WHERE section_key=? AND content=? AND status!='archived'").get(key,content)){counts.duplicates++;continue;}if(mode==='replace')replaceProfileSections([{section_key:key,content,expected_revision:revisions[key]}],ctx);else write('profile_item',{op:'add_item',section_key:key,content,kind:key.includes('最近的状态')?'state':'stable',valid_until:null},ctx);counts.updatedSections++;}
    if(!('events'in data)&&!('profile'in data)&&!('milestones'in data))fail('INVALID_IMPORT','没有可识别的记忆字段');return counts;
  });}
  function status(){return {today_changes:db.prepare("SELECT COUNT(*) n FROM memory_changes WHERE actor NOT IN ('migration','system') AND substr(created_at,1,10)=? AND status='applied'").get(now().slice(0,10)).n,pending_count:db.prepare("SELECT COUNT(*) n FROM memory_changes WHERE status='pending'").get().n,active_jobs:db.prepare("SELECT COUNT(*) n FROM memory_jobs WHERE state IN ('queued','running','retry_wait')").get().n,failed_jobs:db.prepare("SELECT COUNT(*) n FROM memory_jobs WHERE state='failed'").get().n,fts:fts&&repo.fts,profile_mode:settings().profile_mode};}
  const listMilestones=()=>db.prepare("SELECT * FROM relationship_milestones WHERE status!='archived' AND scope='main' ORDER BY date,id").all();
  const api={listMilestones,db,repo,atomic,id,now,clock,settings,setSettings,checkVersion,getProfile,write,updateProfileItems,replaceProfileSections,changes,acceptChange,rejectChange,revertChange,readMemory,purge,sourceImpact,invalidateSource,getSource,importData,status,validateSources};
  Object.assign(api,require('./retrieval').createRetrieval(api,{fts}));
  Object.assign(api,require('./context').createContext(api));
  Object.assign(api,require('./jobs').createJobs(api,{llm}));
  return api;
}
let singleton;
function getMemoryService(){return singleton ||= createMemoryService({db:require('../../db'),llm:(messages,opts)=>require('../../llmClient').chatCompletionDetailed(messages,null,opts)});}
module.exports={createMemoryService,getMemoryService};
