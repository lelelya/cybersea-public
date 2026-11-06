const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {isolatedApp}=require('./helpers/isolatedApp');let a;
test.before(async()=>a=await isolatedApp());test.after(async()=>a&&await a.close());test.beforeEach(()=>a.reset());
const world={world_setting:{description:'虚构海边'},ai_character:{description:'旅人'},user_character:{description:'画家'}};
const node=()=>({content:JSON.stringify({narration:'海边',his_words:'你好',my_description:'看海',options:['继续','离开'],is_ending:false})});
async function makeWorld(){a.enqueue(node());const r=await a.api('/api/parallel-world','POST',world);assert.equal(r.status,200);return r.body.save.id;}
test('CS-003: exhausted tool budget gets a final answer and reports unexecuted calls',async()=>{
 a.enqueue({calls:Array.from({length:9},()=>({name:'query_persona'}))},{content:'已完成允许范围内的查询，另一个未执行。'});
 const r=await a.api('/api/chat','POST',{message:'查询工具预算'});assert.equal(r.status,200);assert.match(r.body.reply,/未执行/);assert.equal(r.body.tool_calls.length,8);assert.ok(r.body.warnings?.length);assert.equal(a.requests.length,2);assert.equal(a.requests[1].tools,undefined);
});
test('CS-004/019: failed and truncated model replies leave no duplicate messages',async()=>{
 for(const response of [{status:500,error:'模拟失败'},{content:'半句话',finish:'length'},{content:'',finish:'length'},{content:'',finish:'content_filter'}]){
  const text='失败重试 '+JSON.stringify(response);a.enqueue(response);const r=await a.api('/api/chat','POST',{message:text});assert.ok(r.status>=400);assert.equal(a.db.prepare('SELECT COUNT(*) n FROM messages WHERE content=?').get(text).n,0);
  const retry=await a.api('/api/chat','POST',{message:text});assert.equal(retry.status,200);assert.equal(a.db.prepare('SELECT COUNT(*) n FROM messages WHERE content=?').get(text).n,1);
 }
});
test('CS-005: does not support tools causes legacy retry',async()=>{
 a.db.prepare("UPDATE settings SET model='legacy-wording' WHERE id=1").run();a.enqueue({status:400,error:'This model does not support tools.'},{content:'旧协议成功'});
 const r=await a.api('/api/chat','POST',{message:'回退检查'});assert.equal(r.status,200);assert.ok(a.requests[1].functions);a.db.prepare("UPDATE settings SET model='test-model' WHERE id=1").run();
});
test('CS-006/020: calendar and anniversary routes and tools reject invalid dates',async()=>{
 for(const date of ['',null,'2026/11/07','2026-02-30','2026-13-01','2026-11-08 21:00']){
  assert.equal((await a.api('/api/calendar/events','POST',{title:'错误日程',date})).status,400);
  assert.equal((await a.api('/api/anniversary','POST',{name:'错误纪念日',date})).status,400);
  a.enqueue({calls:[{name:'add_event',args:{title:'工具错误日期',date}},{name:'create_anniversary',args:{name:'工具错误日期',date}}]},{content:'日期不合法'});await a.api('/api/chat','POST',{message:'日期检查'});
 }
 assert.equal(a.db.prepare("SELECT COUNT(*) n FROM events WHERE title='工具错误日期'").get().n,0);assert.equal(a.db.prepare("SELECT COUNT(*) n FROM anniversaries WHERE name='工具错误日期'").get().n,0);
 assert.equal((await a.api('/api/anniversary','POST',{name:'合法闰日',date:'2024-02-29'})).status,200);
 const event=(await a.api('/api/calendar/events','POST',{title:'合法日程',date:'2024-02-29'})).body.event;
 for(const date of ['',null]){
  assert.equal((await a.api('/api/calendar/events/'+event.id,'PUT',{date})).status,400);
  a.enqueue({calls:[{name:'update_event',args:{id:event.id,date}}]},{content:'不能清空日期'});await a.api('/api/chat','POST',{message:'清空日期检查'});
 }
 assert.equal(a.db.prepare('SELECT date FROM events WHERE id=?').get(event.id).date,'2024-02-29');
});
test('CS-007: failed or malformed world generation never leaves empty saves',async()=>{
 const before=a.db.prepare('SELECT COUNT(*) n FROM story_saves').get().n;
 for(const reply of [{status:500,error:'模拟错误'},{content:'{"narration":"缺少角色正文"}'}]){a.enqueue(reply);assert.ok((await a.api('/api/parallel-world','POST',world)).status>=400);assert.equal(a.db.prepare('SELECT COUNT(*) n FROM story_saves').get().n,before);}
});
test('CS-008: parallel advances conflict without overwriting the committed choice',async()=>{
 const id=await makeWorld();a.reset();a.enqueue({...node(),delay:150},node());
 const first=a.api(`/api/parallel-world/${id}/advance`,'POST',{choice:'继续'});await a.called(1);const second=a.api(`/api/parallel-world/${id}/advance`,'POST',{choice:'离开'});
 const rows=await Promise.all([first,second]);assert.deepEqual(rows.map(r=>r.status).sort(),[200,409]);
 const nodes=a.db.prepare('SELECT * FROM story_nodes WHERE save_id=? ORDER BY node_index').all(id);assert.equal(nodes.length,2);assert.equal(nodes[0].user_choice,'继续');
});
test('CS-010: plan deletion or edits during model generation do not write stale feedback',async()=>{
 const id=(await a.api('/api/plan','POST',{category:'mine',content:'测试计划',created_by:'user'})).body.id;
 await a.api(`/api/plan/${id}/check`,'POST',{checker:'user',checked:true});await a.api(`/api/plan/${id}`,'PUT',{result:'已经完成'});
 a.enqueue({content:'评语',delay:150});const pending=a.api(`/api/plan/${id}/ai-fill`,'POST',{});await a.called(1);await a.api(`/api/plan/${id}`,'DELETE');assert.equal((await pending).status,404);
});
test('CS-011: book list reports actual content length without returning the full text',async()=>{
 const id=(await a.api('/api/books','POST',{title:'虚构书籍'})).body.book.id;a.db.prepare('UPDATE books SET content=? WHERE id=?').run('一二三四五',id);
 const book=(await a.api('/api/books')).body.books.find(b=>b.id===id);assert.equal(book.content_length,5);assert.equal(book.content,undefined);
});
test('CS-013: import reports actual inserted and skipped messages',async()=>{
 const r=await a.api('/api/messages/import','POST',{messages:[{role:'user',content:'导入有效'},{role:'bad',content:'非法角色'},{role:'ai',content:''}]});assert.equal(r.body.imported,1);assert.equal(r.body.skipped,2);
});
test('CS-014: editing a story invalidates audio and paging markers are never spoken',async()=>{
 const id=(await a.api('/api/stories','POST',{title:'虚构故事',content:'第一页\n---PAGE---\n第二页'})).body.item.id;
 const first=await a.api(`/api/stories/${id}/tts`,'POST',{});assert.equal(first.status,200);assert.doesNotMatch(a.speech[0],/---PAGE---/);
 await a.api(`/api/stories/${id}`,'PUT',{content:'新的正文'});assert.equal(a.db.prepare('SELECT audio_path FROM stories WHERE id=?').get(id).audio_path,'');
 const second=await a.api(`/api/stories/${id}/tts`,'POST',{});assert.equal(second.status,200);assert.notEqual(second.body.audio_path,first.body.audio_path);assert.equal(a.speech.at(-1),'新的正文');
});
test('CS-015: deleting a photo cleans only owned, unreferenced files',async()=>{
 const form=new FormData();form.append('file',new Blob([fs.readFileSync(path.join(a.root,'public/icon-192.png'))],{type:'image/png'}),'test.png');const photo=(await a.api('/api/album/photos/upload','POST',form)).body;
 const file=path.join(a.root,photo.path);assert.ok(fs.existsSync(file));assert.equal((await a.api(`/api/album/photos/${photo.id}`,'DELETE')).status,200);assert.equal(fs.existsSync(file),false);
 assert.equal((await a.api('/api/album/photos/999999','DELETE')).status,404);
});
test('CS-016: missing TTS targets and missing posts return 404 without synthesizing audio',async()=>{
 assert.equal((await a.api('/api/tts','POST',{text:'不应合成',message_id:999999})).status,404);assert.equal(a.speech.length,0);assert.equal((await a.api('/api/moments/999999','DELETE')).status,404);
});
test('CS-017: chat search finds voice transcripts and image descriptions',async()=>{
 a.db.prepare("INSERT INTO messages(role,content,type,transcript,memory_text) VALUES('user','','voice','独特转写词',NULL),('user','','image','','独特图片词')").run();
 for(const q of ['独特转写词','独特图片词'])assert.equal((await a.api('/api/messages/search?q='+encodeURIComponent(q))).body.messages.length,1);
});
test('CS-018: malformed image data adds neither files nor messages',async()=>{
 const before=a.db.prepare('SELECT COUNT(*) n FROM messages').get().n;const files=fs.readdirSync(path.join(a.root,'uploads')).sort();
 const r=await a.api('/api/chat','POST',{type:'image',image_data:'data:image/png;base64,!!!not-base64!!!'});assert.equal(r.status,400);assert.equal(a.db.prepare('SELECT COUNT(*) n FROM messages').get().n,before);assert.deepEqual(fs.readdirSync(path.join(a.root,'uploads')).sort(),files);
});
test('CS-004: a model failure after a write retains identifiable user evidence',async()=>{
 a.enqueue({calls:[{name:'post_moment',args:{content:'已确认的写入'}}]},{status:500,error:'写入后模拟失败'});
 const r=await a.api('/api/chat','POST',{message:'写入后的失败处理'});assert.equal(r.status,500);assert.equal(r.body.partial_actions,true);assert.ok(r.body.user_message_id);assert.ok(a.db.prepare('SELECT id FROM messages WHERE id=?').get(r.body.user_message_id));assert.ok(a.db.prepare("SELECT id FROM moments WHERE content='已确认的写入'").get());
});
test('CS-015: shared uploads are retained until the last reference is removed',async()=>{
 const file=path.join(a.root,'uploads/shared-test.png');fs.copyFileSync(path.join(a.root,'public/icon-192.png'),file);
 const photo=()=>a.db.prepare("INSERT INTO album_photos(owner,path) VALUES('user','/uploads/shared-test.png')").run().lastInsertRowid;
 const first=photo(),second=photo();await a.api('/api/album/photos/'+first,'DELETE');assert.ok(fs.existsSync(file));await a.api('/api/album/photos/'+second,'DELETE');assert.equal(fs.existsSync(file),false);
});
test('CS-014: replacing story content removes obsolete cached audio',async()=>{
 const id=(await a.api('/api/stories','POST',{title:'竞态故事',content:'旧正文'})).body.item.id;
 const first=await a.api(`/api/stories/${id}/tts`,'POST',{});assert.equal(first.status,200);
 await a.api(`/api/stories/${id}`,'PUT',{content:'新正文'});assert.equal(a.db.prepare('SELECT audio_path FROM stories WHERE id=?').get(id).audio_path,'');assert.equal(fs.existsSync(path.join(a.root,first.body.audio_path)),false);
});
