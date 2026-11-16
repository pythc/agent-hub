/** Cloud-local real Runtime/goal dispatch/GET fixture. No provider, tool, external message or native CLI execution. */
import {execFileSync} from 'node:child_process'
import {createHash,randomUUID} from 'node:crypto'
import {existsSync,mkdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs'
import {join,resolve} from 'node:path'
import {Runtime} from '../src/runtime.ts'
import {configSchema} from '../src/config.ts'
import {serve} from '../src/server.ts'
import type {RouterGoal} from '../src/router-goals.ts'
import type {RouterRoute} from '../src/router-scope.ts'
const root=resolve(process.argv[2]??'.local/task-contract-acceptance'),cwd=join(root,'workspace')
mkdirSync(cwd,{recursive:true,mode:0o700});if(existsSync(join(root,'browser.json')))throw Error('Use a fresh private acceptance directory')
const git=['-c','core.hooksPath=/dev/null','-c','commit.gpgsign=false'],gitEnv={PATH:process.env.PATH,LANG:'C',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_TERMINAL_PROMPT:'0'}
execFileSync('git',[...git,'init','-b','main'],{cwd,env:gitEnv,stdio:'ignore'});execFileSync('git',[...git,'-c','user.name=Local acceptance','-c','user.email=fixture@localhost','commit','--allow-empty','-m','Local fixture baseline'],{cwd,env:gitEnv,stdio:'ignore'})
let modelCalls=0,closing=false
const runtime=new Runtime(configSchema.parse({stateDir:join(root,'state'),port:0,acceptMode:'auto',watchdog:{enabled:false},work:{sandboxDriver:'disabled',autoRecover:false},execution:{router:{mode:'host'},management:{enabled:true,maxWorkers:1},workers:[{id:'one',label:'Local analysis',backend:'codex'}]},sources:[{id:'local',kind:'local',cwd,sandbox:'workspace-write',allowedActors:['alice'],workspace:{mode:'directory',project:{testCommand:'true',budget:{maxMinutes:30,cost:{maxUsd:5,inputUsdPerMillion:1,outputUsdPerMillion:2}}}}}]}),{model:{async run(){modelCalls++;throw Error('Model calls are forbidden in this display fixture')}}})
runtime.scopes.command({action:'scope.put',operationId:'scope',expectedRevision:0,scope:{id:'team',tenantId:'org',name:'Local fixture',contextBytes:128000,managers:[JSON.stringify(['local','alice'])],workerIds:['one'],sourceIds:['local'],backendIds:['codex']}})
runtime.scopes.command({action:'entry.bind',operationId:'entry',expectedRevision:0,scopeId:'team',sourceId:'local',accountNamespace:'local',nativeId:'topic',history:'group'})
const received=runtime.receive('local','alice',{id:'managed-request',thread:'topic',scope:'topic',text:'Continuously analyze and verify the local project. Do not edit or deploy.',addressed:true})as {triggerId:string},trigger=runtime.store.triggers.get(received.triggerId)!,context=runtime.scopes.context(trigger,'local:topic')!
const goal=runtime.goals.command({action:'start',operationId:'managed-goal',expectedRevision:0,objective:'Analyze the local project without changing files',authorizationQuote:'Continuously analyze and verify',criteria:[{id:'findings',description:'Explain the main findings',files:['analysis.md']},{id:'limitations',description:'State what remains unverified',files:['analysis.md']}],nodes:[{id:'analysis',title:'Analyze',instruction:'Prepare the requested analysis only. Do not change files or contact external services.',workerId:'one',criterionIds:['findings','limitations']}],budget:{maxMinutes:30,maxUsd:5}},context)as RouterGoal
// Use the existing host goal scheduler to produce the real task association.
await runtime.goals.advance()
const managed=runtime.goals.get(goal.id)!.taskIds[0];if(!managed)throw Error('Goal did not dispatch a local task')
const managedId:string=managed
const ordinaryInput=runtime.receive('local','alice',{id:'ordinary-request',thread:'topic',scope:'topic',text:'Summarize this short local note.',addressed:true})as {triggerId:string},ordinaryTrigger=runtime.store.triggers.get(ordinaryInput.triggerId)!,ordinaryContext=runtime.scopes.context(ordinaryTrigger,'local:topic')!
const ordinary=await runtime.manager.call({action:'assign',id:'one',revision:runtime.settings.current().revision,requestId:'ordinary-task',text:'Summarize this short local note.'},{discussion:'local:topic',trigger:ordinaryTrigger,scoped:ordinaryContext})
runtime.pause(true)
const host=await serve(runtime);clearInterval((runtime as unknown as {timer:ReturnType<typeof setInterval>}).timer)
const token=readFileSync(host.tokenPath,'utf8').trim(),setup=await fetch(host.url+'/account/setup',{method:'POST',headers:{authorization:'Bearer '+token,origin:host.url,'content-type':'application/json'},body:JSON.stringify({username:'task-preview',displayName:'Local task agreement acceptance',password:'Local-'+randomUUID()+'A!',remember:true})})
if(!setup.ok)throw Error('Fixture account setup failed')
const mode='Real cloud-local Runtime/goal scheduler/task detail GET with synthetic local tasks; no model/provider or external execution'
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex')
function db(){return runtime.store.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(row=>{const name=String(row.name);return [name,runtime.store.db.prepare('SELECT * FROM "'+name.replaceAll('"','""')+'"').all()]})}
const observations:unknown[]=[]
async function observe(stage:string){
 const before=digest(db()),changes=runtime.store.db.prepare('SELECT total_changes() AS n').get()!.n,normal=await fetch(host.url+'/entry-workspace/task/'+encodeURIComponent(managedId),{headers:{authorization:'Bearer '+token}}),body=await normal.json()as any
 const item={stage,modelCalls,status:normal.status,availability:body.contractView?.availability??null,allTablesUnchanged:before===digest(db()),totalChangesUnchanged:changes===runtime.store.db.prepare('SELECT total_changes() AS n').get()!.n,declaredFileExists:existsSync(join(cwd,'analysis.md'))}
 observations.push(item);writeFileSync(join(root,'runtime-evidence.json'),JSON.stringify({mode,realProviders:false,observations},null,2),{mode:0o600});return item
}
await observe('initial_actual_managed_detail')
const savedRoute=runtime.store.get<RouterRoute>('router-route',trigger.id)!
writeFileSync(join(root,'browser.json'),JSON.stringify({base:host.url,url:host.url+'/configure#tasks/history',cookie:setup.headers.get('set-cookie')!.split(';')[0]!,managedId,ordinaryId:ordinary.ticketId,objective:'Analyze the local project without changing files',mode}),{mode:0o600})
let previous='',busy=false
const timer=setInterval(()=>{if(busy||closing)return;void(async()=>{try{
 const file=join(root,'control.json');if(!existsSync(file))return;const raw=readFileSync(file,'utf8');if(raw===previous||raw.length>1024)return;previous=raw;const command=JSON.parse(raw)
 if(typeof command.id!=='string'||!/^[a-f0-9-]{36}$/.test(command.id)||!['observe','hide_route','restore_route'].includes(command.action))return
 busy=true
 if(command.action==='hide_route')runtime.store.db.prepare("DELETE FROM records WHERE kind='router-route' AND id=?").run(trigger.id)
 if(command.action==='restore_route')runtime.store.put('router-route',trigger.id,savedRoute)
 writeFileSync(join(root,'control-result.json'),JSON.stringify({id:command.id,result:'ok',...await observe(command.action)}),{mode:0o600})
 }catch{writeFileSync(join(root,'control-failed.json'),JSON.stringify({result:'fixture_control_failed'}),{mode:0o600})}finally{busy=false}})()},40)
console.log(JSON.stringify({ready:true,mode}))
async function close(){if(closing)return;closing=true;clearInterval(timer);host.server.closeAllConnections();await new Promise<void>(done=>host.server.close(()=>done()));await host.closeRuntime();rmSync(join(root,'control.json'),{force:true})}
process.once('SIGTERM',()=>void close());process.once('SIGINT',()=>void close())
