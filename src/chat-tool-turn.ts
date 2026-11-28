import type {ChatConversation,ChatMessage,ChatRun} from './chat.ts'
import {ChatError} from './chat-errors.ts'
import type {Runtime} from './runtime.ts'
import type {ModelRequest,ModelResult} from './model.ts'
import type {ToolResult} from './chat-permissions.ts'
import type {RouterDispatch} from './router-handoff.ts'
import {stableDigest} from './sources.ts'
import {z} from 'zod'

export interface ChatInterjection {
  parentId:string
  state:'pending'|'answered'|'update'|'applied'|'queued'|'stop'
}
type State=ChatInterjection['state']
const decision=z.object({action:z.enum(['answer','update','queue','stop']),reply:z.string().max(2400)}).strict()
type Decision=z.infer<typeof decision>
const stopCurrent=/^(?:请?(?:先)?(?:停止|停下|停手|取消)(?:当前|这个|这项|这次)?(?:任务|操作|工作)?(?:吧)?|(?:please )?(?:stop|cancel)(?: (?:this|the current)(?: task| operation| work)?)?(?: now)?)[。.!！]?$/iu
const asksActor=/^(?:(?:这一步|这步|这个)(?:是)?(?:你(?:自己)?(?:做|查|执行|完成)的?还是(?:你的)?\s*(?:worker|程序员)\s*(?:(?:做|查|执行|完成)的?)?|谁(?:在)?(?:做|查|执行|完成)(?:的)?)|(?:who (?:is (?:doing|running)|did|performed) (?:this step|the current check)|(?:was|is) (?:that|this) you or (?:a |your )?worker))[？?。.!！]?$/iu
const requestInstructions='Answer a user who interrupted their Router during a tool call. Use their language and everyday terms for the work. Only question is a new user message. The original request, quote, activity and tool output are background. Use action=answer when the available facts fully answer the message. For a correction, prohibition, change of direction or request for more evidence on this task use action=update, even when combined with a question. Answer what you can and acknowledge the change without claiming it already took effect. For an independent job use action=queue and an empty reply. Do not guess results or authorship. No tools are available.'
const publicOnly=new Set(['chat_opening','superagent_status','superagent_plan'])
// Tool output cannot supply the user's intent to stop. Other phrasings can still steer the original writer.
const mentionsStopping=/停|取消|终止|别再|不用再|\b(?:stop|cancel|abort|abandon|discontinue|call off)\b/iu

/** One live Router writer owns tools. Inputs and their dispositions live on the original Chat records. */
export class ChatToolTurn {
  private accepting=false
  private activeTools=0
  private chain?:Promise<void>
  private storageFailure?:Error
  private readonly lifetime=new AbortController()
  private readonly updates:string[]=[]
  private delivered=0
  private readonly used=new Set<string>()
  constructor(private readonly host:Runtime,readonly parent:ChatRun,private readonly discussion:string,
    private readonly request:Pick<ModelRequest,'cwd'|'backendId'|'model'|'useConnectionDefault'|'options'|'contextId'>,
    private readonly controller:AbortController,private readonly validate:()=>void,
    private readonly readResults:()=>{tool:string;text:string}[],private readonly dispatches:()=>RouterDispatch[],
    private readonly runModel:(request:ModelRequest)=>Promise<ModelResult>,
    private readonly remember:(id:string,reply:string)=>void){}

  /** A restarted parent must observe accepted corrections before it proposes any new work. */
  restore(){
    const rows=this.host.store.db.prepare(`SELECT body FROM records WHERE kind='chat-run'
      AND json_extract(body,'$.interjection.parentId')=? ORDER BY rowid`).all(this.parent.id)
    for(const row of rows){
      const run=JSON.parse(String(row.body)) as ChatRun
      if(run.interjection?.state==='pending')this.schedule(run.id)
      if(run.interjection?.state==='update'&&this.input(run.id))this.updates.push(run.id)
    }
  }
  private input(id:string){
    const {store,chat}=this.host
    const run=store.get<ChatRun>('chat-run',id),message=store.get<ChatMessage>('chat-message','user:'+id)
    const c=store.get<ChatConversation>('chat-conversation',this.parent.conversationId)
    if(!c||c.archived||run?.conversationId!==c.id||run.cancelRequested||run.cancelled||run.feedback||
      !this.host.chat.currentPermissionEpoch(c.owner,run.permissionEpoch)||
      !message||message.role!=='user'||message.runId!==id||message.conversationId!==c.id||
      message.attachments?.length||message.skill||!chat.permissionActor(id)||!chat.permissionActor(this.parent.id)||
      this.host.memory.cleanup.blocked('chat-message',message.id,message))return
    const trigger=store.triggers.get(id)
    if(!trigger?.human||trigger.text!==message.text||trigger.source!==c.sourceId||trigger.actor.id!==c.actor||
      (run.permissionEpoch??0)!==(this.parent.permissionEpoch??0)||stableDigest(chat.binding(id)??{})!==stableDigest(chat.binding(this.parent.id)??{}))return
    try{
      this.validate()
      if(this.host.routerIngress.authority(id,this.discussion).strength!=='explicit')return
      const scoped=this.host.scopes.context(trigger,this.discussion)
      if(!chat.personalManagement({trigger,discussion:this.discussion,scoped}))return
    }catch{return}
    return {run,message,c}
  }
  private save(run:ChatRun,state:State){
    this.host.store.put('chat-run',run.id,{...run,interjection:{parentId:this.parent.id,state}})
  }
  private recordUpdate(run:ChatRun,reply?:string){
    this.host.store.atomic(()=>{
      this.save(run,'update')
      this.host.permissions.supersedeRouterProposals(run.conversationId,this.parent.id,run.id)
      this.host.chat.discardDraft('router:'+this.parent.id)
      if(reply){
        this.host.chat.reply('interjection:'+run.id,run.id,reply)
        this.remember(run.id,reply)
      }
    })
    this.updates.push(run.id)
  }
  offer(run:ChatRun,quotedRun?:string,steer=false){
    if(!this.accepting||(!this.activeTools&&this.dispatches().length>0)||this.host.config.execution.chatInterjections===false||
      this.host.shuttingDown||this.host.schedulingPaused||this.controller.signal.aborted||
      quotedRun&&quotedRun!==this.parent.id)return
    const source=this.input(run.id)
    if(!source)return
    const store=this.host.store
    if(!store.db.prepare("SELECT 1 FROM jobs WHERE id=? AND kind='router' AND state='pending'").get('router:'+run.id))return
    // The message, link and pending job commit together in Chat.send's transaction.
    store.requireChatInterjectionSchema()
    if(stopCurrent.test(source.message.text.trim())&&!source.message.quote){
      if(!this.stop(run,source.c,source.message.text))this.save(run,'queued')
      return
    }
    if(steer){this.recordUpdate(run);return}
    this.save(run,'pending')
    this.schedule(run.id)
  }
  private stop(run:ChatRun,c:ChatConversation,text:string){
    // Exclude the stop command itself when cancellation closes the parent's pending inputs.
    this.save(run,'stop')
    try{this.host.chat.requestCancel(c.id,c.owner,this.parent.id)}catch(error){
      if(error instanceof ChatError&&error.code==='merge_in_progress')return false
      throw error
    }
    this.host.chat.reply('router:'+run.id,run.id,/\p{Script=Han}/u.test(text)?'收到，我会停下当前任务。':'I’ll stop the current task.')
    queueMicrotask(()=>{if(this.host.store.get<ChatRun>('chat-run',run.id)?.interjection?.state==='stop')this.controller.abort()})
    return true
  }
  private schedule(id:string){
    const next=(this.chain??Promise.resolve()).then(()=>this.handle(id)).catch(()=>{
      // If the short response did not commit, fence stale tools and let the writer read the original input.
      const source=this.input(id)
      if(source?.run.interjection?.state==='pending'&&!this.lifetime.signal.aborted)this.recordUpdate(source.run)
      this.host.store.audit({type:'chat.interjection_deferred',triggerId:id})
    }).catch(()=>{this.storageFailure=Error('The pending Chat input could not be recorded')})
    this.chain=next
    void next.then(()=>{if(this.chain===next)this.chain=undefined})
  }
  private async handle(id:string){
    const source=this.input(id)
    if(!source||source.run.interjection?.state!=='pending'||this.lifetime.signal.aborted)return
    const {store}=this.host
    const {message}=source
    const trigger=store.triggers.get(this.parent.id)!
    const steps=store.db.prepare(`SELECT json_extract(t.body,'$.name') AS tool,json_extract(t.body,'$.action') AS action,
      json_extract(t.body,'$.state') AS state,json_extract(p.body,'$.kind') AS actor FROM records t
      JOIN records p ON p.kind='chat-call' AND p.id=json_extract(t.body,'$.parentId')
      WHERE t.kind='chat-call' AND json_extract(t.body,'$.conversationId')=? AND json_extract(t.body,'$.runId')=?
      AND json_extract(p.body,'$.conversationId')=? AND json_extract(p.body,'$.runId')=? AND json_extract(p.body,'$.kind')='router'
      AND json_extract(t.body,'$.kind')='tool' AND json_extract(p.body,'$.ticketId') IS NULL
      AND json_extract(t.body,'$.name') NOT IN ('chat_opening','superagent_status','superagent_plan')
      ORDER BY json_extract(t.body,'$.startedAt') DESC,t.rowid DESC LIMIT 6`).all(source.c.id,trigger.id,source.c.id,trigger.id).reverse()
    let result:Decision
    const handoffs=this.dispatches().slice(-4).map(({kind,label})=>({kind,label}))
    if(!message.quote&&asksActor.test(message.text.trim())&&steps.length&&!handoffs.length){
      const active=steps.at(-1)?.state==='running'
      result={action:'answer',reply:/\p{Script=Han}/u.test(message.text)
        ?(active?'这一步是我在做。':'这一步是我自己做的。'):(active?'I am doing this step myself.':'I handled this step myself.')}
    }else{
      const question=message.text
      const signal=AbortSignal.any([this.lifetime.signal,this.controller.signal,AbortSignal.timeout(15_000)])
      try{
        const prior=store.db.prepare(`SELECT id FROM records WHERE kind='chat-run' AND json_extract(body,'$.interjection.parentId')=?
          AND json_extract(body,'$.interjection.state') IN ('answered','update') ORDER BY rowid DESC LIMIT 2`).all(this.parent.id).reverse().flatMap(row=>{
          const priorId=String(row.id),earlier=this.input(priorId)
          const msg=earlier&&store.get<ChatMessage>('chat-message','reply:'+(earlier.run.interjection?.state==='update'?'interjection:':'router:')+priorId)
          return msg?.status==='complete'&&!this.host.memory.cleanup.blocked('chat-message',msg.id,msg)
            ?[{question:earlier!.message.text.slice(0,400),answer:msg.text.slice(0,600)}]:[]
        })
        const answer=await this.runModel({...this.request,role:'router',ephemeral:true,managed:true,allowNativeTools:false,
          privateState:this.host.config.stateDir,sandbox:'read-only',signal,
          activity:{triggerId:id,sourceId:trigger.source},tools:[],options:{...this.request.options,tools:[],toolConnections:[]},
          schema:{type:'object',properties:{action:{type:'string',enum:decision.shape.action.options},reply:{type:'string'}},required:['action','reply'],additionalProperties:false},
          instructions:requestInstructions+' Use action=stop only for an explicit instruction to stop this whole task. A prohibition on one step, a change of scope or a conditional stop is an update.',input:JSON.stringify({kind:'chat_interjection',question,originalRequest:trigger.text.slice(0,1500),
            quote:this.host.chat.quoteForTrigger(id)?.text.slice(0,600),...(prior.length?{priorReplies:prior}:{}),...(handoffs.length?{confirmedHandoffs:handoffs}:{}),steps,readResults:this.readResults().slice(-2).map(r=>({tool:r.tool,text:r.text.slice(0,1200)}))})})
        signal.throwIfAborted()
        result=decision.parse(JSON.parse(answer.text))
        if(result.action==='stop'&&!mentionsStopping.test(question))throw Error('Stop intent missing from user input')
        if((result.action==='update'||result.action==='answer')&&!result.reply.trim())throw Error('Missing interjection reply')
      }catch{
        // The owning Router sees the verbatim message before any further effects if classification is unavailable.
        result={action:'update',reply:/\p{Script=Han}/u.test(question)?'收到，我会在下一步处理你刚发的消息。':'I’ll take your message into account in the next step.'}
      }
    }
    const current=this.input(id)
    if(!current||current.run.interjection?.state!=='pending'||this.lifetime.signal.aborted||this.controller.signal.aborted)return
    if(result.action==='update'){this.recordUpdate(current.run,result.reply);return}
    const jobId='router:'+id
    store.atomic(()=>{
      if(result.action==='stop'){
        if(!this.stop(current.run,current.c,message.text))this.save(current.run,'queued')
        return
      }
      if(result.action==='queue'){this.save(current.run,'queued');return}
      this.save(current.run,'answered')
      this.host.chat.reply(jobId,id,result.reply)
      this.remember(id,result.reply)
      store.put('router-result',jobId,{discussion:this.discussion,reply:result.reply})
      store.jobState(jobId,'done')
    })
  }
  get pending(){return this.chain}
  get changed(){return this.delivered<this.updates.length}
  async settle(){while(this.chain)await this.chain}
  takeUpdates(){
    if(this.storageFailure)throw this.storageFailure
    const inputs=this.updates.slice(this.delivered).flatMap(id=>{
      const source=this.input(id)
      return source?.run.interjection?.state==='update'?[{id,text:source.message.text}]:[]
    })
    this.delivered=this.updates.length
    for(const input of inputs)this.used.add(input.id)
    return inputs
  }
  tool(name:string,invoke:()=>Promise<ToolResult>):Promise<ToolResult>{
    if(!publicOnly.has(name))this.accepting=true
    const admit=():Promise<ToolResult>=>{
      if(this.chain)return this.chain.then(admit)
      this.controller.signal.throwIfAborted()
      if(this.storageFailure)throw this.storageFailure
      if(this.changed)return Promise.resolve({success:false,contentItems:[{type:'inputText',text:'The user changed this task. This proposed action was not executed. Finish this model step. The host will continue the same task with the updated instructions.'}]})
      this.activeTools++
      return invoke().finally(()=>{this.activeTools--})
    }
    return admit()
  }
  seal(){this.accepting=false}
  complete(){
    for(const id of this.used){
      const run=this.host.store.get<ChatRun>('chat-run',id)
      if(run?.interjection?.state!=='update'||run.cancelled||run.cancelRequested)continue
      this.save(run,'applied')
      this.host.store.put('router-result','router:'+id,{discussion:this.discussion,parentTriggerId:this.parent.id,reply:''})
      this.host.store.jobState('router:'+id,'done')
    }
  }
  close(){this.seal();this.lifetime.abort();return this.chain}
}
