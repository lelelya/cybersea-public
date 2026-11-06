const {TABLES,fail,hash,parse}=require('./constants');
function createRetrieval(api,{fts=true}={}) {
  const {db,repo}=api;
  function searchMemories({query='',q,type,date,dateFrom,dateTo,limit=20,cursor,scope='main',includeReview=false}={}) {
    query=String(q??query).trim().slice(0,500);if(scope!=='main')fail('INVALID_SCOPE','当前只支持主记忆');
    if(type&&!TABLES[type])fail('INVALID_TYPE','未知记忆类型');
    limit=Math.min(50,Math.max(1,Math.floor(Number(limit)||20)));
    const filter=hash({query,type,date,dateFrom,dateTo,scope,includeReview});let anchor=null;
    if(cursor){anchor=parse(Buffer.from(cursor,'base64url').toString());if(!anchor||anchor.filter!==filter)fail('INVALID_CURSOR','分页条件已变化');}
    const types=type?[type]:Object.keys(TABLES),rows=[];
    for(const t of types){
      const table=TABLES[t],text=t==='milestone'?"title||' '||description":t==='event'?"content||' '||COALESCE(factual_content,'')":'content',day=t==='profile_item'?"substr(updated_at,1,10)":'date';
      const where=["scope='main'",includeReview?"status!='archived'":"status='active'"],args=[];
      if(t==='profile_item')where.push('(valid_until IS NULL OR valid_until>?)'),args.push(api.now());
      if(date)where.push(`${day}=?`),args.push(date);
      if(dateFrom)where.push(`${day}>=?`),args.push(dateFrom);
      if(dateTo)where.push(`${day}<=?`),args.push(dateTo);
      if(query){
        // Trigram handles contiguous CJK; LIKE covers short queries and unavailable FTS.
        if(!includeReview&&fts&&repo.fts&&Array.from(query).length>=3){where.push("CAST(id AS TEXT) IN (SELECT id FROM memory_search_fts WHERE type=? AND memory_search_fts MATCH ?)");args.push(t,'"'+query.replace(/"/g,'""')+'"');}
        else {where.push(`${text} LIKE ? ESCAPE '\\'`);args.push('%'+query.replace(/[\\%_]/g,'\\$&')+'%');}
      }
      if(anchor){where.push(`(${day}<? OR (${day}=? AND (?<? OR (?=? AND CAST(id AS TEXT)<?))))`);args.push(anchor.day,anchor.day,t,anchor.type,t,anchor.type,anchor.id);}
      for(const item of db.prepare(`SELECT *,${day} AS memory_day FROM ${table} WHERE ${where.join(' AND ')} ORDER BY ${day} DESC,CAST(id AS TEXT) DESC LIMIT ?`).all(...args,limit+1))rows.push({type:t,id:String(item.id),date:item.memory_day,item});
    }
    rows.sort((a,b)=>b.date.localeCompare(a.date)||b.type.localeCompare(a.type)||b.id.localeCompare(a.id));
    const items=rows.slice(0,limit),last=items.at(-1),has=rows.length>limit;
    return {items,has_more:has,next_cursor:has?Buffer.from(JSON.stringify({day:last.date,type:last.type,id:last.id,filter})).toString('base64url'):null};
  }
  return {searchMemories};
}
module.exports={createRetrieval};
