import {it,expect,afterEach} from 'vitest'
import {createServer,type Server} from 'node:http'
import {mkdtempSync,rmSync,writeFileSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {configSchema} from '../src/config.ts'
import {Runtime} from '../src/runtime.ts'
import {BackendRegistry} from '../src/backends/registry.ts'
import {CodexModel} from '../src/codex.ts'
import type {Model,ModelRequest} from '../src/model.ts'
import {mergeParameters} from '../src/agent-options.ts'
import {operatorWorkspace} from '../src/operator-workspace.ts'
const roots:string[]=[],hosts:Runtime[]=[],servers:Server[]=[]
afterEach(async()=>{for(const h of hosts.splice(0))await h.close();for(const s of servers.splice(0)){s.closeAllConnections();await new Promise<void>(r=>s.close(()=>r()))}for(const p of roots.splice(0))rmSync(p,{recursive:true,force:true})})
function config(extra:Record<string,unknown>={}){const root=mkdtempSync(join(tmpdir(),'agent-options-'));roots.push(root);return configSchema.parse({stateDir:join(root,'state'),work:{sandboxDriver:'disabled'},execution:{management:{enabled:true},workers:[{id:'one',backend:'codex',model:'sol',effort:'high',prompt:'worker-specific'},{id:'two',backend:'codex'}],router:{model:'terra',effort:'medium',prompt:'router-specific'}},sources:[{id:'local',kind:'local',cwd:root,allowedActors:['operator'],workspace:{mode:'source'}}],...extra})}
const report={state:'ready',summary:'Complete',reply:'worker evidence',question:null,askedBy:null,handbacks:[]}
async function ticks(h:Runtime,predicate:()=>boolean){for(let i=0;i<500;i++){await h.tick();await new Promise(r=>setTimeout(r,3));if(predicate())return}throw Error('Did not settle')}
function fake(calls:ModelRequest[]):Model{return {async run(r){calls.push(r);const id=r.threadId??'thread-'+calls.length;r.onThread?.(id);r.onModel?.(r.model??'sol');r.onTurn?.('turn-'+calls.length);return {threadId:id,turnId:'turn-'+calls.length,text:JSON.stringify(report)}}}}
it('merges nested provider parameters without losing false/null or mutating defaults',()=>{
 const base={reasoning:{effort:'high',summary:'auto'},list:[1,2],enabled:true}
 expect(mergeParameters(base,{reasoning:{summary:null},list:[3],enabled:false})).toEqual({reasoning:{effort:'high',summary:null},list:[3],enabled:false})
 expect(base.reasoning.summary).toBe('auto')
})
it('projects the actual CLI connection model when the Agent inherits its service default',()=>{
 const c=config({backends:{separate:{kind:'codex',model:'profile-model'}},execution:{backend:'separate',router:{backend:'separate'},workers:[{id:'one',backend:'separate'}]}}),h=new Runtime(c,{model:fake([])});hosts.push(h)
 const view=operatorWorkspace(h);expect(view.architecture.router.model).toBe('profile-model');expect(view.architecture.workers[0]!.model).toBe('profile-model')
})
it('sends independent Router/Worker parameters, prompt and custom headers through real HTTP',async()=>{
 const bodies:any[]=[],headers:any[]=[],server=createServer(async(req,res)=>{let text='';for await(const p of req)text+=p;const body=JSON.parse(text);bodies.push(body);headers.push(req.headers);res.end(JSON.stringify({status:'completed',model:body.model,output:[{type:'message',content:[{type:'output_text',text:'{"ok":true}'}]}]}))});servers.push(server)
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r))
 const c=config({backends:{api:{kind:'openai-responses',baseUrl:'http://127.0.0.1:'+(server.address() as any).port,model:'default',parameters:{reasoning:{summary:'auto'}},headers:{'X-Project':'test'},defaults:{maxOutputTokens:900}}},execution:{backend:'api',router:{model:'terra',effort:'medium'}}}),records=new Map<string,unknown>(),registry=new BackendRegistry(c,{get:<T>(k:string,id:string)=>records.get(k+id) as T|undefined,put:(k,id,v)=>{records.set(k+id,v)}})
 const req={cwd:roots.at(-1)!,instructions:'prompt',input:'ok',schema:{type:'object',properties:{ok:{type:'boolean'}},required:['ok']}}
 const sent:any[]=[]
 await registry.run({...req,role:'router',onConfiguration:v=>sent.push(v)})
 await registry.run({...req,role:'worker',model:'sol',options:{effort:'high',parameters:{reasoning:{summary:null},temperature:0},maxOutputTokens:1200},onConfiguration:v=>sent.push(v)})
 expect(bodies.map(b=>[b.model,b.reasoning.effort,b.max_output_tokens])).toEqual([['terra','medium',900],['sol','high',1200]])
 expect(bodies[1].reasoning.summary).toBeNull();expect(headers[1]['x-project']).toBe('test');expect(sent[1].sent.parameters.temperature).toBe(0)
 c.backends.api={...c.backends.api!,parameters:{temperature:0.5}} as any
 await registry.run({...req,role:'worker'})
 expect(bodies[2].temperature).toBe(0.5) // no stale adapter cache
})
it('manages Workers idempotently and delegates without invoking an extra Router model',async()=>{
 const calls:ModelRequest[]=[],h=new Runtime(config(),{model:fake(calls)});hosts.push(h)
 const create={action:'create',requestId:'new',revision:0,profile:{id:'three',backend:'codex',effort:'low'}}
 const a=await h.manager.call(create);expect(await h.manager.call(create)).toEqual(a);expect(h.manager.list().workers).toHaveLength(3)
 await expect(h.manager.call({...create,profile:{...create.profile,id:'four'}})).rejects.toThrow('reused')
 await expect(h.manager.call({action:'configure',requestId:'old',revision:0,id:'one',patch:{effort:'low'}})).rejects.toThrow('conflict')
 const command={action:'assign',revision:1,requestId:'task',id:'one',discussion:'cli-main',text:'Compute a result',acceptance:'Return evidence'}
 const task=await h.manager.call(command);expect(await h.manager.call(command)).toEqual(task)
 await ticks(h,()=>!!h.store.tickets.get(task.ticketId)?.ended)
 expect(calls).toHaveLength(1);expect(calls[0]).toMatchObject({role:'worker',model:'sol',options:{effort:'high'}});expect(calls[0]!.instructions).toContain('worker-specific')
 expect(calls[0]!.instructions).toContain('Perform only this task mandate')
 expect((calls[0]!.schema as any).properties.handbacks.maxItems).toBe(0)
 const context=JSON.parse(calls[0]!.input).sourceContext
 expect(context.triggerResource).toBe('trigger/'+context.triggerId);expect(context.triggerId).not.toMatch(/^trigger\//)
 await h.flush();expect(h.store.list('router-inbox')).toHaveLength(1)
 await h.manager.call({action:'send',revision:1,requestId:'follow',ticketId:task.ticketId,text:'Continue'})
 await ticks(h,()=>calls.length===2&&!!h.store.tickets.get(task.ticketId)?.ended)
 expect(calls[1]!.threadId).toBe(calls[0]!.threadId??'thread-1')
 await h.manager.call({action:'configure',revision:1,requestId:'change',id:'one',patch:{model:'other',effort:'low'}})
 const migrated=await h.manager.call({action:'migrate',revision:2,requestId:'migration',ticketId:task.ticketId})
 expect(migrated.previousThread).toBe('thread-1')
 await h.manager.call({action:'send',revision:2,requestId:'continue-migration',ticketId:task.ticketId,text:'Check prior result once'})
 await ticks(h,()=>calls.length===3&&!!h.store.tickets.get(task.ticketId)?.ended)
 expect(calls[2]!.threadId).toBeUndefined();expect(calls[2]!.model).toBe('other');expect(calls[2]!.input).toContain('worker evidence')
})
it('keeps host Router history and routes Worker output only through that Router',async()=>{
 const calls:ModelRequest[]=[],c=config();c.execution.router!.mode='host'
 const h=new Runtime(c,{model:{async run(r){calls.push(r);const id=r.threadId??'native-'+calls.length;r.onThread?.(id);r.onModel?.(r.model??'sol');r.onTurn?.('turn-'+calls.length)
 if(r.role==='router'){
  if(JSON.parse(r.input).kind==='user_message')await r.onTool!('worker_manage',{action:'assign',revision:0,requestId:'router-task',id:'one',text:'Do the delegated work'},'call-1')
  return {threadId:id,turnId:'turn-'+calls.length,text:JSON.stringify({reply:JSON.parse(r.input).kind==='worker_result'?'Router verified the evidence':''})}
 }
 return {threadId:id,turnId:'turn-'+calls.length,text:JSON.stringify(report)}
 }}});hosts.push(h)
 h.receive('local','operator',{id:'user',thread:'conversation',text:'Help me',addressed:true})
 await ticks(h,()=>h.store.deliveries().some(d=>d.text==='Router verified the evidence'&&d.status==='sent'))
 expect(calls.map(c=>c.role)).toEqual(['router','worker','router'])
 expect(calls[0]!.instructions).toContain('persistent Router');expect(calls[0]!.instructions).not.toContain('Use only superagent_read')
 expect(calls[0]!.options?.effort).toBe('medium');expect(calls[2]!.threadId).toBe('native-1')
 expect(h.store.deliveries().filter(d=>!d.channel.address.routerInbox).map(d=>d.text)).toEqual(['Router verified the evidence'])
})
it('pauses dispatch, cancels running tasks and preserves artifacts on destroy',async()=>{
 let started=false,cancelled=false;const c=config(),h=new Runtime(c,{model:{async run(r){started=true;r.onThread?.('running');r.onTurn?.('turn');await new Promise<void>(resolve=>r.signal!.addEventListener('abort',()=>{cancelled=true;resolve()},{once:true}));return {threadId:'running',turnId:'turn',text:JSON.stringify(report)}}}});hosts.push(h)
 await h.manager.call({action:'pause',id:'one',requestId:'pause',revision:0})
 await expect(h.manager.call({action:'assign',id:'one',requestId:'blocked',revision:1,discussion:'main',text:'task'})).rejects.toThrow('enabled')
 await h.manager.call({action:'resume',id:'one',requestId:'resume',revision:1})
 await h.manager.call({action:'assign',id:'one',requestId:'task',revision:2,discussion:'main',text:'task'})
 await ticks(h,()=>started);writeFileSync(join(c.sources[0]!.cwd,'keep.txt'),'keep')
 await expect(h.manager.call({action:'destroy',id:'one',requestId:'no-cancel',revision:2})).rejects.toThrow('cancelRunning')
 const command={action:'destroy',id:'one',requestId:'destroy',revision:2,cancelRunning:true}
 expect(await h.manager.call(command)).toMatchObject({status:'destroyed'});expect(cancelled).toBe(true)
 expect(await h.manager.call(command)).toMatchObject({status:'destroyed'});expect(readFileSync(join(c.sources[0]!.cwd,'keep.txt'),'utf8')).toBe('keep')
 expect(h.manager.list().workers.map(w=>w.id)).toEqual(['two'])
})
it('native CLI sends per-agent effort and rejects unsupported API-only settings',async()=>{
 const c=config(),root=c.sources[0]!.cwd,binary=join(root,'fake-codex'),log=join(root,'requests.jsonl')
 writeFileSync(binary,'#!'+process.execPath+`\nconst fs=require('node:fs');const send=x=>console.log(JSON.stringify(x));require('node:readline').createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);fs.appendFileSync(${JSON.stringify(log)},line+'\\n');if(!m.id)return;send({id:m.id,result:m.method==='thread/start'?{thread:{id:'native'},model:'sol'}:m.method==='turn/start'?{turn:{id:'turn'}}:{}});if(m.method==='turn/start'){send({method:'item/completed',params:{item:{type:'agentMessage',text:'{}'}}});send({method:'turn/completed',params:{turn:{id:'turn',status:'completed'}}})}})`,{mode:0o700})
 const model=new CodexModel({codex:binary,effort:'high',turnTimeoutMs:5000}),req={cwd:root,instructions:'test',input:'test',schema:{}}
 await model.run({...req,options:{effort:'medium',parameters:{turn:{serviceTier:'flex'}}}})
 const messages=readFileSync(log,'utf8').trim().split('\n').map(l=>JSON.parse(l));expect(messages.find(m=>m.method==='turn/start').params).toMatchObject({effort:'medium',serviceTier:'flex'})
 await expect(model.run({...req,options:{maxSteps:3}})).rejects.toThrow('does not expose')
 await expect(model.run({...req,options:{effort:'none'}})).rejects.toThrow('not confirmed')
})
it('drains queued delegated work after retire and persists connection edits across restart',async()=>{
 const calls:ModelRequest[]=[],c=config(),original=configSchema.parse(c),h=new Runtime(c,{model:fake(calls)});hosts.push(h)
 const task=await h.manager.call({action:'assign',id:'one',revision:0,requestId:'queue',discussion:'main',text:'queued task'})
 await h.manager.call({action:'retire',id:'one',revision:0,requestId:'retire'})
 await expect(h.manager.call({action:'assign',id:'one',revision:1,requestId:'later',discussion:'main',text:'new task'})).rejects.toThrow('enabled')
 await ticks(h,()=>!!h.store.tickets.get(task.ticketId)?.ended);expect(calls).toHaveLength(1)
 h.updateSettings(1,{backends:{separate:{kind:'codex',command:'/custom/codex',args:['--profile','work'],defaults:{effort:'medium'}}}})
 await h.close();hosts.splice(hosts.indexOf(h),1)
 const restored=new Runtime(original,{model:fake([])});hosts.push(restored)
 expect(restored.config.backends.separate).toMatchObject({command:'/custom/codex',defaults:{effort:'medium'}})
 expect(restored.manager.list().workers[0]!.state).toBe('retiring')
})
it('rejects tools removed from the Agent configuration on an existing native session',async()=>{
 let allowed=false,first=true;const c=config(),h=new Runtime(c,{model:{async run(r){r.onThread?.('persistent');r.onTurn?.('turn');const value=await r.onTool!('superagent_progress',{summary:'check'},'call');allowed=value.success;first=false;return {threadId:'persistent',turnId:'turn',text:JSON.stringify(report)}}}});hosts.push(h)
 await h.manager.call({action:'configure',id:'one',revision:0,requestId:'tools',patch:{tools:[]}})
 const task=await h.manager.call({action:'assign',id:'one',revision:1,requestId:'task',discussion:'main',text:'work'})
 await ticks(h,()=>!first&&!!h.store.tickets.get(task.ticketId)?.ended);expect(allowed).toBe(false)
})
it('never deletes a Worker configuration edited while destroy awaits cancellation',async()=>{
 const calls:ModelRequest[]=[],h=new Runtime(config(),{model:fake(calls)});hosts.push(h)
 const task=await h.manager.call({action:'assign',id:'one',revision:0,requestId:'task',discussion:'main',text:'pending'})
 let release!:()=>void;const stop=h.stop.bind(h);h.stop=async id=>{await new Promise<void>(r=>release=r);await stop(id)}
 const destroy=h.manager.call({action:'destroy',id:'one',revision:0,requestId:'destroy',cancelRunning:true})
 h.updateSettings(1,{execution:{...h.config.execution,workers:h.config.execution.workers!.map(w=>w.id==='one'?{...w,prompt:'new operator edit'}:w)}})
 release();await expect(destroy).rejects.toThrow('changed during cancellation')
 expect(h.manager.list().workers[0]!.prompt).toBe('new operator edit');expect(h.store.tickets.get(task.ticketId)?.ended).toBeTruthy()
 await expect(h.manager.call({action:'destroy',id:'one',revision:0,requestId:'destroy',cancelRunning:true})).rejects.toThrow('changed after')
})
