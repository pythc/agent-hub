import {spawn,execFileSync, type ChildProcess} from 'node:child_process'
import {randomUUID} from 'node:crypto'
import {mkdirSync,readFileSync,writeFileSync,existsSync} from 'node:fs'
import {join,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import type {Store} from './store.ts'
import type {Config} from './config.ts'
import {hostPrivateFiles} from './private-files.ts'

export interface WorkOwner {ticketId:string;assignmentId:string;cwd:string;sandbox:'read-only'|'workspace-write';agentId?:string;depth:number}
export interface WorkItem extends WorkOwner {
 id:string;kind:'shell'|'agent';state:'starting'|'running'|'completed'|'failed'|'cancelled'|'interrupted';
 createdAt:number;endedAt?:number;pid?:number;command?:string;prompt?:string;threadId?:string;
 notify:'auto'|'held'|'sent'|'collected'|'dropped';deadline?:number;result?:unknown;exitCode?:number|null;error?:string
}
export interface WorkHooks {
 valid(owner:WorkOwner):boolean
 wake(item:WorkItem):void
 expired?(owner:WorkOwner,killed:string[],remaining:string[]):void
 agent(item:WorkItem,signal:AbortSignal):Promise<{threadId:string;result:unknown}>
}
const terminal=(item:WorkItem)=>!['starting','running'].includes(item.state)
/** Work survives a model turn. A process restart interrupts work rather than silently replaying it. */
export class WorkManager {
 private agents=new Map<string,{controller:AbortController;promise:Promise<void>}>()
 private waits=new Map<string,number>()
 private runners=new Map<string,ChildProcess>()
 private stopping=false
  readonly recovered:Promise<void>
 readonly directory:string
 constructor(readonly store:Store,readonly config:Config,private hooks:WorkHooks){
  this.directory=join(config.stateDir,'jobs');mkdirSync(this.directory,{recursive:true,mode:0o700})
  const interrupted=this.list().filter(item=>!terminal(item))
  for(const item of interrupted){
   // The runner's parent/lock monitor kills its own process group. Never signal a stale PID here.
   this.put({...item,state:'interrupted',endedAt:Date.now(),error:'Host restarted; inspect the retained output before repeating work'})
  }
  this.recovered=(async()=>{
   const shells=interrupted.filter(w=>w.kind==='shell');if(!shells.length)return
   for(let n=0;n<35;n++){
    const waiting=shells.filter(w=>{if(existsSync(join(this.directory,w.id+'.result.json')))return false;if(!w.pid)return true;try{process.kill(w.pid,0);return true}catch{return false}})
    if(!waiting.length)return
    await new Promise(r=>setTimeout(r,100))
   }
   throw Error('Previous managed command shutdown is not confirmed; inspect retained jobs before resuming')
  })()
  void this.recovered.catch(()=>{})
 }
 list(ticketId?:string){return this.store.list<WorkItem>('work').filter(w=>!ticketId||w.ticketId===ticketId)}
 private put(item:WorkItem){this.store.put('work',item.id,item);return item}
 private assert(owner:WorkOwner){if(this.stopping||!this.hooks.valid(owner))throw Error('This assignment no longer owns work tools')}
 private matching(owner:WorkOwner,item:WorkItem){return item.ticketId===owner.ticketId&&item.assignmentId===owner.assignmentId&&item.agentId===owner.agentId}
 private own(owner:WorkOwner,id:string){this.assert(owner);const item=this.store.get<WorkItem>('work',id);if(!item||!this.matching(owner,item))throw Error('Work item is outside this worker');return item}
 private key(owner:WorkOwner,requestId:string){return owner.ticketId+':'+owner.assignmentId+':'+(owner.agentId??'root')+':'+requestId}
 private create(owner:WorkOwner,kind:WorkItem['kind'],requestId:string,body:{command?:string;prompt?:string}){
  this.assert(owner)
  const key=this.key(owner,requestId),previous=this.store.get<string>('work-request',key)
  if(previous){const item=this.own(owner,previous);if(item.kind!==kind||item.command!==body.command||item.prompt!==body.prompt)throw Error('Work request id reused with different content');return {item,fresh:false}}
  return this.store.atomic(()=>{
   const item:WorkItem={...owner,...body,id:randomUUID(),kind,state:'starting',createdAt:Date.now(),notify:'auto'}
   this.put(item);this.store.put('work-request',key,item.id);return {item,fresh:true}
  })
 }
 async shell(owner:WorkOwner,command:string,requestId:string,yieldMs=5000){
  if(this.config.work.sandboxDriver==='disabled')throw Error('Managed shell is disabled; configure a sandbox driver before requesting commands')
  if(this.config.work.sandboxDriver==='seatbelt'&&process.platform!=='darwin')throw Error('Seatbelt sandbox requires macOS')
  if(this.config.work.sandboxDriver==='bubblewrap'&&process.platform!=='linux')throw Error('Bubblewrap sandbox requires Linux')
  const {item,fresh}=this.create(owner,'shell',requestId,{command})
  if(fresh){
   const spec=join(this.directory,item.id+'.spec.json'),runner=fileURLToPath(new URL('./work-runner.ts',import.meta.url))
   let gitDirectory:string|undefined
   try{gitDirectory=resolve(owner.cwd,execFileSync('git',['rev-parse','--git-common-dir'],{cwd:owner.cwd,encoding:'utf8',timeout:2000,stdio:['ignore','pipe','ignore']}).trim())}catch{}
   const attachments=this.store.list<any>('asset').filter(a=>a.ticketId===owner.ticketId).map(a=>a.path)
   writeFileSync(spec,JSON.stringify({id:item.id,command,cwd:owner.cwd,sandbox:owner.sandbox,codex:this.config.codex,sandboxDriver:this.config.work.sandboxDriver,network:this.config.work.network,privateState:this.config.stateDir,privatePaths:hostPrivateFiles(),gitDirectory,attachments,hostPid:process.pid,hostLock:join(this.config.stateDir,'host.lock'),directory:this.directory,maxOutputBytes:this.config.work.maxOutputBytes}),{mode:0o600,flag:'wx'})
   try{
    const child=spawn(process.execPath,['--import',fileURLToPath(new URL('../node_modules/tsx/dist/loader.mjs',import.meta.url)),runner,spec],{detached:process.platform!=='win32',stdio:'ignore',shell:false})
    this.runners.set(item.id,child)
    child.once('error',()=>{this.put({...this.store.get<WorkItem>('work',item.id)!,state:'failed',endedAt:Date.now(),error:'Unable to start managed command'})})
    child.once('exit',()=>{this.runners.delete(item.id);const current=this.store.get<WorkItem>('work',item.id);if(current&&['starting','running'].includes(current.state)&&!existsSync(join(this.directory,item.id+'.result.json')))this.put({...current,state:'interrupted',endedAt:Date.now(),error:'Managed runner exited without a durable receipt; inspect retained output before retrying'})})
    await new Promise<void>((resolve,reject)=>{child.once('spawn',()=>resolve());child.once('error',reject)})
    this.put({...item,state:'running',pid:child.pid})
   }catch(error){this.put({...item,state:'failed',endedAt:Date.now(),error:String(error)})}
  }
  return this.wait(owner,item.id,yieldMs)
 }
 async agent(owner:WorkOwner,prompt:string,requestId:string){
  this.assert(owner)
  const previous=this.store.get<string>('work-request',this.key(owner,requestId))
  if(previous){const {item}=this.create(owner,'agent',requestId,{prompt});return this.view(item)}
  if(owner.depth>=this.config.work.maxDepth)throw Error('Subagent depth limit reached')
  if(this.list(owner.ticketId).filter(w=>w.kind==='agent'&&!terminal(w)).length>=this.config.work.maxAgents)throw Error('Subagent concurrency limit reached')
  const {item,fresh}=this.create(owner,'agent',requestId,{prompt})
  if(fresh){
   const controller=new AbortController()
   const current=this.put({...item,state:'running'})
   const promise=this.hooks.agent(current,controller.signal).then(result=>{
    const latest=this.store.get<WorkItem>('work',item.id)!
    if(terminal(latest)||this.stopping)return
    this.put({...latest,state:'completed',endedAt:Date.now(),threadId:result.threadId,result:result.result})
   }).catch(error=>{
    const latest=this.store.get<WorkItem>('work',item.id)!
    if(!terminal(latest))this.put({...latest,state:controller.signal.aborted?'cancelled':'failed',endedAt:Date.now(),error:String(error).slice(0,1000)})
   }).finally(async()=>{
    await this.cancelOwned(item.ticketId,item.assignmentId,item.id,'Subagent ended')
    this.agents.delete(item.id)
   })
   this.agents.set(item.id,{controller,promise})
  }
  return this.view(this.store.get<WorkItem>('work',item.id)!)
 }
 async wait(owner:WorkOwner,id:string,yieldMs=0){
  this.own(owner,id)
  const maximum=owner.agentId?60000:5000,until=Date.now()+Math.min(maximum,Math.max(0,yieldMs))
  this.waits.set(id,(this.waits.get(id)??0)+1)
  try{do{
   await this.tick()
   let item=this.own(owner,id)
   if(terminal(item)||Date.now()>=until){
    if(terminal(item)&&item.notify==='auto')item=this.put({...item,notify:'collected'})
    return this.view(item)
   }
   await new Promise(resolve=>setTimeout(resolve,30))
  }while(true)}finally{const n=(this.waits.get(id)??1)-1;if(n)this.waits.set(id,n);else this.waits.delete(id)}
 }
 view(item:WorkItem,offset=0,limit=4000){
  const path=join(this.directory,item.id+'.output'),output=existsSync(path)?readFileSync(path,'utf8'):''
  return {...item,output:output.slice(offset,offset+limit),outputOffset:offset,nextOffset:offset+limit<output.length?offset+limit:null,outputCharacters:output.length,resource:'job/'+item.id}
 }
 read(owner:WorkOwner,id:string,offset=0,limit=4000){return this.view(this.own(owner,id),offset,limit)}
 active(ticketId:string,assignmentId:string){return this.list(ticketId).filter(w=>w.assignmentId===assignmentId&&!terminal(w)&&w.notify==='auto')}
 async tick(){
  if(this.hooks.expired){
   const due=this.list().filter(w=>!terminal(w)&&w.deadline&&Date.now()>=w.deadline&&!w.agentId)
   for(const expired of new Map(due.map(w=>[w.ticketId+':'+w.assignmentId,w])).values()){
    const owned=this.list(expired.ticketId).filter(w=>w.assignmentId===expired.assignmentId&&!w.agentId&&!terminal(w)&&w.notify==='auto'),killed:string[]=[]
    for(const w of owned){
     this.put({...w,deadline:undefined,notify:w.kind==='shell'?'held':w.notify})
     if(w.kind==='shell'){await this.cancel(this.store.get<WorkItem>('work',w.id)!,'Background turn deadline reached',false);killed.push(w.id)}
    }
    this.hooks.expired(expired,killed,owned.filter(w=>w.kind==='agent').map(w=>w.id))
   }
  }
  for(let item of this.list()){
   item=this.store.get<WorkItem>('work',item.id)!
   if(item.kind==='shell'&&!terminal(item)){
    const path=join(this.directory,item.id+'.result.json')
    if(existsSync(path)){
     try{const result=JSON.parse(readFileSync(path,'utf8'));if(result.id!==item.id)throw Error('Runner identity mismatch');item=this.put({...item,state:result.error?'failed':result.exitCode===0?'completed':'failed',endedAt:result.endedAt,exitCode:result.exitCode,result,error:result.error})}
     catch{item=this.put({...item,state:'failed',endedAt:Date.now(),error:'Invalid managed-command result'})}
    }
   }
   if(!terminal(item)&&!this.hooks.valid(item)){await this.cancel(item,'Assignment ended',true);continue}
   if(!terminal(item)&&item.deadline&&Date.now()>=item.deadline&&item.kind==='shell'){
    await this.cancel(item,'Background turn deadline reached',false);item=this.store.get<WorkItem>('work',item.id)!
   }
   if(terminal(item)&&item.notify==='auto'&&!this.waits.has(item.id)&&!this.stopping&&this.hooks.valid(item)){
    // Queue the wake and record notification in the same transaction.
    this.store.atomic(()=>{const current=this.store.get<WorkItem>('work',item.id)!;if(current.notify==='auto'){this.hooks.wake(current);this.put({...current,notify:'sent'})}})
   }
  }
 }
 turnStarted(ticketId:string,assignmentId:string){for(const w of this.list(ticketId).filter(w=>w.assignmentId===assignmentId&&!w.agentId&&!terminal(w)&&w.notify==='auto'))this.put({...w,deadline:undefined})}
 turnEnded(ticketId:string,assignmentId:string){
  const deadline=Date.now()+this.config.work.backgroundTimeoutMs
  for(const item of this.active(ticketId,assignmentId).filter(w=>!w.agentId))this.put({...item,deadline})
 }
 async handoff(ticketId:string,assignmentId:string){
  for(const item of this.list(ticketId).filter(w=>w.assignmentId===assignmentId&&!terminal(w))){
   if(item.kind==='agent')await this.cancel(item,'Human handoff',true)
   else if(!item.agentId){const current=this.store.get<WorkItem>('work',item.id)!;if(!terminal(current))this.put({...current,notify:'held',deadline:undefined})}
  }
 }
 private async cancel(item:WorkItem,reason:string,drop:boolean){
  if(terminal(this.store.get<WorkItem>('work',item.id)!))return
  this.put({...item,state:'cancelled',endedAt:Date.now(),error:reason,notify:drop?'dropped':item.notify})
  if(item.kind==='agent'){
   const active=this.agents.get(item.id);active?.controller.abort();await active?.promise
  }else{
   const child=this.runners.get(item.id)
   if(child?.pid){
    try{process.platform==='win32'?child.kill('SIGTERM'):process.kill(-child.pid,'SIGTERM')}catch{}
    await new Promise<void>(resolve=>{
     if(child.exitCode!==null)return resolve()
     const timer=setTimeout(()=>{try{if(child.pid)process.platform==='win32'?child.kill('SIGKILL'):process.kill(-child.pid,'SIGKILL')}catch{}resolve()},2500)
     child.once('close',()=>{clearTimeout(timer);resolve()})
    })
   }
  }
 }
 async stop(owner:WorkOwner,id:string){await this.cancel(this.own(owner,id),'Cancelled by worker',false);return this.view(this.store.get<WorkItem>('work',id)!)}
 async cancelOwned(ticketId:string,assignmentId:string,agentId:string|undefined,reason:string){
  for(const item of this.list(ticketId).filter(w=>w.assignmentId===assignmentId&&w.agentId===agentId&&!terminal(w)))await this.cancel(item,reason,true)
 }
 async endAssignment(ticketId:string,assignmentId:string){await this.cancelOwned(ticketId,assignmentId,undefined,'Assignment ended')}
 async close(){
  this.stopping=true
  for(const item of this.list().filter(w=>!terminal(w)))await this.cancel(item,'Host stopped',true)
  await Promise.allSettled([...this.agents.values()].map(a=>a.promise))
  await Promise.allSettled([...this.runners.values()].map(child=>new Promise<void>(resolve=>{
   if(child.exitCode!==null)return resolve();const timer=setTimeout(()=>{try{if(child.pid)process.kill(-child.pid,'SIGKILL')}catch{}resolve()},3000)
   child.once('close',()=>{clearTimeout(timer);resolve()})
  })))
 }
}
