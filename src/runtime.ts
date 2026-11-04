import { mkdirSync, openSync, writeFileSync, readFileSync, unlinkSync, closeSync } from 'node:fs'
import { join } from 'node:path'
import { Engine, latestAssignment, runningAssignment, followupOwners, ticketStage, type Candidate, type Assignment, type Ticket, type Trigger } from './vendor/dsh-core/index.ts'
import { Store, type Run, type Job } from './store.ts'
import { makePolicy, makeScope } from './policy.ts'
import { MessageSource, UncertainDelivery, incomingSchema, bodyDigest, type Source, type Incoming } from './sources.ts'
import type { Config } from './config.ts'
import { Approvals } from './approvals.ts'
import type { NativeControl } from './codex.ts'
import { Settings } from './settings.ts'
import {compose,promptStatus,digest} from './prompts.ts'
import { GithubSource } from './connectors/github.ts'
import { FeishuSource } from './connectors/feishu.ts'
import { CodexModel, type Model,type ModelRequest,type ModelResult } from './codex.ts'
import { prepareWorkspace } from './workspace.ts'
import { assessment, assessmentSchema, report, reportSchema } from './schemas.ts'
import {WorkManager,type WorkOwner,type WorkItem} from './work.ts'
import {Resources} from './resources.ts'
import {WorkerTools,workerSpecs} from './worker-tools.ts'
import {fileURLToPath} from 'node:url'
import {Setup} from './setup.ts'
import {Reviews} from './review.ts'
import {Merger} from './merge.ts'
import type {GithubApi} from './connectors/github.ts'



export class Runtime {
  readonly store: Store
  readonly engine: Engine
  readonly sources = new Map<string, Source>()
  readonly model: Model
  readonly settings: Settings
  readonly approvals: Approvals
  readonly work:WorkManager
  readonly resources:Resources
  readonly workerTools:WorkerTools
  readonly merger:Merger
  readonly setup:Setup
  readonly reviews:Reviews
  endpoint?:string
  private readonly controls=new Map<string,NativeControl>()
  private readonly controlRevisions=new Map<string,number>()
  private readonly pollControllers = new Map<string,AbortController>()
  private readonly polls = new Map<string,Promise<void>>()
  private readonly nextPoll = new Map<string,number>()
  private readonly controllers = new Map<string, AbortController>()
  private readonly runningJobs = new Map<string, Promise<void>>()
  private ticking = false
  private tickIdle:Promise<void>=Promise.resolve()
  private closing = false
  private timer?: ReturnType<typeof setInterval>
  private lock: string
  private paused = false
  constructor(readonly config: Config, options: { model?: Model; sources?: Source[];mergeApi?:GithubApi } = {}) {
    mkdirSync(config.stateDir, { recursive: true, mode: 0o700 })
    this.lock = join(config.stateDir, 'host.lock')
    try {
      const descriptor = openSync(this.lock, 'wx', 0o600)
      writeFileSync(descriptor, String(process.pid))
      closeSync(descriptor)
    } catch {
      const pid = Number(readFileSync(this.lock, 'utf8'))
      try { process.kill(pid, 0); throw new Error('State directory is owned by a live host: ' + pid) }
      catch (error: any) {
        if (error.code !== 'ESRCH') throw error
        unlinkSync(this.lock)
        const descriptor = openSync(this.lock, 'wx', 0o600)
        writeFileSync(descriptor, String(process.pid))
        closeSync(descriptor)
      }
    }
    try { this.store = new Store(join(config.stateDir, 'state.sqlite')) }
    catch (error) { unlinkSync(this.lock); throw error }
    this.approvals = new Approvals(this.store)
    this.settings = new Settings(this.store,config)
    this.paused = this.store.get<boolean>('settings', 'paused') ?? false
    this.model = options.model ?? new CodexModel(config)
    for (const source of config.sources) this.sources.set(source.id, options.sources?.find(s => s.config.id === source.id) ?? (source.kind==='github'?new GithubSource(source):source.kind==='feishu'?new FeishuSource(source):new MessageSource(source)))
    let logicalNow = this.store.get<number>('clock', 'last') ?? 0
    this.engine = new Engine({
      now: () => {
        logicalNow = Math.max(Date.now(), logicalNow + 1)
        this.store.put('clock', 'last', logicalNow)
        return new Date(logicalNow).toISOString()
      },
      repo: this.store, policy: () => makePolicy(config, () => this.paused), scope: makeScope(config), outbox: this.store.outbox,
      assessor: {
        request: candidate => this.store.enqueue('assess:' + candidate.evalId, 'assess', candidate),
        release: () => {},
      },
      executor: {
        start: (ticket, assignment) => this.store.enqueue('start:' + assignment.id, 'start', { ticketId: ticket.id, assignmentId: assignment.id }),
        deliver: (ticket, assignment) => this.queueInputs(ticket, assignment),
        stop: (ticket, assignment) => {
          this.store.enqueue('cancel:' + assignment.id, 'cancel', { ticketId: ticket.id, assignmentId: assignment.id })
        },
      },
      emit: event => {
        this.store.audit(event)
        if(event.type==='trigger.followup')this.store.enqueue('followup:'+event.data.triggerId,'followup',{triggerId:event.data.triggerId})
        if(event.type==='assignment.ended')this.store.enqueue('cleanup:'+event.data.assignmentId,'cleanup',{ticketId:event.data.ticketId,assignmentId:event.data.assignmentId})
      },
    })
    this.resources=new Resources(this)
    this.workerTools=new WorkerTools(this)
    this.work=new WorkManager(this.store,config,{valid:owner=>this.validWork(owner),wake:item=>this.workCompleted(item),expired:(owner,killed,remaining)=>{const run=this.store.get<Run>('run',owner.ticketId);if(run?.phase==='background'&&this.validWork(owner)){this.store.put('run',owner.ticketId,{...run,phase:'idle'});this.engine.report(owner.ticketId,{state:'waiting',summary:(run.result??'')+' Background deadline reached. Killed jobs: '+killed.join(', ')+'; remaining subagents: '+remaining.join(', ')})}},agent:(item,signal)=>this.runAgent(item,signal)})
    this.merger=new Merger(this,options.mergeApi)
    this.setup=new Setup(this)
    this.reviews=new Reviews(this)
    this.store.recoverJobs()
    this.store.recoverDeliveries()
    for (const run of this.store.list<Run>('run')) {
      if (run.phase === 'running' || run.phase === 'starting' || run.phase === 'background' || run.phase==='interrupted' || run.phase === 'uncertain' || run.phase === 'delivering' || run.phase==='merging') {
        this.store.put('run', run.ticketId, { ...run, phase: 'uncertain', error: 'Host stopped during execution; inspect native history and workspace before retry' })
        const ticket = this.store.tickets.get(run.ticketId)
        if (ticket && !ticket.ended && runningAssignment(ticket)) this.engine.report(ticket.id, { state: 'blocked', summary: 'Execution interrupted; reconciliation required', question: 'Inspect the native thread and workspace, then retry or take over.' })
        if(config.work.autoRecover&&['running','starting','background','interrupted'].includes(run.phase)&&ticket&&!ticket.ended){
          this.store.put('run',run.ticketId,{...run,phase:'idle',error:undefined})
          this.engine.retryTicket(run.ticketId)
          this.engine.note(run.ticketId,'Host restarted. Inspect the retained native history, managed jobs, working directory and external state before repeating any action. Interrupted jobs are not automatically replayed.')
        }
      }
    }
  }
  private queueInputs(ticket: Ticket, assignment: Assignment): void {
    if (ticket.undelivered.length) this.store.enqueue('execute:' + assignment.id + ':' + bodyDigest(ticket.undelivered), 'execute', { ticketId: ticket.id, assignmentId: assignment.id })
  }
  private async runModel(request:ModelRequest):Promise<ModelResult>{
    let threadId=request.threadId
    const originalInput=request.input
    for(let attempt=0;;attempt++){
      try{return await this.model.run({...request,model:threadId?undefined:request.model??(request.ephemeral?this.config.models.router:undefined),threadId,onThread:id=>{threadId=id;request.onThread?.(id)}})}
      catch(error){
        if(request.signal?.aborted||attempt>=3||!/HTTP (408|429|5\d\d)|ECONNRESET|ECONNREFUSED|ETIMEDOUT|connection reset|stream disconnected|temporar(?:y|ily)|error sending request/i.test(String(error)))throw error
        this.store.audit({type:'model.retry',threadId,attempt:attempt+1,error:String(error).slice(0,300)})
        request.input=JSON.stringify({retry:attempt+1,notice:'Continue the same work after a transient provider failure. Inspect native history and retained managed jobs before repeating any action.',previousInput:originalInput})
        await new Promise(resolve=>setTimeout(resolve,Math.min(10000,1000*2**attempt)))
      }
    }
  }
  validWork(owner:WorkOwner):boolean {
    const ticket=this.store.tickets.get(owner.ticketId),assignment=ticket&&latestAssignment(ticket)
    if(this.closing||!ticket||ticket.ended||assignment?.id!==owner.assignmentId||assignment.state!=='running')return false
    let parent=owner.agentId,depth=0
    while(parent){const agent=this.store.get<WorkItem>('work',parent);if(++depth>16||!agent||agent.ticketId!==owner.ticketId||agent.assignmentId!==owner.assignmentId||agent.state!=='running')return false;parent=agent.agentId}
    return true
  }
  async refreshWork(owner:WorkOwner){
    const key=owner.agentId?'agent:'+owner.agentId:owner.ticketId,control=this.controls.get(key),revision=this.settings.current().revision
    if(!control?.refresh||this.controlRevisions.get(key)===revision)return
    const ticket=this.store.tickets.get(owner.ticketId)!
    const instructions=compose(this.config,'worker',{cwd:owner.cwd,ticketId:ticket.id,mandate:ticket.mandate.scope,subagent:!!owner.agentId},ticket.mandate.policyVersion)+(owner.agentId?'\nYou remain a subagent. Only perform the delegated subtask; do not repeat the parent orchestration.':'')+'\nLive host prompt revision '+revision+'. This replaces earlier team and built-in prompt text while preserving the immutable mandate and tool permissions.'
    await control.refresh(instructions)
    this.controlRevisions.set(key,revision)
    this.store.put('prompt-use',key+':'+revision,{ticketId:ticket.id,agentId:owner.agentId,revision,at:Date.now(),digest:digest(instructions),injected:true})
  }
  private workCompleted(item:WorkItem){
    const message={kind:'work_completed',id:item.id,state:item.state,resource:'job/'+item.id,error:item.error}
    if(item.agentId)this.store.put('agent-input',item.id,{agentId:item.agentId,...message,read:false})
    else this.engine.note(item.ticketId,JSON.stringify(message))
  }
  private workerMcp(owner:WorkOwner){
    if(!this.endpoint)throw Error('Legacy native threads require the running worker MCP bridge')
    const grant=this.workerTools.grant(owner)
    return {command:process.execPath,args:['--import',fileURLToPath(new URL('../node_modules/tsx/dist/loader.mjs',import.meta.url)),fileURLToPath(new URL('./cli.ts',import.meta.url)),'worker-mcp',this.endpoint,grant]}
  }
  private async runAgent(item:WorkItem,signal:AbortSignal):Promise<{threadId:string;result:unknown}>{
    const owner:WorkOwner={ticketId:item.ticketId,assignmentId:item.assignmentId,cwd:item.cwd,sandbox:item.sandbox,agentId:item.id,depth:item.depth+1}
    const ticket=this.store.tickets.get(item.ticketId)!
    let threadId:string|undefined,input=item.prompt!,round=0
    for(;;){
      signal.throwIfAborted()
      while(this.paused){signal.throwIfAborted();await new Promise(r=>setTimeout(r,100))}
      const instructions=compose(this.config,'worker',{cwd:owner.cwd,mandate:ticket.mandate.scope,subagent:true},ticket.mandate.policyVersion)+'\nYou are a managed subagent, not the parent orchestrator. The parent mandate is an upper bound, not a checklist to repeat. Perform only the delegated subtask in the input. Read files directly with superagent_read; do not launch another subagent unless that subtask actually needs delegation. Use superagent_shell for commands, never native shell or native subagents. Do not publish or contact people. Return waiting while owned jobs still run; return ready only with the final subtask result.'
      const revision=this.settings.current().revision,key='agent:'+item.id
      let result
      try{result=await this.runModel({cwd:owner.cwd,sandbox:owner.sandbox,model:threadId?undefined:this.config.models.subagent??this.config.models.worker,threadId,title:'Subagent: '+ticket.title,schema:reportSchema,instructions,input,signal,managed:true,privateState:this.config.stateDir,archiveOnComplete:true,tools:workerSpecs,onTool:(name,args)=>this.workerTools.call(owner,name,args),onThread:id=>{threadId=id;this.store.put('work',item.id,{...this.store.get<WorkItem>('work',item.id)!,threadId:id})},onCapabilities:cap=>this.store.put('capabilities',item.id,{ticketId:item.ticketId,agentId:item.id,...cap}),onActive:control=>{this.controls.set(key,control);this.controlRevisions.set(key,revision)}})}
      finally{this.controls.delete(key);this.controlRevisions.delete(key)}
      const output=report.parse(JSON.parse(result.text));threadId=result.threadId
      this.store.put('transcript',result.turnId,{ticketId:item.ticketId,agentId:item.id,threadId,turnId:result.turnId,text:result.text,at:Date.now()})
      const owned=()=>this.work.list(item.ticketId).filter(w=>w.assignmentId===item.assignmentId&&w.agentId===item.id&&['starting','running'].includes(w.state))
      if(output.state!=='waiting'||!owned().length)return {threadId,result:output}
      do{signal.throwIfAborted();await this.work.tick();await new Promise(r=>setTimeout(r,100))}while(owned().length)
      const updates=this.store.list<any>('agent-input').filter(x=>x.agentId===item.id&&!x.read)
      for(const update of updates)this.store.put('agent-input',update.id,{...update,read:true})
      input=JSON.stringify({continuation:++round,updates})
    }
  }
  /** Only a trusted adapter supplies actor identity; MCP clients use the configured local operator. */
  canWrite(){return !this.closing&&!this.paused}
  receive(sourceId: string, actor: string, value: Incoming, human = true): unknown {
    if (this.closing) throw new Error('Host is stopping')
    const source = this.sources.get(sourceId)
    if (!source) throw new Error('Unknown source')
    const input = incomingSchema.parse(value)
    if(source.validThread&&!source.validThread(input.thread))throw Error('Thread is outside configured source')
    const trigger = source.trigger(input, actor, human)
    return this.ingest(trigger)
  }
  ingest(trigger: Trigger): unknown {
    if(this.closing)throw Error('Host is stopping')
    if(!this.sources.has(trigger.source))throw Error('Unknown source')
    return this.store.atomic(()=>{
    const source=this.sources.get(trigger.source)!
    const existing = this.store.triggers.get(trigger.id)
    if (existing && (existing.text !== trigger.text || existing.actor.id !== trigger.actor.id || JSON.stringify(existing.threads) !== JSON.stringify(trigger.threads))) throw new Error('Event id was reused with different content')
    if(source.idempotencyKey){
      const key=source.idempotencyKey(trigger)
      const previousId=this.store.get<string>('source-event-key',key)??this.store.list<Trigger>('trigger').find(t=>t.source===trigger.source&&source.idempotencyKey!(t)===key)?.id
      if(previousId){
        const previous=this.store.triggers.get(previousId)
        if(previous&&(previous.text!==trigger.text||previous.actor.id!==trigger.actor.id||JSON.stringify(previous.threads)!==JSON.stringify(trigger.threads)))throw Error('Source event identity was reused with different content')
        return {disposition:'duplicate',triggerId:previousId,thread:trigger.threads[0]?.id,related:this.related(trigger)}
      }
      this.store.put('source-event-key',key,trigger.id)
    }
    if(!trigger.human&&String(trigger.meta.scope).startsWith('review')&&typeof trigger.meta.head==='string'&&(!this.config.delivery.automatedReviewers.length||this.config.delivery.automatedReviewers.includes(trigger.actor.id))){
      const key=trigger.source+':'+trigger.meta.number,rounds=this.store.get<string[]>('review-rounds',key)??[]
      if(!rounds.includes(trigger.meta.head)){
        if(rounds.length>=this.config.delivery.maxReviewRounds){this.store.audit({type:'review.round-limit',trigger:trigger.id,head:trigger.meta.head});return {disposition:'ignored',reason:'Automated review round limit'}}
        this.store.put('review-rounds',key,[...rounds,trigger.meta.head])
      }
    }
    const disposition = this.engine.receive(trigger)
    if(trigger.human&&followupOwners(trigger,this.store).length)this.store.enqueue('followup:'+trigger.id,'followup',{triggerId:trigger.id})
    return { disposition, triggerId: trigger.id, thread: trigger.threads[0]?.id, related: this.related(trigger) }
    })
  }

  private related(trigger: Trigger): string[] {
    return [...new Set(trigger.threads.flatMap(ref => this.store.threads.get(ref.source + ':' + ref.id)?.subscriptions ?? []))]
  }
  start(): void {
    this.timer = setInterval(() => { void this.tick().catch(error => this.store.audit({ type: 'host.error', message: String(error) })) }, 150)
  }
  async tick(): Promise<void> {
    if (this.ticking || this.closing) return
    this.ticking = true
    let tickFinished!:()=>void
    this.tickIdle=new Promise(resolve=>{tickFinished=resolve})
    try {
      this.store.put('health','host',{at:Date.now(),pid:process.pid})
      await this.work.tick()
      if(!this.paused)void this.merger.tick().catch(error=>this.store.audit({type:'merge.error',message:String(error)}))
      this.pollSources()
      this.engine.evaluateDue()
      const interactive=(job:Job)=>job.kind==='followup'||(job.kind==='execute'&&!!this.store.tickets.get((job.payload as any).ticketId)?.inputs.some(i=>i.kind==='trigger'&&i.human&&this.store.tickets.get((job.payload as any).ticketId)!.undelivered.includes(i.id)))
      for (const job of this.store.jobs().sort((a,b)=>Number(interactive(b))-Number(interactive(a)))) {
        const payload = job.payload as any
        if(job.kind==='cleanup'){
          await this.work.endAssignment(payload.ticketId,payload.assignmentId)
          this.store.jobState(job.id,'done');continue
        }
        if (job.kind === 'cancel') {
          const run = this.store.get<Run>('run', payload.ticketId)
          if (run?.assignmentId === payload.assignmentId) this.controllers.get(payload.ticketId)?.abort()
          this.store.jobState(job.id, 'done')
          continue
        }
        const routing=job.kind==='assess'||job.kind==='followup'
        const workers=[...this.runningJobs.keys()].filter(id=>!id.startsWith('assess:')&&!id.startsWith('followup:')).length
        const reserved=this.store.list<Run>('run').filter(r=>r.phase==='background'&&r.ticketId!==payload.ticketId&&!this.controllers.has(r.ticketId)&&this.work.active(r.ticketId,r.assignmentId).length).length
        if(routing?[...this.runningJobs.keys()].filter(id=>id.startsWith('assess:')||id.startsWith('followup:')).length>=4:workers+reserved>=this.config.concurrency+(interactive(job)?1:0))continue
        if (job.kind === 'execute' && this.controllers.has(payload.ticketId)) continue
        if (this.paused || (payload.ticketId && ['human','delivering','merging'].includes(this.store.get<Run>('run', payload.ticketId)?.phase??''))) continue
        this.store.jobState(job.id, 'running')
        const task = this.perform(job).catch(error => {
          this.store.jobState(job.id, 'failed', String(error))
          this.store.audit({ type: 'job.failed', id: job.id, message: String(error) })
          if (payload.ticketId) {
            const ticket = this.store.tickets.get(payload.ticketId)
            if (ticket && !ticket.ended) this.engine.report(ticket.id, { state: 'blocked', summary: String(error).slice(0,500) })
          }
        }).finally(() => { this.runningJobs.delete(job.id) })
        this.runningJobs.set(job.id, task)
      }
      await this.flush()
      if(!this.paused)await this.reviews.tick()
    } finally { this.ticking = false;tickFinished() }
  }
  private async perform(job: Job): Promise<void> {
    if (job.kind === 'assess') await this.assess(job.payload as Candidate)
    else if(job.kind==='followup')await this.routeFollowup((job.payload as any).triggerId)
    else {
      const { ticketId, assignmentId } = job.payload as { ticketId: string; assignmentId: string }
      const ticket = this.store.tickets.get(ticketId)
      if (!ticket || ticket.ended || latestAssignment(ticket)?.id !== assignmentId) { this.store.jobState(job.id, 'done'); return }
      if (job.kind === 'start') {
        const source=this.sources.get(ticket.mandate.actor.source)?.config
        const origin=this.store.triggers.get(ticket.origin.triggerId)
        if(source?.kind==='github'&&source.sandbox==='workspace-write'&&!ticket.follows?.length&&origin?.threads[0]){
          this.engine.bindThread(ticketId,origin.threads[0],false)
        }
        this.engine.assignmentStarted(ticketId, assignmentId)
        this.store.enqueue('execute:' + assignmentId + ':initial', 'execute', { ticketId, assignmentId })
      }
      else if (job.kind === 'execute') await this.execute(ticket, assignmentId)
    }
    this.store.jobState(job.id, 'done')
  }
  private async assess(candidate: Candidate): Promise<void> {
    const current = this.engine.candidate(candidate.triggers[0]!.id)
    if (current?.evalId !== candidate.evalId) return
    const text=candidate.triggers.map(t=>t.text).join('\n')
    const referenced=this.store.tickets.list().filter(t=>t.ended?.by!=='human').filter(t=>text.includes(t.id)||t.channels.some(c=>typeof c.address.url==='string'&&c.address.url.length>10&&text.includes(c.address.url))||t.follows?.some(f=>{const m=/^([^:]+):([^#]+)#(\d+)$/.exec(f.thread);return !!m&&text.includes('https://github.com/'+m[2]+'/pull/'+m[3])}))
    const candidates=[...new Map([...candidate.tickets,...referenced].map(t=>[t.id,t])).values()]
    const source = this.sources.get(candidate.thread.ref.source)!.config
    this.engine.candidateDelivered(candidate.evalId)
    const controller = new AbortController()
    this.controllers.set('assess:' + candidate.evalId, controller)
    try {
      const result = await this.runModel({
        signal: controller.signal, cwd: source.cwd, ephemeral: true, sandbox: 'read-only', schema: assessmentSchema,
        managed:true,privateState:this.config.stateDir,tools:workerSpecs.filter(t=>t.name==='superagent_read'),onTool:async(name,args)=>{if(name!=='superagent_read')throw Error('Router has read-only tools');const result=await this.resources.read(args);return result?.kind==='image'?{success:true,contentItems:[{type:'inputImage',imageUrl:'data:'+result.mimeType+';base64,'+result.data}]}:{success:true,contentItems:[{type:'inputText',text:JSON.stringify(result)}]}},
        instructions: compose(this.config,'router',{source:source.id,cwd:source.cwd},candidate.policyVersion),
        input: JSON.stringify({ strength: candidate.strength, rules: this.config.rules, triggers: candidate.triggers, existing: candidates.map(t => ({ id: t.id, title: t.title, scope: t.mandate.scope })) }),
      })
      const decision = assessment.parse(JSON.parse(result.text))
      const triggerId = candidate.triggers[0]!.id
      const audit={ruleAssessments:decision.ruleAssessments??[]}
      if(candidate.strength==='inferred'){
        const assessments=decision.ruleAssessments??[],ids=assessments.map(a=>a.id)
        if(ids.length!==this.config.rules.length||new Set(ids).size!==ids.length||this.config.rules.some(r=>!ids.includes(r.id)))throw Error('Assessment must cover each enabled rule exactly once')
        const matched=assessments.filter(a=>a.matched).map(a=>a.id).sort()
        if(JSON.stringify(matched)!==JSON.stringify([...decision.rules].sort()))throw Error('Matched rule IDs do not agree with assessments')
      }
      if(decision.action==='attach'){
        if(!decision.targetTicketId||!candidates.some(t=>t.id===decision.targetTicketId))throw Error('Attachment target is outside candidate context')
        this.engine.attach(decision.targetTicketId,triggerId,decision.reason)
      }
      else if(decision.action==='stop'){
        if(!decision.targetTicketId||!candidates.some(t=>t.id===decision.targetTicketId))throw Error('Stop target is outside candidate context')
        this.engine.decide(triggerId,{kind:'stop',ticketId:decision.targetTicketId,reason:decision.reason,evalId:candidate.evalId,audit})
      }
      else if (decision.action === 'ignore') this.engine.decide(triggerId, { kind: 'ignore', reason: decision.reason, evalId: candidate.evalId,audit })
      else if (candidate.strength === 'inferred' && this.config.acceptMode !== 'auto') {
        this.engine.decide(triggerId, { kind: 'ignore', reason: 'observe', evalId: candidate.evalId, audit: { wouldAccept: true, ...decision } })
      } else this.engine.decide(triggerId, { kind: 'accept', title: decision.title, scope: decision.scope, acknowledgement: '已收到，将处理：'+decision.title, rules: decision.rules, reason: decision.reason, evalId: candidate.evalId,audit })
    } catch (error) {
      if (this.engine.candidate(candidate.triggers[0]!.id)?.evalId === candidate.evalId) this.engine.decide(candidate.triggers[0]!.id, { kind: 'unavailable', reason: String(error).slice(0,500), evalId: candidate.evalId })
    } finally { this.controllers.delete('assess:' + candidate.evalId) }
  }
  private async routeFollowup(triggerId:string):Promise<void>{
    const trigger=this.store.triggers.get(triggerId)
    if(!trigger?.human)return
    const ids=followupOwners(trigger,this.store),tickets=ids.map(id=>this.store.tickets.get(id)!).filter(Boolean)
    if(!tickets.length)return
    const source=this.sources.get(trigger.source)!
    const controller=new AbortController(),key='followup:'+triggerId
    this.controllers.set(key,controller)
    try{
    const result=await this.runModel({signal:controller.signal,cwd:source.config.cwd,managed:true,privateState:this.config.stateDir,ephemeral:true,sandbox:'read-only',schema:assessmentSchema,
      instructions:'Classify this worker-owned follow-up only for an explicit human request to stop selected work. Do not execute work or use tools. Return action stop with an exact targetTicketId from the list only when the person clearly requests it. Otherwise return ignore, targetTicketId null, rules [] and ruleAssessments []. The worker handles all other follow-ups. '+this.config.prompts.router,
      input:JSON.stringify({trigger,tickets:tickets.map(t=>({id:t.id,title:t.title,scope:t.mandate.scope}))})})
    const decision=assessment.parse(JSON.parse(result.text))
    if(decision.action==='stop'&&decision.targetTicketId&&ids.includes(decision.targetTicketId))this.engine.decide(triggerId,{kind:'stop',ticketId:decision.targetTicketId,reason:decision.reason})
    }finally{this.controllers.delete(key)}
  }
  private async execute(ticket: Ticket, assignmentId: string): Promise<void> {
    const source = this.sources.get(ticket.mandate.actor.source)!.config
    const saved = this.store.get<Run>('run', ticket.id)
    if (saved?.phase === 'human' || saved?.phase === 'uncertain') {
      this.engine.report(ticket.id, { state: 'blocked', summary: 'Reconciliation required before execution' })
      return
    }
    const inputs = ticket.inputs.filter(i => ticket.undelivered.includes(i.id))
    if (!inputs.length && saved?.assignmentId === assignmentId) return
    const controller = new AbortController()
    this.controllers.set(ticket.id, controller)
    const run: Run = { ...saved, ticketId: ticket.id, assignmentId, cwd: saved?.cwd ?? source.cwd, phase: 'starting' }
    this.store.put('run', ticket.id, run)
    const persist = () => {
      if (this.store.get<Run>('run', ticket.id)?.phase === 'human') run.phase = 'human'
      this.store.put('run', ticket.id, run)
    }
    try {
      await this.work.recovered
      if(!saved?.prepared&&!saved?.threadId){run.cwd=await prepareWorkspace(this.config,source,ticket.id,controller.signal);run.prepared=true;persist()}
      controller.signal.throwIfAborted()
      const contextSource=this.sources.get(ticket.mandate.actor.source)!
      const origin=this.store.triggers.get(ticket.origin.triggerId)
      const sourceContext=origin?{trigger:'trigger/'+origin.id,source:origin.source,resources:'catalog',thread:origin.threads[0]&&'thread/'+origin.source+':'+origin.threads[0].id}:undefined
      const promptRevision=this.settings.current().revision
      const instructions=compose(this.config,'worker',{cwd:run.cwd,ticketId:ticket.id,mandate:ticket.mandate.scope,matchedRules:this.config.rules.filter(r=>ticket.mandate.basis.rules?.includes(r.id))},ticket.mandate.policyVersion)
        +'\nUse only superagent_shell for commands and superagent_spawn for delegation. These tools survive this turn. Use superagent_read for bounded resources. Return waiting while managed background work is running. A ready report or a question hands control to a person and stops subagents. A review server may remain until this assignment ends.'
      const owner:WorkOwner={ticketId:ticket.id,assignmentId,cwd:run.cwd,sandbox:source.sandbox,depth:0}
      const toolsDigest=digest(JSON.stringify(workerSpecs)),legacy=!!saved?.threadId&&saved.toolsDigest!==toolsDigest
      this.work.turnStarted(ticket.id,assignmentId)
      const result = await this.runModel({
        model:saved?.threadId?undefined:this.config.models.worker,
        title: ticket.title, cwd: run.cwd, sandbox: source.sandbox, threadId: saved?.threadId, schema: reportSchema,archiveOnComplete:true,
        instructions,
        managed:true,privateState:this.config.stateDir,...(legacy?{workerMcp:this.workerMcp(owner)}:{tools:workerSpecs}),onTool:(name,args)=>this.workerTools.call(owner,name,args),onCapabilities:cap=>this.store.put('capabilities',ticket.id,{ticketId:ticket.id,...cap}),
        input: JSON.stringify({ sourceContext, mandate: ticket.mandate, relatedThreads:ticket.follows, ...(!saved ? { origin: ticket.origin.triggerIds.map(id => this.store.triggers.get(id)) } : {}), inputs: inputs.map(i => i.kind === 'trigger' ? { ...i, event: this.store.triggers.get(i.triggerId) } : i) }),
        signal: controller.signal,
        onHumanRequest:request=>this.approvals.request(ticket.id,request),
        onActive:control=>{this.controls.set(ticket.id,control);this.controlRevisions.set(ticket.id,promptRevision)},
        onProgress:event=>{
          this.store.put('progress',ticket.id,{ticketId:ticket.id,at:Date.now(),event})
          if(event==='thread/waitingForWriter'){run.waitingForWriter=true;persist()}
        },
        onThread: id => { delete run.error;if(!legacy){run.toolsVersion=4;run.toolsDigest=toolsDigest;} run.waitingForWriter=false; run.threadId = id; persist() },
        onModel:model=>{run.model=model;persist()},
        onTurn: id => { run.turnId = id; run.phase = 'running'; this.store.put('prompt-use',id,{ticketId:ticket.id,threadId:run.threadId,revision:promptRevision,digest:digest(instructions),at:Date.now()});persist() },
      })
      const current = this.store.tickets.get(ticket.id)
      if (controller.signal.aborted || !current || current.ended || latestAssignment(current)?.id !== assignmentId) return
      const output = report.parse(JSON.parse(result.text))
      this.store.put('transcript',result.turnId,{ticketId:ticket.id,threadId:result.threadId,turnId:result.turnId,text:result.text,at:Date.now(),revision:promptRevision})
      const extraInputs=current.undelivered.filter(id=>!inputs.some(i=>i.id===id)).length>0
      const handoff=['blocked','failed','dropped'].includes(output.state)||!extraInputs&&(output.state==='ready'||!!output.question)
      if(handoff)await this.work.handoff(ticket.id,assignmentId)
      const background=!handoff&&this.work.active(ticket.id,assignmentId).length>0
      if(background)this.work.turnEnded(ticket.id,assignmentId)
      this.store.atomic(() => {
        this.engine.inputsDelivered(ticket.id, assignmentId, inputs.map(i => i.id))
        this.engine.inputsRead(ticket.id, inputs.map(i => i.id))
        for (const handback of output.handbacks) this.engine.handback(ticket.id, handback.triggerId, handback.reason)
        this.engine.turnEnded(ticket.id, assignmentId)
        const pending = this.store.tickets.get(ticket.id)!.undelivered.length > 0
        const answered = [...inputs].reverse().find(i => i.kind === 'trigger' && i.human && !i.context)
        const answerId = answered?.kind === 'trigger' && !output.question&&!background ? answered.triggerId : undefined
        this.engine.report(ticket.id, { state:background?'progress':pending&&!handoff?'waiting':output.state, summary: background?'Managed background work is running. '+output.summary:output.summary, question: pending&&!handoff ? null : output.question, ...(!pending && answerId ? { answers: answerId } : {}) })
        if (!pending && output.question) this.engine.reply({ purpose: 'attention', ticketId: ticket.id, text: output.question })
        else if (output.reply && !pending && output.state === 'ready') this.engine.reply({ purpose: answerId ? 'answer' : 'result', ticketId: ticket.id, ...(answerId ? { triggerId: answerId } : {}), text: output.reply })
        run.phase = background?'background':'idle'; run.threadId = result.threadId; run.result = output.reply; persist()
        const updated = this.store.tickets.get(ticket.id)!
        if (pending&&!handoff) this.queueInputs(updated, latestAssignment(updated)!)
      })
      if(this.store.tickets.get(ticket.id)?.ended)await this.work.endAssignment(ticket.id,assignmentId)
    } catch (error) {
      const current = this.store.tickets.get(ticket.id)
      if (!controller.signal.aborted && current && !current.ended && latestAssignment(current)?.id === assignmentId) {
        await this.work.handoff(ticket.id,assignmentId)
        run.phase = 'uncertain'; run.error = String(error).slice(0, 500)
        persist()
        this.engine.report(ticket.id, { state: 'blocked', summary: run.error, question: 'Execution could not be confirmed. Inspect the native thread and workspace, then retry or take over.' })
      }
    } finally {
      this.controls.delete(ticket.id)
      this.controlRevisions.delete(ticket.id)
      this.approvals.cancel(ticket.id)
      this.controllers.delete(ticket.id)
      if (controller.signal.aborted && this.store.get<Run>('run', ticket.id)?.phase !== 'human') {
        run.phase = this.closing ? 'interrupted' : 'idle'; persist()
      }
    }
  }
  async flush(): Promise<void> {
    if(this.paused)return
    const blocked=new Set<string>()
    for (const message of this.store.deliveries()) {
      const channel=message.channel.source+':'+message.channel.thread
      if(['sent','dropped'].includes(message.status))continue
      if(blocked.has(channel))continue
      blocked.add(channel)
      if(this.closing)return
      if (message.status !== 'pending' || message.nextAt > Date.now()) continue
      const ticket = message.ticketId && this.store.tickets.get(message.ticketId)
      if (ticket && (ticket.ended?.by === 'human' || this.store.get<Run>('run', ticket.id)?.phase === 'human')) continue
      const source=this.sources.get(message.channel.source)
      if(!source?.config.enabled)continue
      const event=ticket?this.store.triggers.get(ticket.origin.triggerId):undefined
      const row=event?.meta.scope??'default'
      if(source.config.listenScopes&&!source.config.listenScopes.includes(String(row))){this.store.outbox.withdraw(message.id);continue}
      if(!this.store.deliveryStarted(message.id))continue
      try { await source.deliver(message); this.store.delivered(message.id);blocked.delete(channel) }
      catch (error) { this.store.deliveryFailed(message.id, message.attempts + 1, String(error).slice(0,300), error instanceof UncertainDelivery) }
    }
  }
  status() {
    return {
      stalled:this.store.tickets.open().filter(t=>this.store.get<Run>('run',t.id)?.phase==='running'&&Date.now()-(this.store.get<{at:number}>('progress',t.id)?.at??Date.parse(t.updatedAt))>this.config.watchdog.staleMs).map(t=>t.id),
      approvals:this.store.list('approval'), health:this.store.list('health'),watchdog:this.config.watchdog,
      threadProblems:this.store.list<any>('thread-health').filter(h=>h.consecutiveFailures>=3),
      settingsRevision:this.settings.current().revision,prompts:promptStatus(this.config).map(({default:text,override,...rest})=>rest), sources:this.store.list('source-health'), threads:this.store.threads.list(), events:this.store.list('trigger'),
      paused: this.paused, active: this.controllers.size,
      tickets: this.store.tickets.list().map(t => ({ ...t, stage: ticketStage(t), run: this.store.get<Run>('run', t.id) })),
      work:this.work.list(),
      merges:this.store.list('merge-attempt'),mergeGrants:this.store.list('merge-grant'),setup:this.store.get('setup','current'),liveSources:this.store.list('source-live'),
      deliveries: this.store.deliveries(), decisions: this.store.list('decision'),
    }
  }
  async steer(id:string,text:string) {
    const ticket=this.store.tickets.get(id),control=this.controls.get(id)
    if(!ticket||ticket.ended||!control||this.store.get<Run>('run',id)?.phase!=='running')throw Error('No active turn to steer')
    // Direct operator input is bounded by the existing mandate; source events continue through the durable queue.
    this.store.audit({type:'operator.steer',ticketId:id,text})
    await control.steer(text)
  }
  updateSettings(revision:number,patch:unknown) {
    const previous=makePolicy(this.config,()=>this.paused).version
    const saved=this.settings.save(revision,patch)
    for(const source of this.sources.values()){const current=this.config.sources.find(s=>s.id===source.config.id);if(current)Object.assign(source.config,current)}
    const next=makePolicy(this.config,()=>this.paused).version
    if(previous!==next)this.engine.policyChanged(previous,next)
    return saved
  }
  async pollSources():Promise<void> {
    for(const source of this.sources.values()){
      if(!source.config.enabled||!source.poll||this.polls.has(source.config.id)||(this.nextPoll.get(source.config.id)??0)>Date.now())continue
      this.nextPoll.set(source.config.id,Date.now()+source.config.pollSeconds*1000)
      const pollController=new AbortController()
      this.pollControllers.set(source.config.id,pollController)
      const context={
        signal:pollController.signal,store:this.store, receive:(event:Trigger)=>this.ingest(event),
        bind:(ticketId:string,thread:string,own:boolean)=>{this.engine.bindThread(ticketId,{source:source.config.id,id:thread},own)},
        closed:(thread:string,outcome:'merged'|'closed',at:string)=>this.engine.threadClosed({source:source.config.id,id:thread},outcome,at),
      }
      source.start?.(context)
      const sync=source.config.memberSync?.enabled?this.setup.previewMembers(source.config.id,source.config.memberSync.scope).then(p=>this.setup.applyMembers(p.id)):Promise.resolve()
      const poll=sync.then(()=>source.poll!(context)).then(()=>{this.store.put('source-health',source.config.id,{source:source.config.id,at:Date.now(),status:'ok',consecutiveFailures:0})})
        .catch(error=>{this.store.put('source-health',source.config.id,{source:source.config.id,at:Date.now(),status:(this.store.get<any>('source-health',source.config.id)?.consecutiveFailures??0)>=2?'error':'retrying',consecutiveFailures:(this.store.get<any>('source-health',source.config.id)?.consecutiveFailures??0)+1,error:String(error).slice(0,300)})})
        .finally(()=>{this.polls.delete(source.config.id);this.pollControllers.delete(source.config.id)})
      this.polls.set(source.config.id,poll)
    }
  }
  pause(value: boolean): void { this.paused = value; this.store.put('settings', 'paused', value); this.store.audit({ type: 'pause', value }) }
  async stop(id: string): Promise<void> {
    if(this.store.get<Run>('run',id)?.phase==='merging')throw Error('A merge has been submitted. Reconcile its outcome before stopping subsequent work.')
    const assignment=this.store.tickets.get(id)&&latestAssignment(this.store.tickets.get(id)!)
    this.engine.stopTicket(id, 'Stopped by operator')
    this.approvals.cancel(id)
    this.controllers.get(id)?.abort()
    await this.waitForWork(id)
    if(assignment)await this.work.endAssignment(id,assignment.id)
  }
  async takeover(id: string): Promise<Run> {
    const ticket = this.store.tickets.get(id)
    if (!ticket) throw new Error('Unknown work')
    const source = this.sources.get(ticket.mandate.actor.source)!.config
    if(['delivering','merging'].includes(this.store.get<Run>('run',id)?.phase??''))throw Error('Wait for the current delivery to finish before taking over')
    const run: Run = { ticketId: id, assignmentId: latestAssignment(ticket)!.id, cwd: source.cwd, ...this.store.get<Run>('run', id), phase: 'human' }
    this.store.put('run', id, run)
    this.approvals.cancel(id)
    this.controllers.get(id)?.abort()
    await this.waitForWork(id)
    await this.work.handoff(id,run.assignmentId)
    const latestRun = this.store.get<Run>('run', id) ?? run
    if(latestRun.threadId)await this.model.expose?.(latestRun.threadId,latestRun.cwd)
    this.store.put('run', id, { ...latestRun, phase: 'human' })
    if (!ticket.ended) this.engine.report(id, { state: 'blocked', summary: 'Human has execution control' })
    return { ...latestRun, phase: 'human' }
  }
  private async waitForWork(id: string): Promise<void> {
    const assignmentIds = this.store.tickets.get(id)?.assignments.map(a => a.id) ?? []
    await Promise.allSettled([...this.runningJobs].filter(([key]) => assignmentIds.some(a => key.includes(a))).map(([, promise]) => promise))
  }
  returnControl(id: string): void {
    const ticket = this.store.tickets.get(id)
    const run = this.store.get<Run>('run', id)
    if (!ticket || !run || run.phase !== 'human') throw new Error('Work is not under human control')
    if (this.controllers.has(id)) throw new Error('Wait for execution to stop')
    this.store.atomic(() => {
      this.store.put('run', id, { ...run, phase: 'idle' })
      if (!ticket.ended) {
        this.engine.report(id, { state: 'blocked', summary: 'Returned by human. Inspect current workspace before retry.' })
      }
    })
  }
  retry(id: string): void {
    const run = this.store.get<Run>('run', id)
    if (this.controllers.has(id)) throw new Error('Wait for the current activation to stop')
    if (run?.phase === 'human') throw new Error('Return human control before retrying')
    this.store.atomic(() => {
      if (run) this.store.put('run', id, { ...run, phase: 'idle' })
      this.engine.retryTicket(id)
    })
  }
  async close(): Promise<void> {
    this.closing = true
    if (this.timer) clearInterval(this.timer)
    this.approvals.close()
    for(const controller of this.pollControllers.values())controller.abort()
    for (const controller of this.controllers.values()) controller.abort()
    const merging=this.merger.close()
    await Promise.allSettled([...this.sources.values()].map(source=>source.close?.()))
    await this.work.close()
    await merging
    await Promise.allSettled([...this.runningJobs.values(),...this.polls.values()])
    await this.tickIdle
    this.store.close()
    unlinkSync(this.lock)
  }
}
