import {afterEach,expect,it} from 'vitest'
import {mkdtempSync,rmSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {randomUUID} from 'node:crypto'
import {Runtime} from '../src/runtime.ts'
import {configSchema} from '../src/config.ts'
import {serve} from '../src/server.ts'
import type {ModelRequest} from '../src/model.ts'

const roots:string[]=[],hosts:Runtime[]=[]
afterEach(async()=>{for(const h of hosts.splice(0))await h.close();for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true})})
const gate=()=>{let release!:()=>void;const wait=new Promise<void>(r=>{release=r});return {wait,release}}
async function settle(h:Runtime,done:()=>boolean){for(let i=0;i<500;i++){await h.tick();await new Promise(r=>setTimeout(r,2));if(done())return}throw Error('Chat did not settle')}
function fixture(run:(r:ModelRequest)=>Promise<unknown>,scoped=false){
 const root=mkdtempSync(join(tmpdir(),'chat-duplex-'));roots.push(root)
 const config=configSchema.parse({stateDir:join(root,'state'),port:0,work:{sandboxDriver:'disabled'},execution:{router:{mode:'host'},management:{enabled:true},workers:[{id:'research',backend:'codex'}]},sources:[{id:'local',kind:'local',cwd:root,allowedActors:['operator']}]})
 const calls:ModelRequest[]=[],model={async run(r:ModelRequest){calls.push(r);const threadId=r.threadId??randomUUID();r.onThread?.(threadId);return {threadId,turnId:randomUUID(),text:JSON.stringify(await run(r))}}}
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
 f.send('Please fix the bug')
 try{
  await settle(f.h,()=>!!worker&&f.view().messages.some(m=>m.status==='streaming'))
  f.send('Keep talking')
  expect(worker!.signal!.aborted).toBe(false)
  expect(f.h.store.list('router-cancelled')).toEqual([])
  first.release()
  await settle(f.h,()=>laterStarted)
  expect(f.view().workers[0]!.tasks[0]!.state).toBe('running')
  work.release()
  await settle(f.h,()=>f.h.store.tickets.list().some(t=>!!t.ended))
  expect(f.view().messages.some(m=>m.text==='The background task is complete.')).toBe(false)
 }finally{first.release();work.release();later.release()}
 await settle(f.h,()=>f.view().messages.some(m=>m.text==='The background task is complete.'))
 expect(maximum).toBe(1)
 expect(f.calls.filter(r=>r.role==='worker')).toHaveLength(1)
 expect(f.view().workers[0]!.tasks[0]!.state).toBe('completed')
 expect(f.view().messages.filter(m=>m.role==='user')).toHaveLength(2)
 expect(f.h.store.db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE state='failed'").get()!.n).toBe(0)
})

it('accepts consecutive HTTP messages while preserving authentication and conversation ownership',async()=>{
 const f=fixture(async r=>({reply:'Reply to '+JSON.parse(r.input).trigger.text})),server=await serve(f.h)
 try{
  const headers={authorization:'Bearer '+readFileSync(join(f.root,'state/access-token'),'utf8').trim(),'content-type':'application/json'}
  const path=server.url+'/api/chat/conversations/'+f.c.id+'/messages'
  const body=JSON.stringify({text:'First request',clientMessageId:randomUUID()})
  expect((await fetch(path,{method:'POST',body})).status).toBe(401)
  expect((await fetch(path,{method:'POST',headers:{...headers,origin:'https://other.example'},body})).status).toBe(403)
  const other=f.h.chat.create('another-owner')
  expect((await fetch(server.url+'/api/chat/conversations/'+other.id+'/messages',{method:'POST',headers,body})).status).toBe(404)
  expect((await fetch(path,{method:'POST',headers,body})).status).toBe(202)
  expect((await fetch(path,{method:'POST',headers,body:JSON.stringify({text:'Second request',clientMessageId:randomUUID()})})).status).toBe(202)
  expect(f.view().messages.filter(m=>m.role==='user')).toHaveLength(2)
 }finally{await server.closeRuntime();hosts.splice(hosts.indexOf(f.h),1);server.server.closeAllConnections();await new Promise<void>(resolve=>server.server.close(()=>resolve()))}
})

it('recovers queued messages after restart without duplicate admission or overlapping Router turns',async()=>{
 const f=fixture(async r=>({reply:'Reply to '+JSON.parse(r.input).trigger.text})),messageId=randomUUID()
 const sent=f.send('First request',messageId);f.send('Second request')
 await f.h.close();hosts.splice(hosts.indexOf(f.h),1)
 const h=new Runtime(f.config,{model:f.model});hosts.push(h)
 expect(h.chat.send(f.c.id,'local-operator',{text:'First request',clientMessageId:messageId})).toEqual({runId:sent.runId,duplicate:true})
 await settle(h,()=>!h.chat.view(f.c.id,'local-operator').reply)
 expect(f.calls).toHaveLength(2)
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
