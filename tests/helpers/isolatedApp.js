const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const {spawn}=require('node:child_process');
const {DatabaseSync}=require('node:sqlite');
async function isolatedApp(){
 const source=path.resolve(__dirname,'../..'),root=fs.mkdtempSync(path.join(os.tmpdir(),'cs-regression-'));
 for(const dir of ['server','public'])fs.cpSync(path.join(source,dir),path.join(root,dir),{recursive:true,filter:file=>{
  if(dir==='server'||fs.statSync(file).isDirectory())return path.basename(file)!=='audio';
  return /\.(js|css|html|json|svg)$/.test(file)||/^icon-(192|512)\.png$/.test(path.basename(file))||path.basename(file)==='deep-sea-bg.png';
 }});
 if(process.env.CS_BASELINE_DIR){
  for(const dir of ['server','public'])fs.cpSync(path.join(path.resolve(process.env.CS_BASELINE_DIR),dir),path.join(root,dir),{recursive:true});
 }
 fs.mkdirSync(path.join(root,'uploads'));let queue=[],requests=[],speech=[];
 const mock=http.createServer(async(req,res)=>{let text='';for await(const part of req)text+=part;const body=JSON.parse(text||'{}');
  if(req.url==='/tts'){speech.push(body.text);res.writeHead(200,{'Content-Type':'audio/wav'});return res.end('RIFF-test');}
  requests.push(body);const item=queue.shift()||{content:'检查完成。'};if(item.delay)await new Promise(r=>setTimeout(r,item.delay));
  res.writeHead(item.status||200,{'Content-Type':'application/json'});
  res.end(JSON.stringify(item.error?{error:{message:item.error}}:{choices:[{message:{role:'assistant',content:item.content??null,...(item.calls?{tool_calls:item.calls.map((c,i)=>({id:'call_'+i,type:'function',function:{name:c.name,arguments:JSON.stringify(c.args||{})}}))}:{})},finish_reason:item.finish|| (item.calls?'tool_calls':'stop')}]}));
 });mock.listen(0,'127.0.0.1');await new Promise(r=>mock.once('listening',r));
 const child=spawn(process.execPath,['server/index.js'],{cwd:root,windowsHide:true,env:{...process.env,NODE_PATH:path.join(source,'node_modules'),HOST:'127.0.0.1',PORT:'0',CYBERSEA_DATA_DIR:path.join(root,'data'),CYBERSEA_DISABLE_SCHEDULERS:'1',CYBERSEA_AUTH_USER:'',CYBERSEA_AUTH_PASSWORD:''},stdio:['ignore','pipe','pipe']});
 child.stderr.on('data',()=>{});
 const base=await new Promise((resolve,reject)=>{let output='';const timer=setTimeout(()=>reject(Error('Startup timed out')),10000);child.stdout.on('data',b=>{output+=b;const m=output.match(/http:\/\/127\.0\.0\.1:\d+/);if(m){clearTimeout(timer);resolve(m[0]);}});child.once('exit',()=>{clearTimeout(timer);reject(Error('Startup failed'));});});
 const db=new DatabaseSync(path.join(root,'data/app.db'));
 const mockBase=`http://127.0.0.1:${mock.address().port}`;
 db.prepare('UPDATE settings SET api_base_url=?,api_key=?,model=?,tts_api_url=? WHERE id=1').run(mockBase+'/v1','test-key','test-model',mockBase+'/tts');
 async function api(url,method='GET',body){const response=await fetch(base+url,{method,...(body===undefined?{}:body instanceof FormData?{body}:{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),signal:AbortSignal.timeout(5000)});const raw=await response.text();let data;try{data=JSON.parse(raw);}catch{data=raw;}return {status:response.status,body:data};}
 return {root,base,db,api,requests,speech,enqueue(...items){queue.push(...items);},reset(){queue=[];requests.length=0;speech.length=0;},async called(n){for(let i=0;i<100&&requests.length<n;i++)await new Promise(r=>setTimeout(r,10));if(requests.length<n)throw Error('Model not called');},async close(){child.kill();await new Promise(r=>child.exitCode!==null?r():child.once('exit',r));db.close();await new Promise(r=>mock.close(r));if(path.dirname(root)!==os.tmpdir()||!path.basename(root).startsWith('cs-regression-'))throw Error('Unsafe cleanup');fs.rmSync(root,{recursive:true,force:true});}};
}
module.exports={isolatedApp};
