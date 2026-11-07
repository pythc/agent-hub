/** Real native Router/Worker acceptance. Fresh local state only; no connectors. */
import {mkdirSync,writeFileSync,existsSync,readFileSync} from 'node:fs'
import {join,resolve} from 'node:path'
import {createHash} from 'node:crypto'
import {Runtime} from '../src/runtime.ts'
import {configSchema} from '../src/config.ts'
import type {RouterGoal} from '../src/router-goals.ts'

const root=resolve(process.env.AGENTHUB_SMOKE_DIR??'/tmp/agenthub-continuity-'+Date.now()),cwd=join(root,'workspace')
if(existsSync(join(root,'state')))throw Error('Use a fresh acceptance directory')
mkdirSync(cwd,{recursive:true})
let now=Date.now()
const config=configSchema.parse({stateDir:join(root,'state'),port:0,codex:process.env.AGENTHUB_CODEX??'codex',turnTimeoutMs:120000,work:{sandboxDriver:'disabled'},execution:{router:{mode:'host',model:'gpt-6.1-terra',effort:'medium',prompt:'This is an isolated acceptance. Only use host tools; never change files, settings, workers or schedules. When the latest human trigger starts with 记住, reply MEMORY SAVED and do no work. When the latest human trigger contains ARM GOAL, create exactly one router_goal with one acceptance criterion: the configured Worker reads the embedded arithmetic document and the Router checks the sum 42 against it. Pin the explicit prohibition 禁止部署 using router_journal. Set the goal waiting for 10 seconds with nextAction dispatch the calculation, and reply GOAL ARMED; do not dispatch a Worker during that human turn. When currentGoalId is present on a synthetic goal event, continue the existing goal: if no task exists, read/search the embedded document, then assign exactly one task to worker-1 to read it via superagent_knowledge and calculate. While the task is pending return an empty reply. On a ready result, inspect current report, verify the arithmetic and criterion, complete the existing goal with exact reportAt evidence, then reply GOAL VERIFIED 42. Never start a second task for the same calculation. When the latest human trigger contains CHECK CONTINUITY, query confirmed memory and current goal state, create no work, and reply CONTINUITY VERIFIED 青竹 42 only if both are supported. The tasks and goals in current input are authoritative state snapshots.'},management:{enabled:true,maxWorkers:1},workers:[{id:'worker-1',backend:'codex',model:'gpt-6.1-sol',effort:'high',tools:['superagent_knowledge'],prompt:'Use superagent_knowledge to read the assigned document, then independently compute A+B. Return ready only after that tool succeeds. Include the document ID/revision and arithmetic in summary, reply with the numeric sum, question null, askedBy null, handbacks empty. No files or external services.'}]},sources:[{id:'local',kind:'local',cwd,allowedActors:['operator'],workspace:{mode:'source'}}]})
let h=new Runtime(config,{clock:()=>now})
h.scopes.command({action:'scope.put',operationId:'scope',expectedRevision:0,scope:{id:'team',tenantId:'acceptance',name:'Continuity acceptance',managers:[JSON.stringify(['local','operator'])],workerIds:['worker-1'],sourceIds:['local'],backendIds:['codex']}})
h.scopes.command({action:'entry.bind',operationId:'entry',expectedRevision:0,scopeId:'team',sourceId:'local',accountNamespace:'local',nativeId:'acceptance',history:'group'})
const receive=(id:string,text:string)=>h.receive('local','operator',{id,thread:'continuity',scope:'acceptance',text,addressed:true}) as any
const delivered=(text:string)=>h.store.deliveries().some(d=>!d.channel.address.routerInbox&&d.status==='sent'&&d.text.trim()===text)
const snapshot=()=>({goals:h.store.list('router-goal'),wakes:h.store.list('goal-wake'),journal:h.store.list('router-journal'),requirements:h.store.list('router-commitment'),sessions:h.store.list('router-session'),modelSessions:h.store.list('model-session'),calls:h.activity.list(),configurations:h.store.list('agent-configuration'),tickets:h.store.tickets.list(),runs:h.store.list('run'),documents:h.store.list('knowledge-document'),deliveries:h.store.deliveries(),errors:h.store.list('router-error'),jobs:h.store.db.prepare('SELECT id,state,error FROM jobs').all()})
async function wait(label:string,predicate:()=>boolean){const deadline=Date.now()+240000;let last=0;while(Date.now()<deadline){await h.tick();if(predicate())return;if(Date.now()-last>10000){last=Date.now();console.log(JSON.stringify({phase:label,active:h.activity.list().filter(c=>c.state==='running').map(c=>({kind:c.kind,model:c.model})),goals:h.store.list<RouterGoal>('router-goal').map(g=>({state:g.state,turns:g.turns})),tasks:h.store.tickets.list().length}));writeFileSync(join(root,'progress.json'),JSON.stringify(snapshot(),null,2))}await new Promise(r=>setTimeout(r,100))}throw Error('Timed out: '+label)}
const files=['runtime.ts','router-continuity.ts','router-goals.ts','knowledge.ts','router-memory.ts','worker-tools.ts','vendor/weknora/primitives.ts']
const implementation=Object.fromEntries(files.map(file=>[file,createHash('sha256').update(readFileSync(new URL('../src/'+file,import.meta.url))).digest('hex')]))
const checks:Record<string,boolean>={};let error:string|undefined
try{
 const memory=receive('remember','记住：我的验收暗号是青竹。')
 const trigger=h.store.triggers.get(memory.triggerId)!,c=h.scopes.context(trigger,'local:continuity')!
 const source=h.knowledge.command({action:'put',operationId:'arithmetic',expectedRevision:0,title:'Arithmetic acceptance',content:'# Acceptance\nA = 17\nB = 25\nCompute A + B.\nMarker: EMBEDDED_ARITHMETIC_763'},c)
 h.knowledge.command({action:'put',operationId:'wiki',expectedRevision:0,kind:'wiki',slug:'acceptance/arithmetic',title:'Arithmetic source',content:'Arithmetic comes from the retained source document.',citations:[{documentId:source.id,revision:1,start:0,end:12}]},c)
 await wait('explicit-memory',()=>delivered('MEMORY SAVED'))
 const firstThread=h.store.list<any>('router-session')[0]?.threadId
 receive('arm','ARM GOAL：请持续完成文档中的算术核验，直到验收标准满足。必须保留原文来源，禁止部署。先保存目标并等待 10 秒，重启后继续，由 worker-1 读取文档 '+source.id+' 并计算，最终核对结果 42。')
 await wait('arm-goal',()=>delivered('GOAL ARMED')&&h.store.list<RouterGoal>('router-goal').some(g=>g.state==='waiting'))
 checks.noWorkerBeforeRestart=h.store.tickets.list().length===0
 await h.close();h=new Runtime(config,{clock:()=>now});now+=11000
 await wait('resume-and-verify',()=>delivered('GOAL VERIFIED 42')&&h.store.list<RouterGoal>('router-goal').some(g=>g.state==='completed'))
 const before=h.store.tickets.list().length
 receive('continuity','CHECK CONTINUITY：核对之前的记忆暗号、禁止部署要求以及已完成目标的真实结果，不再派发任务。')
 await wait('continuity',()=>delivered('CONTINUITY VERIFIED 青竹 42'))
 const calls=h.activity.list(),goal=h.store.list<RouterGoal>('router-goal')[0]!,configs=h.store.list<any>('agent-configuration')
 Object.assign(checks,{oneGoal:h.store.list('router-goal').length===1,goalCompleted:goal.state==='completed'&&goal.checks?.length===1,oneTask:before===1&&h.store.tickets.list().length===1,reusedRouterThread:h.store.list<any>('router-session')[0]?.threadId===firstThread,workerKnowledgeRead:calls.some(c=>c.name==='superagent_knowledge'&&c.state==='completed'),pinnedProhibition:h.store.list<any>('router-commitment').some(c=>c.active&&c.text.includes('禁止部署')),syntheticWake:h.store.list<any>('goal-wake').every(w=>h.store.triggers.get(w.triggerId)?.human===false),routerEffort:configs.filter(c=>c.role==='router').every(c=>c.sent?.effort==='medium'),workerEffort:configs.some(c=>c.role==='worker'&&c.sent?.effort==='high'),onlyRouterExternal:h.store.deliveries().filter(d=>!d.channel.address.routerInbox).every(d=>d.id.startsWith('router-reply:'))})
 if(!Object.values(checks).every(Boolean))throw Error('Acceptance checks failed')
}catch(e){error=String(e);process.exitCode=1}finally{
 writeFileSync(join(root,'evidence.json'),JSON.stringify({ok:!error,error,checks,implementation,...snapshot()},null,2),{mode:0o600})
 console.log(JSON.stringify({ok:!error,error,checks,evidence:join(root,'evidence.json')}))
 await h.close()
}
