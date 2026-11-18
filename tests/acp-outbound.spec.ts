/** Restored from retained cloud tool-call records; all results must be rerun in this checkout. */
import {afterEach,it,expect} from 'vitest'
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {createHash} from 'node:crypto'
import {AcpModel,acpEnvironment,acpCompatibility} from '../plugins/backend-acp/index.ts'
import {AcpPermissions} from '../plugins/backend-acp/permission.ts'
import {AcpState} from '../plugins/backend-acp/state.ts'
import {buildBackendPackage} from '../src/backends/plugin-package.ts'
import {BackendRegistry} from '../src/backends/registry.ts'
import {configSchema} from '../src/config.ts'
import {Store} from '../src/store.ts'
import type {ModelRequest} from '../src/model.ts'
const roots:string[]=[]
afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true})})
const fixtureSource=String.raw`
import {createInterface} from 'node:readline';import {appendFileSync} from 'node:fs'
const [log,mode]=process.argv.slice(2);let prompt;const send=m=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',...m})+'\n')
const result=(id,r)=>send({id,result:r});const update=(u,sessionId='session-1')=>send({method:'session/update',params:{sessionId,update:u}})
const answer=()=>{update({sessionUpdate:'agent_thought_chunk',content:{type:'text',text:'SECRET_INTERNAL_REASONING'}});update({sessionUpdate:'tool_call',toolCallId:'tool-1',title:'SECRET_TITLE',rawInput:{token:'SECRET_TOKEN'},rawOutput:'SECRET_RAW'});update({sessionUpdate:'agent_message_chunk',content:{type:'text',text:'Public '}});update({sessionUpdate:'agent_message_chunk',content:{type:'text',text:'answer'}});result(prompt.id,{stopReason:'end_turn'})}
createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);appendFileSync(log,JSON.stringify({method:m.method??'response',params:m.method==='initialize'?m.params:m.method==='session/prompt'?{sessionId:m.params.sessionId}:m.params,result:m.result,error:m.error})+'\n')
 if(m.method==='initialize')return result(m.id,{protocolVersion:mode==='version'?2:1,agentCapabilities:{loadSession:mode!=='no-load',sessionCapabilities:{close:{}}},agentInfo:{name:'SECRET_AGENT',version:'SECRET_VERSION'},authMethods:[{id:'login',name:'login'},{id:'terminal',type:'terminal',name:'Terminal'}]})
 if(m.method==='authenticate')return result(m.id,{})
 if(m.method==='session/new'){if(mode==='auth')return send({id:m.id,error:{code:-32000,message:'SECRET_PROVIDER_ERROR'}});return result(m.id,{sessionId:'session-1'})}
 if(m.method==='session/load'){update({sessionUpdate:'agent_message_chunk',content:{type:'text',text:'PRIVATE_HISTORY'}});return result(m.id,{})}
 if(m.method==='session/close')return result(m.id,{})
 if(m.method==='session/cancel'){if(mode==='cancel-confirm')return result(prompt.id,{stopReason:'cancelled'});if(mode==='cancel-ignore-answer')answer();return}
 if(m.method==='session/prompt'){prompt=m;if(mode==='crash'){process.stderr.write('SECRET_STDERR');process.exit(3)}if(mode==='hang'||mode.startsWith('cancel-'))return;if(mode==='permission'){send({id:'permission-1',method:'session/request_permission',params:{sessionId:'session-1',toolCall:{toolCallId:'call-1',kind:'edit',title:'SECRET_TITLE',rawInput:{token:'SECRET_TOKEN'}},options:[{optionId:'once',kind:'allow_once',name:'Allow'},{optionId:'always',kind:'allow_always',name:'Always'},{optionId:'deny',kind:'reject_once',name:'Reject'}]}});return}if(mode==='fs'){send({id:'fs-1',method:'fs/read_text_file',params:{path:'/secret'}});return}if(mode==='bad-json'){process.stdout.write('{bad\n');return}answer();return}
 if(m.id==='permission-1'||m.id==='fs-1')answer()
})
`
function fixture(mode='normal',overrides:Record<string,unknown>={}){
 const root=mkdtempSync(join(tmpdir(),'acp-outbound-'));roots.push(root)
 const script=join(root,'fixture.mjs'),log=join(root,'calls.jsonl'),workspace=join(root,'workspace'),data=join(root,'data')
 mkdirSync(workspace);writeFileSync(script,fixtureSource)
 const config={command:process.execPath,args:[script,log,mode],requestTimeoutMs:1000,permissionTimeoutMs:200,cancelTimeoutMs:100,...overrides}
 const model=new AcpModel(config,data),request:ModelRequest={cwd:workspace,instructions:'Answer the question',input:'Synthetic prompt',schema:{}}
 const calls=()=>{try{return readFileSync(log,'utf8').trim().split('\n').filter(Boolean).map(line=>JSON.parse(line))}catch{return []}}
 return {root,script,workspace,data,model,request,calls,config}
}
const createName=(id:string)=>createHash('sha256').update(id).digest('hex')+'.json'
it('probes ACP v1 without creating sessions, authenticating, inferring authentication or exposing provider metadata',async()=>{
 const f=fixture()
 expect(await f.model.probe()).toEqual({available:true,authenticated:'unknown',remoteVerified:false,version:'ACP v1 / adapter 0.1.0'})
 expect(f.calls().map(c=>c.method)).toEqual(['initialize'])
 expect(JSON.stringify(f.calls()[0].params)).toContain('"terminal":false')
 const v=fixture('version');await expect(v.model.probe()).rejects.toMatchObject({code:'unsupported'})
})
it('sends only public answer updates and resumes the original session without replaying its historical messages',async()=>{
 const f=fixture(),output:unknown[]=[],ids:string[]=[]
 const first=await f.model.run({...f.request,onThread:id=>ids.push(id),onOutput:event=>output.push(event)})
 expect(first).toMatchObject({threadId:'session-1',text:'Public answer'});expect(ids).toEqual(['session-1'])
 const second=await new AcpModel(f.config,f.data).run({...f.request,threadId:first.threadId})
 expect(second.threadId).toBe(first.threadId);expect(second.text).toBe('Public answer');expect(second.turnId).not.toBe(first.turnId)
 expect(JSON.stringify(output)).not.toMatch(/SECRET_|PRIVATE_HISTORY/)
 expect(f.calls().map(c=>c.method)).toEqual(['initialize','session/new','session/prompt','session/close','initialize','session/load','session/prompt','session/close'])
 const journal=readFileSync(join(f.data,'acp-v1',createName(first.threadId)),'utf8')
 expect(journal).not.toMatch(/Synthetic prompt|Public answer|SECRET_|PRIVATE_HISTORY/)
})
it('retains managed, tools, context-budget and provider-option fences before launching an agent',async()=>{
 const f=fixture()
 for(const patch of [{managed:true},{tools:[{type:'function',name:'tool',description:'',inputSchema:{}}]},{contextBudget:{}},{model:'override'},{options:{effort:'high'}},{options:{parameters:{temperature:1}}},{workerMcp:{command:'node',args:[]}}])await expect(f.model.run({...f.request,...patch} as ModelRequest)).rejects.toMatchObject({code:'unsupported'})
 expect(f.calls()).toEqual([]);expect(acpCompatibility.managed).toBe(false)
})
it('requires explicit supported authentication and never runs advertised terminal commands',async()=>{
 const f=fixture('normal',{authenticationMethod:'login'});await f.model.run(f.request)
 expect(f.calls().map(c=>c.method)).toContain('authenticate')
 const terminal=fixture('normal',{authenticationMethod:'terminal'});await expect(terminal.model.run(terminal.request)).rejects.toMatchObject({code:'auth_required'})
 expect(terminal.calls().map(c=>c.method)).toEqual(['initialize'])
 const auth=fixture('auth');await expect(auth.model.run(auth.request)).rejects.toMatchObject({code:'auth_required'})
})
it('rejects client filesystem requests and defaults permission requests to reject_once',async()=>{
 const fs=fixture('fs');await fs.model.run(fs.request)
 expect(fs.calls().find(c=>c.method==='response')).toMatchObject({error:{code:-32601,message:'Client method unavailable'}})
 const permission=fixture('permission');await permission.model.run(permission.request)
 expect(permission.calls().find(c=>c.method==='response')).toMatchObject({result:{outcome:{outcome:'selected',optionId:'deny'}}})
})
it('binds a human allow_once to session, turn, request and expiry and strips raw tool data and allow_always',async()=>{
 const f=fixture('permission');let observed:any
 await f.model.run({...f.request,onHumanRequest:async r=>{observed=r;return {...r.params,optionId:'once'}}})
 expect(f.calls().find(c=>c.method==='response')).toMatchObject({result:{outcome:{outcome:'selected',optionId:'once'}}})
 expect(observed.method).toBe('acp/permission');expect(observed.params).toMatchObject({sessionId:'session-1',kind:'edit'});expect(observed.params.turnId).toBeTypeOf('string')
 expect(JSON.stringify(observed)).not.toMatch(/SECRET_|always|rawInput/)
 const stale=fixture('permission');await stale.model.run({...stale.request,onHumanRequest:async r=>({...r.params,turnId:'other-turn',optionId:'once'})})
 expect(stale.calls().find(c=>c.method==='response')).toMatchObject({result:{outcome:{outcome:'cancelled'}}})
})
it('drops expired and cancelled permissions, including a late human approval',async()=>{
 const params={sessionId:'s',toolCall:{toolCallId:'t'},options:[{optionId:'once',kind:'allow_once'}]},request={id:1,method:'session/request_permission',params}
 let now=100
 const expired=new AcpPermissions('s','turn',100,async r=>{now=201;return {...r.params,optionId:'once'}},()=>now)
 expect(await expired.request(request)).toEqual({outcome:{outcome:'cancelled'}})
 let approve:(v:unknown)=>void=()=>{};let observed:any
 const gate=new AcpPermissions('s','turn',1000,r=>{observed=r;return new Promise(resolve=>{approve=resolve})})
 const pending=gate.request(request);gate.cancel();approve({...observed.params,optionId:'once'})
 expect(await pending).toEqual({outcome:{outcome:'cancelled'}})
 expect(await gate.request({...request,params:{...params,sessionId:'other'}})).toEqual({outcome:{outcome:'cancelled'}})
})
it('fences a crash after prompt submission across process recreation and never silently creates a replacement session',async()=>{
 const f=fixture('crash');let threadId=''
 await expect(f.model.run({...f.request,onThread:id=>{threadId=id}})).rejects.toMatchObject({code:'outcome_unknown'})
 const before=f.calls().length
 await expect(new AcpModel(f.config,f.data).run({...f.request,threadId})).rejects.toMatchObject({code:'outcome_unknown'})
 expect(f.calls()).toHaveLength(before);expect(f.calls().filter(c=>c.method==='session/prompt')).toHaveLength(1)
 expect(new AcpState(f.data).read(threadId).state).toBe('uncertain')
})
it('requires advertised loading support and matching workspace/endpoint for an existing session',async()=>{
 const f=fixture('no-load'),result=await f.model.run(f.request)
 await expect(f.model.run({...f.request,threadId:result.threadId})).rejects.toMatchObject({code:'unsupported'})
 expect(f.calls().filter(c=>c.method==='session/prompt')).toHaveLength(1)
 await expect(new AcpModel({...f.config,args:[...f.config.args,'changed']},f.data).run({...f.request,threadId:result.threadId})).rejects.toMatchObject({code:'configuration_invalid'})
 await expect(f.model.run({...f.request,cwd:f.root,threadId:result.threadId})).rejects.toMatchObject({code:'configuration_invalid'})
})
it.each(['cancel-confirm','hang','cancel-ignore-answer'])('distinguishes confirmed cancellation from unknown outcomes (%s)',async mode=>{
 const f=fixture(mode),controller=new AbortController();let thread=''
 const call=f.model.run({...f.request,signal:controller.signal,onThread:id=>{thread=id},onTurn:()=>setTimeout(()=>controller.abort(),30)})
 await expect(call).rejects.toMatchObject({code:mode==='cancel-confirm'?'cancelled':'outcome_unknown'})
 expect(f.calls().filter(c=>c.method==='session/cancel')).toHaveLength(1)
 expect(new AcpState(f.data).read(thread).state).toBe(mode==='cancel-confirm'?'ready':'uncertain')
})
it('classifies malformed output after prompt as uncertain and exposes no stderr or raw protocol errors',async()=>{
 const f=fixture('bad-json')
 await expect(f.model.run(f.request)).rejects.toMatchObject({code:'outcome_unknown'})
 const f2=fixture('auth');try{await f2.model.run(f2.request);throw Error('expected error')}catch(error){expect(String(error)).not.toContain('SECRET_')}
})
it('does not inherit ambient credentials or runtime injection and requires environment opt-in',()=>{
 const env={PATH:'/safe/bin',HOME:'/scratch',TMPDIR:'/scratch/tmp',ACP_API_KEY:'test-key',AWS_SECRET_ACCESS_KEY:'private',NODE_OPTIONS:'inject',GITHUB_TOKEN:'private'}
 expect(acpEnvironment([],env)).toEqual({PATH:'/safe/bin',HOME:'/scratch',TMPDIR:'/scratch/tmp'})
 expect(acpEnvironment(['ACP_API_KEY'],env)).toEqual({PATH:'/safe/bin',HOME:'/scratch',TMPDIR:'/scratch/tmp',ACP_API_KEY:'test-key'})
 expect(()=>acpEnvironment(['NODE_OPTIONS'],env)).toThrow('configuration_invalid')
})
it('closes explicitly without deleting history or claiming to revert effects, and does not resurrect a closed session',async()=>{
 const f=fixture(),first=await f.model.run(f.request)
 expect(await f.model.closeSession(first.threadId,f.workspace)).toEqual({closed:true,previousEffects:'not_reverted'})
 const before=f.calls().length
 expect(await f.model.closeSession(first.threadId,f.workspace)).toEqual({closed:true,previousEffects:'not_reverted'})
 await expect(f.model.run({...f.request,threadId:first.threadId})).rejects.toMatchObject({code:'unsupported'})
 expect(f.calls()).toHaveLength(before)
})
it('rejects reused native session IDs instead of overwriting existing durable identity',async()=>{
 const f=fixture();await f.model.run(f.request)
 await expect(f.model.run(f.request)).rejects.toMatchObject({code:'outcome_unknown'})
 expect(f.calls().filter(c=>c.method==='session/prompt')).toHaveLength(1)
})
it('builds a standard immutable execution package and the existing host refuses managed Worker admission',async()=>{
 const f=fixture(),manifest=JSON.parse(readFileSync(resolve('plugins/backend-acp/manifest.json'),'utf8'))
 const pkg=await buildBackendPackage(resolve('plugins/backend-acp/index.ts'),manifest,join(f.root,'package'))
 expect(pkg.manifest).toMatchObject({type:'execution-backend',id:'acp-outbound',capabilities:{resume:true,managed:false,tools:false,history:false,contextBudget:false}})
 const config=configSchema.parse({stateDir:join(f.root,'state'),backendPlugins:[{directory:pkg.directory,digest:pkg.digest}],backends:{acp:{kind:'plugin',plugin:'acp-outbound',config:f.config}},execution:{backend:'acp'},sources:[{id:'local',kind:'local',cwd:f.workspace,allowedActors:['operator']}],work:{sandboxDriver:'disabled'}})
 const store=new Store(join(config.stateDir,'state.sqlite'))
 try{const registry=new BackendRegistry(config,store);await expect(registry.run({...f.request,managed:true})).rejects.toMatchObject({code:'unsupported'});expect(f.calls()).toEqual([])}finally{store.close()}
})
it('rejects ambiguous permission option IDs even if one duplicate advertises allow_always',async()=>{
 let called=false
 const gate=new AcpPermissions('session','turn',100,async r=>{called=true;return {...r.params,optionId:'same'}})
 expect(await gate.request({id:1,method:'session/request_permission',params:{sessionId:'session',toolCall:{toolCallId:'tool'},options:[{optionId:'same',kind:'allow_once'},{optionId:'same',kind:'allow_always'}]}})).toEqual({outcome:{outcome:'cancelled'}})
 expect(called).toBe(false)
})
it('fences an incomplete journal and a concurrent session owner before launching another external process',async()=>{
 const f=fixture(),first=await f.model.run(f.request),state=new AcpState(f.data),unlock=state.lock(first.threadId),before=f.calls().length
 try{await expect(f.model.run({...f.request,threadId:first.threadId})).rejects.toMatchObject({code:'outcome_unknown'})}finally{unlock()}
 state.write({...state.read(first.threadId),state:'prompt_pending'})
 await expect(new AcpModel(f.config,f.data).run({...f.request,threadId:first.threadId})).rejects.toMatchObject({code:'outcome_unknown'})
 expect(f.calls()).toHaveLength(before)
})
it.runIf(process.platform==='linux'||process.platform==='darwin')('runs the real packaged ProcessBackend sandbox chain with the synthetic peer and preserves native mapping after reopening',async()=>{
 const f=fixture(),peer=resolve('plugins/backend-acp/fixtures/agent.mjs'),peerState=join(f.root,'peer');mkdirSync(peerState)
 const manifest=JSON.parse(readFileSync(resolve('plugins/backend-acp/manifest.json'),'utf8'))
 const pkg=await buildBackendPackage(resolve('plugins/backend-acp/index.ts'),manifest,join(f.root,'package'))
 const config=configSchema.parse({stateDir:join(f.root,'host'),turnTimeoutMs:10000,work:{sandboxDriver:process.platform==='darwin'?'seatbelt':'bubblewrap'},backendPlugins:[{directory:pkg.directory,digest:pkg.digest}],backends:{acp:{kind:'plugin',plugin:'acp-outbound',config:{command:process.execPath,args:[peer,peerState,'permission']},readPaths:[peer],writePaths:[peerState]}},execution:{backend:'acp'},sources:[{id:'local',kind:'local',cwd:f.workspace,allowedActors:['operator']}]})
 let store=new Store(join(config.stateDir,'state.sqlite'))
 try{
  let registry=new BackendRegistry(config,store)
  expect(await registry.probe('acp')).toMatchObject({available:true,authenticated:'unknown',remoteVerified:false})
  const output:unknown[]=[],first=await registry.run({...f.request,backendId:'acp',onOutput:event=>output.push(event)})
  expect(JSON.parse(first.text)).toEqual({answer:'ACP fixture turn 1'})
  const nativeId=store.get<any>('backend-plugin-thread',first.threadId).nativeId
  store.close();store=new Store(join(config.stateDir,'state.sqlite'));registry=new BackendRegistry(config,store)
  const second=await registry.run({...f.request,threadId:first.threadId,onOutput:event=>output.push(event)})
  expect(second.threadId).toBe(first.threadId);expect(JSON.parse(second.text)).toEqual({answer:'ACP fixture turn 2'})
  expect(store.get<any>('backend-plugin-thread',first.threadId).nativeId).toBe(nativeId)
  expect(JSON.stringify(output)).not.toContain('Synthetic internal thought')
  expect(JSON.parse(readFileSync(join(peerState,'permission-outcome.json'),'utf8'))).toEqual({outcome:{outcome:'selected',optionId:'reject'}})
 }finally{store.close()}
},20000)
it('rejects malformed launch settings, empty resume identities and missing workspaces before spawning',async()=>{
 const f=fixture()
 for(const config of [{...f.config,command:'/bad\0command'},{...f.config,args:['bad\0arg']},{...f.config,environment:['NODE_OPTIONS']}])expect(()=>new AcpModel(config,f.data)).toThrow('configuration_invalid')
 await expect(f.model.run({...f.request,threadId:''})).rejects.toMatchObject({code:'configuration_invalid'})
 await expect(f.model.run({...f.request,cwd:join(f.root,'missing')})).rejects.toMatchObject({code:'configuration_invalid'})
 expect(f.calls()).toEqual([])
})
