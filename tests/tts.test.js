const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cybersea-tts-'));
process.env.CYBERSEA_DATA_DIR = temp;
const db = require('../server/db');
const app = express(); app.use(express.json()); app.use('/api/tts', require('../server/routes/tts'));
let server, upstream, base, received;
test.before(async () => {
  const service = express(); service.use(express.json());
  service.post('/speech', (req,res) => { received = { body:req.body, auth:req.headers.authorization }; res.type('audio/wav').send(Buffer.from('RIFF-test-audio')); });
  upstream = service.listen(0,'127.0.0.1'); await new Promise(r=>upstream.once('listening',r));
  server = app.listen(0,'127.0.0.1'); await new Promise(r=>server.once('listening',r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => {
  await Promise.all([server,upstream].map(s=>new Promise(r=>s.close(r))));
  db.close(); fs.rmSync(temp,{recursive:true,force:true});
});
async function request(text) { return fetch(base+'/api/tts/synthesize',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text})}); }
test('read-aloud rejects invalid text and reports missing configuration', async () => {
  assert.equal((await request('')).status,400);
  assert.equal((await request({text:'invalid'})).status,400);
  assert.equal((await request('a'.repeat(20001))).status,400);
  const response = await request('你好'); assert.equal(response.status,400);
  assert.match((await response.json()).error,/配置 TTS/);
});
test('read-aloud uses the configured server and key without private voice parameters or message writes', async () => {
  const count = db.prepare('SELECT COUNT(*) n FROM messages').get().n;
  db.prepare('UPDATE settings SET tts_api_url=?,tts_api_key=? WHERE id=1').run(`http://127.0.0.1:${upstream.address().port}/speech`,'test-tts-key');
  const response = await request('你好'); assert.equal(response.status,200);
  assert.match(response.headers.get('content-type'),/audio\/wav/);
  assert.equal(await response.text(),'RIFF-test-audio');
  assert.deepEqual(received,{body:{text:'你好'},auth:'Bearer test-tts-key'});
  assert.equal(db.prepare('SELECT COUNT(*) n FROM messages').get().n,count);
});
