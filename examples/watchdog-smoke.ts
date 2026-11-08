/** Isolated real-model acceptance. Inject a stalled Worker, then let the independent
 * watchdog, Router planner/reviewer, Workers and acceptance agents recover it. */
import {spawn} from 'node:child_process'
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {DatabaseSync} from 'node:sqlite'
import {Runtime} from '../src/runtime.ts'
import {configSchema,loadConfig} from '../src/config.ts'
import {serve} from '../src/server.ts'
import type {RouterGoal} from '../src/router-goals.ts'

const phase=process.env.WATCHDOG_SMOKE_PHASE,root=process.env.WATCHDOG_SMOKE_ROOT??mkdtempSync(join(tmpdir(),'agenthub-watchdog-native-'))
if(phase===undefined){
 const cwd=join(root,'work');mkdirSync(cwd,{recursive:true})
 writeFileSync(join(cwd,'input.json'),JSON.stringify([{group:'north',amount:17},{group:'north',amount:25},{group:'south',amount:8}]))
 writeFileSync(join(cwd,'faulty.py'),'import json\nfrom pathlib import Path\nPath("result.json").write_text(json.dumps({"north": 0, "south": 0}))\nprint("failed: north must be 42 and south must be 8")\n')
 const workerPrompt='Use managed shell/read tools only. Follow the latest host-approved node instruction. Initial Worker fault injection: ONLY when the effective node instruction begins with the literal INITIAL, execute faulty.py three times, inspect result.json, and report waiting without any pending background job or request for human input. NEVER run faulty.py for report tasks, repair instructions, or revised plans. This deliberately models an ineffective Worker; do not fix it until a revised plan arrives. After a revised plan arrives, implement the new instruction normally and report ready only after checking the requested files. Do not create schedules, deploy, publish, or use task-side network.'
 const config=configSchema.parse({stateDir:join(root,'state'),port:0,acceptMode:'auto',turnTimeoutMs:300000,watchdog:{staleMs:15000,intervalMs:1000,reviewIntervalMs:15000,modelTimeoutMs:90000,maxReviewsPerHour:20},work:{sandboxDriver:process.platform==='darwin'?'seatbelt':'codex',network:false},execution:{router:{mode:'host',prompt:'The host owns this retained goal, scheduling, verification and watchdog recovery. Do not create new goals or dispatch unrelated work. Preserve immutable acceptance and authorization. On ordinary result notifications reply with an empty string.'},management:{enabled:true,maxWorkers:1},workers:[{id:'one',backend:'codex',tools:['superagent_shell','superagent_read'],prompt:workerPrompt}]},sources:[{id:'local',kind:'local',cwd,sandbox:'workspace-write',workspace:{mode:'source'},allowedActors:['operator']}]})
 writeFileSync(join(root,'config.json'),JSON.stringify(config,null,2))
 console.log(JSON.stringify({root,mode:'real-model fault injection'}))
 const watcher=spawn(process.execPath,['--import','tsx',resolve('src/cli.ts'),'watchdog',join(root,'config.json')],{stdio:'inherit'})
 try{
  for(let p=0;p<3;p++){
   const child=spawn(process.execPath,['--import','tsx',resolve('examples/watchdog-smoke.ts')],{stdio:'inherit',env:{...process.env,WATCHDOG_SMOKE_ROOT:root,WATCHDOG_SMOKE_PHASE:String(p)}})
   const code=await new Promise<number|null>((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve)})
   if(code!==0)throw Error('Real-model host phase '+p+' failed')
  }
  const db=new DatabaseSync(join(root,'state','watchdog','state.sqlite'),{readOnly:true})
  try{writeFileSync(join(root,'watchdog-evidence.json'),JSON.stringify(db.prepare("SELECT kind,id,body FROM records WHERE kind IN ('watchdog-review','watchdog-directive','watchdog-observation','watchdog-health')").all().map((r:any)=>({...r,body:JSON.parse(r.body)})),null,2))}finally{db.close()}
  console.log(JSON.stringify({result:'passed',root,checkpoints:3}))
 }finally{watcher.kill('SIGTERM');await new Promise<void>(r=>{if(watcher.exitCode!==null||watcher.signalCode)r();else watcher.once('exit',()=>r())})}
}else{
 const h=new Runtime(loadConfig(join(root,'config.json'))),server=await serve(h),cwd=h.config.sources[0]!.cwd
 const snapshot=()=>({phase,at:Date.now(),pid:process.pid,goals:h.store.list('router-goal'),recoveries:h.store.list('watchdog-recovery'),replans:h.store.list('goal-replan'),verification:h.store.list('goal-verification'),work:h.work.list(),activity:h.activity.list(),jobs:h.store.db.prepare('SELECT id,state,error FROM jobs').all()})
 try{
  if(phase==='0'){
   h.scopes.command({action:'scope.put',operationId:'scope',expectedRevision:0,scope:{id:'audit',tenantId:'acceptance',name:'Watchdog acceptance',contextBytes:256000,managers:[JSON.stringify(['local','operator'])],workerIds:['one'],sourceIds:['local'],backendIds:['codex']}})
   h.scopes.command({action:'entry.bind',operationId:'entry',expectedRevision:0,scopeId:'audit',sourceId:'local',accountNamespace:'local',nativeId:'audit',history:'group'})
   const received=h.receive('local','operator',{id:'audit',thread:'audit',scope:'audit',addressed:true,text:'Continuously produce correct grouped totals and a report from input.json, recovering from a deliberately stalled initial Worker. Keep all task effects local. Never deploy or publish.'}) as any
   const c=h.scopes.context(h.store.triggers.get(received.triggerId)!,'local:audit')!
   const g=h.goals.command({action:'start',operationId:'goal',expectedRevision:0,title:'Watchdog native acceptance',objective:'Produce correct north=42 and south=8 totals and a human-readable report from input.json. Task effects remain local; never deploy or publish.',authorizationQuote:'Continuously produce correct grouped totals and a report from input.json',maxReplans:2,maxRepairs:1,criteria:[{id:'north',description:'North sum is 42',check:{kind:'json_equals',path:'result.json',pointer:'/north',expected:42}},{id:'south',description:'South sum is 8',check:{kind:'json_equals',path:'result.json',pointer:'/south',expected:8}},{id:'report',description:'Report describes both accepted totals',check:{kind:'text_contains',path:'report.md',text:'42'}}],nodes:[{id:'aggregate',title:'Aggregate',instruction:'INITIAL: execute faulty.py three times and inspect result.json. Return waiting without a question or running job.',workerId:'one',criterionIds:['north','south']},{id:'report',title:'Report',instruction:'Write report.md explaining the accepted result.json totals north=42 and south=8.',workerId:'one',dependsOn:['aggregate'],criterionIds:['report']}]},c) as RouterGoal
   writeFileSync(join(root,'original-contract.json'),JSON.stringify(g.contract))
  }
  let last=0,done=false;const end=Date.now()+20*60000
  while(Date.now()<end){
   const g=h.store.list<RouterGoal>('router-goal')[0]
   if(g?.state==='held')throw Error('Goal held: '+g.reason)
   if(phase==='0'&&h.store.list<any>('watchdog-recovery').some(r=>r.state==='watching')){done=true;break}
   if(phase==='1'&&h.store.list<any>('goal-replan').some(r=>r.state==='applied')){done=true;break}
   if(phase==='2'&&g?.state==='completed'&&!h.activity.list().some(a=>a.state==='running')){
    if(JSON.stringify(g.contract)!==readFileSync(join(root,'original-contract.json'),'utf8'))throw Error('Original contract changed')
    const value=JSON.parse(readFileSync(join(cwd,'result.json'),'utf8'));if(value.north!==42||value.south!==8)throw Error('Wrong accepted totals')
    done=true;break
   }
   if(Date.now()-last>10000){last=Date.now();console.log(JSON.stringify({phase,goal:g?.state,nodes:g?.nodes?.map(n=>({id:n.id,state:n.state})),recovery:h.store.list<any>('watchdog-recovery').map(r=>({state:r.state,reason:r.reason})),replan:h.store.list<any>('goal-replan').map(r=>r.state)}));writeFileSync(join(root,'progress.json'),JSON.stringify(snapshot(),null,2))}
   await new Promise(r=>setTimeout(r,50))
  }
  if(!done)throw Error('Real-model watchdog acceptance timed out')
  writeFileSync(join(root,'phase-'+phase+'.json'),JSON.stringify(snapshot(),null,2))
 }catch(error){writeFileSync(join(root,'failure-'+phase+'.json'),JSON.stringify({...snapshot(),error:String(error)},null,2));throw error}
 finally{await new Promise<void>(r=>server.server.close(()=>r()));await server.closeRuntime()}
}
