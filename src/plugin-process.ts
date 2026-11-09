import {spawn,type ChildProcessWithoutNullStreams} from 'node:child_process'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {Ajv2020} from 'ajv/dist/2020.js'
import {z} from 'zod'
import {MessageSource,UncertainDelivery,sourceChangeSchema,stableDigest,type SourceContext} from './sources.ts'
import {pointer,readPluginPackage,type PluginPackage} from './plugin-package.ts'
import {sandboxCommand,type SandboxDriver} from './sandbox.ts'
import {hostPrivateFiles} from './private-files.ts'
import type {SourceConfig} from './config.ts'
import type {Store} from './store.ts'
import type {Trigger,OutboundMessage} from './vendor/dsh-core/index.ts'

const metadataKinds=new Set(['source-cursor','source-live','source-message-observation','source-freshness','thread-health','entry-label','source-identity-mismatch'])
const readableKinds=new Set([...metadataKinds,'trigger','thread','source-identity','source-message-state'])
const scopedId=(source:string,id:string)=>id===source||id.startsWith(source+':')
const ref=z.object({source:z.string(),id:z.string()}).strict()
const triggerSchema=z.object({id:z.string().min(1).max(1000),source:z.string(),threads:z.array(ref).min(1).max(20),actor:ref,human:z.boolean(),addressed:z.enum(['direct','indirect']).optional(),at:z.string().datetime({offset:true}),text:z.string().max(100000),meta:z.record(z.string(),z.unknown()),channel:z.object({source:z.string(),thread:z.string(),address:z.record(z.string(),z.string())}).strict().optional()}).strict()
const quote=(s:string)=>"'"+s.replaceAll("'","'\\''")+"'"
export interface PluginProcessOptions {sandboxDriver:SandboxDriver;codex:string;stateDir:string;readPaths?:string[];timeoutMs?:number}
/** One connection, one process. The child receives no host DB, task-control API or ambient credentials. */
export class ProcessSource extends MessageSource {
  private child?:ChildProcessWithoutNullStreams
  private sourceContext?:SourceContext
  private sequence=0
  private stateAck=0
  private pending=new Map<number,{resolve:(v:any)=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setTimeout>}>()
  private scratch?:string
  private stopped=false
  private ready?:Promise<any>
  private serial:Promise<unknown>=Promise.resolve()
  private hostStore?:Store
  private resolveConfig:()=>SourceConfig|undefined=()=>this.config
  constructor(config:SourceConfig,readonly pkg:PluginPackage,private options:PluginProcessOptions){
    super(config)
    const validate=new Ajv2020({strict:false,validateFormats:false}).compile(pkg.manifest.configSchema)
    if(!validate(config))throw Error('Plugin configuration is invalid: '+pkg.manifest.id)
    const scopes=pointer(config,pkg.manifest.scopesPath)
    if(!Array.isArray(scopes)||!scopes.length||scopes.some(s=>typeof s!=='string'||!s||s.length>300))throw Error('Plugin requires explicit resource scopes')
    if(pkg.manifest.stateKinds.some(k=>!metadataKinds.has(k)&&k!=='plugin-state'))throw Error('Plugin requests a protected host record kind')
  }
  attach(store:Store,resolveConfig?:()=>SourceConfig|undefined){this.hostStore=store;if(resolveConfig)this.resolveConfig=resolveConfig}
  private active(){const c=this.resolveConfig();if(!c?.enabled)throw Error('Plugin connection is disabled');return c}
  scopes(){const c=this.resolveConfig();return c?(pointer(c,this.pkg.manifest.scopesPath) as string[]).filter(s=>!c.listenScopes||c.listenScopes.includes(s)):[]}
  validThread(thread:string){return this.scopes().some(s=>thread===s||thread.startsWith(s+':'))}
  override get verificationCommand(){return this.pkg.manifest.commandPath?String(pointer(this.config,this.pkg.manifest.commandPath)??''):''}
  replay(scope:string|undefined,since:string){
    if(this.pkg.manifest.cursorMode==='none'||!Number.isFinite(Date.parse(since)))throw Error('Plugin replay is unavailable')
    if(this.pkg.manifest.cursorMode==='scope'&&(!scope||!this.scopes().includes(scope)))throw Error('Replay scope is unavailable')
    return {key:this.config.id+(this.pkg.manifest.cursorMode==='scope'?':'+scope:''),since:this.pkg.manifest.cursorEncoding==='unix-seconds'?String(Math.floor(Date.parse(since)/1000)):since}
  }
  private effectiveConfig(){
    const config=structuredClone(this.resolveConfig()??this.config),parts=this.pkg.manifest.scopesPath.slice(1).split('/')
    let value:any=config;for(const part of parts.slice(0,-1))value=value[part]
    value[parts.at(-1)!]=this.scopes();return config
  }
  private records(kind:string,input:unknown={}){
    this.active()
    if(!readableKinds.has(kind))throw Error('Plugin record kind is unavailable')
    const query=z.object({sourceId:z.string().max(300).optional(),ids:z.array(z.string().max(1000)).max(200).optional(),cursor:z.string().max(1000).optional(),limit:z.number().int().min(1).max(200).default(100),scope:z.string().max(300).optional(),messageIds:z.array(z.string().max(300)).max(200).optional(),subscribed:z.boolean().optional()}).strict().parse(input)
    const store=this.hostStore??this.sourceContext?.store;if(!store)throw Error('Plugin state is unavailable')
    if(query.sourceId&&query.sourceId!==this.config.id)throw Error('Plugin record source is unavailable')
    const scopes=this.scopes();if(query.scope&&!scopes.includes(query.scope))throw Error('Plugin record scope is unavailable')
    const where=['r.kind=?','r.id>?'],params:any[]=[kind,query.cursor??'']
    const inList=(expression:string,values:string[])=>{where.push(expression+' IN ('+values.map(()=>'?').join(',')+')');params.push(...values)}
    if(!scopes.length)return {items:[]}
    if(kind==='trigger'){
      where.push("json_extract(r.body,'$.source')=?");params.push(this.config.id)
      inList("COALESCE(json_extract(r.body,'$.meta.scope'),json_extract(r.body,'$.meta.chat'))",query.scope?[query.scope]:scopes)
    }else if(kind==='thread'){
      where.push("json_extract(r.body,'$.ref.source')=?");params.push(this.config.id)
      const threadScopes=query.scope?[query.scope]:scopes
      where.push('('+threadScopes.map(()=>"(json_extract(r.body,'$.ref.id')=? OR substr(json_extract(r.body,'$.ref.id'),1,?)=?)").join(' OR ')+')')
      for(const scope of threadScopes)params.push(scope,scope.length+1,scope+':')
      if(query.subscribed)where.push("json_array_length(r.body,'$.subscriptions')>0")
    }else if(kind==='source-message-state'){
      where.push("json_extract(r.body,'$.sourceId')=?");params.push(this.config.id)
      where.push("EXISTS(SELECT 1 FROM records e WHERE e.kind='entry-binding' AND e.id=json_extract(r.body,'$.entryId') AND json_extract(e.body,'$.sourceId')=?)");params.push(this.config.id)
      inList("(SELECT json_extract(e.body,'$.nativeId') FROM records e WHERE e.kind='entry-binding' AND e.id=json_extract(r.body,'$.entryId'))",query.scope?[query.scope]:scopes)
    }else{
      where.push('(r.id=? OR substr(r.id,1,?)=?)');params.push(this.config.id,this.config.id.length+1,this.config.id+':')
      const scopeExpr="COALESCE(json_extract(r.body,'$.scope'),json_extract(r.body,'$.nativeId'),json_extract(r.body,'$.chat'))"
      where.push('('+scopeExpr+' IS NULL OR '+scopeExpr+' IN ('+scopes.map(()=>'?').join(',')+'))');params.push(...scopes)
      if(query.scope){where.push(scopeExpr+'=?');params.push(query.scope)}
    }
    if(query.ids)inList('r.id',query.ids)
    if(query.messageIds)inList(kind==='trigger'?"json_extract(r.body,'$.meta.messageId')":"json_extract(r.body,'$.messageId')",query.messageIds)
    const rows=store.db.prepare('SELECT r.id,r.body FROM records r WHERE '+where.join(' AND ')+' ORDER BY r.id LIMIT ?').all(...params,query.limit+1)
    const items:any[]=[];let bytes=0
    for(const row of rows.slice(0,query.limit)){
      const size=Buffer.byteLength(String(row.body));if(size>1_000_000)throw Error('Plugin record exceeds page limit')
      if(bytes+size>1_000_000)break
      items.push({id:String(row.id),value:JSON.parse(String(row.body))});bytes+=size
    }
    return {items,...(rows.length>items.length?{next:items.at(-1)!.id}:{})}
  }
  private snapshot(){
    const store=this.hostStore??this.sourceContext?.store;if(!store)return []
    // Historical records are queried by page. Only small connection control state is sent with each call.
    const result:any[]=[]
    for(const kind of ['source-cursor','source-live','source-identity']){
      let cursor:string|undefined
      do{const page=this.records(kind,{cursor,limit:200});result.push(...page.items.map(row=>({kind,...row})));cursor=page.next}while(cursor)
    }
    result.push(...(store.get<any[]>('plugin-state',this.config.id)??[]).map(row=>({kind:'plugin-state',id:row.id,value:row.value})))
    if(JSON.stringify(result).length>12_000_000)throw Error('Plugin control context exceeds limit')
    return result
  }
  private apply(operations:unknown){
    if(!Array.isArray(operations)||operations.length>10000)throw Error('Invalid plugin state batch')
    if(!operations.length)return
    if(this.pkg.manifest.methods.includes('webhook'))throw Error('Webhook normalizers cannot mutate host state')
    const c=this.active(),store=this.hostStore??this.sourceContext?.store
    if(!store)throw Error('Plugin state is unavailable')
    store.atomic(()=>{for(const op of operations){
      if(op.type==='put'){
        if(!this.pkg.manifest.stateKinds.includes(op.kind)||typeof op.id!=='string'||op.id.length>1000||op.value===undefined)throw Error('Plugin state access denied')
        if(op.kind==='plugin-state'){
          const rows=store.get<any[]>('plugin-state',this.config.id)??[],next=[...rows.filter(r=>r.id!==op.id),{id:op.id,value:op.value}]
          if(JSON.stringify(next).length>2_000_000)throw Error('Plugin private state exceeds limit')
          store.put('plugin-state',this.config.id,next)
        }else{
          if(!scopedId(this.config.id,op.id))throw Error('Plugin state is outside its source')
          const scope=op.value?.scope??op.value?.nativeId
          if(scope&&!this.scopes().includes(scope))throw Error('Plugin state is outside its scope')
          store.put(op.kind,op.id,op.value)
        }
      }else if(op.type==='receive'){
        const t=triggerSchema.parse(op.trigger) as Trigger
        if(!this.sourceContext||!c.capabilities.events||!scopedId(this.config.id,t.id)||t.source!==this.config.id||t.actor.source!==this.config.id||!this.scopes().includes(String(t.meta.scope??t.meta.chat))||t.threads.some(r=>r.source!==this.config.id||!this.validThread(r.id))||t.channel&&(t.channel.source!==this.config.id||!this.validThread(t.channel.thread)))throw Error('Plugin event is outside its source')
        const messageId=t.meta.messageId??(t.meta.message as any)?.id
        if(messageId&&store.get('source-message-state',stableDigest([c.id,String(t.meta.scope??t.meta.chat),messageId])))continue
        this.sourceContext.receive(t)
      }else if(op.type==='change'){
        const event=sourceChangeSchema.parse(op.event)
        if(!this.sourceContext||!this.scopes().includes(event.scope))throw Error('Plugin lifecycle event is outside its source')
        this.sourceContext.change?.(event)
      }else throw Error('Unsupported plugin host operation')
    }})
  }
  private async launch(){
    if(this.stopped)throw Error('Plugin has stopped')
    if(this.ready)return this.ready
    readPluginPackage(this.pkg.directory,this.pkg.digest)
    const scratch=mkdtempSync(join(tmpdir(),'agenthub-plugin-'));this.scratch=scratch
    try{
      const runner=fileURLToPath(new URL('./plugin-worker.mjs',import.meta.url)),env:Record<string,string>={PATH:process.env.PATH??'',HOME:scratch,TMPDIR:scratch}
      for(const path of Object.values(this.pkg.manifest.credentials)){
        const name=pointer(this.config,path);if(name===undefined)continue
        if(typeof name!=='string'||!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)||!process.env[name])throw Error('Plugin credential is unavailable')
        env[name]=process.env[name]!
      }
      const command=sandboxCommand({sandboxDriver:this.options.sandboxDriver,codex:this.options.codex,cwd:this.pkg.directory,scratch,sandbox:'read-only',network:this.pkg.manifest.network,privateState:this.options.stateDir,privatePaths:hostPrivateFiles(),attachments:[runner,...this.options.readPaths??[]],command:'exec '+[process.execPath,runner].map(quote).join(' ')})
      const child=spawn(command.command,command.args,{cwd:this.pkg.directory,env,stdio:['pipe','pipe','pipe'],detached:process.platform!=='win32'});this.child=child;this.stateAck=0
      child.stderr.resume()
      let buffer=''
      child.stdout.setEncoding('utf8');child.stdout.on('data',chunk=>{
        if(this.child!==child)return
        buffer+=chunk
        if(Buffer.byteLength(buffer)>16_000_000){this.fail(Error('Plugin response exceeds limit'),child);return}
        let i:number
        while((i=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,i);buffer=buffer.slice(i+1);this.response(line,child)}
      })
      child.once('error',()=>this.fail(Error('Plugin process failed to start'),child))
      child.once('close',()=>{this.fail(Error('Plugin process stopped'),child);rmSync(scratch,{recursive:true,force:true})})
      this.ready=this.request({type:'init',module:join(this.pkg.directory,'plugin.mjs'),config:this.effectiveConfig()})
      await this.ready
    }catch(error){this.fail(error as Error);rmSync(scratch,{recursive:true,force:true});throw error}
  }
  private response(line:string,child:ChildProcessWithoutNullStreams){
    if(this.child!==child)return
    try{
      const message=JSON.parse(line)
      if(message.type==='records'){const result=this.pkg.manifest.methods.includes('webhook')?(()=>{throw Error('Webhook normalizers cannot read host history')})():this.records(message.kind,message.query);child.stdin.write(JSON.stringify({type:'records-result',id:message.id,result,stateAck:this.stateAck})+'\n');return}
      if(message.type==='events'){this.apply(message.operations);this.stateAck=message.id;child.stdin.write(JSON.stringify({type:'ack',id:message.id})+'\n');return}
      if(message.type!=='result')throw Error('Invalid plugin response')
      const pending=this.pending.get(message.id);if(!pending)throw Error('Unknown plugin response')
      this.apply(message.operations)
      this.pending.delete(message.id);clearTimeout(pending.timer)
      // Plugin diagnostics may contain tokens or payloads; they are never copied to host audit/error text.
      if(message.error)pending.reject(Error('Plugin operation failed ('+this.pkg.manifest.id+')'))
      else pending.resolve(message.result)
    }catch{this.fail(Error('Plugin protocol or source boundary violation'),child)}
  }
  private request(body:Record<string,unknown>){
    const id=++this.sequence,child=this.child!
    return new Promise<any>((resolve,reject)=>{
      const timer=setTimeout(()=>this.fail(Error('Plugin operation timed out'),child),this.options.timeoutMs??60000)
      this.pending.set(id,{resolve,reject,timer})
      child.stdin.write(JSON.stringify({...body,id})+'\n',error=>{if(error)this.fail(Error('Plugin process is unavailable'),child)})
    })
  }
  private fail(error:Error,child=this.child){
    if(child!==this.child)return
    for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(error)}this.pending.clear()
    if(child){try{if(process.platform!=='win32'&&child.pid)process.kill(-child.pid,'SIGKILL');else child.kill('SIGKILL')}catch{}}
    this.child=undefined;this.ready=undefined
  }
  private guard(method:string,args:unknown[]){
    if(method==='close')return
    const c=this.active()
    if(['poll','start'].includes(method)&&!c.capabilities.events)throw Error('Events disabled')
    if(['read','context'].includes(method)&&!c.capabilities.resources)throw Error('Resources disabled')
    if(method==='deliver'){
      const m=args[0] as OutboundMessage
      if(!c.capabilities.replies||m.channel.source!==c.id||!this.validThread(m.channel.thread))throw Error('Reply access revoked')
    }
    if(method==='members'&&!this.scopes().includes(String(args[0])))throw Error('Member scope access revoked')
    if(method==='context'&&!this.validThread(String(args[0])))throw Error('Thread access revoked')
    if(method==='read'){
      const t=(args[0] as any)?.trigger
      if(t&&(t.source!==c.id||!this.scopes().includes(String(t.meta?.scope??t.meta?.chat))))throw Error('Resource access revoked')
    }
  }
  invoke(method:string,...args:unknown[]){
    if(!this.pkg.manifest.methods.includes(method as any))return Promise.reject(Error('Plugin capability is unavailable'))
    const work=this.serial.then(async()=>{
      this.guard(method,args);if(method==='webhook'&&(this.pkg.manifest.network||Object.keys(this.pkg.manifest.credentials).length||this.pkg.manifest.methods.some(m=>m!=='webhook'&&m!=='close')))throw Error('Webhook normalizer must be isolated without network, credentials or other capabilities');await this.launch();this.guard(method,args)
      if(!['identity','probe','close'].includes(method)&&this.hostStore&&this.pkg.manifest.methods.includes('identity')){
        const identity=await this.request({type:'call',method:'identity',args:[],snapshot:this.snapshot(),stateAck:this.stateAck}),saved=this.hostStore.get<any>('source-identity',this.config.id)
        if(saved&&saved.principal!==identity?.id)throw Error('Plugin connection account changed')
        this.guard(method,args)
      }
      const result=await this.request({type:'call',method,args,config:this.effectiveConfig(),snapshot:this.pkg.manifest.methods.includes('webhook')?[]:this.snapshot(),stateAck:this.stateAck})
      this.guard(method,args);return result
    })
    this.serial=work.catch(()=>{});return work
  }
  async start(context:SourceContext){this.sourceContext=context;this.hostStore=context.store;if(this.pkg.manifest.methods.includes('start'))await this.invoke('start')}
  async poll(context:SourceContext){this.sourceContext=context;this.hostStore=context.store;if(this.pkg.manifest.methods.includes('poll'))await this.invoke('poll')}
  identity(){return this.invoke('identity')}
  probe(){return this.invoke('probe')}
  members(scope=this.scopes()[0]){if(!scope||!this.scopes().includes(scope))throw Error('Scope is unavailable');return this.invoke('members',scope)}
  async read(request:{resource:string;trigger?:Trigger;pageSize:number}){
    const check=()=>{if(!this.active().capabilities.resources||request.trigger&&(request.trigger.source!==this.config.id||!this.scopes().includes(String(request.trigger.meta.scope??request.trigger.meta.chat))))throw Error('Resource is outside plugin source')}
    check();const result=await this.invoke('read',request);check();return result
  }
  async context(thread:string){if(!this.validThread(thread)||!this.active().capabilities.resources)throw Error('Thread is unavailable');const result=await this.invoke('context',thread);if(!this.validThread(thread)||!this.active().capabilities.resources)throw Error('Thread access revoked');return result}
  async deliver(message:OutboundMessage){
    if(!this.active().capabilities.replies||message.channel.source!==this.config.id||!this.validThread(message.channel.thread))throw Error('Reply is outside plugin source')
    try{await this.invoke('deliver',message)}catch{throw new UncertainDelivery('Plugin reply outcome unknown; reconcile destination before retry')}
  }
  async close(){
    try{if(this.child&&this.pkg.manifest.methods.includes('close'))await this.invoke('close')}finally{this.stopped=true;this.fail(Error('Plugin closed'));if(this.scratch)rmSync(this.scratch,{recursive:true,force:true})}
  }
}
