import {realpathSync,statSync,lstatSync} from 'node:fs'
import {dirname,basename,join,resolve} from 'node:path'
import type {Runtime} from './runtime.ts'
import type {Run} from './store.ts'
import type {WorkItem} from './work.ts'
import type {RouterGoal} from './router-goals.ts'
import {stableDigest} from './sources.ts'
import {workspaceTarget} from './workspace.ts'
import {projectWorkspace} from './project-code.ts'

type Host=Pick<Runtime,'config'|'store'>
export interface SchedulerCandidate {ticketId:string;backendId:string;excludeRun?:boolean;excludeWorkId?:string}
export interface SchedulerDimension {key:string;limit:number|null;used:number;reserved:number;available:number|null;alreadyCounted:boolean}
export interface SchedulerAdmission {allowed:boolean;blockers:{dimension:'project'|'backend'|'workspace';code:'limit_reached'|'identity_unknown'}[];dimensions:{project?:SchedulerDimension;backend:SchedulerDimension;workspace?:SchedulerDimension};occupancy:{usedTicketIds:string[];reservedTicketIds:string[]}}
interface Identity {path:string;key:string}
interface Occupant {ticketId:string;state:'used'|'reserved';backend?:string;workspace?:Identity;project?:string;projectUnknown?:boolean}
/** Resolve existing ancestors without creating directories or invoking Git. */
function canonicalTarget(path:string,mustExist=false):Identity {
 const absolute=resolve(path);let ancestor=absolute;const missing:string[]=[]
 for(;;){
  try{
   lstatSync(ancestor) // A dangling symlink is not a missing directory and cannot be guessed through.
   const real=realpathSync(ancestor),stat=statSync(real,{bigint:true})
   if(!stat.isDirectory())throw Error('Workspace ancestor is not a directory')
   if(mustExist&&missing.length)throw Error('Prepared workspace missing')
   const canonical=join(real,...missing.reverse())
   return {path:canonical,key:'workspace-'+stableDigest(missing.length?{path:canonical}:{dev:String(stat.dev),ino:String(stat.ino)})}
  }catch(error:any){
   if(error.code!=='ENOENT'||mustExist)throw error
   // lstat succeeds for dangling symlinks, so do not reinterpret their failed realpath as absence.
   try{if(lstatSync(ancestor).isSymbolicLink())throw Error('Dangling workspace symlink')}catch(e:any){if(e.code!=='ENOENT')throw e}
   const parent=dirname(ancestor);if(parent===ancestor)throw Error('Workspace root unavailable')
   missing.push(basename(ancestor));ancestor=parent
  }
 }
}
function projectIdentity(host:Host,ticketId:string):{id?:string;unknown?:boolean}{
 const goals=host.store.list<RouterGoal>('router-goal').filter(g=>!!g.project&&(g.taskIds?.includes(ticketId)||g.nodes?.some(n=>n.ticketId===ticketId)))
 return goals.length>1||!host.store.tickets.get(ticketId)?{unknown:true}:{id:goals[0]?.id}
}
function workspace(host:Host,ticketId:string,project:{id?:string;unknown?:boolean}):Identity {
 const task=host.store.tickets.get(ticketId);if(!task||project.unknown)throw Error('Workspace ownership unavailable')
 const run=host.store.get<Run>('run',ticketId)
 if(run?.prepared||run?.threadId)return canonicalTarget(run.cwd,true)
 if(project.id&&host.store.get<RouterGoal>('router-goal',project.id)?.nodes?.some(n=>n.ticketId===ticketId))return canonicalTarget(projectWorkspace(host.config.stateDir,ticketId))
 const source=host.config.sources.find(s=>s.id===task.mandate.actor.source);if(!source)throw Error('Workspace source unavailable')
 // Remote delegated tasks can only narrow the source sandbox, including to read-only.
 const contract=host.store.get<any>('task-assignment-current',ticketId),assignment=contract?host.store.get<any>('task-assignment-revision',contract.digest):host.store.get<any>('task-assignment-contract',ticketId)
 if(contract&&(!assignment||assignment.digest!==contract.digest)||assignment&&!['read-only','workspace-write'].includes(assignment.effective?.sandbox))throw Error('Assignment workspace unavailable')
 const original=host.store.get<{parentTrigger?:string}>('worker-assignment',ticketId),routing=host.store.get<{parentTrigger?:string}>('task-routing',ticketId),continuation=host.store.get<{triggerId:string}>('task-continuation',ticketId),parent=routing?.parentTrigger??continuation?.triggerId??original?.parentTrigger
 const trigger=parent?host.store.triggers.get(parent):undefined,id=trigger?.meta.delegationId,delegated=typeof id==='string'?host.store.get<any>('delegation-inbound',id):undefined
 if(id&&(!delegated||delegated.triggerId!==parent||typeof delegated.contract?.permissions?.write!=='boolean'))throw Error('Delegated workspace unavailable')
 const effectiveSource=assignment?.effective?.sandbox==='read-only'||delegated?.contract?.permissions?.write===false?{...source,sandbox:'read-only' as const}:source
 return canonicalTarget(workspaceTarget(host.config,effectiveSource,ticketId),effectiveSource.sandbox==='read-only'||effectiveSource.workspace?.mode==='source')
}
function rootBackend(host:Host,ticketId:string):string|undefined {
 const run=host.store.get<Run>('run',ticketId)
 if(run?.threadId){const binding=host.store.get<{id:string}>('backend-binding',run.threadId);if(binding?.id)return binding.id}
 return run?.backendId
}
function workBackend(host:Host,item:WorkItem):string|undefined {
 if(item.schedulerBackendId)return item.schedulerBackendId
 if(item.kind==='shell')return rootBackend(host,item.ticketId)
 if(item.threadId){const binding=host.store.get<{id:string}>('backend-binding',item.threadId);if(binding?.id)return binding.id}
 if(item.leaseId){const lease=host.store.get<{backendId:string}>('task-workspace-lease',item.leaseId);if(lease?.backendId)return lease.backendId}
 // A running legacy child with no captured backend is unknown, not today's changed default.
 return undefined
}
function sameWorkspace(a:Identity|undefined,b:Identity|undefined){return !!a&&!!b&&(a.key===b.key||a.path===b.path)}
/** Pure quota observation. Does not claim permissions, consume jobs or advance fairness. */
export function schedulerAdmission(host:Host,candidate:SchedulerCandidate,inFlight:readonly SchedulerCandidate[]=[]):SchedulerAdmission {
 const policy=host.config.scheduler,occupants:Occupant[]=[],hintSets=new Map<string,Set<string>>(),projects=new Map<string,ReturnType<typeof projectIdentity>>()
 for(const f of inFlight){const set=hintSets.get(f.ticketId)??new Set<string>();set.add(f.backendId);hintSets.set(f.ticketId,set)}
 const hint=(id:string)=>{const set=hintSets.get(id);return set?.size===1?[...set][0]:undefined}
 const workItems=host.store.list<WorkItem>('work')
 const unresolved=(ticketId:string)=>workItems.some(w=>w.ticketId===ticketId&&(['starting','running'].includes(w.state)||(w.state==='interrupted'||w.cancellation?.state==='unconfirmed'||!!w.resourceKeys?.length)&&!w.schedulerReleasedAt))
 const project=(id:string)=>{let p=projects.get(id);if(!p){p=projectIdentity(host,id);projects.set(id,p)}return p}
 const add=(ticketId:string,state:Occupant['state'],backend?:string,cwd?:string)=>{
  const p=project(ticketId);let target:Identity|undefined
  try{target=cwd?canonicalTarget(cwd,true):workspace(host,ticketId,p)}catch{}
  occupants.push({ticketId,state,backend,workspace:target,project:p.id,projectUnknown:p.unknown||!host.store.tickets.get(ticketId)})
 }
 for(const run of host.store.list<Run>('run')){
  if(candidate.excludeRun&&run.ticketId===candidate.ticketId)continue
  if(['starting','running'].includes(run.phase))add(run.ticketId,'used',rootBackend(host,run.ticketId)??hint(run.ticketId))
  else if(['uncertain','interrupted'].includes(run.phase)&&(!host.store.tickets.get(run.ticketId)?.ended||unresolved(run.ticketId)))add(run.ticketId,'reserved',rootBackend(host,run.ticketId)??hint(run.ticketId))
 }
 for(const item of workItems){
  if(item.ticketId===candidate.ticketId&&item.id===candidate.excludeWorkId)continue
  if(['starting','running'].includes(item.state))add(item.ticketId,'used',workBackend(host,item)??(item.kind==='shell'?hint(item.ticketId):undefined),item.cwd)
  else if((item.state==='interrupted'||item.cancellation?.state==='unconfirmed'||!!item.resourceKeys?.length)&&!item.schedulerReleasedAt)add(item.ticketId,'reserved',workBackend(host,item)??(item.kind==='shell'?hint(item.ticketId):undefined),item.cwd)
 }
 for(const flight of inFlight)add(flight.ticketId,'reserved',flight.backendId)
 const cp=project(candidate.ticketId);let cw:Identity|undefined
 try{cw=workspace(host,candidate.ticketId,cp)}catch{}
 const blockers:SchedulerAdmission['blockers']=[]
 const dimension=(kind:'project'|'backend'|'workspace',key:string,limit:number|undefined,match:(o:Occupant)=>boolean,unknown:boolean):SchedulerDimension=>{
  const matching=occupants.filter(match),used=new Set(matching.filter(o=>o.state==='used').map(o=>o.ticketId)),reserved=new Set(matching.filter(o=>o.state==='reserved'&&!used.has(o.ticketId)).map(o=>o.ticketId)),alreadyCounted=used.has(candidate.ticketId)||reserved.has(candidate.ticketId)
  if(limit!==undefined){if(unknown)blockers.push({dimension:kind,code:'identity_unknown'});else if(!alreadyCounted&&used.size+reserved.size>=limit)blockers.push({dimension:kind,code:'limit_reached'})}
  return {key,limit:limit??null,used:used.size,reserved:reserved.size,available:limit===undefined?null:Math.max(0,limit-used.size-reserved.size),alreadyCounted}
 }
 const backend=dimension('backend',candidate.backendId,policy.backendConcurrency[candidate.backendId],o=>o.backend===candidate.backendId,!candidate.backendId||occupants.some(o=>!o.backend))
 const pd=cp.id?dimension('project',cp.id,policy.projectConcurrency,o=>o.project===cp.id,!!cp.unknown||occupants.some(o=>o.projectUnknown)):undefined
 if(cp.unknown&&policy.projectConcurrency!==undefined)blockers.push({dimension:'project',code:'identity_unknown'})
 const wd=dimension('workspace',cw?.key??'workspace-unknown',policy.workspaceConcurrency,o=>sameWorkspace(o.workspace,cw),!cw||occupants.some(o=>!o.workspace))
 const used=new Set(occupants.filter(o=>o.state==='used').map(o=>o.ticketId)),reserved=new Set(occupants.filter(o=>o.state==='reserved'&&!used.has(o.ticketId)).map(o=>o.ticketId))
 return {allowed:!blockers.length,blockers,dimensions:{backend,...(pd?{project:pd}:{}),workspace:wd},occupancy:{usedTicketIds:[...used].sort(),reservedTicketIds:[...reserved].sort()}}
}
