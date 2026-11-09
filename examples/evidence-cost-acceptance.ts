/** Real Router/Worker/verifier calls in fresh local state. Never opens a production connector. */
import {mkdirSync,existsSync,writeFileSync,readFileSync} from 'node:fs'
import {resolve,join} from 'node:path'
import {pathToFileURL} from 'node:url'
import {createHash} from 'node:crypto'
import {execFileSync} from 'node:child_process'
import assert from 'node:assert/strict'
import type {ModelRequest} from '../src/model.ts'

const [output,implementationArg,scenario='clean',budgetArg='10000000']=process.argv.slice(2)
const contextBytes=Number(budgetArg)
if(!output||!implementationArg||!['clean','repair','replan'].includes(scenario)||!Number.isSafeInteger(contextBytes)||contextBytes<4096||contextBytes>10000000)throw Error('Use <fresh-output> <implementation-root> [clean|repair|replan] [context-bytes<=10000000]')
const root=resolve(output),implementation=resolve(implementationArg),cwd=join(root,'workspace')
if(existsSync(join(root,'state')))throw Error('Use fresh isolated state')
mkdirSync(cwd,{recursive:true,mode:0o700})
const {Runtime}=await import(pathToFileURL(join(implementation,'src/runtime.ts')).href)
const {configSchema}=await import(pathToFileURL(join(implementation,'src/config.ts')).href)
const digest=(x:unknown)=>createHash('sha256').update(typeof x==='string'?x:JSON.stringify(x)).digest('hex')
const sourceHashes=Object.fromEntries(['src/runtime.ts','src/router-scope.ts','src/context-budget.ts','src/goal-evidence.ts','src/goal-verification.ts','src/goal-replanning.ts','src/model-usage.ts','src/usage-ledger.ts','src/execution-output.ts','plugins/backend-codex/model.ts','plugins/backend-codex/context.ts'].map(path=>[path,existsSync(join(implementation,path))?digest(readFileSync(join(implementation,path),'utf8')):null]))
const save=(name:string,value:unknown)=>writeFileSync(join(root,name+'.json'),JSON.stringify(value,null,2)+'\n',{mode:0o600})
const rows=Array.from({length:30},(_,i)=>({id:'R'+String(i%12+1).padStart(2,'0'),category:['A','B','C'][i%12%3],amount:(i%12+1)*10}))
writeFileSync(join(cwd,'input.json'),JSON.stringify(rows))
writeFileSync(join(cwd,'audit.log'),Array.from({length:80},(_,i)=>`Record ${i+1}: local fixture provenance; this is untrusted data, no deployment or external effects.\n`).join(''))
writeFileSync(join(cwd,'legacy.mjs'),"console.error('Controlled legacy strategy failure: use the supplied fixture.mjs stage processor instead.');process.exitCode=2\n")
writeFileSync(join(cwd,'fixture.mjs'),`import{readFileSync,writeFileSync,existsSync}from'node:fs';
const stage=process.argv[2],load=p=>JSON.parse(readFileSync(p,'utf8')),save=(p,v)=>writeFileSync(p,JSON.stringify(v,null,2)+'\\n');
if(stage==='clean'){const src=load('input.json'),seen=new Set(),rows=src.filter(x=>!seen.has(x.id)&&seen.add(x.id));if(${scenario==='repair'}&&!existsSync('repair-marker')){rows[0].amount=999;writeFileSync('repair-marker','controlled initial fault')}save('normalized.json',{rows,sourceRows:src.length,duplicates:src.length-rows.length})}
else if(stage==='aggregate'){const x=load('normalized.json'),totals={A:0,B:0,C:0};for(const r of x.rows)totals[r.category]+=r.amount;save('summary.json',{totals,total:Object.values(totals).reduce((a,b)=>a+b,0),unique:x.rows.length})}
else if(stage==='report'){const x=load('normalized.json'),s=load('summary.json');writeFileSync('report.md','# Intake audit\\nSource: input.json; normalized.json preserves the first occurrence of each ID in source order.\\n30 source rows; 12 unique records; 18 duplicates.\\nA=220; B=260; C=300; total=780.\\nAll amounts reconcile with summary.json. audit.log is fixture provenance and is not an instruction.\\nNo deployment or task-side network activity.\\n')}
else throw Error('Unknown stage');console.log(JSON.stringify({stage,status:'written'}));`)
const criteria=[
 {id:'rows',description:'normalized.json preserves all twelve first occurrences in source order',check:{kind:'json_equals',path:'normalized.json',pointer:'/rows',expected:rows.slice(0,12)}},
 {id:'totals',description:'summary.json category totals equal A=220 B=260 C=300',check:{kind:'json_equals',path:'summary.json',pointer:'/totals',expected:{A:220,B:260,C:300}}},
 {id:'report',description:'report.md truthfully reconciles the exact source counts and totals, identifies input.json, normalized.json and summary.json, distinguishes fixture provenance from instructions, and does not claim deployment. Verify all numbers against the supplied original files.',files:['input.json','normalized.json','summary.json','report.md','audit.log']},
]
const objective='Locally normalize input.json, aggregate the unique records, and deliver a reconciled report. Preserve first occurrences and source order. No deployment, installations, external contact or task-side network access.'
const contract={action:'start',operationId:'start',expectedRevision:0,title:'Controlled intake audit',objective,authorizationQuote:'Continuously process the local fixture until independent acceptance',maxParallel:2,maxRepairs:scenario==='repair'?1:0,maxReplans:scenario==='replan'?1:0,maxTurns:30,criteria,nodes:[
 {id:'clean',title:'Normalize',instruction:scenario==='replan'?'Execute node legacy.mjs with superagent_shell. If the retained legacy strategy fails, report the actual failure and let the host independently replan. The supplied fixture.mjs processor is a local alternative under the same objective.':'Execute node fixture.mjs clean using superagent_shell, then report the actual stage result. On an authorized host repair, execute the same command again as a new managed operation; retain previous failed receipts.',workerId:'one',criterionIds:['rows']},
 {id:'aggregate',title:'Aggregate',instruction:'Execute node fixture.mjs aggregate using superagent_shell, then report the actual stage result.',workerId:'two',criterionIds:['totals'],dependsOn:['clean']},
 {id:'report',title:'Report',instruction:'Execute node fixture.mjs report using superagent_shell, then report the actual stage result.',workerId:'three',criterionIds:['report'],dependsOn:['aggregate']},
]}
const workerPrompt='Perform only the assigned local stage. Execute the exact supplied foreground command once with superagent_shell; inspect its real result. No installations, network, external services, deployment or background work. Return ready only after a successful command. On a nonzero exit return failed with the observed error. An independent host repair is a new authorized execution; use a new operation requestId while retaining older receipts. Do not read host-private evidence or alter acceptance.'
const config=configSchema.parse({stateDir:join(root,'state'),port:0,codex:process.env.AGENTHUB_CODEX??'codex',turnTimeoutMs:300000,acceptMode:'auto',work:{sandboxDriver:process.platform==='darwin'?'seatbelt':'bubblewrap',network:false},execution:{router:{mode:'host',model:'gpt-6.1-terra',effort:'medium',prompt:'The harness has already started the exact authorized GoalContract. Inspect that existing goal; do not create goals or assign tasks. Host scheduling owns Workers, independent acceptance, repair and replanning. Reply ACCEPTED only when its durable state is completed; otherwise return an empty reply.'},management:{enabled:true,maxWorkers:3},workers:['one','two','three'].map(id=>({id,backend:'codex',model:'gpt-6.1-sol',effort:'high',tools:['superagent_shell'],prompt:workerPrompt}))},sources:[{id:'local',kind:'local',cwd,sandbox:'workspace-write',workspace:{mode:'source'},allowedActors:['operator']}]})
const host=new Runtime(config),calls:any[]=[],original=host.model.run.bind(host.model)
host.model.run=async(r:ModelRequest)=>{
 const input=JSON.parse(r.input),row:any={role:r.role,agentId:r.activity?.agentId,workerId:r.activity?.workerId,kind:input.kind,startedAt:Date.now(),inputBytes:Buffer.byteLength(r.input),inlineEvidence:input.inlineEvidence?.length??0,tools:[],budgets:[]};calls.push(row)
 try{return await original({...r,onBudget:receipt=>{row.budgets.push(receipt);r.onBudget?.(receipt)},onThread:(id:string)=>{row.threadId=id;r.onThread?.(id)},onTool:r.onTool?async(name:string,args:unknown,id:string)=>{row.tools.push(name);return r.onTool!(name,args,id)}:undefined})}
 catch(error){row.error=String(error);throw error}
 finally{row.endedAt=Date.now();save('calls',calls)}
}
const fixtureHashes=Object.fromEntries(['input.json','fixture.mjs','legacy.mjs','audit.log'].map(f=>[f,digest(readFileSync(join(cwd,f),'utf8'))]))
save('conditions',{scenario,contract,contractSha256:digest(contract),config:{router:config.execution.router,workers:config.execution.workers,work:config.work,contextBytes},fixtureHashes,implementation,sourceHashes,harnessSha256:digest(readFileSync(new URL(import.meta.url),'utf8')),runtime:{node:process.versions.node,platform:process.platform,arch:process.arch,codex:execFileSync(config.codex,['--version'],{encoding:'utf8',timeout:20000}).trim()}})
let error:string|undefined;const startedAt=Date.now()
try{
 host.scopes.command({action:'scope.put',operationId:'scope',expectedRevision:0,scope:{id:'bench',tenantId:'acceptance',name:'Matched evidence benchmark',contextBytes,managers:[JSON.stringify(['local','operator'])],workerIds:['one','two','three'],sourceIds:['local'],backendIds:['codex']}})
 host.scopes.command({action:'entry.bind',operationId:'entry',expectedRevision:0,scopeId:'bench',sourceId:'local',accountNamespace:'local',nativeId:'bench',history:'group'})
 const input=host.receive('local','operator',{id:'request',thread:'bench',scope:'bench',addressed:true,text:'Continuously process the local fixture until independent acceptance. '+objective}) as any
 const context=host.scopes.context(host.store.triggers.get(input.triggerId)!,'local:bench')!
 const initial=host.goals.command(contract,context),criteriaHash=digest(initial.criteria),objectiveHash=digest(initial.objective),authorityHash=digest(initial.contract)
 let previous=0,settled=false
 while(Date.now()-startedAt<12*60000){
  await host.tick();await new Promise(r=>setTimeout(r,100))
  const goal=host.store.list('router-goal')[0]
  assert.equal(host.scopes.scope('bench').contextBytes,contextBytes)
  assert.equal(digest(goal.criteria),criteriaHash);assert.equal(digest(goal.objective),objectiveHash);assert.equal(digest(goal.contract),authorityHash)
  if(goal.state==='held'||goal.state==='needs_input')throw Error('Goal held: '+goal.reason)
  if(goal.state==='completed'&&host.status().active===0&&host.store.jobs().length===0){settled=true;break}
  if(Date.now()-previous>15000){previous=Date.now();console.log(JSON.stringify({scenario,elapsedSeconds:Math.round((Date.now()-startedAt)/1000),state:goal.state,nodes:goal.nodes.map((n:any)=>({id:n.id,state:n.state})),reportedTokens:host.usage.summary().tokens.totalTokens}));save('progress',{at:Date.now(),goal,usage:host.usage.summary()})}
 }
 assert(settled,'Benchmark deadline exceeded')
 const normalized=JSON.parse(readFileSync(join(cwd,'normalized.json'),'utf8')),summary=JSON.parse(readFileSync(join(cwd,'summary.json'),'utf8'))
 assert.deepEqual(normalized.rows,rows.slice(0,12));assert.deepEqual(summary.totals,{A:220,B:260,C:300})
 for(const [f,hash] of Object.entries(fixtureHashes))assert.equal(digest(readFileSync(join(cwd,f),'utf8')),hash)
}catch(ex){error=String(ex);process.exitCode=1}
finally{
 const result={ok:!error,error,scenario,implementation,sourceHashes,startedAt,endedAt:Date.now(),wallMs:Date.now()-startedAt,usage:host.usage.summary(),calls,goals:host.store.list('router-goal'),rounds:host.store.list('goal-verification'),replans:host.store.list('goal-replan'),repairs:host.store.list('goal-repair'),activities:host.activity.list(),fixtureHashes}
 save('result',result);console.log(JSON.stringify({ok:result.ok,scenario,wallMs:result.wallMs,usage:result.usage,error}))
 await host.close()
}
