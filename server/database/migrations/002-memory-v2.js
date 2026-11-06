const { randomUUID } = require('node:crypto');
const { PROFILE_KEYS, DEFAULTS, hash } = require('../../modules/memoryBank/constants');
module.exports = function memoryV2(db) {
  const add = (table, name, definition) => { if (!db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`); };
  for (const [name,def] of Object.entries({ revision:'INTEGER NOT NULL DEFAULT 1', memory_origin:"TEXT NOT NULL DEFAULT 'legacy_unknown'", memory_scope:"TEXT NOT NULL DEFAULT 'main'", memory_text:'TEXT', memory_source_key:'TEXT', occurred_at:'TEXT' })) add('messages',name,def);
  add('memory_profile','revision','INTEGER NOT NULL DEFAULT 1');
  for (const table of ['memory_events','relationship_milestones']) {
    for (const [name,def] of Object.entries({ revision:'INTEGER NOT NULL DEFAULT 1',status:"TEXT NOT NULL DEFAULT 'active'",scope:"TEXT NOT NULL DEFAULT 'main'" })) add(table,name,def);
  }
  add('memory_events','factual_content','TEXT'); add('memory_events','dedup_key','TEXT'); add('memory_events','updated_at','TEXT'); add('relationship_milestones','pinned','INTEGER NOT NULL DEFAULT 0');
  for (const [key,value] of Object.entries(DEFAULTS)) {
    if (key === 'message_threshold') continue;
    add('memory_settings',key,value === null ? 'INTEGER' : typeof value === 'number' ? `INTEGER NOT NULL DEFAULT ${value}` : `TEXT NOT NULL DEFAULT '${value}'`);
  }
  db.exec(`
    CREATE TABLE memory_profile_items(id TEXT PRIMARY KEY,section_key TEXT NOT NULL,content TEXT NOT NULL,separator_before TEXT NOT NULL DEFAULT '',sort_order INTEGER NOT NULL,kind TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'active',origin TEXT NOT NULL,edit_policy TEXT NOT NULL,pinned INTEGER NOT NULL DEFAULT 0,scope TEXT NOT NULL DEFAULT 'main',valid_from TEXT,valid_until TEXT,revision INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE memory_changes(id TEXT PRIMARY KEY,group_id TEXT NOT NULL,operation_key TEXT NOT NULL UNIQUE,target_type TEXT NOT NULL,target_id TEXT NOT NULL,expected_revision INTEGER,new_revision INTEGER,operation_json TEXT NOT NULL,before_json TEXT,after_json TEXT,reason TEXT NOT NULL,actor TEXT NOT NULL,status TEXT NOT NULL,job_id TEXT,reverts_change_id TEXT,created_at TEXT NOT NULL,applied_at TEXT);
    CREATE TABLE memory_sources(id TEXT PRIMARY KEY,change_id TEXT NOT NULL,source_type TEXT NOT NULL,source_id TEXT NOT NULL,source_revision INTEGER,content_hash TEXT,status TEXT NOT NULL DEFAULT 'valid');
    CREATE TABLE memory_jobs(id TEXT PRIMARY KEY,group_id TEXT NOT NULL,pipeline TEXT NOT NULL,mode TEXT NOT NULL,range_start INTEGER,range_end INTEGER,idempotency_key TEXT NOT NULL UNIQUE,payload_json TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'queued',attempts INTEGER NOT NULL DEFAULT 0,next_attempt_at TEXT,lease_owner TEXT,lease_until TEXT,input_hash TEXT NOT NULL,result_json TEXT,error_code TEXT,error_message TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE memory_cursors(pipeline TEXT PRIMARY KEY,live_start_message_id INTEGER NOT NULL,last_contiguous_message_id INTEGER NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE memory_actions(id TEXT PRIMARY KEY,action_key TEXT NOT NULL UNIQUE,tool_name TEXT NOT NULL,args_json TEXT NOT NULL,result_json TEXT,status TEXT NOT NULL,message_id INTEGER,occurred_at TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE memory_tombstones(target_type TEXT NOT NULL,target_id TEXT NOT NULL,deleted_revision INTEGER NOT NULL,operation_key TEXT NOT NULL UNIQUE,dedup_keys_json TEXT NOT NULL DEFAULT '[]',deleted_at TEXT NOT NULL,PRIMARY KEY(target_type,target_id));
    CREATE UNIQUE INDEX memory_message_key ON messages(memory_source_key) WHERE memory_source_key IS NOT NULL;
    CREATE UNIQUE INDEX memory_event_key ON memory_events(dedup_key) WHERE dedup_key IS NOT NULL;
    CREATE UNIQUE INDEX memory_change_revision ON memory_changes(target_type,target_id,new_revision) WHERE status='applied';
    CREATE INDEX memory_items_section ON memory_profile_items(scope,section_key,status,sort_order,id);
    CREATE INDEX memory_source_lookup ON memory_sources(source_type,source_id);
    CREATE INDEX memory_source_change ON memory_sources(change_id);
    CREATE INDEX memory_job_queue ON memory_jobs(pipeline,mode,state,next_attempt_at,range_start);
    CREATE INDEX memory_event_date ON memory_events(scope,status,date,id);
    CREATE INDEX memory_milestone_date ON relationship_milestones(scope,status,date,id);
  `);
  const now = new Date().toISOString(); const group = randomUUID();
  function baseline(type, row, origin = 'legacy_unknown') {
    const id = randomUUID();
    db.prepare(`INSERT INTO memory_changes(id,group_id,operation_key,target_type,target_id,new_revision,operation_json,after_json,reason,actor,status,created_at,applied_at) VALUES(?,?,?,?,?,1,?,?,?,'migration','applied',?,?)`).run(id,group,`baseline:${type}:${row.id}`,type,String(row.id),JSON.stringify({op:'baseline'}),JSON.stringify(row),'升级前原始版本',now,now);
    db.prepare('INSERT INTO memory_sources(id,change_id,source_type,source_id,content_hash) VALUES(?,?,?,?,?)').run(randomUUID(),id,origin,String(row.id),hash(JSON.stringify(row)));
  }
  for (const key of PROFILE_KEYS) {
    const old = db.prepare('SELECT * FROM memory_profile WHERE section_key=?').get(key);
    if (!old || old.content === '') continue;
    const id = randomUUID();
    db.prepare(`INSERT INTO memory_profile_items(id,section_key,content,sort_order,kind,origin,edit_policy,pinned,created_at,updated_at) VALUES(?,?,?,0,?,'legacy','protected',1,?,?)`).run(id,key,old.content,key.includes('最近的状态')?'state':key==='我们的约定'?'commitment':'stable',now,now);
    const item = db.prepare('SELECT * FROM memory_profile_items WHERE id=?').get(id); baseline('profile_item',item);
    if (item.content !== old.content) throw new Error('画像迁移校验失败');
  }
  for (const [type,table] of [['event','memory_events'],['milestone','relationship_milestones']]) {
    // Cursor pagination bounds memory use for large imported archives.
    let after = 0;
    while (true) { const rows = db.prepare(`SELECT * FROM ${table} WHERE id>? ORDER BY id LIMIT 500`).all(after); if (!rows.length) break; for(const row of rows) baseline(type,row); after=rows.at(-1).id; }
  }
  const w = db.prepare('SELECT COALESCE(MAX(id),0) n FROM messages').get().n;
  for (const pipeline of ['events','profile']) db.prepare('INSERT INTO memory_cursors VALUES(?,?,?,?)').run(pipeline,w,w,now);
  db.exec("UPDATE memory_settings SET events_auto_enabled=auto_summary_enabled,profile_mode=CASE WHEN auto_summary_enabled=1 THEN 'auto' ELSE 'off' END WHERE id=1");
};
