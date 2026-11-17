import {mkdtempSync,rmSync,readFileSync,appendFileSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {afterEach,expect,it,vi} from 'vitest'
import {Runtime} from '../src/runtime.ts'
import {configSchema} from '../src/config.ts'
import {OperatorAttention} from '../src/operator-attention.ts'
import {Approvals,type Approval} from '../src/approvals.ts'
import {serve} from '../src/server.ts'
import {stableDigest} from '../src/sources.ts'
import type {Ticket} from '../src/vendor/dsh-core/index.ts'
import type {Run} from '../src/store.ts'
import type {RouterGoal} from '../src/router-goals.ts'
import type {WorkflowAction} from '../src/workflow-actions.ts'
import type {ScopeContext} from '../src/router-scope.ts'
import type {Trigger} from '../src/vendor/dsh-core/index.ts'
import type {ScheduledRun} from '../src/router-proactive.ts'
import {packet,publicIdentity,readIdentity} from '../src/delegation/identity.ts'

const roots:string[]=[],hosts:Runtime[]=[],servers:Awaited<ReturnType<typeof serve>>[]=[]
afterEach(async()=>{vi.restoreAllMocks();for(const server of servers.splice(0)){await server.closeRuntime();await new Promise<void>(r=>server.server.close(()=>r()))}for(const host of hosts.splice(0))if(!(host as any).closing)await host.close();for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true})})
function fixture(delegated=false){
 const root=mkdtempSync(join(tmpdir(),'operator-attention-'));roots.push(root)
 const config=configSchema.parse({stateDir:join(root,'state'),port:0,...(delegated?{delegation:{enabled:true}}:{}),acceptMode:'auto',work:{sandboxDriver:'disabled',autoRecover:false},execution:{router:{mode:'host'},management:{enabled:true,maxWorkers:2},workers:[{id:'one',backend:'codex'},{id:'two',backend:'codex'}]},sources:[{id:'local',kind:'local',cwd:root,workspace:{mode:'source'},allowedActors:['alice']},...(delegated?[{id:'delegation',kind:'delegation',cwd:root,sandbox:'read-only',workspace:{mode:'directory'}}]:[])]})
 const model={describe:()=>({id:'codex',kind:'codex',resume:true,images:false,nativeTakeover:false,tools:true,steering:false,promptRefresh:false}),history:vi.fn(async()=>({turns:[]})),run:vi.fn(async()=>{throw Error('No inference is permitted in this fixture')})}
 const host=new Runtime(config,{model});hosts.push(host)
 host.scopes.command({action:'scope.put',operationId:'scope',expectedRevision:0,scope:{id:'team',tenantId:'org',name:'Team',contextBytes:128000,managers:[JSON.stringify(['local','alice'])],workerIds:['one','two'],sourceIds:config.sources.map(source=>source.id),backendIds:['codex']}})
 host.scopes.command({action:'entry.bind',operationId:'entry',expectedRevision:0,scopeId:'team',sourceId:'local',accountNamespace:'local',nativeId:'topic',history:'group'})
 const {triggerId}=host.receive('local','alice',{id:'request',thread:'topic',scope:'topic',text:'Continuously produce and verify the requested result. Never deploy.',addressed:true}) as {triggerId:string}
 const trigger=host.store.triggers.get(triggerId)!,context=host.scopes.context(trigger,'local:topic')!
 const projection=new OperatorAttention(()=>host)
 const deliver=vi.spyOn(host.sources.get('local')!,'deliver')
 return {host,root,context,trigger,projection,model,deliver}
}
async function task(f:ReturnType<typeof fixture>,key='task',anchor?:{trigger:Trigger;context:ScopeContext}){
 const trigger=anchor?.trigger??f.trigger,context=anchor?.context??f.context
 const result=await f.host.manager.call({action:'assign',id:'one',revision:f.host.settings.current().revision,requestId:key,text:'SECRET_PROMPT'}, {discussion:context.route.discussion,trigger,scoped:context})
 const ticket=f.host.store.tickets.get(result.ticketId)!,assignment=ticket.assignments.at(-1)!
 f.host.engine.assignmentStarted(ticket.id,assignment.id)
 f.host.store.put('run',ticket.id,{ticketId:ticket.id,assignmentId:assignment.id,cwd:f.root,phase:'human',threadId:'session',turnId:'turn',backendId:'codex',workerId:'one'} satisfies Run)
 return f.host.store.tickets.get(ticket.id)!
}
function dbState(f:ReturnType<typeof fixture>){
 const state:Record<string,unknown>={}
 for(const row of f.host.store.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()){
  const name=String(row.name);if(/^[a-z_0-9]+$/.test(name))state[name]=f.host.store.db.prepare('SELECT * FROM '+name).all()
 }
 return JSON.stringify(state,(_,v)=>typeof v==='bigint'?String(v):v instanceof Uint8Array?Array.from(v):v)
}
function approval(f:ReturnType<typeof fixture>,ticket:Ticket,method='item/commandExecution/requestApproval',params:Record<string,unknown>={}){
 const promise=f.host.approvals.request(ticket.id,{id:'SECRET_NATIVE_ID',method,params:{threadId:'session',turnId:'turn',command:'SECRET_COMMAND',...params}})
 void promise.catch(()=>{})
 const item=f.host.store.list<Approval>('approval').at(-1)!
 // The core's monotonic clock may be a few milliseconds ahead of wall time.
 const createdAt=Math.max(item.createdAt,Date.parse(ticket.assignments.at(-1)!.startedAt!)+1)
 f.host.store.put('approval',item.id,{...item,createdAt})
 return {...item,createdAt}
}
function liveWaiters(f:ReturnType<typeof fixture>){
 const map=(f.host.approvals as unknown as {pending:Map<string,unknown>}).pending
 return {map,entries:new Map(map)}
}
function expectWaitersUnchanged(f:ReturnType<typeof fixture>,before:ReturnType<typeof liveWaiters>){
 const map=(f.host.approvals as unknown as {pending:Map<string,unknown>}).pending
 expect(map).toBe(before.map);expect([...map.keys()]).toEqual([...before.entries.keys()])
 for(const [id,waiter] of before.entries)expect(map.get(id)).toBe(waiter)
}
function at(f:ReturnType<typeof fixture>){return Math.max(Date.now(),...f.host.store.list<Approval>('approval').map(a=>a.createdAt))+2}
function question(f:ReturnType<typeof fixture>,ticket:Ticket){f.host.engine.report(ticket.id,{state:'blocked',summary:'SECRET_REPORT',question:'SECRET_QUESTION'});return f.host.store.tickets.get(ticket.id)!}
function workflow(f:ReturnType<typeof fixture>,ticket:Ticket){
 const owner=f.host.scopes.ownership(ticket.id)!,entry=f.host.scopes.binding(owner.originEntry)
 const item:WorkflowAction={id:'workflow-1',ticketId:ticket.id,originTriggerId:f.trigger.id,notificationTriggerId:f.trigger.id,sourceId:'local',target:{key:'SECRET_TARGET',entryId:entry.id,teamId:'topic',issueId:'SECRET_ISSUE'},entryRevision:entry.revision,ownerEpoch:owner.ownerEpoch,dataRevision:owner.dataRevision??1,view:{account:'SECRET_ACCOUNT',issue:'SECRET_ISSUE',label:'SECRET_LABEL',revision:'v1',current:{id:'todo',name:'SECRET_STATUS'},states:[]},next:{id:'done',name:'SECRET_STATUS'},state:'pending',at:Date.now()}
 f.host.config.sources[0]!.options.statusTargets=[item.target];f.host.config.sources[0]!.capabilities.resources=true;f.host.sources.get('local')!.applyWorkflowState=vi.fn(async()=>{throw Error('No provider calls permitted')});f.host.store.put('workflow-action',item.id,item);return item
}
function projectReview(f:ReturnType<typeof fixture>,ticket:Ticket){
 const goal=f.host.goals.command({action:'start',operationId:'goal',expectedRevision:0,title:'SECRET_TITLE',objective:'Produce a result',authorizationQuote:'Continuously produce and verify',criteria:[{id:'result',description:'Produce a result',files:[],documents:[]}],nodes:[{id:'build',title:'Build',instruction:'Produce a result',workerId:'one',criterionIds:['result']}]},f.context) as RouterGoal
 goal.taskIds=[ticket.id];goal.nodes![0]!.ticketId=ticket.id;goal.state='needs_input'
 goal.project={base:'main',sourceId:'local',integration:'SECRET_PATH',policy:{} as any,reviewWaitMs:1000,triggerIds:[f.trigger.id],review:{id:'review-1',head:'SECRET_HASH',roundId:'missing-round',deliveryId:'delivery-1',at:Date.now(),state:'pending'}}
 f.host.store.put('router-goal',goal.id,goal);f.host.store.put('project-review',goal.project.review!.id,{goalId:goal.id,...goal.project.review});return goal
}

it('counts two permissions, a question, acceptance review and unknown effect as five independent matters',async()=>{
 const f=fixture(),ticket=question(f,await task(f)),one=approval(f,ticket),two=approval(f,ticket,'item/permissions/requestApproval');projectReview(f,ticket)
 f.host.store.outbox.send({id:'unknown-message',ticketId:ticket.id,kind:'reply',text:'SECRET_MESSAGE',channel:{source:'local',thread:'topic',address:{thread:'topic'}}})
 f.host.store.db.prepare("UPDATE outbox SET status='uncertain',error='SECRET_RESPONSE' WHERE id='unknown-message'").run()
 const before=dbState(f),pending=liveWaiters(f),result=f.projection.snapshot(0,25,at(f))
 expect(result).toMatchObject({schema:1,readOnly:true,total:5,more:false})
 expect(result.items.filter(r=>r.kind==='native_approval')).toHaveLength(2)
 expect(result.items.filter(r=>r.state==='waiting_permission')).toHaveLength(2)
 expect(result.items.find(r=>r.kind==='task_question')?.state).toBe('needs_reply')
 expect(result.items.find(r=>r.kind==='project_review')?.state).toBe('stale')
 expect(result.items.find(r=>r.kind==='effect_unknown')?.next).toEqual({kind:'records',id:ticket.id})
 expect(f.host.approvals.hasLiveRequest(one.id,at(f))).toBe(true);expect(f.host.approvals.hasLiveRequest(two.id,at(f))).toBe(true)
 expect(f.projection.snapshot(0,25,at(f)).items.map(r=>r.id)).toEqual(result.items.map(r=>r.id))
 expect(dbState(f)).toBe(before);expectWaitersUnchanged(f,pending)
 expect(f.model.run).not.toHaveBeenCalled();expect(f.model.history).not.toHaveBeenCalled();expect(f.deliver).not.toHaveBeenCalled()
 const json=JSON.stringify(result);expect(json).not.toContain('SECRET');expect(json).not.toContain('params');expect(json).not.toContain('command');expect(json).not.toContain('approve')
})
it('returns actual times or null and an observed fingerprint, never a new deadline or token',async()=>{
 const f=fixture(),ticket=question(f,await task(f)),item=approval(f,ticket)
 const rows=f.projection.snapshot(0,25,at(f)).items
 expect(rows.find(r=>r.kind==='native_approval')).toMatchObject({createdAt:item.createdAt,expiresAt:item.expiresAt,sourceLabel:'Local operator'})
 expect(rows.find(r=>r.kind==='task_question')).toMatchObject({createdAt:null,expiresAt:null})
 expect(rows.every(r=>/^[a-f0-9]{64}$/.test(r.observed))).toBe(true)
 expect(f.projection.snapshot(0,1,at(f))).toMatchObject({total:2,offset:0,limit:1,more:true})
 expect(f.projection.snapshot(2,1,at(f))).toMatchObject({total:2,items:[],more:false})
})
it('observes an expired live waiter without expiring it or changing the pending map/database',async()=>{
 const f=fixture(),ticket=await task(f),item=approval(f,ticket),before=dbState(f),pending=liveWaiters(f)
 expect(f.host.approvals.hasLiveRequest(item.id,item.expiresAt)).toBe(false)
 expect(f.projection.snapshot(0,25,item.expiresAt).items[0]).toMatchObject({state:'expired',expiresAt:item.expiresAt})
 expect(f.host.store.get<Approval>('approval',item.id)?.status).toBe('pending')
 expectWaitersUnchanged(f,pending);expect(dbState(f)).toBe(before)
})
it('never revives a persisted pending approval after restart and preserves existing startup expiry behavior',async()=>{
 const f=fixture(),ticket=await task(f),item=approval(f,ticket),restarted=new Approvals(f.host.store),before=dbState(f)
 expect(restarted.hasLiveRequest(item.id,at(f))).toBe(false)
 expect(f.host.store.get<Approval>('approval',item.id)?.status).toBe('expired')
 expect(f.projection.snapshot(0,25,at(f)).items[0]?.state).toBe('expired')
 expect(dbState(f)).toBe(before)
})
it.each(['unknown/method','acp/permission'])('keeps %s view-only even when the host owns a live Promise',async method=>{
 const f=fixture(),ticket=await task(f),nativeExpiry=Date.now()+1000,item=approval(f,ticket,method,{sessionId:'SECRET_SESSION',requestId:'SECRET_REQUEST',expiresAt:nativeExpiry,options:[{id:'SECRET_OPTION',kind:'allow_once'}]})
 const before=dbState(f),row=f.projection.snapshot(0,25,at(f)).items[0]!
 expect(row.state).toBe('unavailable');expect(row.next).toEqual({kind:'task',id:ticket.id})
 expect(row.expiresAt).toBe(method==='acp/permission'?Math.min(item.expiresAt,nativeExpiry):item.expiresAt)
 expect(JSON.stringify(row)).not.toContain('SECRET');expect(dbState(f)).toBe(before)
})
it('rejects malformed approval metadata in the pure liveness query',async()=>{
 const f=fixture(),ticket=await task(f),item=approval(f,ticket)
 for(const expiresAt of [undefined,'SECRET_DEADLINE',Infinity,-1]){
  f.host.store.put('approval',item.id,{...item,expiresAt});const before=dbState(f)
  expect(f.host.approvals.hasLiveRequest(item.id,at(f))).toBe(false);expect(dbState(f)).toBe(before)
 }
 f.host.store.put('approval',item.id,{...item,createdAt:-1});expect(f.host.approvals.hasLiveRequest(item.id,Date.now())).toBe(false)
 expect(f.host.approvals.hasLiveRequest('missing')).toBe(false);expect(f.host.approvals.hasLiveRequest(item.id,NaN)).toBe(false)
})
it('does not attribute a prior native waiter to the new assignment or a different session/turn',async()=>{
 const f=fixture(),ticket=await task(f);approval(f,ticket)
 const original=f.host.store.get<Run>('run',ticket.id)!
 for(const change of [{assignmentId:'new-assignment'},{threadId:'new-session'},{turnId:'new-turn'},{phase:'idle'}]){
  f.host.store.put('run',ticket.id,{...original,...change})
  expect(f.projection.snapshot(0,25,at(f)).items[0]?.state).toBe('unavailable')
 }
 f.host.store.put('ticket',ticket.id,{...ticket,assignments:[...ticket.assignments,{id:'new-assignment',state:'pending',createdAt:new Date().toISOString()}]})
 f.host.store.put('run',ticket.id,{...original,assignmentId:'new-assignment'})
 expect(f.projection.snapshot(0,25,at(f)).items[0]?.state).toBe('unavailable')
})
it('retains unknown effects when a task stops and never resurrects its question or approval',async()=>{
 const f=fixture(),ticket=question(f,await task(f));approval(f,ticket)
 f.host.store.put('tool-receipt','old-unknown',{ticketId:ticket.id,assignmentId:'old-assignment',state:'uncertain',args:{secret:'SECRET_ARGUMENT'},result:'SECRET_RESPONSE'})
 await f.host.stop(ticket.id)
 const before=dbState(f),result=f.projection.snapshot()
 expect(result.total).toBe(1);expect(result.items[0]).toMatchObject({kind:'effect_unknown',state:'outcome_unknown',next:{kind:'records',id:ticket.id}})
 expect(dbState(f)).toBe(before);expect(JSON.stringify(result)).not.toContain('SECRET')
})
it('omits current questions on a cancelled Router while retaining unknown effects without execution authority',async()=>{
 const f=fixture(),ticket=question(f,await task(f));approval(f,ticket)
 f.host.store.put('router-cancelled',f.trigger.id,{at:Date.now()})
 f.host.store.put('tool-receipt','unknown',{ticketId:ticket.id,state:'uncertain'})
 const before=dbState(f),result=f.projection.snapshot()
 expect(result.items.map(r=>r.kind)).toEqual(['effect_unknown']);expect(dbState(f)).toBe(before)
})
it.each(['disabled','actor-revoked','private','entry-unavailable','member-revoked','channel-revoked','missing-route','stale-binding','stale-epoch','owner-held','changed-router'])('fails closed for %s without repairing existing facts',async reason=>{
 const f=fixture(),ticket=question(f,await task(f)),owner=f.host.scopes.ownership(ticket.id)!,entry=f.host.scopes.binding(owner.originEntry)
 if(reason==='disabled')f.host.config.sources[0]!.enabled=false
 if(reason==='actor-revoked')f.host.config.sources[0]!.allowedActors=[]
 if(reason==='private')f.host.store.put('entry-binding',entry.id,{...entry,privateActor:'alice'})
 if(reason==='entry-unavailable')f.host.store.put('source-entry-state',entry.id,{available:false})
 if(reason==='member-revoked')f.host.store.put('source-member-state',stableDigest([entry.id,'alice']),{available:false})
 if(reason==='channel-revoked'){const key=stableDigest([ticket.id,entry.id]);f.host.store.put('task-channel',key,{...f.host.store.get<any>('task-channel',key),active:false})}
 if(reason==='missing-route')f.host.store.db.prepare("DELETE FROM records WHERE kind='router-route' AND id=?").run(f.trigger.id)
 if(reason==='stale-binding')f.host.store.put('entry-binding',entry.id,{...entry,revision:entry.revision+1})
 if(reason==='stale-epoch')f.host.store.put('tenant-epoch',entry.tenantId,f.host.scopes.epoch(entry.tenantId)+1)
 if(reason==='owner-held')f.host.store.put('task-ownership',ticket.id,{...owner,state:'held'})
 if(reason==='changed-router')f.host.store.put('task-ownership',ticket.id,{...owner,routerId:'other-router'})
 const before=dbState(f);expect(f.projection.snapshot().total).toBe(0);expect(dbState(f)).toBe(before);expect(f.deliver).not.toHaveBeenCalled()
})
it('does not reconcile an unsynchronized revocation ledger or expose its existing facts',async()=>{
 const f=fixture();question(f,await task(f))
 const body={seq:1,previous:'',tenantId:'org',scopeId:'team',action:'forget',generation:0,id:'absent-fact',at:Date.now()}
 appendFileSync(join(f.host.config.stateDir,'memory-revocations.jsonl'),JSON.stringify({...body,hash:stableDigest(body)})+'\n')
 const before=dbState(f);expect(()=>f.projection.snapshot()).toThrow('Memory reconciliation is required');expect(dbState(f)).toBe(before)
})
it('shows workflow reviews only for the current visible target and marks old ownership/data revisions stale',async()=>{
 const f=fixture(),ticket=await task(f),item=workflow(f,ticket),before=dbState(f)
 expect(f.projection.snapshot().items[0]).toMatchObject({kind:'workflow_review',state:'needs_review',next:{kind:'workflow',id:item.id}});expect(dbState(f)).toBe(before)
 for(const mismatch of [{ownerEpoch:0},{dataRevision:0},{entryRevision:0}]){
  f.host.store.put('workflow-action',item.id,{...item,...mismatch})
  expect(f.projection.snapshot().items[0]?.state).toBe('stale')
 }
 const oldId=f.projection.snapshot().items[0]!.id
 f.host.store.put('workflow-action',item.id,{...item,state:'uncertain'});expect(f.projection.snapshot().items[0]!.id).toBe(oldId);expect(f.projection.snapshot().items[0]).toMatchObject({kind:'effect_unknown',state:'outcome_unknown',next:{kind:'workflow',id:item.id}})
 f.host.store.put('entry-binding',item.target.entryId,{...f.host.scopes.binding(item.target.entryId),privateActor:'alice'});expect(f.projection.snapshot().total).toBe(0)
})
it('does not expose copied question content after an existing task continuation quarantines it',async()=>{
 const f=fixture(),ticket=question(f,await task(f))
 f.host.store.put('task-continuation',ticket.id,{ticketId:ticket.id,triggerId:f.trigger.id,discussion:'local:topic',text:'SECRET_NEW_PROMPT',at:Date.now(),inputIds:[],priorAssignments:[],priorReports:[],priorJobs:[],priorMessages:[],priorToolCalls:[],workspaceReviewed:true})
 expect(f.projection.snapshot().total).toBe(0)
})
it('never copies untrusted source labels, IM URLs, provider errors or native request bodies into the DTO',async()=>{
 const f=fixture(),ticket=question(f,await task(f));approval(f,ticket)
 const trigger=f.host.store.triggers.get(f.trigger.id)!
 f.host.store.put('entry-label','local',{location:'SECRET_LOCATION',url:'https://unverified.example/channel'})
 f.host.store.put('trigger',trigger.id,{...trigger,meta:{...trigger.meta,url:'https://unverified.example/channel',token:'SECRET_TOKEN'}})
 const json=JSON.stringify(f.projection.snapshot(0,25,at(f)))
 expect(json).not.toMatch(/SECRET|unverified|https:|prompt|params|command|requestId|token/)
})
it('enforces current operator GET-only access, bounded pagination, fixed failure and zero database changes over HTTP',async()=>{
 const f=fixture();question(f,await task(f));f.host.pause(true)
 const server=await serve(f.host);servers.push(server);clearInterval((f.host as any).timer)
 const endpoint=server.url+'/entry-workspace/attention',headers={authorization:'Bearer '+readFileSync(server.tokenPath,'utf8').trim()}
 expect((await fetch(endpoint)).status).toBe(401);expect((await fetch(endpoint,{headers:{authorization:'Bearer wrong'}})).status).toBe(401)
 const before=dbState(f),response=await fetch(endpoint,{headers});expect(response.status).toBe(200);expect(await response.json()).toMatchObject({schema:1,readOnly:true,total:1});expect(dbState(f)).toBe(before)
 for(const method of ['POST','DELETE','PUT','HEAD'])expect((await fetch(endpoint,{headers,method})).status).toBe(405)
 for(const query of ['?offset=-1','?limit=101','?limit=0','?offset=1000001','?secret=SECRET_QUERY','?offset=0&offset=1','?limit=1&limit=1','?offset=','?limit=','?offset=%20','?limit=+','?limit=%201%20','?offset=1.0','?limit=1e1']){
  const invalid=await fetch(endpoint+query,{headers});expect(invalid.status).toBe(400);expect(await invalid.json()).toEqual({code:'operator_attention_query_invalid'})
 }
 vi.spyOn(f.host.memory,'readOnly').mockImplementation(()=>{throw Error('SECRET_PRIVATE_EXCEPTION')})
 const failed=await fetch(endpoint,{headers});expect(failed.status).toBe(503);expect(await failed.json()).toEqual({code:'operator_attention_unavailable'});expect(dbState(f)).toBe(before)
 expect(f.model.run).not.toHaveBeenCalled();expect(f.deliver).not.toHaveBeenCalled()
})

it('changes the observation fingerprint when existing revision/status facts change without changing a row identity',async()=>{
 const f=fixture(),ticket=await task(f),item=approval(f,ticket),now=at(f),first=f.projection.snapshot(0,25,now).items[0]!
 f.host.store.put('approval',item.id,{...item,status:'expired'})
 const before=dbState(f),second=f.projection.snapshot(0,25,now).items[0]!
 expect(second.id).toBe(first.id);expect(second.observed).not.toBe(first.observed);expect(second.state).toBe('expired');expect(dbState(f)).toBe(before)
})
it('keeps an unavailable project review view-only and omits it when its original scope or context is no longer readable',async()=>{
 const f=fixture(),ticket=await task(f),goal=projectReview(f,ticket)
 expect(f.projection.snapshot().items[0]).toMatchObject({kind:'project_review',state:'stale'})
 f.host.store.put('router-goal',goal.id,{...goal,scopeId:'wrong-scope'})
 const before=dbState(f);expect(f.projection.snapshot().total).toBe(0);expect(dbState(f)).toBe(before)
})

it('classifies native user input as a question rather than a permission and rejects missing turn attribution',async()=>{
 const f=fixture(),ticket=await task(f),item=approval(f,ticket,'item/tool/requestUserInput',{questions:[{id:'SECRET_QUESTION_ID',question:'SECRET_QUESTION',options:[]}]})
 expect(f.projection.snapshot(0,25,at(f)).items[0]).toMatchObject({kind:'native_question',state:'needs_reply'})
 f.host.store.put('approval',item.id,{...item,native:{...item.native,params:{threadId:'session'}}})
 expect(f.projection.snapshot(0,25,at(f)).items[0]?.state).toBe('unavailable')
})
it('uses the real read-only acceptance verifier for fresh project review and marks changed evidence stale without writes',async()=>{
 const f=fixture(),ticket=await task(f),goal=projectReview(f,ticket)
 goal.state='active';goal.project!.integration='build';goal.nodes![0]!.state='passed';f.host.store.put('router-goal',goal.id,goal)
 expect(f.host.verification.capture(ticket.id,{state:'ready',summary:'SECRET_ACCEPTED_REPORT'},'SECRET_ACCEPTED_REPLY')).toBe(true)
 f.host.store.put('run',ticket.id,{...f.host.store.get<Run>('run',ticket.id)!,phase:'idle'})
 const delivery=f.host.store.get<{id:string}>('goal-delivery',ticket.id)!
 f.host.store.put('project-commit',delivery.id,{id:delivery.id,goalId:goal.id,ticketId:ticket.id,head:'a'.repeat(40),parents:[],test:{command:'SECRET_COMMAND',exit:0,output:'SECRET_OUTPUT'}})
 const round=f.host.verification.ensure(goal);round.state='passed';f.host.store.put('goal-verification',round.id,round)
 goal.finalRoundId=round.id;goal.state='needs_input';goal.project!.review={...goal.project!.review!,roundId:round.id,deliveryId:delivery.id,head:'a'.repeat(40)};f.host.store.put('router-goal',goal.id,goal)
 const before=dbState(f),result=f.projection.snapshot()
 expect(result.items[0]).toMatchObject({kind:'project_review',state:'needs_review'});expect(dbState(f)).toBe(before);expect(JSON.stringify(result)).not.toContain('SECRET')
 f.host.store.put('project-commit',delivery.id,{...f.host.projectCode.receipt(delivery.id)!,head:'b'.repeat(40)})
 const changedBefore=dbState(f);expect(f.projection.snapshot().items[0]?.state).toBe('stale');expect(dbState(f)).toBe(changedBefore)
 expect(f.model.run).not.toHaveBeenCalled();expect(f.model.history).not.toHaveBeenCalled();expect(f.deliver).not.toHaveBeenCalled()
})

it('does not call a mismatched review head or missing original review receipt a current acceptance',async()=>{
 const f=fixture(),ticket=await task(f),goal=projectReview(f,ticket)
 f.host.store.db.prepare("DELETE FROM records WHERE kind='project-review' AND id=?").run(goal.project!.review!.id)
 const before=dbState(f),row=f.projection.snapshot().items[0]!
 expect(row).toMatchObject({state:'stale',next:{kind:'records',id:ticket.id}});expect(dbState(f)).toBe(before)
})

it('treats a same-millisecond native request and assignment start as unproven instead of borrowing the current turn',async()=>{
 const f=fixture(),ticket=await task(f),item=approval(f,ticket),createdAt=Date.parse(ticket.assignments.at(-1)!.startedAt!)
 f.host.store.put('approval',item.id,{...item,createdAt})
 const before=dbState(f);expect(f.projection.snapshot(0,25,at(f)).items[0]?.state).toBe('unavailable');expect(dbState(f)).toBe(before)
})

function scheduled(f:ReturnType<typeof fixture>){
 const schedule=f.host.proactive.command({action:'schedule.put',scopeId:'team',operationId:'schedule-put',expectedRevision:0,schedule:{id:'attention-check',name:'Attention check',triggerId:f.trigger.id,prompt:'Observe the authorized local task without sending',mode:'standalone',notification:'silent',timing:{kind:'once',startAt:new Date(Date.now()+60_000).toISOString(),timezone:'Etc/UTC'}}}) as any
 const run=f.host.proactive.command({action:'schedule.run',scopeId:'team',id:schedule.id,operationId:'schedule-run',expectedRevision:schedule.revision}) as ScheduledRun
 expect(run.state).toBe('queued');const trigger=f.host.store.triggers.get(run.triggerId!)!
 expect(trigger.meta.origin).toBe('scheduler')
 const context=f.host.scopes.context(trigger,trigger.source+':'+trigger.threads[0]!.id)!
 return {trigger,context}
}
function goalWake(f:ReturnType<typeof fixture>,anchor={trigger:f.trigger,context:f.context}){
 const goal=f.host.goals.command({action:'start',operationId:'read-goal',expectedRevision:0,title:'Read goal',objective:'Produce the authorized local result',authorizationQuote:'Continuously produce and verify',criteria:[{id:'result',description:'Produce the result',files:[],documents:[]}]},anchor.context) as RouterGoal
 f.host.store.db.prepare("UPDATE jobs SET state='done' WHERE kind='router'").run()
 f.host.store.put('router-goal',goal.id,{...goal,nextAt:Date.now()-1})
 f.host.goals.tick()
 const wake=f.host.store.list<{goalId:string;triggerId:string}>('goal-wake').find(value=>value.goalId===goal.id)!
 expect(wake).toBeDefined();const trigger=f.host.store.triggers.get(wake.triggerId)!
 expect(trigger.meta.origin).toBe('goal-controller')
 const context=f.host.scopes.context(trigger,goal.discussion)!
 return {trigger,context}
}
it('keeps a real scheduled worker delegation read-only when its original human anchor route is missing',async()=>{
 const f=fixture(),anchor=scheduled(f),ticket=question(f,await task(f,'scheduled-task',anchor));approval(f,ticket)
 expect(f.host.store.get<{parentTrigger:string}>('router-delegation',ticket.origin.triggerId)?.parentTrigger).toBe(anchor.trigger.id)
 expect(f.projection.snapshot(0,25,at(f)).total).toBe(2)
 f.host.store.db.prepare("DELETE FROM records WHERE kind='router-route' AND id=?").run(f.trigger.id)
 expect(f.host.store.get('router-route',anchor.trigger.id)).toBeDefined()
 const before=dbState(f),pending=liveWaiters(f)
 expect(f.projection.snapshot(0,25,at(f)).total).toBe(0)
 expect(f.host.store.get('router-route',f.trigger.id)).toBeUndefined();expect(dbState(f)).toBe(before);expectWaitersUnchanged(f,pending)
 expect(f.model.run).not.toHaveBeenCalled();expect(f.model.history).not.toHaveBeenCalled();expect(f.deliver).not.toHaveBeenCalled()
})
it('keeps a real goal-wake worker delegation read-only when its inner goal anchor route is missing',async()=>{
 const f=fixture(),anchor=goalWake(f),ticket=question(f,await task(f,'goal-task',anchor));approval(f,ticket)
 expect(f.projection.snapshot(0,25,at(f)).total).toBe(2)
 f.host.store.db.prepare("DELETE FROM records WHERE kind='router-route' AND id=?").run(f.trigger.id)
 const before=dbState(f),pending=liveWaiters(f)
 expect(f.projection.snapshot(0,25,at(f)).total).toBe(0);expect(dbState(f)).toBe(before);expectWaitersUnchanged(f,pending)
 expect(f.host.store.get('router-route',anchor.trigger.id)).toBeDefined();expect(f.host.store.get('router-route',f.trigger.id)).toBeUndefined()
 expect(f.model.run).not.toHaveBeenCalled();expect(f.deliver).not.toHaveBeenCalled()
})
it('guards the full real scheduled to dependent goal-wake to original human anchor chain',async()=>{
 const f=fixture(),received=f.host.receive('local','alice',{id:'other-anchor',thread:'other-thread',scope:'topic',text:f.trigger.text,addressed:true}) as {triggerId:string}
 const human=f.host.store.triggers.get(received.triggerId)!,wake=goalWake(f,{trigger:human,context:f.host.scopes.context(human,'local:other-thread')!})
 f.host.store.put('router-input-set',f.trigger.id,{triggerIds:[wake.trigger.id]})
 const anchor=scheduled(f),ticket=question(f,await task(f,'nested-task',anchor));approval(f,ticket)
 expect(f.projection.snapshot(0,25,at(f)).total).toBe(2)
 f.host.store.db.prepare("DELETE FROM records WHERE kind='router-route' AND id=?").run(human.id)
 expect(f.host.store.get('router-route',f.trigger.id)).toBeDefined();expect(f.host.store.get('router-route',wake.trigger.id)).toBeDefined();expect(f.host.store.get('router-route',anchor.trigger.id)).toBeDefined()
 const before=dbState(f),pending=liveWaiters(f)
 expect(f.projection.snapshot(0,25,at(f)).total).toBe(0);expect(dbState(f)).toBe(before);expectWaitersUnchanged(f,pending)
 expect(f.host.store.get('router-route',human.id)).toBeUndefined();expect(f.model.run).not.toHaveBeenCalled();expect(f.model.history).not.toHaveBeenCalled();expect(f.deliver).not.toHaveBeenCalled()
})
it('restores nested synchronous route guards on return and throw while default context keeps lazy route creation',()=>{
 const f=fixture(),existing=dbState(f)
 expect(f.host.scopes.readOnly(()=>f.host.scopes.readOnly(()=>f.host.scopes.context(f.trigger,'local:topic')))?.route.triggerId).toBe(f.trigger.id)
 expect(dbState(f)).toBe(existing)
 f.host.store.db.prepare("DELETE FROM records WHERE kind='router-route' AND id=?").run(f.trigger.id)
 const before=dbState(f),derive=vi.spyOn(f.host.scopes,'entry')
 f.host.scopes.readOnly(()=>{
  expect(()=>f.host.scopes.readOnly(()=>f.host.scopes.context(f.trigger,'local:topic'))).toThrow('Existing Router route required')
  expect(()=>f.host.scopes.context(f.trigger,'local:topic')).toThrow('Existing Router route required')
 })
 expect(derive).not.toHaveBeenCalled();expect(dbState(f)).toBe(before)
 expect(()=>f.host.scopes.readOnly(()=>{throw Error('fixture throw')})).toThrow('fixture throw')
 expect(f.host.scopes.context(f.trigger,'local:topic')?.route.triggerId).toBe(f.trigger.id)
 expect(f.host.store.get('router-route',f.trigger.id)).toBeDefined();expect(derive).toHaveBeenCalledOnce()
})
it('rejects Date-out-of-range or fractional liveness metadata without touching pending waiters or database',async()=>{
 const f=fixture(),ticket=await task(f),item=approval(f,ticket)
 for(const change of [{createdAt:8.64e15+1},{expiresAt:8.64e15+1},{createdAt:0.5},{expiresAt:item.expiresAt+0.5}]){
  f.host.store.put('approval',item.id,{...item,...change});const before=dbState(f),pending=liveWaiters(f)
  expect(f.host.approvals.hasLiveRequest(item.id,at(f))).toBe(false);expect(dbState(f)).toBe(before);expectWaitersUnchanged(f,pending)
 }
 f.host.store.put('approval',item.id,item)
 for(const now of [8.64e15+1,NaN,Infinity,-1,0.5])expect(f.host.approvals.hasLiveRequest(item.id,now)).toBe(false)
 expect(()=>f.projection.snapshot(0,25,8.64e15+1)).toThrow('operator_attention_query_invalid')
 f.host.store.put('approval',item.id,{...item,createdAt:8.64e15-2,expiresAt:8.64e15})
 expect(f.host.approvals.hasLiveRequest(item.id,8.64e15-1)).toBe(true);expect(f.projection.snapshot(0,25,8.64e15-1).items[0]?.expiresAt).toBe(8.64e15)
})
it('preserves real signed in-process delegated authority while read-only context refuses a missing private route',async()=>{
 const f=fixture(true),peer=readIdentity(f.root)
 f.host.delegation.bindEndpoint('http://127.0.0.1:49191')
 const ticket=f.host.delegation.pairing({expectedRevision:0,policy:{workerIds:['one'],scopeId:'team'}})
 await f.host.delegation.receive(packet(peer,f.host.delegation.identity.id,'pair',{ticket,peer:publicIdentity(peer)}))
 const now=Date.now(),contract={version:1,delegationId:'attention-inbound',rootId:'attention-root',parentTriggerId:f.trigger.id,issuer:peer.id,target:f.host.delegation.identity.id,ancestors:[peer.id],principal:{source:'local',actor:'alice'},text:'Observe local result',acceptance:'Inspect records only',artifacts:[],permissions:{write:false,shell:false,network:false,subagents:false},limits:{maxActivations:12,maxConcurrent:2,durationMs:600000},createdAt:now,deadline:now+60_000}
 const remote=await f.host.delegation.receive(packet(peer,f.host.delegation.identity.id,'submit',{grantId:ticket.id,payload:{contract,leaseUntil:now+15_000}})) as {triggerId:string;discussion:string}
 const trigger=f.host.store.triggers.get(remote.triggerId)!
 expect(f.host.scopes.readOnly(()=>f.host.routerIngress.authority(trigger.id)).basis).toMatchObject({via:'listed',authority:'delegation:attention-inbound'})
 expect(f.host.scopes.readOnly(()=>f.host.scopes.context(trigger,remote.discussion))).toBeDefined()
 f.host.store.db.prepare("DELETE FROM records WHERE kind='router-route' AND id=?").run(trigger.id)
 const before=dbState(f),pending=liveWaiters(f)
 expect(()=>f.host.scopes.readOnly(()=>f.host.scopes.readOnly(()=>{f.host.routerIngress.authority(trigger.id);return f.host.scopes.context(trigger,remote.discussion)}))).toThrow('Existing Router route required')
 expect(f.projection.snapshot().total).toBe(0);expect(dbState(f)).toBe(before);expectWaitersUnchanged(f,pending)
 expect(f.model.run).not.toHaveBeenCalled();expect(f.model.history).not.toHaveBeenCalled();expect(f.deliver).not.toHaveBeenCalled()
 expect(f.host.scopes.context(trigger,remote.discussion)).toBeDefined()
})
