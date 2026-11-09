import {randomUUID} from 'node:crypto'
import type {Runtime} from './runtime.ts'
import type {Run} from './store.ts'
import type {RouterGoal} from './router-goals.ts'
import {stableDigest} from './sources.ts'
import {BackendRegistry} from './backends/registry.ts'
import {agentOptionsSchema} from './backend-config.ts'
import {mergeOptions} from './agent-options.ts'
import {watchdogDirectiveSchema,type WatchdogSnapshot,type WatchdogTarget,type WatchdogRecovery} from './watchdog-contract.ts'

/** The independent observer can propose recovery; only this host can apply it under current authority. */
export class HostWatchdog {
 readonly instanceId=randomUUID()
 constructor(private host:Runtime,private now:()=>number=Date.now){}
 private eligible(g:RouterGoal){
  if(!this.host.config.watchdog.enabled||this.host.shuttingDown||this.host.isPaused||!g.managed||!g.contract||!['active','waiting'].includes(g.state)||g.turns>=g.maxTurns)return false
  const c=this.host.goals.context(g)
  const t=this.host.store.triggers.get(g.contract.triggerId)
  if(!t||stableDigest(t)!==g.contract.triggerHash||stableDigest(this.host.routerIngress.authority(t.id))!==stableDigest(g.contract.mandate)||stableDigest({objective:g.objective,criteria:g.criteria})!==stableDigest({objective:g.contract.objective,criteria:g.contract.criteria}))throw Error('Original contract or authorization changed')
  for(const id of g.taskIds)this.host.scopes.checkTask(id,c,true)
  return true
 }
 recovering(ticketId:string){return this.host.store.list<WatchdogRecovery>('watchdog-recovery').some(r=>r.ticketId===ticketId&&r.state==='interrupting')}
 snapshot(includePrivate=false):WatchdogSnapshot {
  const targets:WatchdogTarget[]=[],unavailable:WatchdogSnapshot['unavailable']=[]
  for(const g of this.host.store.list<RouterGoal>('router-goal')){
   try{
    if(!this.eligible(g))continue
    if(!includePrivate&&this.host.scopes.binding(g.entryId).privateActor)continue
    for(const n of g.nodes??[]){
     if(!n.ticketId||['passed','held','waiting_dependency','verifying'].includes(n.state))continue
     const t=this.host.store.tickets.get(n.ticketId),run=this.host.store.get<Run>('run',n.ticketId),a=t?.assignments.at(-1)
     if(!t||t.ended||!a||run?.phase==='human')continue
     const manifest=this.host.store.get<any>('task-context',t.id)?.manifest
     if(manifest)this.host.memory.validate(manifest)
     if(this.host.store.get('task-continuation',t.id))throw Error('Task context requires reconciliation')
     const observed=this.host.verification.observe(g,n)
     const jobs=this.host.work.list(t.id).filter(w=>w.assignmentId===a.id),active=jobs.filter(w=>['starting','running'].includes(w.state))
     const external=this.host.toolConnections.receipts(t.id)
     const calls=this.host.activity.list().filter(c=>c.ticketId===t.id)
     const progressHash=stableDigest(observed)
     const verifiedHash=stableDigest((g.nodes??[]).map(n=>({id:n.id,passed:n.state==='passed',round:n.state==='passed'?n.roundId:undefined})))
     const contractHash=stableDigest(g.contract),phase=run?.phase??'queued'
     const pendingApproval=this.host.store.list<any>('approval').some(p=>p.ticketId===t.id&&p.status==='pending')
     const unresolved=external.some(r=>r.state!=='complete')||['uncertain','interrupted','delivering','merging'].includes(phase)
     const eventWait=this.host.webhooks.continuations.pending(t.id,a.id)
     const waiting=eventWait?'external_event':pendingApproval?'human_approval':unresolved?'uncertain_effects':active.length?'background_work':n.retryAt&&n.retryAt>this.now()?'retry_backoff':g.state==='waiting'&&g.nextAt&&g.nextAt>this.now()?'scheduled_wait':t.attention?.question?'human_input':undefined
     const notBefore=waiting==='external_event'?eventWait!.deadline:waiting==='background_work'?Math.max(...active.map(w=>w.deadline??this.now()+this.host.config.watchdog.intervalMs)):waiting==='retry_backoff'?n.retryAt:waiting==='scheduled_wait'?g.nextAt:undefined
     const evidence=[
      {id:'artifacts',kind:'host_observation',value:observed},
      {id:'report',kind:'worker_assertion',value:a.report??null},
      {id:'calls',kind:'host_execution',value:calls.slice(-30).map(c=>({name:c.name,kind:c.kind,state:c.state,action:c.action,startedAt:c.startedAt,endedAt:c.endedAt}))},
      {id:'jobs',kind:'host_execution',value:jobs.slice(-20).map(w=>({id:w.id,kind:w.kind,state:w.state,deadline:w.deadline,exitCode:w.exitCode,command:w.command?.slice(0,2000)}))},
      {id:'external-event',kind:'host_execution',value:eventWait?{id:eventWait.id,ruleId:eventWait.ruleId,state:eventWait.state,deadline:eventWait.deadline}:null},
      {id:'inputs',kind:'delivery',value:{pending:t.undelivered.length,assignmentId:a.id}},
     ]
     const basisHash=stableDigest({goal:g.id,revision:g.revision,contractHash,planRevision:g.planRevision,node:n,assignment:a.id,progressHash,inputs:t.undelivered,owner:this.host.scopes.ownership(t.id),report:a.report})
     const scope=this.host.scopes.scope(g.scopeId),backendId=this.host.config.watchdog.backend??(this.host.model instanceof BackendRegistry?this.host.model.selected('router'):this.host.config.execution.backend)
     const backendIds=g.contract!.backendIds.filter(id=>scope.backendIds.includes(id))
     if(!backendIds.includes(backendId))throw Error('Watchdog backend is outside the original goal scope')
     const backend=structuredClone(this.host.model instanceof BackendRegistry?this.host.model.definition(backendId):this.host.config.backends[backendId]??{kind:'codex' as const})
     const effective=mergeOptions(backend.defaults,agentOptionsSchema.parse(Object.fromEntries(Object.entries(this.host.config.execution.router??{}).filter(([key])=>key in agentOptionsSchema.shape))))
     const inference={model:this.host.config.execution.router?.model??this.host.config.models.router??(backend.kind==='codex'?backend.model??this.host.config.model:undefined),backend,options:{...effective,...(backend.kind==='codex'?{effort:effective.effort??this.host.config.effort}:{})}}
     const fence=stableDigest({instanceId:this.instanceId,basisHash,phase,waiting,inference,watchdog:this.host.config.watchdog})
     targets.push({id:'target-'+stableDigest([g.id,n.id]),goalId:g.id,nodeId:n.id,ticketId:t.id,assignmentId:a.id,fence,basisHash,goalRevision:g.revision,contractHash,objective:g.objective,criteria:this.host.verification.criteria(g,n),principal:{source:g.contract!.mandate.actor.source,actor:g.contract!.mandate.actor.id},backendId,backendIds,contextBytes:scope.contextBytes,inference,phase,activityAt:this.host.store.get<{at:number}>('progress',t.id)?.at??Date.parse(t.updatedAt),progressHash,verifiedHash,waiting,notBefore,evidence,recoveryId:this.host.store.list<WatchdogRecovery>('watchdog-recovery').find(r=>r.ticketId===t.id&&(r.state==='interrupting'||r.state==='watching'&&(this.now()-r.updatedAt<=this.host.config.watchdog.staleMs*2||this.host.replanning.active(g))))?.id})
    }
   }catch{unavailable.push({goalId:g.id,reason:'Current authority or bounded evidence is unavailable'})}
  }
  return {instanceId:this.instanceId,at:this.now(),tickAt:this.host.store.get<{at:number}>('health','host')?.at??this.now(),paused:this.host.isPaused||this.host.shuttingDown,config:this.host.config.watchdog,targets,unavailable,webhooks:{waiting:this.host.webhooks.continuations.list().filter(w=>w.state==='waiting').length,overdue:this.host.webhooks.continuations.list().filter(w=>w.state==='waiting'&&w.deadline<=this.now()).length,heldReceipts:Number(this.host.store.db.prepare("SELECT COUNT(*) n FROM webhook_inbox WHERE state='held'").get()!.n),pendingDeliveries:Number(this.host.store.db.prepare("SELECT COUNT(*) n FROM webhook_deliveries WHERE state IN ('pending','sending')").get()!.n),lastReconciliation:this.host.store.get<{at:number}>('webhook-reconciliation','latest')?.at}}
 }
 accept(value:unknown):WatchdogRecovery {
  const d=watchdogDirectiveSchema.parse(value),prior=this.host.store.get<WatchdogRecovery>('watchdog-recovery',d.id)
  if(prior){if(stableDigest({id:prior.id,targetId:prior.targetId,fence:prior.fence,judgment:prior.judgment})!==stableDigest(d))throw Error('Watchdog operation id reused');return prior}
  const target=this.snapshot(true).targets.find(t=>t.id===d.targetId)
  if(!target||target.fence!==d.fence)throw Error('Watchdog observation is stale or unauthorized')
  if(!['stalled','drifted'].includes(d.judgment.verdict)||d.judgment.evidenceIds.some(id=>!target.evidence.some(e=>e.id===id)))throw Error('Recovery requires a supported failure judgment')
  if(target.waiting||target.recoveryId)throw Error('Task is waiting or already recovering')
  const attempts=this.host.store.list<WatchdogRecovery>('watchdog-recovery').filter(r=>r.ticketId===target.ticketId&&r.state!=='stale').length
  const g=this.host.goals.get(target.goalId)!
  if(attempts>=this.host.config.watchdog.maxRecoveries){
   const reason='Watchdog recovery allowance exhausted; goal remains unresolved'
   this.host.store.put('router-goal',g.id,{...g,state:'held',reason,nextAt:undefined})
   this.host.goals.notice(g,reason)
   throw Error(reason)
  }
  if(this.host.replanning.active(g))throw Error('A reviewed replan is already in progress')
  const r:WatchdogRecovery={...d,goalId:g.id,ticketId:target.ticketId,assignmentId:target.assignmentId,contractHash:target.contractHash,goalRevision:g.revision,progressHash:target.progressHash,verifiedHash:target.verifiedHash,basisHash:target.basisHash,observation:{phase:target.phase,activityAt:target.activityAt,evidence:target.evidence},state:'interrupting',at:this.now(),updatedAt:this.now()}
  // Persist before signalling: a crash in between is resumed by advance().
  this.host.store.put('watchdog-recovery',r.id,r)
  this.host.interruptForWatchdog(r.ticketId)
  return r
 }
 async advance(){
  for(const r of this.host.store.list<WatchdogRecovery>('watchdog-recovery')){
   if(!['interrupting','watching'].includes(r.state))continue
   const save=(state:WatchdogRecovery['state'],reason?:string)=>this.host.store.put('watchdog-recovery',r.id,{...r,state,reason,updatedAt:this.now()})
   const g=this.host.goals.get(r.goalId),task=this.host.store.tickets.get(r.ticketId)
   try{
    if(g?.state==='completed'){save('resolved','Goal passed independent acceptance');continue}
    if(g?.state==='held'){save('held',g.reason);continue}
    if(!g||!task||task.ended||!this.eligible(g)||stableDigest(g.contract)!==r.contractHash){save('stale','Current authorization or goal state no longer permits recovery');continue}
    if(r.state==='watching'){
     const target=this.snapshot(true).targets.find(t=>t.ticketId===r.ticketId)
     if(target&&(target.progressHash!==r.progressHash||target.verifiedHash!==r.verifiedHash))save('resolved','Evidence changed after recovery; goal still requires independent acceptance')
     continue
    }
    if(g.revision!==r.goalRevision||task.assignments.at(-1)?.id!==r.assignmentId){save('stale','Execution changed before recovery');continue}
    this.host.interruptForWatchdog(r.ticketId)
    if(this.host.executionActive(r.ticketId))continue
    const run=this.host.store.get<Run>('run',r.ticketId)
    if(run&&['uncertain','interrupted','delivering','merging','human'].includes(run.phase)||this.host.work.list(r.ticketId).some(w=>['starting','running'].includes(w.state))||this.host.toolConnections.receipts(r.ticketId).some(x=>x.state!=='complete')){
     const reason='Reconcile unfinished or uncertain effects before another execution'
     this.host.store.put('router-goal',g.id,{...g,state:'held',reason})
     this.host.store.db.prepare("UPDATE jobs SET state='blocked',error=? WHERE kind IN ('start','execute') AND state='pending' AND json_extract(payload,'$.ticketId')=?").run(reason,r.ticketId)
     this.host.goals.notice(g,reason);save('held',reason);continue
    }
    const currentTarget=this.snapshot(true).targets.find(t=>t.ticketId===r.ticketId)
    if(!currentTarget||currentTarget.basisHash!==r.basisHash){save('stale','Input or evidence changed while interrupting');continue}
    if(!this.host.goals.effectsSettled(r.ticketId))continue
    this.host.store.atomic(()=>{
     const current=this.host.goals.get(g.id)!
     if(!this.eligible(current))throw Error('Authority changed before recovery')
     this.host.goals.recoverFromWatchdog(current,r.ticketId,r.id,r.judgment.reason)
     save('watching','Router received retained failure evidence for recovery')
    })
   }catch{save('stale','Recovery authority or evidence changed')}
  }
 }
}
