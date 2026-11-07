import {it,expect,afterEach} from 'vitest'
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {Runtime} from '../src/runtime.ts'
import {configSchema} from '../src/config.ts'
import type {Model,ModelRequest} from '../src/model.ts'
import type {RouterGoal} from '../src/router-goals.ts'
import type {ReplanRound} from '../src/goal-replanning.ts'

const roots:string[]=[],hosts:Runtime[]=[]
afterEach(async()=>{for(const h of hosts.splice(0))await h.close();for(const p of roots.splice(0))rmSync(p,{recursive:true,force:true})})
const ready=(summary='Done')=>({state:'ready',summary,reply:summary,question:null,askedBy:null,handbacks:[]})
async function readAll(r:ModelRequest,input:any){for(const e of input.evidence){let offset:number|null=0;do{const result:any=await r.onTool!('goal_evidence',{id:e.id,offset},e.id+':'+offset);offset=JSON.parse(result.contentItems[0].text).nextOffset}while(offset!==null)}}
function fixture(options:{proposal?:(p:any)=>any;review?:boolean;reviewExplanation?:string;blocked?:string;onPlan?:(r:ModelRequest,input:any)=>Promise<void>;onVerification?:(r:ModelRequest,input:any)=>Promise<void>}={}){
 const root=mkdtempSync(join(tmpdir(),'goal-replan-'));roots.push(root);let h!:Runtime,seq=0
 const calls:ModelRequest[]=[],attempts=new Map<string,number>()
 const config=configSchema.parse({stateDir:join(root,'state'),acceptMode:'auto',work:{sandboxDriver:'disabled'},execution:{router:{mode:'host'},management:{enabled:true,maxWorkers:2},workers:[{id:'one',backend:'codex'},{id:'two',backend:'codex'}]},sources:[{id:'local',kind:'local',cwd:root,workspace:{mode:'source'},allowedActors:['alice']}]})
 const model:Model={async run(r){calls.push(r);const threadId=r.threadId??'thread-'+(++seq);r.onThread?.(threadId);r.onTurn?.('turn-'+(++seq));const input=JSON.parse(r.input);let out:any
  if(input.kind==='goal_replanning'||input.kind==='goal_plan_review'){
   await readAll(r,input);await options.onPlan?.(r,input)
   const evidenceIds=input.evidence.map((e:any)=>e.id)
   if(input.kind==='goal_plan_review')out={approved:options.review!==false,explanation:options.reviewExplanation??(options.review===false?'Proposed task is unrelated to original objective':'New steps preserve the original contract'),evidenceIds}
   else{const p={reason:'The direct approach returned an incorrect total. Extract and normalize independent inputs before combining them.',evidenceIds,changes:[{id:'build',instruction:'COMBINE normalized intermediates into result.json; original total must remain 42',dependsOn:['extract','normalize']}],additions:[{id:'extract',title:'Extract input',instruction:'EXTRACT a.txt containing 21',workerId:'one',dependsOn:[],derivedFrom:'build',supports:['sum'],outputs:['a.txt']},{id:'normalize',title:'Normalize input',instruction:'NORMALIZE b.txt containing 21 from a.txt',workerId:'two',dependsOn:['extract'],derivedFrom:'build',supports:['sum'],outputs:['b.txt']}]};out=options.proposal?.(p)??p}
  }else if(input.kind==='goal_verification'){await readAll(r,input);await options.onVerification?.(r,input);out={checks:input.criteria.map((c:any)=>({criterionId:c.id,verdict:'passed',explanation:'Inspected complete evidence',evidenceIds:input.evidence.filter((e:any)=>c.id==='__goal__'||e.criterionIds.includes(c.id)).map((e:any)=>e.id)}))}}
  else if(r.role==='worker'){
   const id=r.activity!.ticketId!,n=(attempts.get(id)??0)+1;attempts.set(id,n)
   const node=h.goals.get(h.store.list<RouterGoal>('router-goal')[0]!.id)!.nodes!.find(x=>x.ticketId===id)!
   if(node.id==='extract')writeFileSync(join(root,'a.txt'),'21')
   else if(node.id==='normalize')writeFileSync(join(root,'b.txt'),readFileSync(join(root,'a.txt')))
   else if(node.id==='report')writeFileSync(join(root,'report.txt'),'Total '+JSON.parse(readFileSync(join(root,'result.json'),'utf8')).total)
   else if(node.id==='other'){writeFileSync(join(root,'other.txt'),'99');writeFileSync(join(root,'detail.txt'),'detail')}
   else{if(options.blocked&&n===1)return {threadId,turnId:'t',text:JSON.stringify({...ready(options.blocked),state:'blocked',reply:''})};writeFileSync(join(root,'result.json'),JSON.stringify({total:n===1?0:Number(readFileSync(join(root,'a.txt'),'utf8'))+Number(readFileSync(join(root,'b.txt'),'utf8'))}))}
   out=ready()
  }else out={reply:''}
  return {threadId,turnId:'t',text:JSON.stringify(out)}
 }}
 const open=()=>{h=new Runtime(config,{model});hosts.push(h)};open()
 h.scopes.command({action:'scope.put',operationId:'scope',expectedRevision:0,scope:{id:'team',tenantId:'org',name:'Team',managers:[JSON.stringify(['local','alice'])],workerIds:['one','two'],sourceIds:['local'],backendIds:['codex']}})
 h.scopes.command({action:'entry.bind',operationId:'entry',expectedRevision:0,scopeId:'team',sourceId:'local',accountNamespace:'local',nativeId:'test',history:'group'})
 const received=h.receive('local','alice',{id:'request',thread:'test',scope:'test',addressed:true,text:'Continuously produce the verified total 42 and a report. Change implementation when needed. Never deploy or contact external services.'}) as any
 const context=()=>h.scopes.context(h.store.triggers.get(received.triggerId)!,'local:test')!
 const start=(extra:any={})=>h.goals.command({action:'start',operationId:'start',expectedRevision:0,title:'Replanned result',objective:'Produce total 42 and report. Never deploy or contact external services.',authorizationQuote:'Continuously produce the verified total 42 and a report',maxRepairs:0,maxReplans:2,criteria:[{id:'sum',description:'Total is 42',check:{kind:'json_equals',path:'result.json',pointer:'/total',expected:42}},{id:'report',description:'Report has the total',check:{kind:'text_contains',path:'report.txt',text:'42'}}],nodes:[{id:'build',title:'Build',instruction:'INITIAL direct approach',workerId:'one',criterionIds:['sum']},{id:'report',title:'Report',instruction:'REPORT final total',workerId:'one',dependsOn:['build'],criterionIds:['report']}],...extra},context()) as RouterGoal
 return {root,get h(){return h},calls,attempts,context,start,goal:()=>h.store.list<RouterGoal>('router-goal')[0]!,plans:()=>h.store.list<ReplanRound>('goal-replan'),restart:async()=>{hosts.splice(hosts.indexOf(h),1);await h.close();open()}}
}
async function until(f:ReturnType<typeof fixture>,predicate:()=>boolean){for(let i=0;i<2000;i++){await f.h.tick();await new Promise(r=>setTimeout(r,2));if(predicate())return}throw Error(JSON.stringify({attempts:[...f.attempts],runs:f.h.store.list('run'),jobs:f.h.store.db.prepare('SELECT id,state,error FROM jobs').all(),goal:f.goal(),plans:f.plans().map(({snapshot,...r})=>r)}))}

it('changes strategy, splits work and rewires dependencies while retaining the original contract and failed task',async()=>{
 const f=fixture(),original=f.start();await until(f,()=>f.goal().state==='completed')
 expect(f.goal().contract).toEqual(original.contract);expect(f.goal().criteria).toEqual(original.criteria);expect(f.goal().objective).toBe(original.objective)
 expect(f.goal().replans).toBe(1);expect(f.plans()[0]?.state).toBe('applied');expect(f.goal().nodes?.find(n=>n.id==='build')?.dependsOn).toEqual(['extract','normalize'])
 expect(f.goal().taskIds).toHaveLength(4);expect([...f.attempts.values()].sort()).toEqual([1,1,1,2]);expect(f.h.store.list('goal-plan-dispatch')).toHaveLength(1)
 const task=f.goal().nodes!.find(n=>n.id==='build')!.ticketId!,threads=f.calls.filter(r=>r.activity?.ticketId===task).map(r=>r.threadId).filter(Boolean);expect(new Set(threads).size).toBe(1)
 expect(f.calls.filter(r=>['goal_replanning','goal_plan_review'].includes(JSON.parse(r.input).kind)).every(r=>r.threadId===undefined&&r.tools?.length===1&&r.managed&&r.sandbox==='read-only')).toBe(true)
 for(const r of f.calls.filter(r=>['goal_replanning','goal_plan_review'].includes(JSON.parse(r.input).kind))){expect(JSON.parse(r.input).replanningPolicy).toEqual({samePlanRepairsPerNode:0,successfulReplansUsed:0,maxSuccessfulReplans:2,stoppedTasksAllowed:false});expect(r.instructions).toContain('not a human stop')}
})
it('recovers a queued plan and then an applied graph across two restarts without duplicate tasks',async()=>{
 const f=fixture();f.start();await until(f,()=>f.h.store.list<any>('goal-verification').some(r=>r.state==='failed'))
 await f.h.goals.advance();expect(f.plans()[0]?.state).toBe('pending');await f.restart()
 await until(f,()=>f.plans()[0]?.state==='applied');expect(f.goal().planRevision).toBe(1);await f.restart();await until(f,()=>f.goal().state==='completed')
 expect(f.plans()).toHaveLength(1);expect(f.goal().taskIds).toHaveLength(4);expect(f.h.store.list('goal-plan-dispatch')).toHaveLength(1)
})
it('retains open-task execution evidence when unrelated review activity exceeds the display history window',async()=>{
 let f!:ReturnType<typeof fixture>
 f=fixture({onPlan:async(_r,input)=>{if(input.kind==='goal_plan_review')for(let i=0;i<220;i++){const id=f.h.activity.begin('tool','unrelated-read');f.h.activity.finish(id,'completed')}}})
 f.start();await f.h.goals.advance()
 const ticketId=f.goal().nodes![0]!.ticketId!
 await f.h.activity.tool('superagent_shell',{ticketId},async()=>({success:true}))
 const retained=f.h.activity.list().find(c=>c.ticketId===ticketId&&c.kind==='tool')!.id
 await until(f,()=>f.plans().some(r=>['applied','stale','errored'].includes(r.state)))
 expect(f.plans()[0]?.state).toBe('applied');expect(f.h.activity.list().some(c=>c.id===retained)).toBe(true)
 await until(f,()=>f.goal().state==='completed')
 for(let i=0;i<220;i++){const id=f.h.activity.begin('tool','after-completion');f.h.activity.finish(id,'completed')}
 expect(f.h.activity.list().some(c=>c.id===retained)).toBe(false)
 expect(f.h.activity.list().filter(c=>c.state!=='running')).toHaveLength(200)
})
it('supplies accepted upstream execution evidence to a dependent verifier without changing its acceptance criteria',async()=>{
 let ledgers:string[]=[],evidence:any[]=[],overallEvidence:any[]=[]
 const f=fixture({onVerification:async(_r,input)=>{if(input.criteria.some((c:any)=>c.id==='__goal__'))overallEvidence=input.evidence;if(input.criteria.length===1&&input.criteria[0].id==='report'){evidence=input.evidence;ledgers=input.evidence.filter((e:any)=>e.kind==='execution'&&e.criterionIds.includes('report')).map((e:any)=>e.ticketId)}}})
 const original=f.start({criteria:[{id:'sum',description:'Total is 42',check:{kind:'json_equals',path:'result.json',pointer:'/total',expected:42}},{id:'report',description:'Report is supported by accepted upstream work',files:['report.txt','result.json']}]})
 await until(f,()=>f.goal().state==='completed')
 expect(new Set(ledgers)).toEqual(new Set(f.goal().taskIds));expect(f.goal().criteria).toEqual(original.criteria)
 expect(evidence.every(e=>e.criterionIds.includes('report'))).toBe(true)
 expect(overallEvidence.length).toBeGreaterThan(0);expect(overallEvidence.every(e=>e.criterionIds.includes('report'))).toBe(true)
 const build=f.goal().nodes!.find(n=>n.id==='build')!,round=f.h.store.get<any>('goal-verification',build.roundId!)!
 expect(round.snapshot.evidence.filter((e:any)=>e.kind==='file'&&e.ticketId!==build.ticketId).every((e:any)=>!e.criterionIds.includes('sum'))).toBe(true)
})
it('invalidates dependent verification when a prerequisite artifact changes during its review',async()=>{
 let f!:ReturnType<typeof fixture>,changed=false
 f=fixture({onVerification:async(_r,input)=>{if(!changed&&input.criteria.length===1&&input.criteria[0].id==='report'){changed=true;writeFileSync(join(f.root,'a.txt'),'22')}}})
 f.start({criteria:[{id:'sum',description:'Total is 42',check:{kind:'json_equals',path:'result.json',pointer:'/total',expected:42}},{id:'report',description:'Report is supported by accepted upstream work',files:['report.txt','result.json']}]})
 await until(f,()=>f.goal().state==='held')
 expect(changed).toBe(true);expect(f.h.store.list<any>('goal-verification').find(r=>r.nodeId==='report')?.state).toBe('stale');expect(f.h.store.list('goal-release')).toHaveLength(0)
})
it('does not associate unrelated branch evidence with a semantic criterion during overall acceptance',async()=>{
 let overall:any[]=[]
 const f=fixture({onVerification:async(_r,input)=>{if(input.criteria.some((c:any)=>c.id==='__goal__'))overall=input.evidence}})
 f.start({objective:'Produce total 42 and report, plus an independent marker 99. Never deploy or contact external services.',criteria:[{id:'sum',description:'Total is 42',check:{kind:'json_equals',path:'result.json',pointer:'/total',expected:42}},{id:'report',description:'Report has supported total',files:['report.txt','result.json']},{id:'other',description:'Independent marker',check:{kind:'text_contains',path:'other.txt',text:'99'}}],nodes:[{id:'build',title:'Build',instruction:'INITIAL direct approach',workerId:'one',criterionIds:['sum']},{id:'report',title:'Report',instruction:'REPORT total',workerId:'one',dependsOn:['build'],criterionIds:['report']},{id:'other',title:'Independent marker',instruction:'Write marker 99',workerId:'two',criterionIds:['other']}]})
 await until(f,()=>f.goal().state==='completed')
 const other=f.goal().nodes!.find(n=>n.id==='other')!.ticketId!,items=overall.filter(e=>e.ticketId===other)
 expect(items.length).toBeGreaterThan(0);expect(items.every(e=>!e.criterionIds.includes('report'))).toBe(true)
 expect(overall.filter(e=>e.ticketId!==other).every(e=>e.criterionIds.includes('report'))).toBe(true)
})
it('keeps ancestor citations when a semantic criterion has multiple dependent owner nodes',async()=>{
 let overall:any[]=[]
 const f=fixture({onVerification:async(_r,input)=>{if(input.criteria.some((c:any)=>c.id==='__goal__'))overall=input.evidence}})
 f.start({objective:'Inspect marker 99 and detail across dependent steps',maxReplans:0,criteria:[{id:'shared',description:'Inspect marker 99',files:['other.txt']},{id:'detail',description:'Preserve independent detail',check:{kind:'text_contains',path:'detail.txt',text:'detail'}}],nodes:[{id:'other',title:'Prepare marker',instruction:'Write marker and detail',workerId:'one',criterionIds:['shared','detail']},{id:'extract',title:'Inspect marker',instruction:'Inspect marker after its preparation',workerId:'two',dependsOn:['other'],criterionIds:['shared']}]})
 await until(f,()=>f.goal().state==='completed')
 const upstream=f.goal().nodes!.find(n=>n.id==='other')!.ticketId!
 expect(overall.find(e=>e.ticketId===upstream&&e.kind==='file'&&e.key==='detail.txt')?.criterionIds).toContain('shared')
})
it('rejects a proposed change to acceptance fields and prevents direct objective changes',async()=>{
 const f=fixture({proposal:p=>({...p,criteria:[]})}),g=f.start()
 expect(()=>f.h.goals.command({action:'update',id:g.id,operationId:'weaken',expectedRevision:g.revision,objective:'Any result'},f.context())).toThrow('immutable')
 await until(f,()=>f.goal().state==='held');expect(f.plans()[0]?.state).toBe('errored');expect(f.goal().taskIds).toHaveLength(1);expect(f.h.store.list('goal-release')).toHaveLength(0)
})
it('rejects cyclic plans, unrelated steps, unauthorized workers and escaping output paths',async()=>{
 for(const mutate of [(p:any)=>{p.additions[0].dependsOn=['build']},(p:any)=>{p.changes[0].dependsOn=[]},(p:any)=>{p.additions[0].workerId='outside'},(p:any)=>{p.additions[0].outputs=['../secret']}]){
  const f=fixture({proposal:p=>{mutate(p);return p}});f.start();await until(f,()=>f.goal().state==='held');expect(f.plans()[0]?.state).toBe('errored');expect(f.goal().taskIds).toHaveLength(1)
 }
})
it('does not apply a structurally valid plan rejected by the independent authorization review',async()=>{
 const f=fixture({review:false});f.start();await until(f,()=>f.goal().state==='held');expect(f.plans()[0]?.state).toBe('rejected');expect(f.goal().planRevision).toBe(0);expect(f.goal().taskIds).toHaveLength(1)
})
it('does not replan around permission failures, uncertain effects or an explicitly disabled replan allowance',async()=>{
 for(const blocked of ['Permission forbidden: deployment not authorized','Execution uncertain after network failure']){const f=fixture({blocked});f.start();await until(f,()=>f.goal().state==='held');expect(f.plans()).toHaveLength(0)}
 const f=fixture();f.start({maxReplans:0});await until(f,()=>f.goal().state==='held');expect(f.plans()).toHaveLength(0)
})
it('waits for the failed Worker notification to flush before autonomously replanning',async()=>{
 const f=fixture({blocked:'Legacy parser rejected the input schema'});f.start()
 // A normal failed native report routes a pending attention message to the Router.
 const original=f.h.replanning.consider.bind(f.h.replanning);let checked=false
 f.h.replanning.consider=g=>{checked=true;return original(g)}
 await until(f,()=>f.h.store.tickets.list().some(t=>t.assignments.at(-1)?.report?.state==='blocked'))
 const task=f.h.store.tickets.list()[0]!
 f.h.store.outbox.send({id:'pending-failure',ticketId:task.id,channel:task.channels[0]!,kind:'reply',text:'Failure evidence available'})
 checked=false;await f.h.goals.advance();expect(checked).toBe(false);expect(f.goal().state).toBe('active')
 f.h.store.db.prepare("UPDATE outbox SET status='sent' WHERE id='pending-failure'").run()
 await until(f,()=>f.goal().state==='completed');expect(f.goal().replans).toBe(1)
})
it('does not let a stale plan hold a goal explicitly resumed during planning',async()=>{
 let f!:ReturnType<typeof fixture>,resumed=false
 f=fixture({onPlan:async(_r,input)=>{if(input.kind==='goal_replanning'&&!resumed){resumed=true;let g=f.goal();f.h.goals.command({action:'pause',id:g.id,operationId:'pause',expectedRevision:g.revision},f.context());g=f.goal();f.h.goals.command({action:'resume',id:g.id,operationId:'resume',expectedRevision:g.revision},f.context())}}});f.start()
 await until(f,()=>f.plans()[0]?.state==='stale');expect(f.goal().state).toBe('active');expect(f.goal().replanId).toBeUndefined()
})
it('invalidates a planning result when a human pauses the goal during reasoning',async()=>{
 let f!:ReturnType<typeof fixture>,paused=false
 f=fixture({onPlan:async(_r,input)=>{if(input.kind==='goal_replanning'&&!paused){paused=true;const g=f.goal();f.h.goals.command({action:'pause',id:g.id,operationId:'pause',expectedRevision:g.revision},f.context())}}});f.start()
 await until(f,()=>f.plans()[0]?.state==='stale');expect(f.goal().state).toBe('paused');expect(f.goal().taskIds).toHaveLength(1)
})
it('does not apply a plan after the original source is revoked during independent review',async()=>{
 let f!:ReturnType<typeof fixture>
 f=fixture({onPlan:async(_r,input)=>{if(input.kind==='goal_plan_review')f.h.store.put('source-invalid-trigger',f.goal().triggerId,{triggerId:f.goal().triggerId,reason:'Source withdrawn'})}});f.start()
 await until(f,()=>f.plans()[0]?.state==='stale'||f.plans()[0]?.state==='errored');expect(f.goal().planRevision).toBe(0);expect(f.h.store.list('goal-release')).toHaveLength(0)
})
it('hides rejected plan text when the document it was derived from is deleted',async()=>{
 const f=fixture({proposal:p=>({...p,reason:'REVOKED_DOCUMENT_SENTINEL'}),review:false,reviewExplanation:'REVOKED_DOCUMENT_SENTINEL'})
 const doc=f.h.knowledge.command({action:'put',operationId:'doc',expectedRevision:0,title:'Evidence',content:'REVOKED_DOCUMENT_SENTINEL'},f.context())
 f.start({criteria:[{id:'sum',description:'Total is 42',documents:[doc.id],check:{kind:'json_equals',path:'result.json',pointer:'/total',expected:42}},{id:'report',description:'Report has total',check:{kind:'text_contains',path:'report.txt',text:'42'}}]})
 await until(f,()=>f.goal().state==='held')
 expect(f.goal().reason).toContain('REVOKED_DOCUMENT_SENTINEL')
 expect(f.h.store.deliveries().filter(d=>d.id.startsWith('goal-notice:')).every(d=>!d.text.includes('REVOKED_DOCUMENT_SENTINEL'))).toBe(true)
 // Also cover persisted rounds from the earlier implementation, without goal-level provenance.
 f.h.store.put('router-goal',f.goal().id,{...f.goal(),contextIds:[]})
 f.h.knowledge.command({action:'delete',id:doc.id,operationId:'delete',expectedRevision:1},f.context())
 expect(()=>f.h.knowledge.command({action:'read',id:doc.id},f.context())).toThrow()
 expect(()=>f.h.goals.command({action:'inspect',id:f.goal().id},f.context())).toThrow('unavailable')
 expect(JSON.stringify(f.h.goals.list(f.context()))).not.toContain('REVOKED_DOCUMENT_SENTINEL')
})
it('resumes an interrupted independent review after orderly host shutdown without repeating the proposal',async()=>{
 let reviewing=false
 const f=fixture({onPlan:async(r,input)=>{if(input.kind==='goal_plan_review'&&!reviewing){reviewing=true;await new Promise<void>((_ok,reject)=>r.signal!.addEventListener('abort',()=>reject(Error('Native turn interrupted by host shutdown')),{once:true}))}}})
 f.start();await until(f,()=>reviewing);await f.restart()
 expect(f.goal().state).toBe('active');expect(f.plans()[0]?.state).toBe('reviewing')
 await until(f,()=>f.goal().state==='completed')
 expect(f.calls.filter(r=>JSON.parse(r.input).kind==='goal_replanning')).toHaveLength(1)
 expect(f.plans()).toHaveLength(1);expect(f.h.store.list('goal-plan-dispatch')).toHaveLength(1)
})
