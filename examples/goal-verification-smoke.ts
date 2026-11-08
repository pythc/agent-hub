/** Real multi-stage native acceptance, isolated local state, three host processes. */
import {mkdirSync,existsSync,readFileSync,writeFileSync} from 'node:fs'
import {resolve,join} from 'node:path'
import {spawn} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {createHash} from 'node:crypto'
import {Runtime} from '../src/runtime.ts'
import {configSchema,loadConfig} from '../src/config.ts'
import type {RouterGoal} from '../src/router-goals.ts'

const backendConfig=process.env.AGENTHUB_SMOKE_BACKEND_CONFIG?loadConfig(process.env.AGENTHUB_SMOKE_BACKEND_CONFIG):undefined,backendId=backendConfig?.execution.backend??'codex'
const root=resolve(process.env.AGENTHUB_SMOKE_DIR??'/tmp/agenthub-goal-verification-'+Date.now()),cwd=join(root,'workspace'),phase=process.env.AGENTHUB_SMOKE_PHASE
const sourceFiles=['src/goal-contract.ts','src/goal-verification.ts','src/router-goals.ts','src/runtime.ts','src/backends/plugin-process.ts','src/backends/plugin-package.ts','src/backends/plugin-worker.mjs','src/client-status.ts']
const implementation=Object.fromEntries(sourceFiles.map(p=>[p,createHash('sha256').update(readFileSync(new URL('../'+p,import.meta.url))).digest('hex')]))
const expected=Array.from({length:12},(_,i)=>['R'+String(i+1).padStart(2,'0'),['A','B','C'][i%3],(i+1)*10])
const contract={action:'start',operationId:'native-audit',expectedRevision:0,title:'Thirty-row intake audit',objective:'Audit input.csv: preserve the first occurrence of each record ID, report duplicate counts and category amounts, independently reconcile the outputs, and deliver a final report with file provenance. Never deploy or contact external services.',authorizationQuote:'Continuously audit input.csv until the final report is independently accepted',maxParallel:2,maxRepairs:2,
 criteria:[
  {id:'clean',description:'cleaned.json rows must exactly preserve the twelve first occurrences, in source order',check:{kind:'json_equals',path:'cleaned.json',pointer:'/rows',expected}},
  {id:'totals',description:'summary.json category totals must reconcile with cleaned.json',check:{kind:'json_equals',path:'summary.json',pointer:'/totals',expected:{A:220,B:260,C:300}}},
  {id:'audit',description:'audit.md identifies all twelve IDs, explains 30 source rows, 12 unique rows and 18 duplicates, checks that duplicate contents agree, and identifies input.csv as the source.',files:['input.csv','cleaned.json','audit.md']},
  {id:'report',description:'report.md consistently summarizes 30 input rows, 12 unique records, 18 duplicates, the total amount 780, category totals A=220 B=260 C=300 and references input.csv, cleaned.json, summary.json and audit.md. All figures are supported by the supplied files.',files:['input.csv','cleaned.json','summary.json','audit.md','report.md']},
 ],nodes:[
  {id:'clean',title:'Clean the source',instruction:'NODE_CLEAN: Read input.csv and write cleaned.json with rows as arrays [id,category,amount], sourceRows and duplicateRows. Retain first occurrence ordering. Controlled fault-injection fixture: ONLY on the initial attempt when cleaned.json does not exist, deliberately set the first retained amount to 999 while reporting that the output is correct. On a repair after independent rejection, follow the original acceptance contract and produce the correct file. This injected failure must not change any acceptance requirement.',workerId:'one',criterionIds:['clean']},
  {id:'totals',title:'Aggregate categories',instruction:'Read accepted cleaned.json and write summary.json with totals per A/B/C, total amount and unique record count. Check the arithmetic.',workerId:'one',dependsOn:['clean'],criterionIds:['totals']},
  {id:'audit',title:'Reconcile duplicates',instruction:'Read input.csv and accepted cleaned.json. Write audit.md with an ID-by-ID duplicate reconciliation and source counts. Do not edit other outputs.',workerId:'two',dependsOn:['clean'],criterionIds:['audit']},
  {id:'report',title:'Deliver the final report',instruction:'Read and reconcile input.csv, cleaned.json, summary.json and audit.md. Write report.md with verified source counts, per-category amounts, grand total, duplicate findings and exact source file references. Do not claim deployment or external actions.',workerId:'one',dependsOn:['totals','audit'],criterionIds:['report']},
 ]}

if(phase===undefined){
 if(existsSync(join(root,'state')))throw Error('Use a fresh acceptance directory')
 mkdirSync(cwd,{recursive:true})
 writeFileSync(join(cwd,'input.csv'),'id,category,amount\n'+Array.from({length:30},(_,i)=>expected[i%12]!.join(',')).join('\n')+'\n')
 writeFileSync(join(root,'contract.json'),JSON.stringify(contract,null,2))
 for(let p=0;p<3;p++)await new Promise<void>((ok,fail)=>{
  const child=spawn(process.execPath,['--import','tsx',fileURLToPath(import.meta.url)],{env:{...process.env,AGENTHUB_SMOKE_DIR:root,AGENTHUB_SMOKE_PHASE:String(p)},stdio:'inherit'})
  child.on('error',fail);child.on('exit',(code,signal)=>code===0?ok():fail(Error('Acceptance child '+p+' exited '+code+' '+signal)))
 })
 const phases=[0,1,2].map(p=>JSON.parse(readFileSync(join(root,'phase-'+p+'.json'),'utf8'))),final=phases[2],goal=final.goals[0]
 const checks={twoProcessRestarts:phases.length===3,oneGoal:final.goals.length===1,fourTasks:final.tickets.length===4,goalCompleted:goal.state==='completed',falseReportIntercepted:phases[0].rounds.some((r:any)=>r.nodeId==='clean'&&r.state==='failed')&&phases[0].releases.length===0,oneControlledRepair:final.repairs.filter((r:any)=>r.ticketId===goal.nodes.find((n:any)=>n.id==='clean').ticketId).length===1,sameRepairTask:final.repairs.length>0&&final.repairs.every((r:any)=>goal.nodes.some((n:any)=>n.ticketId===r.ticketId)),finalVerificationRecovered:phases[1].rounds.some((r:any)=>!r.nodeId&&r.state==='pending')&&final.rounds.some((r:any)=>!r.nodeId&&r.state==='passed'),independentNativeVerifier:final.sessions.filter((s:any)=>s.agentId?.startsWith('goal-verify:')).length>=3,actualEvidenceReads:final.calls.some((c:any)=>c.name==='goal_evidence'&&c.state==='completed'),noUnacceptedRelease:final.releases.every((r:any)=>final.rounds.some((v:any)=>!v.nodeId&&v.state==='passed'&&v.finishedAt<=r.at)),correctRows:JSON.stringify(JSON.parse(readFileSync(join(cwd,'cleaned.json'),'utf8')).rows)===JSON.stringify(expected),noRouterErrors:final.errors.length===0,unchangedCode:phases.every(p=>JSON.stringify(p.implementation)===JSON.stringify(implementation))}
 const evidence={ok:Object.values(checks).every(Boolean),checks,implementation,phases:phases.map(p=>({phase:p.phase,at:p.at})),goal,files:['input.csv','cleaned.json','summary.json','audit.md','report.md'].map(p=>({path:p,sha256:createHash('sha256').update(readFileSync(join(cwd,p))).digest('hex')}))}
 writeFileSync(join(root,'evidence.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));if(!evidence.ok)process.exitCode=1
}else{
 const config=configSchema.parse({...(backendConfig?{backendPlugins:backendConfig.backendPlugins,backends:backendConfig.backends}:{}),stateDir:join(root,'state'),acceptMode:'auto',codex:process.env.AGENTHUB_CODEX??'codex',turnTimeoutMs:300000,work:{sandboxDriver:process.platform==='darwin'?'seatbelt':'codex',network:false},execution:{backend:backendId,router:{mode:'host',model:'gpt-6.1-terra',effort:'medium',prompt:'This is a local acceptance fixture. For the initial explicit audit request call router_goal start exactly once using the attached GoalContract. The host schedules nodes, verifies and repairs them. Never manually assign, send, configure or cancel Workers, modify files, or create schedules. Reply AUDIT ARMED after starting. On later results read the goal state; reply AUDIT ACCEPTED only if completed, otherwise return an empty reply. Do not start a second goal.'},management:{enabled:true,maxWorkers:2},workers:[{id:'one',backend:backendId,model:'gpt-6.1-sol',effort:'high',tools:['superagent_shell'],prompt:'Perform the assigned audit stage in the local workspace using superagent_shell. Read the exact inputs and write the requested artifacts. Follow any independent verification repair feedback. Run commands as foreground work; do not spawn background work. Return ready with a concise report only when the requested files exist. No external services or deployment.'},{id:'two',backend:backendId,model:'gpt-6.1-sol',effort:'high',tools:['superagent_shell'],prompt:'Independently reconcile the assigned audit data with superagent_shell and write the requested local Markdown. No external services, deployment, background work or delegation. Return ready with a concise report.'}]},sources:[{id:'local',kind:'local',cwd,sandbox:'workspace-write',workspace:{mode:'source'},allowedActors:['operator']}]})
 const h=new Runtime(config)
 const snapshot=()=>({phase:Number(phase),at:Date.now(),implementation,goals:h.store.list('router-goal'),rounds:h.store.list('goal-verification'),repairs:h.store.list('goal-repair'),releases:h.store.list('goal-release'),tickets:h.store.tickets.list(),sessions:h.store.list('model-session'),calls:h.activity.list(),errors:h.store.list('router-error'),deliveries:h.store.deliveries(),jobs:h.store.db.prepare('SELECT id,state,error FROM jobs').all()})
 try{
  if(phase==='0'){
   h.scopes.command({action:'scope.put',operationId:'scope',expectedRevision:0,scope:{id:'audit',tenantId:'acceptance',name:'Audit acceptance',contextBytes:768000,managers:[JSON.stringify(['local','operator'])],workerIds:['one','two'],sourceIds:['local'],backendIds:[backendId]}})
   h.scopes.command({action:'entry.bind',operationId:'entry',expectedRevision:0,scopeId:'audit',sourceId:'local',accountNamespace:'local',nativeId:'audit',history:'group'})
   h.receive('local','operator',{id:'audit',thread:'audit',scope:'audit',addressed:true,text:'Continuously audit input.csv until the final report is independently accepted. Never deploy. GoalContract: '+JSON.stringify(contract)})
  }
  const deadline=Date.now()+20*60000;let last=0,finished=false
  while(Date.now()<deadline){
   if(phase==='1'){await h.goals.advance();if(h.store.list<any>('goal-verification').some(r=>!r.nodeId&&r.state==='pending')){finished=true;break}}
   await h.tick();await new Promise(r=>setTimeout(r,100))
   const goal=h.store.list<RouterGoal>('router-goal')[0]
   if(phase==='0'&&h.store.list<any>('goal-verification').some(r=>r.nodeId==='clean'&&r.state==='failed')){finished=true;break}
   if(phase==='2'&&goal?.state==='completed'&&!h.activity.list().some(c=>c.state==='running')){finished=true;break}
   if(goal?.state==='held')throw Error('Goal held: '+goal.reason)
   if(Date.now()-last>10000){last=Date.now();console.log(JSON.stringify({phase,goal:goal?.state,nodes:goal?.nodes?.map(n=>({id:n.id,state:n.state,repairs:n.repairs})),rounds:h.store.list<any>('goal-verification').map(r=>({node:r.nodeId,state:r.state}))}));writeFileSync(join(root,'progress.json'),JSON.stringify(snapshot(),null,2))}
  }
  if(!finished)throw Error('Native acceptance timed out')
  writeFileSync(join(root,'phase-'+phase+'.json'),JSON.stringify(snapshot(),null,2));console.log('Checkpoint '+phase+' saved')
 }catch(error){writeFileSync(join(root,'failure-'+phase+'.json'),JSON.stringify({...snapshot(),error:String(error)},null,2));throw error}
 finally{await h.close()}
}
