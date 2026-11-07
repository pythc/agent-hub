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
 revision?:number
 state:'pending'|'accepted'|'ignored'|'observed'|'unavailable'|'cancelled'
 reason:string
 at:string
 anchor?:string
 mandate?:Mandate
 assessment?:Assessment
}

/** Host ingress uses exactly the same source scope, admission matrix and rule policy as Engine. */
export class RouterIngress {
 constructor(private config:Config,private store:Store,private registry:SourceRegistry){}
 policy(){return makePolicy(this.config,()=>false,this.registry)}
 get(id:string){return this.store.get<RouterAdmission>('router-admission',id)}
 private discussion(trigger:Trigger){return trigger.source+':'+trigger.threads[0]!.id}
 private gate(trigger:Trigger,anchor?:RouterAdmission):GateResult{
  const scope=makeScope(this.config,this.registry).scope(trigger)
  if(!scope.listened)return {admissible:false,reason:scope.reason}
  const thread:Thread={key:this.discussion(trigger),ref:trigger.threads[0]!,createdAt:trigger.at,subscriptions:anchor?[anchor.triggerId]:[],correlated:[],pending:[],meta:{}}
  return this.policy().gate(trigger,thread,[])
 }
 private valid(record:RouterAdmission):boolean{
  const trigger=this.store.triggers.get(record.triggerId),mandate=record.mandate
  if(record.state!=='accepted'||!trigger||!mandate||!this.policy().revalidate(mandate))return false
  // Follow-ups retain a real, currently authorized conversation anchor, never just a session ID.
  const anchor=record.anchor?this.get(record.anchor):undefined
  if(record.anchor&&(!anchor||anchor.anchor||!this.valid(anchor)))return false
  const gate=this.gate(trigger,anchor)
  return gate.admissible&&(mandate.strength==='inferred'||gate.strength==='explicit')
 }
 authority(id:string,discussion?:string):Mandate{
    if(this.store.get('router-cancelled',id))throw Error('Router run was cancelled')
  const record=this.get(id)
  if(!record||discussion&&record.discussion!==discussion||!this.valid(record))throw Error('Router authorization withdrawn or input not admitted')
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
  const discussion=this.discussion(trigger),policy=this.policy()
  // A persistent conversation is context, not an ongoing grant to execute new chatter.
  // Task-owned follow-ups are routed separately under their original mandate.
  const gate=this.gate(trigger)
  const base={triggerId:trigger.id,discussion,policyVersion:policy.version,revision:(this.get(trigger.id)?.revision??0)+1,at:new Date().toISOString()}
  if(!gate.admissible)return this.save({...base,state:'ignored',reason:gate.reason})
  const record:RouterAdmission={...base,state:gate.strength==='explicit'?'accepted':'pending',reason:gate.strength==='explicit'?'explicit':'ruleAssessmentRequired',
   mandate:{strength:gate.strength,policyVersion:policy.version,basis:gate.basis,actor:trigger.actor,scope:trigger.text}}
  this.save(record)
  if(record.state==='accepted')this.enqueue(record)
  else this.store.enqueue('router-admit:'+bodyDigest([trigger.id,policy.version,record.revision]),'router-admit',{triggerId:trigger.id,policyVersion:policy.version,revision:record.revision})
  return record
 }
 private enqueue(record:RouterAdmission){this.store.enqueue('router:'+record.triggerId,'router',{discussion:record.discussion,triggerId:record.triggerId})}
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
  if(version!==this.policy().version){this.admit(this.store.triggers.get(id)!);return}
  return record
 }
 ignore(id:string,version:string,reason:string){
  const record=this.refresh(id,version)
  if(record)return this.save({...record,state:'ignored',reason})
 }
 cancel(id:string){const record=this.get(id);if(record)this.save({...record,state:'cancelled',reason:'Cancelled by user'})}
 decide(id:string,version:string,decision:Assessment,enqueue=true){
  const record=this.refresh(id,version);if(!record)return
  validateRuleAssessment(decision,this.config.rules)
  const matched=decision.rules.length>0
  // Bot/inferred events cannot stop work; attaching is also execution and needs matching rules.
  if(decision.action==='ignore'||decision.action==='stop'||!matched)return this.save({...record,state:'ignored',reason:decision.action==='stop'?'stopNotExplicit':matched?decision.reason:'noMatchingRule',assessment:decision})
  if(!implementationAllowed(decision))return this.save({...record,state:'ignored',reason:'implementationIntentUnsettled',assessment:decision})
  if(!this.policy().admitsInferred(decision.rules))return this.save({...record,state:'observed',reason:'observe',assessment:decision})
  const accepted:RouterAdmission={...record,state:'accepted',reason:decision.reason,assessment:decision,mandate:{...record.mandate!,scope:decision.scope,basis:{...record.mandate!.basis,rules:decision.rules}}}
  this.save(accepted);if(enqueue)this.enqueue(accepted)
  return accepted
 }
 unavailable(id:string,version:string,error:unknown){
  const record=this.refresh(id,version)
  if(record)this.save({...record,state:'unavailable',reason:String(error).slice(0,500)})
 }
 /** Only host-created delegation receipts can carry authority into the core's isolated task thread. */
 forEngine(base:Policy):Policy{
  return {...base,gate:(trigger,thread,tickets)=>{
   const delegation=this.store.get<{parentTrigger:string;discussion:string}>('router-delegation',trigger.id)
   if(!delegation)return base.gate(trigger,thread,tickets)
   try{const mandate=this.authority(delegation.parentTrigger,delegation.discussion);return {admissible:true,strength:mandate.strength,basis:mandate.basis}}
   catch{return {admissible:false,reason:'routerAuthorizationWithdrawn'}}
  }}
 }
}
