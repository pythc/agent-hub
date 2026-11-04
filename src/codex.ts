import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface } from 'node:readline'
import type { Config } from './config.ts'

import type {Model,ModelRequest,ModelResult,ToolContent} from './model.ts'
export type {Model,ModelRequest,ModelResult,NativeControl,NativeRequest,ToolSpec,ToolContent} from './model.ts'
interface RpcMessage { id?: number | string; method?: string; params?: any; result?: any; error?: { code: number; message: string } }

/** One owned stdio process per activation. Persistent threads survive activations. */
export class CodexModel implements Model {
  constructor(private readonly config: Pick<Config, 'codex' | 'model' | 'effort' | 'turnTimeoutMs'>, private readonly extraArgs: string[] = []) {}
  describe(){return {id:'codex',kind:'codex',nativeTakeover:true,images:true,resume:true,tools:true,steering:true,promptRefresh:true,model:this.config.model}}
  async expose(threadId:string,cwd:string):Promise<void>{
    const client=new AppServer(this.config.codex,this.extraArgs,cwd)
    const timer=setTimeout(()=>client.fail(Error('Expose deadline exceeded')),20000)
    try{
      await client.call('initialize',{clientInfo:{name:'agent-hub',version:'0.6.0'}})
      client.notify('initialized')
      await client.call('thread/unarchive',{threadId})
    }finally{clearTimeout(timer);await client.close()}
  }
  async history(threadId:string,cwd:string):Promise<any>{
    const client=new AppServer(this.config.codex,this.extraArgs,cwd)
    const timer=setTimeout(()=>client.fail(Error('History deadline exceeded')),20000)
    try{await client.call('initialize',{clientInfo:{name:'agent-hub',version:'0.6.0'}});client.notify('initialized');return (await client.call('thread/read',{threadId,includeTurns:true})).thread}
    finally{clearTimeout(timer);await client.close()}
  }
  async catalog(provider?:string):Promise<any>{
    const client=new AppServer(this.config.codex,this.extraArgs,process.cwd())
    const timer=setTimeout(()=>client.fail(Error('Model catalog deadline exceeded')),20000)
    try{
      await client.call('initialize',{clientInfo:{name:'agent-hub',version:'0.6.0'}});client.notify('initialized')
      const current=(await client.call('config/read',{includeLayers:false})).config.model_provider??'openai'
      if(provider&&!['codex',current].includes(provider))throw Error('Only the configured Codex provider catalog is available: '+current)
      return {...await client.call('model/list',{}),provider:current}
    }
    finally{clearTimeout(timer);await client.close()}
  }
  async run(request: ModelRequest): Promise<ModelResult> {
    // Disable configured servers in the per-thread managed config below. A
    // startup override for a missing server creates an invalid partial entry.
    const client = new AppServer(this.config.codex, this.extraArgs, request.cwd,request.onHumanRequest,request.onProgress,request.onTool)
    const abort = () => client.interrupt()
    request.signal?.addEventListener('abort', abort, { once: true })
    const timer = setTimeout(() => client.fail(new Error('Turn deadline exceeded; inspect workspace before retrying')), this.config.turnTimeoutMs)
    try {
      if (request.signal?.aborted) throw new Error('Cancelled')
      await client.call('initialize', { clientInfo: { name: 'agent-hub', version: '0.6.0' },capabilities:{experimentalApi:true} })
      client.notify('initialized')
      let isolated:Record<string,unknown>|undefined
      if(request.managed){
        const effective=(await client.call('config/read',{includeLayers:false,cwd:request.cwd})).config
        const mcp=Object.fromEntries(Object.keys(effective.mcp_servers??{}).map(name=>[name,{enabled:false}]))
        if(request.workerMcp)mcp['superagent-worker']={...request.workerMcp,enabled:true,default_tools_approval_mode:'approve'} as any
        const filesystem:Record<string,string>={':root':'deny',':minimal':'read','/opt/homebrew':'read',':tmpdir':'write',':slash_tmp':'write',[request.cwd]:request.sandbox==='workspace-write'?'write':'read'}
        if(request.privateState)filesystem[request.privateState]='deny'
        isolated={mcp_servers:mcp,plugins:Object.fromEntries(Object.keys(effective.plugins??{}).map(name=>[name,{enabled:false}])),features:{apps:false,shell_tool:false,unified_exec:false,multi_agent:false,browser_use:false,computer_use:false},permissions:{'superagent-managed':{extends:request.sandbox==='workspace-write'?':workspace':':read-only',filesystem,network:{enabled:false}}}}
      }
      const params = {
        cwd: request.cwd, approvalPolicy: request.onHumanRequest||request.operator?'on-request':'never', ...(request.managed?{permissions:'superagent-managed'}:{sandbox:request.sandbox??'read-only'}),
        ...((request.model||(!request.threadId?this.config.model:undefined))?{model:request.model||this.config.model}:{}),
        developerInstructions: request.instructions,
        ...(isolated?{config:isolated}:{}),
      }
      const result = request.threadId
        ? await resumeThread(client,{ ...params, threadId: request.threadId, excludeTurns: true },request)
        : await client.call('thread/start', { ...params, ephemeral: request.ephemeral ?? false,...(request.tools?{dynamicTools:request.tools}:{}) })
      const threadId = result.thread.id as string
      client.threadId = threadId
      request.onThread?.(threadId)
      if(result.model)request.onModel?.(result.model)
      if(request.managed){
        const status=await client.call('mcpServerStatus/list',{threadId,limit:100})
        const active=(status.data??[]).filter((server:any)=>Object.keys(server.tools??{}).length).map((s:any)=>s.name)
        if(active.some((name:string)=>name!=='superagent-worker'))throw Error('Unexpected MCP capability in managed worker: '+active.join(', '))
        request.onCapabilities?.({mcpServers:active,disabledPlugins:Object.keys((isolated as any).plugins??{}),managed:true})
      }
      if (request.title) await client.call('thread/name/set', { threadId, name: request.title })
      // Arm completion before starting: notifications may arrive before the RPC reply.
      const completed = client.completion()
      const started = await client.call('turn/start', {
        threadId, input: [{ type: 'text', text: request.input }],
        ...(!request.operator?{disabledPluginIds:['agent-hub@agent-hub-local','codex-superagent@codex-superagent-local']}:{}),
        effort: this.config.effort, outputSchema: request.schema,
      })
      client.turnId = started.turn.id
      request.onTurn?.(client.turnId!)
      request.onActive?.({interrupt:()=>client.interrupt(),refresh:async(text:string)=>{await client.call('thread/inject_items',{threadId,items:[{type:'message',role:'developer',content:[{type:'input_text',text}]}]})},steer:async(text:string)=>{
        await client.call('turn/steer',{threadId,expectedTurnId:client.turnId,input:[{type:'text',text}]})
      }})
      if (request.signal?.aborted) await client.interrupt()
      const terminal = await completed
      if (client.humanRequest) throw new Error('Human input required: ' + client.humanRequest)
      if (terminal.status !== 'completed') throw new Error('Codex turn ' + terminal.status + ': ' + (terminal.error?.message ?? ''))
      const text = client.answer
      if (!text.trim()) throw new Error('Codex completed without a final answer')
      return { threadId, turnId: client.turnId!, text }
    } finally {
      clearTimeout(timer)
      request.signal?.removeEventListener('abort', abort)
      if(request.archiveOnComplete&&client.threadId){
        // Background workers are archived between activations so the desktop
        // does not keep an idle writer lease. Human takeover explicitly exposes them.
        try{await Promise.race([client.call('thread/archive',{threadId:client.threadId}),new Promise((_,reject)=>setTimeout(()=>reject(Error('Archive deadline')),2000))])}catch{}
      }
      await client.close()
    }
  }
}

async function resumeThread(client:AppServer,params:unknown,request:ModelRequest):Promise<any>{
  const until=Date.now()+120000
  for(;;){
    if(request.signal?.aborted)throw Error('Cancelled while waiting for native writer')
    try{return await client.call('thread/resume',params)}
    catch(error){
      if(request.archiveOnComplete&&String(error).includes('is archived')){await client.call('thread/unarchive',{threadId:request.threadId});continue}
      if(!String(error).includes('active writer')||Date.now()>=until)throw error
      request.onProgress?.('thread/waitingForWriter')
      await new Promise<void>(resolve=>setTimeout(resolve,500))
    }
  }
}

class AppServer {
  readonly process: ChildProcessWithoutNullStreams
  threadId?: string
  turnId?: string
  answer = ''
  humanRequest?: string
  private id = 0
  private pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>()
  private complete?: (turn: any) => void
  private rejectCompletion?: (error: Error) => void
  private failure?: Error
  private terminal?: any
  constructor(binary: string, args: string[], cwd: string,private readonly onRequest?:ModelRequest['onHumanRequest'],private readonly onProgress?:ModelRequest['onProgress'],private readonly onTool?:ModelRequest['onTool']) {
    this.process = spawn(binary, [...args, 'app-server', '--stdio'], { cwd, stdio: 'pipe', shell: false })
    // stderr may contain credentials or tool content; diagnostics use protocol errors.
    this.process.stderr.resume()
    createInterface({ input: this.process.stdout }).on('line', line => {
      try { this.receive(JSON.parse(line)) } catch (error) { this.fail(error instanceof Error ? error : new Error('Invalid protocol message')) }
    })
    this.process.on('error', error => this.fail(error))
    this.process.on('exit', (code, signal) => this.fail(new Error('App Server exited: ' + (code ?? signal))))
    this.process.stdin.on('error', error => this.fail(error))
  }
  private write(message: RpcMessage): void {
    if (this.failure) throw this.failure
    this.process.stdin.write(JSON.stringify(message) + '\n')
  }
  notify(method: string): void { this.write({ method }) }
  call(method: string, params: unknown): Promise<any> {
    if (this.failure) return Promise.reject(this.failure)
    const id = ++this.id
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      try { this.write({ id, method, params }) } catch (error) { this.pending.delete(id); reject(error) }
    })
  }
  completion(): Promise<any> {
    const result = new Promise((resolve, reject) => {
      if (this.failure) reject(this.failure)
      else if (this.terminal) resolve(this.terminal)
      else { this.complete = resolve; this.rejectCompletion = reject }
    })
    // The terminal may reject while turn/start is still awaiting its reply.
    void result.catch(() => {})
    return result
  }
  private receive(message: RpcMessage): void {
    if (!message.method) {
      const pending = this.pending.get(Number(message.id))
      if (!pending) return
      this.pending.delete(Number(message.id))
      if (message.error) pending.reject(new Error('RPC ' + message.error.code + ': ' + message.error.message))
      else pending.resolve(message.result)
      return
    }
    if(message.id!==undefined&&message.method==='item/tool/call'&&this.onTool){
      const p=message.params
      void this.onTool(p.tool,p.arguments,p.callId).then(result=>{if(!this.failure)this.write({id:message.id,result})})
        .catch(error=>{if(!this.failure)this.write({id:message.id,result:{contentItems:[{type:'inputText',text:String(error).slice(0,1000)}],success:false}})})
      return
    }
    if (message.id !== undefined && this.onRequest) {
      const supported=['item/commandExecution/requestApproval','item/fileChange/requestApproval','item/permissions/requestApproval','item/tool/requestUserInput']
      if(supported.includes(message.method)){
        void this.onRequest({id:String(message.id),method:message.method,params:message.params})
          .then(result=>{if(!this.failure)this.write({id:message.id,result})})
          .catch(()=>{void this.interrupt()})
        return
      }
    }
    if (message.id !== undefined) {
      this.humanRequest = message.method
      let result: unknown
      if (message.method === 'item/commandExecution/requestApproval' || message.method === 'item/fileChange/requestApproval') result = { decision: 'decline' }
      else if (message.method === 'item/permissions/requestApproval') result = { permissions: {} }
      else if (message.method === 'item/tool/requestUserInput') result = { answers: {} }
      else {
        this.write({ id: message.id, error: { code: -32601, message: 'Unsupported unattended request' } })
        void this.interrupt()
        return
      }
      this.write({ id: message.id, result })
      void this.interrupt()
      return
    }
    const params = message.params
    if(message.method)this.onProgress?.(message.method)
    if (this.threadId && params?.threadId && params.threadId !== this.threadId) return
    if (message.method === 'turn/started') this.turnId = params.turn.id
    if (message.method === 'item/completed' && params?.item?.type === 'agentMessage') {
      const item = params.item
      if (item.phase !== 'commentary') this.answer = item.text ?? ''
    }
    if (message.method === 'turn/completed') {
      if (this.turnId && params.turn.id !== this.turnId) return
      this.terminal = params.turn
      this.complete?.(params.turn)
    }
  }
  async interrupt(): Promise<void> {
    if (!this.threadId || !this.turnId || this.failure || this.terminal) return
    try { await this.call('turn/interrupt', { threadId: this.threadId, turnId: this.turnId }) } catch {}
  }
  fail(error: Error): void {
    this.failure ??= error
    for (const pending of this.pending.values()) pending.reject(this.failure)
    this.pending.clear()
    this.rejectCompletion?.(this.failure)
  }
  async close(): Promise<void> {
    if (this.process.exitCode !== null || !this.process.pid) return
    const exited = new Promise<void>(resolve => this.process.once('close', () => resolve()))
    this.process.kill('SIGTERM')
    const kill = setTimeout(() => this.process.kill('SIGKILL'), 2000)
    await exited
    clearTimeout(kill)
  }
}
