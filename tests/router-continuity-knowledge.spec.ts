import {it,expect,afterEach} from 'vitest'
import {mkdtempSync,rmSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {Runtime} from '../src/runtime.ts'
import {configSchema} from '../src/config.ts'
import type {Model,ModelRequest} from '../src/model.ts'
import type {RouterGoal} from '../src/router-goals.ts'
import {splitDocument,normalizeKeywordScores,extractSnippet,detectExplicitMemory,wikiLinks} from '../src/vendor/weknora/primitives.ts'
import {serve} from '../src/server.ts'
import {clientStatus} from '../src/client-status.ts'

const roots:string[]=[],hosts:Runtime[]=[]
afterEach(async()=>{for(const h of hosts.splice(0))await h.close();for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true})})
async function until(h:Runtime,p:()=>boolean){for(let i=0;i<500;i++){await h.tick();await new Promise(r=>setTimeout(r,2));if(p())return}throw Error('Did not settle '+JSON.stringify(h.store.db.prepare('SELECT id,state,error FROM jobs').all()))}
function fixture(custom?:(r:ModelRequest,input:any,h:Runtime)=>Promise<any>){
 const root=mkdtempSync(join(tmpdir(),'embedded-knowledge-'));roots.push(root)
 let seq=0,now=Date.now(),h!:Runtime
 const calls:ModelRequest[]=[]
 const config=configSchema.parse({stateDir:join(root,'state'),port:0,work:{sandboxDriver:'disabled'},acceptMode:'auto',execution:{router:{mode:'host'},management:{enabled:true},workers:[{id:'one',backend:'codex'}]},sources:[{id:'local',kind:'local',cwd:root,workspace:{mode:'source'},allowedActors:['alice','bob']}]})
 const model:Model={async run(r){calls.push(r);const threadId=r.threadId??'native-'+calls.length,turnId='turn-'+calls.length;r.onThread?.(threadId);r.onTurn?.(turnId);const parsed=JSON.parse(r.input);if(parsed.kind==='goal_verification'){for(const e of parsed.evidence)await tool(r,'goal_evidence',{id:e.id});return {threadId,turnId,text:JSON.stringify({checks:parsed.criteria.map((cr:any)=>({criterionId:cr.id,verdict:'passed',explanation:'Independently checked the supplied arithmetic',evidenceIds:parsed.evidence.filter((e:any)=>cr.id==='__goal__'||e.criterionIds.includes(cr.id)).map((e:any)=>e.id)}))})}}const result=await custom?.(r,parsed,h);return {threadId,turnId,text:JSON.stringify(result??(r.role==='router'?{reply:'Reply '+calls.length}:{state:'ready',summary:'Verified 2',reply:'2',question:null,askedBy:null,handbacks:[]}))}}}
 const open=()=>{h=new Runtime(config,{model,clock:()=>now});hosts.push(h)};open()
 h.scopes.command({action:'scope.put',operationId:'scope',expectedRevision:0,scope:{id:'team',tenantId:'org',name:'Team',managers:[JSON.stringify(['local','alice'])],workerIds:['one'],sourceIds:['local'],backendIds:['codex']}})
 for(const nativeId of ['g1','g2'])h.scopes.command({action:'entry.bind',operationId:nativeId,expectedRevision:0,scopeId:'team',sourceId:'local',accountNamespace:'account',nativeId,history:'group'})
 const receive=(text='Please do this work',{actor='alice',group='g1',thread=group+'-topic'}:{actor?:string;group?:string;thread?:string}={})=>h.receive('local',actor,{id:'input-'+(++seq),thread,scope:group,text,addressed:true}) as any
 const context=(value:any)=>{const trigger=h.store.triggers.get(value.triggerId)!;return h.scopes.context(trigger,trigger.source+':'+trigger.threads[0]!.id)!}
 const put=(c:any,content='alpha beta γ document',extra:any={})=>h.knowledge.command({action:'put',title:'Document',content,operationId:'write-'+(++seq),expectedRevision:0,...extra},c)
 return {get h(){return h},root,config,model,calls,receive,context,put,advance:(ms:number)=>{now+=ms},restart:async()=>{hosts.splice(hosts.indexOf(h),1);await h.close();open()}}
}
async function tool(r:ModelRequest,name:string,args:any){const result=await r.onTool!(name,args,'call-'+name);if(!result.success)throw Error(JSON.stringify(result));return JSON.parse(result.contentItems[0]!.text!)}

it('keeps Unicode chunk offsets exact, handles heading fences and bounded scores without mutating inputs',()=>{
 const text='# Parent\n'+'🙂中alpha '.repeat(80)+'\n## Child\n'+'beta '.repeat(100)+'\n```md\n# fake heading\n```\nend'
 const chunks=splitDocument(text,128,16),chars=Array.from(text)
 expect(chunks.length).toBeGreaterThan(4)
 for(const c of chunks)expect(c.content).toBe(chars.slice(c.start,c.end).join(''))
 expect(chunks.some(c=>c.contextHeader.includes('## Child'))).toBe(true)
 expect(chunks.some(c=>c.contextHeader.includes('fake'))).toBe(false)
 const scores=[{score:1},{score:3},{score:2}];expect(normalizeKeywordScores(scores).map(x=>x.score)).toEqual([0,1,.5]);expect(scores[0]!.score).toBe(1)
 expect(normalizeKeywordScores([{score:1},{score:1}]).map(x=>x.score)).toEqual([1,1])
 expect(extractSnippet('look [a.*] literal','[a.*]')).toContain('[a.*]')
 expect(wikiLinks('[[real|标题]]\n```\n[[fake]]\n````\n[[next]]\n~~~\n[[unfinished]]')).toEqual(['real','next'])
 expect(detectExplicitMemory('请记住：每次回复使用中文')).toBe('每次回复使用中文')
 expect(detectExplicitMemory('不要记住：测试')).toBeUndefined()
 expect(detectExplicitMemory('记住：'+'x'.repeat(301))).toBeUndefined()
})
it('isolates document search by entry, preserves revisions and rejects conflicting mutations',()=>{
 const f=fixture(),c=f.context(f.receive()),other=f.context(f.receive('Other request',{group:'g2'})),bob=f.context(f.receive('Bobs request',{actor:'bob'}))
 const doc=f.put(c,'# Notes\nalpha🙂 beta secrets')
 const hits=f.h.knowledge.command({action:'search',query:'alpha'},c);expect(hits.items[0]).toMatchObject({documentId:doc.id,revision:1});expect(hits.method).toBe('keyword')
 expect(f.h.knowledge.command({action:'search',query:'alpha'},other).items).toEqual([])
 expect(()=>f.h.knowledge.command({action:'read',id:doc.id},other)).toThrow('unavailable')
 expect(()=>f.put(bob,'overwrite',{id:doc.id,expectedRevision:1})).toThrow('authority')
 const input={action:'put',id:doc.id,title:'Updated',content:'new content',operationId:'edit',expectedRevision:1}
 expect(f.h.knowledge.command(input,c).revision).toBe(2);expect(f.h.knowledge.command(input,c).revision).toBe(2)
 expect(()=>f.h.knowledge.command({...input,content:'different'},c)).toThrow('operationId')
 expect(()=>f.put(c,'stale',{id:doc.id,expectedRevision:1})).toThrow('revision')
 expect(f.h.knowledge.command({action:'search',query:'secrets'},c).items).toHaveLength(0)
 expect(f.h.knowledge.command({action:'versions',id:doc.id,version:1},c).content).toContain('secrets')
 expect(f.h.knowledge.command({action:'restore',id:doc.id,version:1,operationId:'restore',expectedRevision:2},c).revision).toBe(3)
 expect(f.h.knowledge.command({action:'read',id:doc.id},c).content).toContain('secrets')
})
it('tracks Wiki citations, stale sources, backlinks and transitive revocation',()=>{
 const f=fixture(),c=f.context(f.receive()),doc=f.put(c,'🙂真实来源 alpha')
 const page=f.put(c,'[[other]] 引用内容',{kind:'wiki',slug:'guide',citations:[{documentId:doc.id,revision:1,start:1,end:5}]})
 const other=f.put(c,'[[guide|指南]]',{kind:'wiki',slug:'other'})
 expect(f.h.knowledge.command({action:'links',id:page.id},c).outgoing[0].documentId).toBe(other.id)
 expect(f.h.knowledge.command({action:'links',id:page.id},c).incoming[0].id).toBe(other.id)
 expect(()=>f.put(c,'bad',{kind:'wiki',citations:[{documentId:doc.id,revision:1,start:0,end:200}]})).toThrow('offsets')
 expect(()=>f.put(c,'cycle',{id:doc.id,expectedRevision:1,citations:[{documentId:page.id,revision:1,start:0,end:2}]})).toThrow('cycle')
 const refs=f.h.knowledge.references(f.h.knowledge.command({action:'read',id:page.id},c),c)
 f.put(c,'changed source',{id:doc.id,expectedRevision:1})
 expect(f.h.knowledge.command({action:'read',id:page.id},c).stale).toBe(true)
 expect(()=>f.h.knowledge.validate(c,refs)).toThrow('changed')
 f.h.knowledge.command({action:'delete',id:doc.id,operationId:'delete',expectedRevision:2},c)
 expect(()=>f.h.knowledge.command({action:'read',id:page.id},c)).toThrow('unavailable')
})
it('erases document chunks and SQLite search bodies with source history cleanup, surviving restart',async()=>{
 const f=fixture(),c=f.context(f.receive()),marker='UNIQUE_REMOVED_TEXT_67391';f.h.memory.ingest(c);f.put(c,marker)
 const other=f.context(f.receive('keep',{group:'g2'}));f.put(other,'UNRELATED_TEXT_501')
 const evidence=f.h.memory.ingest(c)
 f.h.memory.command(c,{action:'source.delete',id:evidence.id,operationId:'erase',expectedRevision:1})
 expect(f.h.store.db.prepare('SELECT body FROM memory_search WHERE body LIKE ?').all('%'+marker+'%')).toEqual([])
 await f.h.memory.cleanup.process(f.model,async()=>true)
 expect(f.h.memory.cleanup.receipts()[0]?.status).toBe('completed')
 expect(readFileSync(join(f.config.stateDir,'state.sqlite')).includes(Buffer.from(marker))).toBe(false)
 await f.restart()
 expect(f.h.knowledge.command({action:'search',query:'UNRELATED_TEXT_501'},f.context({triggerId:other.trigger.id})).items).toHaveLength(1)
})
it('reuses a compatible Router thread, restores verbatim user requirements on rotation and restart',async()=>{
 const f=fixture(),first=f.receive('实现功能，必须保留中文，禁止部署。')
 await until(f.h,()=>f.h.store.list('router-result').length===1)
 const c=f.context(first);f.h.continuity.command({action:'record',operationId:'constraint',kind:'requirement',text:'禁止部署',sourceIds:[first.triggerId]},c)
 f.receive('继续完善，并记录证据。');await until(f.h,()=>f.h.store.list('router-result').length===2)
 expect(f.calls[1]!.threadId).toBe('native-1')
 expect(JSON.parse(f.calls[1]!.input).continuity).toMatchObject({mode:'resume',requirements:[{text:'禁止部署'}]})
 const key=f.h.continuity.key(c),session=f.h.store.get<any>('router-session',key);f.h.store.put('router-session',key,{...session,inputBytes:99999999})
 await f.restart();f.receive('现在给出进展。');await until(f.h,()=>f.h.store.list('router-result').length===3)
 expect(f.calls[2]!.threadId).toBeUndefined()
 const history=JSON.parse(f.calls[2]!.input).continuity.history
 expect(history.some((e:any)=>e.text==='实现功能，必须保留中文，禁止部署。')).toBe(true)
 expect(history.some((e:any)=>e.kind==='router'&&e.text==='Reply 1')).toBe(true)
})
it('partitions native history by actor and entry and rotates after knowledge changes',async()=>{
 let docId=''
 const f=fixture(async(r,input)=>{if(r.role==='router'&&docId)await tool(r,'router_knowledge',{action:'read',id:docId});return {reply:'checked'}})
 const initial=f.receive(),c=f.context(initial);docId=f.put(c,'first source').id
 await until(f.h,()=>f.h.store.list('router-result').length===1)
 f.put(c,'second source',{id:docId,expectedRevision:1});f.receive('再读')
 await until(f.h,()=>f.h.store.list('router-result').length===2);expect(f.calls[1]!.threadId).toBeUndefined()
 docId='';f.receive('Different actor',{actor:'bob'});await until(f.h,()=>f.h.store.list('router-result').length===3)
 expect(f.calls[2]!.threadId).toBeUndefined();expect(JSON.parse(f.calls[2]!.input).continuity.history).toHaveLength(1)
})
it('activates explicit memory once while inferred facts remain candidates and forgotten facts stay suppressed',async()=>{
 const f=fixture(),a=f.receive('记住：我希望始终使用中文回复。')
 await until(f.h,()=>f.h.store.list('router-result').length===1)
 const c=f.context(a),facts=f.h.memory.query(c,{}).items;expect(facts).toHaveLength(1);expect(facts[0]!.content).toBe('我希望始终使用中文回复。')
 f.h.memory.captureExplicit(c);expect(f.h.memory.query(c,{}).items).toHaveLength(1)
 await f.h.memory.tool(c,{action:'propose',subject:'inferred preference',content:'Prefers detail',operationId:'inferred'})
 expect(f.h.memory.query(c,{}).items).toHaveLength(1)
 f.h.memory.command(c,{action:'forget',id:facts[0]!.id,operationId:'forget',expectedRevision:1})
 const fresh=f.context(a);f.h.memory.captureExplicit(fresh);expect(f.h.memory.query(fresh,{}).items).toHaveLength(0)
 const next=f.context(f.receive('记住：代码修改后需要复核。'));f.h.memory.captureExplicit(next);expect(f.h.memory.query(next,{}).items[0]!.content).toBe('代码修改后需要复核。')
})
it('invalidates derived commitments, checkpoints and goal plans when a read document is deleted',async()=>{
 const f=fixture(),source=f.receive('完成这个长程目标'),c=f.context(source),doc=f.put(c,'SOURCE_SECRET_883'),packet=f.h.memory.build(c,{},'backend')
 f.h.continuity.capture(c,[source.triggerId]);packet.manifest.knowledge=[{documentId:doc.id,revision:1}];f.h.store.put('context-manifest',packet.manifest.id,packet.manifest)
 const record={action:'record',operationId:'derived',kind:'decision',text:'SOURCE_SECRET_883 determines the plan',sourceIds:[source.triggerId]}
 f.h.continuity.command(record,c,packet.manifest)
 const start={action:'start',operationId:'derived-goal',expectedRevision:0,title:'Derived',objective:'SOURCE_SECRET_883',authorizationQuote:'完成这个长程目标',criteria:[{id:'proof',description:'Verify source'}]}
 f.h.goals.command(start,c,packet.manifest)
 f.h.knowledge.command({action:'delete',id:doc.id,operationId:'delete',expectedRevision:1},c)
 expect(f.h.continuity.command({action:'read'},c).requirements).toHaveLength(0)
 expect(()=>f.h.continuity.command(record,c,packet.manifest)).toThrow('sources changed')
 expect(JSON.stringify(f.h.goals.list(c))).not.toContain('SOURCE_SECRET_883')
 expect(JSON.stringify(f.h.goals.command(start,c,packet.manifest))).not.toContain('SOURCE_SECRET_883')
})
it('records dependencies from Wiki links and historical-version citations, not only current page content',()=>{
 const f=fixture(),c=f.context(f.receive()),source=f.put(c,'original cited source'),page=f.put(c,'[[related]] summary',{kind:'wiki',slug:'page',citations:[{documentId:source.id,revision:1,start:0,end:5}]}),related=f.put(c,'[[page]]',{kind:'wiki',slug:'related'})
 const links=f.h.knowledge.references(f.h.knowledge.command({action:'links',id:page.id},c),c)
 expect(links.map(r=>r.documentId)).toContain(related.id)
 f.put(c,'current page without citation',{id:page.id,expectedRevision:1,kind:'wiki',slug:'page'})
 const old=f.h.knowledge.command({action:'versions',id:page.id,version:1},c),refs=f.h.knowledge.references(old,c)
 expect(refs.map(r=>r.documentId)).toContain(source.id)
 f.h.knowledge.command({action:'delete',id:source.id,operationId:'delete-source',expectedRevision:1},c)
 expect(()=>f.h.knowledge.validate(c,refs)).toThrow('unavailable')
})
it('lets a Worker retrieve scoped knowledge but rejects Worker writes',async()=>{
 let docId='',read=false
 const f=fixture(async(r,input)=>{
  if(r.role==='router'&&input.kind!=='worker_result'){await tool(r,'worker_manage',{action:'assign',id:'one',text:'Read the provided document and verify it',revision:0,requestId:'read-doc'});return {reply:''}}
  if(r.role==='worker'){
   const output=await tool(r,'superagent_knowledge',{action:'read',id:docId});expect(output.content).toBe('Worker source 763');read=true
   await expect(r.onTool!('superagent_knowledge',{action:'delete',id:docId,operationId:'forbidden',expectedRevision:1},'write')).rejects.toThrow()
  }
 })
 const input=f.receive(),c=f.context(input);docId=f.put(c,'Worker source 763').id
 await until(f.h,()=>f.h.store.tickets.list().some(t=>t.ended))
 expect(read).toBe(true);expect(f.h.knowledge.command({action:'read',id:docId},c).content).toBe('Worker source 763')
 const manifest=f.h.store.get<any>('task-context',f.h.store.tickets.list()[0]!.id).manifest
 expect(manifest.knowledge).toEqual([{documentId:docId,revision:1}])
})
it('continues a durable goal after restart, dispatches work on a wake and verifies completion before delivery',async()=>{
 const f=fixture(async(r,input,h)=>{
  if(r.role!=='router')return
  const g=input.goals?.find((x:any)=>x.state==='active'||x.state==='waiting')??input.goals?.find((x:any)=>x.state==='completed')
  if(!g){await tool(r,'router_goal',{action:'start',operationId:'start',expectedRevision:0,title:'Calculation',objective:'Verify 1+1',authorizationQuote:input.trigger.text,criteria:[{id:'sum',description:'Checked sum is 2'}],nextAction:'Use one Worker',plan:['Calculate','Verify']});return {reply:''}}
  if(!g.taskIds.length){await tool(r,'worker_manage',{action:'assign',id:'one',text:'Verify 1+1',requestId:'calculate',revision:0});return {reply:''}}
  const ticket=h.store.tickets.get(g.taskIds[0]);if(!ticket?.ended)return {reply:''}
  const result=await tool(r,'worker_manage',{action:'result',ticketId:ticket.id})
  await tool(r,'router_goal',{action:'complete',id:g.id,operationId:'complete',expectedRevision:g.revision,checks:[{criterionId:'sum',ticketId:ticket.id,reportAt:result.report.at,explanation:'Read the report and checked 1+1=2'}]})
  return {reply:'VERIFIED GOAL 2'}
 })
 f.receive('请持续完成计算和核验，直到目标完成。');await until(f.h,()=>f.h.store.list('router-result').length===1)
 expect(f.h.store.tickets.list()).toHaveLength(0)
 await f.restart();f.advance(61000)
 await until(f.h,()=>f.h.store.deliveries().some(d=>d.text==='VERIFIED GOAL 2'&&d.status==='sent'))
 expect(f.h.store.list<RouterGoal>('router-goal')[0]).toMatchObject({state:'completed',taskIds:[expect.any(String)],checks:[{criterionId:'sum'}]})
 expect(f.h.store.tickets.list()).toHaveLength(1)
 const wakes=f.h.store.list('goal-wake').length;expect(wakes).toBeGreaterThanOrEqual(1)
 f.advance(3600000);await f.h.tick();expect(f.h.store.list('goal-wake')).toHaveLength(wakes)
})
it('never marks a goal complete without evidence; turn exhaustion holds it unresolved and notifies',async()=>{
 const f=fixture(),source=f.receive('Keep working'),c=f.context(source)
 const g=f.h.goals.command({action:'start',operationId:'start',expectedRevision:0,title:'Unresolved',objective:'Finish missing work',authorizationQuote:'Keep working',criteria:[{id:'proof',description:'Actual evidence'}],maxTurns:1},c)
 expect(()=>f.h.goals.command({action:'complete',id:g.id,operationId:'bad',expectedRevision:1,checks:[]},c)).toThrow('criterion')
 await until(f.h,()=>f.h.store.list<RouterGoal>('router-goal')[0]?.state==='held')
 expect(f.h.store.deliveries().some(d=>d.text.includes('尚未完成'))).toBe(true)
 f.advance(999999);await f.h.tick();expect(f.h.store.list('goal-wake')).toHaveLength(0)
})
it('rebuilds a missing provider session on the next durable goal attempt without dropping the user source',async()=>{
 let missing=false
 const f=fixture(async(r,input)=>{
  if(r.role==='router'&&r.threadId&&!missing){missing=true;throw Error('Thread not found')}
  return {reply:input.kind==='event'?'Recovered':''}
 })
 const input=f.receive('持续处理这项任务，保留原始要求'),c=f.context(input)
 f.h.goals.command({action:'start',operationId:'resumable',expectedRevision:0,title:'Recover',objective:'Recover',authorizationQuote:'持续处理这项任务',criteria:[{id:'proof',description:'Verified'}]},c)
 await until(f.h,()=>f.h.store.list('router-result').length===1)
 f.advance(61000);await until(f.h,()=>f.h.store.list<RouterGoal>('router-goal')[0]?.failures===1)
 f.advance(61000);await until(f.h,()=>f.h.store.deliveries().some(d=>d.text==='Recovered'))
 const last=f.calls.at(-1)!
 expect(last.threadId).toBeUndefined();expect(JSON.parse(last.input).continuity.history.some((e:any)=>e.text==='持续处理这项任务，保留原始要求')).toBe(true)
})
it('a wake cannot mutate unrelated tasks, forge a new goal or write knowledge',async()=>{
 const f=fixture(),source=f.receive('Own this goal'),c=f.context(source)
 const g=f.h.goals.command({action:'start',operationId:'start',expectedRevision:0,title:'Owned',objective:'Own this goal',authorizationQuote:'Own this goal',criteria:[{id:'proof',description:'Evidence'}]},c)
 await until(f.h,()=>f.h.store.list('router-result').length===1);f.advance(61000);f.h.goals.tick()
 const w=f.h.store.list<any>('goal-wake')[0],wc=f.context({triggerId:w.triggerId})
 expect(()=>f.h.goals.toolAllowed(w.triggerId,'worker_manage',{action:'send',ticketId:'unrelated'})).toThrow('owned')
 expect(()=>f.h.goals.toolAllowed(w.triggerId,'router_goal',{action:'start'})).toThrow('existing goal')
 expect(()=>f.put(wc,'unrequested write')).toThrow('human authority')
 f.h.goals.command({action:'pause',id:g.id,operationId:'pause',expectedRevision:1},c)
 expect(()=>f.h.goals.beforeTurn(w.triggerId)).toThrow('not running')
})
it('rejects cancelling a transferred goal task and exposes unresolved goal state in normal status',async()=>{
 const f=fixture(),first=f.receive('Keep ownership boundaries'),entry=f.context(first).route.entryId
 f.h.scopes.command({action:'scope.put',operationId:'other-scope',expectedRevision:0,scope:{id:'other',tenantId:'org',name:'Other',managers:[JSON.stringify(['local','alice'])],workerIds:['one'],sourceIds:['local'],backendIds:['codex'],dataEntryIds:[entry]}})
 let c=f.context(first)
 const g=f.h.goals.command({action:'start',operationId:'owned-goal',expectedRevision:0,title:'Goal',objective:'Check work',authorizationQuote:'Keep ownership boundaries',criteria:[{id:'proof',description:'Checked result'}]},c)
 const task=await f.h.manager.call({action:'assign',id:'one',text:'Work',requestId:'assigned',revision:0},{discussion:c.route.discussion,trigger:c.trigger,scoped:c});f.h.goals.noteTask(c.trigger.id,task.ticketId)
 expect(clientStatus(f.h.status(),{discussion:'g1-topic'}).goals[0]?.state).toBe('active')
 f.h.scopes.command({action:'task.transfer',operationId:'move',expectedRevision:1,ticketId:task.ticketId,scopeId:'other'});c=f.context(first)
 expect(()=>f.h.goals.command({action:'cancel',id:g.id,operationId:'cancel-moved',expectedRevision:1},c)).toThrow('ownership')
 expect(f.h.store.tickets.get(task.ticketId)?.ended).toBeUndefined()
 expect(f.h.store.get<RouterGoal>('router-goal',g.id)?.state).toBe('active')
})
it('does not let a scheduled task change another standing goal in the same conversation',()=>{
 const f=fixture(),input=f.receive('Maintain this goal'),c=f.context(input)
 const g=f.h.goals.command({action:'start',operationId:'goal',expectedRevision:0,title:'Goal',objective:'Keep going',authorizationQuote:'Maintain this goal',criteria:[{id:'proof',description:'Verified'}]},c)
 f.h.proactive.command({action:'settings.put',scopeId:'team',operationId:'enabled',expectedRevision:0,settings:{enabled:true}})
 f.h.proactive.command({action:'schedule.put',scopeId:'team',operationId:'scheduled',expectedRevision:0,schedule:{id:'once',name:'Other work',triggerId:input.triggerId,prompt:'Do a status check',mode:'standalone',notification:'silent',timing:{kind:'once',timezone:'UTC',startAt:new Date(Date.now()+1000).toISOString()}}})
 f.advance(2000);f.h.proactive.tick()
 const run=f.h.store.list<any>('router-schedule-run')[0]!,scheduled=f.context({triggerId:run.triggerId})
 expect(scheduled.trigger.human).toBe(false)
 expect(()=>f.h.goals.command({action:'wait',id:g.id,operationId:'foreign-wait',expectedRevision:1,reason:'Stop the other goal',needsHuman:true},scheduled)).toThrow('own goal')
 expect(f.h.store.get<RouterGoal>('router-goal',g.id)?.state).toBe('active')
})
it('offers authenticated operator knowledge and goal APIs without private-entry impersonation',async()=>{
 const f=fixture(),c=f.context(f.receive()),server=await serve(f.h)
 try{
  const {url}=JSON.parse(readFileSync(join(f.config.stateDir,'connection.json'),'utf8')),token=readFileSync(join(f.config.stateDir,'access-token'),'utf8').trim()
  const body={triggerId:c.trigger.id,command:{action:'list'}}
  expect((await fetch(url+'/router-knowledge',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)})).status).not.toBe(200)
  const response=await fetch(url+'/router-knowledge',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(body)})
  expect(response.status).toBe(200);expect(await response.json()).toMatchObject({items:[]})
  f.h.scopes.command({action:'entry.bind',operationId:'private-entry',expectedRevision:0,scopeId:'team',sourceId:'local',accountNamespace:'account',nativeId:'private',privateActor:JSON.stringify(['local','alice']),history:'unknown'})
  const privateInput=f.receive('Private request',{group:'private'})
  const denied=await fetch(url+'/router-knowledge',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({triggerId:privateInput.triggerId,command:{action:'list'}})})
  expect(denied.status).not.toBe(200);expect(await denied.text()).toContain('impersonate')
 }finally{hosts.splice(hosts.indexOf(f.h),1);await server.closeRuntime();await new Promise<void>((resolve,reject)=>server.server.close((error?:Error)=>error?reject(error):resolve()))}
})

it('keeps a cited historical revision unavailable after its original input is withdrawn',()=>{
 const f=fixture(),original=f.context(f.receive('Source version one')),wikiContext=f.context(f.receive('Summarize source'))
 const doc=f.put(original,'Original version content')
 const page=f.put(wikiContext,'Summary of original version',{kind:'wiki',citations:[{documentId:doc.id,revision:1,start:0,end:8}]})
 f.h.store.put('source-invalid-trigger',original.trigger.id,{reason:'source content withdrawn'})
 expect(()=>f.h.knowledge.command({action:'read',id:page.id},wikiContext)).toThrow('unavailable')
 const updated=f.context(f.receive('Replace the source with a fresh version'))
 f.put(updated,'Fresh version content',{id:doc.id,expectedRevision:1})
 expect(f.h.knowledge.command({action:'read',id:doc.id},updated).content).toBe('Fresh version content')
 expect(()=>f.h.knowledge.command({action:'read',id:page.id},wikiContext)).toThrow('unavailable')
 expect(f.h.knowledge.command({action:'search',query:'Summary'},wikiContext).items).toEqual([])
})

it('keeps pending goal notices tied to the context that produced them',async()=>{
 const f=fixture(),received=f.receive('Keep working on budget'),c=f.context(received),e=f.h.memory.ingest(c)
 const fact=f.h.memory.command(c,{action:'remember',operationId:'notice-fact',expectedRevision:0,subject:'budget',content:'Budget 73',sourceIds:[e.id],candidate:false},true) as any
 const packet=f.h.memory.build(c,{request:'budget'},'fixture')
 expect(packet.manifest.facts.map(x=>x.id)).toContain(fact.id)
 const g=f.h.goals.command({action:'start',operationId:'notice-goal',expectedRevision:0,title:'Budget review',objective:'Keep working on budget',authorizationQuote:'Keep working on budget',criteria:[{id:'check',description:'Verify budget'}]},c,packet.manifest) as any
 f.h.goals.notice(g,'Review Budget 73')
 f.h.memory.command(c,{action:'forget',operationId:'forget-notice-fact',expectedRevision:fact.revision,id:fact.id},true)
 await f.h.flush()
 expect(f.h.store.deliveries().find(d=>d.id.startsWith('goal-notice:'))?.status).toBe('dropped')
})

it('rejects a document identifier already occupied by another record',()=>{
 const f=fixture(),context=f.context(f.receive('Save document'))
 f.h.store.put('ticket','existing-task',{id:'existing-task',title:'Existing task'})
 expect(()=>f.put(context,'Document text',{id:'existing-task'})).toThrow('conflicts with an existing record')
 expect(f.h.store.get<any>('ticket','existing-task').title).toBe('Existing task')
})
it('lets the actual Worker broker recall authorized memory and binds its source revisions',async()=>{
 let memoryId='',read=false
 const f=fixture(async(r,input)=>{
  if(r.role==='router'&&input.kind!=='worker_result'){await tool(r,'worker_manage',{action:'assign',id:'one',text:'Use the retained project note to answer the local question',revision:0,requestId:'memory-read'});return {reply:''}}
  if(r.role==='worker'){
   const output=await tool(r,'superagent_memory',{query:'worker memory marker 859'});expect(output.items.some((x:any)=>x.id===memoryId)).toBe(true);read=true
   await expect(r.onTool!('superagent_memory',{action:'forget',id:memoryId},'write-memory')).rejects.toThrow()
  }
 })
 const input=f.receive(),c=f.context(input),e=f.h.memory.ingest(c)
 memoryId=(f.h.memory.command(c,{action:'remember',operationId:'memory-worker',expectedRevision:0,subject:'project',content:'worker memory marker 859',sourceIds:[e.id],candidate:false},true) as any).id
 await until(f.h,()=>f.h.store.tickets.list().some(t=>t.ended));expect(read).toBe(true)
 const manifest=f.h.store.get<any>('task-context',f.h.store.tickets.list()[0]!.id).manifest
 expect(manifest.facts.some((ref:any)=>ref.id===memoryId)).toBe(true);expect(manifest.evidence.some((ref:any)=>ref.id===e.id)).toBe(true)
})
