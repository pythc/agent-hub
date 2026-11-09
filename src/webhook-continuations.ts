import {z} from 'zod'
import type {Runtime} from './runtime.ts'
import type {RouterGoal} from './router-goals.ts'
import type {Webhooks,WebhookGrant,WebhookReceipt} from './webhooks.ts'
import type {WorkOwner} from './work.ts'
import {stableDigest} from './sources.ts'
import {allowNewTaskInputs} from './task-context.ts'
import {WebhookError} from './webhook-protocol.ts'

export const continuationRuleSchema=z.object({
 id:z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/),nodeId:z.string().min(1),eventType:z.string().min(1).max(200),
 correlationParameter:z.string().min(1),timeoutSeconds:z.number().int().min(1).max(604800),
 earlyEventSeconds:z.number().int().min(1).max(604800).default(86400),
}).strict()
export const eventWaitSchema=z.object({action:z.enum(['wait','read','cancel']),ruleId:z.string().min(1).max(64),requestId:z.string().min(1).max(200)}).strict()
export interface EventWait {
 id:string;grantId:string;goalId:string;nodeId:string;ticketId:string;assignmentId:string;ruleId:string;requestId:string;
 ownerHash:string;ownerScopeHash:string;contractHash:string;nodeHash:string;correlation:string;at:number;deadline:number;
 state:'waiting'|'delivered'|'expired'|'stale'|'cancelled';receiptId?:string;reason?:string
}
/** Event waits consume no model or process. Notes and receipt consumption share a transaction. */
export class WebhookContinuations {
 constructor(private host:Runtime,private webhooks:Webhooks,private now:()=>number){}
 validate(g:Pick<WebhookGrant,'protocolVersion'|'continuations'|'eventTypes'|'parameters'|'template'>){
  if(g.continuations.length&&g.protocolVersion!==2)throw new WebhookError(400,'continuations_require_protocol_2')
  const ids=new Set<string>(),types=new Set<string>()
  for(const r of g.continuations){
   if(ids.has(r.id)||types.has(r.eventType)||g.eventTypes.includes(r.eventType)||!g.template.nodes.some(n=>n.id===r.nodeId)||g.parameters[r.correlationParameter]?.type!=='string')throw new WebhookError(400,'invalid_continuation_rule')
   ids.add(r.id);types.add(r.eventType)
  }
 }
 list(){return this.host.store.list<EventWait>('webhook-wait')}
 private key(g:WebhookGrant,r:WebhookReceipt,rule:z.infer<typeof continuationRuleSchema>){return stableDigest([g.id,rule.id,r.event.data[rule.correlationParameter]])}
 checkCorrelation(g:WebhookGrant,r:WebhookReceipt){
  for(const rule of g.continuations??[]){
   const existing=this.host.store.get<{receiptId:string}>('webhook-correlation',this.key(g,r,rule))
   if(existing&&existing.receiptId!==r.id)throw new WebhookError(409,'correlation_already_used')
  }
 }
 bind(g:WebhookGrant,r:WebhookReceipt){for(const rule of g.continuations??[])this.host.store.put('webhook-correlation',this.key(g,r,rule),{goalId:r.goalId,receiptId:r.id})}
 private nodeHash(goal:RouterGoal,nodeId:string){const n=goal.nodes?.find(n=>n.id===nodeId);return stableDigest({instruction:n?.instruction,dependsOn:n?.dependsOn,workerId:n?.workerId})}
 readyAllowed(ticketId:string){
  const triggerId=this.host.taskAuthority(ticketId)?.parentTrigger,input=triggerId?this.host.store.get<{grantId:string;receiptId:string}>('webhook-input',triggerId):undefined
  if(!input)return true
  const g=this.webhooks.grant(input.grantId),goalId=this.webhooks.receipt(input.receiptId)?.goalId,goal=goalId?this.host.goals.get(goalId):undefined,node=goal?.nodes?.find(n=>n.ticketId===ticketId)
  return (g.continuations??[]).filter(rule=>rule.nodeId===node?.id).every(rule=>this.list().some(w=>w.ticketId===ticketId&&w.ruleId===rule.id&&this.consumed(w)))
 }
 private ownerScopeHash(ticketId:string){const owner=this.host.scopes.ownership(ticketId);return stableDigest(owner?{...owner,dataRevision:undefined}:null)}
 /** The original grant's event prerequisites survive every execution-plan revision. */
 assertCompletion(goal:RouterGoal,g:WebhookGrant){
  for(const rule of g.continuations??[])if(!this.list().some(w=>w.grantId===g.id&&w.goalId===goal.id&&w.ruleId===rule.id&&w.nodeId===rule.nodeId&&this.consumed(w,true)))throw Error('Webhook completion requires consumed external event evidence: '+rule.id)
 }
 private consumed(w:EventWait,finishing=false){
  if(w.state!=='delivered'||!w.receiptId)return false
  try{
   this.valid(w,finishing)
   const r=this.webhooks.receipt(w.receiptId),g=this.webhooks.grant(w.grantId),rule=g.continuations.find(rule=>rule.id===w.ruleId)
   return !!r&&!!rule&&r.state==='consumed'&&r.waitId===w.id&&r.goalId===w.goalId&&r.grantId===w.grantId&&r.event.type===rule.eventType&&this.key(g,r,rule)===w.correlation
  }catch{return false}
 }
 private valid(w:EventWait,finishing=false){
  const g=this.webhooks.grant(w.grantId);this.webhooks.approved(g)
  const goal=this.host.goals.get(w.goalId),ticket=this.host.store.tickets.get(w.ticketId)
  if(!goal||!ticket||ticket.ended&&!finishing||ticket.assignments.at(-1)?.id!==w.assignmentId||goal.nodes?.find(n=>n.id===w.nodeId)?.ticketId!==w.ticketId||stableDigest(goal.contract)!==w.contractHash||w.state!=='delivered'&&this.nodeHash(goal,w.nodeId)!==w.nodeHash||(w.state==='delivered'?this.ownerScopeHash(w.ticketId)!==w.ownerScopeHash:stableDigest(this.host.scopes.ownership(w.ticketId))!==w.ownerHash)||goal.state==='cancelled'||goal.state==='completed'&&!finishing)throw new WebhookError(409,'wait_ownership_ended')
  this.host.scopes.checkTask(w.ticketId,this.host.goals.context(goal),true)
  return goal
 }
 pending(ticketId:string,assignmentId?:string){return this.list().find(w=>w.ticketId===ticketId&&(!assignmentId||w.assignmentId===assignmentId)&&w.state==='waiting')}
 command(owner:WorkOwner,value:unknown){
  this.webhooks.requireV2()
  const x=eventWaitSchema.parse(value)
  if(owner.agentId||!this.host.validWork(owner))throw new WebhookError(403,'root_assignment_required')
  const triggerId=this.host.taskAuthority(owner.ticketId)?.parentTrigger,input=triggerId?this.host.store.get<{grantId:string;receiptId:string}>('webhook-input',triggerId):undefined
  if(!input)throw new WebhookError(403,'automation_wait_required')
  const g=this.webhooks.grant(input.grantId),receipt=this.webhooks.receipt(input.receiptId)!,goal=receipt.goalId?this.host.goals.get(receipt.goalId):undefined,rule=g.continuations?.find(r=>r.id===x.ruleId)
  this.webhooks.approved(g)
  if(!goal||!rule||goal.nodes?.find(n=>n.id===rule.nodeId)?.ticketId!==owner.ticketId)throw new WebhookError(403,'wait_rule_outside_node')
  const id='wait_'+stableDigest([owner.ticketId,owner.assignmentId,x.requestId]),prior=this.host.store.get<EventWait>('webhook-wait',id)
  if(prior&&prior.ruleId!==x.ruleId)throw new WebhookError(409,'wait_request_conflict')
  if(x.action!=='wait'&&!prior)throw new WebhookError(404,'unknown_wait')
  let w=prior
  if(!w){
   if(this.list().some(w=>w.goalId===goal.id&&w.ruleId===rule.id))throw new WebhookError(409,'rule_already_subscribed')
   w={id,grantId:g.id,goalId:goal.id,nodeId:rule.nodeId,ticketId:owner.ticketId,assignmentId:owner.assignmentId,ruleId:rule.id,requestId:x.requestId,ownerHash:stableDigest(this.host.scopes.ownership(owner.ticketId)),ownerScopeHash:this.ownerScopeHash(owner.ticketId),contractHash:stableDigest(goal.contract),nodeHash:this.nodeHash(goal,rule.nodeId),correlation:this.key(g,receipt,rule),at:this.now(),deadline:this.now()+rule.timeoutSeconds*1000,state:'waiting'}
   this.host.store.put('webhook-wait',id,w)
  }
  this.valid(w)
  if(x.action==='cancel'&&w.state==='waiting'){w={...w,state:'cancelled'};this.host.store.put('webhook-wait',id,w)}
  // Consume already accepted early events before the worker returns waiting.
  this.advance()
  w=this.host.store.get<EventWait>('webhook-wait',id)!
  return {...w,...(w.state==='delivered'?{trust:'untrusted_external_data',event:this.webhooks.receipt(w.receiptId!)?.event}:{}),instruction:w.state==='waiting'?'Return waiting without a human question; this assignment wakes on receipt.':undefined}
 }
 advance(){
  if(this.host.isPaused)return
  for(const w of this.list().filter(w=>w.state==='waiting')){
   let goal
   try{goal=this.valid(w)}catch{this.host.store.put('webhook-wait',w.id,{...w,state:'stale',reason:'authorization_or_ownership_changed'});continue}
   if(!['active','waiting'].includes(goal.state))continue // Human pause retains but never wakes work.
   const timely=this.host.store.db.prepare("SELECT body FROM webhook_inbox WHERE grant_id=? AND state='received' AND at<=?").all(w.grantId,w.deadline).some(row=>{const r=JSON.parse(String(row.body)) as WebhookReceipt,g=this.webhooks.grant(w.grantId),rule=g.continuations.find(r=>r.id===w.ruleId)!;return r.event.type===rule.eventType&&this.key(g,r,rule)===w.correlation})
   if(w.deadline<=this.now()&&!timely)this.host.store.atomic(()=>{
    this.host.store.put('webhook-wait',w.id,{...w,state:'expired',reason:'external_event_timeout'})
    const prior=this.host.store.tickets.get(w.ticketId)!.inputs.map(i=>i.id)
    this.host.engine.note(w.ticketId,JSON.stringify({kind:'external_event_timeout',waitId:w.id,ruleId:w.ruleId,instruction:'Report the missing event as blocked. Do not fabricate it or change acceptance.'}))
    allowNewTaskInputs(this.host.store,w.ticketId,prior)
   })
  }
  const rows=this.host.store.db.prepare("SELECT body FROM webhook_inbox WHERE state='received' ORDER BY at LIMIT 1000").all()
  for(const row of rows){const r=JSON.parse(String(row.body)) as WebhookReceipt,g=this.webhooks.grant(r.grantId),rule=g.continuations?.find(rule=>rule.eventType===r.event.type)
   if(!rule)continue
   this.host.store.atomic(()=>{
    try{this.webhooks.approved(g)}catch{r.state='held';r.error='authorization_unavailable';this.webhooks.saveReceipt(r);return}
    const correlation=this.key(g,r,rule),binding=this.host.store.get<{goalId:string}>('webhook-correlation',correlation),goal=binding?this.host.goals.get(binding.goalId):undefined
    const wait=this.list().find(w=>w.correlation===correlation)
    if(goal&&['completed','cancelled'].includes(goal.state)||wait&&wait.state!=='waiting'){r.state='ignored';r.error='continuation_closed';this.webhooks.saveReceipt(r);return}
    if(!wait&&r.at+rule.earlyEventSeconds*1000<=this.now()){r.state='expired';r.error='unmatched_event_expired';this.webhooks.saveReceipt(r);return}
    if(!wait||!goal||!['active','waiting'].includes(goal.state))return
    if(r.at>wait.deadline){r.state='ignored';r.error='event_after_wait_deadline';this.webhooks.saveReceipt(r);return}
    try{this.valid(wait)}catch{return}
    // Consumption and input queue insertion are one commit; restart cannot insert a second note.
    const prior=this.host.store.tickets.get(wait.ticketId)!.inputs.map(i=>i.id)
    this.host.engine.note(wait.ticketId,JSON.stringify({kind:'external_event',waitId:wait.id,ruleId:wait.ruleId,receiptId:r.id,trust:'untrusted_external_data',event:r.event}))
    allowNewTaskInputs(this.host.store,wait.ticketId,prior)
    this.host.store.put('webhook-wait',wait.id,{...wait,state:'delivered',receiptId:r.id})
    r.state='consumed';r.goalId=goal.id;r.waitId=wait.id;this.webhooks.saveReceipt(r)
   })
  }
 }
}
