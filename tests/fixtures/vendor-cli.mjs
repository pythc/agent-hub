// Deterministic transport fixture; the separate manual suite runs vendor binaries.
import {readFileSync,writeFileSync,existsSync} from 'node:fs'
import {join} from 'node:path'
import {randomUUID} from 'node:crypto'
const [kind,version,...args]=process.argv.slice(2)
if(args.includes('--version')){console.log(version);process.exit(0)}
let input='';for await(const c of process.stdin)input+=c
const mode=input.split('\n')[0],option=name=>args[args.indexOf(name)+1]
const native=args.includes('--resume')?option('--resume'):args.includes('--session')?option('--session'):args.includes('--session-id')?option('--session-id'):randomUUID()
const path=join(process.cwd(),'fixture.json'),saved=existsSync(path)?JSON.parse(readFileSync(path,'utf8')):{id:native,inputs:[]}
if(saved.id!==native)throw Error('Unexpected native replacement')
saved.inputs.push(mode);writeFileSync(path,JSON.stringify(saved))
const emit=value=>new Promise(r=>process.stdout.write(JSON.stringify(value)+'\n',r))
const init=()=>kind==='claude'?{type:'system',subtype:'init',session_id:native}:kind==='gemini'?{type:'init',session_id:native}:{type:'step_start',sessionID:native}
await emit(init())
let mcp,base
if(kind==='claude'){mcp=JSON.parse(readFileSync(option('--mcp-config'),'utf8')).mcpServers.roppo;base=process.env.ANTHROPIC_BASE_URL}
if(kind==='gemini'){mcp=JSON.parse(readFileSync(join(process.env.GEMINI_CLI_HOME,'.gemini/settings.json'),'utf8')).mcpServers.roppo;base=process.env.GOOGLE_GEMINI_BASE_URL}
if(kind==='opencode'){const c=JSON.parse(process.env.OPENCODE_CONFIG_CONTENT);mcp=c.mcp.roppo;base=Object.values(c.provider)[0].options.baseURL}
const rpc=(id,method,params)=>fetch(mcp.url??mcp.httpUrl,{method:'POST',headers:{'content-type':'application/json',...mcp.headers},body:JSON.stringify({jsonrpc:'2.0',id,method,params})}).then(r=>r.json())
await rpc(1,'initialize',{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'fixture',version:'1'}})
const response=await fetch(base+'/v1/messages',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({messages:[{role:'user',content:mode==='wire-budget'?'x'.repeat(90000):input}],...(mode==='wire-native-tool'?{tools:[{name:'bash',input_schema:{type:'object'}}]}:{}),...(mode==='wire-opaque'?{previous_response_id:'unaccounted'}:{})})})
if(!response.ok)process.exit(1)
if(mode.startsWith('tool')||['bad-args','unknown-tool'].includes(mode)){
 const name=mode==='unknown-tool'?'forbidden':'allowed',params={name,arguments:mode==='bad-args'?{n:'wrong'}:{n:1}}
 await Promise.all([rpc(2,'tools/call',params),rpc(2,'tools/call',params)])
}
if(mode==='crash'||mode==='tool-crash')process.exit(7)
if(mode==='hang')await new Promise(()=>{})
if(mode==='replace')await emit({...init(),...(kind==='opencode'?{sessionID:'replacement'}:{session_id:'replacement'})})
let text=JSON.stringify({answer:'你好',inputs:saved.inputs})
if(mode==='bad-result')text='{"pretend_success":true}'
if(kind==='claude')await emit({type:'result',session_id:native,result:text,is_error:mode==='error-after-text',errors:['HTTP 401 invalid api key']})
if(kind==='gemini'){await emit({type:'message',role:'assistant',content:text});await emit({type:'result',status:mode==='error-after-text'?'error':'success',error:'HTTP 401 invalid api key'})}
if(kind==='opencode'){await emit({type:'text',sessionID:native,part:{text}});await emit(mode==='error-after-text'?{type:'error',error:'HTTP 401 invalid api key'}:{type:'step_finish',sessionID:native,part:{reason:'stop'}})}
