import {realpathSync,lstatSync,statSync} from 'node:fs'
import {z} from 'zod'
import type {Runtime} from './runtime.ts'
import type {RouterContext} from './worker-manager.ts'
import type {WorkOwner} from './work.ts'
import type {AgentOptions} from './backend-config.ts'
import type {VerificationRound} from './goal-verification.ts'
import {agentOptionsSchema,isApiBackend} from './backend-config.ts'
import {boundedBackendOptions,checkWorkerAdmission} from './backend-admission.ts'
import {workerProfiles} from './worker-pool.ts'
import {stableDigest} from './sources.ts'
import {mergeOptions} from './agent-options.ts'
import {taskView} from './task-context.ts'
const names=z.array(z.string().min(1).max(200)).max(128)
const definition=z.object({key:z.string().min(1).max(200),version:z.number().int().positive(),inputs:names,outputs:names,acceptance:names}).strict()
export const assignmentSpecSchema=z.object({
 interface:z.union([definition,z.object({id:z.string().min(1),digest:z.string().regex(/^[a-f0-9]{64}$/)}).strict()]).optional(),
 dependsOn:z.array(z.object({ticketId:z.string().min(1),assignmentId:z.string().min(1)}).strict()).max(50).optional(),
 requiredTools:names.optional(),requiredConnections:names.optional(),allowedTools:names.optional(),allowedConnections:names.optional(),
 workspace:z.object({mode:z.enum(['read-only','workspace-write']),readPaths:names.optional(),writePaths:names.optional()}).strict().optional(),
 limits:agentOptionsSchema.pick({timeoutMs:true,maxSteps:true,maxToolCalls:true,maxOutputTokens:true}).optional(),
}).strict()
export type AssignmentSpec=z.infer<typeof assignmentSpecSchema>
type Authority={source:string;actor:string;discussion:string;scopeId:string|null;entryId:string|null;parentTrigger:string|null;mandateDigest:string|null;provenance:'recorded_trigger'|'local_operator'}
export interface AssignmentInterface {id:string;digest:string;contextDigest:string;sourceId:string;scopeId:string|null;entryId:string|null;triggerId:string|null;key:string;version:number;inputs:string[];outputs:string[];acceptance:string[]}
export interface AssignmentPreview {spec:AssignmentSpec;workerId:string;backendId:string;authority:Authority;interface?:AssignmentInterface;dependencies:{ticketId:string;assignmentId:string;roundId:string;digest:string}[];effective:{tools:string[];connections:string[];options:AgentOptions;sandbox:'read-only'|'workspace-write';network:boolean;sourceRoot:string}}
export interface TaskAssignmentContract extends AssignmentPreview {schema:1;ticketId:string;digest:string;createdAt:number;revision?:number;previousDigest?:string;cause?:{kind:'migration'|'rebuild';commandId:string;fingerprint:string;triggerId:string|null;actor:string};objective:string;inputIds:string[];inputDigests:Record<string,string>;triggerDigests:Record<string,string>}
export interface TaskWorkspaceLease {schema:1;id:string;ticketId:string;assignmentId:string;contractDigest:string;cwd:string;directoryIdentity:{dev:string;ino:string};sandbox:WorkOwner['sandbox'];network:boolean;backendId:string;tools:string[];connections:string[];options:AgentOptions;agentId?:string;parentLeaseId?:string;at:number}
const fail=(reason:string):never=>{throw Error('assignment_contract_'+reason)}
const unique=(xs:string[])=>[...new Set(xs)].sort()
function inputDigests(host:Runtime,ticketId:string,ids?:string[]){
 const task=host.store.tickets.get(ticketId);if(!task)return fail('task_unavailable')
 return Object.fromEntries(taskView(host.store,task).inputs.filter(i=>!ids||ids.includes(i.id)).map(i=>{
  if(i.kind==='trigger'){const {readAt,deliveredTo,deliveredAt,...semantic}=i;return [i.id,stableDigest({input:semantic,trigger:host.store.triggers.get(i.triggerId)??null})]}
  return [i.id,stableDigest({input:i,...(i.kind==='resumed'?{trigger:host.store.triggers.get(i.triggerId)??null}:{})})]
 }))
}
const contextKey=(a:Authority)=>stableDigest([a.source,a.actor,a.discussion,a.scopeId,a.entryId])
function authority(host:Runtime,c:RouterContext):Authority {
 if(!c.trigger){
  if(c.scoped)return fail('recorded_context_required')
  const source=host.config.sources.find(s=>s.kind==='local'&&s.enabled),actor=source?.allowedActors[0]
  if(!source||!actor||!c.discussion)return fail('local_operator_unavailable')
  return {provenance:'local_operator',source:source.id,actor,discussion:c.discussion,scopeId:null,entryId:null,parentTrigger:null,mandateDigest:null}
 }
 const t=c.trigger,stored=t&&host.store.triggers.get(t.id)
 if(!t||!stored||stableDigest(t)!==stableDigest(stored))return fail('recorded_context_required')
 const mandate=host.routerIngress.authority(t.id,c.discussion),route=host.store.get<{scopeId:string;entryId:string}>('router-route',t.id)
 if(c.scoped&&(route?.scopeId!==c.scoped.route.scopeId||route?.entryId!==c.scoped.route.entryId))return fail('context_mismatch')
 return {provenance:'recorded_trigger',source:t.source,actor:t.actor.id,discussion:c.discussion,scopeId:route?.scopeId??null,entryId:route?.entryId??null,parentTrigger:t.id,mandateDigest:stableDigest(mandate)}
}
function readInterface(host:Runtime,id:string):AssignmentInterface|undefined {
 const stored=host.store.get<Omit<AssignmentInterface,'inputs'|'outputs'|'acceptance'>&{content?:{inputs?:string[];outputs?:string[];acceptance?:string[]}}>('assignment-interface',id)
 if(!stored)return undefined
 if(!Array.isArray(stored.content?.inputs)||!Array.isArray(stored.content?.outputs)||!Array.isArray(stored.content?.acceptance))return fail('interface_unavailable')
 const {content,...metadata}=stored
 return {...metadata,inputs:content!.inputs!,outputs:content!.outputs!,acceptance:content!.acceptance!}
}
function saveInterface(host:Runtime,iface:AssignmentInterface){
 const {inputs,outputs,acceptance,...metadata}=iface
 host.store.put('assignment-interface',iface.id,{...metadata,content:{inputs,outputs,acceptance}})
 host.store.put('assignment-interface-current',stableDigest([iface.contextDigest,iface.key]),metadata)
}
function resolveInterface(host:Runtime,a:Authority,spec:AssignmentSpec):AssignmentInterface|undefined {
 const requested=spec.interface;if(!requested)return
 const contextDigest=contextKey(a)
 if('id'in requested){const saved=readInterface(host,requested.id);if(!saved||saved.digest!==requested.digest||saved.contextDigest!==contextDigest||host.memory.cleanup.blocked('assignment-interface',saved.id,saved))return fail('interface_unavailable');const {digest,...body}=saved;if(stableDigest(body)!==digest)return fail('interface_corrupt');if(host.store.get<{id:string}>('assignment-interface-current',stableDigest([contextDigest,saved.key]))?.id!==saved.id)return fail('interface_superseded');return saved}
 const id='interface-'+stableDigest([contextDigest,requested.key,requested.version]),saved=readInterface(host,id)
 if(saved){const {digest,...body}=saved;if(stableDigest(body)!==digest||host.memory.cleanup.blocked('assignment-interface',id,saved))return fail('interface_unavailable')}
 const body={...requested,contextDigest,id,sourceId:a.source,scopeId:a.scopeId,entryId:a.entryId,triggerId:saved?.triggerId??a.parentTrigger},result={...body,digest:stableDigest(body)}
 if(saved&&saved.digest!==result.digest)return fail('interface_version_conflict')
 const current=host.store.get<AssignmentInterface>('assignment-interface-current',stableDigest([contextDigest,requested.key]))
 if(current&&(requested.version<current.version||requested.version===current.version&&result.digest!==current.digest))return fail('interface_superseded')
 return result
}
function dependencies(host:Runtime,a:Authority,spec:AssignmentSpec){return (spec.dependsOn??[]).map(ref=>{
 const task=host.store.tickets.get(ref.ticketId),delegation=host.taskAuthority(ref.ticketId)
 if(!task||!delegation?.parentTrigger||host.memory.cleanup.blocked('ticket',task.id,task)||task.ended?.by==='human'||task.assignments.at(-1)?.id!==ref.assignmentId)return fail('dependency_unavailable')
 const c={trigger:host.store.triggers.get(delegation.parentTrigger),discussion:delegation.discussion}
 if(contextKey(authority(host,c))!==contextKey(a))return fail('dependency_context')
 const goal=host.store.list<any>('router-goal').find(g=>host.goals.taskIdsForGoal(g).includes(task.id)),node=goal?.nodes?.find((n:any)=>n.ticketId===task.id)
 const round=node?.roundId?host.store.get<VerificationRound>('goal-verification',node.roundId):undefined
 if(!goal||goal.supersededBy||['cancelled','held','paused'].includes(goal.state)||node?.state!=='passed'||!round||round.state!=='passed'||round.goalId!==goal.id||round.nodeId!==node.id||!round.snapshot.tasks.some(t=>t.ticketId===task.id&&t.assignmentId===ref.assignmentId)||!host.verification.current(round,goal,{readOnly:true}))return fail('dependency_not_independently_accepted')
 return {...ref,roundId:round.id,digest:stableDigest(round)}
})}
function preview(host:Runtime,workerId:string,c:RouterContext,value:unknown,existing=false):AssignmentPreview {
 // Reconstruct personal-management eligibility from retained route/Chat identity,
 // never from a persisted boolean or an invented scope during a read.
 if(c.trigger&&host.store.get('router-route',c.trigger.id))c={...c,scoped:host.scopes.context(c.trigger,c.discussion)}
 const spec=assignmentSpecSchema.parse(value??{}),a=authority(host,c),worker=workerProfiles(host.config).find(w=>w.id===workerId)
 if(!worker||worker.state&&worker.state!=='enabled'&&!(existing&&worker.state==='retiring'))return fail('worker_unavailable')
 if(a.scopeId){const scope=host.scopes.scope(a.scopeId);if(!scope.workerIds.includes(workerId)||!scope.backendIds.includes(worker.backend))return fail('worker_outside_scope')}
 const policy=host.config.execution.management;if(!policy?.enabled||!host.chat.personalManagement(c)&&policy.backends&&!policy.backends.includes(worker.backend))return fail('backend_not_allowed')
 checkWorkerAdmission(host.config,worker.backend,worker)
 const source=host.sources.get(a.source)?.config;if(!source?.enabled)return fail('source_unavailable')
 if(spec.workspace&&('readPaths'in spec.workspace||'writePaths'in spec.workspace))return fail('path_constraints_unsupported')
 if(spec.workspace?.mode==='workspace-write'&&source.sandbox!=='workspace-write')return fail('workspace_escalation')
 const backend=host.config.backends[worker.backend]??{kind:'codex' as const},options=agentOptionsSchema.parse(mergeOptions(backend.defaults,Object.fromEntries(Object.entries(worker).filter(([k])=>k in agentOptionsSchema.shape))))
 const available=host.availableWorkerSpecs().map(t=>t.name),tools=unique(options.tools?available.filter(n=>options.tools!.includes(n)):available)
 const connections=unique((options.toolConnections??[]).filter(id=>host.config.toolConnections[id]?.enabled))
 const subset=(requested:string[]|undefined,allowed:string[],reason:string)=>{if(requested?.some(n=>!allowed.includes(n)))fail(reason);return unique(requested??allowed)}
 const selectedTools=subset(spec.allowedTools,tools,'tool_escalation'),selectedConnections=subset(spec.allowedConnections,connections,'connection_escalation')
 subset(spec.requiredTools,selectedTools,'required_tool_unavailable');subset(spec.requiredConnections,selectedConnections,'required_connection_unavailable')
 if(spec.limits&&!isApiBackend(backend)&&['maxSteps','maxToolCalls','maxOutputTokens'].some(k=>(spec.limits as any)[k]!==undefined))return fail('budget_unsupported')
 for(const k of ['timeoutMs','maxSteps','maxToolCalls','maxOutputTokens'] as const)if(spec.limits?.[k]!==undefined&&options[k]!==undefined&&spec.limits[k]!>options[k]!)return fail('budget_escalation')
 const bounded=boundedBackendOptions(worker.backend,backend,{...options,...spec.limits,tools:selectedTools,toolConnections:selectedConnections},host.config.turnTimeoutMs)
 return {spec,workerId,backendId:worker.backend,authority:a,interface:resolveInterface(host,a,spec),dependencies:dependencies(host,a,spec),effective:{tools:selectedTools,connections:selectedConnections,options:bounded,sandbox:spec.workspace?.mode??source.sandbox,network:host.config.work.network,sourceRoot:realpathSync(source.cwd)}}
}
export function previewTaskAssignment(host:Runtime,workerId:string,c:RouterContext,spec?:unknown):AssignmentPreview{return host.scopes.readOnly(()=>host.memory.readOnly(()=>preview(host,workerId,c,spec)))}
function referenceInterface(host:Runtime,ticketId:string,iface:AssignmentInterface|undefined,triggerId:string|null){
 if(!iface)return
 const previous=host.store.get<{ticketIds:string[];triggerIds:string[]}>('assignment-interface-reference',iface.id)
 if(previous&&(!Array.isArray(previous.ticketIds)||!Array.isArray(previous.triggerIds)||host.memory.cleanup.blocked('assignment-interface-reference',iface.id,previous)))return fail('interface_unavailable')
 host.store.put('assignment-interface-reference',iface.id,{id:iface.id,sourceId:iface.sourceId,scopeId:iface.scopeId,entryId:iface.entryId,ticketIds:unique([...(previous?.ticketIds??[]),ticketId]),triggerIds:unique([...(previous?.triggerIds??[]),...(triggerId?[triggerId]:[])])})
}
export function commitTaskAssignment(host:Runtime,ticketId:string,workerId:string,c:RouterContext,spec?:unknown):TaskAssignmentContract{return host.store.atomic(()=>{
 const p=previewTaskAssignment(host,workerId,c,spec),task=host.store.tickets.get(ticketId),delegation=host.taskAuthority(ticketId)
 if(!task||host.store.get<{workerId:string}>('worker-assignment',ticketId)?.workerId!==workerId||(delegation?.parentTrigger??null)!==p.authority.parentTrigger||delegation?.source!==p.authority.source||delegation?.actor!==p.authority.actor||p.authority.provenance==='local_operator'&&delegation?.mode!=='client'||delegation.discussion!==c.discussion)return fail('task_binding')
 const body={...p,schema:1 as const,ticketId,objective:taskView(host.store,task).mandate.scope,inputIds:taskView(host.store,task).inputs.map(i=>i.id),inputDigests:inputDigests(host,ticketId),triggerDigests:Object.fromEntries(task.origin.triggerIds.map(id=>[id,stableDigest(host.store.triggers.get(id)??null)]))},digest=stableDigest(body),old=host.store.get<TaskAssignmentContract>('task-assignment-contract',ticketId)
 if(old){if(old.digest!==digest)return fail('immutable');return old}
 host.store.requireTaskAssignmentSchema()
 const result={...body,digest,createdAt:Date.now()}
 if(p.interface)saveInterface(host,p.interface)
 referenceInterface(host,ticketId,p.interface,p.authority.parentTrigger)
 host.store.put('task-assignment-contract',ticketId,result);return result
})}
export function currentTaskAssignment(host:Runtime,ticketId:string):TaskAssignmentContract|undefined {
 const pointer=host.store.get<{digest:string}>('task-assignment-current',ticketId)
 if(!pointer)return host.store.get<TaskAssignmentContract>('task-assignment-contract',ticketId)
 const current=host.store.get<TaskAssignmentContract>('task-assignment-revision',pointer.digest)
 if(!current||current.ticketId!==ticketId||current.digest!==pointer.digest)return fail('revision_pointer_corrupt')
 const seen=new Set<string>();let item=current
 while(item.previousDigest){
  const {digest,createdAt,...body}=item;if(stableDigest(body)!==digest||seen.has(digest)||seen.size>=1000)return fail('revision_chain_corrupt')
  seen.add(digest)
  const parent=host.store.get<TaskAssignmentContract>('task-assignment-revision',item.previousDigest)??host.store.get<TaskAssignmentContract>('task-assignment-contract',ticketId)
  if(!parent||parent.digest!==item.previousDigest||parent.ticketId!==ticketId||(parent.revision??1)+1!==item.revision)return fail('revision_chain_corrupt')
  item=parent
 }
 const {digest,createdAt,...root}=item;if(stableDigest(root)!==digest)return fail('revision_chain_corrupt')
 return current
}
export function validateTaskAssignment(host:Runtime,ticketId:string):TaskAssignmentContract|undefined{return host.scopes.readOnly(()=>host.memory.readOnly(()=>{
 const saved=currentTaskAssignment(host,ticketId);if(!saved)return
 const {digest,createdAt,...body}=saved;if(stableDigest(body)!==digest||host.memory.cleanup.blocked('task-assignment-contract',ticketId,saved))return fail('corrupt_or_cleaned')
 const task=host.store.tickets.get(ticketId),a=host.taskAuthority(ticketId),original=host.store.get<{workerId:string;parentTrigger?:string;source:string;actor:string;discussion:string;mode:string}>('worker-assignment',ticketId)
 // Personal Chat legitimately rebinds its mutable delegation to a later turn.
 // The original completed command receipt retains the initial assignment provenance.
 const originalBound=(original?.parentTrigger??null)===saved.authority.parentTrigger&&original?.discussion===saved.authority.discussion||host.store.list<any>('worker-command').some(r=>r.status==='completed'&&r.result?.ticketId===ticketId&&r.result.workerId===saved.workerId&&(r.result.parentTrigger??null)===saved.authority.parentTrigger&&r.result.discussion===saved.authority.discussion&&r.result.source===saved.authority.source&&r.result.actor===saved.authority.actor)

 if(!task||task.ended?.by==='human'||!saved.cause&&!originalBound||saved.authority.provenance==='local_operator'&&a?.mode!=='client'||host.store.get<{workerId:string}>('worker-assignment',ticketId)?.workerId!==saved.workerId||!host.scopes.taskRunnable(ticketId)||!host.webhooks.taskExecutionAllowed(ticketId))return fail('authority_ended')
 if(a?.parentTrigger&&a.parentTrigger!==saved.authority.parentTrigger){
  const trigger=host.store.triggers.get(a.parentTrigger),current=authority(host,{trigger,discussion:a.discussion})
  if(contextKey(current)!==contextKey(saved.authority)){
   if(!trigger||!saved.authority.scopeId||current.scopeId!==saved.authority.scopeId||!current.entryId)return fail('context_changed')
   const context=host.scopes.context(trigger,a.discussion);if(!context)return fail('context_changed')
   host.scopes.checkTask(ticketId,context,true);host.scopes.checkTaskEntry(host.scopes.ownership(ticketId)!,current.entryId,'context')
  }
 }else if(a?.source!==saved.authority.source||a?.actor!==saved.authority.actor)return fail('context_changed')
 if(!saved.triggerDigests||Object.entries(saved.triggerDigests).some(([id,hash])=>stableDigest(host.store.triggers.get(id)??null)!==hash))return fail('initial_input_changed')
 if(stableDigest(inputDigests(host,ticketId,saved.inputIds))!==stableDigest(saved.inputDigests))return fail('initial_input_changed')
 const p=preview(host,saved.workerId,{trigger:saved.authority.parentTrigger?host.store.triggers.get(saved.authority.parentTrigger):undefined,discussion:saved.authority.discussion},saved.spec,true)
 if(stableDigest(p.authority)!==stableDigest(saved.authority)||stableDigest(p.dependencies)!==stableDigest(saved.dependencies))return fail('basis_changed')
 if(saved.interface)resolveInterface(host,p.authority,{interface:{id:saved.interface.id,digest:saved.interface.digest}})
 if(saved.effective.tools.some(t=>!p.effective.tools.includes(t))||saved.effective.connections.some(t=>!p.effective.connections.includes(t))||p.backendId!==saved.backendId||p.effective.sourceRoot!==saved.effective.sourceRoot||saved.effective.sandbox==='workspace-write'&&p.effective.sandbox!=='workspace-write')return fail('capability_changed')
 return saved
}))}
export function bindTaskAssignmentLease(host:Runtime,owner:WorkOwner,effective:{backendId:string;tools:string[];options:AgentOptions}):TaskWorkspaceLease|undefined{return host.store.atomic(()=>{
 const c=validateTaskAssignment(host,owner.ticketId);if(!c)return
 const task=host.store.tickets.get(owner.ticketId);if(!task||task.ended||task.assignments.at(-1)?.id!==owner.assignmentId||task.assignments.at(-1)?.state!=='running')return fail('authority_ended')
 if(lstatSync(owner.cwd).isSymbolicLink())return fail('workspace_symlink')
 const stat=statSync(owner.cwd);if(!stat.isDirectory())return fail('workspace_not_directory')
 const directoryIdentity={dev:String(stat.dev),ino:String(stat.ino)}
 const cwd=realpathSync(owner.cwd),run=host.store.get<{cwd:string}>('run',owner.ticketId)
 if(!run||realpathSync(run.cwd)!==cwd||owner.sandbox==='workspace-write'&&c.effective.sandbox!=='workspace-write'||!!owner.network&&!c.effective.network||effective.backendId!==c.backendId)return fail('lease_mismatch')
 const tools=unique(effective.tools),connections=unique(effective.options.toolConnections??[])
 if(tools.some(t=>!c.effective.tools.includes(t))||connections.some(t=>!c.effective.connections.includes(t))||c.spec.requiredTools?.some(t=>!tools.includes(t))||c.spec.requiredConnections?.some(t=>!connections.includes(t)))return fail('lease_capability_mismatch')
 for(const k of ['timeoutMs','maxSteps','maxToolCalls','maxOutputTokens'] as const){const cap=c.effective.options[k];if(cap!==undefined&&(effective.options[k]===undefined||effective.options[k]!>cap))return fail('lease_budget_mismatch')}
 const suppliedLeaseId=(owner as WorkOwner&{leaseId?:string}).leaseId,supplied=suppliedLeaseId?host.store.get<TaskWorkspaceLease>('task-workspace-lease',suppliedLeaseId):undefined
 const parentLeaseId=owner.agentId?(supplied?.agentId===owner.agentId?supplied.parentLeaseId:suppliedLeaseId):undefined
 if(owner.agentId){
  const parent=parentLeaseId?host.store.get<TaskWorkspaceLease>('task-workspace-lease',parentLeaseId):undefined
  if(!parent||host.store.get<{id:string}>('task-workspace-lease-current',stableDigest([parent.ticketId,parent.assignmentId,parent.agentId??null]))?.id!==parent.id||parent.contractDigest!==c.digest||parent.assignmentId!==owner.assignmentId||parent.cwd!==cwd||tools.some(t=>!parent.tools.includes(t))||connections.some(t=>!parent.connections.includes(t))||owner.sandbox==='workspace-write'&&parent.sandbox!=='workspace-write'||!!owner.network&&!parent.network)return fail('parent_lease_unavailable')
  for(const k of ['timeoutMs','maxSteps','maxToolCalls','maxOutputTokens'] as const)if(parent.options[k]!==undefined&&(effective.options[k]===undefined||effective.options[k]!>parent.options[k]!))return fail('parent_lease_budget')
 }
 const permissionOptions:AgentOptions={tools,toolConnections:connections,...Object.fromEntries(['timeoutMs','maxSteps','maxToolCalls','maxOutputTokens'].filter(k=>(effective.options as any)[k]!==undefined).map(k=>[k,(effective.options as any)[k]]))}
 const id=stableDigest([owner.ticketId,owner.assignmentId,c.digest,cwd,directoryIdentity,owner.agentId??null,owner.sandbox,!!owner.network,effective.backendId,permissionOptions]),lease:TaskWorkspaceLease={schema:1,id,ticketId:owner.ticketId,assignmentId:owner.assignmentId,contractDigest:c.digest,cwd,directoryIdentity,sandbox:owner.sandbox,network:!!owner.network,backendId:effective.backendId,tools,connections,options:permissionOptions,...(owner.agentId?{agentId:owner.agentId,parentLeaseId}:{}),at:Date.now()}
 const pointer=host.store.get<{id:string}>('task-workspace-lease-current',stableDigest([owner.ticketId,owner.assignmentId,owner.agentId??null])),previous=pointer?host.store.get<TaskWorkspaceLease>('task-workspace-lease',pointer.id):undefined
 if(previous&&(previous.cwd!==cwd||stableDigest(previous.directoryIdentity)!==stableDigest(directoryIdentity)))return fail('workspace_identity_changed')
 const old=host.store.get<TaskWorkspaceLease>('task-workspace-lease',id)
 if(old){if(host.store.get<{id:string}>('task-workspace-lease-current',stableDigest([owner.ticketId,owner.assignmentId,owner.agentId??null]))?.id!==old.id)return fail('lease_superseded');if(stableDigest({...old,at:0})!==stableDigest({...lease,at:0}))return fail('lease_immutable');return old}
 host.store.put('task-workspace-lease',id,lease);host.store.put('task-workspace-lease-current',stableDigest([owner.ticketId,owner.assignmentId,owner.agentId??null]),{ticketId:owner.ticketId,assignmentId:owner.assignmentId,agentId:owner.agentId,id});return lease
})}
export function assertAssignmentTool(host:Runtime,ticketId:string,name:string,connection?:string):void {
 const c=validateTaskAssignment(host,ticketId);if(!c)return
 if(!c.effective.tools.includes(name))fail('tool_not_allowed')
 if(connection&&!c.effective.connections.includes(connection))fail('connection_not_allowed')
}

export function validateAssignmentLease(host:Runtime,owner:WorkOwner):boolean {
 try{
 const c=validateTaskAssignment(host,owner.ticketId);if(!c)return true
 const id=(owner as WorkOwner&{leaseId?:string}).leaseId,lease=id?host.store.get<TaskWorkspaceLease>('task-workspace-lease',id):undefined
 const run=host.store.get<{cwd:string;backendId?:string}>('run',owner.ticketId)
 if(!run||realpathSync(run.cwd)!==realpathSync(owner.cwd))return false
 if(host.store.get<{id:string}>('task-workspace-lease-current',stableDigest([owner.ticketId,owner.assignmentId,owner.agentId??null]))?.id!==id)return false
 if(!lease||lease.ticketId!==owner.ticketId||lease.assignmentId!==owner.assignmentId||lease.contractDigest!==c.digest||realpathSync(owner.cwd)!==lease.cwd||owner.sandbox!==lease.sandbox||!!owner.network!==lease.network||lease.backendId!==c.backendId)return false
 if(lstatSync(owner.cwd).isSymbolicLink())return false
 const stat=statSync(owner.cwd);if(!stat.isDirectory()||String(stat.dev)!==lease.directoryIdentity?.dev||String(stat.ino)!==lease.directoryIdentity?.ino)return false
 let current:TaskWorkspaceLease|undefined=lease;const visited=new Set<string>()
 while(current){
  if(visited.has(current.id)||visited.size>=32||current.ticketId!==owner.ticketId||current.assignmentId!==owner.assignmentId||current.contractDigest!==c.digest||current.cwd!==lease.cwd||stableDigest(current.directoryIdentity)!==stableDigest(lease.directoryIdentity)||host.memory.cleanup.blocked('task-workspace-lease',current.id,current))return false
  visited.add(current.id)
  if(host.store.get<{id:string}>('task-workspace-lease-current',stableDigest([current.ticketId,current.assignmentId,current.agentId??null]))?.id!==current.id)return false
  if(!current.parentLeaseId)break
  current=host.store.get<TaskWorkspaceLease>('task-workspace-lease',current.parentLeaseId);if(!current)return false
 }

 return !host.memory.cleanup.blocked('task-workspace-lease',lease.id,lease)
 }catch{return false}
}
export interface AssignmentExecution {backendId:string;tools:string[];options:AgentOptions;sandbox:WorkOwner['sandbox'];network:boolean}
export function restrictAssignmentExecution(host:Runtime,ticketId:string,effective:AssignmentExecution):AssignmentExecution {
 const c=validateTaskAssignment(host,ticketId);if(!c)return effective
 if(effective.backendId!==c.backendId)return fail('backend_changed')
 const tools=unique(effective.tools.filter(t=>c.effective.tools.includes(t))),connections=unique((effective.options.toolConnections??[]).filter(t=>c.effective.connections.includes(t)))
 if(c.spec.requiredTools?.some(t=>!tools.includes(t))||c.spec.requiredConnections?.some(t=>!connections.includes(t)))return fail('required_capability_unavailable')
 const options={...effective.options,tools,toolConnections:connections}
 for(const k of ['timeoutMs','maxSteps','maxToolCalls','maxOutputTokens'] as const){const cap=c.effective.options[k];if(cap!==undefined)options[k]=Math.min(options[k]??cap,cap)}
 const backend=host.config.backends[effective.backendId]??{kind:'codex' as const}
 checkWorkerAdmission(host.config,effective.backendId,options)
 return {...effective,tools,options:boundedBackendOptions(effective.backendId,backend,options,host.config.turnTimeoutMs),sandbox:c.effective.sandbox==='read-only'?'read-only':effective.sandbox,network:effective.network&&c.effective.network}
}
export function assignmentContractView(host:Runtime,ticketId:string){try{return host.scopes.readOnly(()=>host.memory.readOnly(()=>{
 let contract:TaskAssignmentContract|undefined;try{contract=currentTaskAssignment(host,ticketId)}catch{return undefined}if(!contract||host.memory.cleanup.blocked('task-assignment-contract',ticketId,contract))return undefined
 if(contract.schema!==1||!contract.effective||!contract.authority||!contract.spec||!Array.isArray(contract.inputIds)||!contract.inputDigests||!contract.triggerDigests||!Array.isArray(contract.effective.tools)||!Array.isArray(contract.effective.connections)||!Array.isArray(contract.dependencies))return undefined
 const {digest,createdAt,...body}=contract;if(stableDigest(body)!==digest)return undefined
 // Execution blockers can be shown historically, but permission rebuilds and
 // revoked original readers must never receive quarantined contract text.
 if(host.store.get('task-continuation',ticketId)&&contract.cause?.kind!=='rebuild')return undefined
 try{
  const source=host.sources.get(contract.authority.source)?.config;if(!source?.enabled||!source.allowedActors.includes(contract.authority.actor))return undefined
  const original=authority(host,{trigger:contract.authority.parentTrigger?host.store.triggers.get(contract.authority.parentTrigger):undefined,discussion:contract.authority.discussion})
  if(stableDigest(original)!==stableDigest(contract.authority))return undefined
  const owner=host.scopes.ownership(ticketId)
  if(owner&&contract.authority.entryId)host.scopes.checkTaskEntry(owner,contract.authority.entryId,'context')
 }catch{return undefined}
 let blocker:string|undefined;try{validateTaskAssignment(host,ticketId)}catch(e){blocker=e instanceof Error?e.message:'assignment_contract_unavailable'}
 return {contract,leases:host.store.list<TaskWorkspaceLease>('task-workspace-lease').filter(l=>l.ticketId===ticketId&&l.contractDigest===contract!.digest),...(blocker?{blocker}:{})}
}))}catch{return undefined}}

export function assertAssignmentConnection(host:Runtime,ticketId:string,connection:string):void {
 const c=validateTaskAssignment(host,ticketId);if(c&&!c.effective.connections.includes(connection))fail('connection_not_allowed')
}

export function assertAssignmentLeaseCapability(host:Runtime,owner:WorkOwner,name?:string,connection?:string):void {
 if(!currentTaskAssignment(host,owner.ticketId))return
 if(!validateAssignmentLease(host,owner))fail('lease_ended')
 const lease=host.store.get<TaskWorkspaceLease>('task-workspace-lease',owner.leaseId!)!
 if(name&&!lease.tools.includes(name))fail('lease_tool_not_allowed')
 if(connection&&!lease.connections.includes(connection))fail('lease_connection_not_allowed')
}

export function reviseTaskAssignment(host:Runtime,ticketId:string,workerId:string,context:RouterContext,request:{kind:'migration'|'rebuild';commandId:string;fingerprint:string;expectedDigest:string;spec?:unknown}):TaskAssignmentContract {
 return host.store.atomic(()=>{
  const old=currentTaskAssignment(host,ticketId);if(!old||old.digest!==request.expectedDigest)return fail('revision_conflict')
  if(!request.commandId||!request.fingerprint)return fail('revision_cause_required')
  const task=host.store.tickets.get(ticketId);if(!task||task.ended?.by==='human')return fail('task_unavailable')
  const held=host.store.get<{reason:string}>('context-rebuild',ticketId),narrowed=request.kind==='rebuild'&&held?.reason==='context_permissions_changed'
  if(request.kind==='rebuild'&&!['context_permissions_changed','context_budget_exceeded'].includes(held?.reason??''))return fail('rebuild_context_required')
  const continuation=host.store.get<{triggerId:string;discussion:string}>('task-continuation',ticketId)
  if(narrowed&&(!continuation||continuation.triggerId!==context.trigger?.id||continuation.discussion!==context.discussion))return fail('rebuild_context_required')
  const current=previewTaskAssignment(host,workerId,context),oldSpec=narrowed?{}:old.spec
  if(!narrowed){
   const prior=authority(host,{trigger:old.authority.parentTrigger?host.store.triggers.get(old.authority.parentTrigger):undefined,discussion:old.authority.discussion})
   if(contextKey(prior)!==contextKey(current.authority))return fail('migration_context_changed')
  }
  const requested=assignmentSpecSchema.parse(request.spec??oldSpec)
  if(narrowed&&(requested.interface||requested.dependsOn?.length))return fail('rebuild_requires_fresh_contract')
  const tools=old.effective.tools.filter(t=>current.effective.tools.includes(t)),connections=old.effective.connections.filter(t=>current.effective.connections.includes(t))
  if(requested.allowedTools?.some(t=>!old.effective.tools.includes(t))||requested.allowedConnections?.some(t=>!old.effective.connections.includes(t)))return fail('revision_escalation')
  const limits={...requested.limits}
  for(const key of ['timeoutMs','maxSteps','maxToolCalls','maxOutputTokens'] as const){const cap=old.effective.options[key],now=current.effective.options[key];if(cap!==undefined){if(limits[key]!==undefined&&limits[key]!>cap)return fail('revision_budget_escalation');limits[key]=Math.min(cap,now??cap,limits[key]??cap)}}
  const spec:AssignmentSpec={...requested,allowedTools:tools.filter(t=>!requested.allowedTools||requested.allowedTools.includes(t)),allowedConnections:connections.filter(t=>!requested.allowedConnections||requested.allowedConnections.includes(t)),workspace:{mode:old.effective.sandbox==='read-only'?'read-only':current.effective.sandbox},limits}
  const p=previewTaskAssignment(host,workerId,context,spec)
  p.effective.network=p.effective.network&&old.effective.network
  if(!narrowed&&(stableDigest(p.interface??null)!==stableDigest(old.interface??null)||stableDigest(p.dependencies)!==stableDigest(old.dependencies)||p.effective.sourceRoot!==old.effective.sourceRoot))return fail('migration_interface_changed')
  const view=taskView(host.store,task),body={...p,schema:1 as const,ticketId,revision:(old.revision??1)+1,previousDigest:old.digest,cause:{kind:request.kind,commandId:request.commandId,fingerprint:request.fingerprint,triggerId:context.trigger?.id??null,actor:p.authority.actor},objective:narrowed?view.mandate.scope:old.objective,inputIds:view.inputs.map(i=>i.id),inputDigests:inputDigests(host,ticketId),triggerDigests:Object.fromEntries(view.origin.triggerIds.map(id=>[id,stableDigest(host.store.triggers.get(id)??null)]))},digest=stableDigest(body),revision={...body,digest,createdAt:Date.now()}
  host.store.requireTaskAssignmentSchema()
  referenceInterface(host,ticketId,p.interface,p.authority.parentTrigger)
  host.store.put('task-assignment-revision',digest,revision);host.store.put('task-assignment-current',ticketId,{ticketId,digest,revision:revision.revision})
  return revision
 })
}
