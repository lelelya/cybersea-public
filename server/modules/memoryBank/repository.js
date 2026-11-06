const { TABLES, fail, parse } = require('./constants');
function createRepository(db) {
  let fts = false;
  try {
    const exists = db.prepare("SELECT name FROM sqlite_master WHERE name='memory_search_fts'").get();
    db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS memory_search_fts USING fts5(type UNINDEXED,id UNINDEXED,content,tokenize='trigram')");
    fts = true;
    if (!exists) for (const [type,table] of Object.entries(TABLES)) {
      let after = '';
      while (true) {
        const rows = db.prepare(`SELECT * FROM ${table} WHERE CAST(id AS TEXT)>? ORDER BY CAST(id AS TEXT) LIMIT 300`).all(after);
        if (!rows.length) break;
        for (const row of rows) index(type,row);
        after = String(rows.at(-1).id);
      }
    }
  } catch { fts = false; }
  function table(type) { if (!TABLES[type]) fail('INVALID_TYPE','未知记忆类型'); return TABLES[type]; }
  function get(type,id) { return db.prepare(`SELECT * FROM ${table(type)} WHERE id=?`).get(id); }
  function index(type,row) {
    if (!fts) return;
    db.prepare('DELETE FROM memory_search_fts WHERE type=? AND id=?').run(type,String(row.id));
    if(row.status==='active' && row.scope==='main') db.prepare('INSERT INTO memory_search_fts(type,id,content) VALUES(?,?,?)').run(type,String(row.id),[row.title,row.content,row.description,row.factual_content].filter(Boolean).join('\n'));
  }
  function insert(tableName,row) { const keys=Object.keys(row); db.prepare(`INSERT INTO ${tableName}(${keys.join(',')}) VALUES(${keys.map(()=>'?').join(',')})`).run(...keys.map(k=>row[k]??null)); }
  function update(tableName,id,row,revision) {
    const keys=Object.keys(row).filter(k=>k!=='id');
    const result=db.prepare(`UPDATE ${tableName} SET ${keys.map(k=>`${k}=?`).join(',')} WHERE id=?${revision==null?'':' AND revision=?'}`).run(...keys.map(k=>row[k]??null),id,...(revision==null?[]:[revision]));
    if(Number(result.changes)!==1) fail('REVISION_CONFLICT','内容已经变化，请查看最新内容后再保存',409);
  }
  function sources(type,id) {
    const row=get(type,id); if(!row) return [];
    return db.prepare("SELECT s.* FROM memory_sources s JOIN memory_changes c ON c.id=s.change_id WHERE c.target_type=? AND c.target_id=? AND c.new_revision=? AND c.status='applied'").all(type,String(id),row.revision);
  }
  function refreshSection(key,now) {
    const rows=db.prepare("SELECT * FROM memory_profile_items WHERE section_key=? AND status!='archived' ORDER BY sort_order,id").all(key);
    const content=rows.map((r,i)=>(i?r.separator_before:'')+r.content).join('');
    db.prepare("INSERT INTO memory_profile(section_key,content,updated_at,revision) VALUES(?,?,?,1) ON CONFLICT(section_key) DO UPDATE SET content=excluded.content,updated_at=excluded.updated_at,revision=memory_profile.revision+1").run(key,content,now);
  }
  return {db,table,get,insert,update,index,sources,refreshSection,get fts(){return fts;},parse};
}
module.exports={createRepository};
