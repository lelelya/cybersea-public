const test=require('node:test'),assert=require('node:assert/strict');
const {isolatedApp}=require('./helpers/isolatedApp');let app;
test.before(async()=>{app=await isolatedApp();});test.after(async()=>{if(app)await app.close();});
async function root(author='ai'){return (await app.api('/api/letters','POST',{author,title:'虚构测试信',content:'根信正文'})).body.letter;}
async function reply(id,author='ai'){return (await app.api('/api/letters/'+id+'/reply','POST',{author,content:'虚构回复'})).body.letter;}
const read=id=>app.db.prepare('SELECT is_read FROM letters WHERE id=?').get(id).is_read;

test('CS-026: all letter filters expose unread replies beyond the first reply',async()=>{
 const r=await root('user'),first=await reply(r.id,'user'),ai=await reply(first.id);
 for(const filter of ['', '?author=ai','?author=user']){
  const letters=(await app.api('/api/letters'+filter)).body.letters;
  assert.ok(letters.filter(l=>(l.root_id||l.id)===r.id).every(l=>l.has_unread_replies===true));
 }
 assert.equal((await app.api('/api/letters/'+r.id+'/read','PUT',{})).status,200);
 assert.equal(read(r.id),1);assert.equal(read(ai.id),1);assert.equal(read(first.id),0);
 const letters=(await app.api('/api/letters')).body.letters;assert.equal(letters.find(l=>l.id===r.id).has_unread_replies,false);
});

test('CS-026: viewed snapshots preserve later and unrelated unread AI letters',async()=>{
 const r=await root(),shown=await reply(r.id),unrelated=await root();
 const ids=(await app.api('/api/letters/'+shown.id+'/thread')).body.thread.map(l=>l.id);
 const later=await reply(r.id);
 assert.equal((await app.api('/api/letters/'+shown.id+'/read','PUT',{letter_ids:ids})).status,200);
 assert.equal(read(r.id),1);assert.equal(read(shown.id),1);assert.equal(read(later.id),0);assert.equal(read(unrelated.id),0);
 assert.equal((await app.api('/api/letters?author=ai')).body.letters.find(l=>l.id===r.id).has_unread_replies,true);
 assert.equal((await app.api('/api/letters/'+r.id+'/read','PUT',{letter_ids:['wrong']})).status,400);
 assert.equal(read(later.id),0);
 assert.equal((await app.api('/api/letters/999999/read','PUT',{})).status,404);
});
