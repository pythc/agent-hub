import {mkdtempSync,rmSync,writeFileSync,appendFileSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {afterEach,expect,it,vi} from 'vitest'
import * as XLSX from 'xlsx'
import {Runtime} from '../src/runtime.ts'
import {configSchema} from '../src/config.ts'
import {projectTaskStatus} from '../src/execution-status.ts'
import {ExecutionTrace} from '../src/execution-trace.ts'
import {stableDigest} from '../src/sources.ts'
import type {Ticket} from '../src/vendor/dsh-core/index.ts'
import type {RouterGoal} from '../src/router-goals.ts'
import type {GoalCriterion} from '../src/goal-contract.ts'
import type {Run} from '../src/store.ts'
import type {VerificationRound} from '../src/goal-verification.ts'

const roots:string[]=[],hosts:Runtime[]=[]
afterEach(async()=>{for(const host of hosts.splice(0))await host.close();for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true})})
function fixture(){
 const root=mkdtempSync(join(tmpdir(),'execution-status-'));roots.push(root)
 const config=configSchema.parse({stateDir:join(root,'state'),acceptMode:'auto',work:{sandboxDriver:'disabled',autoRecover:false},execution:{router:{mode:'host'},management:{enabled:true,maxWorkers:2},workers:[{id:'one',backend:'codex'},{id:'two',backend:'codex'}]},sources:[{id:'local',kind:'local',cwd:root,workspace:{mode:'source'},allowedActors:['alice']}]})
 const host=new Runtime(config,{model:{describe:()=>({id:'codex',kind:'codex',resume:true,images:false,nativeTakeover:false,tools:true,steering:false,promptRefresh:false}),async history(){return {turns:[]}},async run(){throw Error('This fixture must never invoke inference')}}});hosts.push(host)
 host.scopes.command({action:'scope.put',operationId:'scope',expectedRevision:0,scope:{id:'team',tenantId:'org',name:'Team',contextBytes:128000,managers:[JSON.stringify(['local','alice'])],workerIds:['one','two'],sourceIds:['local'],backendIds:['codex']}})
 host.scopes.command({action:'entry.bind',operationId:'entry',expectedRevision:0,scopeId:'team',sourceId:'local',accountNamespace:'local',nativeId:'topic',history:'group'})
 const {triggerId}=host.receive('local','alice',{id:'request',thread:'topic',scope:'topic',text:'Continuously produce and verify the requested result. Never deploy.',addressed:true}) as {triggerId:string}
 const trigger=host.store.triggers.get(triggerId)!,context=host.scopes.context(trigger,'local:topic')!
 const trace=new ExecutionTrace(()=>host)
 return {host,root,context,trigger,trace}
}
async function task(f:ReturnType<typeof fixture>,key='task'){
 const result=await f.host.manager.call({action:'assign',id:'one',revision:f.host.settings.current().revision,requestId:key,text:'Produce a result'}, {discussion:'local:topic',trigger:f.trigger,scoped:f.context})
 return f.host.store.tickets.get(result.ticketId)!
}
function current(f:ReturnType<typeof fixture>,ticket:Ticket){return f.host.store.tickets.get(ticket.id)!}
function run(f:ReturnType<typeof fixture>,ticket:Ticket,phase:Run['phase']='idle',report?:'ready'|'failed'|'waiting'){
 const assignment=current(f,ticket).assignments.at(-1)!
 if(assignment.state==='pending')f.host.engine.assignmentStarted(ticket.id,assignment.id)
 f.host.store.put('run',ticket.id,{ticketId:ticket.id,assignmentId:assignment.id,cwd:f.root,phase,threadId:'fixture-session',backendId:'codex',workerId:'one',...(report==='ready'?{result:'Actual result'}:{})} satisfies Run)
 f.host.store.db.prepare("UPDATE jobs SET state='done' WHERE json_extract(payload,'$.ticketId')=? AND json_extract(payload,'$.assignmentId')=?").run(ticket.id,assignment.id)
 if(report)f.host.engine.report(ticket.id,{state:report,summary:'SECRET_REPORT',question:null})
 return current(f,ticket)
}
async function message(f:ReturnType<typeof fixture>,ticket:Ticket,id:string,status:string,kind:'reply'|'notice'|'acknowledgement'='reply',external=false,text='Actual result',attempts=0){
 // Use a genuinely later observation time for normal delivery proofs. The
 // Engine clock can run a few milliseconds ahead of wall time.
 const reportAt=Date.parse(current(f,ticket).assignments.at(-1)?.report?.at??'')
 if(Number.isFinite(reportAt)&&Date.now()<=reportAt)await new Promise<void>(resolve=>setTimeout(resolve,reportAt-Date.now()+2))
 f.host.store.outbox.send({id,ticketId:ticket.id,kind,text,channel:{source:external?'external':'local',thread:'topic',address:external?{thread:'topic'}:{routerInbox:'local:topic'}}})
 f.host.store.db.prepare('UPDATE outbox SET status=?,attempts=? WHERE id=?').run(status,attempts,id)
}
function dbState(f:ReturnType<typeof fixture>){
 const result:Record<string,unknown>={}
 const tables=f.host.store.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(r=>String(r.name))
 for(const table of tables){if(/^[a-z_]+$/.test(table))result[table]=f.host.store.db.prepare('SELECT * FROM '+table).all()}
 return JSON.stringify(result,(_,v)=>typeof v==='bigint'?String(v):v instanceof Uint8Array?Array.from(v):v)
}
async function accepted(f:ReturnType<typeof fixture>,criteria:GoalCriterion[]=[{id:'result',description:'Produce a result',files:[],documents:[]}]){
 const goal=f.host.goals.command({action:'start',operationId:'start',expectedRevision:0,title:'Evidence goal',objective:'Produce the requested result',authorizationQuote:'Continuously produce and verify',criteria,nodes:[{id:'build',title:'Build',instruction:'Produce the result',workerId:'one',criterionIds:criteria.map(c=>c.id)}]},f.context) as RouterGoal
 const ticket=await task(f,'goal-task');run(f,ticket)
 goal.taskIds=[ticket.id];goal.nodes![0]!.ticketId=ticket.id;goal.nodes![0]!.state='running'
 f.host.store.put('router-goal',goal.id,goal)
 f.host.verification.capture(ticket.id,{state:'ready',summary:'Actual result'},'Actual result')
 const round=f.host.verification.ensure(goal,goal.nodes![0])
 round.state='passed';f.host.store.put('goal-verification',round.id,round)
 goal.nodes![0]!.roundId=round.id;goal.nodes![0]!.state='passed';f.host.store.put('router-goal',goal.id,goal)
 return {ticket:current(f,ticket),goal,round}
}


function attachContext(f:ReturnType<typeof fixture>,ticket:Ticket,goal:RouterGoal){
 const packet=f.host.memory.build(f.context,{request:'Inspect retained task context'},'codex'),owner=f.host.scopes.ownership(ticket.id)!
 packet.manifest.taskOwners=[{id:ticket.id,epoch:owner.ownerEpoch,dataRevision:owner.dataRevision??1}]
 f.host.store.put('context-manifest',packet.manifest.id,packet.manifest)
 f.host.store.put('task-context',ticket.id,{manifest:packet.manifest})
 goal.contextIds=[...(goal.contextIds??[]),packet.manifest.id]
 f.host.store.put('router-goal',goal.id,goal)
}

it('returns independent conservative facets for an unstarted assignment',async()=>{
 const f=fixture(),ticket=await task(f),status=projectTaskStatus(f.host,ticket,123)
 expect(status).toMatchObject({schema:1,observedAt:123,execution:{state:'queued'},effects:{state:'not_recorded',receiptCount:0},acceptance:{state:'not_recorded',freshness:'not_recorded'},delivery:{state:'not_recorded',evidence:'none',scope:'not_recorded'}})
})
it('does not treat an idle run without a ready result as finished',async()=>{
 const f=fixture(),ticket=await task(f);run(f,ticket)
 f.host.store.db.prepare("UPDATE jobs SET state='done' WHERE json_extract(payload,'$.ticketId')=?").run(ticket.id)
 expect(projectTaskStatus(f.host,current(f,ticket)).execution.state).toBe('waiting_input')
})
it('separates a finished execution from pending delivery and missing acceptance',async()=>{
 const f=fixture(),ticket=await task(f);run(f,ticket,'idle','ready');await message(f,ticket,'final','pending','reply',true)
 const status=projectTaskStatus(f.host,current(f,ticket))
 expect(status.execution.state).toBe('finished');expect(status.acceptance.state).toBe('not_recorded');expect(status.delivery).toMatchObject({state:'pending',evidence:'none',scope:'external'})
})
it('uses the current assignment instead of a stale run or older ready/failed reports',async()=>{
 const f=fixture(),ticket=await task(f);run(f,ticket,'idle','ready')
 const old=current(f,ticket),next={id:'new-assignment',state:'running' as const,createdAt:new Date().toISOString()}
 f.host.store.put('ticket',ticket.id,{...old,ended:undefined,assignments:[...old.assignments,next]})
 f.host.store.put('run',ticket.id,{...f.host.store.get<Run>('run',ticket.id)!,assignmentId:next.id,phase:'running'})
 f.host.store.enqueue('old-failure','execute',{ticketId:ticket.id,assignmentId:old.assignments.at(-1)!.id});f.host.store.jobState('old-failure','failed')
 expect(projectTaskStatus(f.host,current(f,ticket)).execution.state).toBe('running')
 f.host.store.put('run',ticket.id,{...f.host.store.get<Run>('run',ticket.id)!,assignmentId:old.assignments.at(-1)!.id,phase:'idle'})
 expect(projectTaskStatus(f.host,current(f,ticket)).execution.state).not.toBe('finished')
})
it('does not let an older failed work item mark a new ready assignment failed',async()=>{
 const f=fixture(),ticket=await task(f);run(f,ticket,'idle','failed')
 const old=current(f,ticket),oldId=old.assignments.at(-1)!.id,next={id:'new-ready',state:'running' as const,createdAt:new Date().toISOString(),report:{state:'ready' as const,summary:'Actual result',at:new Date().toISOString()}}
 f.host.store.put('ticket',ticket.id,{...old,ended:undefined,assignments:[...old.assignments,next]})
 f.host.store.put('run',ticket.id,{...f.host.store.get<Run>('run',ticket.id)!,assignmentId:next.id,phase:'idle',result:'Actual result'})
 f.host.store.put('work','old-work',{id:'old-work',ticketId:ticket.id,assignmentId:oldId,state:'failed',kind:'shell'})
 expect(projectTaskStatus(f.host,current(f,ticket)).execution.state).toBe('finished')
})
it('keeps cancellation and an uncertain old effect visible at the same time without changing recovery',async()=>{
 const f=fixture(),ticket=await task(f);run(f,ticket)
 f.host.store.put('tool-receipt','unknown',{id:'unknown',ticketId:ticket.id,state:'uncertain',connection:'fixture',tool:'fixture'})
 await f.host.stop(ticket.id)
 const before=dbState(f),status=projectTaskStatus(f.host,current(f,ticket)),view=f.trace.snapshot({ticketId:ticket.id}).tasks[0]!
 expect(status).toMatchObject({execution:{state:'cancelled'},effects:{state:'unknown',receiptCount:1}})
 expect(view.actions).not.toContain('resume_session');expect(view.unknownEffects).toBe(true);expect(dbState(f)).toBe(before)
})
it('calls a complete tool error recorded rather than verified success and never returns secrets',async()=>{
 const f=fixture(),ticket=await task(f);run(f,ticket)
 f.host.store.put('tool-receipt','error',{id:'error',ticketId:ticket.id,state:'complete',connection:'fixture',tool:'fixture',result:{isError:true,content:[{type:'text',text:'SECRET_TOKEN PRIVATE_REASONING'}]}})
 const status=projectTaskStatus(f.host,current(f,ticket))
 expect(status.effects).toEqual({state:'recorded',receiptCount:1});expect(JSON.stringify(status)).not.toMatch(/SECRET_|PRIVATE_REASONING|success|confirmed|readback/)
})
it.each(['pr-delivery','review-action','merge-attempt'])('includes unresolved %s in the effect facet',async kind=>{
 const f=fixture(),ticket=await task(f);run(f,ticket,'idle','ready')
 const key=kind==='pr-delivery'?ticket.id+':branch':'repository-effect'
 if(kind==='merge-attempt')f.host.store.put('merge-grant',key,{ticketId:ticket.id})
 f.host.store.put(kind,key,{ticketId:ticket.id,id:ticket.id,phase:kind==='review-action'?'pending':'uncertain'})
 expect(projectTaskStatus(f.host,current(f,ticket)).effects.state).toBe('unknown')
})
it('uses the verifier current check and leaves ready output waiting for independent acceptance',async()=>{
 const f=fixture(),a=await accepted(f),spy=vi.spyOn(f.host.verification,'current')
 const status=projectTaskStatus(f.host,current(f,a.ticket))
 expect(status).toMatchObject({execution:{state:'finished'},acceptance:{state:'passed',freshness:'current'},delivery:{state:'not_recorded'}})
 expect(spy).toHaveBeenCalledWith(expect.objectContaining({id:a.round.id}),expect.objectContaining({id:a.goal.id}),{readOnly:true})
 const round={...a.round,state:'pending' as const};f.host.store.put('goal-verification',round.id,round)
 expect(projectTaskStatus(f.host,current(f,a.ticket)).acceptance).toEqual({state:'pending',freshness:'current'})
})
it('marks a retained passed round stale when its current text artifact changes',async()=>{
 const f=fixture();writeFileSync(join(f.root,'result.txt'),'before')
 const a=await accepted(f,[{id:'file',description:'Read result',files:['result.txt'],documents:[]}])
 expect(projectTaskStatus(f.host,current(f,a.ticket)).acceptance.state).toBe('passed')
 writeFileSync(join(f.root,'result.txt'),'after')
 expect(projectTaskStatus(f.host,current(f,a.ticket)).acceptance).toEqual({state:'stale',freshness:'stale'})
})
it('invalidates acceptance when a declared document changes',async()=>{
 const f=fixture(),document=f.host.knowledge.command({action:'put',operationId:'doc',expectedRevision:0,title:'Source',content:'Before'},f.context)
 const a=await accepted(f,[{id:'doc',description:'Read source',files:[],documents:[document.id]}])
 expect(projectTaskStatus(f.host,current(f,a.ticket)).acceptance.state).toBe('passed')
 f.host.knowledge.command({action:'put',id:document.id,operationId:'edit-doc',expectedRevision:1,title:'Source',content:'After'},f.context)
 expect(projectTaskStatus(f.host,current(f,a.ticket)).acceptance).toEqual({state:'stale',freshness:'stale'})
})
it('invalidates the old input revision without rewriting its retained passed verdict',async()=>{
 const f=fixture(),a=await accepted(f),owner=f.host.scopes.ownership(a.ticket.id)!
 f.host.store.put('task-ownership',a.ticket.id,{...owner,dataRevision:(owner.dataRevision??1)+1})
 expect(projectTaskStatus(f.host,current(f,a.ticket)).acceptance).toEqual({state:'stale',freshness:'stale'})
 expect(f.host.store.get<VerificationRound>('goal-verification',a.round.id)!.state).toBe('passed')
})
it('does not claim legacy passed snapshots or old-assignment snapshots are current',async()=>{
 const f=fixture(),a=await accepted(f)
 f.host.store.put('goal-verification',a.round.id,{...a.round,snapshot:undefined})
 expect(projectTaskStatus(f.host,current(f,a.ticket)).acceptance).toEqual({state:'stale',freshness:'unknown'})
 f.host.store.put('goal-verification',a.round.id,{...a.round,snapshot:{...a.round.snapshot,tasks:[null]}})
 expect(projectTaskStatus(f.host,current(f,a.ticket)).acceptance).toEqual({state:'stale',freshness:'unknown'})
 f.host.store.put('goal-verification',a.round.id,{...a.round,snapshot:{...a.round.snapshot,tasks:a.round.snapshot.tasks.map(t=>({...t,assignmentId:'old-assignment'}))}})
 expect(projectTaskStatus(f.host,current(f,a.ticket)).acceptance).toEqual({state:'stale',freshness:'stale'})
})
it('follows the selected node round and ignores newer unrelated or historical goal rounds',async()=>{
 const f=fixture(),a=await accepted(f)
 f.host.store.put('goal-verification',a.round.id,{...a.round,state:'failed'})
 f.host.store.put('goal-verification','unrelated',{...a.round,id:'unrelated',goalId:'another-goal',state:'passed',at:a.round.at+100000})
 expect(projectTaskStatus(f.host,current(f,a.ticket)).acceptance).toEqual({state:'failed',freshness:'current'})
})
it.each(['completed','cancelled'] as const)('checks retained acceptance for a %s goal rather than ignoring terminal goals',async state=>{
 const f=fixture(),a=await accepted(f)
 f.host.store.put('router-goal',a.goal.id,{...a.goal,state})
 expect(f.host.goals.forTask(a.ticket.id)).toBeUndefined()
 expect(projectTaskStatus(f.host,current(f,a.ticket)).acceptance).toEqual({state:'passed',freshness:'current'})
})
it('uses the applicable final round rather than promoting an older node verdict',async()=>{
 const f=fixture(),a=await accepted(f),final=f.host.verification.ensure(a.goal)
 f.host.store.put('goal-verification',final.id,{...final,state:'insufficient'})
 f.host.store.put('router-goal',a.goal.id,{...a.goal,finalRoundId:final.id})
 expect(projectTaskStatus(f.host,current(f,a.ticket)).acceptance).toEqual({state:'insufficient',freshness:'current'})
})
it('reports mixed delivery progress and gives unknown delivery priority over older sent receipts',async()=>{
 const f=fixture(),ticket=await task(f);run(f,ticket,'idle','ready')
 await message(f,ticket,'local-result','sent');await message(f,ticket,'external-result','pending','reply',true)
 expect(projectTaskStatus(f.host,current(f,ticket)).delivery).toMatchObject({state:'partial',evidence:'host_record',scope:'mixed',counts:{total:2,recorded:1,pending:1}})
 f.host.store.deliveryFailed('external-result',1,'SECRET_ERROR',true)
 expect(projectTaskStatus(f.host,current(f,ticket)).delivery).toMatchObject({state:'uncertain',evidence:'host_record',scope:'mixed',counts:{uncertain:1,recorded:1}})
})
it('does not turn sent progress or an old result body into current result delivery',async()=>{
 const f=fixture(),ticket=await task(f);run(f,ticket,'idle','ready')
 await message(f,ticket,'notice','sent','notice',true);await message(f,ticket,'ack','sent','acknowledgement',true);await message(f,ticket,'old-reply','sent','reply',true,'An older result')
 expect(projectTaskStatus(f.host,current(f,ticket)).delivery).toMatchObject({state:'not_recorded',evidence:'none',counts:{total:0}})
})
it('distinguishes retry delay, local records and host-only external records',async()=>{
 const f=fixture(),ticket=await task(f);run(f,ticket,'idle','ready');await message(f,ticket,'retry','pending','reply',true,'Actual result',2)
 expect(projectTaskStatus(f.host,current(f,ticket)).delivery).toMatchObject({state:'retry_wait',scope:'external',evidence:'none',counts:{retry_wait:1}})
 f.host.store.delivered('retry')
 expect(projectTaskStatus(f.host,current(f,ticket)).delivery).toMatchObject({state:'recorded',scope:'external',evidence:'host_record'})
})
it('adds a status facet while retaining legacy trace fields and recovery action meanings',async()=>{
 const f=fixture(),ticket=await task(f);run(f,ticket,'idle','ready')
 const result=f.trace.snapshot({ticketId:ticket.id}).tasks[0]!
 expect(result).toMatchObject({id:ticket.id,state:'ended',phase:'idle',hasResult:true,evidence:{deployment:'unverified'},status:{schema:1,execution:{state:'finished'}}})
 expect(result.actions).toContain('inspect');expect(result.actions).not.toContain('resume_session')
})
it('does not register a changed binary artifact or write any database fact during repeated GET-style projections',async()=>{
 const f=fixture();writeFileSync(join(f.root,'report.pdf'),Buffer.from('%PDF-1.4 old'))
 const a=await accepted(f,[{id:'pdf',description:'Inspect report',files:['report.pdf'],documents:[]}])
 attachContext(f,a.ticket,a.goal)
 expect(projectTaskStatus(f.host,current(f,a.ticket)).acceptance.state).toBe('passed')
 writeFileSync(join(f.root,'report.pdf'),Buffer.from('%PDF-1.4 changed'))
 const before=dbState(f)
 for(let n=0;n<3;n++){expect(projectTaskStatus(f.host,current(f,a.ticket)).acceptance.state).toBe('stale');expect(f.trace.snapshot({ticketId:a.ticket.id}).tasks[0]!.status.acceptance.state).toBe('stale')}
 expect(dbState(f)).toBe(before)
 // Existing execution callers retain their original default capture behavior.
 expect(f.host.verification.current(a.round,a.goal)).toBe(false)
 expect(f.host.store.list('goal-artifact')).toHaveLength(2)
})
it('does not reconstruct a missing workbook cache on an observation request',async()=>{
 const f=fixture(),book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([[42]]),'Ledger')
 writeFileSync(join(f.root,'ledger.xlsx'),XLSX.write(book,{type:'buffer',bookType:'xlsx'}))
 const a=await accepted(f,[{id:'cell',description:'A1 is 42',files:[],documents:[],check:{kind:'xlsx_cell_equals',path:'ledger.xlsx',sheet:'Ledger',cell:'A1',expected:42}}])
 attachContext(f,a.ticket,a.goal)
 expect(projectTaskStatus(f.host,current(f,a.ticket)).acceptance.state).toBe('passed')
 f.host.store.db.prepare("DELETE FROM records WHERE kind='workbook-observation'").run()
 const before=dbState(f)
 expect(f.trace.snapshot({ticketId:a.ticket.id}).tasks[0]!.status.acceptance.state).toBe('stale')
 expect(dbState(f)).toBe(before)
})
it('fails closed on a missing route without recreating authority while reading status',async()=>{
 const f=fixture(),a=await accepted(f)
 attachContext(f,a.ticket,a.goal)
 f.host.store.db.prepare("DELETE FROM records WHERE kind='router-route' AND id=?").run(a.goal.triggerId)
 const before=dbState(f)
 expect(f.trace.snapshot({ticketId:a.ticket.id}).tasks[0]!.status.acceptance.state).toBe('stale')
 expect(dbState(f)).toBe(before)
})
it('does not apply an unsynchronized revocation ledger while projecting any trace facet',async()=>{
 const f=fixture(),a=await accepted(f),body={seq:1,previous:'',tenantId:'org',scopeId:'team',action:'forget',generation:0,id:'absent-fact',at:Date.now()}
 attachContext(f,a.ticket,a.goal)
 appendFileSync(join(f.host.config.stateDir,'memory-revocations.jsonl'),JSON.stringify({...body,hash:stableDigest(body)})+'\n')
 const before=dbState(f)
 expect(()=>f.host.memory.assertReconciled()).toThrow('Memory reconciliation is required')
 expect(f.trace.snapshot({ticketId:a.ticket.id}).tasks[0]!.status.acceptance.state).toBe('stale')
 expect(dbState(f)).toBe(before)
})

it('does not reuse a sent identical body from an older assignment as the current delivery receipt',async()=>{
 const f=fixture(),ticket=await task(f);run(f,ticket,'idle','ready')
 await message(f,ticket,'identical-old','sent','reply',true)
 expect(projectTaskStatus(f.host,current(f,ticket)).delivery.state).toBe('recorded')
 const old=current(f,ticket),next={id:'new-identical',state:'pending' as const,createdAt:new Date().toISOString()}
 f.host.store.put('ticket',ticket.id,{...old,ended:undefined,assignments:[...old.assignments,next]})
 f.host.engine.assignmentStarted(ticket.id,next.id)
 f.host.store.put('run',ticket.id,{...f.host.store.get<Run>('run',ticket.id)!,assignmentId:next.id,phase:'idle',result:'Actual result'})
 f.host.engine.report(ticket.id,{state:'ready',summary:'Actual result',question:null})
 const before=dbState(f),status=projectTaskStatus(f.host,current(f,ticket))
 expect(status.delivery).toMatchObject({state:'not_recorded',evidence:'none',counts:{total:0,recorded:0}})
 expect(dbState(f)).toBe(before)
 await message(f,ticket,'identical-new','sent','reply',true)
 expect(projectTaskStatus(f.host,current(f,ticket)).delivery).toMatchObject({state:'recorded',evidence:'host_record',counts:{total:1,recorded:1}})
})

it.each([false,true])('does not confuse a sent progress reply with ready output at the same timestamp (Router=%s)',async router=>{
 const f=fixture(),ticket=await task(f);run(f,ticket)
 if(router){
  f.host.store.put('router-reply-owner','progress-same',{taskIds:[ticket.id]})
  f.host.store.outbox.send({id:'progress-same',kind:'reply',text:'Actual result',channel:{source:'external',thread:'topic',address:{thread:'topic'}}});f.host.store.delivered('progress-same')
 }else await message(f,ticket,'progress-same','sent','reply',true)
 const first=f.host.store.db.prepare("SELECT seq,at FROM audit WHERE json_extract(body,'$.type')='execution.trace' AND json_extract(body,'$.entity')='outbox' AND json_extract(body,'$.entityId')='progress-same' ORDER BY seq LIMIT 1").get()!
 const saved=f.host.store.get<Run>('run',ticket.id)!
 f.host.store.put('run',ticket.id,{...saved,result:'Actual result'})
 f.host.engine.report(ticket.id,{state:'ready',summary:'Actual result',question:null})
 const ready=current(f,ticket),assignment=ready.assignments.at(-1)!
 f.host.store.put('ticket',ticket.id,{...ready,assignments:ready.assignments.map(a=>a.id===assignment.id?{...a,report:{...a.report!,at:String(first.at)}}:a)})
 if(router)f.host.store.put('router-reply-owner','progress-same',{taskIds:[ticket.id],reportReads:{[ticket.id]:String(first.at)}})
 const latest=f.host.store.db.prepare("SELECT MAX(seq) AS seq FROM audit WHERE json_extract(body,'$.entity')='ticket' AND json_extract(body,'$.assignmentId')=? AND json_extract(body,'$.state')='ready'").get(assignment.id)!
 expect(Number(latest.seq)).toBeGreaterThan(Number(first.seq))
 expect(current(f,ticket).assignments.at(-1)!.report!.at).toBe(first.at)
 const before=dbState(f)
 expect(projectTaskStatus(f.host,current(f,ticket)).delivery).toMatchObject({state:'not_recorded',counts:{total:0,recorded:0}})
 expect(dbState(f)).toBe(before)
})

it('does not reuse a same-millisecond receipt after a second ready report on an open followed task',async()=>{
 const f=fixture(),ticket=await task(f)
 f.host.engine.bindThread(ticket.id,{source:'local',id:'followed-thread'},true)
 run(f,ticket,'idle','ready')
 expect(current(f,ticket).ended).toBeUndefined()
 await message(f,ticket,'ready-one','sent','reply',true)
 expect(projectTaskStatus(f.host,current(f,ticket)).delivery.state).toBe('recorded')
 const first=f.host.store.db.prepare("SELECT seq,at FROM audit WHERE json_extract(body,'$.entity')='outbox' AND json_extract(body,'$.entityId')='ready-one' ORDER BY seq LIMIT 1").get()!
 const assignment=current(f,ticket).assignments.at(-1)!
 const readyRows=()=>f.host.store.db.prepare("SELECT seq FROM audit WHERE json_extract(body,'$.entity')='ticket' AND json_extract(body,'$.entityId')=? AND json_extract(body,'$.assignmentId')=? AND json_extract(body,'$.state')='ready' ORDER BY seq").all(ticket.id,assignment.id)
 const beforeReady=readyRows()
 expect(beforeReady).toHaveLength(1)
 expect(Number(first.seq)).toBeGreaterThan(Number(beforeReady[0]!.seq))
 f.host.engine.report(ticket.id,{state:'ready',summary:'Second ready',question:null})
 const second=current(f,ticket)
 expect(second.ended).toBeUndefined();expect(second.assignments.at(-1)!.id).toBe(assignment.id)
 // Reproduce the persisted millisecond tie without pretending a second ready
 // audit event exists: that is precisely the legacy evidence gap under test.
 f.host.store.put('ticket',ticket.id,{...second,assignments:second.assignments.map(a=>a.id===assignment.id?{...a,report:{...a.report!,at:String(first.at)}}:a)})
 expect(readyRows()).toEqual(beforeReady)
 expect(current(f,ticket).assignments.at(-1)!.report!.at).toBe(first.at)
 const before=dbState(f)
 expect(projectTaskStatus(f.host,current(f,ticket)).delivery).toMatchObject({state:'not_recorded',evidence:'none',counts:{total:0,recorded:0}})
 expect(dbState(f)).toBe(before)
 await message(f,ticket,'ready-two','sent','reply',true)
 const later=f.host.store.db.prepare("SELECT at FROM audit WHERE json_extract(body,'$.entity')='outbox' AND json_extract(body,'$.entityId')='ready-two' ORDER BY seq LIMIT 1").get()!
 expect(Date.parse(String(later.at))).toBeGreaterThan(Date.parse(String(first.at)))
 expect(projectTaskStatus(f.host,current(f,ticket)).delivery).toMatchObject({state:'recorded',evidence:'host_record',counts:{total:1,recorded:1}})
})


it('checks scheduled-skill acceptance without creating a missing original authority route',async()=>{
 const f=fixture();f.host.pause(true)
 const model=vi.spyOn(f.host.model,'run'),history=vi.spyOn(f.host.model,'history'),deliver=vi.spyOn(f.host.sources.get('local')!,'deliver')
 const skill={id:'status-local-fixture',version:1}
 // Local synthetic saved-method metadata and a retained passed round exercise
 // the actual schedule/goal/verifier chain without provider acceptance.
 f.host.store.put('skill-version',stableDigest([skill.id,skill.version]),{...skill,scopeId:'team',entryId:f.context.route.entryId,goalId:'fixture-seed',acceptanceId:'fixture-seed',template:{title:'Inspection',objective:'Inspect and report findings',criteria:[{id:'result',description:'Produce findings',files:[],documents:[]}],nodes:[{id:'build',title:'Inspect',instruction:'Inspect and report',workerId:'one',criterionIds:['result'],dependsOn:[]}]}})
 const plan=f.host.proactive.command({action:'schedule.put',scopeId:'team',operationId:'skill-plan',expectedRevision:0,schedule:{id:'daily',name:'Check',triggerId:f.trigger.id,prompt:'Inspect scheduled work',skill,mode:'standalone',notification:'silent',timing:{kind:'once',startAt:new Date(Date.now()+60_000).toISOString(),timezone:'UTC'}}}) as {revision:number}
 const scheduled=f.host.proactive.command({action:'schedule.run',scopeId:'team',operationId:'skill-launch',expectedRevision:plan.revision,id:'daily'}) as {id:string;triggerId:string}
 f.host.proactive.runSkill(scheduled.id)
 const saved=f.host.store.get<{goalId:string}>('router-schedule-run',scheduled.id)!,goal=f.host.goals.get(saved.goalId)!,trigger=f.host.store.triggers.get(scheduled.triggerId)!,discussion='local:'+trigger.threads[0]!.id,context=f.host.scopes.context(trigger,discussion)!
 const assigned=await f.host.manager.call({action:'assign',id:'one',revision:f.host.settings.current().revision,requestId:'skill-task',text:'Inspect local fixture'},{discussion,trigger,scoped:context})
 const ticket=f.host.store.tickets.get(assigned.ticketId)!
 run(f,ticket)
 goal.taskIds=[ticket.id];goal.nodes![0]!.ticketId=ticket.id;goal.nodes![0]!.state='running';f.host.store.put('router-goal',goal.id,goal)
 f.host.verification.capture(ticket.id,{state:'ready',summary:'Fixture findings'},'Fixture findings')
 const round=f.host.verification.ensure(goal,goal.nodes![0]);round.state='passed';f.host.store.put('goal-verification',round.id,round)
 goal.nodes![0]!.roundId=round.id;goal.nodes![0]!.state='passed';f.host.store.put('router-goal',goal.id,goal)
 const totalChanges=()=>Number(f.host.store.db.prepare('SELECT total_changes() AS count').get()!.count)
 const positive=dbState(f),positiveChanges=totalChanges()
 expect(f.host.verification.current(round,goal,{readOnly:true})).toBe(true)
 expect(projectTaskStatus(f.host,current(f,ticket)).acceptance).toEqual({state:'passed',freshness:'current'});expect(dbState(f)).toBe(positive);expect(totalChanges()).toBe(positiveChanges)
 f.host.store.db.prepare("DELETE FROM records WHERE kind='router-route' AND id=?").run(f.trigger.id)
 expect(f.host.store.get('router-route',trigger.id)).toBeDefined()
 const before=dbState(f),beforeChanges=totalChanges()
 expect(f.host.verification.current(round,goal,{readOnly:true})).toBe(false)
 expect(projectTaskStatus(f.host,current(f,ticket)).acceptance).toEqual({state:'stale',freshness:'stale'})
 expect(f.trace.snapshot({ticketId:ticket.id}).tasks[0]!.status.acceptance).toEqual({state:'stale',freshness:'stale'})
 expect(dbState(f)).toBe(before);expect(totalChanges()).toBe(beforeChanges);expect(f.host.store.get('router-route',f.trigger.id)).toBeUndefined()
 // Default execution remains outside the observation scope and can derive its
 // ordinary route. Subsequent reads accept the same retained evidence again.
 expect(f.host.verification.current(round,goal)).toBe(true);expect(f.host.store.get('router-route',f.trigger.id)).toBeDefined()
 const restored=dbState(f),restoredChanges=totalChanges()
 expect(f.host.verification.current(round,goal,{readOnly:true})).toBe(true)
 expect(projectTaskStatus(f.host,current(f,ticket)).acceptance).toEqual({state:'passed',freshness:'current'});expect(dbState(f)).toBe(restored);expect(totalChanges()).toBe(restoredChanges)
 expect(model).not.toHaveBeenCalled();expect(history).not.toHaveBeenCalled();expect(deliver).not.toHaveBeenCalled()
})
