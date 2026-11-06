const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'cybersea-tools-'));process.env.CYBERSEA_DATA_DIR=temp;
const db=require('../server/db');
const {chatCompletion}=require('../server/llmClient');
const {runToolLoop}=require('../server/chat/toolLoop');
let server,base,respond,requests;
const defs=['first','second'].map(name=>({name,description:name,parameters:{type:'object',properties:{}}}));
function success(message){return {status:200,body:{choices:[{message,finish_reason:message.tool_calls?'tool_calls':'stop'}]}};}
test.before(async()=>{server=http.createServer(async(req,res)=>{let raw='';for await(const part of req)raw+=part;const body=JSON.parse(raw);requests.push(body);const result=respond(body);res.writeHead(result.status,{'Content-Type':'application/json'});res.end(JSON.stringify(result.body));});server.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));base=`http://127.0.0.1:${server.address().port}`;});
test.after(async()=>{await new Promise(r=>server.close(r));db.close();fs.rmSync(temp,{recursive:true,force:true});});
function configure(name){requests=[];db.prepare('UPDATE settings SET api_base_url=?,api_key=?,model=? WHERE id=1').run(base+'/'+name,'test-key','test-model');}
test('modern tool calls execute every requested action and send correctly paired tool results',async()=>{
 configure('modern');const executed=[];
 respond=body=>body.messages.some(m=>m.role==='tool')?success({role:'assistant',content:'done'}):success({role:'assistant',content:null,tool_calls:defs.map((d,i)=>({id:'provider_'+i,type:'function',function:{name:d.name,arguments:'{}'}}))});
 const result=await runToolLoop([{role:'user',content:'run both actions'}],[],{chatCompletion,functionCalling:{getDefinitions:()=>defs,execute:async name=>{executed.push(name);return {result:{saved:name},fn_name:name,is_write:true};}},memorySettings:{context_window_tokens:8000,tool_result_budget_tokens:1000}});
 assert.deepEqual(executed,['first','second']);assert.equal(result.aiReply,'done');assert.deepEqual(result.toolCalls,['first','second']);
 assert.equal(requests[0].functions,undefined);assert.equal(requests[0].tools.length,2);
 const history=requests[1].messages,callMessages=history.filter(m=>m.tool_calls),replies=history.filter(m=>m.role==='tool');
 assert.equal(replies.length,2);assert.deepEqual(callMessages.map(m=>m.tool_calls[0].id),replies.map(m=>m.tool_call_id));
 assert.equal(new Set(replies.map(m=>m.tool_call_id)).size,2);
});
test('providers explicitly rejecting tools fall back to legacy functions and reuse that protocol',async()=>{
 configure('legacy');respond=body=>body.tools?{status:400,body:{error:{message:'Unrecognized request argument: tools'}}}:success({role:'assistant',content:null,function_call:{name:'first',arguments:'{}'}});
 const result=await chatCompletion([{role:'user',content:'run first'}],defs);assert.equal(result.function_call.name,'first');assert.equal(requests.length,2);assert.ok(requests[1].functions);assert.equal(requests[1].tools,undefined);
 await chatCompletion([{role:'user',content:'run first again'}],defs);assert.equal(requests.length,3);assert.ok(requests[2].functions);
});
test('authentication and unrelated provider failures are never retried as another protocol',async()=>{
 configure('unauthorized');respond=()=>({status:401,body:{error:{message:'unauthorized'}}});
 await assert.rejects(chatCompletion([{role:'user',content:'hello'}],defs),/401/);assert.equal(requests.length,1);
});
test('multiple modern calls still obey the overall limit of eight tool executions',async()=>{
 configure('limited');let count=0;respond=()=>success({role:'assistant',content:null,tool_calls:Array.from({length:12},(_,i)=>({id:'many_'+i,type:'function',function:{name:'first',arguments:'{}'}}))});
 await runToolLoop([{role:'user',content:'run actions'}],[],{chatCompletion,functionCalling:{getDefinitions:()=>defs,execute:async()=>{count++;return {result:'ok',is_write:false};}},memorySettings:{context_window_tokens:8000,tool_result_budget_tokens:1000}});
 assert.equal(count,8);assert.equal(requests.length,2);assert.equal(requests[1].tools,undefined);assert.ok(requests[1].messages.some(m=>m.role==='tool'));assert.ok(!requests[1].messages.some(m=>m.role==='function'));
});
