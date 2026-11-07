import type {Runtime} from './runtime.ts'
import type {Trigger} from './vendor/dsh-core/index.ts'
import {makeScope} from './policy.ts'
import {bodyDigest} from './sources.ts'
import {z} from 'zod'
import type {Job} from './store.ts'
import type {ToolSpec} from './model.ts'

interface Owner {ticketId:string;discussion:string;source:string;actor:string;parentTrigger?:string;mode:string}
interface Relay {id:string;triggerId:string;ticketId:string;parentTrigger:string;discussion:string;returned?:string}

/** Mirror task-owned context into an internal channel; the Worker never acquires a public reply channel. */
export function relayRouterFollowups(host:Runtime,trigger:Trigger):string[]{
 if(trigger.addressed||!trigger.human||host.routerIngress.get(trigger.id)?.state==='accepted'||!makeScope(host.config,host.sourceRegistry).scope(trigger).listened)return []
 const discussion=trigger.source+':'+trigger.threads[0]!.id,owners:string[]=[]
 for(const owner of host.store.list<Owner>('worker-assignment')){
  if(owner.mode!=='host'||!owner.parentTrigger||owner.discussion!==discussion||owner.source!==trigger.source||owner.actor!==trigger.actor.id)continue
  const ticket=host.store.tickets.get(owner.ticketId),origin=ticket&&host.store.triggers.get(ticket.origin.triggerId)
  if(!ticket||!origin||ticket.ended?.by==='human')continue
  // Completed work resumes only on a human follow-up and a still-valid original mandate.
  try{host.routerIngress.authority(owner.parentTrigger,discussion)}catch{continue}
  const id='router-context:'+bodyDigest([ticket.id,trigger.id])
  if(host.store.get('router-followup',id)){owners.push(ticket.id);continue}
  const internal:Trigger={...trigger,id,threads:origin.threads,channel:origin.channel,meta:{...trigger.meta,delegatedBy:'router',parentTrigger:owner.parentTrigger,externalTriggerId:trigger.id}}
  host.store.triggers.save(internal)
  host.engine.attach(ticket.id,id,'Discussion follow-up: decide whether it fits the existing mandate. Hand back this internal trigger ID if it requires a new task. Do not broaden scope.')
  host.store.put('router-followup',id,{id,triggerId:trigger.id,ticketId:ticket.id,parentTrigger:owner.parentTrigger,discussion} satisfies Relay)
  owners.push(ticket.id)
 }
 if(owners.length){
  const admission=host.routerIngress.get(trigger.id)
  if(admission?.state==='pending')host.routerIngress.ignore(trigger.id,admission.policyVersion,'workerOwnedFollowup')
  host.store.put('router-followup-notice',trigger.id,{triggerId:trigger.id,discussion,actor:trigger.actor.id,owners,read:false})
  host.store.enqueue('router-followup:'+trigger.id,'router-followup',{triggerId:trigger.id,discussion})
 }
 return owners
}

/** Only a reached, host-created follow-up can return to admission, and only once all its owners return it. */
export function returnRouterFollowup(host:Runtime,ticketId:string,id:string,reason:string){
 const relay=host.store.get<Relay>('router-followup',id),ticket=host.store.tickets.get(ticketId)
 if(!relay||relay.ticketId!==ticketId||!ticket?.inputs.some(i=>i.kind==='trigger'&&i.triggerId===id))throw Error('Handback is not a reached Router follow-up')
 if(relay.returned)return
 host.store.put('router-followup',id,{...relay,returned:reason})
 reconsiderRouterFollowups(host,relay.triggerId)
}

function currentRelayAuthority(host:Runtime,relay:Relay){
 const owner=host.store.get<Owner>('worker-assignment',relay.ticketId),trigger=host.store.triggers.get(relay.triggerId)
 if(!owner||!trigger||owner.mode!=='host'||!owner.parentTrigger||owner.discussion!==relay.discussion||owner.source!==trigger.source||owner.actor!==trigger.actor.id)throw Error('Follow-up task ownership changed')
 // Explicit continuations advance reply/cancellation lineage without changing the original mandate.
 return host.routerIngress.authority(owner.parentTrigger,relay.discussion)
}
function holdsRelay(host:Runtime,relay:Relay){
 if(host.store.tickets.get(relay.ticketId)?.ended?.by==='human')return false
 try{currentRelayAuthority(host,relay);return !!host.store.tickets.get(relay.ticketId)}catch{return false}
}
export function reconsiderRouterFollowups(host:Runtime,triggerId?:string){
 const relays=host.store.list<Relay>('router-followup')
 for(const id of new Set(relays.filter(r=>r.returned&&(!triggerId||r.triggerId===triggerId)).map(r=>r.triggerId))){
 if(host.store.get('router-handback',id)||host.store.get('router-cancelled',id))continue
 const others=relays.filter(r=>r.triggerId===id)
 if(others.some(r=>!r.returned&&holdsRelay(host,r)))continue
 const trigger=host.store.triggers.get(id)!
 host.store.atomic(()=>{host.routerIngress.admit(trigger);host.store.put('router-handback',trigger.id,{triggerId:trigger.id,owners:others.map(r=>({ticketId:r.ticketId,reason:r.returned})),at:Date.now()})})
 }
}

const stopInput=z.object({triggerId:z.string(),ticketId:z.string(),explicit_stop_requested:z.literal(true),evidence:z.string().min(1).max(700)}).strict()
const readInput=z.object({triggerId:z.string(),offset:z.number().int().min(0).default(0),limit:z.number().int().min(1).max(8000).default(4000)}).strict()
export const followupSpecs:ToolSpec[]=[
 {type:'function',name:'orchestrator_followup_stop',description:'Stop only a task explicitly named by a human follow-up in this inbox. Quote exact stop-request evidence from that message. This withdraws the mandate as a human stop; it cannot create or broaden work.',inputSchema:z.toJSONSchema(stopInput,{target:'draft-7'})},
 {type:'function',name:'orchestrator_followup_read',description:'Read the full text of a follow-up from this inbox, with bounded text paging.',inputSchema:z.toJSONSchema(readInput,{target:'draft-7',io:'input'})},
]
interface Notice {triggerId:string;discussion:string;actor:string;owners:string[];read:boolean}

/** Follow-up stop decisions stay in the persistent Router, separate from new-work admission. */
export class RouterFollowupBatch {
 readonly notices:Notice[]
 constructor(private host:Runtime,job:Job){
  const {triggerId}=job.payload as {triggerId:string},notice=host.store.get<Notice>('router-followup-notice',triggerId)
  this.notices=!notice||notice.read?[]:host.store.list<Notice>('router-followup-notice').filter(n=>!n.read&&n.discussion===notice.discussion&&n.actor===notice.actor).slice(0,20)
 }
 get trigger(){return this.host.store.triggers.get(this.notices.at(-1)!.triggerId)!}
 private relay(triggerId:string,ticketId:string){
  if(!this.notices.some(n=>n.triggerId===triggerId&&n.owners.includes(ticketId)))throw Error('Task is outside this follow-up inbox')
  const relay=this.host.store.list<Relay>('router-followup').find(r=>r.triggerId===triggerId&&r.ticketId===ticketId)
  if(!relay)throw Error('Follow-up was not reached')
  return relay
 }
 private authorize(relay:Relay){
  const trigger=this.host.store.triggers.get(relay.triggerId)!,ticket=this.host.store.tickets.get(relay.ticketId)
  if(!trigger.human||!ticket||this.host.store.get('router-cancelled',trigger.id)||!makeScope(this.host.config,this.host.sourceRegistry).scope(trigger).listened)throw Error('Follow-up authorization withdrawn')
  currentRelayAuthority(this.host,relay)
  const gate=this.host.routerIngress.policy().gate(trigger,{key:relay.discussion,ref:trigger.threads[0]!,createdAt:trigger.at,subscriptions:[ticket.id],correlated:[],pending:[],meta:{}},[ticket])
  if(!gate.admissible||gate.strength!=='explicit')throw Error('A human stop requires explicit follow-up authority')
  return trigger
 }
 private eligible(n:Notice){return n.owners.filter(id=>{try{this.authorize(this.relay(n.triggerId,id));return true}catch{return false}})}
 card(){return {kind:'task_followups',followups:this.notices.map(n=>({triggerId:n.triggerId,owners:this.eligible(n).map(id=>{const t=this.host.store.tickets.get(id)!;return {id,title:t.title.slice(0,160),scope:t.mandate.scope.slice(0,700)}}),text:this.host.store.triggers.get(n.triggerId)!.text.slice(0,4000)})),instruction:'These inputs already reached their Workers. Only classify explicit human stop requests. Do not create, assign or resend work. For all other content return an empty reply.'}}
 get actionable(){return this.notices.some(n=>this.eligible(n).length)}
 async tool(name:string,value:unknown){
  if(name==='orchestrator_followup_read'){
   const input=readInput.parse(value),notice=this.notices.find(n=>n.triggerId===input.triggerId)
   if(!notice||!this.eligible(notice).length)throw Error('Follow-up is outside this reader')
   const text=this.host.store.triggers.get(input.triggerId)!.text
   return {text:text.slice(input.offset,input.offset+input.limit),nextOffset:input.offset+input.limit<text.length?input.offset+input.limit:null}
  }
  if(name!=='orchestrator_followup_stop')throw Error('Follow-up turns cannot create or change work')
  const input=stopInput.parse(value),relay=this.relay(input.triggerId,input.ticketId),trigger=this.authorize(relay)
  if(!trigger.text.includes(input.evidence.trim())||!input.evidence.trim())throw Error('Stop evidence must quote the human message')
  const key=bodyDigest([input.triggerId,input.ticketId])
  if(this.host.store.get('router-followup-stopped',key)){
   const ended=this.host.store.tickets.get(input.ticketId)?.ended
   return ended?.by==='human'?{stopped:true,replayed:true}:{stopped:false,replayed:true,alreadyEnded:!!ended,ended}
  }
  this.host.store.put('router-followup-stop-attempt',key,{triggerId:input.triggerId,ticketId:input.ticketId})
  await this.host.stop(input.ticketId)
  const ended=this.host.store.tickets.get(input.ticketId)?.ended
  if(ended?.by!=='human')return {stopped:false,alreadyEnded:!!ended,ended}
  this.host.store.put('router-followup-stopped',key,{triggerId:input.triggerId,ticketId:input.ticketId})
  return {stopped:true}
 }
 get replied(){return this.notices.some(n=>n.owners.some(id=>{if(!this.host.store.get('router-followup-stop-attempt',bodyDigest([n.triggerId,id])))return false;this.authorize(this.relay(n.triggerId,id));return true}))}
 finish(){for(const n of this.notices){this.host.store.put('router-followup-notice',n.triggerId,{...n,read:true});this.host.store.jobState('router-followup:'+n.triggerId,'done')}}
}
