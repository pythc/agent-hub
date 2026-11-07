/** Real Terra medium / four Sol high acceptance in a fresh local-only workspace. */
import {mkdirSync,writeFileSync,existsSync,readFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {resolve,join} from 'node:path'
import {Runtime} from '../src/runtime.ts'
import {configSchema} from '../src/config.ts'
const root=resolve(process.env.AGENTHUB_SMOKE_DIR??'/tmp/agenthub-proactive-native-'+Date.now()),cwd=join(root,'workspace')
const implementation=Object.fromEntries(['router-proactive.ts','schedule-time.ts','runtime.ts','router-ingress.ts','worker-manager.ts','router-scope.ts','router-memory.ts'].map(f=>[f,createHash('sha256').update(readFileSync(new URL('../src/'+f,import.meta.url))).digest('hex')]))
if(existsSync(join(root,'state')))throw Error('Use a fresh acceptance directory')
mkdirSync(cwd,{recursive:true})
const h=new Runtime(configSchema.parse({stateDir:join(root,'state'),codex:process.env.AGENTHUB_CODEX??'codex',turnTimeoutMs:120000,acceptMode:'auto',work:{sandboxDriver:'disabled'},execution:{router:{mode:'host',model:'gpt-6.1-terra',effort:'medium',prompt:'For this isolated arithmetic acceptance, use only the four configured Workers and actual host evidence. For the initial request assign one calculation to each of worker-1 through worker-4, exactly once. Do not reply with intermediate acknowledgements. Until all four reports are ready return an empty reply. When all four have completed return ROUTER VERIFIED 2 4 6 8. If the current request is a recheck, preserve the other three results and return ROUTER RECHECKED 2 4 6 8 only after the requested Worker has returned a new result. If the current request says SCHEDULED, follow that request and return SCHEDULED 12. Never modify files, contact external services, or create schedules during this acceptance.'},management:{enabled:true,maxWorkers:4},workers:Array.from({length:4},(_,i)=>({id:'worker-'+(i+1),backend:'codex',model:'gpt-6.1-sol',effort:'high',tools:[],prompt:'Only perform the assigned arithmetic or recheck. Never call tools or change files. Return state ready, summary with the calculation, reply with its numeric result, question null, askedBy null and no handbacks.'}))},sources:[{id:'local',kind:'local',cwd,allowedActors:['operator'],workspace:{mode:'source'}}]}))
h.scopes.command({action:'scope.put',operationId:'scope',expectedRevision:0,scope:{id:'team',tenantId:'test',name:'Native acceptance',managers:[JSON.stringify(['local','operator'])],workerIds:['worker-1','worker-2','worker-3','worker-4'],sourceIds:['local'],backendIds:['codex']}})
h.scopes.command({action:'entry.bind',operationId:'entry',expectedRevision:0,scopeId:'team',sourceId:'local',accountNamespace:'local',nativeId:'acceptance',history:'group'})
h.proactive.command({action:'settings.put',scopeId:'team',operationId:'batch',expectedRevision:0,settings:{enabled:true,debounceMs:500,maxWaitMs:2000,cooldownMs:0}})
const receive=(id:string,text:string)=>h.receive('local','operator',{id,thread:'arithmetic',scope:'acceptance',text,addressed:true}) as any
const delivered=(text:string)=>h.store.deliveries().some(d=>!d.channel.address.routerInbox&&d.status==='sent'&&d.text.trim()===text)
const snapshot=()=>({calls:h.activity.list(),runs:h.store.list('run'),tickets:h.store.tickets.list(),configurations:h.store.list('agent-configuration'),admissions:h.store.list('router-admission'),batches:h.store.list('router-batch'),scheduledRuns:h.store.list('router-schedule-run'),deliveries:h.store.deliveries(),sessions:h.store.list('model-session'),errors:h.store.list('router-error'),jobs:h.store.db.prepare('SELECT id,state,error FROM jobs').all()})
async function wait(label:string,condition:()=>boolean){const until=Date.now()+240000;let last=0;while(Date.now()<until){await h.tick();if(condition())return;if(Date.now()-last>10000){last=Date.now();console.log(JSON.stringify({phase:label,active:h.activity.list().filter(c=>c.state==='running').map(c=>({kind:c.kind,model:c.model})),tasks:h.store.tickets.list().length}));writeFileSync(join(root,'progress.json'),JSON.stringify(snapshot(),null,2))}await new Promise(r=>setTimeout(r,100))}throw Error('Acceptance timed out: '+label)}
let checks:Record<string,boolean>={},error:string|undefined
try{
 receive('batch-1','请用 worker-1、worker-2、worker-3、worker-4 分别计算 1+1、2+2、3+3、4+4，每项建立一个任务。')
 receive('batch-2','这是同一批请求的补充：核对四个真实 Worker 的返回后统一回复 ROUTER VERIFIED 2 4 6 8，用户只与 Router 对话。')
 await wait('four-workers',()=>delivered('ROUTER VERIFIED 2 4 6 8'))
 const before=h.store.list<any>('run'),delegation=h.store.list<any>('worker-assignment').find(a=>a.workerId==='worker-2')
 if(!delegation||before.length!==4)throw Error('Expected four distinct Workers')
 const follow=receive('followup','继续原任务 '+delegation.ticketId+'：请原 Worker 再次独立核算 2+2，不创建任务。保留其他三项结果，核对新的复核报告后回复 ROUTER RECHECKED 2 4 6 8。')
 await wait('same-task-followup',()=>delivered('ROUTER RECHECKED 2 4 6 8'))
 const after=h.store.list<any>('run')
 h.proactive.command({action:'schedule.put',scopeId:'team',operationId:'schedule',expectedRevision:0,schedule:{id:'once',name:'Native scheduled check',triggerId:follow.triggerId,prompt:'SCHEDULED：本次只由 Router 计算 6+6，不创建 Worker 任务；回复 SCHEDULED 12。',mode:'standalone',notification:'always',timing:{kind:'once',timezone:'Asia/Shanghai',startAt:new Date(Date.now()+1000).toISOString()}}})
 await wait('scheduled-source',()=>h.store.list<any>('router-schedule-run').some(r=>r.state==='completed'&&r.delivery==='sent')&&delivered('SCHEDULED 12'))
 const batch=h.store.list<any>('router-batch'),schedule=h.store.list<any>('router-schedule-run')[0],calls=h.activity.list(),configs=h.store.list<any>('agent-configuration')
 checks={fourTasks:h.store.tickets.list().length===4,fourWorkers:new Set(after.map(r=>r.workerId)).size===4,batchTwoMessages:batch[0]?.triggerIds.length===2,sameTasksAndThreads:after.every(r=>before.some(b=>b.ticketId===r.ticketId&&b.threadId===r.threadId)),onlyWorkerTwoRechecked:after.every(r=>{const b=before.find(b=>b.ticketId===r.ticketId);return r.workerId==='worker-2'?r.turnId!==b?.turnId:r.turnId===b?.turnId}),boundAttachment:batch[1]?.decision.action==='attach'&&batch[1]?.decision.targetTicketId===delegation.ticketId,workerModels:after.every(r=>r.model==='gpt-6.1-sol'),workerEffort:configs.filter(c=>c.role==='worker'||c.ticketId).every(c=>c.sent?.effort==='high'),fiveWorkerCalls:calls.filter(c=>c.kind==='worker').length===5,routerModel:calls.filter(c=>c.kind==='router').every(c=>c.model==='gpt-6.1-terra'),syntheticSchedule:h.store.triggers.get(schedule.triggerId)?.human===false,oneSchedule:h.store.list('router-schedule-run').length===1,scheduledDelivery:delivered('SCHEDULED 12'),onlyRouterExternal:h.store.deliveries().filter(d=>!d.channel.address.routerInbox).every(d=>d.id.startsWith('router-reply:'))}
 if(!Object.values(checks).every(Boolean))throw Error('Acceptance checks failed')
}catch(e){error=String(e);process.exitCode=1}finally{
 writeFileSync(join(root,'evidence.json'),JSON.stringify({ok:!error,error,checks,implementation,...snapshot()},null,2),{mode:0o600})
 console.log(JSON.stringify({ok:!error,error,checks,evidence:join(root,'evidence.json')}))
 await h.close()
}
