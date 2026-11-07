import type {Runtime} from './runtime.ts'
import type {Trigger} from './vendor/dsh-core/index.ts'
import {makeScope} from './policy.ts'
import {bodyDigest} from './sources.ts'

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
 }
 return owners
}

/** Only a reached, host-created follow-up can return to admission, and only once all its owners return it. */
export function returnRouterFollowup(host:Runtime,ticketId:string,id:string,reason:string){
 const relay=host.store.get<Relay>('router-followup',id),ticket=host.store.tickets.get(ticketId)
 if(!relay||relay.ticketId!==ticketId||!ticket?.inputs.some(i=>i.kind==='trigger'&&i.triggerId===id))throw Error('Handback is not a reached Router follow-up')
 if(relay.returned)return
 host.store.put('router-followup',id,{...relay,returned:reason})
 const others=host.store.list<Relay>('router-followup').filter(r=>r.triggerId===relay.triggerId)
 if(others.some(r=>!r.returned))return
 const trigger=host.store.triggers.get(relay.triggerId)!
 host.routerIngress.admit(trigger)
 host.store.put('router-handback',trigger.id,{triggerId:trigger.id,owners:others.map(r=>({ticketId:r.ticketId,reason:r.returned})),at:Date.now()})
}
