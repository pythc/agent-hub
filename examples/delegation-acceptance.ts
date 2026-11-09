import {spawn,type ChildProcess} from 'node:child_process'
import {mkdirSync,readFileSync,writeFileSync,openSync,existsSync} from 'node:fs'
import {join,resolve} from 'node:path'
import {createInterface} from 'node:readline'

const real=process.argv.includes('--real-model'),keep=process.argv.includes('--keep'),goal=process.argv.includes('--goal')
const arg=process.argv.slice(2).find(v=>!v.startsWith('--'))
const root=resolve(arg??'.local/delegation-acceptance-'+Date.now())
if(existsSync(root))throw Error('Use a new private acceptance directory; prior evidence is retained.')
mkdirSync(root,{recursive:true,mode:0o700})
const children:ChildProcess[]=[]
interface Host {url:string;stateDir:string;mode:string;pid:number}
async function start(role:'parent'|'child'):Promise<Host>{
 const directory=join(root,role);mkdirSync(join(directory,'files'),{recursive:true,mode:0o700})
 writeFileSync(join(directory,'files','input.txt'),'2\n',{mode:0o600})
 const file=join(directory,'config.json')
 writeFileSync(file,JSON.stringify({
  stateDir:join(directory,'state'),port:0,turnTimeoutMs:180000,
  delegation:{enabled:true,pollMs:250,leaseMs:60000},
  models:{router:'gpt-6.1-sol'},effort:'medium',work:{sandboxDriver:'disabled',network:false},
  execution:{router:{mode:'host',model:'gpt-6.1-sol',effort:'medium'},management:{enabled:true},workers:[{id:'one',backend:'codex',model:'gpt-6.1-sol',effort:'medium'}]},
  sources:[{id:'local',kind:'local',cwd:join(directory,'files'),allowedActors:['operator'],workspace:{mode:'source'},sandbox:'read-only'},
   {id:'delegation',kind:'delegation',cwd:join(directory,'files'),sandbox:'read-only',workspace:{mode:'source'}}],
 }),{mode:0o600})
 const child=spawn(process.execPath,['--import','tsx','examples/delegation-host.ts',file,role,...(real?['--real-model']:[]),...(goal?['--goal']:[])],{
  cwd:process.cwd(),stdio:['ignore','pipe',openSync(join(directory,'stderr.log'),'w',0o600)],
 })
 children.push(child)
 return new Promise((resolve,reject)=>{
  const lines=createInterface({input:child.stdout!})
  const timer=setTimeout(()=>reject(Error('Acceptance host startup timed out')),20000)
  child.once('exit',code=>{clearTimeout(timer);reject(Error('Acceptance host exited: '+code))})
  lines.once('line',line=>{clearTimeout(timer);try{resolve(JSON.parse(line))}catch{reject(Error('Invalid acceptance host startup result'))}})
 })
}
async function call(host:Host,path:string,body?:unknown){
 const token=readFileSync(join(host.stateDir,'access-token'),'utf8').trim()
 const response=await fetch(host.url+path,{method:body===undefined?'GET':'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json',origin:host.url},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(10000)})
 const data=await response.json() as any
 if(!response.ok)throw Error('Acceptance API '+path+' rejected: '+response.status+' '+String(data.code??data.error))
 return data
}
let closing=false
async function close(){
 if(closing)return;closing=true
 await Promise.all(children.map(child=>new Promise<void>(resolve=>{
  if(child.exitCode!==null)return resolve()
  child.once('exit',()=>resolve());child.kill('SIGTERM')
  setTimeout(()=>{if(child.exitCode===null)child.kill('SIGKILL');resolve()},10000).unref()
 })))
}
process.once('SIGTERM',()=>void close());process.once('SIGINT',()=>void close())
try{
 const parent=await start('parent'),child=await start('child')
 const before=await call(child,'/deployments')
 const ticket=await call(child,'/deployments/pairing',{expectedRevision:before.revision,policy:{workerIds:['one']}})
 const parentBefore=await call(parent,'/deployments')
 const connection=await call(parent,'/deployments/connect',{ticket,label:'Isolated child team',expectedRevision:parentBefore.revision})
 if(goal){
  await call(parent,'/router-scopes',{action:'scope.put',operationId:'goal-scope',expectedRevision:0,scope:{id:'acceptance',tenantId:'owner',name:'Acceptance team',managers:[JSON.stringify(['local','operator'])],workerIds:['one'],teamTargetIds:[connection.id],sourceIds:['local'],backendIds:['codex']}})
  await call(parent,'/router-scopes',{action:'entry.bind',operationId:'goal-entry',expectedRevision:0,scopeId:'acceptance',sourceId:'local',accountNamespace:'local',nativeId:'acceptance',history:'group'})
 }
 await call(parent,'/request',{requestId:'acceptance-root',discussion:'acceptance',text:goal?
  'Use a structured goal with independent acceptance to check the connected child team actual file input.txt. Use router_goal start with a node containing teamTargetId, and criteria declaring input.txt plus a text_contains check for 2 followed by a newline. The child must read the actual file and capture its bytes. The host schedules the remote node and runs independent node and overall acceptance. Do not manually assign local Workers, call team_delegate assign/accept, or repeatedly poll. Return an empty reply after starting the goal; the host publishes the final independent acceptance result. Do not perform external writes.':
  'Use the connected independent child team via team_delegate. Delegate checking the file input.txt and 1+1. Request input.txt as an artifact. Its exact expected content is 2 followed by a newline. Inspect the actual returned artifact and Worker result; use team_delegate accept only after confirming the value. Do not repeatedly poll; wait for the result wake. After parent review, reply exactly DELEGATION_VERIFIED_2. Do not use local Workers or perform external writes.'})
 const started=Date.now(),deadline=started+(real?360000:15000)
 let snapshot:any,status:any
 while(Date.now()<deadline){
  snapshot=await call(parent,'/deployments');status=await call(parent,'/status')
  if(snapshot.outbound[0]?.acceptance==='passed'&&(!goal||snapshot.goals[0]?.state==='completed')&&status.deliveries?.some((d:any)=>d.status==='sent'&&d.text?.includes(goal?'已通过独立验收':'DELEGATION_VERIFIED_2')))break
  await new Promise(r=>setTimeout(r,250))
 }
 const ok=snapshot?.outbound[0]?.acceptance==='passed'&&(!goal||snapshot.goals[0]?.state==='completed')&&status?.deliveries?.some((d:any)=>d.status==='sent'&&d.text?.includes(goal?'已通过独立验收':'DELEGATION_VERIFIED_2'))
 const evidence={passed:!!ok,mode:real?'real-model':'fixture',acceptance:goal?'independent-goal':'parent-review',checkedAt:new Date().toISOString(),elapsedMs:Date.now()-started,processes:{parent:parent.pid,child:child.pid},parent:await call(parent,'/deployments'),child:await call(child,'/deployments'),parentStatus:status,childStatus:await call(child,'/status')}
 writeFileSync(join(root,'result.json'),JSON.stringify(evidence,null,2),{mode:0o600})
 if(!ok)throw Error('Delegation acceptance failed; inspect the private result and host logs.')
 const username='delegation-preview',password='Roppo-delegation-preview-2026!'
 await call(parent,'/account/setup',{username,displayName:'Delegation preview',password,remember:true})
 writeFileSync(join(root,'browser.json'),JSON.stringify({base:parent.url,username,password,childBase:child.url,goal}),{mode:0o600})
 console.log(JSON.stringify({passed:true,mode:evidence.mode,evidence:join(root,'result.json'),browser:keep?join(root,'browser.json'):null}))
 if(keep)await new Promise<void>(resolve=>{process.once('SIGTERM',resolve);process.once('SIGINT',resolve)})
}catch(error){
 const message=error instanceof Error?error.message:'Acceptance failed'
 writeFileSync(join(root,'failure.json'),JSON.stringify({passed:false,mode:real?'real-model':'fixture',at:new Date().toISOString(),message}),{mode:0o600})
 console.error(message);process.exitCode=1
}finally{await close()}
