const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cybersea-moments-'));
process.env.CYBERSEA_DATA_DIR = temp;
const db = require('../server/db');
let completion = async () => '测试回复';
require('../server/llmClient').chatCompletion = (...args) => completion(...args);
const app = express(); app.use(express.json());
app.use('/api/moments', require('../server/modules/moments/routes'));
const uploadDir = path.resolve(__dirname, '../uploads/moments');
app.use('/uploads/moments', express.static(uploadDir));
app.use((error, req, res, next) => res.status(400).json({error:error.message}));
const uploaded = new Set();
let server, base;
const random = Math.random;
test.before(async () => {
  server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.beforeEach(() => {
  Math.random = () => .99;
  completion = async () => '测试回复';
  db.exec('DELETE FROM moments_comments; DELETE FROM moments_likes; DELETE FROM moments;');
  db.prepare('UPDATE persona SET ai_name=?,user_name=? WHERE id=1').run('测试角色','测试用户');
});
test.after(async () => {
  Math.random = random;
  await new Promise(r => server.close(r));
  db.close(); fs.rmSync(temp, {recursive:true, force:true});
  for (const file of uploaded) fs.unlinkSync(file);
  if (fs.existsSync(uploadDir) && !fs.readdirSync(uploadDir).length) fs.rmdirSync(uploadDir);
});
async function request(url, method='GET', body) {
  return fetch(base+'/api/moments'+url, {method, ...(body===undefined?{}:{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})});
}
async function create(content='今天一起看到了海。') {
  const response=await request('/','POST',{content}); assert.equal(response.status,200); return response.json();
}
test('a fresh instance accepts image uploads and serves the returned files', async () => {
  if (fs.existsSync(uploadDir) && !fs.readdirSync(uploadDir).length) fs.rmdirSync(uploadDir);
  const form = new FormData();
  form.append('files', new Blob([fs.readFileSync(path.join(__dirname,'../public/icon-192.png'))],{type:'image/png'}),'test.png');
  const response = await fetch(base+'/api/moments/upload',{method:'POST',body:form});
  const body = await response.json();
  for(const file of body.paths||[]) uploaded.add(path.join(uploadDir,path.basename(file)));
  assert.equal(response.status,200,JSON.stringify(body)); assert.equal(body.paths.length,1);
  const image = await fetch(base+body.paths[0]); assert.equal(image.status,200); assert.match(image.headers.get('content-type'),/image\/png/);
});
test('publishing validates content and image arrays before writing', async () => {
  for(const body of [{content:'  '},{content:7},{content:{}},{content:'有效正文',images:'invalid'},{content:'有效正文',images:[7]},{content:'有效正文',images:Array(10).fill('/uploads/test.png')}]) {
    assert.equal((await request('/','POST',body)).status,400);
  }
  assert.equal(db.prepare('SELECT COUNT(*) n FROM moments').get().n,0);
});
test('posts, owner filtering, likes, detail and deletion keep consistent data', async () => {
  const moment=await create();
  assert.equal((await (await request('/?owner=user')).json()).moments.length,1);
  assert.equal((await (await request('/?owner=ai')).json()).moments.length,0);
  let liked=await (await request(`/${moment.id}/like`,'POST',{author:'user'})).json(); assert.equal(liked.likes.length,1);
  liked=await (await request(`/${moment.id}/like`,'POST',{author:'user'})).json(); assert.equal(liked.likes.length,0);
  await request(`/${moment.id}/like`,'POST',{author:'user'});
  await request(`/${moment.id}/comments`,'POST',{content:'我也记得。'});
  const detail=await (await request(`/${moment.id}`)).json(); assert.equal(detail.moment.comments.length,2);
  assert.equal((await request(`/${moment.id}`,'DELETE')).status,200);
  assert.equal((await request(`/${moment.id}`)).status,404);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM moments_likes').get().n,0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM moments_comments').get().n,0);
});
test('likes on missing posts return 404 and create no orphan records', async () => {
  assert.equal((await request('/999999/like','POST',{author:'user'})).status,404);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM moments_likes').get().n,0);
});
test('comment replies distinguish the user post from the AI post', async () => {
  let prompt;
  completion=async messages=>{prompt=messages[0].content;return '这确实值得记下来。';};
  const own=await create();
  await request(`/${own.id}/comments`,'POST',{content:'这张照片拍得真好。'});
  assert.match(prompt,/对方发布/); assert.doesNotMatch(prompt,/这是你发/);
  const id=db.prepare("INSERT INTO moments(owner,content) VALUES('ai','测试角色发布的动态')").run().lastInsertRowid;
  await request(`/${id}/comments`,'POST',{content:'我看到了。'});
  assert.match(prompt,/你发布/);
});
test('AI auto-reactions retain the user post when the model fails', async () => {
  Math.random=()=>0;
  completion=async()=>{throw Error('模拟模型不可用');};
  const moment=await create();
  assert.equal(moment.owner,'user'); assert.ok(moment.likes.some(l=>l.author==='ai')); assert.equal(moment.comments.length,0);
});
test('invalid comments never write and a model failure preserves the user comment', async () => {
  const moment=await create();
  for(const content of ['  ',7,{}])assert.equal((await request(`/${moment.id}/comments`,'POST',{content})).status,400);
  completion=async()=>{throw Error('模拟模型不可用');};
  const response=await request(`/${moment.id}/comments`,'POST',{content:'用户的有效评论'}); assert.equal(response.status,200);
  const body=await response.json(); assert.deepEqual(body.comments.map(c=>c.author),['user']);
});
test('deleting a post during AI generation creates no stale comment or server error', async () => {
  const moment=await create(); let resume, entered;
  const started=new Promise(r=>entered=r);
  completion=()=>new Promise(r=>{resume=r;entered();});
  const pending=request(`/${moment.id}/comments`,'POST',{content:'生成回复时删除'});
  await started; await request(`/${moment.id}`,'DELETE'); resume('不应保存的回复');
  assert.equal((await pending).status,404);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM moments_comments').get().n,0);
});
test('AI publishing tools validate input and return the actual saved images', () => {
  const tools={};require('../server/modules/moments/tools')(d=>tools[d.name]=d);
  assert.throws(()=>tools.post_moment.handler({content:'   '}));
  assert.throws(()=>tools.post_moment.handler({content:'有效正文',images:[9]}));
  const posted=tools.post_moment.handler({content:'AI 发的测试动态',images:['/uploads/test.png']}).created;
  assert.deepEqual(JSON.parse(posted.image_path),['/uploads/test.png']);
  assert.equal(tools.query_recent_moments.handler({owner:'ai'}).length,1);
  assert.equal(tools.query_moment_detail.handler({moment_id:posted.id}).content,'AI 发的测试动态');
});
test('bio changes persist through the existing endpoint', async () => {
  const response=await request('/bio','PUT',{user_bio:'测试签名'}); assert.equal(response.status,200);
  assert.equal((await (await request('/bio')).json()).user_bio,'测试签名');
});
