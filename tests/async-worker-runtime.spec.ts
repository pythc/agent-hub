import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterEach,expect,it,vi} from 'vitest'
import {ExecutionTrace} from '../src/execution-trace.ts'
import {Runtime} from '../src/runtime.ts'
import {configSchema} from '../src/config.ts'
import type {Model,ModelRequest} from '../src/model.ts'
import {observe,type WorkerAttempt,type WorkerEventReceipt} from '../src/async-worker-inbox.ts'
const roots:string[]=[],hosts:Runtime[]=[]
afterEach(async()=>{vi.restoreAllMocks();for(const h of hosts.splice(0))await h.close();for(const r of roots.splice(0))rmSync(r,{recursive:true,force:true})})
const report=JSON.stringify({state:'ready',summary:'PRIVATE report',reply:'PRIVATE result',question:null,askedBy:null,handbacks:[]})
async function fixture(model:Model){
 const root=mkdtempSync(join(tmpdir(),'async-worker-runtime-'));roots.push(root)
 const config=configSchema.parse({stateDir:join(root,'state'),acceptMode:'auto',work:{sandboxDriver:'disabled',autoRecover:false},execution:{router:{mode:'host'},management:{enabled:true,maxWorkers:1},workers:[{id:'one',backend:'codex'}]},sources:[{id:'local',kind:'local',cwd:root,workspace:{mode:'source'},allowedActors:['alice']}]})
 const host=new Runtime(config,{model});hosts.push(host)
 host.scopes.command({action:'scope.put',operationId:'scope',expectedRevision:0,scope:{id:'team',tenantId:'org',name:'Team',managers:[JSON.stringify(['local','alice'])],workerIds:['one'],sourceIds:['local'],backendIds:['codex']}})
 host.scopes.command({action:'entry.bind',operationId:'entry',expectedRevision:0,scopeId:'team',sourceId:'local',accountNamespace:'local',nativeId:'topic',history:'group'})
 const received=host.receive('local','alice',{id:'human',thread:'topic',scope:'topic',text:'Analyze the supplied material.',addressed:true})as {triggerId:string}
 const context=host.scopes.context(host.store.triggers.get(received.triggerId)!,'local:topic')!
 const assignment=await host.manager.call({action:'assign',id:'one',revision:0,requestId:'work',text:'Analyze material'},{discussion:'local:topic',trigger:context.trigger,scoped:context})
 return {host,config,context,ticketId:assignment.ticketId}
}
async function until(host:Runtime,predicate:()=>boolean){for(let i=0;i<300;i++){if(predicate())return;await host.tick();await new Promise(r=>setTimeout(r,5))}throw Error('Runtime did not settle')}
it('binds actual callbacks, folds repeated observations and atomically delivers a single internal result across retries',async()=>{
 const model:Model={async run(r){if(r.role==='worker'){for(let i=0;i<10;i++)r.onProgress?.('backend/request');for(let i=0;i<10;i++)await r.onTool!('superagent_progress',{summary:'Working internally'},'progress-'+i);return {threadId:'worker-thread',turnId:'worker-turn',text:report}}return {threadId:'router-thread',turnId:'router-turn',text:'{"reply":""}'}}}
 const f=await fixture(model),flush=vi.spyOn(f.host,'flush').mockResolvedValue()
 await until(f.host,()=>f.host.store.list<WorkerEventReceipt>('async-worker-event').some(e=>e.kind==='result'))
 flush.mockRestore()
 const events=f.host.store.list<WorkerEventReceipt>('async-worker-event');expect(events).toHaveLength(3);expect(events.filter(e=>e.kind==='result')).toHaveLength(1)
 const result=events.find(e=>e.kind==='result')!,attempt=f.host.store.get<WorkerAttempt>('async-worker-attempt',result.attemptId)!
 expect(attempt.causeJobId).toMatch(/^execute:/)
 const apply=vi.fn();for(let i=0;i<10;i++)expect(observe(f.host,attempt,{kind:'result',payload:report,nativeTurnId:'worker-turn'},apply).replayed).toBe(true);expect(apply).not.toHaveBeenCalled()
 const message=f.host.store.deliveries().find(d=>d.ticketId===f.ticketId&&d.status==='pending')!;expect(message).toBeDefined()
 expect(f.host.store.get('async-worker-message',message.id)).toMatchObject({eventId:result.id,attemptId:attempt.id})
 const enqueue=f.host.store.enqueue.bind(f.host.store),failure=vi.spyOn(f.host.store,'enqueue').mockImplementation((id,kind,payload)=>{if(id==='router:result:'+message.id)throw Error('injected inbox enqueue failure');return enqueue(id,kind,payload)})
 await f.host.flush();expect(f.host.store.deliveries().find(d=>d.id===message.id)?.status).toBe('pending');expect(f.host.store.get('router-inbox',message.id)).toBeUndefined()
 failure.mockRestore();for(let i=0;i<10;i++)await f.host.flush()
 expect(f.host.store.get('router-inbox',message.id)).toMatchObject({workerEvent:{eventId:result.id,attemptId:attempt.id}})
 expect(f.host.store.db.prepare('SELECT COUNT(*) AS count FROM jobs WHERE id=?').get('router:result:'+message.id)?.count).toBe(1)
 expect(f.host.store.deliveries().find(d=>d.id===message.id)?.status).toBe('sent')
 const view=new ExecutionTrace(()=>f.host).snapshot({ticketId:f.ticketId}) as any
 expect(JSON.stringify(view)).not.toContain('PRIVATE');expect(view.tasks[0].asyncInbox).toMatchObject({received:3,applied:3,archived:0})
 hosts.splice(hosts.indexOf(f.host),1);await f.host.close();const reopened=new Runtime(f.config,{model});hosts.push(reopened)
 for(let i=0;i<10;i++)observe(reopened,attempt,{kind:'result',payload:report,nativeTurnId:'worker-turn'},apply)
 expect(apply).not.toHaveBeenCalled();expect(reopened.store.list('async-worker-event')).toHaveLength(3)
})
it('archives a late completed callback after cancellation and does not publish or revive task state',async()=>{
 let captured:ModelRequest|undefined,release!:()=>void;const gate=new Promise<void>(r=>release=r)
 const f=await fixture({async run(r){if(r.role==='worker'){captured=r;await gate;return {threadId:'old-thread',turnId:'old-turn',text:report}}return {threadId:'router',turnId:'turn',text:'{"reply":""}'}}})
 await until(f.host,()=>!!captured)
 f.host.stop(f.ticketId)
 const after=f.host.store.tickets.get(f.ticketId)
 captured!.onProgress?.('late-progress');release()
 for(let i=0;i<300&&!f.host.store.list<WorkerEventReceipt>('async-worker-event').some(e=>e.kind==='result');i++)await new Promise(r=>setTimeout(r,5))
 expect(f.host.store.list<WorkerEventReceipt>('async-worker-event')).toEqual(expect.arrayContaining([expect.objectContaining({kind:'progress',disposition:'archived'}),expect.objectContaining({kind:'result',disposition:'archived'})]))
 expect(f.host.store.tickets.get(f.ticketId)?.ended).toEqual(after?.ended)
 expect(f.host.store.deliveries().some(d=>d.text==='PRIVATE result')).toBe(false)
 expect(f.host.store.list<any>('transcript').some(t=>t.ticketId===f.ticketId&&t.status==='stale')).toBe(true)
})
it('rejects an old root tool callback after its terminal event while the same assignment remains live',async()=>{
 let captured:ModelRequest|undefined
 const f=await fixture({async run(r){if(r.role==='worker'){captured=r;return {threadId:'worker',turnId:'waiting-turn',text:JSON.stringify({state:'waiting',summary:'More work remains',reply:'',question:null,askedBy:null,handbacks:[]})}}return {threadId:'router',turnId:'router-turn',text:'{"reply":""}'}}})
 await until(f.host,()=>f.host.store.list<WorkerEventReceipt>('async-worker-event').some(e=>e.kind==='result'))
 expect(f.host.store.tickets.get(f.ticketId)?.ended).toBeUndefined()
 const shell=vi.spyOn(f.host.work,'shell')
 await expect(captured!.onTool!('superagent_shell',{command:'touch must-not-exist',requestId:'late-effect'},'late-tool')).rejects.toThrow('attempt has ended')
 expect(shell).not.toHaveBeenCalled();expect(f.host.work.list(f.ticketId)).toEqual([])
})
it('rejects a previous root callback after a real second activation in the same assignment starts',async()=>{
 const requests:ModelRequest[]=[];let release!:()=>void;const pending=new Promise<void>(r=>release=r)
 const f=await fixture({async run(r){if(r.role==='worker'){requests.push(r);if(requests.length===2)await pending;return {threadId:'same-thread',turnId:'turn-'+requests.length,text:JSON.stringify({state:'waiting',summary:'Working',reply:'',question:null,askedBy:null,handbacks:[]})}}return {threadId:'router',turnId:'router-turn',text:'{"reply":""}'}}})
 await until(f.host,()=>f.host.store.list<WorkerEventReceipt>('async-worker-event').some(e=>e.kind==='result'))
 const assignmentId=f.host.store.tickets.get(f.ticketId)!.assignments.at(-1)!.id
 f.host.engine.note(f.ticketId,'Continue the authorized analysis with another input')
 await until(f.host,()=>requests.length===2)
 expect(f.host.store.tickets.get(f.ticketId)!.assignments.at(-1)!.id).toBe(assignmentId)
 expect(f.host.store.list('async-worker-attempt')).toHaveLength(2)
 const shell=vi.spyOn(f.host.work,'shell')
 try{await expect(requests[0]!.onTool!('superagent_shell',{command:'touch must-not-exist',requestId:'stale-effect'},'stale-tool')).rejects.toThrow('attempt has ended')}finally{release()}
 expect(shell).not.toHaveBeenCalled()
})
it.each(['ready','dropped'] as const)('retains result and idle run after a no-follow %s report ends its ticket',async state=>{
 const output=JSON.stringify({state,summary:'Settled task',reply:state==='ready'?'Result':'',question:null,askedBy:null,handbacks:[]})
 const f=await fixture({async run(r){return {threadId:r.role??'worker',turnId:r.role+'-done',text:r.role==='worker'?output:'{"reply":""}'}}})
 const ticket=f.host.store.tickets.get(f.ticketId)!;f.host.store.tickets.save({...ticket,follows:[]})
 await until(f.host,()=>f.host.store.list<WorkerEventReceipt>('async-worker-event').some(e=>e.kind==='result'))
 expect(f.host.store.tickets.get(f.ticketId)?.ended).toBeDefined()
 expect(f.host.store.get('run',f.ticketId)).toMatchObject({phase:'idle',result:state==='ready'?'Result':''})
})
it('real history deletion redacts async tombstones and late retained callbacks cannot restore receipts',async()=>{
 const f=await fixture({async run(r){if(r.role==='worker')r.onProgress?.('backend/request');return {threadId:r.role??'worker',turnId:r.role+'-done',text:r.role==='worker'?report:'{"reply":""}'}}})
 await until(f.host,()=>f.host.store.list<WorkerEventReceipt>('async-worker-event').some(e=>e.kind==='result'))
 const attempt=f.host.store.list<WorkerAttempt>('async-worker-attempt')[0]!
 expect(f.host.store.list('async-worker-event').length).toBeGreaterThan(0)
 f.host.memory.command(f.context,{action:'history.delete',operationId:'delete-real-history',expectedRevision:0})
 await f.host.memory.cleanup.process({run:async()=>{throw Error('No inference')},purge:async()=>({local:'verified',provider:'not_managed'})},async()=>true)
 const kinds=['async-worker-attempt','async-worker-current','async-worker-event','async-worker-terminal','async-worker-message']
 const tombstones=kinds.map(kind=>f.host.store.list(kind)),retained=JSON.stringify(tombstones)
 for(const field of ['payloadDigest','mandateDigest','contractDigest','nativeTurnDigest','PRIVATE'])expect(retained).not.toContain(field)
 const effect=vi.fn();expect(()=>observe(f.host,attempt,{kind:'result',payload:report,nativeTurnId:'worker-done'},effect)).toThrow()
 expect(effect).not.toHaveBeenCalled();expect(kinds.map(kind=>f.host.store.list(kind))).toEqual(tombstones)
})
it.each(['resolve','reject'] as const)('archives an invalidated running %s and starts a fresh activation without steering changed-basis input',async mode=>{
 const steer=vi.fn(async(_text:string,onRead?:()=>void)=>{onRead?.()})
 const requests:ModelRequest[]=[];let release!:()=>void;const gate=new Promise<void>(r=>release=r)
 const f=await fixture({async run(r){if(r.role==='worker'){requests.push(r);const number=requests.length;if(number===1){r.onTurn?.('worker-first');r.onActive?.({steer,interrupt:async()=>{}});await gate;if(mode==='reject')throw Error('First model rejected after the input changed')}return {threadId:'worker',turnId:'worker-'+number,text:JSON.stringify({state:'ready',summary:number===1?'Old answer':'Updated answer',reply:number===1?'OLD RESULT':'NEW RESULT',question:null,askedBy:null,handbacks:[]})}}return {threadId:'router',turnId:'router',text:'{"reply":""}'}}})
 await until(f.host,()=>requests.length===1)
 const firstAssignment=f.host.store.tickets.get(f.ticketId)!.assignments.at(-1)!.id
 const incoming=f.host.receive('local','alice',{id:'follow-up',thread:'topic',scope:'topic',text:'Use the revised source material instead.',addressed:true})as {triggerId:string}
 const context=f.host.scopes.context(f.host.store.triggers.get(incoming.triggerId)!,'local:topic')!
 await f.host.manager.call({action:'send',ticketId:f.ticketId,revision:0,requestId:'follow-up-send',text:'Use the revised source material instead.'},{discussion:'local:topic',trigger:context.trigger,scoped:context})
 await f.host.deliverLiveInputs(f.ticketId);expect(steer).not.toHaveBeenCalled()
 release()
 await until(f.host,()=>requests.length===2&&f.host.store.list<WorkerEventReceipt>('async-worker-event').some(e=>e.kind==='result'&&e.disposition==='applied'))
 expect(f.host.store.tickets.get(f.ticketId)!.assignments.at(-1)!.id).toBe(firstAssignment)
 expect(requests[1]!.input).toContain('Use the revised source material instead.')
 const results=f.host.store.list<WorkerEventReceipt>('async-worker-event').filter(e=>e.kind!=='progress')
 expect(results.filter(e=>e.disposition==='archived')).toHaveLength(1);expect(results.filter(e=>e.disposition==='applied')).toHaveLength(1)
 expect(f.host.store.deliveries().some(d=>d.text==='OLD RESULT')).toBe(false)
 expect(f.host.store.get('run',f.ticketId)).toMatchObject({phase:'idle',result:'NEW RESULT'})
})
it('rechecks the root attempt after an awaited tool prompt refresh before any shell effect',async()=>{
 let captured:ModelRequest|undefined,finish!:()=>void,refreshStarted!:()=>void,refreshDone!:()=>void
 const workerGate=new Promise<void>(r=>finish=r),entered=new Promise<void>(r=>refreshStarted=r),refreshGate=new Promise<void>(r=>refreshDone=r)
 const f=await fixture({async run(r){if(r.role==='worker'){captured=r;await workerGate;return {threadId:'worker',turnId:'done',text:JSON.stringify({state:'waiting',summary:'Waiting',reply:'',question:null,askedBy:null,handbacks:[]})}}return {threadId:'router',turnId:'router',text:'{"reply":""}'}}})
 await until(f.host,()=>!!captured)
 vi.spyOn(f.host,'refreshWork').mockImplementation(async()=>{refreshStarted();await refreshGate})
 const shell=vi.spyOn(f.host.work,'shell'),tool=captured!.onTool!('superagent_shell',{command:'touch must-not-exist',requestId:'refresh-race'},'refresh-tool')
 const rejection=expect(tool).rejects.toThrow('attempt has ended')
 await entered;finish()
 await until(f.host,()=>f.host.store.list<WorkerEventReceipt>('async-worker-event').some(e=>e.kind==='result'))
 refreshDone();await rejection;expect(shell).not.toHaveBeenCalled()
})
it('refreshes the liveness timestamp for duplicate real progress callbacks without duplicate business events',async()=>{
 let captured:ModelRequest|undefined,release!:()=>void;const gate=new Promise<void>(r=>release=r)
 const f=await fixture({async run(r){if(r.role==='worker'){captured=r;await gate;return {threadId:'worker',turnId:'done',text:report}}return {threadId:'router',turnId:'router',text:'{"reply":""}'}}})
 await until(f.host,()=>!!captured)
 let clock=Date.now();const now=vi.spyOn(Date,'now').mockImplementation(()=>clock)
 captured!.onProgress?.('backend/request');const first=f.host.store.get<any>('progress',f.ticketId)!.at
 clock+=25;captured!.onProgress?.('backend/request')
 expect(f.host.store.get<any>('progress',f.ticketId)!.at).toBe(first+25)
 expect(f.host.store.list<WorkerEventReceipt>('async-worker-event').filter(e=>e.kind==='progress')).toHaveLength(1)
 now.mockRestore();const stopping=f.host.stop(f.ticketId)
 const stopped=f.host.store.get('progress',f.ticketId);captured!.onProgress?.('backend/request')
 expect(f.host.store.get('progress',f.ticketId)).toEqual(stopped);release();await stopping
})
it.each(['cancel','basis'] as const)('withdraws a composed external result before flush after %s invalidates its Worker receipt',async change=>{
 let f:Awaited<ReturnType<typeof fixture>>,hold:ReturnType<typeof vi.spyOn>|undefined
 const model:Model={async run(r){if(r.role==='worker')return {threadId:'worker',turnId:'worker-final',text:report};const result=r.input.includes('worker_result');if(result)hold=vi.spyOn(f.host,'flush').mockResolvedValue();return {threadId:'router',turnId:result?'result-router':'initial-router',text:JSON.stringify({reply:result?'Composed result for the requester':''})}}}
 f=await fixture(model);const deliver=vi.spyOn(f.host.sources.get('local')!,'deliver').mockResolvedValue()
 await until(f.host,()=>f.host.store.deliveries().some(d=>d.text==='Composed result for the requester'))
 const message=f.host.store.deliveries().find(d=>d.text==='Composed result for the requester')!
 expect(message.status).toBe('pending');expect(f.host.store.get<any>('router-reply-owner',message.id).workerEvents).toHaveLength(1)
 if(change==='cancel')await f.host.stop(f.ticketId)
 else{
  const incoming=f.host.receive('local','alice',{id:'change-basis',thread:'topic',scope:'topic',text:'Use revised material instead.',addressed:true})as {triggerId:string}
  const context=f.host.scopes.context(f.host.store.triggers.get(incoming.triggerId)!,'local:topic')!
  f.host.scopes.noteInput(f.ticketId,context)
 }
 hold!.mockRestore();await f.host.flush()
 expect(f.host.store.deliveries().find(d=>d.id===message.id)?.status).toBe('dropped');expect(deliver).not.toHaveBeenCalled()
})
it('does not consume an in-flight steer ACK after a newer scoped input invalidates the old attempt',async()=>{
 let captured:ModelRequest|undefined,finish!:()=>void,ack:(()=>void)|undefined,steerDone!:()=>void
 const workerGate=new Promise<void>(r=>finish=r),steerGate=new Promise<void>(r=>steerDone=r)
 const f=await fixture({async run(r){if(r.role==='worker'){captured=r;r.onTurn?.('running');r.onActive?.({steer:async(_text,onRead)=>{ack=onRead;await steerGate},interrupt:async()=>{}});await workerGate;return {threadId:'worker',turnId:'worker-final',text:report}}return {threadId:'router',turnId:'router',text:'{"reply":""}'}}})
 await until(f.host,()=>!!captured)
 f.host.engine.note(f.ticketId,'An in-scope internal observation')
 const delivering=f.host.deliverLiveInputs(f.ticketId)
 for(let i=0;i<100&&!ack;i++)await new Promise(r=>setTimeout(r,2));expect(ack).toBeDefined()
 const incoming=f.host.receive('local','alice',{id:'ack-basis',thread:'topic',scope:'topic',text:'Use new inputs instead.',addressed:true})as {triggerId:string}
 const context=f.host.scopes.context(f.host.store.triggers.get(incoming.triggerId)!,'local:topic')!
 f.host.scopes.noteInput(f.ticketId,context)
 const pending=[...f.host.store.tickets.get(f.ticketId)!.undelivered]
 ack!();expect(f.host.store.tickets.get(f.ticketId)!.undelivered).toEqual(pending)
 steerDone();await delivering;finish()
})
