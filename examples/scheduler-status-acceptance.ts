/** Real cloud-local scheduler/browser fixture. Deterministic held Model, no provider calls. */
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs'
import {join,resolve} from 'node:path'
import {randomUUID} from 'node:crypto'
import {Runtime} from '../src/runtime.ts'
import {configSchema} from '../src/config.ts'
import {serve} from '../src/server.ts'
import type {Model} from '../src/model.ts'

const root=resolve(process.argv[2]??'.local/scheduler-status-acceptance'),cwd=join(root,'workspace')
mkdirSync(cwd,{recursive:true,mode:0o700})
if(existsSync(join(root,'browser.json')))throw Error('Use a fresh private acceptance directory')
const releases:Array<()=>void>=[]
let workerCalls=0
const model:Model={async run(request){
 if(request.ephemeral){
  const input=JSON.parse(request.input)
  return {threadId:'local-router-'+randomUUID(),turnId:randomUUID(),text:JSON.stringify({action:input.trigger?'ignore':'accept',title:'Local scheduler fixture',scope:'Complete only this deterministic local fixture',reason:'Explicit local acceptance request',rules:[],ruleAssessments:[],targetTicketId:null})}
 }
 if(request.role!=='worker')throw Error('Unexpected model role: fixture cannot call a provider')
 const call=++workerCalls,threadId=request.threadId??'local-worker-'+call,turnId='local-turn-'+call
 request.onThread?.(threadId);request.onTurn?.(turnId)
 await new Promise<void>(done=>{releases[call-1]=done;request.signal?.addEventListener('abort',()=>done(),{once:true})})
 request.signal?.throwIfAborted()
 return {threadId,turnId,text:JSON.stringify({state:'ready',summary:'Deterministic local work completed.',reply:'Local fixture result.',question:null,handbacks:[]})}
}}
const config=configSchema.parse({stateDir:join(root,'state'),port:0,acceptMode:'auto',concurrency:1,work:{sandboxDriver:'disabled',autoRecover:false},execution:{workers:[{id:'worker-1',backend:'codex'}]},sources:[{id:'local',kind:'local',cwd,allowedActors:['operator']}]})
const runtime=new Runtime(config,{model})
async function until(predicate:()=>boolean){
 const deadline=Date.now()+20000
 while(!predicate()){await runtime.tick();if(Date.now()>deadline)throw Error('Deterministic scheduler fixture did not settle');await new Promise(done=>setTimeout(done,5))}
}
try{
 runtime.receive('local','operator',{id:'scheduler-first',thread:'scheduler-first',text:'Run the first deterministic local fixture.',addressed:true})
 await until(()=>workerCalls===1&&runtime.schedulerStatus().occupancy.controllers===1)
 runtime.receive('local','operator',{id:'scheduler-second',thread:'scheduler-second',text:'Run the second deterministic local fixture separately.',addressed:true})
 // Existing admission may hold the second task at start before creating its execute job.
 await until(()=>runtime.store.jobs().some(job=>['start','execute'].includes(job.kind))&&runtime.schedulerStatus().queue.ready===1&&runtime.schedulerStatus().occupancy.workerJobs===1)
 if(workerCalls!==1)throw Error('Second Worker started before capacity became free')
}catch(error){releases.forEach(release=>release());await runtime.close();throw error}
const host=await serve(runtime),token=readFileSync(host.tokenPath,'utf8').trim()
const response=await fetch(host.url+'/account/setup',{method:'POST',headers:{authorization:'Bearer '+token,origin:host.url,'content-type':'application/json'},body:JSON.stringify({username:'scheduler-preview',displayName:'Local scheduler acceptance',password:'Local-'+randomUUID()+'A!',remember:true})})
if(!response.ok)throw Error('Could not create isolated fixture account')
const mode='actual local Runtime scheduler, one held deterministic Worker and one genuinely queued task; no provider or third-party calls'
const evidence:Array<{stage:string;workerCalls:number;pendingTaskKinds:string[];status:ReturnType<Runtime['schedulerStatus']>}>=[]
function retain(stage:string){const item={stage,workerCalls,pendingTaskKinds:runtime.store.jobs().filter(job=>['start','execute'].includes(job.kind)).map(job=>job.kind),status:runtime.schedulerStatus()};evidence.push(item);writeFileSync(join(root,'scheduler-evidence.json'),JSON.stringify({mode,observations:evidence},null,2),{mode:0o600});return item}
retain('first_running_second_queued')
writeFileSync(join(root,'browser.json'),JSON.stringify({base:host.url,url:host.url+'/configure#execution',cookie:response.headers.get('set-cookie')!.split(';')[0]!,mode}),{mode:0o600})
let current='',busy=false,closing=false
const control=setInterval(()=>{if(busy||closing)return;void (async()=>{
 try{
  const path=join(root,'control.json');if(!existsSync(path))return
  const raw=readFileSync(path,'utf8');if(raw===current||raw.length>1024)return
  current=raw;const command=JSON.parse(raw)
  if(typeof command.id!=='string'||!/^[a-f0-9-]{36}$/.test(command.id)||!['pause','advance','finish'].includes(command.action))return
  busy=true
  if(command.action==='pause'){runtime.pause(true);await runtime.tick();if(workerCalls!==1||runtime.schedulerStatus().occupancy.controllers!==1)throw Error('Pause unexpectedly stopped existing work')}
  else if(command.action==='advance'){
   runtime.pause(false);releases[0]!()
   await until(()=>workerCalls===2&&runtime.schedulerStatus().queue.ready===0&&runtime.schedulerStatus().occupancy.workerJobs===1&&runtime.store.tickets.list().some(ticket=>!!ticket.ended))
  }else{
   releases[1]!();await until(()=>runtime.schedulerStatus().occupancy.jobs===0&&runtime.schedulerStatus().occupancy.controllers===0&&runtime.schedulerStatus().queue.ready===0&&runtime.store.tickets.list().every(ticket=>!!ticket.ended))
  }
  const item=retain(command.action);writeFileSync(join(root,'control-result.json'),JSON.stringify({id:command.id,result:'ok',...item}),{mode:0o600})
 }catch{writeFileSync(join(root,'control-failed.json'),JSON.stringify({result:'fixture_control_failed'}),{mode:0o600})}
 finally{busy=false}
 })()},50)
console.log(JSON.stringify({url:host.url+'/configure#execution',mode}))
async function close(){if(closing)return;closing=true;clearInterval(control);host.server.closeAllConnections();await new Promise<void>(done=>host.server.close(()=>done()));await host.closeRuntime()}
process.once('SIGTERM',()=>void close());process.once('SIGINT',()=>void close())
