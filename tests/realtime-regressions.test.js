const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http'),vm=require('node:vm');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'cs-realtime-'));process.env.CYBERSEA_DATA_DIR=temp;
const db=require('../server/db'),WebSocket=require('ws');
const live=require('../server/websocket');let server,wss;
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function connect(options={}){const ws=new WebSocket(`ws://127.0.0.1:${server.address().port}/ws`,options);await new Promise((r,j)=>{ws.once('open',r);ws.once('error',j);});const ready=new Promise(r=>ws.once('message',r));ws.send(JSON.stringify({type:'auth',peerId:'user'}));await ready;return ws;}
test.before(async()=>{server=http.createServer();wss=live.initWebSocket(server,()=>true,{heartbeatInterval:15,heartbeatTimeout:60});server.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));});
test.after(async()=>{for(const ws of wss.clients)ws.terminate();await new Promise(r=>server.close(r));db.close();fs.rmSync(temp,{recursive:true,force:true});});
test('CS-001: protocol pong keeps a connection alive without application pong messages',async()=>{const ws=await connect();let pings=0;ws.on('ping',()=>pings++);await pause(210);assert.ok(pings>=3);assert.equal(ws.readyState,WebSocket.OPEN);ws.close();await new Promise(r=>ws.once('close',r));});
test('CS-001: clients that stop answering protocol pings are disconnected',async()=>{const ws=await connect({autoPong:false});const code=await Promise.race([new Promise(r=>ws.once('close',r)),pause(1000).then(()=>{ws.terminate();throw Error('No heartbeat timeout');})]);assert.equal(code,4002);});
test('CS-002: closing a replaced connection preserves the newer peer registration',async()=>{const old=await connect();const closed=new Promise(r=>old.once('close',r));const current=await connect();current.send(JSON.stringify({type:'visibility',visible:true}));await closed;await pause(20);assert.equal(live.getWsClient('user')?.readyState,WebSocket.OPEN);assert.equal(live.getUserOnline(),true);const message=new Promise(r=>current.once('message',r));live.getWsClient('user').send(JSON.stringify({type:'incoming_call'}));assert.equal(JSON.parse(String(await message)).type,'incoming_call');current.close();await new Promise(r=>current.once('close',r));});
test('CS-009: scheduler reloads share one ongoing model generation and respect daily limits',async()=>{
 let release,called=0;require('../server/llmClient').chatCompletion=()=>{called++;return new Promise(r=>release=r);};
 const scheduler=require('../server/modules/proactive/scheduler');
 const avoid=String((new Date().getHours()+12)%24).padStart(2,'0')+':00';
 db.prepare('UPDATE proactive_settings SET enabled=1,morning_enabled=1,morning_start=?,morning_end=?,night_enabled=0,dnd_start=?,dnd_end=?,max_daily=1 WHERE id=1').run('00:00','23:59',avoid,avoid);
 try {const first=scheduler.checkAndSend();scheduler.reload();scheduler.reload();assert.equal(called,1);release('虚构早安');await first;await scheduler.checkAndSend();assert.equal(called,1);assert.equal(db.prepare("SELECT COUNT(*) n FROM proactive_log WHERE type='morning'").get().n,1);assert.equal(db.prepare("SELECT COUNT(*) n FROM messages WHERE memory_origin='proactive'").get().n,1);}finally{scheduler.stopScheduler();}
});
test('CS-012: server and browser parse legacy database timestamps as local civil time',()=>{
 const value='2026-11-05 13:24:00',expected=new Date(2026,10,5,13,24,0).getTime();
 assert.equal(require('../server/utils/dates').parseTimestamp(value).getTime(),expected);
 const sandbox={window:{},Date,Object};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../public/js/shared.js'),'utf8'),sandbox);assert.equal(sandbox.window.CyberSea.parseTimestamp(value).getTime(),expected);
 assert.equal(sandbox.window.CyberSea.parseTimestamp('2026-11-05T13:24:00Z').getTime(),Date.parse('2026-11-05T13:24:00Z'));
});
