/** Isolated real Runtime with synthetic local telemetry, never provider/billed usage. */
import {createHash,randomUUID} from 'node:crypto'
import {existsSync,mkdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs'
import {join,resolve} from 'node:path'
import {Runtime} from '../src/runtime.ts'
import {configSchema} from '../src/config.ts'
import {serve} from '../src/server.ts'
import {ResourceUsage} from '../src/resource-usage.ts'
import {checkBudget,ContextBudgetExceeded} from '../src/context-budget.ts'
const root=resolve(process.argv[2]??'.local/resource-usage-acceptance'),cwd=join(root,'workspace')
mkdirSync(cwd,{recursive:true,mode:0o700})
if(existsSync(join(root,'browser.json')))throw Error('Use a fresh private acceptance directory')
let modelCalls=0,summaryCalls=0,resourceRequests=0,closing=false
const runtime=new Runtime(configSchema.parse({stateDir:join(root,'state'),port:0,watchdog:{enabled:false},work:{sandboxDriver:'disabled',autoRecover:false},sources:[{id:'local',kind:'local',cwd,allowedActors:['operator']}]}),{model:{async run(){modelCalls++;throw Error('Model calls are forbidden in this local fixture')}}})
runtime.pause(true)
const originalSummary=runtime.usage.summary.bind(runtime.usage)
runtime.usage.summary=(...args)=>{summaryCalls++;return originalSummary(...args)}
runtime.usage.begin('fixture-unreported','worker');runtime.usage.finish('fixture-unreported','failed')
runtime.usage.begin('fixture-partial','router');runtime.usage.record('fixture-partial',0,{id:'partial-step',inputTokens:12});runtime.usage.finish('fixture-partial','failed')
function contextReceipt(id:string,exceeded:boolean){try{checkBudget(exceeded?'x'.repeat(512):'local fixture',{maxBytes:256,outputReserveBytes:32,toolReserveBytes:0},'api-wire','fixture_check',receipt=>runtime.store.put('context-budget',id,{activity:id,...receipt,at:Date.now()}))}catch(error){if(!(error instanceof ContextBudgetExceeded))throw error}}
contextReceipt('fixture-within',false);contextReceipt('fixture-exceeded',true)
for(const [id,state]of [['fixture-work-completed','completed'],['fixture-work-failed','failed']] as const)runtime.store.put('work',id,{id,kind:'shell',state,ticketId:'fixture-only-no-task',assignmentId:'fixture-only-no-assignment',cwd,sandbox:'read-only',depth:0,notify:'collected',createdAt:Date.now(),endedAt:Date.now(),deadline:Date.now()-1000})
const host=await serve(runtime)
host.server.on('request',request=>{if(new URL(request.url??'/',host.url).pathname==='/api/resource-usage')resourceRequests++})
const token=readFileSync(host.tokenPath,'utf8').trim(),response=await fetch(host.url+'/account/setup',{method:'POST',headers:{authorization:'Bearer '+token,origin:host.url,'content-type':'application/json'},body:JSON.stringify({username:'usage-preview',displayName:'Local usage acceptance',password:'Local-'+randomUUID()+'A!',remember:true})})
if(!response.ok)throw Error('Local fixture account setup failed')
const mode='Real cloud-local Runtime/account/GET with synthetic local UsageLedger and context/work records; not provider-reported or billed usage'
const observations:unknown[]=[]
let lastFacts:string|undefined
function facts(){return runtime.store.db.prepare("SELECT kind,id,body FROM records WHERE kind IN ('model-usage','context-budget','work') ORDER BY kind,id").all()}
function digest(value:unknown){return createHash('sha256').update(JSON.stringify(value)).digest('hex')}
function retain(stage:string){
 const before=facts(),summaryCallsBeforeObservation=summaryCalls,snapshot=new ResourceUsage(()=>runtime).snapshot(),after=facts()
 const currentFacts=digest(before),resourceRecordsStableSincePreviousObservation=lastFacts===undefined?null:lastFacts===currentFacts;lastFacts=currentFacts
 const item={stage,modelCalls,resourceRequests,summaryCallsBeforeObservation,summaryCallsAfterObservation:summaryCalls,resourceRecordsStableSincePreviousObservation,resourceRecordsStableDuringObservation:currentFacts===digest(after),retainedResourceRecordCount:before.length,snapshot}
 observations.push(item);writeFileSync(join(root,'runtime-evidence.json'),JSON.stringify({mode,realProviders:false,observations},null,2),{mode:0o600});return item
}
retain('initial_synthetic_unknown_partial')
writeFileSync(join(root,'browser.json'),JSON.stringify({base:host.url,url:host.url+'/configure#execution/configuration',cookie:response.headers.get('set-cookie')!.split(';')[0]!,mode}),{mode:0o600})
let previous='',busy=false
const timer=setInterval(()=>{if(busy||closing)return;void(async()=>{
 try{const path=join(root,'control.json');if(!existsSync(path))return;const raw=readFileSync(path,'utf8');if(raw===previous||raw.length>1024)return;previous=raw;const command=JSON.parse(raw)
  if(typeof command.id!=='string'||!/^[a-f0-9-]{36}$/.test(command.id)||!['observe','append','observer_unavailable'].includes(command.action))return
  busy=true
  if(command.action==='append'){if(runtime.store.get('model-usage','fixture-reported'))throw Error('Fixture append already applied');runtime.usage.begin('fixture-reported','worker');runtime.usage.record('fixture-reported',0,{id:'reported-step',inputTokens:100,cachedInputTokens:20,outputTokens:25,reasoningOutputTokens:5});runtime.usage.finish('fixture-reported','completed');contextReceipt('fixture-exceeded',false)}
  if(command.action==='observer_unavailable'){const directory=join(root,'state','watchdog');mkdirSync(directory,{recursive:true,mode:0o700});writeFileSync(join(directory,'state.sqlite'),'Intentional local unreadable observer fixture',{mode:0o600})}
  writeFileSync(join(root,'control-result.json'),JSON.stringify({id:command.id,result:'ok',...retain(command.action)}),{mode:0o600})
 }catch{writeFileSync(join(root,'control-failed.json'),JSON.stringify({result:'fixture_control_failed'}),{mode:0o600})}finally{busy=false}
})()},40)
console.log(JSON.stringify({ready:true,mode}))
async function close(){if(closing)return;closing=true;clearInterval(timer);host.server.closeAllConnections();await new Promise<void>(done=>host.server.close(()=>done()));await host.closeRuntime();rmSync(join(root,'control.json'),{force:true})}
process.once('SIGTERM',()=>void close());process.once('SIGINT',()=>void close())
