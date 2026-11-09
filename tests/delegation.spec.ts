import {afterEach,expect,it} from 'vitest'
import {mkdtempSync,mkdirSync,rmSync,readFileSync,writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {createHash} from 'node:crypto'
import {Runtime} from '../src/runtime.ts'
import {serve} from '../src/server.ts'
import {configSchema} from '../src/config.ts'
import {patchSchema} from '../src/settings.ts'
import {DelegationError} from '../src/delegation/contract.ts'
import {backupState,verifyBackup,restoreState} from '../src/backup.ts'
import {packet} from '../src/delegation/identity.ts'
import type {Model,ModelRequest} from '../src/model.ts'
import type {OutboundTask,PairingTicket,RemoteTask} from '../src/delegation/manager.ts'

const roots:string[]=[],hosts:Runtime[]=[],servers:Awaited<ReturnType<typeof serve>>[]=[]
afterEach(async()=>{
 for(const s of servers.splice(0)){s.server.closeAllConnections();await new Promise<void>(r=>s.server.close(()=>r()));await s.closeRuntime()}
 for(const h of hosts.splice(0))if(!h.shuttingDown)await h.close()
 for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true})
})
function config(enabled=true){
 const root=mkdtempSync(join(tmpdir(),'roppo-delegation-'));roots.push(root)
 mkdirSync(join(root,'files'));writeFileSync(join(root,'files','input.txt'),'2\n')
 return configSchema.parse({
  stateDir:join(root,'state'),port:0,work:{sandboxDriver:'disabled',network:false},
  delegation:{enabled,pollMs:100,leaseMs:3000},
  execution:{router:{mode:'host'},management:{enabled:true},workers:[{id:'one',backend:'codex'}]},
  sources:[{id:'local',kind:'local',cwd:join(root,'files'),allowedActors:['operator'],sandbox:'workspace-write',workspace:{mode:'source'}},
   {id:'delegation',kind:'delegation',cwd:join(root,'files'),sandbox:'read-only',workspace:{mode:'directory'}}],
 })
}
const report={state:'ready',summary:'Verified fixture result: 2',reply:'2',question:null,askedBy:null,handbacks:[]}
function fixture(kind:'parent'|'child',calls:ModelRequest[]=[],hang=false):Model{
 let turns=0
 return {async run(r){
  calls.push(r);const threadId=r.threadId??kind+'-'+(++turns),turnId='turn-'+calls.length
  r.onThread?.(threadId);r.onTurn?.(turnId)
  const input=JSON.parse(r.input)
  if(r.role==='worker'){
   expect(r.sandbox).toBe('read-only')
   expect(r.tools?.some(t=>t.name==='superagent_publish')).toBe(false)
   if(hang)await new Promise<void>((resolve,reject)=>{if(r.signal?.aborted)reject(r.signal.reason);else r.signal?.addEventListener('abort',()=>reject(r.signal?.reason),{once:true})})
   const read=await r.onTool!('superagent_read',{resource:'files/input.txt'},'read-input')
   expect(read.success).toBe(true)
   const artifact=await r.onTool!('superagent_artifact',{path:'input.txt'},'capture-input')
   expect(artifact.success).toBe(true)
   expect(JSON.parse((artifact.contentItems[0] as any).text).hex).toBe('320a')
   return {threadId,turnId,text:JSON.stringify(report)}
  }
  if(kind==='parent'){
   if(input.kind==='team_result'){
    const inspect=await r.onTool!('team_delegate',{action:'inspect',id:input.task.id},'inspect')
    expect(inspect.success).toBe(true)
    const details=JSON.parse((inspect.contentItems[0] as any).text)
    const listed=JSON.parse(((await r.onTool!('team_delegate',{action:'list'},'list')).contentItems[0] as any).text)
    expect((await r.onTool!('team_delegate',{action:'accept',id:input.task.id,operationId:'accept-current',expectedRevision:listed.revision,evidence:details.evidence.map((e:any)=>e.id)},'accept-current')).success).toBe(true)
    return {threadId,turnId,text:JSON.stringify({reply:'Parent checked remote evidence: 2'})}
   }
   const listed=JSON.parse(((await r.onTool!('team_delegate',{action:'list'},'list')).contentItems[0] as any).text)
   const assigned=await r.onTool!('team_delegate',{action:'assign',targetId:listed.targets[0].id,operationId:'delegate-root',expectedRevision:listed.revision,text:'Verify 1+1 and return input.txt as evidence',acceptance:'Result must be 2',artifacts:['input.txt']},'assign')
   expect(assigned.success,JSON.stringify(assigned)).toBe(true)
  }else if(input.kind==='worker_result'){
   const inspected=await r.onTool!('worker_manage',{action:'result',ticketId:input.messages[0].ticketId},'result')
   expect(inspected.success).toBe(true)
   return {threadId,turnId,text:JSON.stringify({reply:'Child inspected Worker evidence: 2'})}
  }else{
   const listed=JSON.parse(((await r.onTool!('worker_manage',{action:'list'},'list')).contentItems[0] as any).text)
   const assigned=await r.onTool!('worker_manage',{action:'assign',id:'one',requestId:'child-assignment',revision:listed.revision,text:'Verify input.txt contains the result of 1+1',acceptance:'2'},'assign')
   expect(assigned.success,JSON.stringify(assigned)).toBe(true)
  }
  return {threadId,turnId,text:JSON.stringify({reply:''})}
 }}
}
async function start(c=config(),m:Model=fixture('child')){
 const h=new Runtime(c,{model:m});hosts.push(h)
 const s=await serve(h);servers.push(s);return h
}
async function pair(a:Runtime,b:Runtime){
 const ticket=b.delegation.pairing({expectedRevision:b.settings.current().revision,policy:{workerIds:['one']}}) as PairingTicket
 await a.delegation.connect({ticket,label:'Child team',expectedRevision:a.settings.current().revision})
 return ticket
}
async function until(predicate:()=>boolean,timeout=3000){
 const end=Date.now()+timeout
 while(Date.now()<end){if(predicate())return;await new Promise(r=>setTimeout(r,15))}
 throw Error('Delegation did not settle: '+JSON.stringify(hosts.map(h=>({snapshot:h.delegation.snapshot(),errors:h.store.list('router-error'),jobs:h.store.db.prepare("SELECT id,kind,state FROM jobs WHERE state='failed'").all()}))))
}
function outbound(h:Runtime){return h.store.list<OutboundTask>('delegation-outbound')[0]!}

it('does not create an identity, new listener or schema gate when disabled; sparse patches stay empty',async()=>{
 const h=await start(config(false))
 expect(h.delegation.snapshot().enabled).toBe(false)
 expect(h.delegation.snapshot().identity).toBeNull()
 expect(h.store.db.prepare('PRAGMA user_version').get()!.user_version).toBe(7)
 expect(patchSchema.parse({})).toEqual({})
 expect(h.config.execution.teamTargets).toBeUndefined()
})

it('runs Router A → independent Router B → Worker → evidence → parent review over real HTTP',async()=>{
 const parentCalls:ModelRequest[]=[],childCalls:ModelRequest[]=[]
 const a=await start(config(),fixture('parent',parentCalls)),b=await start(config(),fixture('child',childCalls))
 await pair(a,b)
 const root=a.receive('local','operator',{id:'root',thread:'request',text:'Delegate this bounded test and verify the result',addressed:true}) as any
 await until(()=>outbound(a)?.acceptance==='passed')
 expect(outbound(a).remote?.state).toBe('ready')
 expect(outbound(a).remote?.artifacts[0]?.sha256).toBe(createHash('sha256').update('2\n').digest('hex'))
 expect(outbound(a).remote?.workerReports?.[0]?.summary).toBe(report.summary)
 expect(parentCalls.filter(r=>r.role==='router')).toHaveLength(2)
 expect(childCalls.filter(r=>r.role==='worker')).toHaveLength(1)
 expect(b.store.triggers.get(b.store.list<RemoteTask>('delegation-inbound')[0]!.triggerId)?.human).toBe(false)
 expect(b.store.deliveries().filter(m=>m.channel.source==='local')).toHaveLength(0)
 expect(root.triggerId).toBe(outbound(a).triggerId)
 expect(a.store.db.prepare('PRAGMA user_version').get()!.user_version).toBe(10)
})

it('requires an explicit artifact list and preserves paired targets when an older settings client omits them',async()=>{
 const a=await start(),b=await start();await pair(a,b)
 a.pause(true);a.receive('local','operator',{id:'explicit',thread:'explicit',text:'Delegate a bounded objective',addressed:true})
 const trigger=a.store.triggers.get('local:explicit')!
 await expect(a.delegation.command({action:'assign',targetId:b.delegation.identity.id,operationId:'missing-artifacts',expectedRevision:a.settings.current().revision,text:'Read input.txt',acceptance:'2'},{trigger,discussion:'local:explicit'})).rejects.toThrow('explicit_artifact_list_required')
 expect(a.store.list('delegation-outbound')).toHaveLength(0)
 const previous=a.config.execution.teamTargets
 const {teamTargets,...legacyExecution}=a.config.execution
 a.updateSettings(a.settings.current().revision,{execution:legacyExecution})
 expect(a.config.execution.teamTargets).toEqual(previous)
})

it('does not finish from a reply created before report inspection or reopen a completed delegation',async()=>{
 const calls:ModelRequest[]=[],a=await start(config(),fixture('parent')),b=await start(config(),fixture('child',calls))
 await pair(a,b);a.receive('local','operator',{id:'read-fence',thread:'request',text:'Delegate and inspect',addressed:true})
 await until(()=>outbound(a)?.acceptance==='passed')
 const task=b.store.list<RemoteTask>('delegation-inbound')[0]!,final=task.replies.at(-1)!
 b.store.put('delegation-inbound',task.id,{...task,state:'running',artifacts:[],workerReports:[],replies:[]})
 const channel=b.store.triggers.get(task.triggerId)!.channel!
 await b.delegation.deliver({id:'early-acknowledgement',kind:'reply',channel,text:'Work was accepted.'})
 expect(b.store.get<RemoteTask>('delegation-inbound',task.id)?.state).toBe('running')
 await b.delegation.deliver({id:final.id,kind:'reply',channel,text:final.text})
 expect(b.store.get<RemoteTask>('delegation-inbound',task.id)?.state).toBe('ready')
 expect(()=>b.delegation.beforeActivation(calls.find(r=>r.role==='router')!)).toThrow('delegation_already_completed')
})

it('allows the same actor to inspect a delegation in a followup while denying a different actor',async()=>{
 const c=config();c.sources[0]!.allowedActors.push('other')
 const a=await start(c,fixture('parent')),b=await start()
 await pair(a,b);a.receive('local','operator',{id:'root-followup',thread:'request',text:'Delegate and inspect',addressed:true})
 await until(()=>outbound(a)?.acceptance==='passed')
 a.pause(true)
 a.receive('local','operator',{id:'followup',thread:'request',text:'Inspect the original delegated work',addressed:true})
 const trigger=a.store.triggers.get('local:followup')!,context={trigger,discussion:'local:request'}
 expect((await a.delegation.command({action:'inspect',id:outbound(a).id},context) as any).id).toBe(outbound(a).id)
 a.receive('local','other',{id:'different-actor',thread:'request',text:'Inspect this delegation',addressed:true})
 const other=a.store.triggers.get('local:different-actor')!
 await expect(a.delegation.command({action:'inspect',id:outbound(a).id},{trigger:other,discussion:'local:request'})).rejects.toThrow()
})

it('deduplicates submissions, rejects a changed contract, and does not trust an operator bearer token on the service',async()=>{
 const a=await start(config(),fixture('parent')),b=await start(config())
 await pair(a,b);a.receive('local','operator',{id:'root',thread:'request',text:'Delegate bounded work',addressed:true})
 await until(()=>!!outbound(a)?.remote)
 const t=outbound(a),connection=a.store.get<any>('delegation-connection',t.connectionId)
 const submit=async(contract:any)=>fetch(b.delegation.endpoint+'/delegation/v1',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(packet(a.delegation.identity,b.delegation.identity.id,'submit',{grantId:connection.grantId,payload:{contract,leaseUntil:Date.now()+2000}}))})
 expect((await submit(t.contract)).status).toBe(200)
 expect((await submit({...t.contract,text:'Different work'})).status).toBe(409)
 expect(b.store.list('delegation-inbound')).toHaveLength(1)
 const denied=await fetch(b.delegation.endpoint+'/delegation/v1',{method:'POST',headers:{authorization:'Bearer '+readFileSync(join(b.config.stateDir,'access-token'),'utf8')},body:'{}'})
 expect(denied.status).toBe(400)
})

it('cancels the owned remote subtree and fences late parent completion',async()=>{
 const a=await start(config(),fixture('parent')),b=await start(config(),fixture('child',[],true))
 await pair(a,b);a.receive('local','operator',{id:'root',thread:'request',text:'Delegate bounded work',addressed:true})
 await until(()=>b.store.list<any>('run').some(r=>r.phase==='running'))
 await a.cancelRouter('local:root','local:request')
 await until(()=>outbound(a)?.remote?.state==='cancelled')
 expect(outbound(a).desired).toBe('cancelled')
 expect(outbound(a).acceptance).toBe('pending')
 expect(b.store.tickets.list().every(t=>!!t.ended)).toBe(true)
})

it('rejects reuse of a consumed pairing ticket after revocation',async()=>{
 const a=await start(),b=await start(),ticket=await pair(a,b)
 await b.delegation.revoke(a.delegation.identity.id)
 await expect(a.delegation.connect({ticket,label:'Again',expectedRevision:a.settings.current().revision})).rejects.toThrow('pairing_ticket_consumed')
})

it('reconciles cancellation after local connection revocation and denies Router reads of cached evidence',async()=>{
 const a=await start(config(),fixture('parent')),b=await start(config(),fixture('child',[],true))
 await pair(a,b);a.receive('local','operator',{id:'revoke-root',thread:'request',text:'Delegate bounded work',addressed:true})
 await until(()=>b.store.list<any>('run').some(r=>r.phase==='running'))
 await a.delegation.revoke(b.delegation.identity.id)
 await until(()=>outbound(a)?.remote?.state==='cancelled')
 const trigger=a.store.triggers.get('local:revoke-root')!
 await expect(a.delegation.command({action:'inspect',id:outbound(a).id},{trigger,discussion:'local:request'})).rejects.toThrow('connection_revoked')
 expect((await a.delegation.command({action:'list'},{trigger,discussion:'local:request'}) as any).targets).toEqual([])
 expect(a.store.get<any>('delegation-connection',b.delegation.identity.id).active).toBe(false)
})

it('does not grant an unlisted management scope a remote target',async()=>{
 const a=await start(),b=await start();await pair(a,b)
 a.scopes.command({action:'scope.put',operationId:'scope',expectedRevision:0,scope:{id:'limited',tenantId:'owner',name:'Limited',managers:[JSON.stringify(['local','operator'])],workerIds:['one'],sourceIds:['local'],backendIds:['codex']}})
 a.scopes.command({action:'entry.bind',operationId:'entry',expectedRevision:0,scopeId:'limited',sourceId:'local',accountNamespace:'local',nativeId:'limited-request'})
 a.receive('local','operator',{id:'scoped',thread:'limited-request',text:'Inspect available teams',addressed:true})
 const trigger=a.store.triggers.get('local:scoped')!,scoped=a.scopes.context(trigger,'local:limited-request')!
 const context={discussion:'local:limited-request',trigger,scoped}
 const result=await a.delegation.command({action:'list'},context)
 expect((result as any).targets).toEqual([])
 await expect(a.delegation.command({action:'assign',targetId:b.delegation.identity.id,operationId:'deny',expectedRevision:a.settings.current().revision,text:'Out of scope',acceptance:'No'},context)).rejects.toThrow('enabled_target_and_contract_required')
})

it('shows the delegated Router only exported Worker profiles and its own task references',async()=>{
 const a=await start(config(),fixture('parent')),c=config()
 const hidden=configSchema.parse({...c,execution:{...c.execution,workers:[...c.execution.workers!,{id:'private',backend:'codex',prompt:'Private unexported profile'}]}})
 const base=fixture('child');let checked=false
 const b=await start(hidden,{async run(r){
  if(r.role==='router'){
   const response=await r.onTool!('worker_manage',{action:'list'},'export-only-list')
   const value=JSON.parse((response.contentItems[0] as any).text)
   expect(value.workers.map((w:any)=>w.id)).toEqual(['one'])
   expect(JSON.stringify(value)).not.toContain('Private unexported profile')
   await expect(r.onTool!('worker_manage',{action:'inspect',id:'private'},'deny-private-profile')).rejects.toThrow('worker_not_exported')
   checked=true
  }
  return base.run(r)
 }})
 await pair(a,b);a.receive('local','operator',{id:'worker-filter',thread:'request',text:'Use the exported Worker only',addressed:true})
 await until(()=>checked&&outbound(a)?.acceptance==='passed')
})

it('runs within an explicitly exported child management scope',async()=>{
 const a=await start(config(),fixture('parent')),b=await start()
 b.scopes.command({action:'scope.put',operationId:'export-scope',expectedRevision:0,scope:{id:'exported',tenantId:'owner',name:'Exported team',managers:[JSON.stringify(['delegation',a.delegation.identity.id])],workerIds:['one'],sourceIds:['delegation'],backendIds:['codex']}})
 const ticket=b.delegation.pairing({expectedRevision:b.settings.current().revision,policy:{workerIds:['one'],scopeId:'exported'}})
 await a.delegation.connect({ticket,label:'Scoped child',expectedRevision:a.settings.current().revision})
 a.receive('local','operator',{id:'scoped-child',thread:'request',text:'Delegate only within the exported scope',addressed:true})
 await until(()=>outbound(a)?.acceptance==='passed')
 const remote=b.store.list<RemoteTask>('delegation-inbound')[0]!,trigger=b.store.triggers.get(remote.triggerId)!
 expect(b.scopes.context(trigger,remote.discussion)?.route.scopeId).toBe('exported')
 expect(b.delegation.snapshot().exportScopes?.[0]?.id).toBe('exported')
})

it('reconciles a lost submit ACK without a duplicate task or Worker activation',async()=>{
 const calls:ModelRequest[]=[],a=await start(config(),fixture('parent')),b=await start(config(),fixture('child',calls))
 await pair(a,b)
 const manager=a.delegation as any,request=manager.request.bind(manager)
 let lost=false
 manager.request=async(...args:any[])=>{
  const result=await request(...args)
  if(args[1]==='submit'&&!lost){lost=true;throw new DelegationError('simulated_lost_ack')}
  return result
 }
 a.receive('local','operator',{id:'root',thread:'request',text:'Delegate and verify',addressed:true})
 await until(()=>outbound(a)?.acceptance==='passed')
 expect(lost).toBe(true);expect(b.store.list('delegation-inbound')).toHaveLength(1)
 expect(calls.filter(r=>r.role==='worker')).toHaveLength(1)
})

it('persists a cancellation tombstone before a delayed original submission',async()=>{
 const calls:ModelRequest[]=[],a=await start(),b=await start(config(),fixture('child',calls))
 await pair(a,b)
 a.pause(true)
 a.receive('local','operator',{id:'manual',thread:'manual',text:'Delegate this bounded objective',addressed:true})
 const trigger=a.store.triggers.get('local:manual')!
 // Suppress the sender pump to deliver the packets in the adverse transport order.
 const pump=a.delegation.pump;a.delegation.pump=()=>{}
 const created=await a.delegation.command({action:'assign',targetId:b.delegation.identity.id,operationId:'ordered',expectedRevision:a.settings.current().revision,text:'Check 1+1',acceptance:'2',artifacts:[]},{trigger,discussion:'local:manual'}) as any
 const task=a.store.get<OutboundTask>('delegation-outbound',created.id)!,connection=a.store.get<any>('delegation-connection',task.connectionId)
 const rpc=async(operation:string,payload:unknown)=>b.delegation.receive(packet(a.delegation.identity,b.delegation.identity.id,operation,{grantId:connection.grantId,payload})) as Promise<RemoteTask>
 expect((await rpc('cancel',{id:task.id,epoch:1,contract:task.contract})).state).toBe('cancelled')
 expect((await rpc('submit',{contract:task.contract,leaseUntil:Date.now()+2000})).state).toBe('cancelled')
 expect(b.store.tickets.list()).toHaveLength(0);expect(calls).toHaveLength(0)
 a.delegation.pump=pump
})

it('does not let a fresh pairing retrieve a retained task from an earlier grant through duplicate submit',async()=>{
 const calls:ModelRequest[]=[],a=await start(),b=await start(config(),fixture('child',calls))
 a.pause(true);b.pause(true);await pair(a,b)
 a.delegation.pump=()=>{}
 a.receive('local','operator',{id:'grant-history',thread:'manual',text:'Delegate this bounded objective',addressed:true})
 const trigger=a.store.triggers.get('local:grant-history')!
 const created=await a.delegation.command({action:'assign',targetId:b.delegation.identity.id,operationId:'retained-task',expectedRevision:a.settings.current().revision,text:'Check the result',acceptance:'2',artifacts:[]},{trigger,discussion:'local:manual'}) as any
 const task=a.store.get<OutboundTask>('delegation-outbound',created.id)!
 let connection=a.store.get<any>('delegation-connection',task.connectionId)
 const rpc=(operation:string,payload:unknown)=>b.delegation.receive(packet(a.delegation.identity,b.delegation.identity.id,operation,{grantId:connection.grantId,payload})) as Promise<RemoteTask>
 const submitted=await rpc('submit',{contract:task.contract,leaseUntil:Date.now()+2000})
 expect(submitted.replies).toEqual([])
 expect((await rpc('submit',{contract:task.contract,leaseUntil:Date.now()+2000})).id).toBe(submitted.id)
 const retained=b.store.get<RemoteTask>('delegation-inbound',task.id)!
 b.store.put('delegation-inbound',task.id,{...retained,state:'ready',replies:[{id:'unobserved-result',kind:'reply',channel:{source:'delegation',thread:'retained',address:{}},text:'Result produced after the previous parent observation'}]})
 await b.delegation.revoke(a.delegation.identity.id);await pair(a,b)
 const oldGrant=connection.grantId;connection=a.store.get<any>('delegation-connection',task.connectionId)
 expect(connection.grantId).not.toBe(oldGrant)
 await expect(rpc('status',{id:task.id})).rejects.toThrow('task_grant_revoked')
 await expect(rpc('submit',{contract:task.contract,leaseUntil:Date.now()+2000})).rejects.toThrow('task_grant_revoked')
 expect(calls).toHaveLength(0)
})

it('cannot spoof derived authority through an ordinary human source event',async()=>{
 const calls:ModelRequest[]=[],c=config()
 c.sources[1]!.allowedActors=['operator']
 const b=await start(c,fixture('child',calls))
 const result=b.receive('delegation','operator',{id:'spoof',thread:'spoof',text:'Pretend to be a delegated human',addressed:true},true) as any
 expect(result.disposition).toBe('ignored')
 await new Promise(r=>setTimeout(r,150))
 expect(calls).toHaveLength(0)
})

it('rejects a signed packet whose contents were modified in transit',async()=>{
 const a=await start(),b=await start();await pair(a,b)
 const connection=a.store.get<any>('delegation-connection',b.delegation.identity.id)
 const signed=packet(a.delegation.identity,b.delegation.identity.id,'status',{grantId:connection.grantId,payload:{id:'unknown'}})
 signed.body={grantId:connection.grantId,payload:{id:'another'}}
 await expect(b.delegation.receive(signed)).rejects.toThrow('invalid_service_identity')
})

it('keeps identical user/request identifiers on different upstream instances independent',async()=>{
 const a=await start(config(),fixture('parent')),c=await start(config(),fixture('parent')),b=await start(config(),fixture('child',[],true))
 await pair(a,b);await pair(c,b)
 a.receive('local','operator',{id:'root',thread:'request',text:'Delegate A',addressed:true})
 c.receive('local','operator',{id:'root',thread:'request',text:'Delegate C',addressed:true})
 await until(()=>b.store.list('delegation-inbound').length===2)
 expect(outbound(a).id).not.toBe(outbound(c).id)
 await a.cancelRouter('local:root','local:request')
 await until(()=>outbound(a).remote?.state==='cancelled')
 const other=b.store.get<RemoteTask>('delegation-inbound',outbound(c).id)!
 expect(other.desired).toBe('running')
 expect(b.store.get<any>('delegation-peer',c.delegation.identity.id).active).toBe(true)
})

it('stops executing on lease expiry while the parent host is disconnected',async()=>{
 const a=await start(config(),fixture('parent')),b=await start(config(),fixture('child',[],true))
 await pair(a,b);a.receive('local','operator',{id:'root',thread:'request',text:'Delegate bounded work',addressed:true})
 await until(()=>b.store.list<any>('run').some(r=>r.phase==='running'))
 const parentServer=servers.find(s=>s.runtime===a)!
 parentServer.server.closeAllConnections();await new Promise<void>(r=>parentServer.server.close(()=>r()));await parentServer.closeRuntime()
 await until(()=>b.store.list<RemoteTask>('delegation-inbound')[0]?.state==='cancelled',4500)
 expect(b.store.tickets.list().every(t=>!!t.ended)).toBe(true)
},10000)

it('reconciles an expired lease after transport recovery and acknowledges a later cancellation epoch',async()=>{
 const base=fixture('parent'),calls:ModelRequest[]=[]
 const a=await start(config(),{async run(r){
  const input=JSON.parse(r.input)
  if(input.kind==='team_result')return {threadId:r.threadId??'expired-parent',turnId:'expired-observation',text:JSON.stringify({reply:'Remote work stopped after lease expiry.'})}
  return base.run(r)
 }}),b=await start(config(),fixture('child',calls,true))
 await pair(a,b);a.receive('local','operator',{id:'lease-recovery',thread:'request',text:'Delegate bounded work',addressed:true})
 await until(()=>b.store.list<any>('run').some(r=>r.phase==='running'))
 const pump=a.delegation.pump.bind(a.delegation);a.delegation.pump=()=>{}
 await until(()=>b.store.list<RemoteTask>('delegation-inbound')[0]?.state==='cancelled',4500)
 a.delegation.pump=pump;pump()
 await until(()=>outbound(a)?.remote?.state==='cancelled')
 await a.delegation.command({action:'cancel',id:outbound(a).id,operationId:'cancel-after-expiry',expectedRevision:a.settings.current().revision})
 await until(()=>a.delegation.snapshot().outbound[0]?.controlConfirmed===true)
 expect(calls.filter(r=>r.role==='worker')).toHaveLength(1)
 expect(outbound(a).acceptance).toBe('pending')
},10000)

it('preserves identity, paired grants and the service port across a host restart',async()=>{
 const a=await start(),b=await start();await pair(a,b)
 const identity=b.delegation.identity.id,endpoint=b.delegation.endpoint
 const server=servers.find(s=>s.runtime===b)!
 server.server.closeAllConnections();await new Promise<void>(r=>server.server.close(()=>r()));await server.closeRuntime()
 const restarted=await start(b.config)
 expect(restarted.delegation.identity.id).toBe(identity)
 expect(restarted.delegation.endpoint).toBe(endpoint)
 expect(restarted.store.get<any>('delegation-peer',a.delegation.identity.id).active).toBe(true)
 expect(restarted.store.db.prepare('PRAGMA user_version').get()!.user_version).toBe(10)
})

it('backs up the pinned identity and quarantines restored grants until explicit recovery',async()=>{
 const a=await start(),b=await start();await pair(a,b)
 const backup=join(a.config.stateDir,'identity-backup')
 const server=servers.find(s=>s.runtime===a)!
 server.server.closeAllConnections();await new Promise<void>(r=>server.server.close(()=>r()));await server.closeRuntime()
 await backupState(a.config,backup)
 expect(verifyBackup(backup).delegationIdentity).toMatch(/^[a-f0-9]{64}$/)
 await restoreState(a.config,backup)
 const restored=await start(a.config)
 expect(restored.delegation.enabled).toBe(false)
 expect(restored.delegation.snapshot().recoveryRequired).toBe(true)
 const snapshot=restored.delegation.snapshot()
 await expect(restored.delegation.recover({fingerprint:'wrong',expectedRevision:snapshot.revision,originalStopped:true})).rejects.toThrow('recovery_plan_changed')
 await restored.delegation.recover({fingerprint:snapshot.recoveryFingerprint,expectedRevision:snapshot.revision,originalStopped:true})
 expect(restored.delegation.snapshot().connections.every(c=>!c.active)).toBe(true)
 expect(restored.delegation.snapshot().recoveryRequired).toBe(false)
})

it('cannot export host identity even when a broad source directory contains the private state',async()=>{
 const quiet:Model={async run(r){return {threadId:'quiet',turnId:'quiet-turn',text:JSON.stringify({reply:''})}}}
 const a=await start(config(),quiet),c=config()
 c.sources[1]!.cwd=join(c.stateDir,'..')
 const base=fixture('child');let denied=false
 const b=await start(c,{async run(r){
  if(r.role!=='worker')return base.run(r)
  r.onThread?.('artifact-denial');r.onTurn?.('artifact-denial-turn')
  await expect(r.onTool!('superagent_artifact',{path:'state/delegation-identity.json'},'private-read')).rejects.toThrow('artifact_private_state')
  denied=true
  return {threadId:'artifact-denial',turnId:'artifact-denial-turn',text:JSON.stringify(report)}
 }})
 await pair(a,b);a.receive('local','operator',{id:'private-test',thread:'private-test',text:'Exercise a private-state export denial',addressed:true})
 const trigger=a.store.triggers.get('local:private-test')!
 await a.delegation.command({action:'assign',targetId:b.delegation.identity.id,operationId:'deny-private',expectedRevision:a.settings.current().revision,text:'Read only the allowed fixture',acceptance:'Private state must remain inaccessible',artifacts:['state/delegation-identity.json']},{trigger,discussion:'local:private-test'})
 await until(()=>denied&&b.store.list<RemoteTask>('delegation-inbound')[0]?.state==='blocked')
 expect(b.store.list<RemoteTask>('delegation-inbound')[0]!.artifacts).toEqual([])
})

it('does not submit new delegated work while the parent scheduler is paused',async()=>{
 const a=await start(),b=await start();await pair(a,b)
 a.pause(true);a.receive('local','operator',{id:'paused',thread:'paused',text:'Queue a bounded delegation',addressed:true})
 const trigger=a.store.triggers.get('local:paused')!
 await a.delegation.command({action:'assign',targetId:b.delegation.identity.id,operationId:'pause-intake',expectedRevision:a.settings.current().revision,text:'Check the fixture',acceptance:'2',artifacts:[]},{trigger,discussion:'local:paused'})
 await new Promise(r=>setTimeout(r,250))
 expect(b.store.list('delegation-inbound')).toHaveLength(0)
 expect(outbound(a).state).toBe('pending')
})

async function manuallySubmitted(){
 const ac=config(),bc=config();ac.work.network=true;bc.work.network=true;bc.sources.find(s=>s.id==='delegation')!.sandbox='workspace-write'
 const a=await start(ac),b=await start(bc);a.pause(true);b.pause(true)
 const pumpA=a.delegation.pump.bind(a.delegation),pumpB=b.delegation.pump.bind(b.delegation)
 a.delegation.pump=()=>{};b.delegation.pump=()=>{}
 const ticket=b.delegation.pairing({expectedRevision:b.settings.current().revision,policy:{workerIds:['one'],permissions:{write:true,shell:true,network:true,subagents:true}}})
 await a.delegation.connect({ticket,label:'Bounded team',expectedRevision:a.settings.current().revision})
 a.receive('local','operator',{id:'manual',thread:'manual',text:'Delegate this bounded objective',addressed:true})
 const trigger=a.store.triggers.get('local:manual')!
 const created=await a.delegation.command({action:'assign',targetId:b.delegation.identity.id,operationId:'manual',expectedRevision:a.settings.current().revision,text:'Read declared file',acceptance:'Return actual evidence',artifacts:[]},{trigger,discussion:'local:manual'}) as any
 const task=a.store.get<OutboundTask>('delegation-outbound',created.id)!,connection=a.store.get<any>('delegation-connection',task.connectionId)
 const rpc=(operation:string,payload:unknown)=>b.delegation.receive(packet(a.delegation.identity,b.delegation.identity.id,operation,{grantId:connection.grantId,payload})) as Promise<RemoteTask>
 await rpc('submit',{contract:task.contract,leaseUntil:Date.now()+2000})
 return {a,b,task,rpc,pumpA,pumpB}
}
it('durably rejects lease revival before an expiry sweep has run',async()=>{
 const f=await manuallySubmitted(),t=f.b.store.get<RemoteTask>('delegation-inbound',f.task.id)!
 f.b.store.put('delegation-inbound',t.id,{...t,leaseUntil:Date.now()-1})
 await expect(f.rpc('lease',{id:t.id,epoch:t.controlEpoch,leaseUntil:Date.now()+2000})).rejects.toThrow('execution_stopped')
 expect(f.b.store.get<RemoteTask>('delegation-inbound',t.id)).toMatchObject({state:'cancelled',desired:'cancelled',reason:'authorization_expired'})
 expect(()=>f.b.delegation.authority(t.triggerId)).toThrow('delegation_authority_expired')
})
it('fences inbound expiry while an unrelated outbound RPC pump is pending',async()=>{
 const f=await manuallySubmitted(),t=f.b.store.get<RemoteTask>('delegation-inbound',f.task.id)!
 f.b.store.put('delegation-inbound',t.id,{...t,leaseUntil:Date.now()-1})
 let release!:()=>void;const held=new Promise<void>(r=>release=r)
 ;(f.b.delegation as any).pending=held
 try{f.pumpB();await until(()=>f.b.store.get<RemoteTask>('delegation-inbound',t.id)?.state==='cancelled')}
 finally{release();(f.b.delegation as any).pending=undefined}
})
it.each(['source-write','network','target-write','target-budget'] as const)('cancels broader remote authority after %s is reduced',async(kind)=>{
 const f=await manuallySubmitted();expect(f.task.contract.permissions).toMatchObject({write:true,network:true})
 if(kind==='source-write')f.a.config.sources.find(s=>s.id==='local')!.sandbox='read-only'
 if(kind==='network')f.a.config.work.network=false
 const target=f.a.config.execution.teamTargets!.find(t=>t.id===f.task.targetId)!
 if(kind==='target-write')target.permissions.write=false
 if(kind==='target-budget')target.limits.maxActivations=2
 expect(()=>f.a.delegation.parent(f.task)).toThrow(/delegation_(permissions|limits)_reduced/)
 f.pumpA();await until(()=>f.b.store.get<RemoteTask>('delegation-inbound',f.task.id)?.state==='cancelled')
 expect(f.a.store.get<OutboundTask>('delegation-outbound',f.task.id)?.desired).toBe('cancelled')
})

it.each(['network','cancel','revoke'] as const)('does not renew after %s changes during a status request',async(change)=>{
 const f=await manuallySubmitted(),manager=f.a.delegation as any,request=manager.request.bind(manager),operations:string[]=[]
 f.a.store.put('delegation-outbound',f.task.id,{...f.task,state:'reconcile_required'})
 let changed=false
 manager.request=async(...args:any[])=>{
  operations.push(args[1]);const result=await request(...args)
  if(args[1]==='status'&&!changed){changed=true
   if(change==='network')f.a.config.work.network=false
   if(change==='cancel')f.a.delegation.cancelWhere(t=>t.id===f.task.id)
   if(change==='revoke')await f.a.delegation.revoke(f.task.connectionId)
  }
  return result
 }
 f.pumpA();await until(()=>f.b.store.get<RemoteTask>('delegation-inbound',f.task.id)?.state==='cancelled')
 expect(changed).toBe(true);expect(operations).not.toContain('lease');expect(operations).not.toContain('submit')
 expect(f.a.store.get<OutboundTask>('delegation-outbound',f.task.id)?.desired).toBe('cancelled')
})
it('does not restore an outbound body deleted while its remote response is in flight',async()=>{
 const f=await manuallySubmitted(),manager=f.a.delegation as any,request=manager.request.bind(manager)
 f.a.store.put('delegation-outbound',f.task.id,{...f.task,state:'reconcile_required'})
 manager.request=async(...args:any[])=>{const result=await request(...args);f.a.store.put('delegation-outbound',f.task.id,{id:f.task.id,deleted:true});return result}
 f.pumpA();await until(()=>f.a.store.get<any>('delegation-outbound',f.task.id)?.deleted===true)
 await until(()=>!manager.pending)
 expect(f.a.store.get('delegation-outbound',f.task.id)).toEqual({id:f.task.id,deleted:true})
 expect(f.a.delegation.snapshot().outbound).toHaveLength(0)
})

it('keeps only cancellation reconciliation if a connection is revoked while a lease fails',async()=>{
 const f=await manuallySubmitted(),manager=f.a.delegation as any,request=manager.request.bind(manager),operations:string[]=[]
 f.a.store.put('delegation-outbound',f.task.id,{...f.task,state:'acknowledged',remote:f.b.store.get('delegation-inbound',f.task.id)})
 manager.request=async(...args:any[])=>{
  operations.push(args[1])
  if(args[1]==='lease'){await f.a.delegation.revoke(f.task.connectionId);throw new DelegationError('execution_stopped',409)}
  return request(...args)
 }
 f.pumpA();await until(()=>f.b.store.get<RemoteTask>('delegation-inbound',f.task.id)?.state==='cancelled')
 expect(operations).toEqual(['lease','cancel'])
})
