import {execFileSync, type ChildProcess} from 'node:child_process'
import {createHash,randomUUID} from 'node:crypto'
import {mkdirSync,readFileSync,writeFileSync,existsSync,lstatSync,realpathSync} from 'node:fs'
import {dirname,join} from 'node:path'
import {startSandboxRunner} from './sandbox.ts'
import type {Store} from './store.ts'
import type {Config} from './config.ts'
import {projectWorkspace} from './project-code.ts'
import {hostPrivateFiles} from './private-files.ts'

export interface WorkOwner {leaseId?:string;ticketId:string;assignmentId:string;cwd:string;sandbox:'read-only'|'workspace-write';agentId?:string;depth:number;network?:boolean}
export type ResourceKey=`workspace:${string}`|`git-common:${string}`
export interface WorkItem extends WorkOwner {
 resourceKeys?:ResourceKey[]
 cancellation?:{state:'requested'|'stopped'|'unconfirmed';requestedAt:number;effects:'may_remain'}

 schedulerReleasedAt?:number;
 schedulerBackendId?:string;
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
/** A linked checkout is registered by both the worktree and the common repo. A gitfile alone grants nothing. */
function linkedGitDirectory(cwd:string){
 try{
  if(lstatSync(cwd).isSymbolicLink()||!lstatSync(join(cwd,'.git')).isFile())return
  const options={cwd,encoding:'utf8' as const,timeout:2000,stdio:['ignore','pipe','ignore'] as ['ignore','pipe','ignore']}
  const locations=execFileSync('git',['rev-parse','--path-format=absolute','--git-dir','--git-common-dir'],options).trimEnd().split('\n')
  if(locations.length!==2)return
  const [worktree,common]=locations.map(location=>realpathSync(location))
  if(dirname(worktree!)!==join(common!,'worktrees'))return
  const registered=execFileSync('git',['--git-dir='+common,'worktree','list','--porcelain','-z'],options).split('\0')
  if(registered.includes('worktree '+realpathSync(cwd)))return common
 }catch{return undefined}
}
function resourceKey(kind:'workspace'|'git-common',location:string):ResourceKey {
 return `${kind}:${createHash('sha256').update(realpathSync(location)).digest('hex')}`
}
function writeResources(cwd:string,linked?:string):ResourceKey[] {
 let common=linked
 if(!common)try{const local=join(cwd,'.git');if(lstatSync(local).isDirectory())common=local}catch{}
 return [resourceKey('workspace',cwd),...(common?[resourceKey('git-common',common)]:[])]
}
function groupStopped(pid:number|undefined){
 if(!pid||process.platform==='win32')return false
 try{process.kill(-pid,0);return false}catch(error){return (error as NodeJS.ErrnoException).code==='ESRCH'}
}
const terminal=(item:WorkItem)=>!['starting','running'].includes(item.state)
/** Work survives a model turn. A process restart interrupts work rather than silently replaying it. */
export class WorkManager {
 private agents=new Map<string,{controller:AbortController;promise:Promise<void>}>()
 private waits=new Map<string,number>()
 private runners=new Map<string,ChildProcess>()
 private stopping=false
 private cancelling=new Map<string,Promise<void>>()
  readonly recovered:Promise<void>
 readonly directory:string
 constructor(readonly store:Store,readonly config:Config,private hooks:WorkHooks){
  this.directory=join(config.stateDir,'jobs');mkdirSync(this.directory,{recursive:true,mode:0o700})
  const interrupted=this.list().filter(item=>!terminal(item))
  for(const item of interrupted){
   // The runner's parent/lock monitor kills its own process group. Never signal a stale PID here.
   this.put({...item,state:'interrupted',...(item.cancellation?{cancellation:{...item.cancellation,state:'unconfirmed'}}:{}),endedAt:Date.now(),error:'Host restarted; inspect the retained output before repeating work'})
  }
  this.recovered=(async()=>{
   const recovery=this.list().filter(w=>(w.state==='interrupted'||w.state==='cancelled'&&w.cancellation?.state==='unconfirmed')&&!w.schedulerReleasedAt)
   const release=(item:WorkItem)=>this.releaseShell(item.id)
   // Agent activations belong to the previous host process; none can still invoke
   // this new host's managed tools. Keep their uncertain outputs, not a phantom slot.
   for(const item of recovery.filter(w=>w.kind==='agent'))this.put({...item,schedulerReleasedAt:Date.now()})
   const shells=recovery.filter(w=>w.kind==='shell');if(!shells.length)return
   for(let n=0;n<35;n++){
    const waiting=shells.filter(w=>{
     // A dead runner PID (or its result file) cannot prove its descendants
     // stopped: the lock monitor lived in that runner. Probe the POSIX group;
     // never send a termination signal to a potentially reused PID/group.
      if(!groupStopped(w.pid))return true
     release(w);return false
    })
    if(!waiting.length)return
    await new Promise(r=>setTimeout(r,100))
   }
   throw Error('Previous managed command shutdown is not confirmed; inspect retained jobs before resuming')
  })()
  void this.recovered.catch(()=>{})
 }
 list(ticketId?:string){return this.store.list<WorkItem>('work').filter(w=>!ticketId||w.ticketId===ticketId)}
 private put(item:WorkItem){this.store.put('work',item.id,item);return item}
 private releaseShell(id:string,noRunner=false){
  const current=this.store.get<WorkItem>('work',id)
  if(!current||current.kind!=='shell'||!terminal(current)||current.schedulerReleasedAt||!(noRunner||groupStopped(current.pid)))return
  this.put({...current,schedulerReleasedAt:Date.now(),...(current.cancellation?{cancellation:{...current.cancellation,state:'stopped'}}:{})})
 }
 private latestActive(item:WorkItem){
  const current=this.store.get<WorkItem>('work',item.id)
  return current&&!terminal(current)&&!current.cancellation&&current.leaseId===item.leaseId?current:undefined
 }
 private assert(owner:WorkOwner){if(this.stopping||!this.hooks.valid(owner))throw Error('This assignment no longer owns work tools')}
 private matching(owner:WorkOwner,item:WorkItem){return item.ticketId===owner.ticketId&&item.assignmentId===owner.assignmentId&&item.agentId===owner.agentId}
 private own(owner:WorkOwner,id:string){this.assert(owner);const item=this.store.get<WorkItem>('work',id);if(!item||!this.matching(owner,item))throw Error('Work item is outside this worker');return item}
 private key(owner:WorkOwner,requestId:string){return owner.ticketId+':'+owner.assignmentId+':'+(owner.agentId??'root')+':'+requestId}
 private create(owner:WorkOwner,kind:WorkItem['kind'],requestId:string,body:{command?:string;prompt?:string},resourceKeys?:ResourceKey[]){
  this.assert(owner)
  const key=this.key(owner,requestId),previous=this.store.get<string>('work-request',key)
  if(previous){const item=this.own(owner,previous);if(item.kind!==kind||item.command!==body.command||item.prompt!==body.prompt)throw Error('Work request id reused with different content');return {item,fresh:false}}
  return this.store.atomic(()=>{
   if(resourceKeys?.length)for(const candidate of this.list()){
    if(candidate.kind!=='shell'||candidate.sandbox!=='workspace-write'||candidate.schedulerReleasedAt)continue
    if(terminal(candidate))this.releaseShell(candidate.id)
    const current=this.store.get<WorkItem>('work',candidate.id)!
    if(current.schedulerReleasedAt||!current.resourceKeys&&terminal(current)&&current.state!=='interrupted')continue
    // Old hosts did not persist keys: derive them only from the retained authorized cwd.
    let held=current.resourceKeys
    if(!held)try{held=writeResources(current.cwd,linkedGitDirectory(current.cwd))}catch{if(current.cwd===owner.cwd)throw Error('Previous write shutdown is unconfirmed in this workspace; inspect retained work');continue}
    if(held.some(key=>resourceKeys.includes(key)))throw Error('Another managed write holds this workspace; wait for confirmed shutdown, then reread before retrying')
   }
   const item:WorkItem={...owner,...body,...(resourceKeys?.length?{resourceKeys}:{}),id:randomUUID(),kind,state:'starting',createdAt:Date.now(),notify:'auto'}
   this.put(item);this.store.put('work-request',key,item.id);return {item,fresh:true}
  })
 }
 async shell(owner:WorkOwner,command:string,requestId:string,yieldMs=5000){
  if(this.config.work.sandboxDriver==='disabled')throw Error('Managed shell is disabled; configure a sandbox driver before requesting commands')
  if(this.config.work.sandboxDriver==='seatbelt'&&process.platform!=='darwin')throw Error('Seatbelt sandbox requires macOS')
  if(this.config.work.sandboxDriver==='bubblewrap'&&process.platform!=='linux')throw Error('Bubblewrap sandbox requires Linux')
  this.assert(owner)
  const gitDirectory=owner.cwd===projectWorkspace(this.config.stateDir,owner.ticketId)?undefined:linkedGitDirectory(owner.cwd)
  const keys=owner.sandbox==='workspace-write'?writeResources(owner.cwd,gitDirectory):undefined
  const {item,fresh}=this.create(owner,'shell',requestId,{command},keys)
  if(fresh){
   let child:ChildProcess|undefined
   try{
    const spec=join(this.directory,item.id+'.spec.json')
    const attachments=this.store.list<any>('asset').filter(a=>a.ticketId===owner.ticketId).map(a=>a.path)
    writeFileSync(spec,JSON.stringify({id:item.id,command,cwd:owner.cwd,sandbox:owner.sandbox,codex:this.config.codex,sandboxDriver:this.config.work.sandboxDriver,network:this.config.work.network&&(owner.network??true),privateState:this.config.stateDir,privatePaths:hostPrivateFiles(),gitDirectory,attachments,hostPid:process.pid,hostLock:join(this.config.stateDir,'host.lock'),directory:this.directory,maxOutputBytes:this.config.work.maxOutputBytes}),{mode:0o600,flag:'wx'})
    const running=startSandboxRunner(spec);child=running
    this.runners.set(item.id,running)
    // spawn() returns its PID synchronously when launched. Record it before yielding
    // so a concurrent stop never misses the live runner.
    this.put({...item,pid:running.pid})
    running.once('error',()=>{
     const current=this.latestActive(item)
     if(current)this.put({...current,state:'failed',endedAt:Date.now(),error:'Unable to start managed command'})
     this.releaseShell(item.id,!running.pid)
    })
    running.once('close',()=>{
     this.runners.delete(item.id)
     const current=this.latestActive(item)
     if(current&&!existsSync(join(this.directory,item.id+'.result.json')))this.put({...current,state:'interrupted',endedAt:Date.now(),error:'Managed runner exited without a durable receipt; inspect retained output before retrying'})
     this.releaseShell(item.id,!running.pid)
    })
    await new Promise<void>((resolve,reject)=>{running.once('spawn',()=>resolve());running.once('error',reject)})
    const current=this.latestActive(item)
    if(current&&this.hooks.valid(current))this.put({...current,state:'running',pid:running.pid})
    else if(current)await this.cancel(current,'Assignment ended',true)
   }catch(error){
    const current=this.latestActive(item)
    if(current)this.put({...current,state:'failed',endedAt:Date.now(),error:String(error)})
    this.releaseShell(item.id,!child?.pid)
   }
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
    const latest=this.latestActive(item)
    if(!latest||this.stopping||!this.hooks.valid(latest))return
    this.put({...latest,state:'completed',endedAt:Date.now(),threadId:result.threadId,result:result.result})
   }).catch(error=>{
    const latest=this.latestActive(item)
    if(latest&&this.hooks.valid(latest))this.put({...latest,state:controller.signal.aborted?'cancelled':'failed',endedAt:Date.now(),error:String(error).slice(0,1000)})
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
   if(!terminal(item)&&!item.cancellation&&!this.hooks.valid(item)){await this.cancel(item,'Assignment ended',true);continue}
   if(item.kind==='shell'&&!terminal(item)&&!item.cancellation){
    const path=join(this.directory,item.id+'.result.json')
    if(existsSync(path)){
     try{const result=JSON.parse(readFileSync(path,'utf8'));if(result.id!==item.id)throw Error('Runner identity mismatch');item=this.put({...item,state:result.error?'failed':result.exitCode===0?'completed':'failed',endedAt:result.endedAt,exitCode:result.exitCode,result,error:result.error})}
     catch{item=this.put({...item,state:'failed',endedAt:Date.now(),error:'Invalid managed-command result'})}
    }
   }
   if(item.kind==='shell'&&terminal(item)&&!item.schedulerReleasedAt){this.releaseShell(item.id);item=this.store.get<WorkItem>('work',item.id)!}
   if(!terminal(item)&&!item.cancellation&&item.deadline&&Date.now()>=item.deadline&&item.kind==='shell'){
    await this.cancel(item,'Background turn deadline reached',false);item=this.store.get<WorkItem>('work',item.id)!
   }
   if(terminal(item)&&item.cancellation?.state!=='unconfirmed'&&item.notify==='auto'&&!this.waits.has(item.id)&&!this.stopping&&this.hooks.valid(item)){
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
  const pending=this.cancelling.get(item.id)
  if(pending)return pending
  const latest=this.latestActive(item)
  if(!latest)return
  this.put({...latest,cancellation:{state:'requested',requestedAt:Date.now(),effects:'may_remain'},error:reason,notify:drop?'dropped':latest.notify})
  const promise=Promise.resolve().then(async()=>{
   let stopped=false
   if(latest.kind==='agent'){
    const active=this.agents.get(latest.id)
    active?.controller.abort();try{await active?.promise;stopped=true}catch{}
   }else{
    const child=this.runners.get(latest.id)
    if(child?.pid){
     const pid=child.pid
     try{process.platform==='win32'?child.kill('SIGTERM'):process.kill(-pid,'SIGTERM')}catch{}
     await new Promise<void>(resolve=>{
      const closed=()=>{clearTimeout(timer);resolve()}
      const timer=setTimeout(()=>{child.removeListener('close',closed);try{process.platform==='win32'?child.kill('SIGKILL'):process.kill(-pid,'SIGKILL')}catch{}resolve()},2500)
      child.once('close',closed)
      if(groupStopped(pid)){child.removeListener('close',closed);closed()}
     })
    }
    stopped=groupStopped(latest.pid)||!latest.pid&&!child?.pid
   }
   const current=this.store.get<WorkItem>('work',latest.id)
   if(current?.cancellation?.state==='requested'&&current.leaseId===latest.leaseId)this.put({...current,state:'cancelled',endedAt:Date.now(),cancellation:{...current.cancellation,state:stopped?'stopped':'unconfirmed'},...(stopped?{schedulerReleasedAt:Date.now()}:{})})
  }).finally(()=>{this.cancelling.delete(item.id)})
  this.cancelling.set(item.id,promise)
  return promise
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
