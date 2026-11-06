const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
process.env.CYBERSEA_DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'cybersea-memory-http-'));
process.env.CYBERSEA_DISABLE_SCHEDULERS='1';
const db=require('../server/db'),llm=require('../server/llmClient');
let complete=async()=>({content:'合成回复'});
llm.chatCompletion=async(...args)=>complete(...args);
llm.chatCompletionDetailed=async()=>({content:'{"events":[]}',finish_reason:'stop'});
const service=require('../server/modules/memoryBank/service').getMemoryService();
const express=require('express'),app=express();app.use(express.json());
app.use('/api/memoryBank',require('../server/modules/memoryBank/routes'));
app.use('/api/messages',require('../server/routes/messages'));
app.use('/api/chat',require('../server/routes/chat'));
let server,base;
test.before(async()=>{server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));base=`http://127.0.0.1:${server.address().port}`;});
test.after(async()=>{await new Promise(r=>server.close(r));service.stop();db.close();});
async function request(url,method='GET',body){const r=await fetch(base+url,{method,headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json()};}
test('HTTP revisions, update conflicts and source envelopes use the published contracts',async()=>{
 const created=await request('/api/memoryBank/profile/items','POST',{section_key:'她的画像 - 关于她',content:'HTTP 合成画像'});assert.equal(created.status,201);const id=created.body.item.id;
 assert.equal((await request('/api/memoryBank/profile/items/'+id,'PATCH',{content:'缺少版本'})).status,428);
 assert.equal((await request('/api/memoryBank/profile/items/'+id,'PATCH',{content:'新版本',expected_revision:1})).status,200);
 assert.equal((await request('/api/memoryBank/profile/items/'+id,'PATCH',{content:'旧版本覆盖',expected_revision:1})).status,409);
 const detail=await request('/api/memoryBank/detail/profile_item/'+id);assert.equal(detail.body.item.content,'新版本');assert.ok(Array.isArray(detail.body.sources));
});
test('real chat route executes a local profile tool with server-supplied evidence',async()=>{
 service.setSettings({profile_mode:'auto'});let called=0;
 complete=async messages=>{called++;if(called===1){const source=Number(messages.at(-1).content.match(/消息 (\d+)/)[1]);return {function_call:{name:'propose_profile_change',arguments:JSON.stringify({operations:[{op:'add_item',section_key:'她的画像 - 心愿与底线',content:'聊天集成：她希望保留表达的原因和例外。',reason:'用户明确说明',source_message_ids:[source]}]})}};}return {content:'我会记住你的表达。'};};
 const r=await request('/api/chat','POST',{message:'请记住，我希望保留表达的原因和例外。'});assert.equal(r.status,200);assert.equal(called,2);assert.equal(r.body.reply,'我会记住你的表达。');
 const item=service.getProfile().profile.flatMap(s=>s.items).find(i=>i.content.startsWith('聊天集成：'));assert.ok(item);assert.equal(service.repo.sources('profile_item',item.id)[0].source_type,'message');assert.ok(!r.body.tool_calls.includes('propose_profile_change'));
});
test('tool execution detects business errors and a repeated successful action cannot write twice',async()=>{
 const tools=require('../server/modules/functionCalling');const count=db.prepare('SELECT COUNT(*) n FROM memory_actions').get().n;
 const bad=await tools.execute('send_red_packet','{"amount":-2}',{requestId:'http-bad'});assert.ok(bad.error);assert.equal(db.prepare('SELECT COUNT(*) n FROM memory_actions').get().n,count);
 const args=JSON.stringify({title:'合成信',content:'只写一次'}),ctx={requestId:'http-letter',iteration:0};await tools.execute('write_letter',args,ctx);await tools.execute('write_letter',args,ctx);
 assert.equal(db.prepare("SELECT COUNT(*) n FROM letters WHERE title='合成信'").get().n,1);assert.equal(db.prepare("SELECT COUNT(*) n FROM memory_actions WHERE action_key='http-letter:0:write_letter'").get().n,1);
});
test('editing original messages invalidates derived memory through the HTTP route',async()=>{
 const item=service.getProfile().profile.flatMap(s=>s.items).find(i=>i.content.startsWith('聊天集成：'));const ref=service.repo.sources('profile_item',item.id)[0];
 const r=await request('/api/messages/'+ref.source_id,'PUT',{content:'我修正了原来的说法。'});assert.equal(r.status,200);assert.equal(service.repo.get('profile_item',item.id).status,'needs_review');
 assert.equal(service.searchMemories({query:'聊天集成',type:'profile_item'}).items.length,0);
});
test('HTTP summarize returns durable jobs and accurate completion without real model access',async()=>{
 const r=await request('/api/memoryBank/summarize','POST',{pipelines:['events']});assert.equal(r.status,202);assert.ok(r.body.group_id);for(const j of r.body.jobs)await service.runJob(j.id);
 const jobs=await request('/api/memoryBank/jobs?group_id='+r.body.group_id);assert.ok(jobs.body.jobs.every(j=>j.state==='succeeded'));assert.equal((await request('/api/memoryBank/status')).status,200);
});
