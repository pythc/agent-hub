import {RouterScopeAmbiguity,type RouterScopes} from './router-scope.ts'
import type {Config} from './config.ts'
import type {Store} from './store.ts'
import type {SourceRegistry} from './source-plugins.ts'
import {makePolicy,makeScope} from './policy.ts'
import {bodyDigest} from './sources.ts'
import type {GateResult,Mandate,Policy,Thread,Trigger} from './vendor/dsh-core/index.ts'
import type {Assessment} from './schemas.ts'
import {validateRuleAssessment,implementationAllowed} from './schemas.ts'

/** Admission to a conversation is separate from a Worker task's accept Decision. */
export interface RouterAdmission {
 triggerId:string
 discussion:string
 policyVersion:string
 state:'pending'|'accepted'|'ignored'|'observed'|'unavailable'|'cancelled'
 reason:string
 clarification?:{question:string}
 at:string
 generation?:number
 revision?:number
 anchor?:string
 mandate?:Mandate
 assessment?:Assessment
}

/** Host ingress uses exactly the same source scope, admission matrix and rule policy as Engine. */
export class RouterIngress {
 rulesFor?: (trigger?:Trigger)=>Config['rules']
 ruleExecutionAllowed?: (ids:readonly string[])=>boolean
 defer?: (record:RouterAdmission,trigger:Trigger)=>boolean
 scheduledAuthority?: (id:string)=>Mandate|undefined
 delegatedAuthority?: (id:string)=>Mandate|undefined
 delegatedRevalidate?: (mandate:Mandate)=>boolean|undefined
 automationRevalidate?: (mandate:Mandate)=>boolean|undefined
 constructor(private config:Config,private store:Store,private registry:SourceRegistry,private scopes?:RouterScopes){}
 rules(trigger?:Trigger){return this.rulesFor?.(trigger)??this.config.rules}
 policy(trigger?:Trigger){const p=makePolicy({...this.config,rules:this.rules(trigger)},()=>false,this.registry);return {...p,admitsInferred:(ids:readonly string[])=>p.admitsInferred(ids)&&(this.ruleExecutionAllowed?.(ids)??true),revalidate:(m:Mandate)=>this.delegatedRevalidate?.(m)??this.automationRevalidate?.(m)??(p.revalidate(m)&&(m.strength==='explicit'||(this.ruleExecutionAllowed?.(m.basis.rules??[])??true)))}}
 get(id:string){return this.store.get<RouterAdmission>('router-admission',id)}
 private discussion(trigger:Trigger){return trigger.source+':'+trigger.threads[0]!.id}
 private gate(trigger:Trigger,anchor?:RouterAdmission):GateResult{
  const scope=makeScope(this.config,this.registry).scope(trigger)
  if(!scope.listened)return {admissible:false,reason:scope.reason}
  const thread:Thread={key:this.discussion(trigger),ref:trigger.threads[0]!,createdAt:trigger.at,subscriptions:anchor?[anchor.triggerId]:[],correlated:[],pending:[],meta:{}}
  return this.policy(trigger).gate(trigger,thread,[])
 }
 private valid(record:RouterAdmission):boolean{
  const trigger=this.store.triggers.get(record.triggerId),mandate=record.mandate
  if(record.state!=='accepted'||!trigger||!mandate||!this.policy(trigger).revalidate(mandate))return false
  try{this.scopes?.assertTrigger(trigger)}catch{return false}
  // Follow-ups retain a real, currently authorized conversation anchor, never just a session ID.
  const anchor=record.anchor?this.get(record.anchor):undefined
  if(record.anchor&&(!anchor||anchor.anchor||!this.valid(anchor)))return false
  const gate=this.gate(trigger,anchor)
  return gate.admissible&&(mandate.strength==='inferred'||gate.strength==='explicit')
 }
 authority(id:string,discussion?:string):Mandate{
  if(this.store.get('router-cancelled',id))throw Error('Router run was cancelled')
  if(this.store.list<{triggers:string[]}>('history-plan').some(p=>p.triggers.includes(id)))throw Error('Source history was deleted; a new authorized input is required')
  if(this.config.execution.router?.mode!=='host')throw Error('Host Router is not enabled')
  const scheduled=this.scheduledAuthority?.(id)
  if(scheduled){if(discussion&&this.get(id)?.discussion!==discussion)throw Error('Schedule discussion mismatch');return scheduled}
  const delegated=this.delegatedAuthority?.(id)
  if(delegated){if(discussion&&this.get(id)?.discussion!==discussion)throw Error('Delegation discussion mismatch');return delegated}
  const record=this.get(id)
  if(!record||discussion&&record.discussion!==discussion||!this.valid(record))throw Error('Router authorization withdrawn or input not admitted')
  for(const dependency of this.store.get<{triggerIds:string[]}>('router-input-set',id)?.triggerIds??[])if(dependency!==id)this.authority(dependency)
  return record.mandate!
 }
 private save(record:RouterAdmission){
  this.store.put('router-admission',record.triggerId,record)
  this.store.audit({type:'router.admission',...record})
  return record
 }
 /** Called inside the host transaction: admission and its durable job are indivisible. */
 admit(trigger:Trigger):RouterAdmission{
  if(!trigger.threads[0])throw Error('A Router event must belong to a thread')
  this.store.triggers.save(trigger)
  const discussion=this.discussion(trigger),policy=this.policy(trigger)
  // A persistent conversation is context, not an ongoing grant to execute new chatter.
  // Task-owned follow-ups are routed separately under their original mandate.
  const gate=this.gate(trigger)
  const base={triggerId:trigger.id,discussion,policyVersion:policy.version,generation:(this.get(trigger.id)?.generation??0)+1,revision:(this.get(trigger.id)?.revision??0)+1,at:new Date().toISOString()}
  if(!gate.admissible)return this.save({...base,state:'ignored',reason:gate.reason})
  try{this.scopes?.assertTrigger(trigger);this.scopes?.route(trigger,discussion)}catch(error){return this.save({...base,state:'unavailable',reason:String(error),...(error instanceof RouterScopeAmbiguity?{clarification:{question:'请指定一项你有权继续的任务；当前请求不会自动合并或追加到已有任务。'}}:{})})}
  const record:RouterAdmission={...base,state:gate.strength==='explicit'?'accepted':'pending',reason:gate.strength==='explicit'?'explicit':'ruleAssessmentRequired',
   mandate:{strength:gate.strength,policyVersion:policy.version,basis:gate.basis,actor:trigger.actor,scope:trigger.text}}
  this.save(record)
  if(this.defer?.(record,trigger))return record
  if(record.state==='accepted')this.enqueue(record)
  else this.store.enqueue('router-admit:'+bodyDigest([trigger.id,policy.version,record.revision]),'router-admit',{triggerId:trigger.id,policyVersion:policy.version,revision:record.revision})
  return record
 }
 private enqueue(record:RouterAdmission){this.store.enqueue('router:'+record.triggerId,'router',{discussion:record.discussion,triggerId:record.triggerId})}
 /** Only the host's authenticated delegation adapter can establish this derived authority. */
 admitDelegated(trigger:Trigger){
  this.store.triggers.save(trigger)
  const mandate=this.delegatedAuthority?.(trigger.id)
  if(!mandate||trigger.human)throw Error('Verified service delegation required')
  this.scopes?.assertTrigger(trigger);this.scopes?.route(trigger,this.discussion(trigger))
  const record=this.save({triggerId:trigger.id,discussion:this.discussion(trigger),policyVersion:mandate.policyVersion,state:'accepted',reason:'verifiedDelegation',at:new Date().toISOString(),mandate})
  this.enqueue(record);return record
 }
 receive(trigger:Trigger){
  if(this.get(trigger.id))return {disposition:'duplicate',triggerId:trigger.id,discussion:this.discussion(trigger),thread:trigger.threads[0]!.id,related:[]}
  const record=this.admit(trigger)
  return {disposition:record.state==='ignored'?'ignored':'stored',reason:record.reason,triggerId:trigger.id,discussion:record.discussion,thread:trigger.threads[0]!.id,related:[]}
 }
 /** A policy change invalidates an in-flight semantic assessment, including a changed rule body. */
 refresh(id:string,version:string):RouterAdmission|undefined{
  const record=this.get(id)
  if(this.store.get('router-cancelled',id))return
  if(record?.state!=='pending'||record.policyVersion!==version)return
  try{const trigger=this.store.triggers.get(id);if(!trigger)throw Error('Source unavailable');this.scopes?.assertTrigger(trigger)}catch(error){this.save({...record,state:'unavailable',reason:String(error)});return}
  if(version!==this.policy(this.store.triggers.get(id)).version){this.admit(this.store.triggers.get(id)!);return}
  return record
 }
 ignore(id:string,version:string,reason:string){
  const record=this.refresh(id,version)
  if(record)return this.save({...record,state:'ignored',reason})
 }
 cancel(id:string){const record=this.get(id);if(record)this.save({...record,state:'cancelled',reason:'Cancelled by user'})}
 decide(id:string,version:string,decision:Assessment,dispatch=true){
  const record=this.refresh(id,version);if(!record)return
  const trigger=this.store.triggers.get(id)!
  validateRuleAssessment(decision,this.rules(trigger))
  const matched=decision.rules.length>0
  // Bot/inferred events cannot stop work; attaching is also execution and needs matching rules.
  if(decision.action==='ignore'||decision.action==='stop'||!matched)return this.save({...record,state:'ignored',reason:decision.action==='stop'?'stopNotExplicit':matched?decision.reason:'noMatchingRule',assessment:decision})
  if(!implementationAllowed(decision))return this.save({...record,state:'ignored',reason:'implementationIntentUnsettled',assessment:decision})
  if(!this.policy(trigger).admitsInferred(decision.rules))return this.save({...record,state:'observed',reason:'observe',assessment:decision})
  if(!decision.scope.trim())throw Error('Accepted rule work requires a bounded scope')
  const accepted:RouterAdmission={...record,state:'accepted',reason:decision.reason,assessment:decision,mandate:{...record.mandate!,scope:decision.scope,basis:{...record.mandate!.basis,rules:decision.rules}}}
  this.save(accepted);if(dispatch)this.enqueue(accepted)
  return accepted
 }
 unavailable(id:string,version:string,error:unknown){
  const record=this.refresh(id,version)
  if(record)this.save({...record,state:'unavailable',reason:String(error).slice(0,500)})
 }
 /** Restore only a known old Router turn/delegation, without queuing new work on upgrade. */
 restoreLegacy(id:string,discussion:string){
  if(this.get(id))return
  const trigger=this.store.triggers.get(id)
  if(!trigger?.threads[0]||this.discussion(trigger)!==discussion)return
  const gate=this.gate(trigger),policy=this.policy()
  const base={triggerId:id,discussion,policyVersion:policy.version,at:new Date().toISOString()}
  if(!gate.admissible||gate.strength!=='explicit'){this.save({...base,state:'unavailable',reason:'Legacy Router input needs a new explicit request'});return}
  this.save({...base,state:'accepted',reason:'Restored legacy explicit Router input',mandate:{strength:'explicit',policyVersion:policy.version,basis:gate.basis,actor:trigger.actor,scope:trigger.text}})
 }
 /** Only host-created delegation receipts can carry authority into the core's isolated task thread. */
 forEngine(base:Policy):Policy{
  return {...base,revalidate:mandate=>this.policy().revalidate(mandate),admitsInferred:rules=>this.policy().admitsInferred(rules),gate:(trigger,thread,tickets)=>{
   const delegation=this.store.get<{parentTrigger:string;discussion:string}>('router-delegation',trigger.id)
   if(!delegation)return base.gate(trigger,thread,tickets)
   try{const mandate=this.authority(delegation.parentTrigger,delegation.discussion);return {admissible:true,strength:mandate.strength,basis:mandate.basis}}
   catch{return {admissible:false,reason:'routerAuthorizationWithdrawn'}}
  }}
 }
}
