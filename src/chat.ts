import {isApiBackend} from './backend-config.ts'
import {createHash, randomUUID} from 'node:crypto'
import type {Runtime} from './runtime.ts'
import type {AgentOptions} from './backend-config.ts'
import {agentOptionsSchema} from './backend-config.ts'
import {BackendRegistry} from './backends/registry.ts'
import {mergeOptions} from './agent-options.ts'
import {workerProfiles} from './worker-pool.ts'
import type {Run} from './store.ts'
import type {ModelOutput} from './model.ts'
import type {ExecutionCall} from './execution-activity.ts'
import {partialReply} from './partial-reply.ts'

export class ChatError extends Error {
  constructor(readonly code:string, message:string, readonly status=409){super(message)}
}
interface Conversation {
  id:string; owner:string; title:string; createdAt:number; updatedAt:number; archived:boolean
  sourceId:string; actor:string; discussion:string; sequence:number
  backendId?:string; backendFingerprint?:string; model?:string; options:AgentOptions
}
interface Message {id:string; conversationId:string; runId:string; sequence:number; role:'user'|'assistant'; text:string; createdAt:number;clientMessageId?:string;status?:'streaming'|'complete'|'interrupted'|'failed'}
interface ChatRun {id:string; conversationId:string; triggerId:string; clientMessageId:string; createdAt:number; cancelRequested?:boolean; cancelled?:boolean}
interface Delegation {ticketId:string; workerId:string; discussion:string; parentTrigger?:string}
type ChatCall=ExecutionCall&{conversationId:string;runId:string}
export type ChatRunState='queued'|'running'|'waiting'|'completed'|'failed'|'cancel_requested'|'cancelled'
/** Narrow operation metadata, never arbitrary tool arguments, prompts or results. */
export function chatToolDetails(name:string,args:unknown):Pick<ExecutionCall,'action'|'target'>{
  if(name!=='worker_manage'||!args||typeof args!=='object')return {}
  const value=args as Record<string,unknown>
  return {...(typeof value.action==='string'&&['list','inspect','create','clone','configure','set_prompt','assign','send','pause','resume','cancel','retire','destroy','result','migrate'].includes(value.action)?{action:value.action}:{}),...(typeof value.id==='string'&&/^[a-z][a-z0-9_-]{0,63}$/.test(value.id)?{target:value.id}:{})}
}

/** Browser conversations are a projection of the existing Router, never a second executor. */
export class ChatSessions {
  private listeners=new Map<string,Set<()=>void>>()
  private notifications=new Set<string>()
  private streams=new Map<string,{runId:string;outputId:string;raw:string;authorize?:()=>void;timer?:ReturnType<typeof setTimeout>}>()
  private unsubscribe:()=>void
  constructor(private host:Runtime){
    host.store.db.exec("CREATE INDEX IF NOT EXISTS chat_message_page ON records(json_extract(body,'$.conversationId'),json_extract(body,'$.sequence')) WHERE kind='chat-message'")
    host.store.db.exec("CREATE INDEX IF NOT EXISTS chat_call_conversation ON records(json_extract(body,'$.conversationId'),json_extract(body,'$.startedAt')) WHERE kind='chat-call'")
    for(const row of host.store.db.prepare("SELECT body FROM records WHERE kind='chat-message' AND json_extract(body,'$.status')='streaming'").all()){const m=JSON.parse(String(row.body));host.store.put('chat-message',m.id,{...m,status:'interrupted'})}
    for(const row of host.store.db.prepare("SELECT body FROM records WHERE kind='chat-call' AND json_extract(body,'$.state')='running'").all()){const call=JSON.parse(String(row.body));host.store.put('chat-call',call.id,{...call,state:'interrupted',endedAt:Date.now()})}
    this.unsubscribe=host.activity.subscribe(call=>this.recordCall(call))
    // Older Router traces carry an exact chat trigger. Never infer old Worker lineage from a reassigned ticket.
    for(const call of host.activity.list())if(!host.store.get('chat-call',call.id)&&call.triggerId&&host.store.get('chat-run',call.triggerId))this.recordCall(call)
  }
  subscribe(id:string,owner:string,listener:()=>void){this.get(id,owner);const set=this.listeners.get(id)??new Set();set.add(listener);this.listeners.set(id,set);return()=>{set.delete(listener);if(!set.size)this.listeners.delete(id)}}
  private changed(id:string){if(this.notifications.has(id))return;this.notifications.add(id);queueMicrotask(()=>{this.notifications.delete(id);for(const listener of this.listeners.get(id)??[])listener()})}
  private recordCall(call:ExecutionCall){
    const assignment=call.ticketId?this.host.store.get<Delegation>('worker-assignment',call.ticketId):undefined
    const triggerId=assignment?.parentTrigger??call.triggerId,run=triggerId?this.host.store.get<ChatRun>('chat-run',triggerId):undefined
    if(!run)return
    const previous=this.host.store.get<{conversationId:string;runId:string}>('chat-call',call.id)
    const saved={...call,conversationId:previous?.conversationId??run.conversationId,runId:previous?.runId??run.id}
    this.host.store.put('chat-call',call.id,saved);this.changed(saved.conversationId)
  }
  output(jobId:string,runId:string,event:ModelOutput,authorize?:()=>void){
    if(event.phase!=='answer')return
    const run=this.host.store.get<ChatRun>('chat-run',runId);if(!run||run.cancelRequested)return
    let stream=this.streams.get(jobId)
    if(!stream||event.type==='start'||stream.outputId!==event.id){
      if(stream?.timer)clearTimeout(stream.timer)
      stream={runId,outputId:event.id,raw:'',authorize};this.streams.set(jobId,stream)
      const old=this.host.store.get<Message>('chat-message','reply:'+jobId)
      if(old?.status==='streaming'){this.host.store.put('chat-message',old.id,{...old,text:''});this.changed(run.conversationId)}
    }
    stream.authorize=authorize
    if(event.type==='end')stream.raw=event.text??stream.raw
    else if(event.type==='delta')stream.raw+=event.text??''
    // Bound only the in-flight projection; the validated final reply is not truncated.
    if(stream.raw.length>1000000){stream.raw='';return}
    if(!stream.timer){stream.timer=setTimeout(()=>{stream!.timer=undefined;this.flushOutput(jobId)},75);stream.timer.unref()}
  }
  private flushOutput(jobId:string){
    const stream=this.streams.get(jobId);if(!stream)return
    const run=this.host.store.get<ChatRun>('chat-run',stream.runId);if(!run||run.cancelRequested)return
    const c=this.host.store.get<Conversation>('chat-conversation',run.conversationId)!
    // Authorization can change during the short projection buffer, before its timer fires.
    try{this.host.routerIngress.authority(run.triggerId,c.discussion);stream.authorize?.()}catch{
      stream.raw=''
      const old=this.host.store.get<Message>('chat-message','reply:'+jobId)
      if(old?.status==='streaming'){this.host.store.put('chat-message',old.id,{...old,text:'',status:'interrupted'});this.changed(c.id)}
      return
    }
    const text=partialReply(stream.raw);if(text===undefined||!text)return
    this.host.store.atomic(()=>this.message(c,{id:'reply:'+jobId,runId:run.id,role:'assistant',text,status:'streaming'}))
    this.changed(c.id)
  }
  endOutput(jobId:string,state:'interrupted'|'failed'='interrupted'){
    this.flushOutput(jobId)
    const stream=this.streams.get(jobId);if(stream?.timer)clearTimeout(stream.timer);this.streams.delete(jobId)
    const m=this.host.store.get<Message>('chat-message','reply:'+jobId)
    if(m?.status==='streaming'){this.host.store.put('chat-message',m.id,{...m,status:state});this.changed(m.conversationId)}
  }
  close(){for(const id of this.streams.keys())this.endOutput(id);this.unsubscribe();this.listeners.clear()}
  private rows<T>(kind:string, field:string, value:string):T[]{
    // field is an internal constant, never a request parameter.
    return this.host.store.db.prepare("SELECT body FROM records WHERE kind=? AND json_extract(body,?)=? ORDER BY rowid").all(kind,'$.'+field,value).map(r=>JSON.parse(String(r.body)))
  }
  private get(id:string,owner:string){
    const c=this.host.store.get<Conversation>('chat-conversation',id)
    if(!c||c.owner!==owner)throw new ChatError('conversation_missing','Conversation not found.',404)
    return c
  }
  private source(){
    const h=this.host, selected=h.model instanceof BackendRegistry?h.model.definition(h.model.selected('router')):undefined
    const principal=selected&&isApiBackend(selected)?selected.subscription?.owner:undefined
    const source=h.config.sources.find(s=>s.kind==='local'&&s.enabled&&s.allowedActors.length>0&&(!principal||s.id===principal.source&&s.allowedActors.includes(principal.actor)))
    return source?{source,actor:principal?.actor??source.allowedActors[0]!}:undefined
  }
  readiness(){
    const h=this.host
    let code='ready', backend:string|undefined, model:string|undefined
    try{
      const desc=h.model.describe?.(undefined,'router');backend=desc?.id;model=h.config.execution.router?.model??h.config.models.router??desc?.model
      if(h.model instanceof BackendRegistry){
        const d=h.model.definition(h.model.selected('router'))
        if(isApiBackend(d)&&d.apiKeyEnv&&!process.env[d.apiKeyEnv])code='model_credentials_missing'
        if(isApiBackend(d)&&d.subscription&&!h.subscriptions.list().some(a=>a.id===d.subscription!.account&&a.signedIn))code='model_credentials_missing'
      }
    }catch{code='model_unavailable'}
    if(h.config.execution.router?.mode!=='host')code='host_router_required'
    else if(!this.source())code='local_source_required'
    else if(h.store.get<boolean>('settings','paused'))code='host_paused'
    return {workers:workerProfiles(h.config).map(w=>({id:w.id,label:w.label??w.id,model:w.model,state:w.state??'enabled',tasks:[] as {id:string;workerId:string;title:string;state:string;question:string|undefined;summary:string|undefined}[]})),ready:code==='ready',code,backend,model,mode:h.config.execution.router?.mode??'assessment',configurationUrl:'/configure#execution/configuration'}
  }
  private publicConversation(c:Conversation){return {id:c.id,title:c.title,createdAt:c.createdAt,updatedAt:c.updatedAt,archived:c.archived,backend:c.backendId,model:c.model}}
  private fingerprint(id?:string){
    if(!id||!(this.host.model instanceof BackendRegistry))return
    const {label,...definition}=this.host.model.definition(id)
    return createHash('sha256').update(JSON.stringify(definition)).digest('hex')
  }
  list(owner:string,archived=false){return this.rows<Conversation>('chat-conversation','owner',owner).filter(c=>c.archived===archived).sort((a,b)=>b.updatedAt-a.updatedAt).map(c=>this.publicConversation(c))}
  create(owner:string){
    const ready=this.readiness();if(!ready.ready)throw new ChatError(ready.code,'Configure an available host Router before starting a conversation.')
    const {source,actor}=this.source()!,id=randomUUID(),at=Date.now()
    const router=this.host.config.execution.router??{}
    const definition=this.host.model instanceof BackendRegistry?this.host.model.definition(ready.backend!):undefined
    const options=mergeOptions(definition?.defaults,agentOptionsSchema.parse(Object.fromEntries(Object.entries(router).filter(([k])=>k in agentOptionsSchema.shape))))
    if(definition?.kind==='codex'&&options.effort===undefined)options.effort=this.host.config.effort
    const c:Conversation={id,owner,title:'',createdAt:at,updatedAt:at,archived:false,sourceId:source.id,actor,discussion:source.id+':chat:'+id,sequence:0,backendId:ready.backend,backendFingerprint:this.fingerprint(ready.backend),model:ready.model,options}
    this.host.store.put('chat-conversation',id,c)
    return this.publicConversation(c)
  }
  update(id:string,owner:string,patch:{title?:string;archived?:boolean}){
    const c=this.get(id,owner),next={...c,...patch,updatedAt:Date.now()}
    this.host.store.put('chat-conversation',id,next);return this.publicConversation(next)
  }
  private message(c:Conversation, m:Omit<Message,'conversationId'|'sequence'|'createdAt'>){
    const existing=this.host.store.get<Message>('chat-message',m.id)
    if(existing){if(existing.role==='assistant'&&existing.status!=='complete'&&(existing.text!==m.text||existing.status!==m.status))this.host.store.put('chat-message',m.id,{...existing,...m});return}
    const latest=this.host.store.get<Conversation>('chat-conversation',c.id)!
    const sequence=latest.sequence+1,at=Date.now()
    this.host.store.put('chat-message',m.id,{...m,conversationId:c.id,sequence,createdAt:at})
    this.host.store.put('chat-conversation',c.id,{...latest,sequence,updatedAt:at,...(!latest.title&&m.role==='user'?{title:m.text.replace(/\s+/g,' ').slice(0,70)}:{})})
  }
  binding(triggerId:string){
    const run=this.host.store.get<ChatRun>('chat-run',triggerId)
    if(!run)return
    const c=this.host.store.get<Conversation>('chat-conversation',run.conversationId)!
    return {backendId:c.backendId,model:c.model,options:c.options}
  }
  reply(jobId:string,triggerId:string,text:string){
    const stream=this.streams.get(jobId);if(stream?.timer)clearTimeout(stream.timer);this.streams.delete(jobId)
    const run=this.host.store.get<ChatRun>('chat-run',triggerId)
    if(!run||run.cancelRequested||!text.trim())return
    const c=this.host.store.get<Conversation>('chat-conversation',run.conversationId)!
    this.message(c,{id:'reply:'+jobId,runId:run.id,role:'assistant',text,status:'complete'})
    this.changed(c.id)
  }
  send(id:string,owner:string,input:{clientMessageId:string;text:string}){
    return this.host.store.atomic(()=>{
      const c=this.get(id,owner),text=input.text.trim()
      const previous=this.rows<ChatRun>('chat-run','conversationId',id).find(r=>r.clientMessageId===input.clientMessageId)
      if(previous){
        if(this.host.store.get<Message>('chat-message','user:'+previous.id)?.text!==text)throw new ChatError('message_conflict','Message identity was reused with different text.')
        return {runId:previous.id,duplicate:true}
      }
      if(c.archived)throw new ChatError('conversation_archived','Restore this conversation before sending.')
      const ready=this.readiness();if(!ready.ready)throw new ChatError(ready.code,'The Router is not ready to receive a message.')
      try{if(c.backendFingerprint&&this.fingerprint(c.backendId)!==c.backendFingerprint)throw Error()}catch{throw new ChatError('backend_changed','This backend changed. Start a new conversation to use its new configuration.')}
      const active=this.view(id,owner).run
      if(active&&['queued','running','cancel_requested'].includes(active.state))throw new ChatError('conversation_busy','Wait for the current run or stop it first.')
      const source=this.host.sources.get(c.sourceId)?.config
      if(!source?.enabled||source.kind!=='local'||!source.allowedActors.includes(c.actor))throw new ChatError('source_unavailable','This conversation source is no longer available.')
      const eventId='chat:'+id+':'+input.clientMessageId
      const received=this.host.receive(c.sourceId,c.actor,{id:eventId,thread:'chat:'+id,text,addressed:true}) as {triggerId:string}
      const admitted=this.host.routerIngress.get(received.triggerId)
      if(admitted?.state!=='accepted')throw new ChatError('request_not_admitted','This request was not admitted by the current Router policy.')
      const run:ChatRun={id:received.triggerId,triggerId:received.triggerId,conversationId:id,clientMessageId:input.clientMessageId,createdAt:Date.now()}
      this.host.store.put('chat-run',run.id,run)
      this.message(c,{id:'user:'+run.id,runId:run.id,role:'user',text,clientMessageId:input.clientMessageId})
      return {runId:run.id,duplicate:false}
    })
  }
  private tasks(c:Conversation,run?:ChatRun){
    return this.rows<Delegation>('worker-assignment','discussion',c.discussion).filter(d=>!run||d.parentTrigger===run.triggerId).map(d=>{
      const t=this.host.store.tickets.get(d.ticketId),r=this.host.store.get<Run>('run',d.ticketId),report=t?.assignments.at(-1)?.report
      const state=t?.ended?.by==='human'?'cancelled':t?.ended?'completed':['starting','running','background','delivering','merging'].includes(r?.phase??'')?'running':r?.phase==='uncertain'||r?.phase==='human'||t?.attention||['blocked','failed','waiting'].includes(report?.state??'')?'waiting':report?.state==='ready'?'completed':'queued'
      return {id:d.ticketId,workerId:d.workerId,title:t?.title??'',state,question:t?.attention?.question??undefined,summary:report?.summary??undefined}
    })
  }
  async files(id:string,owner:string,input:{ticket?:string;path?:string;kind?:'directory'|'files';offset?:number;cursor?:string}={}){
    const c=this.get(id,owner),tasks=this.tasks(c).filter(t=>this.host.store.get<Run>('run',t.id))
    if(!input.ticket)return {tasks}
    if(!tasks.some(t=>t.id===input.ticket))throw new ChatError('file_task_missing','Task is not part of this conversation.',404)
    try{
      const result=await this.host.resources.read({resource:(input.kind??'directory')+'/'+(input.path??''),offset:input.offset??0,limit:8000,pageSize:50,...(input.cursor?{cursor:input.cursor}:{})},{ticketId:input.ticket})
      return {tasks,result}
    }catch{throw new ChatError('file_unavailable','This file is unavailable or cannot be previewed.',404)}
  }
  view(id:string,owner:string,before?:number){
    const c=this.get(id,owner),runs=this.rows<ChatRun>('chat-run','conversationId',id),last=runs.at(-1)
    const tasks=this.tasks(c,last)
    const jobs=last?this.host.store.db.prepare("SELECT state FROM jobs WHERE kind='router' AND json_extract(payload,'$.triggerId')=?").all(last.triggerId):[]
    const messages=this.host.store.db.prepare("SELECT body FROM records WHERE kind='chat-message' AND json_extract(body,'$.conversationId')=? AND json_extract(body,'$.sequence')<? ORDER BY json_extract(body,'$.sequence') DESC LIMIT 101").all(id,before??Number.MAX_SAFE_INTEGER).map(r=>JSON.parse(String(r.body)) as Message).reverse()
    let state:ChatRunState='queued'
    if(last){
      if(last.cancelled)state='cancelled'
      else if(last.cancelRequested)state='cancel_requested'
      else if(jobs.some(j=>j.state==='running'))state='running'
      else if(jobs.some(j=>j.state==='pending'))state='queued'
      else if(jobs.some(j=>j.state==='failed'))state='failed'
      else if(tasks.some(t=>t.state==='running'||t.state==='queued'))state='running'
      else if(tasks.some(t=>t.state==='waiting'))state='waiting'
      else if(jobs.length&&jobs.every(j=>j.state==='done'))state='completed'
    }
    const workers=workerProfiles(this.host.config).map(w=>({id:w.id,label:w.label??w.id,model:w.model,state:w.state??'enabled',tasks:tasks.filter(t=>t.workerId===w.id)}))
    for(const workerId of new Set(tasks.map(t=>t.workerId)))if(!workers.some(w=>w.id===workerId))workers.push({id:workerId,label:workerId,model:undefined,state:'retiring',tasks:tasks.filter(t=>t.workerId===workerId)})
    const calls=this.host.store.db.prepare("SELECT body FROM records WHERE kind='chat-call' AND json_extract(body,'$.conversationId')=? ORDER BY json_extract(body,'$.startedAt') DESC,rowid DESC LIMIT 200").all(id).map(r=>JSON.parse(String(r.body)) as ChatCall).reverse()
    const result={conversation:this.publicConversation(c),messages:messages.slice(-100),hasMore:messages.length>100,run:last?{id:last.id,state,createdAt:last.createdAt}:null,workers,calls,readiness:this.readiness()}
    return result
  }
  /** A durable revision plus a fresh full projection recovers SSE gaps without replaying execution. */
  revision(id:string,owner:string){
    const state=this.view(id,owner),hash=createHash('sha256').update(JSON.stringify(state)).digest('hex')
    const previous=this.host.store.get<{hash:string;revision:number}>('chat-revision',id)
    if(previous?.hash===hash)return previous.revision
    const revision=(previous?.revision??0)+1
    this.host.store.put('chat-revision',id,{hash,revision});return revision
  }
  async cancel(id:string,owner:string,runId:string){
    this.get(id,owner)
    const run=this.host.store.get<ChatRun>('chat-run',runId)
    if(!run||run.conversationId!==id)throw new ChatError('run_missing','Run not found.',404)
    if(run.cancelled)return {cancelled:true}
    // Preflight before recording cancellation: a submitted merge cannot be undone.
    const c=this.get(id,owner)
    if(this.tasks(c,run).some(t=>this.host.store.get<Run>('run',t.id)?.phase==='merging'))throw new ChatError('merge_in_progress','Reconcile the submitted merge before stopping.')
    this.host.store.put('chat-run',runId,{...run,cancelRequested:true})
    await this.host.cancelRouter(run.triggerId,c.discussion)
    this.host.store.put('chat-run',runId,{...run,cancelRequested:true,cancelled:true})
    return {cancelled:true}
  }
}
