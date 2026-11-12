import {execFile,execFileSync,spawn} from 'node:child_process'
import {existsSync,readFileSync,writeFileSync,openSync,closeSync,readSync,mkdirSync,mkdtempSync,realpathSync,renameSync,rmSync} from 'node:fs'
import {dirname,join} from 'node:path'
import {tmpdir} from 'node:os'
import {promisify} from 'node:util'
import {randomUUID} from 'node:crypto'
import type {Config,ProjectPolicy,SourceConfig} from './config.ts'
import type {RouterGoal} from './router-goals.ts'
import type {GoalNode} from './goal-contract.ts'
import type {GoalDelivery} from './goal-verification.ts'
import type {Store,Run} from './store.ts'
import {sandboxCommand,sandboxEnvironment,startSandboxRunner} from './sandbox.ts'
import {hostPrivateFiles} from './private-files.ts'
import {stableDigest} from './sources.ts'

export interface ProjectReview {id:string;head:string;roundId:string;deliveryId:string;at:number;state:'pending'|'approved'|'returned';by?:string;feedback?:string;decidedAt?:number}
export interface GoalProject {base:string;sourceId:string;integration:string;policy:ProjectPolicy;review?:ProjectReview;reviewWaitMs:number;triggerIds:string[]}
export interface CodeReceipt {id:string;goalId:string;ticketId:string;head?:string;parents:string[];error?:string;test?:{command:string;exit:number;output:string};diffStat?:string;diff?:{text:string;truncated:boolean}}
const exec=promisify(execFile)
const gitFlags=['--no-replace-objects','-c','core.hooksPath=/dev/null','-c','core.fsmonitor=false','-c','protocol.allow=never','-c','protocol.file.allow=always']
const quote=(s:string)=>"'"+s.replaceAll("'","'\"'\"'")+"'"
const git=['git',...gitFlags].map(quote).join(' ')
const cleanGit={PATH:process.env.PATH,LANG:'C',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_TERMINAL_PROMPT:'0'}
const commit=(s:string)=>{const sha=s.trim();if(!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(sha))throw Error('Git did not return a full commit ID');return sha}
const ref=(head:string)=>'refs/heads/commits/'+commit(head)
const compact=(value:string)=>value.slice(-4000)
const leafIds=(nodes:GoalNode[])=>nodes.filter(n=>!nodes.some(child=>child.dependsOn.includes(n.id))).map(n=>n.id)

export function startCodeProject(source:SourceConfig,g:RouterGoal){
 const policy=source.workspace?.project
 if(!policy||!g.nodes?.length)return
 if(g.nodes.some(n=>!n.workerId))throw Error('A code project uses Workers on this host')
 const root=execFileSync('git',[...gitFlags,'rev-parse','--show-toplevel'],{cwd:source.cwd,encoding:'utf8',env:cleanGit,timeout:10000}).trim()
 if(realpathSync(source.cwd)!==realpathSync(root))throw Error('Code project cwd must be the repository root')
 const base=commit(execFileSync('git',[...gitFlags,'rev-parse','--verify','HEAD^{commit}'],{cwd:source.cwd,encoding:'utf8',env:cleanGit,timeout:10000}))
 const leaves=leafIds(g.nodes)
 let integration=leaves[0]!
 if(leaves.length>1){
  const workerId=g.nodes.find(n=>n.id===leaves.at(-1))!.workerId
  integration='integration'
  while(g.nodes.some(n=>n.id===integration))integration+='-final'
  g.nodes.push({id:integration,title:'Integrate and test the project',instruction:'Integrate the accepted commits, resolve conflicts, and deliver one clean commit satisfying the original acceptance criteria.',workerId,dependsOn:leaves,criterionIds:g.criteria.map(c=>c.id),state:'pending',repairs:0,recoveries:0})
 }
 g.project={base,sourceId:source.id,integration,policy:structuredClone(policy),reviewWaitMs:0,triggerIds:[g.triggerId]}
}

/** Every accepted branch, including new branches introduced by replanning, must reach the tested commit. */
export function checkProjectGraph(g:RouterGoal,nodes:GoalNode[]){
 if(!g.project)return
 const leaves=leafIds(nodes)
 if(leaves.length!==1||leaves[0]!==g.project.integration)throw Error('Every code project step must feed the final integration step')
}

interface GitOptions {gitDirectory?:string;attachments?:string[];outputFile?:string;signal:AbortSignal;timeout:number}
async function sandboxGit(config:Config,cwd:string,command:string,o:GitOptions){
 o.signal.throwIfAborted()
 const scratch=mkdtempSync(join(tmpdir(),'roppo-project-'))
 let fd:number|undefined
 try{
  const launch=sandboxCommand({sandboxDriver:config.work.sandboxDriver,codex:config.codex,cwd,sandbox:'workspace-write',privateState:config.stateDir,privatePaths:hostPrivateFiles(),gitDirectory:o.gitDirectory,attachments:o.attachments,network:false,command,scratch})
  if(o.outputFile)fd=openSync(o.outputFile,'wx',0o600)
  const signal=AbortSignal.any([o.signal,AbortSignal.timeout(o.timeout)])
  const env={...sandboxEnvironment(scratch,launch.developerBin),GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_TERMINAL_PROMPT:'0'}
  return await new Promise<{exit:number;output:string}>((resolve,reject)=>{
   const child=spawn(launch.command,launch.args,{cwd,env,stdio:['ignore',fd??'pipe','pipe'],detached:true})
   const kill=()=>{if(child.pid)try{process.kill(-child.pid,'SIGKILL')}catch{}}
   let output=''
   const collect=(part:Buffer)=>{output=(output+part.toString()).slice(-16000)}
   child.stdout?.on('data',collect);child.stderr?.on('data',collect)
   signal.addEventListener('abort',kill,{once:true});if(signal.aborted)kill()
   child.once('error',reject)
   child.once('close',code=>{signal.removeEventListener('abort',kill);kill();if(signal.aborted)reject(signal.reason);else resolve({exit:code??-1,output:output.trim()})})
  })
 }finally{if(fd!==undefined)closeSync(fd);rmSync(scratch,{recursive:true,force:true})}
}
/** Use the ordinary supervised runner so a host crash also stops a long-running integration test. */
async function integratedTest(config:Config,cwd:string,command:string,signal:AbortSignal){
 const deadline=AbortSignal.any([signal,AbortSignal.timeout(config.work.backgroundTimeoutMs)])
 deadline.throwIfAborted()
 const directory=mkdtempSync(join(dirname(cwd),'runner-'))
 try{
  const spec=join(directory,'test.json')
  writeFileSync(spec,JSON.stringify({id:'test',directory,command,cwd,sandbox:'workspace-write',codex:config.codex,sandboxDriver:config.work.sandboxDriver,network:config.work.network,privateState:config.stateDir,privatePaths:hostPrivateFiles(),hostPid:process.pid,hostLock:join(config.stateDir,'host.lock'),maxOutputBytes:config.work.maxOutputBytes}),{mode:0o600})
  const runner=startSandboxRunner(spec)
  const stop=()=>{if(runner.pid)try{process.kill(process.platform==='win32'?runner.pid:-runner.pid,'SIGKILL')}catch{}}
  try{
   await new Promise<void>((resolve,reject)=>{
    runner.once('error',reject)
    runner.once('close',()=>resolve())
    deadline.addEventListener('abort',stop,{once:true})
    if(deadline.aborted)stop()
   })
   deadline.throwIfAborted()
   const result=JSON.parse(readFileSync(join(directory,'test.result.json'),'utf8'))
   if(result.error)throw Error(result.error)
   const output=readFileSync(join(directory,'test.output'),'utf8').trim()
   return {exit:result.exitCode??-1,output:compact(output)+(result.droppedBytes?' [additional output truncated]':'')}
  }finally{deadline.removeEventListener('abort',stop);stop()}
 }finally{rmSync(directory,{recursive:true,force:true})}
}
const checked=(r:{exit:number;output:string})=>{if(r.exit!==0)throw Error(compact(r.output)||'Git command exited '+r.exit);return r.output}
const hostGit=async(cwd:string,args:string[],signal:AbortSignal)=>(await exec('git',[...gitFlags,...args],{cwd,env:cleanGit,encoding:'utf8',signal,timeout:120000,maxBuffer:8*1024*1024})).stdout.trim()

export const projectWorkspace=(stateDir:string,ticketId:string)=>join(stateDir,'work',stableDigest(['code-project',ticketId]))
export class ProjectCode {
 private ready=new Set<string>()
 private preparing=new Map<string,Promise<void>>()
 private checks=new Map<string,{controller:AbortController;done:Promise<void>;goalId:string}>()
 private shutdown=new AbortController()
 constructor(private config:Config,private store:Store){}
 directory(g:RouterGoal){return join(this.config.stateDir,'code-projects',stableDigest(g.id))}
 workspace(ticketId:string){return projectWorkspace(this.config.stateDir,ticketId)}
 private pack(g:RouterGoal,head:string){return join(this.directory(g),commit(head)+'.bundle')}
 private bare(g:RouterGoal){return join(this.directory(g),'objects.git')}
 receipt(id:string){return this.store.get<CodeReceipt>('project-commit',id)}
 private async baseline(g:RouterGoal){
  const p=g.project!,dir=this.directory(g),bundle=this.pack(g,p.base),bare=this.bare(g)
  if(this.ready.has(g.id))return
  const inflight=this.preparing.get(g.id);if(inflight)return inflight
  const signal=this.shutdown.signal
  const job=(async()=>{
   mkdirSync(dir,{recursive:true,mode:0o700});mkdirSync(bare,{recursive:true})
   await hostGit(bare,['init','--bare','--template=',...(p.base.length===64?['--object-format=sha256']:[])],signal)
   const source=this.config.sources.find(s=>s.id===p.sourceId)!
   if(existsSync(bundle)){await hostGit(bare,['fetch','--no-tags',bundle,ref(p.base)+':'+ref(p.base)],signal);return}
   await hostGit(bare,['fetch','--no-tags',source.cwd,p.base+':'+ref(p.base)],signal)
   const temp=bundle+'.'+randomUUID()
   try{await hostGit(bare,['bundle','create',temp,ref(p.base)],signal);renameSync(temp,bundle)}finally{rmSync(temp,{force:true})}
  })()
  this.preparing.set(g.id,job)
  try{
   await job
   this.store.put('project-base',g.id,{goalId:g.id,head:p.base})
   this.ready.add(g.id)
  }finally{this.preparing.delete(g.id)}
 }
 parents(g:RouterGoal,n:GoalNode){
  return [...new Set([g.project!.base,...n.dependsOn.map(id=>{
   const dep=g.nodes!.find(candidate=>candidate.id===id)!,delivery=this.store.get<GoalDelivery>('goal-delivery',dep.ticketId!)
   const saved=delivery&&this.receipt(delivery.id)
   if(dep.state!=='passed'||!saved?.head||saved.error)throw Error('Accepted commit unavailable for prerequisite '+id)
   return saved.head
  })])]
 }
 async prepare(g:RouterGoal,n:GoalNode,signal:AbortSignal){
  await this.baseline(g)
  const cwd=this.workspace(n.ticketId!),base=g.project!.base,parents=this.parents(g,n)
  const prior=this.store.db.prepare("SELECT json_extract(body,'$.head') AS head FROM records WHERE kind='project-commit' AND json_extract(body,'$.ticketId')=? AND json_extract(body,'$.head') IS NOT NULL ORDER BY rowid DESC LIMIT 1").get(n.ticketId!)
  const resumeHead=prior?commit(String(prior.head)):base
  const inputs=[...new Set([...parents,resumeHead])],files=inputs.map(head=>this.pack(g,head))
  mkdirSync(cwd,{recursive:true,mode:0o700})
  const fetch=(head:string)=>git+' fetch -q --no-tags '+quote(this.pack(g,head))+' '+ref(head)+':refs/project/'+head
  const lines=['set -e','if [ ! -d .git ]; then',git+' init -q --template= '+(base.length===64?'--object-format=sha256':''),'fi',git+' config user.name '+quote(this.config.delivery.commitName),git+' config user.email '+quote(this.config.delivery.commitEmail),...inputs.map(fetch),
   'if ! '+git+' rev-parse --verify HEAD >/dev/null 2>&1; then '+git+' checkout -q -B project refs/project/'+resumeHead+'; fi',
   'if '+git+' rev-parse -q --verify MERGE_HEAD >/dev/null; then echo "Resolve the pending merge and commit it."; exit 0; fi']
  for(const head of parents.slice(1))lines.push('if ! '+git+' merge-base --is-ancestor '+head+' HEAD; then', 'if ! '+git+' merge --no-edit '+head+'; then', 'if '+git+' rev-parse -q --verify MERGE_HEAD >/dev/null; then echo "Resolve this merge and then merge remaining prerequisite commits."; exit 0; fi','exit 1','fi','fi')
  const output=checked(await sandboxGit(this.config,cwd,lines.join('\n'),{attachments:files,timeout:120000,signal}))
  return {cwd,base,prerequisites:parents.slice(1),git:output,testCommand:g.project!.policy.testCommand,integration:n.id===g.project!.integration}
 }
 /** Poll by immutable proposal. A slow test never blocks the host scheduler or another goal. */
 check(g:RouterGoal,n:GoalNode,d:GoalDelivery):CodeReceipt|undefined{
  const previous=this.receipt(d.id);if(previous||this.checks.has(d.id))return previous
  const controller=new AbortController(),signal=AbortSignal.any([controller.signal,this.shutdown.signal])
  const parents=this.parents(g,n)
  const done=this.capture(g,n,d,parents,signal).then(result=>{if(!signal.aborted)this.store.put('project-commit',d.id,result)},error=>{
   if(!signal.aborted)this.store.put('project-commit',d.id,{id:d.id,goalId:g.id,ticketId:d.ticketId,parents,error:compact(String(error))} satisfies CodeReceipt)
  }).finally(()=>{this.checks.delete(d.id)})
  this.checks.set(d.id,{controller,done,goalId:g.id})
 }
 private async capture(g:RouterGoal,n:GoalNode,d:GoalDelivery,parents:string[],signal:AbortSignal):Promise<CodeReceipt>{
  await this.baseline(g)
  const p=g.project!,bare=this.bare(g),cwd=this.workspace(d.ticketId),opts={signal,timeout:120000},dir=this.directory(g)
  const run=this.store.get<Run>('run',d.ticketId)
  if(run?.cwd!==cwd)throw Error('Project delivery workspace changed')
  const head=commit(checked(await sandboxGit(this.config,cwd,['set -e','if [ -n "$('+git+' status --porcelain=v1 --untracked-files=all)" ] || '+git+' rev-parse -q --verify MERGE_HEAD >/dev/null; then echo "Commit all project changes and resolve the pending merge before reporting ready."; exit 1; fi',git+' rev-parse --verify HEAD^{commit}'].join('\n'),opts)))
  if(head!==p.base){
   const imported=join(dir,randomUUID()+'.incoming')
   try{
    checked(await sandboxGit(this.config,cwd,git+' bundle create - HEAD ^'+p.base,{...opts,outputFile:imported}))
    const observed=await hostGit(bare,['bundle','list-heads',imported,'HEAD'],signal)
    if(observed.split(/\s+/)[0]!==head)throw Error('Workspace HEAD changed while exporting its bundle')
    await hostGit(bare,['-c','fetch.fsckObjects=true','fetch','--no-tags',imported,'HEAD:'+ref(head)],signal)
   }finally{rmSync(imported,{force:true})}
  }
  for(const parent of parents)try{await hostGit(bare,['merge-base','--is-ancestor',parent,head],signal)}catch{throw Error('Deliver a commit containing prerequisite '+parent+'; merge refs/project/'+parent+' and resolve conflicts.')}
  if(!existsSync(this.pack(g,head))){
   const temp=join(dir,randomUUID()+'.bundle')
   try{await hostGit(bare,['bundle','create',temp,ref(head),'^'+p.base],signal);renameSync(temp,this.pack(g,head))}finally{rmSync(temp,{force:true})}
  }
  const result:CodeReceipt={id:d.id,goalId:g.id,ticketId:d.ticketId,head,parents}
  const diffArgs=['diff','--no-ext-diff','--no-textconv'],patch=join(dir,head+'.patch')
  if(!existsSync(patch)){
   const temp=patch+'.'+randomUUID()
   try{await hostGit(bare,[...diffArgs,'--binary','--output='+temp,p.base,head,'--'],signal);renameSync(temp,patch)}finally{rmSync(temp,{force:true})}
  }
  const fd=openSync(patch,'r'),preview=Buffer.alloc(6001)
  try{const size=readSync(fd,preview,0,preview.length,null);result.diff={text:preview.subarray(0,Math.min(size,6000)).toString(),truncated:size>6000}}finally{closeSync(fd)}
  result.diffStat=compact(await hostGit(bare,[...diffArgs,'--stat',p.base,head,'--'],signal))
  if(n.id!==p.integration)return result
  const clean=mkdtempSync(join(dir,'test-'))
  try{
   const packs=[...new Set([p.base,head])],setup=[git+' init -q --template= '+(p.base.length===64?'--object-format=sha256':''),...packs.map(sha=>git+' fetch -q --no-tags '+quote(this.pack(g,sha))+' '+ref(sha)+':refs/project/'+sha),git+' checkout --detach -q '+head]
   checked(await sandboxGit(this.config,clean,setup.join(' && '),{...opts,attachments:packs.map(sha=>this.pack(g,sha))}))
   // Compare the checkout's actual bytes, modes and symlink targets across the test, including files with Git checkout conversions.
   // A fresh index uses the proposed commit's tracked paths. Its private attributes disable clean filters controlled by the test.
   const fingerprint=async()=>{
    const reference=git+' -c core.filemode=true --git-dir="$TMPDIR/verification.git" --work-tree='+quote(clean)
    const commands=['set -e','test "$('+git+' rev-parse HEAD)" = '+head+' || { echo "The test changed HEAD"; exit 1; }',
     git+' init --bare -q --template= '+(head.length===64?'--object-format=sha256 ':'')+'"$TMPDIR/verification.git"',
     'mkdir -p "$TMPDIR/verification.git/info"',
     'printf "%s\\n" '+quote('* -text -crlf -filter -ident !working-tree-encoding !eol')+' > "$TMPDIR/verification.git/info/attributes"',
     'printf "%s\\n" '+quote(JSON.stringify(join(bare,'objects')))+' > "$TMPDIR/verification.git/objects/info/alternates"',
     reference+' read-tree '+head,reference+' add --update --',reference+' write-tree']
    const output=checked(await sandboxGit(this.config,clean,commands.join('\n'),{...opts,gitDirectory:bare}))
    return commit(output.split('\n').at(-1)!)
   }
   const before=await fingerprint()
   const test=await integratedTest(this.config,clean,p.policy.testCommand,signal)
   result.test={command:p.policy.testCommand,exit:test.exit,output:compact(test.output)}
   if(test.exit!==0){result.error='Integrated test failed at '+head+' (exit '+test.exit+'). '+compact(test.output);return result}
   if(await fingerprint()!==before)throw Error('The test changed tracked code')
   return result
  }finally{rmSync(clean,{recursive:true,force:true})}
 }
 blob(g:RouterGoal,head:string,path:string,limit:number){
  const opts={cwd:this.bare(g),env:cleanGit,timeout:10000}
  const tree=execFileSync('git',[...gitFlags,'--literal-pathspecs','ls-tree','-l','-z',commit(head),'--',path],{...opts,encoding:'utf8'})
  if(!tree)return
  const match=/^100(?:644|755) blob ([a-f0-9]+)\s+(\d+)\t/.exec(tree)
  if(!match||Number(match[2])>limit)throw Error('Project evidence must be a committed regular file within its artifact size limit')
  return execFileSync('git',[...gitFlags,'cat-file','blob',match[1]!],{...opts,maxBuffer:limit+1})
 }
 file(g:RouterGoal,kind:'bundle'|'patch'){return join(this.directory(g),commit(g.project!.review!.head)+'.'+kind)}
 async stop(goalId:string){
  const checks=[...this.checks.values()].filter(check=>check.goalId===goalId)
  for(const check of checks)check.controller.abort()
  await Promise.allSettled([this.preparing.get(goalId),...checks.map(check=>check.done)])
 }
 async close(){this.shutdown.abort();await Promise.allSettled([...this.preparing.values(),...[...this.checks.values()].map(c=>c.done)])}
}
