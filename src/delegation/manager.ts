import {randomBytes,randomUUID,createHash} from 'node:crypto'
import {existsSync,realpathSync,lstatSync,readFileSync,unlinkSync,openSync,fstatSync,statSync,closeSync,constants} from 'node:fs'
import {join,relative,isAbsolute} from 'node:path'
import {z} from 'zod'
import {DelegatedGoals,type GoalDelegationRef} from './goals.ts'
import type {Runtime} from '../runtime.ts'
import type {RouterContext} from '../worker-manager.ts'
import type {ManagementScope} from '../router-scope.ts'
import type {Mandate,Trigger,OutboundMessage} from '../vendor/dsh-core/index.ts'
import type {ModelRequest} from '../model.ts'
import {stableDigest,bodyDigest} from '../sources.ts'
import {isHostPrivateFile} from '../private-files.ts'
import {workerProfiles} from '../worker-pool.ts'
import {DELEGATION_DB_SCHEMA} from '../store.ts'
import {retainWebhookProtocol} from '../webhook-schema.ts'
import {contractSchema,delegationConfigSchema,teamCommandSchema,permissionsSchema,limitsSchema,requireDelegation,DelegationError,type DelegationContract,type DelegationPermissions,type DelegationLimits} from './contract.ts'
import {readIdentity,publicIdentity,publicIdentitySchema,packet,validatePacket,validateEndpoint,type InstanceIdentity,type PublicIdentity} from './identity.ts'

interface ExportPolicy {
 sourceId:string;workerIds:string[];permissions:DelegationPermissions;limits:DelegationLimits;scopeId?:string
}
interface Peer {
 id:string;identity:PublicIdentity;active:boolean;policy:ExportPolicy;ticketId:string;features?:string[]
}
interface Connection {
 id:string;identity:PublicIdentity;endpoint:string;active:boolean;policy:ExportPolicy;checkedAt:number;grantId:string;features?:string[]
}
interface Artifact {
 id:string;name:string;sha256:string;size:number;data:string;ticketId:string
}
const workerReportSchema=z.object({
 id:z.string().regex(/^[a-f0-9]{64}$/),ticketId:z.string().max(500),workerId:z.string().max(100),
 state:z.literal('ready'),at:z.string().max(100),summary:z.string().max(8000),
}).strict()
const executionSchema=z.object({
 version:z.literal(1),basis:z.literal('peer-host-managed-tools'),complete:z.boolean(),managed:z.boolean(),
 taskCount:z.number().int().min(1).max(100),jobCount:z.number().int().nonnegative(),externalToolCount:z.number().int().nonnegative(),
 toolCalls:z.array(z.object({id:z.string().max(100),ticketId:z.string().max(500),name:z.string().max(100),state:z.enum(['running','completed','failed','interrupted'])}).strict()).max(200),
}).strict()
export interface RemoteTask {
 id:string;peerId:string;grantId:string;contract:DelegationContract;hash:string;triggerId:string;discussion:string;
 state:'accepted'|'running'|'ready'|'blocked'|'cancelled';desired:'running'|'cancelled';
 revision:number;controlEpoch:number;leaseUntil:number;activations:number;createdAt:number;
 replies:{id:string;text:string}[];artifacts:Artifact[];workerReports?:z.infer<typeof workerReportSchema>[];execution?:z.infer<typeof executionSchema>;reason?:string
}
export interface OutboundTask {
 id:string;connectionId:string;targetId:string;contract:DelegationContract;contractHash:string;
 triggerId:string;discussion:string;scopeId?:string;manifestId?:string;
 state:'pending'|'acknowledged'|'reconcile_required';desired:'running'|'cancelled';
 controlEpoch:number;remote?:RemoteTask;lastCheckedAt?:number;nextAt:number;
 acceptance:'pending'|'passed';reviewedEvidence?:string[];lastNotified?:number;error?:string;
 goal?:GoalDelegationRef;acceptedBy?:'goal-verification';verificationRoundId?:string
}
const ticketSchema=z.object({
 version:z.literal(1),id:z.string().uuid(),identity:publicIdentitySchema,
 endpoint:z.string().max(2000),code:z.string().regex(/^[a-f0-9]{64}$/),expiresAt:z.number().int().positive(),
}).strict()
export type PairingTicket=z.infer<typeof ticketSchema>
const pairBody=z.object({ticket:ticketSchema,peer:publicIdentitySchema}).strict()
const remoteTaskSchema=z.object({
 id:z.string().min(1).max(100),peerId:z.string().min(1).max(100),grantId:z.string().uuid(),contract:contractSchema,hash:z.string().regex(/^[a-f0-9]{64}$/),
 triggerId:z.string().max(500),discussion:z.string().max(600),state:z.enum(['accepted','running','ready','blocked','cancelled']),
 desired:z.enum(['running','cancelled']),revision:z.number().int().positive(),controlEpoch:z.number().int().nonnegative(),
 leaseUntil:z.number().int().nonnegative(),activations:z.number().int().nonnegative(),createdAt:z.number().int().positive(),reason:z.string().max(500).optional(),
 replies:z.array(z.object({id:z.string().min(1).max(1000),text:z.string().max(24000)}).strict()).max(20),
 workerReports:z.array(workerReportSchema).max(100).optional(),
 execution:executionSchema.optional(),
 artifacts:z.array(z.object({id:z.string().regex(/^[a-f0-9]{64}$/),name:z.string().max(200),sha256:z.string().regex(/^[a-f0-9]{64}$/),size:z.number().int().nonnegative().max(1000000),data:z.string().max(1333336),ticketId:z.string().max(500)}).strict()).max(10),
}).strict()
const errorText=(e:unknown)=>e instanceof DelegationError?e.code:'delegation_unavailable'
const terminal=(t:RemoteTask)=>t.state==='ready'||t.state==='cancelled'
const safeTools=new Set(['superagent_read','superagent_job','superagent_progress','superagent_artifact'])

/** A durable host-to-host task adapter. It never impersonates a human operator. */
export class Delegations {
 readonly goalTasks:DelegatedGoals
 private identityValue?:InstanceIdentity
 private endpointValue?:string
 private pending?:Promise<void>
 private expiring?:Promise<void>
 private closing=false
 private readonly shutdown=new AbortController()
 constructor(private readonly host:Runtime){
  this.goalTasks=new DelegatedGoals(host,this)
  if(host.config.delegation?.enabled){
   const pinned=host.store.get<PublicIdentity>('delegation-identity','current')
   requireDelegation(!pinned||existsSync(join(host.config.stateDir,'delegation-identity.json')),'delegation_identity_missing')
   this.identityValue=readIdentity(host.config.stateDir)
   requireDelegation(!pinned||pinned.id===this.identityValue.id&&pinned.publicKey===this.identityValue.publicKey,'delegation_identity_changed')
   host.store.atomic(()=>{
    retainWebhookProtocol(host.store.db)
    host.store.put('delegation-identity','current',publicIdentity(this.identityValue!))
    host.store.db.exec('PRAGMA user_version='+Math.max(DELEGATION_DB_SCHEMA,Number(host.store.db.prepare('PRAGMA user_version').get()!.user_version)))
   })

  }
 }
 get deploymentConfig(){return this.host.config.delegation??delegationConfigSchema.parse({})}
 get recoveryRequired(){return existsSync(join(this.host.config.stateDir,'delegation-restored.json'))}
 get enabled(){return this.deploymentConfig?.enabled&&!!this.identityValue&&!this.closing&&!this.recoveryRequired}
 get identity(){requireDelegation(this.enabled,'delegation_disabled',409);return this.identityValue!}
 get preferredPort(){return this.deploymentConfig.port||(this.host.store.get<{port:number}>('delegation-listener','current')?.port??0)}
 bindEndpoint(value:string){this.endpointValue=validateEndpoint(value);this.host.store.put('delegation-listener','current',{port:Number(new URL(value).port)})}
 get endpoint(){return this.endpointValue}
 private revision(){return this.host.settings.current().revision}
 private projectedTasks<T>(kind:'delegation-outbound'|'delegation-inbound',triggerId?:string):T[]{
  const prefix=kind==='delegation-outbound'?'$.remote.artifacts':'$.artifacts'
  const paths=Array.from({length:10},(_,i)=>prefix+'['+i+'].data')
  const filter=triggerId?' AND json_extract(body,\'$.discussion\')=?':''
  return this.host.store.db.prepare('SELECT json_remove(body,'+paths.map(()=>'?').join(',')+') AS body FROM records WHERE kind=? AND json_type(body,\'$.contract\')=\'object\' AND COALESCE(json_extract(body,\'$.deleted\'),0)<>1'+filter+' ORDER BY rowid DESC LIMIT 25')
   .all(...paths,kind,...(triggerId?[triggerId]:[])).map(row=>JSON.parse(String(row.body)) as T)
 }
 private peer(id:string){
  const p=this.host.store.get<Peer>('delegation-peer',id)
  requireDelegation(p?.active,'peer_not_authorized',403);return p
 }
 private connection(id:string){
  const c=this.host.store.get<Connection>('delegation-connection',id)
  requireDelegation(c?.active,'connection_revoked',403);return c
 }
 private source(){
  const source=this.host.config.sources.find(s=>s.id===this.deploymentConfig.sourceId&&s.kind==='delegation')
  requireDelegation(source?.enabled&&source.capabilities.events,'delegation_source_unavailable',409)
  requireDelegation(this.host.config.execution.router?.mode==='host','managed_router_required',409)
  return source
 }
 private exportPolicy(value:unknown):ExportPolicy{
  const x=z.object({workerIds:z.array(z.string().min(1)).min(1).max(10),permissions:permissionsSchema.prefault({}),limits:limitsSchema.prefault({}),scopeId:z.string().optional()}).strict().parse(value)
  const source=this.source()
  requireDelegation(x.workerIds.every(id=>workerProfiles(this.host.config).some(w=>w.id===id)),'unknown_export_worker')
  requireDelegation(!x.permissions.write||source.sandbox==='workspace-write','export_write_not_allowed')
  requireDelegation(!x.permissions.network||this.host.config.work.network,'export_network_not_allowed')
  if(this.host.scopes.enabled()){
   requireDelegation(x.scopeId,'export_scope_required')
   const s=this.host.scopes.scope(x.scopeId)
   requireDelegation(s.sourceIds.includes(source.id)&&x.workerIds.every(id=>s.workerIds.includes(id)),'export_scope_mismatch')
  }
  return {...x,sourceId:source.id}
 }
 pairing(value:unknown){
  requireDelegation(this.endpointValue,'delegation_listener_unavailable',409)
  const x=z.object({expectedRevision:z.number().int(),policy:z.unknown()}).strict().parse(value)
  requireDelegation(x.expectedRevision===this.revision(),'settings_conflict',409)
  const policy=this.exportPolicy(x.policy),id=randomUUID(),code=randomBytes(32).toString('hex'),expiresAt=Date.now()+300000
  this.host.store.put('delegation-pairing',id,{id,codeHash:stableDigest(code),expiresAt,policy})
  return {version:1,id,identity:publicIdentity(this.identity),endpoint:this.endpointValue,code,expiresAt}
 }
 async connect(value:unknown){
  const x=z.object({ticket:ticketSchema,label:z.string().trim().min(1).max(100),expectedRevision:z.number().int()}).strict().parse(value)
  requireDelegation(x.expectedRevision===this.revision(),'settings_conflict',409)
  const identity=this.identity,endpoint=validateEndpoint(x.ticket.endpoint)
  requireDelegation(x.ticket.identity.id!==identity.id,'self_connection_forbidden')
  const body={ticket:x.ticket,peer:publicIdentity(identity)}
  const response=await this.request({id:x.ticket.identity.id,identity:x.ticket.identity,endpoint},'pair',body)
  const policy=z.object({sourceId:z.string(),workerIds:z.array(z.string()),permissions:permissionsSchema,limits:limitsSchema,scopeId:z.string().optional()}).strict().parse(response)
  let features:string[]=[]
  try{
   const capability=z.object({version:z.literal(1),features:z.array(z.string()).max(10)}).strict().parse(await this.request({id:x.ticket.identity.id,identity:x.ticket.identity,endpoint,grantId:x.ticket.id},'capabilities',{id:'capabilities',features:['execution-ledger-v1']}))
   features=capability.features.filter(f=>f==='execution-ledger-v1')
  }catch(error){if(!(error instanceof DelegationError)||!['unsupported_operation','task_not_found','invalid_service_request'].includes(error.code))throw error}
  requireDelegation(x.expectedRevision===this.revision(),'settings_conflict',409)
  return this.host.store.atomic(()=>{
   const old=this.host.store.get<Connection>('delegation-connection',x.ticket.identity.id)
   requireDelegation(!old||old.identity.publicKey===x.ticket.identity.publicKey,'instance_identity_changed',409)
   const connection:Connection={id:x.ticket.identity.id,identity:x.ticket.identity,endpoint,active:true,policy,checkedAt:Date.now(),grantId:x.ticket.id,features}
   this.host.store.put('delegation-connection',connection.id,connection)
   const targets=(this.host.config.execution.teamTargets??[]).filter(t=>t.connectionId!==connection.id)
   const target={id:connection.id,label:x.label,connectionId:connection.id,mode:'managed-team' as const,state:'enabled' as const,permissions:policy.permissions,limits:policy.limits}
   this.host.updateSettings(x.expectedRevision,{execution:{...this.host.config.execution,teamTargets:[...targets,target]}})
   return {id:connection.id,connected:true,taskVerified:false}
  })
 }
 async receive(value:unknown){
  const raw=z.object({issuer:z.string(),operation:z.string(),body:z.unknown()}).passthrough().parse(value)
  if(raw.operation==='pair'){
   const body=pairBody.parse(raw.body),p=validatePacket(value,body.peer,this.identity.id)
   requireDelegation(body.peer.id!==this.identity.id&&body.peer.publicKey!==this.identity.publicKey,'self_connection_forbidden')
   requireDelegation(body.ticket.identity.id===this.identity.id&&body.ticket.identity.publicKey===this.identity.publicKey,'wrong_pairing_instance')
   const ticket=this.host.store.get<any>('delegation-pairing',body.ticket.id)
   requireDelegation(ticket&&ticket.codeHash===stableDigest(body.ticket.code),'invalid_pairing_ticket',403)
   const peer=this.host.store.get<Peer>('delegation-peer',p.issuer)
   if(ticket.usedBy){
    requireDelegation(ticket.usedBy===p.issuer&&peer?.active&&peer.ticketId===ticket.id&&peer.identity.publicKey===body.peer.publicKey,'pairing_ticket_consumed',403)
    return peer.policy
   }
   requireDelegation(ticket.expiresAt>Date.now(),'pairing_ticket_expired',403)
   requireDelegation(!peer||peer.identity.publicKey===body.peer.publicKey,'instance_identity_changed',409)
   const {sourceId:unused,...policyCheck}=ticket.policy;this.exportPolicy(policyCheck)
   return this.host.store.atomic(()=>{
    this.host.store.put('delegation-peer',p.issuer,{id:p.issuer,identity:body.peer,active:true,policy:ticket.policy,ticketId:ticket.id} satisfies Peer)
    this.host.store.put('delegation-pairing',ticket.id,{...ticket,usedBy:p.issuer})
    return ticket.policy
   })
  }
  const peer=this.peer(raw.issuer),p=validatePacket(value,peer.identity,this.identity.id)
  const envelope=z.object({grantId:z.string().uuid(),payload:z.unknown()}).strict().parse(p.body)
  requireDelegation(envelope.grantId===peer.ticketId,'grant_revoked',403)
  p.body=envelope.payload
  if(p.operation==='capabilities'){
   const request=z.object({id:z.literal('capabilities'),features:z.array(z.string().max(100)).max(10)}).strict().parse(p.body)
   const features=request.features.filter(f=>f==='execution-ledger-v1')
   this.host.store.put('delegation-peer',peer.id,{...peer,features});return {version:1,features}
  }
  if(p.operation==='submit')return this.submit(peer,p.body)
  const x=z.object({id:z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),epoch:z.number().int().nonnegative().optional(),leaseUntil:z.number().int().positive().optional(),contract:contractSchema.optional()}).strict().parse(p.body)
  let task=this.host.store.get<RemoteTask>('delegation-inbound',x.id)
  if(!task&&p.operation==='cancel'&&x.contract&&x.epoch!==undefined){
   requireDelegation(x.contract.delegationId===x.id&&x.contract.issuer===peer.id&&x.contract.target===this.identity.id,'contract_identity_mismatch',403)
   // A cancellation tombstone also fences a delayed original submit whose ACK was lost.
   task={id:x.id,peerId:peer.id,grantId:peer.ticketId,contract:x.contract,hash:stableDigest(x.contract),triggerId:'',discussion:'',state:'cancelled',desired:'cancelled',revision:1,controlEpoch:x.epoch,leaseUntil:0,activations:0,createdAt:Date.now(),replies:[],artifacts:[],reason:'cancelled_before_submission'}
   this.saveInbound(task)
  }
  requireDelegation(task&&task.peerId===peer.id,'task_not_found',404)
  requireDelegation(task.grantId===peer.ticketId,'task_grant_revoked',403)
  if(p.operation==='cancel'){
   requireDelegation(x.epoch!==undefined,'control_epoch_required')
   if(task.desired!=='cancelled'||task.controlEpoch<x.epoch){
    this.saveInbound({...task,desired:'cancelled',controlEpoch:Math.max(task.controlEpoch,x.epoch),revision:task.revision+1})
    await this.cancelInbound(task.id,'parent_cancelled')
   }
  }else if(p.operation==='lease'){
   requireDelegation(x.leaseUntil&&x.epoch===task.controlEpoch,'invalid_lease')
   requireDelegation(task.desired==='running'&&task.state!=='cancelled','execution_stopped',409)
   if(!terminal(task)&&(task.leaseUntil<=Date.now()||task.contract.deadline<=Date.now())){
    await this.cancelInbound(task.id,'authorization_expired')
    throw new DelegationError('execution_stopped',409)
   }
   requireDelegation(x.leaseUntil<=Date.now()+this.deploymentConfig.leaseMs+30000,'lease_too_long')
   if(x.leaseUntil>task.leaseUntil)this.saveInbound({...task,leaseUntil:Math.min(x.leaseUntil,task.contract.deadline)})
  }else requireDelegation(p.operation==='status','unsupported_operation',404)
  return this.project(this.host.store.get<RemoteTask>('delegation-inbound',task.id)!)
 }
 private submit(peer:Peer,value:unknown){
  const x=z.object({contract:contractSchema,leaseUntil:z.number().int().positive()}).strict().parse(value),c=x.contract
  requireDelegation(c.issuer===peer.id&&c.target===this.identity.id,'contract_identity_mismatch',403)
  requireDelegation(c.ancestors.length===1&&c.ancestors[0]===peer.id&&!c.ancestors.includes(this.identity.id),'delegation_hop_limit')
  const hash=stableDigest(c),existing=this.host.store.get<RemoteTask>('delegation-inbound',c.delegationId)
  if(existing){requireDelegation(existing.peerId===peer.id&&existing.hash===hash,'submission_conflict',409);return this.project(existing)}
  requireDelegation(c.createdAt<=Date.now()+30000&&c.deadline>Date.now()&&c.deadline<=c.createdAt+peer.policy.limits.durationMs,'invalid_deadline')
  requireDelegation(c.limits.maxActivations<=peer.policy.limits.maxActivations&&c.limits.maxConcurrent<=peer.policy.limits.maxConcurrent,'quota_not_authorized',403)
  for(const k of Object.keys(c.permissions) as (keyof DelegationPermissions)[])requireDelegation(!c.permissions[k]||peer.policy.permissions[k],'permission_not_authorized',403)
  requireDelegation(x.leaseUntil>Date.now()&&x.leaseUntil<=Date.now()+this.deploymentConfig.leaseMs+30000,'invalid_lease')
  const source=this.source()
  requireDelegation(peer.policy.sourceId===source.id,'export_changed',409)
  const active=this.host.store.list<RemoteTask>('delegation-inbound').filter(t=>!terminal(t)&&t.desired==='running')
  requireDelegation(active.length<peer.policy.limits.maxConcurrent,'team_busy',429)
  return this.host.store.atomic(()=>{
   const id=c.delegationId,thread='remote-'+id,trigger:Trigger={
    id:source.id+':'+id,source:source.id,threads:[{source:source.id,id:thread}],
    actor:{source:source.id,id:peer.id},human:false,addressed:'direct',at:new Date().toISOString(),
    text:'Delegated objective:\n'+c.text+'\nAcceptance:\n'+c.acceptance+'\nDeclared internal artifacts: '+JSON.stringify(c.artifacts)+'. Workers can use superagent_artifact to capture these files and inspect their actual byte size, SHA-256 and small-file hex. No external upload is needed.',
    meta:{delegationId:id,scope:thread,originPrincipal:c.principal,contractHash:hash},
    channel:{source:source.id,thread,address:{delegationId:id}},
   }
   const task:RemoteTask={id,peerId:peer.id,grantId:peer.ticketId,contract:c,hash,triggerId:trigger.id,discussion:source.id+':'+thread,state:'accepted',desired:'running',revision:1,controlEpoch:0,leaseUntil:Math.min(c.deadline,x.leaseUntil),activations:0,createdAt:Date.now(),replies:[],artifacts:[]}
   this.saveInbound(task)
   if(this.host.scopes.enabled()){
    requireDelegation(peer.policy.scopeId,'export_scope_required')
    this.host.store.put('source-identity',source.id,{namespace:this.identity.id+':delegation'})
    this.host.scopes.command({action:'entry.bind',operationId:'delegate-'+id,expectedRevision:0,scopeId:peer.policy.scopeId,sourceId:source.id,accountNamespace:this.identity.id+':delegation',nativeId:thread,privateActor:peer.id,history:'unknown'})
   }
   this.host.routerIngress.admitDelegated(trigger)
   return this.project(task)
  })
 }
 private saveInbound(task:RemoteTask){this.host.store.put('delegation-inbound',task.id,task)}
 private inboundForTrigger(triggerId?:string){
  if(!triggerId)return
  const t=this.host.store.triggers.get(triggerId),id=t?.meta.delegationId
  const direct=typeof id==='string'?this.host.store.get<RemoteTask>('delegation-inbound',id):undefined
  return direct?.triggerId===triggerId?direct:undefined
 }
 forTicket(ticketId:string){
  const assigned=this.host.taskAuthority(ticketId)
  return this.inboundForTrigger(assigned?.parentTrigger)
 }
 authority(triggerId:string):Mandate|undefined {
  const t=this.inboundForTrigger(triggerId);if(!t)return
  requireDelegation(this.enabled,'delegation_disabled',403)
  const peer=this.peer(t.peerId),source=this.source()
  requireDelegation(t.grantId===peer.ticketId,'task_grant_revoked',403)
  for(const k of Object.keys(t.contract.permissions) as (keyof DelegationPermissions)[])requireDelegation(!t.contract.permissions[k]||peer.policy.permissions[k],'permission_revoked',403)
  requireDelegation(t.desired==='running'&&t.leaseUntil>Date.now()&&t.contract.deadline>Date.now()&&t.state!=='cancelled','delegation_authority_expired',403)
  requireDelegation(source.id===peer.policy.sourceId,'export_changed',403)
  return {strength:'explicit',policyVersion:this.host.routerIngress.policy().version,
   actor:{source:source.id,id:peer.id},scope:t.contract.text+'\nAcceptance:\n'+t.contract.acceptance,
   basis:{via:'listed',authority:'delegation:'+t.id,source:source.id,row:'remote-'+t.id}}
 }
 validates(m:Mandate):boolean|undefined {
  if(m.basis.via!=='listed'||!m.basis.authority?.startsWith('delegation:'))return
  const t=this.host.store.get<RemoteTask>('delegation-inbound',m.basis.authority.slice(11))
  try{return !!t&&!!this.authority(t.triggerId)&&m.actor.source===this.source().id&&m.actor.id===t.peerId}catch{return false}
 }
 guardRouter(trigger:Trigger,args:any){
  const task=this.inboundForTrigger(trigger.id);if(!task)return
  this.authority(trigger.id)
  requireDelegation(['list','inspect','result','assign','send'].includes(args.action),'delegated_router_action_forbidden',403)
  const policy=this.peer(task.peerId).policy
  if(args.id)requireDelegation(policy.workerIds.includes(args.id),'worker_not_exported',403)
  if(args.ticketId)requireDelegation(this.forTicket(args.ticketId)?.id===task.id,'task_not_found',404)
  if(args.action==='assign'){
   const active=this.host.store.list<any>('worker-assignment').filter(a=>a.parentTrigger===trigger.id&&!this.host.store.tickets.get(a.ticketId)?.ended)
   const receipt=args.requestId&&this.host.store.get<any>('worker-command',bodyDigest([task.discussion,args.requestId]))
   requireDelegation(receipt?.status==='completed'||active.length<task.contract.limits.maxConcurrent,'delegation_concurrency_exhausted',429)
  }
 }
 workerResult(trigger:Trigger,args:any,result:any){
  const task=this.inboundForTrigger(trigger.id);if(!task)return result
  const allowed=this.peer(task.peerId).policy.workerIds
  const own=(id:string)=>this.forTicket(id)?.id===task.id
  const project=(w:any)=>({id:w.id,label:w.label,backend:w.backend,model:w.model,state:w.state,status:w.status,active:(w.active??[]).filter(own),tasks:(w.tasks??[]).filter(own)})
  if(args.action==='list')return {revision:result.revision,policy:{enabled:result.policy?.enabled===true},workers:result.workers.filter((w:any)=>allowed.includes(w.id)).map(project)}
  if(args.action==='inspect'&&!args.ticketId)return project(result)
  return result
 }
 restrict(request:ModelRequest):ModelRequest {
  const task=this.inboundForTrigger(request.activity?.triggerId)??(request.activity?.ticketId?this.forTicket(request.activity.ticketId):undefined)
  if(!task)return request
  this.authority(task.triggerId)
  const allowed=(name:string)=>request.role==='router'?name==='worker_manage':safeTools.has(name)||task.contract.permissions.shell&&name==='superagent_shell'||task.contract.permissions.subagents&&name==='superagent_spawn'
  const invoke=request.onTool
  return {...request,instructions:request.instructions+'\nThis is a service-authorized delegated task. Declared internal artifacts: '+JSON.stringify(task.contract.artifacts)+'. The Worker tool superagent_artifact captures these existing files and returns actual byte evidence; it is an internal handoff, not an external publication. Do not request unavailable public-upload tools. Preserve the original objective and report blocked if evidence is truly unavailable.',sandbox:task.contract.permissions.write?request.sandbox:'read-only',
   options:{...request.options,toolConnections:[],tools:request.tools?.filter(t=>allowed(t.name)).map(t=>t.name)},
   tools:request.tools?.filter(t=>allowed(t.name)),onTool:invoke?async(name,args,callId)=>{
    this.authority(task.triggerId);requireDelegation(allowed(name),'delegated_tool_forbidden',403)
    if(name==='worker_manage')this.guardRouter(this.host.store.triggers.get(task.triggerId)!,args)
    return invoke(name,args,callId)
   }:undefined}
 }
 beforeActivation(request:ModelRequest){
  const task=this.inboundForTrigger(request.activity?.triggerId)??(request.activity?.ticketId?this.forTicket(request.activity.ticketId):undefined)
  if(!task)return
  this.authority(task.triggerId)
  requireDelegation(task.state!=='ready','delegation_already_completed',409)
  if(task.activations>=task.contract.limits.maxActivations){
   if(task.state!=='blocked')this.saveInbound({...task,state:'blocked',reason:'activation_budget_exhausted',revision:task.revision+1})
   throw new DelegationError('delegation_activation_budget_exhausted',409)
  }
  this.saveInbound({...task,state:'running',activations:task.activations+1,revision:task.revision+1})
 }
 guardWorker(ticketId:string,name:string){
  const task=this.forTicket(ticketId);if(!task)return
  this.authority(task.triggerId)
  requireDelegation(safeTools.has(name)||task.contract.permissions.shell&&name==='superagent_shell'||task.contract.permissions.subagents&&name==='superagent_spawn','delegated_tool_forbidden',403)
 }
 private project(task:RemoteTask){
  const {execution,...base}=task
  return {...base,...(this.host.store.get<Peer>('delegation-peer',task.peerId)?.features?.includes('execution-ledger-v1')&&execution?{execution}:{}),artifacts:task.artifacts.map(({data,...a})=>({...a,data})),replies:task.replies.slice(-20)}
 }
 captureExecution(ticketId:string){
  const task=this.forTicket(ticketId);if(!task)return
  const ticket=this.host.store.tickets.get(ticketId)!,calls=this.host.activity.list().filter(c=>c.ticketId===ticketId&&c.kind==='tool')
  this.host.store.put('delegation-execution',ticketId,{delegationId:task.id,assignmentId:ticket.assignments.at(-1)!.id,managed:this.host.store.get<any>('capabilities',ticketId)?.managed===true,
   complete:calls.length<=200,toolCalls:calls.slice(0,200).map(c=>({id:c.id,ticketId,name:c.name,state:c.state})),jobCount:this.host.work.list(ticketId).length,externalToolCount:this.host.toolConnections.receipts(ticketId).length})
 }
 private execution(task:RemoteTask,tickets:{id:string;assignments:{id:string}[]}[]){
  const records=tickets.map(t=>this.host.store.get<any>('delegation-execution',t.id)).filter((r,i)=>r?.delegationId===task.id&&r.assignmentId===tickets[i]!.assignments.at(-1)?.id)
  const calls=records.flatMap(r=>r.toolCalls),managed=records.length===tickets.length&&records.every(r=>r.managed),jobCount=records.reduce((n,r)=>n+r.jobCount,0),externalToolCount=records.reduce((n,r)=>n+r.externalToolCount,0)
  return executionSchema.parse({version:1,basis:'peer-host-managed-tools',managed,complete:managed&&records.every(r=>r.complete)&&calls.length<=200&&jobCount===0&&externalToolCount===0,taskCount:tickets.length,jobCount,externalToolCount,toolCalls:calls.slice(0,200)})
 }
 async deliver(message:OutboundMessage){
  const id=String(message.channel.address.delegationId??''),task=this.host.store.get<RemoteTask>('delegation-inbound',id)
  requireDelegation(task,'unknown_delegated_delivery')
  if(terminal(task)){this.host.store.delivered(message.id);return}
  this.authority(task.triggerId)
  if(task.replies.some(r=>r.id===message.id)){this.host.store.delivered(message.id);return}
  const assigned=this.host.store.list<any>('worker-assignment').filter(a=>a.parentTrigger===task.triggerId)
  const tickets=assigned.map(a=>this.host.store.tickets.get(a.ticketId)).filter((t):t is NonNullable<typeof t>=>!!t)
  const reads=this.host.store.get<{reportReads?:Record<string,string>}>('router-reply-owner',message.id)?.reportReads??{}
  const complete=tickets.length>0&&tickets.every(t=>!!t.ended)&&tickets.every(t=>t.assignments.at(-1)?.report?.state==='ready'&&reads[t.id]===t.assignments.at(-1)?.report?.at)
  const workerReports=complete?tickets.map(t=>{
   const report=t.assignments.at(-1)!.report!
   return workerReportSchema.parse({id:stableDigest([task.id,t.id,report]),ticketId:t.id,workerId:assigned.find(a=>a.ticketId===t.id)!.workerId,state:report.state,at:report.at,summary:report.summary.slice(0,8000)})
  }):task.workerReports
  let artifacts=task.artifacts,captureError:string|undefined
  try{if(complete)artifacts=this.captureArtifacts(task)}catch(error){captureError=errorText(error)}
  const missing=task.contract.artifacts.some(name=>!artifacts.some(a=>a.name===name))
  const blocked=!!captureError||complete&&missing||!tickets.length||tickets.some(t=>t.assignments.at(-1)?.report?.state==='blocked')
  this.host.store.atomic(()=>{
   this.saveInbound({...task,state:blocked?'blocked':complete?'ready':task.state,...(captureError?{reason:captureError}:missing&&complete?{reason:'required_artifact_missing'}:{}),revision:task.revision+1,replies:[...task.replies,{id:message.id,text:message.text.slice(0,24000)}].slice(-20),artifacts,workerReports,...(complete?{execution:this.execution(task,tickets)}:{})})
   this.host.store.delivered(message.id)
  })
 }
 capture(ticketId:string,name:string){
  const task=this.forTicket(ticketId)
  requireDelegation(task,'delegated_artifact_channel_required',403)
  this.authority(task.triggerId)
  requireDelegation(task.contract.artifacts.includes(name),'artifact_not_declared',403)
  const artifact=this.captureFile(task,ticketId,name)
  requireDelegation(artifact,'artifact_not_found',404)
  this.saveInbound({...task,revision:task.revision+1,artifacts:[...task.artifacts.filter(a=>a.name!==name),artifact]})
  const {data,...metadata}=artifact
  return {...metadata,publication:'internal',...(artifact.size<=256?{hex:Buffer.from(data,'base64').toString('hex')}:{})}
 }
 private captureFile(task:RemoteTask,ticketId:string,name:string):Artifact|undefined {
  const run=this.host.store.get<any>('run',ticketId);if(!run?.cwd)return
  const root=realpathSync(run.cwd),path=join(root,name);if(!existsSync(path))return
  const actual=realpathSync(path),rel=relative(root,actual)
  requireDelegation(rel!==''&&!rel.startsWith('..')&&!isAbsolute(rel)&&lstatSync(path).isFile()&&!lstatSync(path).isSymbolicLink(),'artifact_outside_task')
  const stateRoot=realpathSync(this.host.config.stateDir),inState=relative(stateRoot,actual),workspaceInState=relative(stateRoot,root)
  const inside=(path:string)=>path===''||!path.startsWith('..')&&!isAbsolute(path)
  requireDelegation(!inside(inState)||inside(workspaceInState)&&/^(work|workspace)\//.test(workspaceInState),'artifact_private_state')
  requireDelegation(!isHostPrivateFile(actual),'host_credentials_are_private')
  const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW)
  let bytes:Buffer
  try{
   const opened=fstatSync(fd),current=statSync(actual),now=realpathSync(path),within=relative(root,now)
   requireDelegation(opened.isFile()&&opened.size<=1000000&&opened.dev===current.dev&&opened.ino===current.ino&&now===actual&&!within.startsWith('..')&&!isAbsolute(within),'artifact_changed_during_export')
   bytes=readFileSync(fd)
   requireDelegation(bytes.length<=1000000,'artifact_too_large')
  }finally{closeSync(fd)}
  const sha256=createHash('sha256').update(bytes).digest('hex')
  return {id:stableDigest([task.id,ticketId,name,sha256]),name,sha256,size:bytes.length,data:bytes.toString('base64'),ticketId}
 }
 private captureArtifacts(task:RemoteTask):Artifact[] {
  const artifacts=new Map<string,Artifact>()
  for(const a of this.host.store.list<any>('worker-assignment').filter(a=>a.parentTrigger===task.triggerId))for(const name of task.contract.artifacts){
   const artifact=this.captureFile(task,a.ticketId,name);if(!artifact)continue
   const previous=artifacts.get(name)
   requireDelegation(!previous||previous.sha256===artifact.sha256,'artifact_ambiguous')
   artifacts.set(name,artifact)
  }
  return [...artifacts.values()]
 }

 parent(task:OutboundTask){
  requireDelegation(task.contract&&!this.host.memory.cleanup.blocked('delegation-outbound',task.id,task),'delegation_history_unavailable',403)
  const connection=this.connection(task.connectionId),target=this.host.config.execution.teamTargets?.find(t=>t.id===task.targetId)
  const trigger=this.host.store.triggers.get(task.triggerId),source=trigger&&this.host.config.sources.find(s=>s.id===trigger.source)
  requireDelegation(target?.connectionId===task.connectionId&&source,'team_target_not_authorized',403)
  const current={...target.permissions,write:target.permissions.write&&source.sandbox==='workspace-write',network:target.permissions.network&&this.host.config.work.network}
  requireDelegation((Object.keys(task.contract.permissions) as (keyof DelegationPermissions)[]).every(k=>!task.contract.permissions[k]||current[k]&&connection.policy.permissions[k]),'delegation_permissions_reduced',403)
  requireDelegation((Object.keys(task.contract.limits) as (keyof DelegationLimits)[]).every(k=>task.contract.limits[k]<=target.limits[k]&&task.contract.limits[k]<=connection.policy.limits[k]),'delegation_limits_reduced',403)
  if(task.goal){const goal=this.host.goals.get(task.goal.goalId);requireDelegation(goal&&goal.state!=='cancelled','goal_no_longer_authorized',403);this.host.goals.context(goal)}
  const mandate=this.host.routerIngress.authority(task.triggerId,task.discussion)
  if(task.scopeId){
   const trigger=this.host.store.triggers.get(task.triggerId)!
   const c=this.host.scopes.context(trigger,task.discussion)
   requireDelegation(c?.route.scopeId===task.scopeId&&this.host.scopes.scope(task.scopeId).teamTargetIds?.includes(task.targetId),'team_target_not_authorized',403)
  }
  if(task.manifestId){const manifest=this.host.store.get<any>('context-manifest',task.manifestId);requireDelegation(manifest,'parent_context_unavailable',403);this.host.memory.validate(manifest)}
  return mandate
 }
 async command(value:unknown,context?:RouterContext,goal?:GoalDelegationRef){
  const x=teamCommandSchema.parse(value)
  if(context?.trigger)this.host.routerIngress.authority(context.trigger.id,context.discussion)
  const targets=(this.host.config.execution.teamTargets??[]).filter(t=>this.host.store.get<Connection>('delegation-connection',t.connectionId)?.active&&(!context?.scoped||this.host.scopes.scope(context.scoped.route.scopeId).teamTargetIds?.includes(t.id)))
  const visible=(task:OutboundTask)=>!context||task.discussion===context.discussion&&task.contract.principal.source===context.trigger?.actor.source&&task.contract.principal.actor===context.trigger?.actor.id&&(!context.scoped||task.scopeId===context.scoped.route.scopeId)
  if(x.action==='list')return {revision:this.revision(),targets,tasks:this.projectedTasks<OutboundTask>('delegation-outbound',context?.discussion).filter(visible).filter(t=>{if(!context)return true;try{this.parent(t);return true}catch{return false}}).map(t=>this.outboundView(t))}
  requireDelegation(x.operationId&&x.expectedRevision!==undefined||x.action==='inspect','operation_and_revision_required')
  if(x.action==='assign'){
   requireDelegation(context?.trigger&&!this.inboundForTrigger(context.trigger.id),'authorized_root_router_required',403)
   const target=targets.find(t=>t.id===x.targetId)
   requireDelegation(target?.state==='enabled'&&x.text&&x.acceptance,'enabled_target_and_contract_required')
   requireDelegation(x.artifacts!==undefined,'explicit_artifact_list_required')
   const conn=this.connection(target.connectionId),id=stableDigest([this.identity.id,context.trigger.id,x.operationId]).slice(0,32)
   const existing=this.host.store.get<OutboundTask>('delegation-outbound',id)
   const fingerprint=stableDigest({targetId:x.targetId,text:x.text,acceptance:x.acceptance,artifacts:x.artifacts??[]})
   if(existing){this.parent(existing);requireDelegation(existing.contractHash===fingerprint&&stableDigest(existing.goal??null)===stableDigest(goal??null),'operation_conflict',409);return this.outboundView(existing)}
   requireDelegation(x.expectedRevision===this.revision(),'settings_conflict',409)
   const reserved=Number(this.host.store.db.prepare("SELECT COALESCE(SUM(json_extract(body,'$.contract.limits.maxActivations')),0) AS total FROM records WHERE kind='delegation-outbound' AND json_extract(body,'$.triggerId')=?").get(context.trigger.id)!.total)
   requireDelegation(reserved+target.limits.maxActivations<=this.deploymentConfig.maxRemoteActivations,'parent_remote_budget_exhausted',409)
   const source=this.host.sources.get(context.trigger.source)!.config,now=Date.now()
   const contract=contractSchema.parse({version:1,delegationId:id,rootId:stableDigest([this.identity.id,context.trigger.id]).slice(0,32),parentTriggerId:context.trigger.id,issuer:this.identity.id,target:conn.id,ancestors:[this.identity.id],principal:{source:context.trigger.actor.source,actor:context.trigger.actor.id},text:x.text,acceptance:x.acceptance,artifacts:x.artifacts??[],permissions:{...target.permissions,write:target.permissions.write&&source.sandbox==='workspace-write',network:target.permissions.network&&this.host.config.work.network},limits:target.limits,createdAt:now,deadline:now+target.limits.durationMs})
   const task:OutboundTask={id,connectionId:conn.id,targetId:target.id,contract,contractHash:fingerprint,triggerId:context.trigger.id,discussion:context.discussion,scopeId:context.scoped?.route.scopeId,manifestId:context.manifest?.id,state:'pending',desired:'running',controlEpoch:0,nextAt:0,acceptance:'pending',...(goal?{goal}:{})}
   this.host.store.put('delegation-outbound',id,task)
   this.pump();return this.outboundView(task)
  }
  requireDelegation(x.id,'task_required')
  const task=this.host.store.get<OutboundTask>('delegation-outbound',x.id)
  requireDelegation(task?.contract&&visible(task)&&!this.host.memory.cleanup.blocked('delegation-outbound',task.id,task),'task_not_found',404)
  if(context)this.parent(task)
  const audience=context?.trigger?.id??'operator'
  if(x.action==='inspect'){
   const evidence=this.evidence(task)
   this.host.store.put('delegation-evidence-read',stableDigest([task.id,audience]),{revision:task.remote?.revision,ids:evidence.map(e=>e.id)})
   return {...this.outboundView(task),evidence}
  }
  const receiptKey=stableDigest([audience,x.operationId]),fingerprint=stableDigest(x)
  const receipt=this.host.store.get<any>('delegation-operation',receiptKey)
  if(receipt){requireDelegation(receipt.fingerprint===fingerprint,'operation_conflict',409);return this.outboundView(task)}
  const done=(result:unknown)=>{this.host.store.put('delegation-operation',receiptKey,{fingerprint,result});return result}
  if(x.action==='cancel'){
   requireDelegation(x.expectedRevision===this.revision(),'settings_conflict',409)
   if(task.desired!=='cancelled')this.host.store.put('delegation-outbound',task.id,{...task,desired:'cancelled',controlEpoch:task.controlEpoch+1,nextAt:0})
   this.pump();return done(this.outboundView(this.host.store.get<OutboundTask>('delegation-outbound',task.id)!))
  }
  requireDelegation(!task.goal,'managed_goal_requires_independent_acceptance',409)
  requireDelegation(task.desired==='running'&&task.remote?.state==='ready'&&task.state==='acknowledged','candidate_result_required',409)
  const evidence=this.evidence(task).map(e=>e.id)
  requireDelegation(task.contract.artifacts.every(name=>task.remote!.artifacts.some(a=>a.name===name)),'required_artifact_missing',409)
  const inspected=this.host.store.get<any>('delegation-evidence-read',stableDigest([task.id,audience]))
  requireDelegation(inspected?.revision===task.remote.revision&&evidence.every(id=>inspected.ids.includes(id)),'current_evidence_not_inspected',409)
  requireDelegation(evidence.length&&evidence.every(id=>x.evidence?.includes(id)),'inspect_all_evidence_before_acceptance')
  requireDelegation(x.expectedRevision===this.revision(),'settings_conflict',409)
  this.host.store.put('delegation-outbound',task.id,{...task,acceptance:'passed',reviewedEvidence:evidence})
  return done(this.outboundView(this.host.store.get<OutboundTask>('delegation-outbound',task.id)!))
 }
 evidence(task:OutboundTask){
  return [...(task.remote?.replies??[]).map(r=>({id:'reply:'+r.id,kind:'remote-report',text:r.text,sourceInstance:task.connectionId})),
   ...(task.remote?.workerReports??[]).map(r=>({...r,kind:'remote-worker-report',text:JSON.stringify(r),sourceInstance:task.connectionId})),
   ...(task.remote?.artifacts??[]).map(a=>{
    const bytes=Buffer.from(a.data,'base64');let content:string,encoding:string
    try{if(bytes.includes(0))throw Error('binary');content=new TextDecoder('utf-8',{fatal:true}).decode(bytes);encoding='utf8'}catch{content=a.data;encoding='base64'}
    return {id:a.id,kind:'remote-artifact',name:a.name,sha256:a.sha256,size:a.size,content,encoding,sourceInstance:task.connectionId}
   })]
 }
 private outboundView(task:OutboundTask){
  const {contract,remote,manifestId,scopeId,...rest}=task
  return {...rest,...this.goalTasks.view(task),title:this.title(contract.text),acceptanceCriteria:contract.acceptance,remoteState:remote?.state??'unknown',remoteRevision:remote?.revision,controlConfirmed:task.desired==='cancelled'&&!!remote&&terminal(remote)&&remote.controlEpoch>=task.controlEpoch,activations:remote?.activations??null,artifacts:remote?.artifacts.map(({data,...a})=>a)??[],reply:remote?.replies.at(-1)?.text??null,stale:!remote||(!terminal(remote)||!!task.goal&&task.acceptance!=='passed')&&(!task.lastCheckedAt||!!task.error||Date.now()-task.lastCheckedAt>Math.max(5000,this.deploymentConfig.pollMs*3))}
 }
 private title(text:string){
  try{const value=JSON.parse(text);if(typeof value.node?.title==='string')return value.node.title.slice(0,160)}catch{}
  return text.slice(0,160)
 }
 snapshot(){
  return {enabled:this.enabled,recoveryRequired:this.recoveryRequired,recoveryFingerprint:this.recoveryRequired?this.recoveryFingerprint():null,identity:this.identityValue?publicIdentity(this.identityValue):null,endpoint:this.endpointValue??null,revision:this.revision(),
   capabilities:{mode:'managed-team',maxHops:1,pause:false,transport:'loopback-signed-v1',taskVerified:false,independentGoalVerification:true},
   targets:this.host.config.execution.teamTargets??[],
   connections:this.host.store.list<Connection>('delegation-connection').map(({policy,identity,...c})=>({...c,fingerprint:stableDigest(identity.publicKey)})),
   peers:this.host.store.list<Peer>('delegation-peer').map(p=>({id:p.id,active:p.active,workerIds:p.policy.workerIds})),
   exportScopes:this.host.scopes.enabled()?this.host.store.list<ManagementScope>('management-scope').filter(s=>s.sourceIds.includes(this.deploymentConfig.sourceId)).map(s=>({id:s.id,name:s.name,workerIds:s.workerIds})):null,
   historyLimit:25,
   goals:this.goalTasks.graph(),
   outbound:this.projectedTasks<OutboundTask>('delegation-outbound').map(t=>this.outboundView(t)),
   inbound:this.projectedTasks<RemoteTask>('delegation-inbound').map(t=>({id:t.id,peerId:t.peerId,title:this.title(t.contract.text),state:t.state,desired:t.desired,revision:t.revision,activations:t.activations,leaseUntil:t.leaseUntil,reason:t.reason})),
  }
 }
 private recoveryFingerprint(){
  return stableDigest({identity:this.identityValue?.id,peers:this.host.store.list('delegation-peer'),connections:this.host.store.list('delegation-connection'),inbound:this.host.store.list<RemoteTask>('delegation-inbound').map(t=>({id:t.id,hash:t.hash,epoch:t.controlEpoch})),outbound:this.host.store.list<OutboundTask>('delegation-outbound').map(t=>({id:t.id,hash:t.contractHash,epoch:t.controlEpoch}))})
 }
 async recover(value:unknown){
  const x=z.object({fingerprint:z.string(),expectedRevision:z.number().int(),originalStopped:z.literal(true)}).strict().parse(value)
  requireDelegation(this.recoveryRequired&&this.identityValue,'recovery_not_required',409)
  requireDelegation(x.expectedRevision===this.revision()&&x.fingerprint===this.recoveryFingerprint(),'recovery_plan_changed',409)
  // Restored grants may predate a revocation. Retain receipts, revoke all grants, and require fresh pairing.
  for(const peer of this.host.store.list<Peer>('delegation-peer'))this.host.store.put('delegation-peer',peer.id,{...peer,active:false})
  for(const c of this.host.store.list<Connection>('delegation-connection'))this.host.store.put('delegation-connection',c.id,{...c,active:false})
  for(const task of this.host.store.list<RemoteTask>('delegation-inbound'))if(!terminal(task))await this.cancelInbound(task.id,'restored_effects_require_review')
  this.cancelWhere(()=>true)
  unlinkSync(join(this.host.config.stateDir,'delegation-restored.json'))
  return {recovered:true,connectionsRevoked:true,externalEffects:'not_reverted',requiresFreshPairing:true}
 }
 async revoke(id:string){
  const peer=this.host.store.get<Peer>('delegation-peer',id),connection=this.host.store.get<Connection>('delegation-connection',id)
  if(peer){this.host.store.put('delegation-peer',id,{...peer,active:false});for(const t of this.host.store.list<RemoteTask>('delegation-inbound').filter(t=>t.peerId===id&&!terminal(t)))await this.cancelInbound(t.id,'peer_revoked')}
  if(connection){this.host.store.put('delegation-connection',id,{...connection,active:false});this.cancelWhere(t=>t.connectionId===id)}
  return {revoked:true}
 }
 cancelWhere(test:(task:OutboundTask)=>boolean){
  for(const task of this.host.store.list<OutboundTask>('delegation-outbound'))if(test(task)&&task.desired==='running')this.host.store.put('delegation-outbound',task.id,{...task,desired:'cancelled',controlEpoch:task.controlEpoch+1,nextAt:0})
 }
 context(resultId:string,triggerId:string){
  const task=this.host.store.get<OutboundTask>('delegation-outbound',resultId)
  requireDelegation(task&&task.triggerId===triggerId,'team_result_not_found',404)
  requireDelegation(task.desired==='running','team_result_cancelled',409)
  this.parent(task);return {kind:'team_result',task:this.outboundView(task),evidence:this.evidence(task),instruction:'Inspect the candidate and its evidence. Remote ready is not parent acceptance. Do not repeat this delegation.'}
 }
 private async request(connection:Pick<Connection,'id'|'identity'|'endpoint'> & {grantId?:string},operation:string,body:unknown):Promise<any>{
  const signed=packet(this.identity,connection.id,operation,operation==='pair'?body:{grantId:connection.grantId,payload:body})
  const response=await fetch(validateEndpoint(connection.endpoint)+'/delegation/v1',{
   method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(signed),
   redirect:'error',signal:AbortSignal.any([this.shutdown.signal,AbortSignal.timeout(3000)]),
  })
  requireDelegation(Number(response.headers.get('content-length')??0)<=16000000,'response_too_large')
  const chunks:Uint8Array[]=[];let size=0
  for await(const bytes of response.body??[]){size+=bytes.length;if(size>16000000){await response.body?.cancel().catch(()=>{});throw new DelegationError('response_too_large')}chunks.push(bytes)}
  const result=validatePacket(JSON.parse(Buffer.concat(chunks).toString('utf8')),connection.identity,this.identity.id)
  requireDelegation(result.operation===operation+':response','invalid_response_operation')
  const envelope=z.object({requestNonce:z.string().uuid(),result:z.unknown()}).strict().parse(result.body)
  requireDelegation(envelope.requestNonce===signed.nonce,'response_request_mismatch')
  const value=envelope.result as any
  if(value?.error)throw new DelegationError(String(value.error),response.status)
  requireDelegation(response.ok,'delegation_unavailable',response.status);return value
 }
 response(issuer:string,operation:string,body:unknown,requestNonce:string){return packet(this.identity,issuer,operation+':response',{requestNonce,result:body})}
 pump(){
  if(!this.enabled)return
  // Local expiry must keep fencing work while an unrelated peer RPC is stalled.
  if(!this.expiring)this.expiring=this.expireInbound().catch(e=>{if(!this.closing)this.host.store.audit({type:'delegation.expiry_failed',code:errorText(e)})}).finally(()=>{this.expiring=undefined})
  if(this.pending)return
  this.pending=this.tick().catch(e=>{if(!this.closing)this.host.store.audit({type:'delegation.pump_failed',code:errorText(e)})}).finally(()=>{this.pending=undefined})
 }
 private async expireInbound(){
  const now=Date.now()
  const inbound=this.host.store.db.prepare("SELECT body FROM records WHERE kind='delegation-inbound' AND json_type(body,'$.contract')='object' AND COALESCE(json_extract(body,'$.deleted'),0)<>1 AND json_extract(body,'$.state') NOT IN ('ready','cancelled')").all()
  await Promise.all(inbound.map(row=>JSON.parse(String(row.body)) as RemoteTask).filter(task=>!terminal(task)&&(task.leaseUntil<=now||task.contract.deadline<=now||!this.host.store.get<Peer>('delegation-peer',task.peerId)?.active||this.host.store.get<Peer>('delegation-peer',task.peerId)?.ticketId!==task.grantId)).map(task=>this.cancelInbound(task.id,'authorization_expired')))
 }
 private async tick(){
  const now=Date.now()
  const outbound=this.host.store.db.prepare("SELECT body FROM records WHERE kind='delegation-outbound' AND json_type(body,'$.contract')='object' AND COALESCE(json_extract(body,'$.deleted'),0)<>1 AND NOT (COALESCE(json_extract(body,'$.remote.state'),'unknown') IN ('ready','cancelled') AND ((json_extract(body,'$.desired')='running' AND COALESCE(json_extract(body,'$.lastNotified'),-1)=json_extract(body,'$.remote.revision') AND (json_extract(body,'$.goal') IS NULL OR json_extract(body,'$.acceptance')='passed')) OR (json_extract(body,'$.desired')='cancelled' AND json_extract(body,'$.remote.controlEpoch')>=json_extract(body,'$.controlEpoch'))))").all()
  for(const row of outbound){
   const original=JSON.parse(String(row.body)) as OutboundTask
   if(this.closing)return
   let task=this.host.store.get<OutboundTask>('delegation-outbound',original.id)!
   if(task.nextAt>now||task.desired==='cancelled'&&task.remote&&terminal(task.remote)&&task.remote.controlEpoch>=task.controlEpoch)continue
   const currentControl=()=>{
    const current=this.host.store.get<OutboundTask & {deleted?:boolean}>('delegation-outbound',task.id)
    requireDelegation(current?.contract&&!current.deleted,'delegation_history_unavailable',403)
    task={...task,desired:current.desired,controlEpoch:current.controlEpoch}
    if(task.desired==='running'){
     try{this.parent(task)}catch{task={...task,desired:'cancelled',controlEpoch:task.controlEpoch+1};this.host.store.put('delegation-outbound',task.id,{...current,desired:task.desired,controlEpoch:task.controlEpoch})}
    }
    // A revoked connection retains only its fixed cancellation route.
    const connection=task.desired==='cancelled'?this.host.store.get<Connection>('delegation-connection',task.connectionId):this.connection(task.connectionId)
    requireDelegation(connection,'connection_revoked',403);return connection
   }
   try{
    let connection=currentControl()
    if(task.desired==='running'&&task.state==='pending'&&this.host.schedulingPaused)continue
    if(task.state==='pending'||task.state==='reconcile_required'){
     let remote:RemoteTask|undefined
     if(task.desired==='cancelled')remote=await this.request(connection,'cancel',{id:task.id,epoch:task.controlEpoch,contract:task.contract})
     else if(task.state==='reconcile_required')try{remote=await this.request(connection,'status',{id:task.id})}catch(e){if(!(e instanceof DelegationError)||e.code!=='task_not_found')throw e}
     connection=currentControl()
     if(!remote&&task.desired==='running'){requireDelegation(!this.host.schedulingPaused,'parent_scheduling_paused',409);remote=await this.request(connection,'submit',{contract:task.contract,leaseUntil:Math.min(task.contract.deadline,Date.now()+this.deploymentConfig.leaseMs)})}
     task={...task,state:'acknowledged',remote}
    }
    connection=currentControl()
    const operation=task.desired==='cancelled'?'cancel':task.remote&&terminal(task.remote)?'status':'lease'
    let observed:unknown
    try{observed=await this.request(connection,operation,{id:task.id,...(operation==='cancel'?{epoch:task.controlEpoch,contract:task.contract}:operation==='status'?{}:{epoch:task.controlEpoch,leaseUntil:Math.min(task.contract.deadline,Date.now()+this.deploymentConfig.leaseMs)})})}
    catch(error){
     // A stopped lease cannot renew execution, but its terminal state remains
     // observable under the same still-authorized service identity.
     if(operation!=='lease'||!(error instanceof DelegationError)||error.code!=='execution_stopped')throw error
     connection=currentControl()
     observed=await this.request(connection,task.desired==='cancelled'?'cancel':'status',{id:task.id,...(task.desired==='cancelled'?{epoch:task.controlEpoch,contract:task.contract}:{})})
    }
    const remote=remoteTaskSchema.parse(observed)
    const parsed=contractSchema.parse(remote.contract)
    requireDelegation(remote.id===task.id&&remote.hash===stableDigest(task.contract)&&stableDigest(parsed)===stableDigest(task.contract),'remote_contract_changed')
    requireDelegation(!task.remote||remote.revision>=task.remote.revision,'remote_state_regressed')
    for(const a of remote.artifacts)requireDelegation(a.size<=1000000&&Buffer.from(a.data,'base64').toString('base64')===a.data&&Buffer.from(a.data,'base64').length===a.size&&createHash('sha256').update(Buffer.from(a.data,'base64')).digest('hex')===a.sha256,'artifact_digest_mismatch')
    const latest=this.host.store.get<OutboundTask>('delegation-outbound',task.id)!
    task={...task,desired:latest.desired,controlEpoch:latest.controlEpoch,remote,lastCheckedAt:Date.now(),nextAt:Date.now()+this.deploymentConfig.pollMs,error:undefined}
    if(task.desired==='running'&&['ready','blocked','cancelled'].includes(remote.state)&&task.lastNotified!==remote.revision){
     this.parent(task)
     if(!task.goal)this.host.store.enqueue('router:team:'+task.id+':'+remote.revision,'router',{triggerId:task.triggerId,discussion:task.discussion,teamResultId:task.id})
     task.lastNotified=remote.revision
    }
   }catch(e){task={...task,state:task.state==='pending'?'reconcile_required':task.state,error:errorText(e),nextAt:Date.now()+this.deploymentConfig.pollMs}}
   if(!this.closing){
    const current=this.host.store.get<OutboundTask & {deleted?:boolean}>('delegation-outbound',task.id)
    if(!current?.contract||current.deleted)continue
    this.host.store.put('delegation-outbound',task.id,{...task,desired:current.desired,controlEpoch:current.controlEpoch,acceptance:current.acceptance,reviewedEvidence:current.reviewedEvidence,acceptedBy:current.acceptedBy,verificationRoundId:current.verificationRoundId})
   }
  }
 }
 private async cancelInbound(id:string,reason:string){
  const task=this.host.store.get<RemoteTask>('delegation-inbound',id)!
  if(!task?.contract)return
  if(task.state==='ready'||task.state==='cancelled')return
  // Persist the fence before awaiting any model or command interruption.
  this.saveInbound({...task,desired:'cancelled',revision:task.revision+1,reason})
  await this.host.cancelRouter(task.triggerId,task.discussion)
  const latest=this.host.store.get<RemoteTask>('delegation-inbound',id)!
  this.saveInbound({...latest,state:'cancelled',revision:latest.revision+1})
 }
 async close(){this.closing=true;this.shutdown.abort();await Promise.all([this.pending,this.expiring])}
}
