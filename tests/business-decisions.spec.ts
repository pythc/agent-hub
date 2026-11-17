import {execFileSync} from 'node:child_process'
import {serve} from '../src/server.ts'
import {readFileSync} from 'node:fs'
import {randomUUID} from 'node:crypto'
import {businessDecision,assertBusinessDecision} from '../src/business-decisions.ts'
import {afterEach,expect,it,vi} from 'vitest'
import {mkdtempSync,rmSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {Runtime} from '../src/runtime.ts'
import {configSchema} from '../src/config.ts'
import type {Run} from '../src/store.ts'
import type {ModelRequest} from '../src/model.ts'

const hosts=new Set<Runtime>(),roots:string[]=[]
afterEach(async()=>{vi.restoreAllMocks();for(const h of hosts)await h.close();hosts.clear();for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true})})
async function fixture(owner='owner'){
 const question='Which local report should be used?'
 const root=mkdtempSync(join(tmpdir(),'question-birth-'));roots.push(root);let calls=0
 const h=new Runtime(configSchema.parse({stateDir:join(root,'state'),work:{sandboxDriver:'disabled',network:false,autoRecover:false},watchdog:{enabled:false},execution:{router:{mode:'host'},management:{enabled:true,maxWorkers:1},workers:[{id:'one',backend:'codex'}]},sources:[{id:'local',kind:'local',cwd:root,workspace:{mode:'source'},allowedActors:['alice']}]}),{model:{async run(r:ModelRequest){
  if(r.role!=='worker')return {threadId:'local-router-session',turnId:'local-router-turn',text:JSON.stringify({reply:''})}
  calls++;r.onThread?.('local-question-session');r.onTurn?.('local-question-turn')
  const input=JSON.parse(r.input),person=(input.inputs??[]).filter((i:any)=>i.kind==='trigger'&&i.human&&!i.context).at(-1)??(input.origin??[]).filter((t:any)=>t?.human).map((t:any)=>({triggerId:t.id})).at(-1)
  return {threadId:'local-question-session',turnId:'local-question-turn',text:JSON.stringify({state:'blocked',summary:'A local business choice is needed.',reply:'Choose a local report.',question,askedBy:person?.triggerId??null,handbacks:[],decision:{target:{label:'Local report',version:'v1'},amount:{value:'12.50',currency:'USD'},recipient:{id:'local-reviewer',label:'Local reviewer'},validForSeconds:86400}})}
 }}});hosts.add(h)
 h.scopes.command({action:'scope.put',operationId:'scope',expectedRevision:0,scope:{id:'team',tenantId:'org',name:'Question origin fixture',contextBytes:128000,managers:[JSON.stringify(['local','alice'])],workerIds:['one'],sourceIds:['local'],backendIds:['codex']}})
 h.scopes.command({action:'entry.bind',operationId:'entry',expectedRevision:0,scopeId:'team',sourceId:'local',accountNamespace:'local',nativeId:'topic',history:'group'})
 function receive(id:string,text:string,at?:string){const input=h.receive('local','alice',{id,thread:'topic',scope:'topic',text,addressed:true,...(at?{at}:{})})as{triggerId:string};const trigger=h.store.triggers.get(input.triggerId)!;return {trigger,scoped:h.scopes.context(trigger,'local:topic')!}}
 const chat=h.chat.create(owner),sent=h.chat.send(chat.id,owner,{clientMessageId:randomUUID(),text:'Prepare a local report and ask which to use. Never contact external services.'}),trigger=h.store.triggers.get(sent.runId)!,initial={trigger,scoped:h.scopes.context(trigger,'local:chat:'+chat.id)!},packet=h.memory.build(initial.scoped,{request:'Prepare only a local report'},'codex')
 const result=await h.manager.call({action:'assign',id:'one',revision:h.settings.current().revision,requestId:'ask',text:'Ask which local report should be used.'},{discussion:'local:chat:'+chat.id,...initial,manifest:packet.manifest});const id=result.ticketId
 const ticket=()=>h.store.tickets.get(id)!,run=()=>h.store.get<Run>('run',id)!
 async function finish(minimumWorkerCalls=1){for(let n=0;n<500;n++){await h.tick();await new Promise(r=>setTimeout(r,2));if(!['queued','running','cancel_requested'].includes(h.chat.view(chat.id,owner).run?.state??'')&&calls>=minimumWorkerCalls&&ticket().attention&&['idle','uncertain'].includes(run()?.phase)&&!h.executionActive(id)&&h.store.deliveries().filter(d=>d.ticketId===id).every(d=>['sent','dropped'].includes(d.status)))return}throw Error('Local controlled question did not settle')}
 return {h,id,ticket,finish,receive,chat,root}
}
function database(h:Runtime){return JSON.stringify(h.store.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(row=>{const name=String(row.name);return [name,h.store.db.prepare('SELECT * FROM "'+name.replaceAll('"','""')+'"').all()]}))}

function command(f:Awaited<ReturnType<typeof fixture>>,questionId:string,requestId='answer') {return {action:'send',ticketId:f.id,questionId,text:'Use the first local report.',requestId,revision:f.h.settings.current().revision}}
function context(f:Awaited<ReturnType<typeof fixture>>,id='answer-user',at?:string){const incoming=f.receive(id,'Use the first local report.',at);return {discussion:'local:topic',...incoming}}

function current(f:Awaited<ReturnType<typeof fixture>>){return f.h.chat.businessDecisions(f.chat.id,'owner')[0]!}
function answer(f:Awaited<ReturnType<typeof fixture>>,d=current(f)){return {action:'answer' as const,id:d.id,version:d.version,requestId:randomUUID(),text:'Use the first report.'}}
it('answers a real Chat question atomically, without queuing a second Router run',async()=>{
 const f=await fixture();await f.finish();const d=current(f)
 expect(d.status).toBe('pending');expect(d.target).toMatchObject({label:'Local report',version:'v1',amount:{value:'12.50',currency:'USD'},recipient:{id:'local-reviewer'}})
 const input=answer(f),before=f.h.store.db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE kind='router'").get()!.n
 const result=f.h.chat.decide(f.chat.id,'owner',input)
 expect(result.decision.status).toBe('answered');expect(result.duplicate).toBe(false)
 expect(f.h.store.db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE kind='router'").get()!.n).toBe(before)
 const db=database(f.h);expect(f.h.chat.decide(f.chat.id,'owner',input).duplicate).toBe(true);expect(database(f.h)).toBe(db)
 expect(()=>f.h.chat.decide(f.chat.id,'owner',{...input,text:'Different answer'})).toThrow('different content')
 expect(f.h.store.list('tool-grant')).toEqual([]);expect(f.h.store.list('approval')).toEqual([])
})
it('invalidates changed report targets and renews to a new question before accepting an answer',async()=>{
 const f=await fixture();await f.finish();const old=current(f),attention=f.ticket().attention!
 ;(f.h as any).reportWork(f.id,{state:'blocked',summary:'Report target changed to B.',question:attention.question,askedBy:attention.triggerId})
 expect(current(f).status).toBe('stale');expect(()=>f.h.chat.decide(f.chat.id,'owner',answer(f,old))).toThrow('decision_stale')
 const renewed=f.h.chat.decide(f.chat.id,'owner',{action:'renew',id:old.id,version:old.version,requestId:randomUUID()}).decision
 expect(renewed.id).not.toBe(old.id);expect(renewed.status).toBe('pending');expect(renewed.summary).toContain('changed to B')
 expect(businessDecision(f.h,old.id)?.status).toBe('withdrawn')
 await f.finish();expect(f.h.chat.decide(f.chat.id,'owner',answer(f,renewed)).decision.status).toBe('answered')
})
it('enforces exact expiry without changing native approval deadlines and supports explicit renewal',async()=>{
 const f=await fixture();await f.finish();const d=current(f),before=database(f.h)
 vi.spyOn(Date,'now').mockReturnValue(d.expiresAt)
 expect(()=>f.h.chat.decide(f.chat.id,'owner',answer(f,d))).toThrow('decision_expired');expect(database(f.h)).toBe(before)
 expect(f.h.chat.decide(f.chat.id,'owner',{action:'renew',id:d.id,version:d.version,requestId:randomUUID()}).decision.expiresAt).toBe(d.expiresAt+86400000)
})
it('rejects another owner, another designated actor, and another version',async()=>{
 const f=await fixture();await f.finish();const d=current(f),before=database(f.h)
 expect(()=>f.h.chat.decide(f.chat.id,'another-owner',answer(f,d))).toThrow()
 expect(()=>assertBusinessDecision(f.h,d.id,d.version,{source:'local',id:'bob'})).toThrow('decision_identity')
 expect(()=>f.h.chat.decide(f.chat.id,'owner',{...answer(f,d),version:'0'.repeat(64)})).toThrow('question changed')
 expect(database(f.h)).toBe(before)
})
it('rolls back human input, decision receipt and continuation together on attach failure',async()=>{
 const f=await fixture();await f.finish();const input=answer(f),before=database(f.h)
 vi.spyOn(f.h.engine,'attach').mockImplementationOnce(()=>{throw Error('Synthetic attach failure')})
 expect(()=>f.h.chat.decide(f.chat.id,'owner',input)).toThrow('Synthetic attach failure');expect(database(f.h)).toBe(before)
 expect(f.h.chat.decide(f.chat.id,'owner',input).decision.status).toBe('answered')
})
it('preserves a pending decision over a two-hour clock advance and process reopen',async()=>{
 const f=await fixture();await f.finish();const d=current(f),input=answer(f),config=f.h.config
 await f.h.close();hosts.delete(f.h);const now=Date.now();vi.spyOn(Date,'now').mockReturnValue(now+7200000)
 const h=new Runtime(config,{model:{async run(){throw Error('No backend calls during business answer')}}});hosts.add(h)
 expect(h.chat.businessDecisions(f.chat.id,'owner')[0]!.status).toBe('pending')
 expect(h.chat.decide(f.chat.id,'owner',input).decision.status).toBe('answered')
})
it('migrates legacy questions as expired, never as fresh approval',async()=>{
 const f=await fixture();await f.finish();const config=f.h.config
 f.h.store.db.prepare("DELETE FROM records WHERE kind='business-decision'").run();await f.h.close();hosts.delete(f.h)
 const h=new Runtime(config,{model:{async run(){throw Error('No backend')}}});hosts.add(h)
 expect(h.chat.businessDecisions(f.chat.id,'owner')[0]).toMatchObject({status:'expired',reason:'legacy_question_requires_renewal'})
})
it.each(['amount','recipient','version'])('invalidates a changed structured %s',async kind=>{
 const f=await fixture();await f.finish();const d=current(f),attention=f.ticket().attention!,terms=f.h.store.get<any>('business-decision-terms',f.id)!.terms
 if(kind==='amount')terms.amount.value='99.00';if(kind==='recipient')terms.recipient.id='different-reviewer';if(kind==='version')terms.target.version='v2'
 ;(f.h as any).reportWork(f.id,{state:'blocked',summary:d.summary,question:attention.question,askedBy:attention.triggerId,decision:terms})
 expect(current(f).status).toBe('stale');expect(()=>f.h.chat.decide(f.chat.id,'owner',answer(f,d))).toThrow('decision_stale')
})

it('hides revoked question context and never repairs routes in the read projection',async()=>{
 const f=await fixture();await f.finish();const before=database(f.h)
 expect(f.h.chat.businessDecisions(f.chat.id,'owner')).toHaveLength(1);expect(database(f.h)).toBe(before)
 f.h.config.sources[0]!.enabled=false
 expect(f.h.chat.businessDecisions(f.chat.id,'owner')).toEqual([])
})
it('does not resurrect a native execution approval when a business decision survives restart',async()=>{
 const f=await fixture();await f.finish();const config=f.h.config
 void f.h.approvals.request(f.id,{id:'native-one',method:'item/commandExecution/requestApproval',params:{}}).catch(()=>{})
 const approval=f.h.store.list<any>('approval')[0]!
 await f.h.close();hosts.delete(f.h)
 const h=new Runtime(config,{model:{async run(){throw Error('No backend')}}});hosts.add(h)
 expect(h.chat.businessDecisions(f.chat.id,'owner')[0]?.status).toBe('pending')
 expect(h.approvals.hasLiveRequest(approval.id)).toBe(false);expect(()=>h.approvals.answer(approval.id,'accept')).toThrow('expired')
})
it('recovers and answers in a separate OS process after a simulated two-hour delay',async()=>{
 const f=await fixture();await f.finish();const config=f.h.config,input=answer(f)
 await f.h.close();hosts.delete(f.h)
 const script=`import {Runtime} from './src/runtime.ts';const p=JSON.parse(process.env.DECISION_TEST);const now=Date.now();Date.now=()=>now+7200000;const h=new Runtime(p.config,{model:{async run(){throw Error('Unexpected model')}}});try{console.log(JSON.stringify(h.chat.decide(p.chat,'owner',p.input)))}finally{await h.close()}`
 const result=execFileSync(process.execPath,['--import','tsx','--input-type=module','-e',script],{cwd:process.cwd(),env:{...process.env,DECISION_TEST:JSON.stringify({config,chat:f.chat.id,input})},encoding:'utf8',timeout:10000})
 expect(JSON.parse(result).decision.status).toBe('answered')
})
it('serves the owner-scoped decision endpoint with authentication, CSRF and idempotency checks',async()=>{
 const f=await fixture('local-operator');await f.finish();const d=f.h.chat.businessDecisions(f.chat.id,'local-operator')[0]!,server=await serve(f.h)
 const url=server.url+'/api/chat/conversations/'+f.chat.id+'/decisions',input={action:'answer',id:d.id,version:d.version,requestId:randomUUID(),text:'Use the local report.'},headers={authorization:'Bearer '+readFileSync(join(f.root,'state/access-token'),'utf8').trim(),'content-type':'application/json'}
 try{
  expect((await fetch(url,{method:'POST',body:JSON.stringify(input)})).status).toBe(401)
  expect((await fetch(url,{method:'POST',headers:{...headers,origin:'https://other.example'},body:JSON.stringify(input)})).status).toBe(403)
  const response=await fetch(url,{method:'POST',headers,body:JSON.stringify(input)});expect(response.status).toBe(200);expect((await response.json() as any).decision.status).toBe('answered')
  const duplicate=await fetch(url,{method:'POST',headers,body:JSON.stringify(input)});expect((await duplicate.json() as any).duplicate).toBe(true)
 }finally{server.server.closeAllConnections();await new Promise<void>(r=>server.server.close(()=>r()))}
})

it.each(['missing-expiry','bad-version','unknown-schema'])('fails closed on persisted %s instead of treating it as pending',async kind=>{
 const f=await fixture();await f.finish();const d=current(f),stored=f.h.store.get<any>('business-decision',d.id)!
 if(kind==='missing-expiry')delete stored.expiresAt;if(kind==='bad-version')stored.version='not-a-version';if(kind==='unknown-schema')stored.schema=99
 f.h.store.put('business-decision',d.id,stored)
 expect(businessDecision(f.h,d.id)).toBeUndefined();expect(()=>assertBusinessDecision(f.h,d.id,d.version,{source:'local',id:'alice'})).toThrow('decision_unavailable')
})
