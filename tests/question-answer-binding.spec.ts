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
async function fixture(){
 const question='Which local report should be used?'
 const root=mkdtempSync(join(tmpdir(),'question-birth-'));roots.push(root);let calls=0
 const h=new Runtime(configSchema.parse({stateDir:join(root,'state'),work:{sandboxDriver:'disabled',network:false,autoRecover:false},watchdog:{enabled:false},execution:{router:{mode:'host'},management:{enabled:true,maxWorkers:1},workers:[{id:'one',backend:'codex'}]},sources:[{id:'local',kind:'local',cwd:root,workspace:{mode:'source'},allowedActors:['alice']}]}),{model:{async run(r:ModelRequest){
  if(r.role!=='worker')return {threadId:'local-router-session',turnId:'local-router-turn',text:JSON.stringify({reply:''})}
  calls++;r.onThread?.('local-question-session');r.onTurn?.('local-question-turn')
  const input=JSON.parse(r.input),person=(input.inputs??[]).filter((i:any)=>i.kind==='trigger'&&i.human&&!i.context).at(-1)??(input.origin??[]).filter((t:any)=>t?.human).map((t:any)=>({triggerId:t.id})).at(-1)
  return {threadId:'local-question-session',turnId:'local-question-turn',text:JSON.stringify({state:'blocked',summary:'A local business choice is needed.',reply:'Choose a local report.',question,askedBy:person?.triggerId??null,handbacks:[]})}
 }}});hosts.add(h)
 h.scopes.command({action:'scope.put',operationId:'scope',expectedRevision:0,scope:{id:'team',tenantId:'org',name:'Question origin fixture',contextBytes:128000,managers:[JSON.stringify(['local','alice'])],workerIds:['one'],sourceIds:['local'],backendIds:['codex']}})
 h.scopes.command({action:'entry.bind',operationId:'entry',expectedRevision:0,scopeId:'team',sourceId:'local',accountNamespace:'local',nativeId:'topic',history:'group'})
 function receive(id:string,text:string,at?:string){const input=h.receive('local','alice',{id,thread:'topic',scope:'topic',text,addressed:true,...(at?{at}:{})})as{triggerId:string};const trigger=h.store.triggers.get(input.triggerId)!;return {trigger,scoped:h.scopes.context(trigger,'local:topic')!}}
 const initial=receive('initial','Prepare a local report and ask which to use. Never contact external services.'),packet=h.memory.build(initial.scoped,{request:'Prepare only a local report'},'codex')
 const result=await h.manager.call({action:'assign',id:'one',revision:h.settings.current().revision,requestId:'ask',text:'Ask which local report should be used.'},{discussion:'local:topic',...initial,manifest:packet.manifest});const id=result.ticketId
 const ticket=()=>h.store.tickets.get(id)!,run=()=>h.store.get<Run>('run',id)!
 async function finish(minimumWorkerCalls=1){for(let n=0;n<500;n++){await h.tick();await new Promise(r=>setTimeout(r,2));if(calls>=minimumWorkerCalls&&ticket().attention&&['idle','uncertain'].includes(run()?.phase)&&!h.executionActive(id)&&h.store.deliveries().filter(d=>d.ticketId===id).every(d=>['sent','dropped'].includes(d.status)))return}throw Error('Local controlled question did not settle')}
 return {h,id,ticket,finish,receive}
}
function database(h:Runtime){return JSON.stringify(h.store.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(row=>{const name=String(row.name);return [name,h.store.db.prepare('SELECT * FROM "'+name.replaceAll('"','""')+'"').all()]}))}

function command(f:Awaited<ReturnType<typeof fixture>>,questionId:string,requestId='answer') {return {action:'send',ticketId:f.id,questionId,text:'Use the first local report.',requestId,revision:f.h.settings.current().revision}}
function context(f:Awaited<ReturnType<typeof fixture>>,id='answer-user',at?:string){const incoming=f.receive(id,'Use the first local report.',at);return {discussion:'local:topic',...incoming}}
it('rejects an outdated question ID without mutating any durable state',async()=>{
 const f=await fixture();await f.finish();const c=context(f),before=database(f.h)
 await expect(f.h.manager.call(command(f,'outdated'),c)).rejects.toThrow('Question is no longer pending')
 expect(database(f.h)).toBe(before)
})
it('binds an answer once to its question and human event; replays only the same operation',async()=>{
 const f=await fixture();await f.finish();const questionId=f.ticket().attention!.id,c=context(f),cmd=command(f,questionId)
 const result=await f.h.manager.call(cmd,c),before=database(f.h)
 expect(await f.h.manager.call(cmd,c)).toEqual(result);expect(database(f.h)).toBe(before)
 const records=f.h.store.list<any>('question-answer');expect(records).toHaveLength(1)
 expect(records[0]).toMatchObject({ticketId:f.id,questionId,triggerId:c.trigger.id,actor:{source:'local',id:'alice'}})
 await expect(f.h.manager.call(command(f,questionId,'answer-again'),c)).rejects.toThrow('Question is no longer pending')
 expect(database(f.h)).toBe(before);expect(f.h.store.list('tool-grant')).toEqual([])
})
it('requires a fresh human context instead of treating operator text as a user decision',async()=>{
 const f=await fixture();await f.finish();const before=database(f.h)
 await expect(f.h.manager.call(command(f,f.ticket().attention!.id))).rejects.toThrow('Question answer requires a human follow-up')
 expect(database(f.h)).toBe(before)
})
it('rolls back the answer record if attaching the follow-up fails',async()=>{
 const f=await fixture();await f.finish();const c=context(f),before=database(f.h)
 vi.spyOn(f.h.engine,'attach').mockImplementationOnce(()=>{throw Error('Synthetic attach failure')})
 await expect(f.h.manager.call(command(f,f.ticket().attention!.id),c)).rejects.toThrow('Synthetic attach failure')
 expect(database(f.h)).toBe(before)
})
it('rejects questionId on unrelated actions rather than silently dropping the binding',async()=>{
 const f=await fixture();await f.finish()
 await expect(f.h.manager.call({action:'list',questionId:f.ticket().attention!.id})).rejects.toThrow()
})
it('accepts the same pending question after two hours and a process restart',async()=>{
 const f=await fixture();await f.finish();const questionId=f.ticket().attention!.id,c=context(f),config=f.h.config,cmd=command(f,questionId)
 await f.h.close();hosts.delete(f.h)
 const now=Date.now();vi.spyOn(Date,'now').mockReturnValue(now+2*60*60*1000)
 const h=new Runtime(config,{model:{async run(){throw Error('No backend should run while recording an answer')}}});hosts.add(h)
 cmd.revision=h.settings.current().revision
 await expect(h.manager.call(cmd,c)).resolves.toMatchObject({ticketId:f.id,status:'queued'})
 expect(h.store.list<any>('question-answer')[0]).toMatchObject({questionId,triggerId:c.trigger.id})
 await h.close();hosts.delete(h)
 const again=new Runtime(config,{model:{async run(){throw Error('No backend should run on receipt replay')}}});hosts.add(again)
 await expect(again.manager.call(cmd,c)).resolves.toMatchObject({ticketId:f.id,status:'queued'})
 expect(again.store.list('question-answer')).toHaveLength(1)
})
it('does not let another human event reuse a completed bound-answer receipt',async()=>{
 const f=await fixture();await f.finish();const cmd=command(f,f.ticket().attention!.id)
 await f.h.manager.call(cmd,context(f))
 const other=context(f,'other-user-message'),before=database(f.h)
 await expect(f.h.manager.call(cmd,other)).rejects.toThrow('Question is no longer pending')
 expect(database(f.h)).toBe(before)
})

it('rejects an already admitted human message even after it is re-admitted following the question',async()=>{
 const f=await fixture(),old=context(f,'before-question',new Date(Date.now()+60000).toISOString());await f.finish()
 f.h.routerIngress.admit(old.trigger)
 const before=database(f.h)
 await expect(f.h.manager.call(command(f,f.ticket().attention!.id),old)).rejects.toThrow('Question answer must follow question creation')
 expect(database(f.h)).toBe(before)
})
it.each([-1,0])('rejects a late-delivered message with source time offset %d from question creation',async offset=>{
 const f=await fixture();await f.finish();const boundary=f.h.store.list<any>('question-answer-boundary')[0]
 const c=context(f,'delayed-old',new Date((boundary?.createdAt??Date.now())+offset).toISOString()),before=database(f.h)
 await expect(f.h.manager.call(command(f,f.ticket().attention!.id),c)).rejects.toThrow('Question answer must follow question creation')
 expect(database(f.h)).toBe(before)
})
it('fails closed when the question creation boundary is unavailable',async()=>{
 const f=await fixture();await f.finish();f.h.store.db.prepare("DELETE FROM records WHERE kind='question-answer-boundary'").run()
 const c=context(f),before=database(f.h)
 await expect(f.h.manager.call(command(f,f.ticket().attention!.id),c)).rejects.toThrow('Question answer must follow question creation')
 expect(database(f.h)).toBe(before)
})

it('rejects equal persisted admission sequence even with a later source timestamp',async()=>{
 const f=await fixture();await f.finish();const c=context(f),boundary=f.h.store.list<any>('question-answer-boundary')[0]
 const seq=Number(f.h.store.db.prepare("SELECT MIN(seq) AS seq FROM audit WHERE json_extract(body,'$.type')='router.admission' AND json_extract(body,'$.triggerId')=?").get(c.trigger.id)!.seq)
 const row=f.h.store.db.prepare("SELECT id FROM records WHERE kind='question-answer-boundary'").get()!
 f.h.store.put('question-answer-boundary',String(row.id),{...boundary,admissionSeq:seq})
 const before=database(f.h)
 await expect(f.h.manager.call(command(f,f.ticket().attention!.id),c)).rejects.toThrow('Question answer must follow question creation')
 expect(database(f.h)).toBe(before)
})
