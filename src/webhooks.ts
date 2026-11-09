import {createHash,createHmac,timingSafeEqual,randomUUID} from 'node:crypto'
import {ProcessSource} from './plugin-process.ts'
import {githubWorkflowEvent} from '../plugins/github-webhook/normalize.ts'
import {WebhookContinuations,continuationRuleSchema} from './webhook-continuations.ts'
import {workerProfiles} from './worker-pool.ts'
import {z} from 'zod'
import type {Runtime} from './runtime.ts'
import type {ScopeContext} from './router-scope.ts'
import type {Mandate,Trigger} from './vendor/dsh-core/index.ts'
import {goalCommandSchema,type RouterGoal} from './router-goals.ts'
import {validateGraph} from './goal-contract.ts'
import type {VerificationRound} from './goal-verification.ts'
import {stableDigest} from './sources.ts'
import {callbackURL,cloudEventSchema,postWebhook,secretFromEnv,signWebhook,verifyWebhook,WebhookError,type CloudEvent} from './webhook-protocol.ts'

const id=z.string().regex(/^[A-Za-z0-9_-]{1,80}$/)
const env=z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,100}$/)
const eventTypes=['goal.started','goal.waiting','goal.needs_input','goal.paused','goal.held','goal.completed','goal.cancelled','goal.verification_failed','goal.replanned'] as const
const parameter=z.discriminatedUnion('type',[
 z.object({type:z.literal('string'),maxLength:z.number().int().min(1).max(8000).default(1000),values:z.array(z.string().max(8000)).min(1).max(100).optional()}).strict(),
 z.object({type:z.literal('number'),min:z.number().finite(),max:z.number().finite()}).strict(),
 z.object({type:z.literal('boolean')}).strict(),
])
export const automationTemplateSchema=goalCommandSchema.pick({title:true,objective:true,criteria:true,nodes:true,plan:true,nextAction:true,maxTurns:true,maxParallel:true,maxRepairs:true,maxReplans:true}).required({title:true,objective:true,criteria:true,nodes:true})
export const webhookGrantSchema=z.object({
 transport:z.discriminatedUnion('kind',[z.object({kind:z.literal('standard')}).strict(),z.object({kind:z.literal('github-workflow'),repositoryId:z.number().int().positive(),repository:z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/)}).strict()]).default({kind:'standard'}),normalizerSourceId:z.string().min(1).optional(),
 protocolVersion:z.union([z.literal(1),z.literal(2)]).default(1),continuations:z.array(continuationRuleSchema).max(20).default([]),
 operationId:id,triggerId:z.string().min(1).max(300),authorizationQuote:z.string().min(1).max(16000),
 namespace:id,eventSource:z.string().url().max(1000),eventTypes:z.array(z.string().min(1).max(200)).min(1).max(30),subjects:z.array(z.string().max(1000)).min(1).max(100).optional(),
 secretEnvs:z.array(env).min(1).max(2),parameters:z.record(z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/),parameter).refine(p=>Object.keys(p).length<=30),
 template:automationTemplateSchema,
 expiresAt:z.number().int().positive(),maxEvents:z.number().int().min(1).max(100000),maxConcurrent:z.number().int().min(1).max(10).default(1),perMinute:z.number().int().min(1).max(600).default(60),
 callback:z.object({url:z.string().url(),secretEnv:env,idempotent:z.literal(true),events:z.array(z.enum(eventTypes)).min(1).max(20).default(['goal.completed','goal.cancelled','goal.needs_input','goal.held']),resultFiles:z.array(z.string().min(1).max(1000)).max(10).default([]),maxAttempts:z.number().int().min(1).max(50).default(12)}).strict(),
}).strict()
export type WebhookGrant=z.infer<typeof webhookGrantSchema>&{id:string;version:1;active:boolean;receiving:boolean;deliveryPaused:boolean;scopeId:string;entryId:string;tenantId:string;bindingRevision:number;triggerHash:string;policyHash:string;mandate:Mandate;at:number}
export interface WebhookReceipt {id:string;grantId:string;identity:string;fingerprint:string;event:CloudEvent;state:'received'|'dispatched'|'held'|'consumed'|'ignored'|'expired';at:number;goalId?:string;triggerId?:string;error?:string;waitId?:string}
interface AutomationInput {id:string;grantId:string;receiptId:string;triggerHash:string;commandHash:string;mandate:Mandate}
export interface WebhookDelivery {id:string;event_id:string;grant_id:string;goal_id:string;state:string;body:string;payload_hash:string;target:string;secret_env:string;attempts:number;next_at:number;created_at:number;error?:string}

/** Host-owned grants, durable inbox and callback outbox. No second task engine. */
export class Webhooks {
 private sends=new Map<string,{controller:AbortController;promise:Promise<void>}>()
 private closing=false
 readonly continuations:WebhookContinuations
 private reconcileAt=0
 constructor(private host:Runtime,private now:()=>number=Date.now){
  host.store.db.exec(`
   CREATE TABLE IF NOT EXISTS webhook_inbox(id TEXT PRIMARY KEY, identity TEXT UNIQUE NOT NULL, grant_id TEXT NOT NULL, state TEXT NOT NULL, at INTEGER NOT NULL, body TEXT NOT NULL);
   CREATE INDEX IF NOT EXISTS webhook_inbox_queue ON webhook_inbox(state,at);
   CREATE INDEX IF NOT EXISTS webhook_inbox_grant ON webhook_inbox(grant_id,at);
   CREATE TABLE IF NOT EXISTS webhook_events(id TEXT PRIMARY KEY, goal_id TEXT NOT NULL, sequence INTEGER NOT NULL, body TEXT NOT NULL, UNIQUE(goal_id,sequence));
   CREATE TABLE IF NOT EXISTS webhook_deliveries(id TEXT PRIMARY KEY,event_id TEXT NOT NULL,grant_id TEXT NOT NULL,goal_id TEXT NOT NULL,state TEXT NOT NULL,body TEXT NOT NULL,payload_hash TEXT NOT NULL,target TEXT NOT NULL,secret_env TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,next_at INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL,error TEXT,UNIQUE(event_id,grant_id));
   CREATE INDEX IF NOT EXISTS webhook_deliveries_queue ON webhook_deliveries(state,next_at);
   CREATE TABLE IF NOT EXISTS webhook_attempts(delivery_id TEXT NOT NULL,attempt INTEGER NOT NULL,at INTEGER NOT NULL,finished_at INTEGER,status INTEGER,error TEXT,PRIMARY KEY(delivery_id,attempt));
  `)
  // All callbacks explicitly require an idempotent receiver. Retrying an ambiguous
  // attempt is allowed here; the legacy conversation outbox remains uncertain.
  host.store.db.prepare("UPDATE webhook_deliveries SET state='pending',error='host_interrupted' WHERE state='sending'").run()
  host.store.db.prepare("UPDATE webhook_attempts SET finished_at=?,error='host_interrupted' WHERE finished_at IS NULL").run(this.now())
  if(host.store.list('webhook-grant').length)host.store.db.exec('PRAGMA user_version='+Math.max(8,Number(host.store.db.prepare('PRAGMA user_version').get()!.user_version)))
  this.continuations=new WebhookContinuations(host,this,now)
  const previous=host.routerIngress.scheduledAuthority
  host.routerIngress.scheduledAuthority=triggerId=>this.authority(triggerId)??previous?.(triggerId)
  host.routerIngress.automationRevalidate=mandate=>this.revalidate(mandate)
  for(const kind of ['router-goal','goal-verification','goal-replan'])host.store.recordObservers.set(kind,(id,value,old)=>this.observe(kind,id,value,old))
 }
 grant(id:string){const g=this.host.store.get<WebhookGrant>('webhook-grant',id);if(!g)throw new WebhookError(404,'unknown_endpoint');return g}
 private policyHash(c:ScopeContext,v2=false){
  const config=this.host.config,scope=this.host.scopes.scope(c.route.scopeId)
  return stableDigest({scope,source:config.sources.find(s=>s.id===c.trigger.source),execution:config.execution,work:config.work,backends:config.backends,tools:config.toolConnections,browser:config.browser,delivery:config.delivery,plugins:config.sourcePlugins,...(v2?{normalizers:config.sources.filter(s=>this.host.sources.get(s.id) instanceof ProcessSource)}:{})})
 }
 approved(g:WebhookGrant){
  if(!g.active||g.expiresAt<=this.now())throw new WebhookError(403,'automation_grant_revoked_or_expired')
  const t=this.host.store.triggers.get(g.triggerId)
  if(!t?.human||stableDigest(t)!==g.triggerHash)throw new WebhookError(403,'authorization_source_changed')
  const mandate=this.host.routerIngress.authority(t.id),c=this.host.scopes.context(t,t.source+':'+t.threads[0]!.id)
  if(!c||c.route.scopeId!==g.scopeId||c.route.entryId!==g.entryId||this.host.scopes.binding(g.entryId).revision!==g.bindingRevision||!this.host.scopes.canManage(c)||stableDigest(mandate)!==stableDigest(g.mandate)||this.policyHash(c,g.protocolVersion===2)!==g.policyHash)throw new WebhookError(403,'automation_permissions_changed')
  return c
 }
 create(value:unknown){
  if(!this.host.config.webhooks)throw new WebhookError(409,'webhook_listener_not_configured')
  const x=webhookGrantSchema.parse(value),key='grant_'+stableDigest(x.operationId),prior=this.host.store.get<{fingerprint:string;grantId:string}>('webhook-command',key)
  if(prior){
   const g=this.grant(prior.grantId)
   if(prior.fingerprint!==stableDigest(x)){
    // P1 hashed the parsed command before these fields existed. Only an actual
    // legacy grant and an equivalent P1 command may use that fingerprint.
    const {transport,normalizerSourceId,protocolVersion,continuations,...legacy}=x
    if(g.transport!==undefined||g.normalizerSourceId!==undefined||g.protocolVersion!==undefined||g.continuations!==undefined||transport.kind!=='standard'||normalizerSourceId!==undefined||protocolVersion!==1||continuations.length||prior.fingerprint!==stableDigest(legacy))throw new WebhookError(409,'operation_id_conflict')
   }
   return g
  }
  const t=this.host.store.triggers.get(x.triggerId)
  if(!t?.human||!t.text.includes(x.authorizationQuote))throw new WebhookError(403,'real_human_authorization_required')
  const mandate=this.host.routerIngress.authority(t.id),c=this.host.scopes.context(t,t.source+':'+t.threads[0]!.id)
  if(mandate.strength!=='explicit'||!c||!this.host.scopes.canManage(c))throw new WebhookError(403,'scope_manager_authorization_required')
  if(this.host.scopes.binding(c.route.entryId).privateActor)throw new WebhookError(403,'automation_requires_group_entry')
  if(x.expiresAt<=this.now()||x.expiresAt>this.now()+366*86400000)throw new WebhookError(400,'invalid_grant_expiry')
  this.continuations.validate(x)
  if((x.transport.kind!=='standard'||x.normalizerSourceId)&&x.protocolVersion!==2)throw new WebhookError(400,'adapter_requires_protocol_2')
  if(x.normalizerSourceId){const source=this.host.sources.get(x.normalizerSourceId);if(!(source instanceof ProcessSource)||!source.pkg.manifest.methods.includes('webhook')||source.pkg.manifest.network||Object.keys(source.pkg.manifest.credentials).length||source.pkg.manifest.methods.some(m=>!['webhook','close'].includes(m))||!this.host.scopes.scope(c.route.scopeId).sourceIds.includes(x.normalizerSourceId))throw new WebhookError(403,'invalid_webhook_normalizer')}
  if(x.transport.kind==='github-workflow'&&x.eventSource!=='https://github.com/'+x.transport.repository)throw new WebhookError(400,'github_source_mismatch')
  const scope=this.host.scopes.scope(c.route.scopeId)
  validateGraph(x.template.nodes,x.template.criteria)
  if(x.template.nodes.some(n=>!scope.workerIds.includes(n.workerId)))throw new WebhookError(403,'template_worker_outside_scope')
  if(new Set(x.template.criteria.map(cr=>cr.id)).size!==x.template.criteria.length||x.template.criteria.some(cr=>cr.id==='__goal__'))throw new WebhookError(400,'invalid_criteria')
  const files=new Set(x.template.criteria.flatMap(cr=>[...cr.files,...(cr.check?[cr.check.path]:[])]))
  if(x.callback.resultFiles.some(file=>!files.has(file)))throw new WebhookError(400,'callback_result_requires_declared_acceptance_file')
  if(x.template.nodes.some(n=>!workerProfiles(this.host.config).some(w=>w.id===n.workerId&&scope.backendIds.includes(w.backend)&&(!w.state||w.state==='enabled'))))throw new WebhookError(403,'template_worker_unavailable')
  for(const p of Object.values(x.parameters))if(p.type==='number'&&p.min>p.max)throw new WebhookError(400,'invalid_parameter_range')
  callbackURL(x.callback.url,this.host.config.webhooks.loopbackCallbackOrigins)
  const outbound=secretFromEnv(x.callback.secretEnv)
  for(const name of x.secretEnvs)if(secretFromEnv(name).equals(outbound))throw new WebhookError(400,'separate_direction_credentials_required')
  const g:WebhookGrant={...x,id:'hook_'+randomUUID().replaceAll('-',''),version:1,active:true,receiving:true,deliveryPaused:false,scopeId:c.route.scopeId,entryId:c.route.entryId,tenantId:c.route.tenantId,bindingRevision:this.host.scopes.binding(c.route.entryId).revision,triggerHash:stableDigest(t),policyHash:this.policyHash(c,x.protocolVersion===2),mandate,at:this.now()}
  this.host.store.atomic(()=>{
   // Enabling the protocol is a one-way schema barrier: older binaries must not
   // silently reopen a database containing executable automation grants.
   if(x.protocolVersion===2)this.requireV2(true)
   else this.host.store.db.exec('PRAGMA user_version='+Math.max(8,Number(this.host.store.db.prepare('PRAGMA user_version').get()!.user_version)))
   this.host.store.put('webhook-grant',g.id,g);this.host.store.put('webhook-command',key,{fingerprint:stableDigest(x),grantId:g.id})
   this.host.store.audit({type:'webhook.grant_created',id:g.id,triggerId:t.id,templateHash:stableDigest(g.template),actor:c.actor})
  })
  return g
 }
 control(value:unknown){
  const x=z.object({id:z.string(),action:z.enum(['stop_receiving','start_receiving','pause_delivery','resume_delivery','revoke','retry_delivery']),operationId:id,deliveryId:z.string().optional()}).strict().parse(value)
  return this.host.store.atomic(()=>{
   const key='control_'+x.operationId,old=this.host.store.get<{fingerprint:string;result:unknown}>('webhook-command',key)
   if(old){if(old.fingerprint!==stableDigest(x))throw new WebhookError(409,'operation_id_conflict');return old.result}
   const g=this.grant(x.id)
   if(['start_receiving','resume_delivery','retry_delivery'].includes(x.action))this.approved(g)
   if(x.action==='stop_receiving')g.receiving=false
   if(x.action==='start_receiving')g.receiving=true
   if(x.action==='pause_delivery')g.deliveryPaused=true
   if(x.action==='resume_delivery')g.deliveryPaused=false
   if(x.action==='revoke'){g.active=false;g.receiving=false;g.deliveryPaused=true}
   if(x.action==='retry_delivery'){
    const d=this.delivery(x.deliveryId??'')
    if(!d||d.grant_id!==g.id||!['dead','held'].includes(d.state))throw new WebhookError(409,'delivery_not_retryable')
    // Keep identity, frozen body and original destination. Operator extends only
    // the delivery retry window, never the task contract or execution budget.
    this.host.store.db.prepare("UPDATE webhook_deliveries SET state='pending',next_at=?,error=NULL WHERE id=?").run(this.now(),d.id)
    this.host.store.put('webhook-retry-allowance',d.id,{untilAttempt:d.attempts+g.callback.maxAttempts})
   }
   this.host.store.put('webhook-grant',g.id,g)
   if(x.action==='revoke'){
    for(const item of this.receipts(g.id))if(item.goalId){const goal=this.host.goals.get(item.goalId);if(goal&&!['completed','cancelled'].includes(goal.state)){
     this.host.store.put('router-goal',goal.id,{...goal,state:'held',reason:'Automation authorization revoked',nextAt:undefined})
     for(const task of goal.taskIds)this.host.interruptForAutomation(task)
    }}
    this.host.store.db.prepare("UPDATE webhook_deliveries SET state='held',error='authorization_revoked' WHERE grant_id=? AND state='pending'").run(g.id)
   }
   if(['revoke','pause_delivery'].includes(x.action))for(const [id,send] of this.sends)if(this.delivery(id)?.grant_id===g.id)send.controller.abort(Error('Delivery authorization stopped'))
   const result={id:g.id,active:g.active,receiving:g.receiving,deliveryPaused:g.deliveryPaused}
   this.host.store.audit({type:'webhook.control',...x});this.host.store.put('webhook-command',key,{fingerprint:stableDigest(x),result});return result
  })
 }
 requiredHeaders(endpointId:string){return this.grant(endpointId).transport?.kind==='github-workflow'?['x-hub-signature-256','x-github-delivery','x-github-event']:['webhook-id','webhook-timestamp','webhook-signature']}
 private authenticate(g:WebhookGrant,headers:Record<string,string|undefined>,raw:Buffer){
  if(raw.length>64000)throw new WebhookError(413,'event_too_large')
  if(g.transport?.kind==='github-workflow'){
   const signature=headers['x-hub-signature-256']??''
   if(!/^sha256=[a-f0-9]{64}$/.test(signature)||!this.inboundKeys(g).some(name=>{secretFromEnv(name);return timingSafeEqual(createHmac('sha256',process.env[name]!).update(raw).digest(),Buffer.from(signature.slice(7),'hex'))}))throw new WebhookError(401,'invalid_signature')
  }else verifyWebhook(this.inboundKeys(g).map(secretFromEnv),headers,raw,this.now())
  this.approved(g)
  if(!g.receiving)throw new WebhookError(403,'endpoint_not_receiving')
  let parsed:unknown;try{parsed=JSON.parse(raw.toString('utf8'))}catch{throw new WebhookError(400,'invalid_json')}
  return g.transport?.kind==='github-workflow'?githubWorkflowEvent(parsed,g.transport,g.at,this.now()):cloudEventSchema.parse(parsed)
 }
 async ingest(endpointId:string,headers:Record<string,string|undefined>,raw:Buffer){
  const g=this.grant(endpointId),original=this.authenticate(g,headers,raw)
  let event=original
  if(g.normalizerSourceId){const source=this.host.sources.get(g.normalizerSourceId);if(!(source instanceof ProcessSource))throw new WebhookError(503,'normalizer_unavailable');const data=await source.invoke('webhook',{schemaVersion:1,event:original});event=cloudEventSchema.parse({...original,data});this.approved(g);if(!this.grant(g.id).receiving)throw new WebhookError(403,'endpoint_not_receiving')}
  return this.accept(g,event,stableDigest(original))
 }
 receive(endpointId:string,headers:Record<string,string|undefined>,raw:Buffer){
  const g=this.grant(endpointId);if(g.normalizerSourceId)throw new WebhookError(409,'async_ingress_required')
  const event=this.authenticate(g,headers,raw);return this.accept(g,event,stableDigest(event))
 }
 private accept(g:WebhookGrant,event:CloudEvent,originalFingerprint:string){
  this.validateEvent(g,event)
  const binding=this.host.scopes.binding(g.entryId),identity=stableDigest([g.tenantId,g.entryId,binding.provider,binding.accountNamespace,g.namespace,event.source,event.id]),fingerprint=originalFingerprint
  return this.host.store.atomic(()=>{
   const row=this.host.store.db.prepare('SELECT body FROM webhook_inbox WHERE identity=?').get(identity)
   if(row){const old=JSON.parse(String(row.body)) as WebhookReceipt;if(old.fingerprint!==fingerprint)throw new WebhookError(409,'event_identity_conflict');return {...this.publicReceipt(old),duplicate:true}}
   const count=(where:string,...values:(string|number)[])=>Number(this.host.store.db.prepare('SELECT COUNT(*) n FROM webhook_inbox WHERE '+where).get(...values)!.n)
   if(count('grant_id=?',g.id)>=g.maxEvents)throw new WebhookError(429,'grant_event_budget_exhausted')
   if(count('grant_id=? AND at>?',g.id,this.now()-60000)>=g.perMinute||count("state='received'")>=1000)throw new WebhookError(429,'inbox_overloaded')
   const receipt:WebhookReceipt={id:'evt_'+randomUUID().replaceAll('-',''),grantId:g.id,identity,fingerprint,event,state:'received',at:this.now()}
   this.host.store.db.prepare('INSERT INTO webhook_inbox VALUES(?,?,?,?,?,?)').run(receipt.id,identity,g.id,receipt.state,receipt.at,JSON.stringify(receipt))
   return {...this.publicReceipt(receipt),duplicate:false}
  })
 }
 private publicReceipt(r:WebhookReceipt){return {receiptId:r.id,state:r.state,goalId:r.goalId}}
 receipts(grantId?:string):WebhookReceipt[]{return this.host.store.db.prepare('SELECT body FROM webhook_inbox'+(grantId?' WHERE grant_id=?':'')+' ORDER BY at').all(...(grantId?[grantId]:[])).map(r=>JSON.parse(String(r.body)))}
 receipt(id:string):WebhookReceipt|undefined {const row=this.host.store.db.prepare('SELECT body FROM webhook_inbox WHERE id=?').get(id);return row?JSON.parse(String(row.body)):undefined}
 saveReceipt(r:WebhookReceipt){this.host.store.db.prepare('UPDATE webhook_inbox SET state=?,body=? WHERE id=?').run(r.state,JSON.stringify(r),r.id)}
 ownsTrigger(id:string){return typeof id==='string'&&!!this.host.store.get('webhook-input',id)}
 executionAllowed(triggerId?:string){
  if(!triggerId||!this.ownsTrigger(triggerId))return true
  try{this.authority(triggerId);const input=this.host.store.get<AutomationInput>('webhook-input',triggerId)!,receipt=this.receipt(input.receiptId),goal=receipt?.goalId&&this.host.goals.get(receipt.goalId);return !!goal&&['active','waiting'].includes(goal.state)}catch{return false}
 }
 fence(){
  for(const run of this.host.store.list<{ticketId:string;phase:string}>('run'))if(['starting','running','background'].includes(run.phase)&&!this.executionAllowed(this.host.taskAuthority(run.ticketId)?.parentTrigger))this.host.interruptForAutomation(run.ticketId)
  for(const [id,send] of this.sends){try{const g=this.grant(this.delivery(id)!.grant_id);this.approved(g);if(g.deliveryPaused||this.host.isPaused)throw Error('Delivery paused')}catch{send.controller.abort(Error('Delivery authorization stopped'))}}
 }
 permissions(id:string){const input=this.host.store.get<AutomationInput>('webhook-input',id);if(!input)return;const grant=this.grant(input.grantId),workerIds=[...new Set(grant.template.nodes.map(n=>n.workerId))];return {workerIds,backendIds:[...new Set(workerProfiles(this.host.config).filter(w=>workerIds.includes(w.id)).map(w=>w.backend))]}}
 inputData(id:string){const input=this.host.store.get<AutomationInput>('webhook-input',id);return input?{trust:'untrusted_external_data',data:this.receipt(input.receiptId)?.event.data}:undefined}
 private authority(id:string):Mandate|undefined {
  const input=this.host.store.get<AutomationInput>('webhook-input',id);if(!input)return
  this.approved(this.grant(input.grantId))
  const trigger=this.host.store.triggers.get(id),receipt=this.receipt(input.receiptId)
  if(!trigger||trigger.human||stableDigest(trigger)!==input.triggerHash||!receipt||receipt.triggerId!==id)throw new WebhookError(403,'automation_input_changed')
  this.host.scopes.assertTrigger(trigger)
  return input.mandate
 }
 private revalidate(m:Mandate):boolean|undefined {
  const id=m.basis.scope?.automationInputId
  if(id===undefined)return undefined
  if(typeof id!=='string')return false
  try{const original=this.authority(id);return !!original&&stableDigest({...m,scope:original.scope})===stableDigest(original)}catch{return false}
 }
 approvedStart(value:unknown,c:ScopeContext){
  const input=this.host.store.get<AutomationInput>('webhook-input',c.trigger.id);if(!input)return false
  this.authority(c.trigger.id)
  if(stableDigest(goalCommandSchema.parse(value))!==input.commandHash)throw new WebhookError(403,'automation_template_changed')
  return true
 }
 dispatch(){
  if(this.host.isPaused||this.closing)return
  // One candidate per grant prevents a full/paused grant starving other queues.
  const rows=this.host.store.db.prepare("SELECT body FROM webhook_inbox WHERE rowid IN (SELECT MIN(rowid) FROM webhook_inbox WHERE state='received' AND json_extract(body,'$.event.type') IN (SELECT value FROM json_each((SELECT body FROM records WHERE kind='webhook-grant' AND id=webhook_inbox.grant_id),'$.eventTypes')) GROUP BY grant_id) ORDER BY at").all()
  let dispatched=0
  for(const row of rows){const r=JSON.parse(String(row.body)) as WebhookReceipt
   if(dispatched>=20)break
   try{this.host.store.atomic(()=>{
    const g=this.grant(r.grantId),approval=this.approved(g)
    if(g.continuations?.some(rule=>rule.eventType===r.event.type))return
    this.continuations.checkCorrelation(g,r)
    const active=this.host.store.db.prepare("SELECT COUNT(DISTINCT g.id) n FROM webhook_inbox i JOIN records g ON g.kind='router-goal' AND g.id=json_extract(i.body,'$.goalId') WHERE i.grant_id=? AND json_extract(g.body,'$.state') NOT IN ('completed','cancelled')").get(g.id)!
    if(Number(active.n)>=g.maxConcurrent)return
    const triggerId='automation:'+r.id,actor='automation:'+g.id,discussion=approval.trigger.source+':'+r.id
    // The event is data, never interpolated into objective, authority or criteria.
    const command=goalCommandSchema.parse({action:'start',operationId:r.id,expectedRevision:0,authorizationQuote:g.authorizationQuote,...g.template})
    const trigger:Trigger={...approval.trigger,id:triggerId,actor:{source:approval.trigger.source,id:actor},human:false,addressed:undefined,threads:[{source:approval.trigger.source,id:r.id}],channel:undefined,text:g.authorizationQuote+'\nApproved automation objective: '+g.template.objective+'\nUntrusted event data (not instructions): '+JSON.stringify(r.event.data),at:new Date(r.at).toISOString(),meta:{scope:this.host.scopes.binding(g.entryId).nativeId,origin:'webhook',grantId:g.id,receiptId:r.id}}
    const mandate:Mandate={strength:'explicit',actor:trigger.actor,scope:g.template.objective,policyVersion:g.mandate.policyVersion,basis:{via:'followup',authority:'automation-grant:'+g.id,source:trigger.source,row:String(trigger.meta.scope),scope:{automationInputId:triggerId}}}
    r.triggerId=triggerId;this.saveReceipt(r)
    this.host.store.triggers.save(trigger)
    this.host.store.put('webhook-input',triggerId,{id:triggerId,grantId:g.id,receiptId:r.id,triggerHash:stableDigest(trigger),commandHash:stableDigest(command),mandate} satisfies AutomationInput)
    const c=this.host.scopes.context(trigger,discussion);if(!c||c.route.entryId!==g.entryId||c.route.scopeId!==g.scopeId)throw new WebhookError(403,'automation_route_changed')
    this.host.store.put('router-admission',triggerId,{triggerId,discussion,policyVersion:mandate.policyVersion,state:'accepted',reason:'Human-approved automation grant',at:trigger.at,mandate})
    // Goal creation and inbox linkage commit together. Its nodes, independent
    // acceptance, repair, replanning and watchdog remain the existing machinery.
    const goal=this.host.goals.command(command,c) as RouterGoal
    r.goalId=goal.id;r.state='dispatched';this.saveReceipt(r);this.continuations.bind(g,r);dispatched++
   })}catch(error){r.state='held';delete r.goalId;delete r.triggerId;r.error=error instanceof WebhookError?error.code:'dispatch_failed';this.saveReceipt(r);this.host.store.audit({type:'webhook.dispatch_held',receiptId:r.id,code:r.error})}
  }
 }
 private observe(kind:string,id:string,value:any,old:any){
  const goal:RouterGoal|undefined=kind==='router-goal'?value:this.host.goals?.get(value.goalId)
  if(!goal)return
  const triggerId=goal.contract?.triggerId??goal.triggerId;if(typeof triggerId!=='string')return
  const input=this.host.store.get<AutomationInput>('webhook-input',triggerId);if(!input)return
  let type:typeof eventTypes[number]|undefined
  if(kind==='router-goal'&&value.state!==old?.state)type=(!old?'goal.started':'goal.'+value.state) as typeof type
  if(kind==='goal-verification'&&['failed','insufficient'].includes(value.state)&&value.state!==old?.state)type='goal.verification_failed'
  if(kind==='goal-replan'&&value.state==='applied'&&old?.state!=='applied')type='goal.replanned'
  if(!type||!eventTypes.includes(type))return
  const g=this.grant(input.grantId),round:VerificationRound|undefined=type==='goal.verification_failed'?value:goal.finalRoundId?this.host.store.get<VerificationRound>('goal-verification',goal.finalRoundId):undefined
  if(type==='goal.completed')this.continuations.assertCompletion(goal,g)
  if(type==='goal.completed'&&(!round||round.state!=='passed'||!this.host.verification.current(round,goal)))throw Error('Webhook completion requires current independent acceptance')
  const sequence=Number(this.host.store.db.prepare('SELECT COALESCE(MAX(sequence),0)+1 n FROM webhook_events WHERE goal_id=?').get(goal.id)!.n)
  const results=type==='goal.completed'?g.callback.resultFiles.map(path=>{
   const matches=round!.snapshot.evidence.filter(e=>e.kind==='file'&&e.key===path),e=matches[0]
   if(!e||e.missing||matches.some(m=>m.missing||m.content!==e.content))return {path,omitted:'ambiguous_or_unavailable_evidence'}
   return {path,sha256:createHash('sha256').update(e.content).digest('hex'),bytes:Buffer.byteLength(e.content),...(Buffer.byteLength(e.content)<=16000?{content:e.content}:{omitted:'exceeds_16000_bytes'})}
  }):undefined
  const eventId='out_'+randomUUID().replaceAll('-',''),body=JSON.stringify({specversion:'1.0',id:eventId,source:'urn:agenthub:automation:'+g.id,type,time:new Date(this.now()).toISOString(),subject:goal.id,datacontenttype:'application/json',data:{schemaVersion:1,goalId:goal.id,receiptId:input.receiptId,sequence,state:goal.state,contractHash:stableDigest(goal.contract),templateVersion:g.version,results,acceptance:round?{roundId:round.id,state:round.state,checks:round.checks.map((c:any)=>({criterionId:c.criterionId,verdict:c.verdict}))}:null}})
  this.host.store.db.prepare('INSERT INTO webhook_events VALUES(?,?,?,?)').run(eventId,goal.id,sequence,body)
  if(g.callback.events.includes(type))this.host.store.db.prepare("INSERT INTO webhook_deliveries(id,event_id,grant_id,goal_id,state,body,payload_hash,target,secret_env,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)").run('dlv_'+stableDigest([eventId,g.id]),eventId,g.id,goal.id,'pending',body,stableDigest(body),g.callback.url,this.outboundKey(g),this.now())
 }
 delivery(id:string):WebhookDelivery|undefined {return this.host.store.db.prepare('SELECT * FROM webhook_deliveries WHERE id=?').get(id) as unknown as WebhookDelivery|undefined}
 snapshot(){return {protocol:Number(this.host.store.db.prepare('PRAGMA user_version').get()!.user_version)>=9?2:1,waits:this.continuations.list(),reconciliation:this.host.store.get('webhook-reconciliation','latest'),grants:this.host.store.list<WebhookGrant>('webhook-grant').map(g=>({...g,keys:this.host.store.get('webhook-keys',g.id)})),receipts:this.receipts().slice(-1000).reverse().map(r=>({...this.publicReceipt(r),grantId:r.grantId,error:r.error,at:r.at,waitId:r.waitId})),deliveries:this.host.store.db.prepare('SELECT id,event_id,grant_id,goal_id,state,attempts,next_at,created_at,error,payload_hash FROM webhook_deliveries ORDER BY created_at DESC LIMIT 1000').all(),attempts:this.host.store.db.prepare('SELECT * FROM webhook_attempts ORDER BY at DESC LIMIT 1000').all()}}
 flush(){
  if(this.closing||this.host.isPaused)return
  for(const row of this.host.store.db.prepare("SELECT d.id FROM webhook_deliveries d JOIN records g ON g.kind='webhook-grant' AND g.id=d.grant_id WHERE d.state='pending' AND d.next_at<=? AND json_extract(g.body,'$.deliveryPaused')=0 ORDER BY d.created_at LIMIT 20").all(this.now())){
   const id=String(row.id);if(this.sends.size>=4)break;if(this.sends.has(id))continue
   const d=this.delivery(id)!,g=this.grant(d.grant_id)
   if(g.deliveryPaused)continue
   try{this.approved(g)}catch{this.host.store.db.prepare("UPDATE webhook_deliveries SET state='held',error='authorization_unavailable' WHERE id=?").run(id);continue}
   const controller=new AbortController(),promise=this.send(d,g,controller.signal).catch(()=>{this.host.store.db.prepare("UPDATE webhook_deliveries SET state='held',error='delivery_internal_error' WHERE id=? AND state='sending'").run(id)}).finally(()=>this.sends.delete(id))
   this.sends.set(id,{controller,promise})
  }
 }
 private async send(d:WebhookDelivery,g:WebhookGrant,signal:AbortSignal){
  const attempt=d.attempts+1
  this.host.store.atomic(()=>{
   this.host.store.db.prepare("UPDATE webhook_deliveries SET state='sending',attempts=? WHERE id=? AND state='pending'").run(attempt,d.id)
   this.host.store.db.prepare('INSERT INTO webhook_attempts(delivery_id,attempt,at) VALUES(?,?,?)').run(d.id,attempt,this.now())
   const keys=this.host.store.get<{revision:number}>('webhook-keys',g.id);if(keys)this.host.store.put('webhook-attempt-signing',d.id+':'+attempt,{deliveryId:d.id,attempt,secretEnv:d.secret_env,keyRevision:keys.revision})
  })
  let state='pending',code:string|undefined,status:number|undefined,retryAfter:string|undefined
  try{
   if(stableDigest(d.body)!==d.payload_hash)throw new WebhookError(400,'payload_integrity_failure')
   const timestamp=String(Math.floor(this.now()/1000)),signature=signWebhook(secretFromEnv(d.secret_env),d.id,timestamp,d.body)
   const result=await postWebhook(d.target,d.body,{'webhook-id':d.id,'webhook-timestamp':timestamp,'webhook-signature':signature},this.host.config.webhooks?.loopbackCallbackOrigins??[],AbortSignal.any([signal,AbortSignal.timeout(15000)]),()=>{const current=this.grant(g.id);this.approved(current);if(this.host.isPaused||current.deliveryPaused)throw new WebhookError(403,'delivery_paused')})
   status=result.status;retryAfter=result.retryAfter
   state=status>=200&&status<300?'sent':status===401||status===403?'held':status===408||status===429||status>=500?'pending':'dead'
   if(state!=='sent')code='http_'+status
  }catch(error){code=error instanceof WebhookError?error.code:'transport_interrupted';if(error instanceof WebhookError)state=[401,403,503].includes(error.status)?'held':'dead'}
  try{this.approved(this.grant(g.id));if(this.grant(g.id).deliveryPaused&&state!=='sent')state='held'}catch{if(state!=='sent')state='held'}
  const allowance=this.host.store.get<{untilAttempt:number}>('webhook-retry-allowance',d.id)?.untilAttempt??g.callback.maxAttempts
  if(state==='pending'&&attempt>=allowance){state='dead';code='retry_exhausted'}
  const hint=retryAfter?(/^\d+$/.test(retryAfter)?Number(retryAfter)*1000:Date.parse(retryAfter)-this.now()):0
  const delay=Math.max(Math.min(3600000,Number.isFinite(hint)?Math.max(0,hint):0),Math.min(300000,1000*2**Math.min(attempt,9))*(0.8+Math.random()*0.4))
  this.host.store.atomic(()=>{
   this.host.store.db.prepare('UPDATE webhook_deliveries SET state=?,next_at=?,error=?,secret_env=? WHERE id=?').run(state,this.now()+Math.ceil(delay),code??null,this.outboundKey(this.grant(g.id)),d.id)
   this.host.store.db.prepare('UPDATE webhook_attempts SET finished_at=?,status=?,error=? WHERE delivery_id=? AND attempt=?').run(this.now(),status??null,code??null,d.id,attempt)
  })
 }
 goalControl(value:unknown){
  const x=z.object({id:z.string(),action:z.enum(['pause','resume','cancel']),expectedRevision:z.number().int().min(0),operationId:id}).strict().parse(value)
  const goal=this.host.goals.get(x.id),input=goal?this.host.store.get<AutomationInput>('webhook-input',goal.contract?.triggerId??goal.triggerId):undefined
  if(!goal||!input)throw new WebhookError(404,'unknown_automation_goal')
  const g=this.grant(input.grantId),trigger=this.host.store.triggers.get(g.triggerId)
  if(!trigger?.human)throw new WebhookError(403,'authorization_source_changed')
  const c=this.host.scopes.context(trigger,trigger.source+':'+trigger.threads[0]!.id)
  if(!c||!this.host.scopes.canManage(c))throw new WebhookError(403,'scope_manager_authorization_required')
  return this.host.goals.command(x,c)
 }
 detail(id:string){
  const g=this.grant(id),receipts=this.receipts(id),goalIds=new Set(receipts.flatMap(r=>r.goalId?[r.goalId]:[]))
  return {grant:g,receipts:receipts.slice(-200),goals:[...goalIds].map(id=>this.host.goals.get(id)),events:this.host.store.db.prepare("SELECT e.body FROM webhook_events e JOIN webhook_inbox i ON i.id=json_extract(e.body,'$.data.receiptId') WHERE i.grant_id=? ORDER BY e.rowid DESC LIMIT 200").all(id).map(r=>JSON.parse(String(r.body)))}
 }
 requireV2(fresh=false){
  const version=Number(this.host.store.db.prepare('PRAGMA user_version').get()!.user_version)
  if(version>=9)return
  if(!fresh||this.host.store.list('webhook-grant').length)throw new WebhookError(409,'webhook_protocol_upgrade_required')
  this.host.store.db.exec('PRAGMA user_version=9')
  this.host.store.put('webhook-protocol','current',{version:2,activatedAt:this.now(),fresh:true})
 }
 replay(value:unknown){
  this.requireV2()
  const x=z.object({receiptId:z.string(),operationId:id}).strict().parse(value)
  return this.host.store.atomic(()=>{
   const key='replay_'+x.operationId,old=this.host.store.get<any>('webhook-command',key)
   if(old){if(old.fingerprint!==stableDigest(x))throw new WebhookError(409,'operation_id_conflict');return old.result}
   const r=this.receipt(x.receiptId);if(!r)throw new WebhookError(404,'unknown_receipt')
   this.approved(this.grant(r.grantId))
   if(r.goalId||r.waitId||r.state!=='held'||!['dispatch_failed'].includes(r.error??''))throw new WebhookError(409,'receipt_not_replayable')
   r.state='received';delete r.error;this.saveReceipt(r)
   const result=this.publicReceipt(r);this.host.store.put('webhook-command',key,{fingerprint:stableDigest(x),result});this.host.store.audit({type:'webhook.replay',...x});return result
  })
 }
 reconcile(force=false){
  if(!this.host.store.list('webhook-grant').length)return
  this.continuations.advance()
  if(!force&&this.reconcileAt>this.now())return
  this.reconcileAt=this.now()+60000
  let repaired=0
  // Outbox absence can only be compensated from a retained domain event, never
  // from a Worker claim. Retained IDs and event bytes remain unchanged.
  this.host.store.atomic(()=>{
   for(const row of this.host.store.db.prepare(`SELECT e.* FROM webhook_events e JOIN webhook_inbox i ON i.id=json_extract(e.body,'$.data.receiptId') JOIN records g ON g.kind='webhook-grant' AND g.id=i.grant_id WHERE json_extract(e.body,'$.type') IN (SELECT value FROM json_each(g.body,'$.callback.events')) AND NOT EXISTS(SELECT 1 FROM webhook_deliveries d WHERE d.event_id=e.id) ORDER BY e.rowid LIMIT 200`).all()){
    const event=JSON.parse(String(row.body)),receipt=this.receipt(event.data.receiptId);if(!receipt)continue
    const g=this.grant(receipt.grantId);if(!g.callback.events.includes(event.type))continue
    try{this.approved(g)}catch{continue}
    const id='dlv_'+stableDigest([event.id,g.id]),last=this.host.store.db.prepare('SELECT * FROM webhook_attempts WHERE delivery_id=? ORDER BY attempt DESC LIMIT 1').get(id),state=last&&Number(last.status)>=200&&Number(last.status)<300?'sent':last&&([401,403].includes(Number(last.status))||['credential_unavailable','authorization_unavailable','delivery_paused'].includes(String(last.error)))?'held':last&&(Number(last.attempt)>=(this.host.store.get<{untilAttempt:number}>('webhook-retry-allowance',id)?.untilAttempt??g.callback.maxAttempts)||Number(last.status)>=300&&Number(last.status)<500&&![408,429].includes(Number(last.status)))?'dead':'pending'
    this.host.store.db.prepare("INSERT OR IGNORE INTO webhook_deliveries(id,event_id,grant_id,goal_id,state,body,payload_hash,target,secret_env,created_at,attempts,error) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)").run(id,event.id,g.id,String(row.goal_id),state,String(row.body),stableDigest(String(row.body)),g.callback.url,this.outboundKey(g),this.now(),Number(last?.attempt??0),last?'reconciled_from_attempt_ledger':null);repaired++
   }
   this.host.store.put('webhook-reconciliation','latest',{at:this.now(),repaired,waiting:this.continuations.list().filter(w=>w.state==='waiting').length})
  })
 }
 private outboundKey(g:WebhookGrant){return this.host.store.get<any>('webhook-keys',g.id)?.outbound??g.callback.secretEnv}
 private inboundKeys(g:WebhookGrant):string[]{const keys=this.host.store.get<any>('webhook-keys',g.id);return keys?[keys.inbound,...(keys.previous&&keys.overlapUntil>this.now()?[keys.previous]:[])]:g.secretEnvs}
 rotate(value:unknown){
  this.requireV2()
  const x=z.object({id:z.string(),operationId:id,expectedRevision:z.number().int().min(0),inbound:env,outbound:env,overlapSeconds:z.number().int().min(0).max(86400).default(3600)}).strict().parse(value)
  return this.host.store.atomic(()=>{
   const key='rotate_'+x.operationId,old=this.host.store.get<any>('webhook-command',key)
   if(old){if(old.fingerprint!==stableDigest(x))throw new WebhookError(409,'operation_id_conflict');return old.result}
   const g=this.grant(x.id);this.approved(g)
   const previous=this.host.store.get<any>('webhook-keys',g.id),revision=previous?.revision??0
   if(x.expectedRevision!==revision)throw new WebhookError(409,'key_revision_conflict')
   const inbound=secretFromEnv(x.inbound),outbound=secretFromEnv(x.outbound),accepted=this.inboundKeys(g),current=accepted[0]!
   if(inbound.equals(outbound)||accepted.some(name=>secretFromEnv(name).equals(outbound))||inbound.equals(secretFromEnv(this.outboundKey(g))))throw new WebhookError(400,'separate_direction_credentials_required')
   if(previous?.previous&&previous.overlapUntil>this.now()&&x.inbound!==current)throw new WebhookError(409,'key_rotation_overlap_active')
   // Import both initially accepted keys into the first bounded overlap. A third
   // input key would silently discard one, so first select either existing key.
   if(!previous&&accepted.length>1&&!accepted.includes(x.inbound))throw new WebhookError(409,'key_rotation_overlap_active')
   const retained=x.inbound===current?previous?.previous??accepted.find(name=>name!==x.inbound):current
   const overlapUntil=previous&&x.inbound===current?previous.overlapUntil??0:retained?this.now()+x.overlapSeconds*1000:0
   const result={revision:revision+1,inbound:x.inbound,outbound:x.outbound,previous:retained,overlapUntil}
   this.host.store.put('webhook-keys',g.id,result)
   // Already accepted bodies/targets/IDs are immutable; only retry signing changes.
   this.host.store.db.prepare("UPDATE webhook_deliveries SET secret_env=? WHERE grant_id=? AND state IN ('pending','held','dead')").run(x.outbound,g.id)
   this.host.store.put('webhook-command',key,{fingerprint:stableDigest(x),result});this.host.store.audit({type:'webhook.keys_rotated',id:g.id,revision:result.revision});return result
  })
 }
 dryRun(value:unknown){
  const x=z.object({id:z.string(),event:cloudEventSchema}).strict().parse(value),g=this.grant(x.id)
  this.approved(g);this.validateEvent(g,x.event)
  return {valid:true,effects:'none',mode:g.continuations?.some(r=>r.eventType===x.event.type)?'continuation':'start',template:g.template.title,contractHash:stableDigest(g.template)}
 }
 private validateEvent(g:WebhookGrant,event:CloudEvent){
  if(event.source!==g.eventSource||!g.eventTypes.includes(event.type)&&!g.continuations?.some(r=>r.eventType===event.type)||g.subjects&&!g.subjects.includes(event.subject??''))throw new WebhookError(403,'event_outside_grant')
  if(stableDigest(Object.keys(event.data).sort())!==stableDigest(Object.keys(g.parameters).sort()))throw new WebhookError(400,'event_parameters_mismatch')
  for(const [name,p] of Object.entries(g.parameters)){
   const v=event.data[name]
   if(p.type==='string'?(typeof v!=='string'||v.length>p.maxLength||p.values&&!p.values.includes(v)):p.type==='number'?(typeof v!=='number'||!Number.isFinite(v)||v<p.min||v>p.max):typeof v!=='boolean')throw new WebhookError(400,'invalid_event_parameter')
  }
}
 async close(){this.closing=true;for(const s of this.sends.values())s.controller.abort(Error('Host closing'));await Promise.allSettled([...this.sends.values()].map(s=>s.promise))}
}
