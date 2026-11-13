import {afterEach,expect,it} from 'vitest'
import {mkdtempSync,rmSync,readFileSync,writeFileSync,mkdirSync,symlinkSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {randomUUID} from 'node:crypto'
import {Runtime} from '../src/runtime.ts'
import {configSchema} from '../src/config.ts'
import {serve} from '../src/server.ts'
import type {ModelRequest} from '../src/model.ts'
import type {Server} from 'node:http'
const roots:string[]=[],hosts:Runtime[]=[],servers:Server[]=[]
afterEach(async()=>{for(const s of servers.splice(0)){s.closeAllConnections();await new Promise<void>(r=>s.close(()=>r()))}for(const h of hosts.splice(0))await h.close();for(const p of roots.splice(0))rmSync(p,{recursive:true,force:true})})
const report={state:'ready',summary:'Worker checked the evidence',reply:'Worker result',question:null,askedBy:null,handbacks:[]}
function fixture(run?:(r:ModelRequest)=>Promise<unknown>){
  const root=mkdtempSync(join(tmpdir(),'roppo-chat-'));roots.push(root)
  const config=configSchema.parse({stateDir:join(root,'state'),port:0,work:{sandboxDriver:'disabled'},execution:{router:{mode:'host',model:'router-one',effort:'medium'},management:{enabled:true},workers:[{id:'research',label:'Research',backend:'codex'},{id:'review',label:'Review',backend:'codex'}]},sources:[{id:'local',kind:'local',cwd:root,allowedActors:['operator']}]})
  const calls:ModelRequest[]=[]
  const model={async run(r:ModelRequest){calls.push(r);const threadId=r.threadId??randomUUID(),turnId=randomUUID();r.onThread?.(threadId);r.onTurn?.(turnId);return {threadId,turnId,text:JSON.stringify(run?await run(r):{reply:'Router reply: '+JSON.parse(r.input).trigger.text})}}}
  const h=new Runtime(config,{model});hosts.push(h)
  return {h,config,model,calls,root}
}
const send=(h:Runtime,id:string,text='Hello Router',clientMessageId=randomUUID())=>h.chat.send(id,'owner',{text,clientMessageId})
async function settle(h:Runtime,done:()=>boolean){for(let i=0;i<500;i++){await h.tick();await new Promise(r=>setTimeout(r,2));if(done())return}throw Error('Chat did not settle')}
function waitForAbort(r:ModelRequest){return new Promise<void>((resolve)=>{if(r.signal?.aborted)return resolve();r.signal?.addEventListener('abort',()=>resolve(),{once:true})})}
function enableChatBatch(h:Runtime,id:string,settings:Record<string,number>={}){
 h.scopes.command({action:'scope.put',operationId:'scope',expectedRevision:0,scope:{id:'team',tenantId:'org',name:'Chat team',managers:[JSON.stringify(['local','operator'])],workerIds:['research','review'],sourceIds:['local'],backendIds:['codex']}})
 h.scopes.command({action:'entry.bind',operationId:'entry',expectedRevision:0,scopeId:'team',sourceId:'local',accountNamespace:'local',nativeId:'chat:'+id,history:'group'})
 h.proactive.command({action:'settings.put',scopeId:'team',operationId:'batch',expectedRevision:0,settings:{enabled:true,debounceMs:0,maxWaitMs:1,cooldownMs:0,...settings}})
}
const batchDecision=(action:string)=>({action,title:'Task',scope:'Requested work',question:'Which task should continue?',reason:'Explicit input',rules:[],targetTicketId:null,ruleAssessments:[]})

it('opens memory in the conversation without creating configuration or fabricating remembered content',()=>{
 const {h,calls}=fixture(),c=h.chat.create('owner')
 expect(h.chat.memory(c.id,'owner')).toEqual({unavailable:true})
 send(h,c.id)
 expect(h.chat.memory(c.id,'owner')).toEqual({unavailable:true})
 expect(h.scopes.enabled()).toBe(false);expect(calls).toHaveLength(0)
 expect(()=>h.chat.memory(c.id,'another')).toThrow('Conversation not found')
 expect(()=>h.chat.memory(c.id,'owner',{kind:'manage',command:{action:'configure',policy:{writeMode:'adaptive'},expectedRevision:0}})).toThrow('no memory context')
})

it('reads and corrects only memory authorized for the owned conversation and preserves saved technical settings',()=>{
 const {h}=fixture(),c=h.chat.create('owner'),other=h.chat.create('owner');enableChatBatch(h,c.id)
 h.scopes.command({action:'entry.bind',operationId:'other-chat-entry',expectedRevision:0,scopeId:'team',sourceId:'local',accountNamespace:'local',nativeId:'chat:'+other.id,history:'group'})
 const sent=send(h,c.id,'技术报告先给结论'),trigger=h.store.triggers.get(sent.runId)!,context=h.scopes.context(trigger,'local:chat:'+c.id)!,source=h.memory.ingest(context)
 const fact=h.memory.command(context,{action:'remember',operationId:'memory',expectedRevision:0,subject:'报告顺序',content:'技术报告先给结论',sourceIds:[source.id],kind:'preference',candidate:false},true) as any
 const before=h.chat.memory(c.id,'owner') as any
 expect(before.items.map((f:any)=>f.id)).toEqual([fact.id]);expect(before).toMatchObject({canConfigure:true,learningAvailable:true,scopeName:'Chat team'})
 const policy={...before.policy,extractModel:'current-memory-model',maxCallsPerDay:27,writeMode:'adaptive'}
 h.chat.memory(c.id,'owner',{kind:'manage',command:{action:'configure',expectedRevision:before.revision,policy}})
 const learned=h.chat.memory(c.id,'owner') as any
 expect(learned.policy).toMatchObject({extractModel:'current-memory-model',maxCallsPerDay:27,writeMode:'adaptive'})
 h.chat.memory(c.id,'owner',{kind:'memory',command:{action:'remember',id:fact.id,operationId:'correct',expectedRevision:fact.revision,subject:fact.subject,content:'技术报告先列未验证项',sourceIds:[source.id],kind:'preference',candidate:false,learning:{inferred:false,condition:'修复报告'}}})
 expect((h.chat.memory(c.id,'owner') as any).adaptation.preferences[0]).toMatchObject({content:'技术报告先列未验证项',learning:{condition:'修复报告'}})
 h.chat.memory(c.id,'owner',{kind:'manage',command:{action:'personal',enabled:false}})
 expect(h.chat.memory(c.id,'owner')).toMatchObject({enabled:false,learningAvailable:false})
 send(h,other.id,'另一个独立任务')
 expect((h.chat.memory(other.id,'owner') as any).items).toEqual([])
 expect(()=>h.chat.memory(other.id,'owner',{kind:'memory',command:{action:'forget',operationId:'wrong-entry',id:fact.id,expectedRevision:2}})).toThrow('Fact unavailable')
 h.updateSettings(h.settings.current().revision,{sources:h.config.sources.map(s=>({...s,allowedActors:['another-operator']}))})
 expect(()=>h.chat.memory(c.id,'owner')).toThrow()
})

it('omits inactive entries from the memory settings catalog',async()=>{
 const {h,root}=fixture(),c=h.chat.create('owner');enableChatBatch(h,c.id)
 const sent=send(h,c.id,'Remember this entry'),host=await serve(h);servers.push(host.server)
 const headers={authorization:'Bearer '+readFileSync(join(root,'state/access-token'),'utf8').trim()}
 const catalog=async()=>await (await fetch(host.url+'/router-management/catalog',{headers})).json() as any
 expect((await catalog()).contexts.map((c:any)=>c.id)).toContain(sent.runId)
 h.scopes.command({action:'entry.bind',operationId:'disable-entry',expectedRevision:1,scopeId:'team',sourceId:'local',accountNamespace:'local',nativeId:'chat:'+c.id,history:'group',active:false})
 expect((await catalog()).contexts).toEqual([])
})

it('serves the conversation memory API with ownership checks and redirects the retired workbench into the app',async()=>{
 const {h,root}=fixture(),host=await serve(h);servers.push(host.server)
 const token=readFileSync(join(root,'state/access-token'),'utf8').trim(),headers={authorization:'Bearer '+token,'content-type':'application/json'}
 const c=h.chat.create('local-operator'),wrong=h.chat.create('another')
 expect((await fetch(host.url+'/api/chat/conversations/'+c.id+'/memory')).status).toBe(401)
 expect(await (await fetch(host.url+'/api/chat/conversations/'+c.id+'/memory',{headers})).json()).toEqual({unavailable:true})
 expect((await fetch(host.url+'/api/chat/conversations/'+wrong.id+'/memory',{headers})).status).toBe(404)
 expect((await fetch(host.url+'/api/chat/conversations/'+c.id+'/memory',{method:'POST',headers:{...headers,origin:'https://wrong.example'},body:JSON.stringify({kind:'manage',command:{action:'inspect'}})})).status).toBe(403)
 const redirect=await fetch(host.url+'/memory-workbench',{headers,redirect:'manual'})
 expect(redirect.status).toBe(302);expect(redirect.headers.get('location')).toBe('/configure#advanced/memory')
})

it('delivers batch clarification once into chat, waits for input and recovers legacy sent replies after restart',async()=>{
 const f=fixture(async()=>batchDecision('clarify')),c=f.h.chat.create('owner');enableChatBatch(f.h,c.id)
 const run=send(f.h,c.id,'Continue it')
 expect(f.h.chat.view(c.id,'owner').run?.state).toBe('queued')
 await settle(f.h,()=>f.h.store.deliveries().some(d=>d.id.startsWith('router-clarify:')&&d.status==='sent'))
 expect(f.h.chat.view(c.id,'owner')).toMatchObject({run:{state:'waiting'},messages:[{role:'user'},{role:'assistant',text:'Which task should continue?',runId:run.runId}]})
 await f.h.flush();expect(f.h.chat.view(c.id,'owner').messages).toHaveLength(2)
 // Older hosts marked the outbox sent without creating its chat projection.
 f.h.store.db.prepare("DELETE FROM records WHERE kind='chat-message' AND json_extract(body,'$.role')='assistant'").run()
 hosts.splice(hosts.indexOf(f.h),1);await f.h.close()
 const h=new Runtime(f.config,{model:f.model});hosts.push(h)
 expect(h.chat.view(c.id,'owner').messages.filter(m=>m.role==='assistant')).toMatchObject([{text:'Which task should continue?'}])
 expect(h.chat.view(c.id,'owner').run?.state).toBe('waiting')
 expect(()=>send(h,c.id,'The report task')).not.toThrow();expect(f.calls).toHaveLength(1)
})
it.each(['accept','ignore','failure'])('projects the %s batch lifecycle without leaving chat queued forever',async action=>{
 const f=fixture(async r=>{if(!r.ephemeral)return {reply:'Router continued'};if(action==='failure')throw Error('Assessment unavailable');return batchDecision(action)}),c=f.h.chat.create('owner');enableChatBatch(f.h,c.id)
 send(f.h,c.id);expect(()=>send(f.h,c.id,'Too early')).toThrow('Wait')
 await settle(f.h,()=>f.h.store.list<any>('router-batch').some(b=>b.state==='decided'||b.state==='failed'))
 await settle(f.h,()=>['completed','failed'].includes(f.h.chat.view(c.id,'owner').run?.state??''))
 expect(f.h.chat.view(c.id,'owner').run?.state).toBe(action==='failure'?'failed':'completed')
 expect(f.h.chat.view(c.id,'owner').messages.filter(m=>m.role==='assistant')).toHaveLength(action==='accept'?1:0)
 expect(()=>send(f.h,c.id,'Next request')).not.toThrow()
})
it.each(['cancelled','revoked'])('does not recover a legacy clarification after its input is %s',async state=>{
 const f=fixture(async()=>batchDecision('clarify')),c=f.h.chat.create('owner');enableChatBatch(f.h,c.id)
 const run=send(f.h,c.id)
 await settle(f.h,()=>f.h.store.deliveries().some(d=>d.id.startsWith('router-clarify:')&&d.status==='sent'))
 f.h.store.db.prepare("DELETE FROM records WHERE kind='chat-message' AND json_extract(body,'$.role')='assistant'").run()
 if(state==='cancelled')await f.h.chat.cancel(c.id,'owner',run.runId)
 else f.h.updateSettings(f.h.settings.current().revision,{sources:f.h.config.sources.map(s=>({...s,allowedActors:['another-operator']}))})
 hosts.splice(hosts.indexOf(f.h),1);await f.h.close()
 const h=new Runtime(f.config,{model:f.model});hosts.push(h)
 expect(h.chat.view(c.id,'owner').messages.filter(m=>m.role==='assistant')).toHaveLength(0)
 expect(f.calls).toHaveLength(1)
})
it('fences a late batch clarification after the user cancels the chat run',async()=>{
 let started=false,release!:()=>void
 const gate=new Promise<void>(r=>{release=r})
 const f=fixture(async()=>{started=true;await gate;return batchDecision('clarify')}),c=f.h.chat.create('owner');enableChatBatch(f.h,c.id)
 const run=send(f.h,c.id)
 try{
  await settle(f.h,()=>started);expect(f.h.chat.view(c.id,'owner').run?.state).toBe('running')
  await f.h.chat.cancel(c.id,'owner',run.runId)
 }finally{release()}
 await settle(f.h,()=>f.h.store.list<any>('router-batch').some(b=>b.state==='failed'))
 expect(f.h.chat.view(c.id,'owner').run?.state).toBe('cancelled')
 expect(f.h.chat.view(c.id,'owner').messages.filter(m=>m.role==='assistant')).toHaveLength(0)
 expect(f.h.store.deliveries().filter(d=>d.id.startsWith('router-clarify:'))).toHaveLength(0)
})
it('keeps a fresh message out of a cancelled pending batch',async()=>{
 const f=fixture(async()=>batchDecision('clarify')),c=f.h.chat.create('owner');enableChatBatch(f.h,c.id,{maxWaitMs:60000})
 const first=send(f.h,c.id,'Old question');await f.h.chat.cancel(c.id,'owner',first.runId)
 const next=send(f.h,c.id,'New question')
 await settle(f.h,()=>['waiting','failed'].includes(f.h.chat.view(c.id,'owner').run?.state??''))
 expect(f.h.chat.view(c.id,'owner').run).toMatchObject({id:next.runId,state:'waiting'})
 expect(f.h.chat.view(c.id,'owner').messages.filter(m=>m.role==='assistant')).toMatchObject([{runId:next.runId}])
 expect(f.calls).toHaveLength(1)
})

it('projects true partial Router output into one durable message and replaces it with the validated reply',async()=>{
  const {h}=fixture(),c=h.chat.create('owner'),run=send(h,c.id),notifications:number[]=[]
  const off=h.chat.subscribe(c.id,'owner',()=>notifications.push(h.chat.revision(c.id,'owner')))
  h.chat.output('stream-job',run.runId,{id:'out',type:'start',phase:'answer'})
  h.chat.output('stream-job',run.runId,{id:'out',type:'delta',phase:'answer',text:'{"reply":"你好'})
  await new Promise(r=>setTimeout(r,90))
  expect(h.chat.view(c.id,'owner').messages.at(-1)).toMatchObject({id:'reply:stream-job',text:'你好',status:'streaming'})
  expect(notifications.length).toBeGreaterThan(0)
  h.chat.output('stream-job',run.runId,{id:'out',type:'delta',phase:'answer',text:' 🌍"}'})
  h.chat.reply('stream-job',run.runId,'你好 🌍')
  await new Promise(r=>setTimeout(r,90))
  const messages=h.chat.view(c.id,'owner').messages
  expect(messages).toHaveLength(2);expect(messages.at(-1)).toMatchObject({text:'你好 🌍',status:'complete',sequence:2})
  off();expect(()=>h.chat.subscribe(c.id,'stranger',()=>{})).toThrow('not found')
})
it('clears a replaced output attempt and never exposes commentary or malformed JSON as a Router answer',async()=>{
  const {h}=fixture(),c=h.chat.create('owner'),run=send(h,c.id)
  h.chat.output('job',run.runId,{id:'old',type:'delta',phase:'answer',text:'{"reply":"obsolete'})
  await new Promise(r=>setTimeout(r,90))
  h.chat.output('job',run.runId,{id:'next',type:'start',phase:'answer'})
  h.chat.output('job',run.runId,{id:'comment',type:'delta',phase:'commentary',text:'not a final answer'})
  h.chat.output('job',run.runId,{id:'next',type:'delta',phase:'answer',text:'{"reasoning":"private"'})
  await new Promise(r=>setTimeout(r,90))
  expect(h.chat.view(c.id,'owner').messages.at(-1)?.text).toBe('')
  h.chat.reply('job',run.runId,'Corrected')
  expect(h.chat.view(c.id,'owner').messages.at(-1)?.text).toBe('Corrected')
})
it('preserves partial output as interrupted when cancelled and ignores all late deltas',async()=>{
  const {h}=fixture(async r=>{r.onOutput?.({id:'answer',type:'delta',phase:'answer',text:'{"reply":"partial'});await waitForAbort(r);r.onOutput?.({id:'answer',type:'delta',phase:'answer',text:' late"}'});return {reply:'late final'}}),c=h.chat.create('owner'),run=send(h,c.id)
  await settle(h,()=>h.chat.view(c.id,'owner').messages.some(m=>m.status==='streaming'))
  await h.chat.cancel(c.id,'owner',run.runId)
  await new Promise(r=>setTimeout(r,90))
  expect(h.chat.view(c.id,'owner').messages.at(-1)).toMatchObject({text:'partial',status:'interrupted'})
  expect(h.chat.view(c.id,'owner').run?.state).toBe('cancelled')
})
it('retains tool metadata across restart and global activity pruning without exposing raw arguments',async()=>{
  const f=fixture(),c=f.h.chat.create('owner'),run=send(f.h,c.id)
  await f.h.activity.tool('worker_manage',{triggerId:run.runId},async()=>({success:true,private:'hidden'}),undefined,{action:'list'})
  for(let i=0;i<210;i++){const id=f.h.activity.begin('router','other');f.h.activity.finish(id,'completed')}
  expect(f.h.chat.view(c.id,'owner').calls).toMatchObject([{name:'worker_manage',action:'list',state:'completed'}])
  expect(JSON.stringify(f.h.chat.view(c.id,'owner').calls)).not.toContain('hidden')
  hosts.splice(hosts.indexOf(f.h),1);await f.h.close()
  const h=new Runtime(f.config,{model:f.model});hosts.push(h)
  expect(h.chat.view(c.id,'owner').calls).toHaveLength(1)
  const other=h.chat.create('other');expect(h.chat.view(other.id,'other').calls).toHaveLength(0)
})
it('stops streamed output when source authorization is withdrawn, including buffered text',async()=>{
  const f=fixture(async r=>{
    r.onOutput?.({id:'answer',type:'delta',phase:'answer',text:'{"reply":"pending'})
    f.config.sources[0]!.allowedActors=[]
    await new Promise(resolve=>setTimeout(resolve,90))
    expect(f.h.chat.view(c.id,'owner').messages).toHaveLength(1)
    r.onOutput?.({id:'answer',type:'delta',phase:'answer',text:' withdrawn"}'})
    expect(r.signal?.aborted).toBe(true)
    return {reply:'withdrawn final'}
  }),c=f.h.chat.create('owner')
  send(f.h,c.id)
  await settle(f.h,()=>f.h.chat.view(c.id,'owner').run?.state==='failed')
  expect(f.h.chat.view(c.id,'owner').messages).toHaveLength(1)
  expect(f.h.store.list('router-result')).toHaveLength(0)
})
it('marks persisted partial output and running calls interrupted on restart, never completed',async()=>{
  const f=fixture(),c=f.h.chat.create('owner'),run=send(f.h,c.id)
  f.h.chat.reply('crash-job',run.runId,'Partial')
  const message=f.h.store.get<any>('chat-message','reply:crash-job')!
  f.h.store.put('chat-message',message.id,{...message,status:'streaming'})
  f.h.activity.begin('router','router',{triggerId:run.runId})
  hosts.splice(hosts.indexOf(f.h),1);await f.h.close()
  const h=new Runtime(f.config,{model:f.model});hosts.push(h)
  expect(h.chat.view(c.id,'owner').messages.at(-1)?.status).toBe('interrupted')
  expect(h.chat.view(c.id,'owner').calls.every(c=>c.state==='interrupted')).toBe(true)
})

it('persists full Router replies and continues the original native thread after restart',async()=>{
  const f=fixture(),c=f.h.chat.create('owner');send(f.h,c.id,'First')
  await settle(f.h,()=>f.h.chat.view(c.id,'owner').run?.state==='completed')
  const thread=f.h.store.list<any>('router-session')[0].threadId
  hosts.splice(hosts.indexOf(f.h),1);await f.h.close()
  const restored=new Runtime(f.config,{model:f.model});hosts.push(restored)
  expect(restored.chat.list('owner')[0]?.title).toBe('First')
  send(restored,c.id,'Second');await settle(restored,()=>restored.chat.view(c.id,'owner').messages.length===4)
  expect(f.calls.at(-1)?.threadId).toBe(thread)
  expect(restored.chat.view(c.id,'owner').messages.map(m=>m.role)).toEqual(['user','assistant','user','assistant'])
})
it('receives a browser message exactly once and rejects conflicting identity reuse',()=>{
  const {h}=fixture(),c=h.chat.create('owner'),id=randomUUID(),a=send(h,c.id,'First',id)
  expect(send(h,c.id,'First',id)).toEqual({runId:a.runId,duplicate:true})
  expect(()=>send(h,c.id,'Changed',id)).toThrow('different text')
  expect(h.chat.view(c.id,'owner').messages).toHaveLength(1)
  expect(h.store.jobs().filter(j=>j.kind==='router')).toHaveLength(1)
  expect(()=>send(h,c.id,'Parallel')).toThrow('Wait')
})
it('keeps conversations and owners isolated and binds new sessions to their original Router options',async()=>{
  const {h,calls,config}=fixture(),a=h.chat.create('owner'),b=h.chat.create('other')
  send(h,a.id,'A');h.chat.send(b.id,'other',{text:'B',clientMessageId:randomUUID()})
  config.execution.router!.model='router-two';config.execution.router!.effort='high'
  await settle(h,()=>h.chat.view(a.id,'owner').run?.state==='completed'&&h.chat.view(b.id,'other').run?.state==='completed')
  expect(calls.map(r=>r.model)).toEqual(['router-one','router-one'])
  expect(calls.map(r=>r.options?.effort)).toEqual(['medium','medium'])
  expect(h.chat.view(a.id,'owner').messages.at(-1)?.text).toContain('A')
  expect(h.chat.list('owner')).toHaveLength(1)
  expect(()=>h.chat.view(a.id,'other')).toThrow('not found')
  expect(()=>h.chat.update(a.id,'other',{title:'Hijacked'})).toThrow('not found')
})
it('projects real Router-to-Worker dialogue with distinct speakers and no extra external deliveries',async()=>{
  const {h,calls}=fixture(async r=>{
    if(r.role==='worker')return report
    if(JSON.parse(r.input).kind==='user_message'){
      const value=await r.onTool!('worker_manage',{action:'assign',revision:0,requestId:'work',id:'research',text:'Check evidence'},'tool')
      expect(value.success).toBe(true);return {reply:'I have assigned the research.'}
    }
    return {reply:'I reviewed the Worker result.'}
  })
  const c=h.chat.create('owner');send(h,c.id)
  await settle(h,()=>h.chat.view(c.id,'owner').messages.some(m=>m.text==='I reviewed the Worker result.'))
  const view=h.chat.view(c.id,'owner')
  expect(calls.map(r=>r.role)).toEqual(['router','worker','router'])
  expect(view.workers[0]?.tasks[0]).toMatchObject({state:'completed',title:'Check evidence'})
  expect(view.messages.find(m=>m.text==='Worker result')).toMatchObject({speaker:{id:'research',label:'Research',kind:'worker'},recipient:{kind:'router'}})
  expect(view.messages.find(m=>m.text==='Check evidence')).toMatchObject({speaker:{kind:'router'},recipient:{id:'research'}})
  expect(view.messages.map(m=>m.id).length).toBe(new Set(view.messages.map(m=>m.id)).size)
  expect(h.store.deliveries().filter(d=>!d.channel.address.routerInbox).map(d=>d.text)).not.toContain('Worker result')
})
it('cancels queued work without ever calling a model and permits a subsequent message',async()=>{
  const {h,calls}=fixture(),c=h.chat.create('owner'),run=send(h,c.id)
  await h.chat.cancel(c.id,'owner',run.runId);await h.tick()
  expect(calls).toHaveLength(0);expect(h.chat.view(c.id,'owner').run?.state).toBe('cancelled')
  send(h,c.id,'Continue');await settle(h,()=>h.chat.view(c.id,'owner').run?.state==='completed')
  expect(calls).toHaveLength(1)
})
it('routes a continued Worker to the new chat turn and cancels that activation',async()=>{
  let ticketId='',workerTurns=0
  const {h}=fixture(async r=>{
    if(r.role==='worker'){
      if(++workerTurns===1)return {...report,state:'blocked',reply:'Need one detail',question:'Which scope?'}
      await waitForAbort(r);return report
    }
    const data=JSON.parse(r.input)
    if(data.kind==='user_message'){
      const result=await r.onTool!('worker_manage',ticketId?{action:'send',revision:0,requestId:'continue',ticketId,text:'Continue with the new scope'}:{action:'assign',revision:0,requestId:'first-task',id:'research',text:'Research scope'},'tool')
      expect(result.success).toBe(true)
      ticketId=JSON.parse(result.contentItems[0]!.text!).ticketId
    }
    return {reply:'Please specify the scope.'}
  })
  const c=h.chat.create('owner'),first=send(h,c.id)
  await settle(h,()=>h.chat.view(c.id,'owner').run?.state==='waiting')
  const next=send(h,c.id,'Use the personal scope')
  await settle(h,()=>workerTurns===2)
  expect(h.store.get<any>('worker-assignment',ticketId).parentTrigger).toBe(next.runId)
  expect(h.chat.view(c.id,'owner').workers[0]?.tasks[0]?.state).toBe('running')
  // Cancelling an old turn cannot stop the activation owned by this follow-up.
  await h.chat.cancel(c.id,'owner',first.runId)
  expect(h.chat.view(c.id,'owner').workers[0]?.tasks[0]?.state).toBe('running')
  await h.chat.cancel(c.id,'owner',next.runId)
  expect(h.chat.view(c.id,'owner').workers[0]?.tasks[0]?.state).toBe('cancelled')
})
it('fences a cancelled Router even when the backend returns a late successful reply',async()=>{
  const {h}=fixture(async r=>{await waitForAbort(r);return {reply:'Late reply must not appear'}}),c=h.chat.create('owner'),run=send(h,c.id)
  await settle(h,()=>h.chat.view(c.id,'owner').run?.state==='running')
  await h.chat.cancel(c.id,'owner',run.runId)
  expect(h.chat.view(c.id,'owner').messages.map(m=>m.role)).toEqual(['user'])
  expect(h.store.list('router-result')).toHaveLength(0)
})
it('stops the assigned Worker and suppresses callbacks without affecting another conversation',async()=>{
  let workerStarted=false
  const {h}=fixture(async r=>{
    const data=JSON.parse(r.input)
    if(r.role==='worker'){workerStarted=true;await waitForAbort(r);return report}
    if(data.trigger?.text==='Other')return {reply:'Other remains intact'}
    if(data.kind==='user_message')await r.onTool!('worker_manage',{action:'assign',revision:0,requestId:'cancel-worker',id:'research',text:'Long research'},'tool')
    return {reply:''}
  })
  const c=h.chat.create('owner'),other=h.chat.create('owner'),run=send(h,c.id)
  await settle(h,()=>workerStarted);send(h,other.id,'Other')
  await h.chat.cancel(c.id,'owner',run.runId)
  await settle(h,()=>h.chat.view(other.id,'owner').run?.state==='completed')
  expect(h.chat.view(c.id,'owner').workers[0]?.tasks[0]?.state).toBe('cancelled')
  expect(h.chat.view(other.id,'owner').messages.at(-1)?.text).toBe('Other remains intact')
  expect(h.store.jobs().filter(j=>j.kind==='router'&&(j.payload as any).triggerId===run.runId)).toHaveLength(0)
})
it.each(['client','assessment'] as const)('does not silently replace %s Router mode',mode=>{
  const {h,config}=fixture();config.execution.router!.mode=mode
  expect(h.chat.readiness()).toMatchObject({ready:false,code:'host_router_required'})
  expect(()=>h.chat.create('owner')).toThrow('host Router')
  expect(config.execution.router!.mode).toBe(mode)
})
it('blocks paused/unavailable ingress and rolls back messages rejected by policy',()=>{
  const {h,config}=fixture(),c=h.chat.create('owner');h.pause(true)
  expect(()=>send(h,c.id)).toThrow('not ready');h.pause(false)
  config.sources[0]!.listenScopes=['unrelated']
  expect(()=>send(h,c.id)).toThrow('not admitted')
  expect(h.chat.view(c.id,'owner').messages).toHaveLength(0)
  expect(h.store.list('chat-run')).toHaveLength(0)
})
it('supports rename/archive/restore without deleting history or cancelling work',async()=>{
  const {h}=fixture(),c=h.chat.create('owner');send(h,c.id)
  h.chat.update(c.id,'owner',{title:'Named',archived:true})
  expect(h.chat.list('owner')).toHaveLength(0);expect(h.chat.list('owner',true)[0]?.title).toBe('Named')
  await settle(h,()=>h.chat.view(c.id,'owner').run?.state==='completed')
  expect(()=>send(h,c.id)).toThrow('Restore')
  h.chat.update(c.id,'owner',{archived:false});send(h,c.id,'Follow up')
})
it('does not truncate long replies, paginates history and keeps stable state revisions',()=>{
  const {h}=fixture(),c=h.chat.create('owner'),r=send(h,c.id),long='long '.repeat(3000)
  h.store.atomic(()=>{for(let i=0;i<120;i++)h.chat.reply('job-'+i,r.runId,i===119?long:'Reply '+i)})
  const view=h.chat.view(c.id,'owner'),revision=h.chat.revision(c.id,'owner')
  expect(view.messages).toHaveLength(100);expect(view.hasMore).toBe(true);expect(view.messages.at(-1)?.text).toBe(long)
  const earlier=h.chat.view(c.id,'owner',view.messages[0]!.sequence)
  expect(earlier.messages).toHaveLength(21);expect(earlier.hasMore).toBe(false)
  expect(h.chat.revision(c.id,'owner')).toBe(revision)
  h.chat.update(c.id,'owner',{title:'Updated'});expect(h.chat.revision(c.id,'owner')).toBeGreaterThan(revision)
})
it('requires an explicit new conversation when a bound backend definition changes',async()=>{
  const f=fixture();hosts.splice(hosts.indexOf(f.h),1);await f.h.close()
  const config=configSchema.parse({...f.config,stateDir:join(f.root,'api-state'),backends:{api:{kind:'openai-responses',baseUrl:'http://127.0.0.1:9',model:'original',parameters:{temperature:0.2},defaults:{maxOutputTokens:1000}}},execution:{...f.config.execution,router:{mode:'host',backend:'api'}}})
  const h=new Runtime(config);hosts.push(h)
  const c=h.chat.create('owner');expect(h.chat.readiness().ready).toBe(true);expect(c.backend).toBe('api')
  config.backends.api!.label='A renamed connection'
  const first=send(h,c.id)
  await h.chat.cancel(c.id,'owner',first.runId)
  ;(config.backends.api as any).parameters.temperature=0.7
  expect(()=>send(h,c.id,'New parameters')).toThrow('backend changed')
  expect(h.chat.create('owner').backend).toBe('api')
})
it('exposes real failure state rather than claiming a completed reply',async()=>{
  const {h}=fixture(async()=>{throw Error('Provider refused the request')}),c=h.chat.create('owner');send(h,c.id)
  await settle(h,()=>h.chat.view(c.id,'owner').run?.state==='failed')
  expect(h.chat.view(c.id,'owner').messages).toHaveLength(1)
})
it('serves authenticated APIs, validates ownership and synchronizes durable revisions via SSE',async()=>{
  const {h,root}=fixture(),host=await serve(h);servers.push(host.server)
  const token=readFileSync(join(root,'state/access-token'),'utf8').trim(),headers={authorization:'Bearer '+token,'content-type':'application/json'}
  const call=(path:string,body?:unknown,method='POST')=>fetch(host.url+'/api/chat'+path,{headers,...(body!==undefined?{method,body:JSON.stringify(body)}:{})})
  expect((await fetch(host.url+'/api/chat/conversations')).status).toBe(401)
  const created=await call('/conversations',{}),c=await created.json() as {id:string};expect(created.status).toBe(201)
  const accepted=await call('/conversations/'+c.id+'/messages',{clientMessageId:randomUUID(),text:'HTTP message'});expect(accepted.status).toBe(202)
  const controller=new AbortController(),events=await fetch(host.url+'/api/chat/conversations/'+c.id+'/events',{headers,signal:controller.signal})
  expect(events.headers.get('content-type')).toBe('text/event-stream')
  const reader=events.body!.getReader(),first=await reader.read();expect(new TextDecoder().decode(first.value)).toContain('event: change')
  await reader.cancel();controller.abort()
  expect((await fetch(host.url+'/api/chat/conversations/'+c.id,{method:'PATCH',headers:{...headers,origin:'https://wrong.example'},body:JSON.stringify({title:'Bad'})})).status).toBe(403)
  expect((await call('/conversations/'+c.id+'/messages',{clientMessageId:randomUUID(),text:' '})).status).toBe(400)
  const wrong=h.chat.create('another');expect((await call('/conversations/'+wrong.id)).status).toBe(404)
})

it('reads actual task files only within the owning conversation, including paginated text',async()=>{
  const {h,root}=fixture(async r=>{
    if(r.role==='worker')return report
    if(JSON.parse(r.input).kind==='user_message')await r.onTool!('worker_manage',{action:'assign',revision:0,requestId:randomUUID(),id:'research',text:'Prepare files'},'files-tool')
    return {reply:'Files ready'}
  })
  const c=h.chat.create('owner');send(h,c.id)
  await settle(h,()=>!!h.chat.view(c.id,'owner').workers[0]?.tasks.some(t=>t.state==='completed'))
  const ticket=h.chat.view(c.id,'owner').workers[0]!.tasks[0]!.id,run=h.store.get<any>('run',ticket)
  writeFileSync(join(run.cwd,'report.txt'),'Real task output.\n'+'x'.repeat(9000));mkdirSync(join(run.cwd,'reports'));writeFileSync(join(run.cwd,'reports','done.md'),'# Finished')
  const list=await h.chat.files(c.id,'owner');expect(list.tasks.map(t=>t.id)).toContain(ticket)
  const directory=await h.chat.files(c.id,'owner',{ticket});expect(directory.result.items).toContainEqual({name:'report.txt',directory:false})
  const first=await h.chat.files(c.id,'owner',{ticket,path:'report.txt',kind:'files'});expect(first.result.text).toHaveLength(8000);expect(first.result.text).toContain('Real task output.')
  const second=await h.chat.files(c.id,'owner',{ticket,path:'report.txt',kind:'files',offset:8000,cursor:first.result.cursor});expect(second.result.nextOffset).toBeNull();expect(first.result.text+second.result.text).toBe(readFileSync(join(run.cwd,'report.txt'),'utf8'))
  expect((await h.chat.files(c.id,'owner',{ticket,path:'reports/done.md',kind:'files'})).result.text).toBe('# Finished')
  const other=h.chat.create('owner');await expect(h.chat.files(other.id,'owner',{ticket})).rejects.toMatchObject({code:'file_task_missing'})
  await expect(h.chat.files(c.id,'stranger',{ticket})).rejects.toMatchObject({code:'conversation_missing'})
  writeFileSync(join(root,'state','private.txt'),'private');symlinkSync(join(root,'state','private.txt'),join(run.cwd,'private-link'))
  for(const path of ['../','state/private.txt','private-link','.git/config'])await expect(h.chat.files(c.id,'owner',{ticket,path,kind:'files'})).rejects.toMatchObject({code:'file_unavailable'})
  expect((await h.chat.files(other.id,'owner')).tasks).toEqual([])
})

it('rechecks scoped memory before publishing buffered chat output',async()=>{
 let context:any,fact:any
 const f=fixture(async r=>{
  r.onOutput?.({id:'answer',type:'delta',phase:'answer',text:'{"reply":"Budget 73'})
  f.h.memory.command(context,{action:'forget',operationId:'forget-stream',expectedRevision:fact.revision,id:fact.id},true)
  await new Promise(resolve=>setTimeout(resolve,100))
  return {reply:'Budget 73'}
 })
 const chat=f.h.chat.create('owner')
 f.h.scopes.command({action:'scope.put',operationId:'chat-scope',expectedRevision:0,scope:{id:'team',tenantId:'org',name:'Team',managers:[JSON.stringify(['local','operator'])],workerIds:['research','review'],sourceIds:['local'],backendIds:['codex']}})
 f.h.scopes.command({action:'entry.bind',operationId:'chat-entry',expectedRevision:0,scopeId:'team',sourceId:'local',accountNamespace:'local',nativeId:'chat:'+chat.id,history:'group'})
 const seeded=f.h.receive('local','operator',{id:'seed',thread:'chat:'+chat.id,scope:'chat:'+chat.id,text:'Record budget',addressed:true}) as any
 const trigger=f.h.store.triggers.get(seeded.triggerId)!;context=f.h.scopes.context(trigger,'local:chat:'+chat.id)!
 const e=f.h.memory.ingest(context);fact=f.h.memory.command(context,{action:'remember',operationId:'stream-fact',expectedRevision:0,subject:'budget',content:'Budget 73',sourceIds:[e.id],candidate:false},true)
 f.h.store.jobState('router:'+seeded.triggerId,'done')
 send(f.h,chat.id,'budget')
 await settle(f.h,()=>f.h.chat.view(chat.id,'owner').run?.state==='failed')
 expect(f.h.chat.view(chat.id,'owner').messages.every(m=>m.role!=='assistant'||!m.text.includes('Budget 73'))).toBe(true)
})

it('keeps a single owner-specific chat across display changes and adopts the most recent legacy conversation without deleting others',()=>{
 const {h}=fixture(),first=h.chat.create('owner'),second=h.chat.create('owner');h.chat.update(first.id,'owner',{title:'Latest legacy chat'})
 const space=h.chat.space('owner',true);expect(space.conversation?.id).toBe(first.id)
 expect(h.chat.display('owner','agents')).toMatchObject({display:'agents',conversation:{id:first.id}})
 expect(h.chat.space('owner',true).conversation?.id).toBe(first.id)
 expect(h.chat.space('someone-else',true).conversation?.id).not.toBe(first.id)
 expect(h.chat.view(second.id,'owner').messages).toEqual([])
})

it('clears native Chat context, fences late output, preserves configuration and starts a fresh bound chat',async()=>{
 const f=fixture(),c=f.h.chat.space('owner',true).conversation!;enableChatBatch(f.h,c.id)
 const run=send(f.h,c.id,'记住：本次测试的唯一记忆'),trigger=f.h.store.triggers.get(run.runId)!,context=f.h.scopes.context(trigger,'local:chat:'+c.id)!,e=f.h.memory.ingest(context)
 const fact=f.h.memory.command(context,{action:'remember',operationId:'save',expectedRevision:0,subject:'Unique',content:'Only before reset',sourceIds:[e.id],candidate:false},true) as any
 f.h.chat.reply('reply-before-reset',run.runId,'Old answer')
 f.h.chat.display('owner','agents')
 const settings=f.h.settings.current(),op=randomUUID(),reset=f.h.chat.reset('owner',op)
 expect(reset.conversation).toBeNull();expect(reset.display).toBe('agents');expect(reset.cleanup).toMatchObject({status:'processing'})
 expect(f.h.memory.fact(fact.id)?.content).toBe('');expect(f.h.store.triggers.get(run.runId)?.text).toBe('')
 expect(()=>f.h.chat.view(c.id,'owner')).toThrow('cleared');expect(()=>send(f.h,c.id)).toThrow('cleared')
 f.h.chat.reply('late',run.runId,'Must never return');expect(f.h.store.get('chat-message','reply:late')).toBeUndefined()
 const fresh=f.h.chat.space('owner',true).conversation!;expect(fresh.id).not.toBe(c.id)
 const next=send(f.h,fresh.id,'A fresh authorized request');expect(f.h.routerIngress.get(next.runId)?.state).toBe('accepted')
 expect(f.h.chat.view(fresh.id,'owner').messages.map(m=>m.text)).toEqual(['A fresh authorized request'])
 expect(f.h.chat.reset('owner',op).conversation?.id).toBe(fresh.id)
 await f.h.memory.cleanup.process({run:async()=>{throw Error('No model')},purge:async()=>({local:'verified',provider:'not_managed'})},async()=>true)
 expect(f.h.chat.space('owner').cleanup?.status).toBe('completed');expect(f.h.settings.current()).toEqual(settings)
 expect(f.h.scopes.binding(context.route.entryId).active).toBe(true)
})

it('quiesces a running unscoped Router before completing reset, survives restart and never resumes its native context',async()=>{
 let aborted=false;const f=fixture(async r=>{await waitForAbort(r);aborted=true;throw Error('Stopped')}),c=f.h.chat.space('owner',true).conversation!
 send(f.h,c.id);await settle(f.h,()=>f.calls.length===1)
 const reset=f.h.chat.reset('owner',randomUUID())
 await settle(f.h,()=>aborted)
 expect(f.h.chat.space('owner').cleanup).toMatchObject({status:'processing'})
 const purged:string[]=[]
 const receipt=f.h.memory.cleanup.receipts().find(r=>r.id===reset.cleanupId)!;f.h.store.put('history-cleanup',receipt.id,{...receipt,nextAt:0})
 await f.h.memory.cleanup.process({run:async()=>{throw Error('unused')},purge:async thread=>{purged.push(thread);return {local:'verified',provider:'not_managed'}}},async()=>true)
 expect(purged.length).toBeGreaterThan(0)
 await f.h.close();hosts.splice(hosts.indexOf(f.h),1)
 const reopened=new Runtime(f.config,{model:f.model});hosts.push(reopened)
 expect(()=>reopened.chat.view(c.id,'owner')).toThrow('cleared')
 const fresh=reopened.chat.space('owner',true).conversation!;expect(fresh.id).not.toBe(c.id)
 expect(reopened.chat.view(fresh.id,'owner').messages).toEqual([])
})

it('rejects a Chat reset before changing memory when one of its task merges has been submitted',async()=>{
 const {h,root}=fixture(),c=h.chat.space('owner',true).conversation!,sent=send(h,c.id),trigger=h.store.triggers.get(sent.runId)!
 const task=await h.manager.call({action:'assign',revision:0,requestId:'merge-test',id:'research',text:'Check the repository'},{trigger,discussion:'local:chat:'+c.id})
 h.store.put('run',task.ticketId,{ticketId:task.ticketId,phase:'merging',cwd:root})
 expect(()=>h.chat.reset('owner',randomUUID())).toThrow('merge is in progress')
 expect(h.memory.cleanup.plans()).toEqual([]);expect(h.chat.view(c.id,'owner').messages.some(m=>m.role==='user')).toBe(true)
})

it('replays the reset ledger over an older database snapshot without reviving memory or the old chat',async()=>{
 const f=fixture(),c=f.h.chat.space('owner',true).conversation!;enableChatBatch(f.h,c.id)
 const run=send(f.h,c.id,'记住：只能出现在旧快照中'),t=f.h.store.triggers.get(run.runId)!,context=f.h.scopes.context(t,'local:chat:'+c.id)!,source=f.h.memory.ingest(context)
 const fact=f.h.memory.command(context,{action:'remember',operationId:'old-snapshot',expectedRevision:0,subject:'Old',content:'Snapshot-only memory',sourceIds:[source.id],candidate:false},true) as any
 const backup=join(f.root,'before-reset.sqlite');f.h.store.db.prepare('VACUUM INTO ?').run(backup)
 f.h.chat.reset('owner',randomUUID());await f.h.close();hosts.splice(hosts.indexOf(f.h),1)
 writeFileSync(join(f.config.stateDir,'state.sqlite'),readFileSync(backup))
 const restored=new Runtime(f.config,{model:f.model});hosts.push(restored)
 expect(restored.memory.fact(fact.id)?.content).toBe('');expect(restored.store.triggers.get(run.runId)?.text).toBe('')
 expect(()=>restored.chat.view(c.id,'owner')).toThrow('cleared');expect(restored.chat.space('owner',true).conversation?.id).not.toBe(c.id)
})

it('protects settings/reset HTTP mutations with authentication and origin checks and rejects a Worker recipient',async()=>{
 const {h,root}=fixture(),host=await serve(h);servers.push(host.server)
 const headers={authorization:'Bearer '+readFileSync(join(root,'state/access-token'),'utf8').trim(),'content-type':'application/json'}
 expect((await fetch(host.url+'/api/chat/reset',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({operationId:randomUUID()})})).status).toBe(401)
 expect((await fetch(host.url+'/api/chat/reset',{method:'POST',headers:{...headers,origin:'https://wrong.example'},body:JSON.stringify({operationId:randomUUID()})})).status).toBe(403)
 const created=await (await fetch(host.url+'/api/chat/space',{method:'POST',headers,body:'{}'})).json() as any
 const same=await (await fetch(host.url+'/api/chat/space',{method:'POST',headers,body:'{}'})).json() as any
 expect(same.conversation.id).toBe(created.conversation.id)
 expect((await fetch(host.url+'/api/chat/conversations/'+same.conversation.id+'/messages',{method:'POST',headers,body:JSON.stringify({clientMessageId:randomUUID(),text:'Bypass Router',recipient:'research'})})).status).toBe(400)
 expect(h.chat.view(same.conversation.id,'local-operator').messages).toEqual([])
})

it('preserves external entry memory/history in the same scope, other accounts and unrelated running work',async()=>{
 const {h,root}=fixture(),chat=h.chat.space('owner',true).conversation!,other=h.chat.space('another-account',true).conversation!;enableChatBatch(h,chat.id)
 for(const nativeId of ['external-group','chat:'+other.id])h.scopes.command({action:'entry.bind',operationId:nativeId,expectedRevision:0,scopeId:'team',sourceId:'local',accountNamespace:'local',nativeId,history:'group'})
 const before=h.receive('local','operator',{id:'external-first',thread:'external-thread',scope:'external-group',addressed:true,text:'External context to keep'}) as {triggerId:string}
 const external=h.scopes.context(h.store.triggers.get(before.triggerId)!,'local:external-thread')!,e=h.memory.ingest(external)
 const fact=h.memory.command(external,{action:'remember',operationId:'external-memory',expectedRevision:0,subject:'External preference',content:'Keep external memory',sourceIds:[e.id],candidate:false},true) as any
 h.chat.send(other.id,'another-account',{clientMessageId:randomUUID(),text:'Another account stays intact'})
 send(h,chat.id,'Clear only this Chat')
 h.store.put('model-session','external-native',{threadId:'external-native',triggerId:before.triggerId,cwd:root})
 h.store.put('run','unrelated-merge',{ticketId:'unrelated-merge',phase:'merging',cwd:root})
 const reset=h.chat.reset('owner',randomUUID()),plan=h.memory.cleanup.plans().find(p=>p.id===reset.cleanupId)!
 expect(plan.triggers).not.toContain(before.triggerId);expect(plan.tickets).not.toContain('unrelated-merge');expect(plan.sessions.map(s=>s.threadId)).not.toContain('external-native')
 expect(h.memory.fact(fact.id)).toEqual(fact);expect(h.store.triggers.get(before.triggerId)?.text).toBe('External context to keep')
 expect(h.chat.view(other.id,'another-account').messages[0]?.text).toBe('Another account stays intact')
 const after=h.receive('local','operator',{id:'external-next',thread:'external-thread',scope:'external-group',addressed:true,text:'External entry continues'}) as {triggerId:string}
 expect(h.routerIngress.get(after.triggerId)?.state).toBe('accepted');expect(h.store.triggers.get(after.triggerId)?.text).toBe('External entry continues')
 const refreshed=h.scopes.context(h.store.triggers.get(after.triggerId)!,'local:external-thread')!
 expect(h.memory.query(refreshed,{}).items.map(f=>f.id)).toContain(fact.id)
 await h.memory.cleanup.process({run:async()=>{throw Error('unused')},purge:async id=>{expect(id).not.toBe('external-native');return {local:'verified',provider:'not_managed'}}},async()=>true)
 expect(h.store.get<any>('model-session','external-native')?.threadId).toBe('external-native')
})

it('pages a selected Worker dialogue independently of newer group traffic',()=>{
 const {h}=fixture(),c=h.chat.create('owner'),run=send(h,c.id)
 h.chat.delegated('older-assignment',run.runId,'task-old','research','Older Worker instruction')
 for(let i=0;i<110;i++)h.chat.reply('later-'+i,run.runId,'Newer group reply '+i)
 expect(h.chat.view(c.id,'owner').messages.some(m=>m.text==='Older Worker instruction')).toBe(false)
 expect(h.chat.view(c.id,'owner',undefined,'research').messages.map(m=>m.text)).toEqual(['Older Worker instruction'])
 expect(h.chat.view(c.id,'owner',2,'research').messages).toEqual([])
 expect(()=>h.chat.view(c.id,'another',undefined,'research')).toThrow('Conversation not found')
})

it('does not attribute a legacy sent Worker reply through a task owner changed after delivery',async()=>{
 const f=fixture(),old=f.h.chat.create('owner'),sent=send(f.h,old.id),trigger=f.h.store.triggers.get(sent.runId)!
 const task=await f.h.manager.call({action:'assign',revision:0,requestId:'legacy-attribution',id:'research',text:'Old work'},{trigger,discussion:'local:chat:'+old.id})
 f.h.store.outbox.send({id:'legacy-worker-reply',ticketId:task.ticketId,kind:'reply',channel:{source:'local',thread:'old',address:{routerInbox:'local:chat:'+old.id}},text:'Old private Worker output'})
 f.h.store.delivered('legacy-worker-reply')
 const current=f.h.chat.create('owner'),next=send(f.h,current.id,'Current chat')
 f.h.store.put('worker-assignment',task.ticketId,{...task,discussion:'local:chat:'+current.id,parentTrigger:next.runId})
 await f.h.close();hosts.splice(hosts.indexOf(f.h),1)
 const reopened=new Runtime(f.config,{model:f.model});hosts.push(reopened)
 expect(reopened.chat.view(current.id,'owner').messages.map(m=>m.text)).toEqual(['Current chat'])
})

it('omits cleared Chat from the memory settings catalog while keeping an independent entry readable',async()=>{
 const {h,root}=fixture(),chat=h.chat.space('local-operator',true).conversation!;enableChatBatch(h,chat.id)
 h.scopes.command({action:'entry.bind',operationId:'keep-external',expectedRevision:0,scopeId:'team',sourceId:'local',accountNamespace:'local',nativeId:'external',history:'group'})
 const external=h.receive('local','operator',{id:'external-readable',thread:'external',scope:'external',text:'Keep external context',addressed:true}) as {triggerId:string}
 const local=h.chat.send(chat.id,'local-operator',{clientMessageId:randomUUID(),text:'Clear this native context'})
 h.chat.reset('local-operator',randomUUID())
 const host=await serve(h);servers.push(host.server)
 const headers={authorization:'Bearer '+readFileSync(join(root,'state/access-token'),'utf8').trim(),'content-type':'application/json'}
 const catalog=await(await fetch(host.url+'/router-management/catalog',{headers})).json() as any
 expect(catalog.contexts.map((c:any)=>c.id)).toContain(external.triggerId);expect(catalog.contexts.map((c:any)=>c.id)).not.toContain(local.runId)
 for(const item of catalog.contexts)expect((await fetch(host.url+'/agent-memory',{method:'POST',headers,body:JSON.stringify({triggerId:item.id,command:{action:'inspect'}})})).status).toBe(200)
})
