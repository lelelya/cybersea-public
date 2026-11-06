const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { migrate } = require('../server/database/migrate');
const { isolatedApp } = require('./helpers/isolatedApp');
let app;
test.before(async () => { app = await isolatedApp(); });
test.after(async () => { if (app) await app.close(); });
function form(bytes, type='image/png') {
  const data = new FormData();
  data.append('file', new Blob([bytes], { type }), 'portrait.png');
  return data;
}

test('portrait migration preserves existing persona, avatars and memory', () => {
  const db = new DatabaseSync(':memory:');
  try {
    migrate(db, undefined, [
      {version:1,name:'baseline',up:require('../server/database/migrations/001-baseline')},
      {version:2,name:'memory-v2',up:require('../server/database/migrations/002-memory-v2')},
    ]);
    db.prepare("UPDATE persona SET ai_name='虚构角色',ai_avatar_path='/uploads/existing-avatar.png',fixed_settings='[\"原设定\"]' WHERE id=1").run();
    db.prepare("UPDATE memory_profile SET content='保留的虚构记忆' WHERE section_key='我们的关系'").run();
    migrate(db);
    migrate(db);
    const p = db.prepare('SELECT * FROM persona WHERE id=1').get();
    assert.equal(p.ai_name,'虚构角色');
    assert.equal(p.ai_avatar_path,'/uploads/existing-avatar.png');
    assert.equal(p.fixed_settings,'["原设定"]');
    assert.equal(p.ai_portrait_path,'');
    assert.equal(p.user_portrait_path,'');
    assert.equal(db.prepare("SELECT content FROM memory_profile WHERE section_key='我们的关系'").get().content,'保留的虚构记忆');
    assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
  } finally { db.close(); }
});

test('each portrait uploads and persists independently without changing avatars', async () => {
  await app.api('/api/persona','PUT',{ai_avatar_path:'/images/avatar-ai.svg',user_avatar_path:'/images/avatar-user.svg'});
  const image=fs.readFileSync(path.join(app.root,'public/icon-192.png'));
  const ai=await app.api('/api/persona/ai/portrait','POST',form(image));
  const user=await app.api('/api/persona/user/portrait','POST',form(image));
  assert.equal(ai.status,200);assert.equal(user.status,200);
  const persona=(await app.api('/api/persona')).body;
  assert.equal(persona.ai_portrait_path,ai.body.path);assert.equal(persona.user_portrait_path,user.body.path);
  assert.notEqual(ai.body.path,user.body.path);
  assert.equal(persona.ai_avatar_path,'/images/avatar-ai.svg');assert.equal(persona.user_avatar_path,'/images/avatar-user.svg');
  assert.ok(fs.existsSync(path.join(app.root,ai.body.path)));
  const next=await app.api('/api/persona/ai/portrait','POST',form(image));assert.equal(next.status,200);
  assert.equal(fs.existsSync(path.join(app.root,ai.body.path)),false);
  assert.ok(fs.existsSync(path.join(app.root,user.body.path)));
});

test('invalid portraits do not replace the saved image or leave files', async () => {
  const before=(await app.api('/api/persona')).body.ai_portrait_path;
  const files=fs.readdirSync(path.join(app.root,'uploads')).sort();
  for (const [owner,bytes,mime] of [['ai','broken','image/png'],['ai','<svg/>','image/svg+xml'],['other','broken','image/png']]) {
    assert.equal((await app.api('/api/persona/'+owner+'/portrait','POST',form(bytes,mime))).status,400);
  }
  assert.equal((await app.api('/api/persona')).body.ai_portrait_path,before);
  assert.deepEqual(fs.readdirSync(path.join(app.root,'uploads')).sort(),files);
});

test('deleting an album photo retains its file while a portrait references it', async () => {
  const src=(await app.api('/api/persona')).body.user_portrait_path;
  const id=app.db.prepare("INSERT INTO album_photos(owner,path) VALUES('user',?)").run(src).lastInsertRowid;
  assert.equal((await app.api('/api/album/photos/'+id,'DELETE')).status,200);
  assert.ok(fs.existsSync(path.join(app.root,src)));
});
