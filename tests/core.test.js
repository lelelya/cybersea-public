const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { migrate, backupDatabase } = require('../server/database/migrate');
const { createAccessControl } = require('../server/security/access');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cybersea-test-'));
process.env.CYBERSEA_DATA_DIR = temp;
test.after(() => {
  const cached = require.cache[require.resolve('../server/db')];
  if (cached) cached.exports.close();
  fs.rmSync(temp, { recursive: true, force: true });
});

test('baseline upgrades legacy messages, preserves records, and runs once', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec("CREATE TABLE messages (id INTEGER PRIMARY KEY AUTOINCREMENT, role TEXT NOT NULL CHECK(role IN ('user','ai')), content TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP); INSERT INTO messages(role, content) VALUES ('user', 'original')");
    migrate(db);
    assert.equal(db.prepare('SELECT content FROM messages WHERE id=1').get().content, 'original');
    db.prepare("INSERT INTO messages(role,content,type) VALUES ('system','notice','tool_notification')").run();
    migrate(db);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM messages').get().n, 2);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get().n, 3);
    assert.ok(db.prepare('PRAGMA table_info(settings)').all().some(c => c.name === 'tts_api_key'));
    assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  } finally { db.close(); }
});

test('migration failures roll back schema and version marker together', () => {
  const db = new DatabaseSync(':memory:');
  try {
    assert.throws(() => migrate(db, undefined, [{ version: 1, name: 'broken', up(db) { db.exec('CREATE TABLE partial(id)'); throw new Error('failure'); } }]), /failure/);
    assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name IN ('partial','schema_migrations')").all().length, 0);
  } finally { db.close(); }
});

test('consistent backup includes WAL data and migration backup precedes changes', () => {
  const db = new DatabaseSync(path.join(temp, 'backup-source.db'));
  try {
    db.exec("PRAGMA journal_mode=WAL; CREATE TABLE evidence(value); INSERT INTO evidence VALUES ('kept')");
    const output = backupDatabase(db, path.join(temp, 'backups'));
    const copy = new DatabaseSync(output, { readOnly: true });
    assert.equal(copy.prepare('SELECT value FROM evidence').get().value, 'kept');
    copy.close();
    migrate(db, path.join(temp, 'before'));
    const before = new DatabaseSync(path.join(temp, 'before', fs.readdirSync(path.join(temp, 'before'))[0]), { readOnly: true });
    assert.equal(before.prepare("SELECT name FROM sqlite_master WHERE name='schema_migrations'").get(), undefined);
    before.close();
  } finally { db.close(); }
});

test('HTTP and WebSocket share credentials and reject foreign origins', () => {
  const access = createAccessControl({ CYBERSEA_AUTH_USER: 'owner', CYBERSEA_AUTH_PASSWORD: 'secret' });
  const headers = { host: 'example.test', authorization: 'Basic ' + Buffer.from('owner:secret').toString('base64'), origin: 'https://example.test' };
  assert.equal(access.authorizeUpgrade({ headers }), true);
  assert.equal(access.authorizeUpgrade({ headers: { ...headers, authorization: '' } }), false);
  assert.equal(access.authorizeUpgrade({ headers: { ...headers, origin: 'https://other.test' } }), false);
  assert.throws(() => createAccessControl({ CYBERSEA_AUTH_USER: 'owner' }), /同时配置/);
});

test('tool definitions and order match the pre-refactor contract', () => {
  const tools = require('../server/modules/functionCalling');
  const expected = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/tool-definitions.json'), 'utf8'));
  assert.deepEqual(tools.getDefinitions(), expected);
});

test('tool loop keeps letter token override, writes, economy messages and MCP errors', async () => {
  const { runToolLoop } = require('../server/chat/toolLoop');
  const sequence = [
    { function_call: { name: 'write_letter', arguments: '{}' } },
    { function_call: { name: 'mcp_demo', arguments: '{}' } },
    { content: 'done' },
  ];
  const options = [];
  const messages = [];
  const result = await runToolLoop(messages, [], {
    chatCompletion: async (messages, functions, opts) => { options.push(opts); return sequence.shift(); },
    functionCalling: { getDefinitions: () => [], execute: async name => ({ is_write: true, fn_name: name, fn_args: {}, result: { economy_message: { id: 3 } } }) },
    mcpClient: { callTool: async () => { throw new Error('offline'); } },
  });
  assert.deepEqual(options, [{}, { maxTokensOverride: 4096 }, { maxTokensOverride: 4096 }]);
  assert.equal(result.aiReply, 'done');
  assert.equal(result.writeCalls.length, 1);
  assert.deepEqual(result.economyMessages, [{ id: 3 }]);
  assert.equal(messages[3].content, '"offline"');
});

test('tool loop stops at eight executions and requests a final answer without tools', async () => {
  const { runToolLoop } = require('../server/chat/toolLoop');
  let count = 0, executions = 0;
  const result = await runToolLoop([], [], {
    chatCompletion: async (messages, functions) => { count++; return functions.length ? { function_call: { name: 'query', arguments: '{}' } } : {content:'已完成前八次查询'}; },
    functionCalling: { getDefinitions: () => [{name:'query',parameters:{}}], execute: async () => { executions++; return {result:[]}; } },
  });
  assert.equal(count, 9);
  assert.equal(executions, 8);
  assert.equal(result.aiReply, '已完成前八次查询');
  assert.equal(result.warnings[0].code,'TOOL_LIMIT_REACHED');
});

test('message deletion removes associated favorites via the existing route', async () => {
  const db = require('../server/db');
  const message = db.prepare("INSERT INTO messages(role, content, type) VALUES ('user','delete me','text')").run();
  db.prepare("INSERT INTO favorites(message_id,content,role) VALUES (?,'saved','user')").run(message.lastInsertRowid);
  const express = require('express');
  const app = express();
  app.use(express.json());
  app.use('/api/messages', require('../server/routes/messages'));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/messages/${message.lastInsertRowid}`, { method: 'DELETE' });
    assert.equal(response.status, 200);
    assert.equal(db.prepare('SELECT * FROM messages WHERE id=?').get(message.lastInsertRowid), undefined);
    assert.equal(db.prepare('SELECT * FROM favorites WHERE message_id=?').get(message.lastInsertRowid), undefined);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('application starts with isolated data and protects HTTP and WebSocket', { timeout: 15000 }, async () => {
  const { spawn } = require('node:child_process');
  const child = spawn(process.execPath, [path.join(__dirname, '../server/index.js')], {
    cwd: temp,
    env: { ...process.env, PORT: '0', HOST: '127.0.0.1', CYBERSEA_DATA_DIR: path.join(temp, 'smoke'), CYBERSEA_AUTH_USER: 'owner', CYBERSEA_AUTH_PASSWORD: 'secret', CYBERSEA_DISABLE_SCHEDULERS: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  const exited = new Promise(resolve => child.once('exit', resolve));
  try {
    const url = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('startup timed out')), 8000);
      child.stdout.on('data', chunk => {
        output += chunk;
        const match = output.match(/http:\/\/127\.0\.0\.1:\d+/);
        if (match) { clearTimeout(timer); resolve(match[0]); }
      });
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', code => { clearTimeout(timer); reject(new Error('startup exited: ' + code)); });
    });
    const headers = { authorization: 'Basic ' + Buffer.from('owner:secret').toString('base64') };
    assert.equal((await fetch(url + '/api/health')).status, 401);
    assert.deepEqual(await (await fetch(url + '/api/health', { headers })).json(), { status: 'ok' });
    assert.equal((await fetch(url + '/', { headers })).status, 200);
    assert.equal((await fetch(url + '/js/shared.js', { headers })).status, 200);
    assert.equal((await fetch(url + '/api/health', { headers: { ...headers, origin: 'https://foreign.test' } })).status, 403);
    const WebSocket = require('ws');
    await new Promise((resolve, reject) => {
      const ws = new WebSocket(url.replace('http:', 'ws:') + '/ws');
      ws.once('unexpected-response', (req, res) => { res.resume(); ws.terminate(); assert.equal(res.statusCode, 401); resolve(); });
      ws.once('open', () => { ws.terminate(); reject(new Error('unauthorized upgrade accepted')); });
      ws.on('error', () => {});
    });
    await new Promise((resolve, reject) => {
      const ws = new WebSocket(url.replace('http:', 'ws:') + '/ws', { headers });
      ws.once('open', () => ws.send(JSON.stringify({ type: 'auth', peerId: 'user' })));
      ws.once('message', raw => { assert.equal(JSON.parse(raw).type, 'auth_ok'); ws.close(); });
      ws.once('close', resolve);
      ws.once('error', reject);
    });
  } finally {
    child.kill();
    await exited;
  }
});

test('public pages load shared helpers before page scripts', () => {
  const publicDir = path.join(__dirname, '../public');
  for (const file of fs.readdirSync(publicDir).filter(file => file.endsWith('.html'))) {
    const html = fs.readFileSync(path.join(publicDir, file), 'utf8');
    assert.ok(html.indexOf('js/shared.js') >= 0, file);
    assert.ok(html.indexOf('js/shared.js') < html.indexOf('js/bgm-player.js'), file);
  }
});
