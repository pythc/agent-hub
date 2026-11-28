import {afterEach,expect,it,vi} from 'vitest'
import {mkdtempSync,rmSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {randomUUID} from 'node:crypto'
import {Runtime} from '../src/runtime.ts'
import {configSchema} from '../src/config.ts'
import {serve} from '../src/server.ts'
import {RouterHandoff} from '../src/router-handoff.ts'
import type {ModelRequest} from '../src/model.ts'

const roots:string[]=[],hosts:Runtime[]=[]
afterEach(async()=>{for(const h of hosts.splice(0))await h.close();for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true})})
const gate=()=>{let release!:()=>void;const wait=new Promise<void>(r=>{release=r});return {wait,release}}
async function settle(h:Runtime,done:()=>boolean){for(let i=0;i<500;i++){await h.tick();await new Promise(r=>setTimeout(r,2));if(done())return}throw Error('Chat did not settle')}
function fixture(run:(r:ModelRequest)=>Promise<unknown>,scoped=false){
 const root=mkdtempSync(join(tmpdir(),'chat-duplex-'));roots.push(root)
 const config=configSchema.parse({stateDir:join(root,'state'),port:0,work:{sandboxDriver:'disabled'},execution:{router:{mode:'host'},management:{enabled:true},workers:[{id:'research',backend:'codex'}]},sources:[{id:'local',kind:'local',cwd:root,allowedActors:['operator']}]})
 const calls:ModelRequest[]=[],model={async run(r:ModelRequest){calls.push(r);const threadId=r.threadId??randomUUID(),turnId=randomUUID();r.onThread?.(threadId);r.onTurn?.(turnId);return {threadId,turnId,text:JSON.stringify(await run(r))}}}
 const h=new Runtime(config,{model});hosts.push(h)
 if(scoped)h.scopes.command({action:'scope.put',operationId:'external',expectedRevision:0,scope:{id:'external',tenantId:'external',name:'External',managers:[JSON.stringify(['local','operator'])],workerIds:['research'],backendIds:['codex'],sourceIds:['local']}})
 const c=h.chat.create('local-operator')
 const send=(text:string,clientMessageId=randomUUID())=>h.chat.send(c.id,'local-operator',{text,clientMessageId})
 const view=()=>h.chat.view(c.id,'local-operator')
 return {h,c,send,view,model,config,calls,root}
}

it.each([false,true])('accepts continuous input and serializes the Router without leaking future queued instructions (scoped=%s)',async scoped=>{
 const first=gate();let active=0,maximum=0
 const f=fixture(async r=>{active++;maximum=Math.max(maximum,active);const text=JSON.parse(r.input).trigger.text;if(text==='First request')await first.wait;active--;return {reply:'Reply to '+text}},scoped)
 f.send('First request');f.send('Second request')
 try{
  await settle(f.h,()=>f.calls.length===1)
  expect(f.calls[0]!.input).not.toContain('Second request')
  const activeReply=f.view().reply!
  expect(activeReply.state).toBe('running')
  f.send('Third request')
  for(let i=0;i<5;i++)await f.h.tick()
  expect(f.calls).toHaveLength(1);expect(f.view().messages.filter(m=>m.role==='user')).toHaveLength(3)
  expect(f.view().reply?.id).toBe(activeReply.id)
 }finally{first.release()}
 await settle(f.h,()=>!f.view().reply)
 expect(maximum).toBe(1)
 expect(f.calls[1]!.input).not.toContain('Third request')
 expect(f.calls.slice(1).map(r=>r.threadId)).toEqual([f.calls[1]!.threadId,f.calls[1]!.threadId])
 expect(f.calls[1]!.threadId).toBeTruthy()
 expect(f.view().messages.filter(m=>m.role==='assistant').map(m=>m.text)).toEqual(['Reply to First request','Reply to Second request','Reply to Third request'])
})

it('keeps its Worker running during further conversation and reports completion without another user prompt',async()=>{
 const first=gate(),work=gate(),later=gate();let worker:ModelRequest|undefined,laterStarted=false,active=0,maximum=0
 const f=fixture(async r=>{
  if(r.role==='worker'){worker=r;await work.wait;return {state:'ready',summary:'Verified',reply:'Background result',question:null,askedBy:null,handbacks:[]}}
  active++;maximum=Math.max(maximum,active)
  try{
   const input=JSON.parse(r.input)
   if(input.kind==='worker_result')return {reply:'The background task is complete.'}
   if(input.trigger.text==='Keep talking'){laterStarted=true;await later.wait;return {reply:'We can keep talking.'}}
   const result=await r.onTool!('worker_manage',{action:'assign',revision:0,requestId:'background',id:'research',text:'Check the repository'},'assign')
   expect(result.success).toBe(true)
   r.onOutput?.({id:'answer',type:'delta',phase:'answer',text:'{"reply":"Started'});
   await first.wait
   return {reply:'Started the background task.'}
  }finally{active--}
 },true)
 f.h.chat.send(f.c.id,'local-operator',{text:'Please fix the bug',clientMessageId:randomUUID(),locale:'en-GB',timeZone:'Asia/Kathmandu'})
 try{
  await settle(f.h,()=>!!worker&&f.view().messages.some(m=>m.status==='streaming'))
  expect(JSON.parse(worker!.input).runtimeContext).toMatchObject({role:'worker',channel:'chat',timeZone:'Asia/Kathmandu',timeZoneSource:'browser',locale:'en-GB'})
  f.send('Keep talking')
  expect(worker!.signal!.aborted).toBe(false)
  expect(f.h.store.list('router-cancelled')).toEqual([])
  first.release()
  await settle(f.h,()=>laterStarted)
  expect(f.view().workers[0]!.tasks[0]!.state).toBe('running')
  work.release()
  await settle(f.h,()=>f.h.store.list('chat-result-review').length===1)
  expect(f.h.store.tickets.list()[0]!.ended).toBeUndefined()
  expect(f.view().workers[0]!.tasks[0]).toMatchObject({state:'running',reviewing:true})
  expect(f.view().messages.some(m=>m.text==='The background task is complete.')).toBe(false)
 }finally{first.release();work.release();later.release()}
 await settle(f.h,()=>f.view().messages.some(m=>m.text==='The background task is complete.'))
 expect(maximum).toBe(1)
 expect(f.calls.filter(r=>r.role==='worker')).toHaveLength(1)
 expect(f.view().workers[0]!.tasks[0]!.state).toBe('completed')
 expect(f.view().messages.filter(m=>m.role==='user')).toHaveLength(2)
 expect(f.h.store.db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE state='failed'").get()!.n).toBe(0)
})

it('continues a partial result in the same ticket once and closes only after answering the original request',async()=>{
 let workers=0,reviews=0
 const f=fixture(async r=>{
  const data=JSON.parse(r.input)
  if(r.role==='worker'){
   workers++
   if(workers===2)expect(JSON.stringify(data.inputs)).toContain('Compare the saved and loaded preferences')
   return {state:'ready',summary:workers===1?'Reproduced':'The previous preference file is loaded',
    reply:workers===1?'The setting still resets.':'The app loads the old preference file.',question:null,handbacks:[]}
  }
  if(data.resultReview){
   reviews++
   expect(data.resultReview.originalRequest).toBe('Find why my preference resets')
   expect(f.h.store.tickets.list()[0]?.ended).toBeUndefined()
   return reviews===1?{decision:'continue',nextStep:'Compare the saved and loaded preferences',reply:''}:
    {decision:'answer',nextStep:'',reply:'The app loads the old preference file.'}
  }
  await r.onTool!('worker_manage',{action:'assign',id:'research',revision:0,requestId:'prefs',text:'Investigate the reset'},'assign')
  return {reply:'Checking.'}
 },true)
 f.send('Find why my preference resets')
 await settle(f.h,()=>f.view().messages.some(m=>m.text==='The app loads the old preference file.'&&m.speaker?.kind==='router'))
 const [ticket]=f.h.store.tickets.list()
 expect(ticket!.ended?.outcome).toBe('completed')
 expect(f.h.store.tickets.list()).toHaveLength(1)
 expect(ticket!.inputs.filter(i=>i.kind==='note'&&i.text==='Compare the saved and loaded preferences')).toHaveLength(1)
 for(const r of f.h.store.list<{id:string}>('chat-result-review'))f.h.store.jobState('router:result:'+r.id,'pending')
 await f.h.tick()
 expect(workers).toBe(2);expect(reviews).toBe(2)
 expect(f.view().messages.filter(m=>m.role==='user')).toHaveLength(1)
})

it('retries an interrupted read-only review without repeating the Worker or its continuation',async()=>{
 let workers=0,reviews=0
 const f=fixture(async r=>{
  if(r.role==='worker')return {state:'ready',summary:++workers===1?'Observed':'Verified',reply:'Recorded observation',question:null,handbacks:[]}
  if(JSON.parse(r.input).resultReview){
   if(++reviews===1)throw Error('Transient connection loss')
   return reviews===2?{decision:'continue',nextStep:'Read the original log',reply:''}:
    {decision:'answer',nextStep:'',reply:'Original log verified.'}
  }
  await r.onTool!('worker_manage',{action:'assign',id:'research',revision:0,requestId:'log',text:'Investigate'},'assign')
  return {reply:'Checking.'}
 },true)
 f.send('Explain the unexpected result')
 await settle(f.h,()=>f.view().messages.some(m=>m.text==='Original log verified.'))
 const [ticket]=f.h.store.tickets.list()
 expect(ticket!.ended?.outcome).toBe('completed')
 expect(ticket!.inputs.filter(i=>i.kind==='note'&&i.text==='Read the original log')).toHaveLength(1)
 expect([workers,reviews]).toEqual([2,3])
})

it('respects a human stop while the Router is deciding whether to continue',async()=>{
 const pending=gate();let reviewing=false,workers=0
 const f=fixture(async r=>{
  if(r.role==='worker'){workers++;return {state:'ready',summary:'Observed',reply:'Partial result',question:null,handbacks:[]}}
  if(JSON.parse(r.input).resultReview){reviewing=true;await pending.wait;return {decision:'continue',nextStep:'Check another log',reply:''}}
  await r.onTool!('worker_manage',{action:'assign',id:'research',revision:0,requestId:'log',text:'Investigate'},'assign')
  return {reply:'Checking.'}
 },true)
 f.send('Check the log')
 try{
  await settle(f.h,()=>reviewing)
  f.h.engine.stopTicket(f.h.store.tickets.list()[0]!.id,'Human stop')
 }finally{pending.release()}
 const review=f.h.store.list<{id:string}>('chat-result-review')[0]!
 await settle(f.h,()=>['done','failed'].includes(String(f.h.store.db.prepare('SELECT state FROM jobs WHERE id=?').get('router:result:'+review.id)?.state)))
 expect(workers).toBe(1)
 const [ticket]=f.h.store.tickets.list()
 expect(ticket!.ended).toBeDefined()
 expect(ticket!.inputs.some(i=>i.kind==='note'&&i.text==='Check another log')).toBe(false)
})

it('lets the same Worker switch evidence when a proposed manual step has an authorized alternative',async()=>{
 let workers=0,reviews=0
 const f=fixture(async r=>{
  if(r.role==='worker'){
   workers++
   if(workers===2)return {state:'blocked',summary:'Panel unavailable',reply:'The panel did not open.',question:'Can you open the panel?',handbacks:[]}
   return {state:'ready',summary:workers===1?'Observed':'Verified the setting',reply:'Read the local setting.',question:null,handbacks:[]}
  }
  const input=JSON.parse(r.input)
  if(input.resultReview){
   reviews++
   if(reviews===1)return {decision:'continue',nextStep:'Inspect the panel.',reply:''}
   if(reviews===2){
    expect(input.resultReview).toMatchObject({previousChecks:['Inspect the panel.'],proposedQuestion:'Can you open the panel?'})
    expect(f.h.store.tickets.list()[0]!.attention).toBeUndefined()
    return {decision:'continue',nextStep:'Read the setting from its original file.',reply:''}
   }
   return {decision:'answer',nextStep:'',reply:'The verified setting explains it.'}
  }
  await r.onTool!('worker_manage',{action:'assign',id:'research',revision:0,requestId:'panel',text:'Investigate the setting'},'assign')
  return {reply:'Checking.'}
 },true)
 f.send('Explain the setting')
 await settle(f.h,()=>f.view().messages.some(m=>m.text==='The verified setting explains it.'))
 expect([workers,reviews]).toEqual([3,3])
 expect(f.view().messages.some(m=>m.text==='Can you open the panel?')).toBe(false)
 expect(f.h.store.tickets.list()).toHaveLength(1)
})

it('records a genuine user decision on the same open ticket',async()=>{
 const question='Which of your two profiles should be updated?'
 const f=fixture(async r=>{
  if(r.role==='worker')return {state:'ready',summary:'Two profiles',reply:'Both profiles exist.',question:null,handbacks:[]}
  const input=JSON.parse(r.input)
  if(input.resultReview)return {decision:'ask_user',nextStep:'',reply:question}
  await r.onTool!('worker_manage',{action:'assign',id:'research',revision:0,requestId:'profiles',text:'Inspect the profiles'},'assign')
  return {reply:'Checking.'}
 },true)
 f.send('Update my profile')
 await settle(f.h,()=>f.h.store.tickets.list().some(t=>t.attention?.question===question))
 expect(f.h.store.tickets.list()[0]!.ended).toBeUndefined()
 expect(f.calls.filter(r=>r.role==='worker')).toHaveLength(1)
})

it('ends a stalled Router reply after a confirmed assignment and answers the next message while the Worker runs',async()=>{
 const work=gate(),router=gate()
 let assigned=false,worker:ModelRequest|undefined
 const f=fixture(async request=>{
  if(request.role==='worker'){
   worker=request
   await work.wait
   return {state:'ready',summary:'Verified',reply:'Investigation complete',question:null,askedBy:null,handbacks:[]}
  }
  const input=JSON.parse(request.input)
  if(input.kind==='worker_result')return {reply:'排查完成。'}
  const call=(name:string,args:unknown)=>request.onTool!(name,args,randomUUID())
  if(input.trigger.text==='你有在看吗'){
   const receipt=await call('worker_manage',{action:'list'})
   expect(JSON.parse(receipt.contentItems[0]!.text!).workers[0].status).toBe('running')
   return {reply:'在，Worker 正在查。'}
  }
  const receipt=await call('worker_manage',{action:'assign',revision:0,requestId:'long-research',id:'research',text:'Investigate the issue'})
  expect(JSON.parse(receipt.contentItems[0]!.text!)).toMatchObject({ticketId:expect.any(String),status:'queued'})
  assigned=true
  const signal=request.signal!
  const stopped=new Promise<void>(resolve=>signal.addEventListener('abort',()=>resolve(),{once:true}))
  await Promise.race([stopped,router.wait])
  signal.throwIfAborted()
  return {reply:'Late reply'}
 },true)
 const first=f.send('查一下这个问题')
 try{
  await settle(f.h,()=>assigned&&!!worker)
  f.send('你有在看吗')
  await settle(f.h,()=>f.view().messages.some(message=>message.text==='在，Worker 正在查。'))
  expect(f.view().messages.filter(message=>!message.recipient).map(message=>message.text)).toEqual([
   '查一下这个问题','你有在看吗','已交给 research 处理。','在，Worker 正在查。',
  ])
  expect(f.h.store.get('router-result','router:'+first.runId)).toMatchObject({reply:'已交给 research 处理。'})
  expect(f.calls[0]!.signal!.aborted).toBe(true)
  const followup=f.calls.find(request=>request.role==='router'&&JSON.parse(request.input).trigger?.text==='你有在看吗')!
  expect(followup.threadId).toBeUndefined()
  expect(JSON.parse(followup.input).continuity.history.map((event:{text:string})=>event.text)).toContain('已交给 research 处理。')
  expect(worker!.signal!.aborted).toBe(false)
  expect(f.view().workers[0]!.tasks.map(task=>task.state)).toEqual(['running'])
 }finally{router.release();work.release()}
 await settle(f.h,()=>f.view().messages.some(message=>message.text==='排查完成。'))
 expect(f.calls.filter(request=>request.role==='worker')).toHaveLength(1)
})

it('delivers progress questions to the Router while a dispatched plan runs',async()=>{
 const work=gate(),stalled=gate()
 const requestText='Continuously investigate the build failure'
 let worker:ModelRequest|undefined
 const f=fixture(async r=>{
  if(r.role==='worker'){
   worker=r
   await work.wait
   return {state:'waiting',summary:'Build investigated',reply:'',question:null,askedBy:null,handbacks:[]}
  }
  const input=JSON.parse(r.input)
  if(input.trigger.text==='Any progress?'){
   expect(input.tasks).toEqual([expect.objectContaining({workerId:'research'})])
   return {reply:'The model checked the investigation.'}
  }
  if(input.trigger.text!==requestText)return {reply:'I can answer while the investigation runs.'}
  const result=await r.onTool!('router_goal',{action:'start',operationId:'build-plan',expectedRevision:0,
   title:'Build investigation',objective:'Find the cause of the build failure',authorizationQuote:requestText,
   criteria:[{id:'cause',description:'Explain the cause of the failure'}],
   nodes:[{id:'investigate',title:'Investigate',instruction:'Inspect the failed build',workerId:'research',criterionIds:['cause']}]},'plan')
  expect(JSON.parse(result.contentItems[0]!.text!)).toMatchObject({state:'active'})
  await Promise.race([stalled.wait,new Promise<void>(resolve=>r.signal!.addEventListener('abort',()=>resolve(),{once:true}))])
  r.signal!.throwIfAborted()
  return {reply:'A late reply'}
 },true)
 const first=f.send(requestText)
 try{
  await settle(f.h,()=>!!worker)
  const status=f.h.chat.send(f.c.id,'local-operator',{text:'Any progress?',clientMessageId:randomUUID(),locale:'zh-CN'})
  expect(f.h.store.get('router-dispatch','router:'+first.runId)).toMatchObject({items:[{kind:'plan',label:'Build investigation'}]})
  f.send('Are you still there?')
  await settle(f.h,()=>f.view().messages.some(m=>m.text==='I can answer while the investigation runs.'))
  expect(f.view().messages.find(m=>m.runId===status.runId&&m.role==='assistant')?.text).toBe('The model checked the investigation.')
  expect(f.view().messages.some(m=>m.text==='I queued “Build investigation” for execution.')).toBe(true)
  expect(worker!.signal!.aborted).toBe(false)
  expect(f.view().workers[0]!.tasks.map(t=>t.state)).toEqual(['running'])
 }finally{stalled.release();work.release()}
 expect(f.h.store.tickets.list()).toHaveLength(1)
 expect(f.calls.filter(r=>r.role==='worker')).toHaveLength(1)
})

it('rejects direct execution and confirms an accepted assignment after the Router provider fails',async()=>{
 let started=0
 const work=gate()
 const forbidden=['github_read','github_write','github_git','workspace_browser','chat_deliver_file','code_mode','superagent_shell']
 const f=fixture(async r=>{
  if(r.role==='worker'){
   started++
   await work.wait
   return {state:'ready',summary:'Verified',reply:'Done',question:null,askedBy:null,handbacks:[]}
  }
  if(JSON.parse(r.input).kind==='worker_result')return {reply:'Verified.'}
  expect(r.tools?.filter(t=>forbidden.includes(t.name))).toEqual([])
  expect(r.allowNativeTools).toBe(false)
  expect(r.options?.toolConnections).toEqual([])
  for(const name of forbidden){
   const denied=await r.onTool!(name,{},'direct-'+name)
   expect(denied.success).toBe(false)
   expect(JSON.parse(denied.contentItems[0]!.text!).code).toBe('worker_required')
  }
  const receipt=await r.onTool!('worker_manage',{action:'assign',id:'research',revision:0,requestId:'assignment',text:'Inspect the build log'},'assign')
  expect(receipt.success).toBe(true)
  throw Error('Provider closed after receiving the assignment')
 },true)
 const first=f.send('Inspect the build log')
 try{
  await settle(f.h,()=>started===1&&f.view().messages.some(m=>m.text==='I assigned this to research.'))
  expect(f.h.store.get('router-dispatch','router:'+first.runId)).toMatchObject({items:[{kind:'assign',label:'research'}]})
  expect(f.h.store.tickets.list()).toHaveLength(1)
 }finally{work.release()}
 await settle(f.h,()=>f.view().messages.some(m=>m.text==='Verified.'))
 expect(started).toBe(1)
})

it('finishes the active tool receipt before retiring the Router writer',async()=>{
 vi.useFakeTimers()
 const parent=new AbortController(),handoff=new RouterHandoff(parent.signal,false),effect=gate()
 const receipt={success:true,contentItems:[]}
 const admitted=handoff.tool(async()=>{await effect.wait;return receipt})
 handoff.record('Research',false)
 try{
  await vi.advanceTimersByTimeAsync(6000)
  expect(handoff.signal.aborted).toBe(false)
  const next=vi.fn(async()=>receipt)
  expect((await handoff.tool(next)).success).toBe(false)
  expect(next).not.toHaveBeenCalled()
  effect.release()
  expect(await admitted).toEqual(receipt)
  await vi.runAllTimersAsync()
  expect(handoff.yielded).toBe(true)
  expect(parent.signal.aborted).toBe(false)
  expect(handoff.reply()).toBe('Your follow-up was received.')
 }finally{effect.release();handoff.dispose();vi.useRealTimers()}
})

it('accepts consecutive HTTP messages while preserving authentication and conversation ownership',async()=>{
 const f=fixture(async r=>({reply:'Reply to '+JSON.parse(r.input).trigger.text})),server=await serve(f.h)
 try{
  const headers={authorization:'Bearer '+readFileSync(join(f.root,'state/access-token'),'utf8').trim(),'content-type':'application/json'}
  const path=server.url+'/api/chat/conversations/'+f.c.id+'/messages'
  const body=JSON.stringify({text:'First request',clientMessageId:randomUUID(),timeZone:'America/New_York'})
  expect((await fetch(path,{method:'POST',body})).status).toBe(401)
  expect((await fetch(path,{method:'POST',headers:{...headers,origin:'https://other.example'},body})).status).toBe(403)
  const other=f.h.chat.create('another-owner')
  expect((await fetch(server.url+'/api/chat/conversations/'+other.id+'/messages',{method:'POST',headers,body})).status).toBe(404)
  expect((await fetch(path,{method:'POST',headers,body})).status).toBe(202)
  const second=await fetch(path,{method:'POST',headers,body:JSON.stringify({text:'Second request',clientMessageId:randomUUID(),timeZone:'Mars/Olympus'})})
  expect(second.status).toBe(202)
  const {runId}=await second.json() as {runId:string}
  expect(f.h.chat.clientContext(runId)?.clientTimeZone).toBeUndefined()
  expect(f.view().messages.filter(m=>m.role==='user')).toHaveLength(2)
 }finally{await server.closeRuntime();hosts.splice(hosts.indexOf(f.h),1);server.server.closeAllConnections();await new Promise<void>(resolve=>server.server.close(()=>resolve()))}
})

it('recovers queued messages after restart without duplicate admission or overlapping Router turns',async()=>{
 const f=fixture(async r=>({reply:'Reply to '+JSON.parse(r.input).trigger.text})),messageId=randomUUID()
 const sent=f.h.chat.send(f.c.id,'local-operator',{text:'First request',clientMessageId:messageId,timeZone:'Pacific/Auckland',locale:'en-GB'});f.send('Second request')
 await f.h.close();hosts.splice(hosts.indexOf(f.h),1)
 let now=Date.parse('2026-01-01T10:59:59Z')
 const h=new Runtime(f.config,{model:f.model,clock:()=>{const at=now;now+=2000;return at}});hosts.push(h)
 expect(h.chat.send(f.c.id,'local-operator',{text:'First request',clientMessageId:messageId})).toEqual({runId:sent.runId,duplicate:true})
 await settle(h,()=>!h.chat.view(f.c.id,'local-operator').reply)
 expect(f.calls).toHaveLength(2)
 const first=JSON.parse(f.calls[0]!.input).runtimeContext,second=JSON.parse(f.calls[1]!.input).runtimeContext
 expect(first).toMatchObject({role:'router',localTime:expect.stringContaining('+13:00'),timeZone:'Pacific/Auckland',timeZoneSource:'browser',channel:'chat',locale:'en-GB',eventAt:h.store.triggers.get(sent.runId)!.at})
 expect(second).toMatchObject({timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone,timeZoneSource:'host'})
 expect(Date.parse(second.localTime)).toBeGreaterThan(Date.parse(first.localTime))
 expect(h.chat.view(f.c.id,'local-operator').messages.map(m=>m.text)).toEqual(['First request','Second request','Reply to First request','Reply to Second request'])
})

it('reads retained Router results within the same conversation, including a later turn, and rejects other readers',async()=>{
 let resource='',original=''
 const f=fixture(async r=>{
  if(!resource){
   const result=await r.onTool!('worker_manage',{action:'list'},'catalog')
   original=JSON.stringify(result);resource='model-tool-receipt/'+await r.retainToolResult!('catalog',result)
  }
  const page=await r.onTool!('router_read',{resource,limit:8000},'read')
  expect(page.success).toBe(true);expect(JSON.parse(page.contentItems[0]!.text!).text).toBe(original)
  return {reply:'Read the catalog'}
 },true)
 const first=f.send('List the team');await settle(f.h,()=>!f.view().reply)
 const second=f.send('Read the earlier result');await settle(f.h,()=>!f.view().reply)
 const other=f.h.chat.create('different-owner'),foreign=f.h.chat.send(other.id,'different-owner',{text:'Read something',clientMessageId:randomUUID()})
 await expect(f.h.resources.read({resource},{routerTriggerId:foreign.runId})).rejects.toThrow()
 await expect(f.h.resources.read({resource:'settings'},{routerTriggerId:second.runId})).rejects.toThrow('uploaded file')
 f.h.store.put('model-tool-receipt','worker-only',{triggerId:first.runId,ticketId:'task',result:{success:true,contentItems:[]}})
 await expect(f.h.resources.read({resource:'model-tool-receipt/worker-only'},{routerTriggerId:first.runId})).rejects.toThrow('outside')
 await f.h.chat.cancel(f.c.id,'local-operator',first.runId)
 await expect(f.h.resources.read({resource},{routerTriggerId:second.runId})).rejects.toThrow()
})

it('projects background tasks using their current discussion instead of their original assignment',async()=>{
 const f=fixture(async()=>({reply:'OK'})),initial=f.send('Start work'),trigger=f.h.store.triggers.get(initial.runId)!,discussion='local:chat:'+f.c.id
 const task=await f.h.manager.call({action:'assign',id:'research',revision:0,requestId:'move',text:'Move this task'}, {trigger,discussion})
 expect(f.view().workers[0]!.tasks).toHaveLength(1)
 const other=f.h.chat.create('other-owner'),next=f.h.chat.send(other.id,'other-owner',{clientMessageId:randomUUID(),text:'Continue work'})
 f.h.store.put('task-routing',task.ticketId,{discussion:'local:chat:'+other.id,parentTrigger:next.runId})
 expect(f.view().workers[0]!.tasks).toEqual([])
 expect(f.h.chat.view(other.id,'other-owner').workers[0]!.tasks).toMatchObject([{id:task.ticketId}])
})

it('uses the Chat zone for a new daily schedule and replays the same occurrence settings after edits',()=>{
 const f=fixture(async()=>({reply:''}),true)
 const sent=f.h.chat.send(f.c.id,'local-operator',{text:'Remind me every morning at nine.',clientMessageId:randomUUID(),locale:'en-GB',timeZone:'Pacific/Auckland'})
 const trigger=f.h.store.triggers.get(sent.runId)!,context=f.h.scopes.context(trigger,f.h.routerIngress.get(trigger.id)!.discussion)!
 const command={action:'schedule.put',operationId:'morning',expectedRevision:0,scopeId:context.route.scopeId,
   schedule:{id:'morning',name:'Daily reminder',triggerId:trigger.id,prompt:'Good morning',mode:'standalone',timing:{kind:'daily',time:'09:00',startAt:'2099-01-01T00:00:00Z'}}}
 const create=(input:unknown)=>f.h.proactive.command(input,context)
 const saved=create(command)
 expect(saved).toMatchObject({timing:{timezone:'Pacific/Auckland'}})
 const change={...command,schedule:{...command.schedule,timing:{...command.schedule.timing,timezone:'Asia/Shanghai'}}}
 expect(()=>create(change)).toThrow('operationId reused')
 expect(create({...change,operationId:'change-zone',expectedRevision:1})).toMatchObject({timing:{timezone:'Asia/Shanghai'}})
 expect(create(command)).toEqual(saved)
})
it.each([false,true])('answers a private follow-up while a Router tool is in flight and keeps the original stop target (scoped=%s)',async scoped=>{
 const started=gate(),release=gate()
 let originalReads=0
 const f=fixture(async r=>{
  const input=JSON.parse(r.input)
  if(input.kind==='chat_interjection'){
   expect(r.ephemeral).toBe(true);expect(r.threadId).toBeUndefined()
   expect(r.onTool).toBeUndefined();expect(r.tools).toEqual([]);expect(r.options?.toolConnections).toEqual([])
   expect(input.steps).toContainEqual(expect.objectContaining({actor:'router',state:'running'}))
   return {action:'answer',reply:'I am reading the current team status.'}
  }
  if(input.trigger?.text==='Repeat the status you gave me.'){
   expect(r.input).toContain('I am reading the current team status.')
   return {reply:'I said I was reading the team status.'}
  }
  expect((await r.onTool!('worker_manage',{action:'list'},'first')).success).toBe(true)
  expect((await r.onTool!('worker_manage',{action:'list'},'second')).success).toBe(true)
  return {reply:'Both checks complete.'}
 },scoped)
 const call=f.h.manager.call.bind(f.h.manager)
 vi.spyOn(f.h.manager,'call').mockImplementation(async(...args)=>{
  if(++originalReads===1){started.release();await release.wait}
  return call(...args)
 })
 const primary=f.send('Check team status twice.')
 await f.h.tick();await started.wait
 try{
  const a=f.send('Who is doing the current check?')
  const key=randomUUID(),b=f.send('What is happening now?',key)
  await settle(f.h,()=>f.view().messages.some(m=>m.runId===b.runId&&m.text==='I am reading the current team status.'))
  expect(f.h.store.get('chat-message','reply:router:'+a.runId)).toMatchObject({text:'I am doing this step myself.'})
  expect(f.send('What is happening now?',key)).toEqual({runId:b.runId,duplicate:true})
  expect(f.view().run).toMatchObject({id:primary.runId,state:'running'})
  expect(f.view().reply?.runId).toBe(primary.runId)
  expect(f.calls).toHaveLength(2);expect(originalReads).toBe(1)
  expect(f.h.store.list<any>('model-usage').find(row=>row.triggerId===b.runId)).toMatchObject({budgetTriggerId:primary.runId})
 }finally{release.release()}
 await settle(f.h,()=>!f.view().reply)
 expect(originalReads).toBe(2);expect(f.h.store.tickets.list()).toHaveLength(0)
 expect(f.view().messages.filter(m=>m.role==='assistant').map(m=>m.text)).toEqual([
  'I am doing this step myself.','I am reading the current team status.','Both checks complete.'])
 if(!scoped){
  f.send('Repeat the status you gave me.')
  await settle(f.h,()=>f.view().messages.some(m=>m.text==='I said I was reading the team status.'))
 }
})

it('fences a proposed assignment until a mixed follow-up is read, then continues the same writer in order',async()=>{
 const firstRead=gate(),release=gate(),classifying=gate(),judge=gate()
 let denied=false,corrected=0
 const f=fixture(async r=>{
  const input=JSON.parse(r.input)
  if(input.kind==='chat_interjection'){
   classifying.release();await judge.wait
   return {action:'update',reply:'我在查，接下来只看 B。'}
  }
  if(input.kind==='chat_task_update'){
   corrected++;expect(input.messages.map((m:any)=>m.text)).toEqual(['谁在查？先别派工，只看 B。'])
   expect(r.threadId).toBe(firstThread)
   expect((await r.onTool!('worker_manage',{action:'list'},'check-b')).success).toBe(true)
   return {reply:'B 已核对。'}
  }
  if(r.role==='worker')throw Error('Obsolete assignment executed')
  await r.onTool!('worker_manage',{action:'list'},'check-a')
  const old=await r.onTool!('worker_manage',{action:'assign',id:'research',revision:0,requestId:'old',text:'Old action'},'old')
  denied=!old.success
  return {reply:'旧方案已派工。'}
 },true)
 let firstThread:string
 const impl=f.h.manager.call.bind(f.h.manager)
 const manager=vi.spyOn(f.h.manager,'call').mockImplementation(async(...args)=>{
  if(!firstThread){firstThread=f.h.store.list<any>('model-session').find(row=>!row.ephemeral)!.threadId;firstRead.release();await release.wait}
  return impl(...args)
 })
 const main=f.send('查 A 后安排检查。')
 await f.h.tick();await firstRead.wait
 const change=f.send('谁在查？先别派工，只看 B。')
 try{
  await classifying.wait;release.release()
  for(let i=0;i<4;i++)await f.h.tick()
  expect(manager).toHaveBeenCalledTimes(1)
  judge.release()
  await settle(f.h,()=>!f.view().reply)
 }finally{release.release();judge.release()}
 expect(denied).toBe(true);expect(corrected).toBe(1)
 expect(f.h.store.tickets.list()).toEqual([])
 expect(f.view().messages.filter(m=>m.role==='assistant').map(m=>[m.runId,m.text])).toEqual([[change.runId,'我在查，接下来只看 B。'],[main.runId,'B 已核对。']])
 expect(f.h.store.get('chat-run',change.runId)).toMatchObject({interjection:{parentId:main.runId,state:'applied'}})
 expect(manager).toHaveBeenCalledTimes(2)
})

it('applies explicit steering to the active writer without a classification turn',async()=>{
 const entered=gate(),release=gate();let corrected=false
 const f=fixture(async r=>{
  const input=JSON.parse(r.input)
  expect(input.kind).not.toBe('chat_interjection')
  if(input.kind==='chat_task_update'){
   expect(input.messages.map((m:any)=>m.text)).toEqual(['Focus on B instead.']);corrected=true;return {reply:'Checked B.'}
  }
  await r.onTool!('worker_manage',{action:'list'},'first-read')
  return {reply:'Original result'}
 },true)
 const call=f.h.manager.call.bind(f.h.manager)
 vi.spyOn(f.h.manager,'call').mockImplementation(async(...args)=>{entered.release();await release.wait;return call(...args)})
 const parent=f.send('Check A.');await f.h.tick();await entered.wait
 try{
  const result=f.h.chat.send(f.c.id,'local-operator',{clientMessageId:randomUUID(),text:'Focus on B instead.',steer:true})
  expect(result).toMatchObject({delivery:'steered'})
  expect(f.h.store.get('chat-run',result.runId)).toMatchObject({interjection:{parentId:parent.runId,state:'update'}})
 }finally{release.release()}
 await settle(f.h,()=>!f.view().reply);expect(corrected).toBe(true)
 expect(f.view().messages.some(message=>message.text==='Checked B.')).toBe(true)
})

it('honors an explicit stop during a Router read without accepting its next action',async()=>{
 const firstRead=gate(),release=gate()
 const f=fixture(async r=>{
  await r.onTool!('worker_manage',{action:'list'},'check')
  await r.onTool!('worker_manage',{action:'assign',id:'research',revision:0,requestId:'old',text:'Old action'},'old')
  return {reply:'Obsolete completion'}
 },true)
 const impl=f.h.manager.call.bind(f.h.manager)
 const manager=vi.spyOn(f.h.manager,'call').mockImplementation(async(...args)=>{firstRead.release();await release.wait;return impl(...args)})
 const primary=f.send('Check status')
 await f.h.tick();await firstRead.wait
 let stop:{runId:string}
 try{
  stop=f.send('停止当前任务')
  await settle(f.h,()=>f.view().messages.some(m=>m.runId===stop!.runId&&m.role==='assistant'))
  expect(f.view().messages.some(m=>m.text==='Obsolete completion')).toBe(false)
 }finally{release.release()}
 await settle(f.h,()=>!f.view().reply)
 expect(manager).toHaveBeenCalledTimes(1)
 expect(f.h.store.get('chat-run',primary.runId)).toMatchObject({cancelRequested:true,cancelled:true})
 expect(f.view().run).toMatchObject({id:primary.runId,state:'cancelled'})
 expect(f.h.store.tickets.list()).toEqual([])
 expect(f.calls).toHaveLength(1)
})

it.each(['pending','update'])('recovers a correction after a crash at %s without dispatching the old action or sending a second acknowledgement',async phase=>{
 const reading=gate(),release=gate(),classifying=gate(),judge=gate()
 const revised='Skip the assignment and check B.'
 let restored=false,replayed=0
 const f=fixture(async r=>{
  const data=JSON.parse(r.input)
  if(data.kind==='chat_interjection'){
   classifying.release();await judge.wait
   return {action:'update',reply:'I will check B.'}
  }
  const revision=data.kind==='chat_task_update'?data:data.taskUpdate
  if(revision){
   expect(revision.messages.map((m:{text:string})=>m.text)).toEqual([revised])
   if(restored)replayed++
   return {reply:'Checked B.'}
  }
  if(restored)throw Error('The recovered writer overlooked the accepted input')
  await r.onTool!('worker_manage',{action:'list'},'first-read')
  await r.onTool!('worker_manage',{action:'assign',id:'research',revision:0,requestId:'obsolete',text:'Obsolete'},'obsolete')
  return {reply:'Obsolete'}
 },true)
 const impl=f.h.manager.call.bind(f.h.manager)
 vi.spyOn(f.h.manager,'call').mockImplementation(async(...args)=>{reading.release();await release.wait;return impl(...args)})
 const original=f.send('Read, then assign.'),clientId=randomUUID()
 await f.h.tick();await reading.wait
 const update=f.send(revised,clientId)
 const stateDir=mkdtempSync(join(f.root,'snapshot-'))
 try{
  await classifying.wait
  if(phase==='update'){judge.release();await settle(f.h,()=>!!f.h.store.get('chat-message','reply:interjection:'+update.runId))}
  expect(f.h.store.get('chat-run',update.runId)).toMatchObject({interjection:{state:phase}})
  f.h.store.db.prepare('VACUUM INTO ?').run(join(stateDir,'state.sqlite'))
 }finally{judge.release();release.release()}
 await settle(f.h,()=>!f.view().reply)
 await f.h.close();hosts.splice(hosts.indexOf(f.h),1);restored=true
 // Disabling the feature for new inputs must not orphan an already accepted message.
 const h=new Runtime({...f.config,stateDir,execution:{...f.config.execution,chatInterjections:false}},{model:f.model});hosts.push(h)
 expect(h.chat.send(f.c.id,'local-operator',{text:revised,clientMessageId:clientId})).toEqual({runId:update.runId,duplicate:true})
 await settle(h,()=>!h.chat.view(f.c.id,'local-operator').reply)
 const messages=h.chat.view(f.c.id,'local-operator').messages.filter(m=>m.role==='assistant')
 expect(messages.map(m=>[m.runId,m.text])).toEqual([[update.runId,'I will check B.'],[original.runId,'Checked B.']])
 expect(replayed).toBe(1);expect(h.store.tickets.list()).toEqual([])
 expect(h.store.get('chat-run',update.runId)).toMatchObject({interjection:{parentId:original.runId,state:'applied'}})
})

it('withdraws an in-flight short answer when its Chat permission changes',async()=>{
 const reading=gate(),release=gate(),classifying=gate(),judge=gate()
 const f=fixture(async r=>{
  const input=JSON.parse(r.input)
  if(input.kind==='chat_interjection'){
   classifying.release();await judge.wait;return {action:'answer',reply:'Stale observation'}
  }
  if(input.trigger?.text==='What can you see?')return {reply:'Answered under the current permission.'}
  await r.onTool!('worker_manage',{action:'list'},'read');return {reply:'Original complete.'}
 },true)
 const impl=f.h.manager.call.bind(f.h.manager)
 vi.spyOn(f.h.manager,'call').mockImplementation(async(...args)=>{reading.release();await release.wait;return impl(...args)})
 f.send('Inspect the team.');await f.h.tick();await reading.wait
 const input=f.send('What can you see?')
 try{await classifying.wait;f.h.chat.setApprovalMode('local-operator','full')}
 finally{judge.release();release.release()}
 await settle(f.h,()=>!f.view().reply)
 expect(f.view().messages.map(m=>m.text)).not.toContain('Stale observation')
 expect(f.h.store.get('chat-message','reply:router:'+input.runId)).toMatchObject({text:'Answered under the current permission.'})
})

it('finishes a natural-language stop even if its acknowledgement is cancelled, and drops earlier queued changes',async()=>{
 const reading=gate(),release=gate()
 const f=fixture(async r=>{
  const input=JSON.parse(r.input)
  if(input.kind==='chat_interjection')return input.question.includes('call off')?{action:'stop',reply:''}:{action:'update',reply:'I will check B.'}
  await r.onTool!('worker_manage',{action:'list'},'first')
  await r.onTool!('worker_manage',{action:'assign',id:'research',revision:0,requestId:'obsolete',text:'Obsolete'},'obsolete')
  return {reply:'Obsolete'}
 })
 const impl=f.h.manager.call.bind(f.h.manager)
 vi.spyOn(f.h.manager,'call').mockImplementation(async(...args)=>{reading.release();await release.wait;return impl(...args)})
 const main=f.send('Check the team.');await f.h.tick();await reading.wait
 const change=f.send('Only check B.')
 try{
  await settle(f.h,()=>!!f.h.store.get('chat-message','reply:interjection:'+change.runId))
  const stop=f.send('Please call off this entire task.')
  await settle(f.h,()=>!!f.h.store.get('chat-message','reply:router:'+stop.runId))
  const cancelling=f.h.chat.cancel(f.c.id,'local-operator',stop.runId)
  release.release();await cancelling
 }finally{release.release()}
 await settle(f.h,()=>!f.view().reply)
 expect(f.h.store.get('chat-run',main.runId)).toMatchObject({cancelled:true})
 expect(f.h.store.get('chat-run',change.runId)).toMatchObject({cancelled:true})
 expect(f.view().messages.some(m=>m.text==='Obsolete')).toBe(false);expect(f.h.store.tickets.list()).toEqual([])
})

it('queues an independent new job and respects the feature switch on the normal Chat entry point',async()=>{
 for(const enabled of [true,false]){
  const reading=gate(),release=gate()
  const f=fixture(async r=>{
   const input=JSON.parse(r.input)
   if(input.kind==='chat_interjection')return {action:'queue',reply:''}
   if(input.trigger.text==='Independent new job')return {reply:'New job complete'}
   await r.onTool!('worker_manage',{action:'list'},'held');return {reply:'Initial job complete'}
  })
  f.h.config.execution.chatInterjections=enabled
  const impl=f.h.manager.call.bind(f.h.manager)
  vi.spyOn(f.h.manager,'call').mockImplementation(async(...args)=>{reading.release();await release.wait;return impl(...args)})
  f.send('Check the team.');await f.h.tick();await reading.wait
  const next=f.send('Independent new job')
  try{
   if(enabled)await settle(f.h,()=>f.h.store.get<any>('chat-run',next.runId)?.interjection?.state==='queued')
   else expect(f.h.store.get<any>('chat-run',next.runId)?.interjection).toBeUndefined()
   expect(f.h.store.get('router-result','router:'+next.runId)).toBeUndefined()
  }finally{release.release()}
  await settle(f.h,()=>!f.view().reply)
  expect(f.view().messages.filter(m=>m.role==='assistant').map(m=>m.text)).toEqual(['Initial job complete','New job complete'])
  expect(f.calls.filter(r=>r.ephemeral)).toHaveLength(enabled?1:0)
 }
})

it('preserves an assignment already submitted when its receipt returns after a correction',async()=>{
 const submitted=gate(),receipt=gate(),worker=gate()
 const f=fixture(async r=>{
  const data=JSON.parse(r.input)
  if(r.role==='worker'){
   await worker.wait
   return {state:'ready',summary:'Original assignment complete',reply:'Original assignment complete',question:null,handbacks:[]}
  }
  if(data.resultReview)return {decision:'answer',nextStep:'',reply:'The existing Worker completed.'}
  if(data.kind==='chat_interjection')return {action:'update',reply:'I will check the original assignment.'}
  if(data.kind==='chat_task_update'||data.taskUpdate)return {reply:'One assignment was already submitted.'}
  const assign=(key:string)=>r.onTool!('worker_manage',{action:'assign',id:'research',revision:0,requestId:key,text:'Review A'},key)
  expect((await assign('sent-before-change')).success).toBe(true)
  expect((await assign('must-not-send')).success).toBe(false)
  return {reply:'Superseded'}
 },true)
 const impl=f.h.manager.call.bind(f.h.manager)
 vi.spyOn(f.h.manager,'call').mockImplementation(async(...args)=>{
  const result=await impl(...args)
  if((args[0] as any).requestId==='sent-before-change'){submitted.release();await receipt.wait}
  return result
 })
 const main=f.send('Assign the check.');await f.h.tick();await submitted.wait
 try{
  expect(f.h.store.tickets.list()).toHaveLength(1)
  const input=f.send('No more assignments. Check whether the first one went through.')
  await settle(f.h,()=>!!f.h.store.get('chat-message','reply:interjection:'+input.runId))
  receipt.release()
  await settle(f.h,()=>!!f.h.store.get('chat-message','reply:router:'+main.runId))
  expect(f.h.store.get('chat-message','reply:router:'+main.runId)).toMatchObject({text:'One assignment was already submitted.'})
  expect(f.h.store.get('chat-run',input.runId)).toMatchObject({interjection:{state:'applied'}})
  expect(f.h.store.tickets.list()).toHaveLength(1)
 }finally{receipt.release();worker.release()}
 await settle(f.h,()=>f.view().messages.some(m=>m.text==='The existing Worker completed.'))
})

it('keeps adjacent private chats separate and sends only confirmed evidence to a short reply',async()=>{
 const reading=gate(),release=gate()
 let reads=0
 const f=fixture(async r=>{
  const d=JSON.parse(r.input)
  if(d.kind==='chat_interjection'){
   expect(r.input).not.toContain('Foreign instruction')
   expect(d.readResults).toHaveLength(1)
   expect(d.readResults[0].tool).toBe('worker_manage')
   expect(d.readResults[0].text).toContain('research')
   expect(d.priorReplies).toEqual([{question:'Who did this step?',answer:'I am doing this step myself.'}])
   return {action:'answer',reply:'The first read found research.'}
  }
  if(d.trigger?.text==='Foreign instruction'){expect(r.input).not.toContain('Check twice');return {reply:'Other conversation only.'}}
  await r.onTool!('worker_manage',{action:'list'},'first')
  await r.onTool!('worker_manage',{action:'list'},'second')
  return {reply:'Finished the checks.'}
 },true)
 const impl=f.h.manager.call.bind(f.h.manager)
 vi.spyOn(f.h.manager,'call').mockImplementation(async(...args)=>{if(++reads===2){reading.release();await release.wait}return impl(...args)})
 f.send('Check twice');await f.h.tick();await reading.wait
 try{
  const other=f.h.chat.create('different-owner')
  const foreign=f.h.chat.send(other.id,'different-owner',{clientMessageId:randomUUID(),text:'Foreign instruction'})
  expect(f.h.store.get<any>('chat-run',foreign.runId)?.interjection).toBeUndefined()
  const actor=f.send('Who did this step?')
  await settle(f.h,()=>!!f.h.store.get('chat-message','reply:router:'+actor.runId))
  const follow=f.send('What had you found then?')
  await settle(f.h,()=>!!f.h.store.get('chat-message','reply:router:'+follow.runId))
  expect(f.h.store.get('chat-message','reply:router:'+follow.runId)).toMatchObject({text:'The first read found research.'})
 }finally{release.release()}
 await settle(f.h,()=>!f.view().reply)
})
