import {afterEach,it,expect} from 'vitest'
import {mkdtempSync,rmSync,readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {configSchema} from '../src/config.ts'
import {Runtime} from '../src/runtime.ts'
import {Store} from '../src/store.ts'
import {RouterScopes} from '../src/router-scope.ts'
import {RouterMemory,type MemoryFact} from '../src/router-memory.ts'
import {MessageSource} from '../src/sources.ts'
import {backupState,restoreState} from '../src/backup.ts'
import type {ModelRequest,Model} from '../src/model.ts'
const roots:string[]=[],stores:Store[]=[],hosts:Runtime[]=[]
afterEach(async()=>{for(const h of hosts.splice(0))await h.close();for(const s of stores.splice(0))s.close();for(const p of roots.splice(0))rmSync(p,{recursive:true,force:true})})
function fixture(){
 const root=mkdtempSync(join(tmpdir(),'router-memory-'));roots.push(root)
 const config=configSchema.parse({stateDir:join(root,'state'),acceptMode:'off',work:{sandboxDriver:'disabled'},execution:{router:{mode:'host'},management:{enabled:true},workers:[{id:'one',backend:'codex'},{id:'two',backend:'codex'}]},sources:[{id:'local',kind:'local',allowedActors:['alice','bob'],cwd:root,workspace:{mode:'source'}}]})
 const store=new Store(join(config.stateDir,'state.sqlite'));stores.push(store)
 const scopes=new RouterScopes(store,config),memory=new RouterMemory(store,scopes,config.stateDir),source=new MessageSource(config.sources[0]!)
 for(const [id,tenantId] of [['p1','t1'],['p2','t1'],['p3','t2']] as const)scopes.command({action:'scope.put',operationId:id,expectedRevision:0,scope:{id,tenantId,name:id,managers:[JSON.stringify(['local','alice'])],workerIds:id==='p2'?['two']:['one'],sourceIds:['local'],backendIds:['codex']}})
 for(const [nativeId,scopeId,privateActor] of [['g1','p1',undefined],['g2','p1',undefined],['g3','p2',undefined],['g4','p3',undefined],['private','p1',JSON.stringify(['local','alice'])]] as const)scopes.command({action:'entry.bind',operationId:nativeId,expectedRevision:0,scopeId,sourceId:'local',accountNamespace:'account',nativeId,privateActor,history:'unknown'})
 const target=scopes.scope('p2'),{routerId,revision,epoch,...targetInput}=target
 scopes.command({action:'scope.put',operationId:'target-data',expectedRevision:revision,scope:{...targetInput,dataEntryIds:scopes.bindings().filter(b=>b.tenantId==='t1').map(b=>b.id)}})
 let seq=0
 const context=(group='g1',actor='alice',text='Budget 73',eventId?:string)=>{const t=source.trigger({id:eventId??'e'+(++seq),thread:group+'-topic',scope:group,text,addressed:true},actor);store.triggers.save(t);return scopes.context(t,'local:'+t.threads[0]!.id)!}
 const remember=(content='Budget 73',group='g1',extra:Record<string,unknown>={})=>{const c=context(group),e=memory.ingest(c);return memory.command(c,{action:'remember',operationId:'write-'+(++seq),expectedRevision:0,subject:'budget',content,sourceIds:[e.id],candidate:false,...extra},true) as MemoryFact}
 return {root,config,store,scopes,memory,source,context,remember}
}
it('captures configured Feishu command-prefixed explicit memory without changing source evidence',()=>{
 const f=fixture(),source=f.config.sources[0]!
 source.kind='feishu';source.feishu={command:'/router',chats:['g1']} as typeof source.feishu
 const text='/router 请记住：杉树验收的交付摘要采用三段格式',c=f.context('g1','alice',text)
 const fact=f.memory.captureExplicit(c) as MemoryFact
 expect(fact.state).toBe('active');expect(fact.origin).toBe('explicit');expect(fact.protected).toBe(true)
 expect(fact.content).toBe('杉树验收的交付摘要采用三段格式')
 expect(f.memory.evidence(fact.sources[0]!.id)?.text).toBe(text)
 expect(f.store.triggers.get(c.trigger.id)?.text).toBe(text)
 expect(f.memory.captureExplicit(c)).toEqual(fact)
})
it('does not turn embedded, quoted, unaddressed or lookalike commands into explicit memories',()=>{
 const f=fixture(),source=f.config.sources[0]!
 source.kind='feishu';source.feishu={command:'/router',chats:['g1']} as typeof source.feishu
 for(const text of ['/router-other 记住：不保存','/other 记住：不保存','转述 /router 记住：不保存','/router “记住：不保存”','/router 不要记住：不保存','/router记住：不保存'])expect(f.memory.captureExplicit(f.context('g1','alice',text))).toBeUndefined()
 const c=f.context('g1','alice','/router 记住：不保存');c.trigger.addressed=undefined
 expect(f.memory.captureExplicit(c)).toBeUndefined()
 source.kind='local';expect(f.memory.captureExplicit(f.context('g1','alice','/router 记住：不保存'))).toBeUndefined()
 expect(f.store.list('memory-fact')).toHaveLength(0)
})
it('F18 deletes managed history across records, effects, files, API protocol and indexes while preserving another tenant',async()=>{
 const f=fixture(),marker='BODY-DELETE-7319',c=f.context('g1','alice',marker),e=f.memory.ingest(c)
 f.memory.command(c,{action:'remember',operationId:'body',expectedRevision:0,subject:'removal',content:marker,sourceIds:[e.id],candidate:false},true)
 const unaffected=f.remember('UNRELATED-4821','g4')
 const asset=join(f.config.stateDir,'assets','owned','file.txt');mkdirSync(join(f.config.stateDir,'assets','owned'),{recursive:true});writeFileSync(asset,marker)
 f.store.put('asset','owned',{id:'owned',triggerId:c.trigger.id,path:asset,name:'file.txt'})
 f.store.put('model-session','api:owned',{threadId:'api:owned',triggerId:c.trigger.id,cwd:f.root})
 f.store.put('backend-thread','api:owned',{id:'api:owned',messages:[{role:'user',content:marker}],turns:[],effects:{receipt:{result:marker}}})
 f.store.put('resource-page','cached',{principal:JSON.stringify({triggerId:c.trigger.id}),text:marker})
 f.store.put('custom-derived','derived',{triggerId:c.trigger.id,unrecognizedPayload:{secretText:marker,numericSecret:7319},result:{[marker]:'value',id:marker}})
 f.store.outbox.send({id:'delivered',kind:'reply',channel:c.trigger.channel!,text:marker,...{triggerId:c.trigger.id}} as any);f.store.delivered('delivered')
 f.store.audit({triggerId:c.trigger.id,arbitraryContent:marker})
 const value=f.memory.command(c,{action:'history.delete',operationId:'erase',expectedRevision:0}) as any
 expect(value.conversationHistory).toBe('processing')
 expect(f.store.triggers.get(c.trigger.id)!.text).toBe('')
 expect(f.store.deliveries()[0]!.status).toBe('sent');expect(f.store.deliveries()[0]!.text).toBe('')
 expect(f.store.deliveries()[0]!.channel.source).toBe(c.trigger.source)
 expect(f.memory.fact(unaffected.id)?.content).toBe('UNRELATED-4821')
 const purged:string[]=[]
 const model:Model={run:async()=>{throw Error('No inference')},purge:async id=>{purged.push(id);f.store.put('backend-thread',id,{id,deleted:true});return {local:'verified',provider:'not_managed'}}}
 await f.memory.cleanup.process(model,async()=>true)
 expect(purged).toEqual(['api:owned']);expect(existsSync(asset)).toBe(false)
 expect(f.memory.cleanup.receipts()[0]).toMatchObject({status:'completed',local:'verified',external:'not_managed',backups:'restore_fenced'})
 const raw=JSON.stringify(f.store.db.prepare('SELECT * FROM records').all())+JSON.stringify(f.store.db.prepare('SELECT * FROM audit').all())+JSON.stringify(f.store.deliveries())
 expect(raw).not.toContain(marker);expect(readFileSync(join(f.config.stateDir,'state.sqlite')).includes(Buffer.from(marker))).toBe(false)
 // A late callback must not resurrect body text or queue a new external send.
 f.store.put('resource-page','late',{triggerId:c.trigger.id,text:marker})
 f.store.outbox.send({id:'late',kind:'reply',channel:c.trigger.channel!,text:marker,...{triggerId:c.trigger.id}} as any)
 expect(f.store.get<any>('resource-page','late').text).toBe('');expect(f.store.deliveries().find(d=>d.id==='late')?.status).toBe('dropped')
})
it('F18 keeps failed deletion processing and retries after quiescence without declaring external deletion',async()=>{
 const f=fixture(),c=f.context();f.memory.ingest(c)
 f.store.put('model-session','native-owned',{threadId:'native-owned',triggerId:c.trigger.id,cwd:f.root})
 f.memory.command(c,{action:'history.delete',operationId:'erase',expectedRevision:0})
 let attempts=0
 const model:Model={run:async()=>{throw Error('unused')},purge:async()=>{if(++attempts===1)throw Error('Temporary native deletion failure');return {local:'verified',provider:'not_managed'}}}
 await f.memory.cleanup.process(model,async()=>false);expect(attempts).toBe(0)
 await f.memory.cleanup.process(model,async()=>true);expect(f.memory.cleanup.receipts()[0]).toMatchObject({status:'processing',phase:'native_history'})
 const pending=f.memory.cleanup.receipts()[0]!;f.store.put('history-cleanup',pending.id,{...pending,nextAt:0})
 await f.memory.cleanup.process(model,async()=>true);expect(f.memory.cleanup.receipts()[0]).toMatchObject({status:'completed',nativeDone:['native-owned']})
})
it('F18 deletes source resource caches by exact URI dependency, including late pages and older completed cleanup',async()=>{
 const f=fixture(),marker='RESOURCE-BODY-4197',c=f.context('g1','alice',marker);f.memory.ingest(c)
 const resources=['feishu','wecom','trigger-source','trigger','ticket','transcript','native']
 for(const resource of resources)f.store.put('resource-page',resource,{resource:resource+'/'+c.trigger.id+'/message',principal:'{}',text:marker})
 f.store.put('resource-page','unrelated',{resource:'feishu/'+c.trigger.id+'-other/message',principal:'{}',text:'keep unrelated'})
 f.memory.command(c,{action:'history.delete',operationId:'delete-resources',expectedRevision:0})
 const model:Model={run:async()=>{throw Error('No inference')}}
 await f.memory.cleanup.process(model,async()=>true)
 for(const resource of resources)expect(f.store.get<any>('resource-page',resource).text).toBe('')
 expect(f.store.get<any>('resource-page','unrelated').text).toBe('keep unrelated')
 f.store.put('resource-page','late-uri',{resource:'feishu/'+c.trigger.id+'/thread',principal:'{}',text:marker})
 expect(f.store.get<any>('resource-page','late-uri').text).toBe('')
 // Simulate a pre-fix database that incorrectly marked its cleanup completed.
 f.store.db.prepare('INSERT INTO records(kind,id,body) VALUES(?,?,?)').run('resource-page','old-uri',JSON.stringify({resource:'feishu/'+c.trigger.id+'/message',principal:'{}',text:marker}))
 const restarted=new RouterMemory(f.store,f.scopes,f.config.stateDir)
 expect(restarted.cleanup.receipts()[0]?.status).toBe('processing')
 await restarted.cleanup.process(model,async()=>true)
 expect(restarted.cleanup.receipts()[0]?.status).toBe('completed')
 expect(readFileSync(join(f.config.stateDir,'state.sqlite')).includes(Buffer.from(marker))).toBe(false)
})
it('F12 source body deletion preserves independent support and removes joint projections',async()=>{
 const f=fixture(),a=f.context('g1','alice','first evidence'),ea=f.memory.ingest(a),b=f.context('g1','alice','second evidence'),eb=f.memory.ingest(b)
 const independent=f.memory.command(b,{action:'remember',operationId:'ind',expectedRevision:0,subject:'independent',content:'still supported',sourceIds:[ea.id,eb.id],relation:'independent',candidate:false},true) as MemoryFact
 const joint=f.memory.command(b,{action:'remember',operationId:'joint',expectedRevision:0,subject:'joint',content:'combined secret',sourceIds:[ea.id,eb.id],relation:'joint',candidate:false},true) as MemoryFact
 f.memory.command(a,{action:'source.delete',operationId:'delete-source',expectedRevision:1,id:ea.id})
 expect(f.memory.fact(independent.id)?.state).toBe('active');expect(f.memory.fact(joint.id)?.content).toBe('')
 expect(f.store.triggers.get(a.trigger.id)?.text).toBe('');expect(f.store.triggers.get(b.trigger.id)?.text).toBe('second evidence')
 expect(f.memory.query(f.context(),{id:independent.id}).items).toHaveLength(1)
})
it('F18 deletion leaves valid scheduler envelopes across ticks, restart and a fresh authorized request',async()=>{
 const f=fixture();f.store.close();stores.splice(stores.indexOf(f.store),1);let seq=0
 const model:Model={purge:async()=>({local:'verified',provider:'not_managed'}),async run(r){const threadId='owned-'+(++seq);r.onThread?.(threadId);return {threadId,turnId:'turn-'+seq,text:JSON.stringify(r.role==='worker'?{state:'ready',summary:'checked',reply:'2',question:null,askedBy:null,handbacks:[]}:{reply:'accepted'})}}}
 let h=new Runtime(f.config,{model});hosts.push(h)
 h.receive('local','alice',{id:'delete-runtime',thread:'g1-topic',scope:'g1',text:'RUNTIME-BODY-5173',addressed:true})
 const t=h.store.triggers.get('local:delete-runtime')!,c=h.scopes.context(t,'local:g1-topic')!,manifest=h.memory.build(c,{request:t.text},'test').manifest
 await h.manager.call({action:'assign',id:'one',text:'Calculate 1+1',requestId:'scheduler-task',revision:0},{discussion:c.route.discussion,trigger:t,scoped:c,manifest})
 for(let i=0;i<100;i++){await h.tick();await new Promise(r=>setTimeout(r,2));if(h.status().active===0&&!h.store.jobs().length)break}
 h.memory.command(h.scopes.context(t,c.route.discussion)!,{action:'history.delete',operationId:'delete-runtime',expectedRevision:0})
 await expect(h.tick()).resolves.toBeUndefined();await expect(h.tick()).resolves.toBeUndefined()
 expect(h.store.threads.list().every(t=>Array.isArray(t.pending)&&Array.isArray(t.subscriptions)&&!!t.ref)).toBe(true)
 expect(h.memory.cleanup.receipts()[0]?.status).toBe('completed')
 await h.close();hosts.splice(hosts.indexOf(h),1)
 h=new Runtime(f.config,{model});hosts.push(h)
 expect(()=>h.routerIngress.authority(t.id)).toThrow('deleted')
 h.receive('local','alice',{id:'after-cleanup',thread:'g1-new',scope:'g1',text:'new current request',addressed:true})
 for(let i=0;i<100;i++){await h.tick();await new Promise(r=>setTimeout(r,2));if(h.store.deliveries().some(d=>d.text==='accepted'&&d.status==='sent'))break}
 expect(h.store.deliveries().some(d=>d.text==='accepted'&&d.status==='sent')).toBe(true)
 expect(JSON.stringify(h.store.db.prepare('SELECT body FROM records').all())).not.toContain('RUNTIME-BODY-5173')
})
it('R01/R02/F01 isolates same-Router groups and tenants before returning titles or snippets',()=>{
 const f=fixture(),fact=f.remember()
 expect(f.memory.query(f.context('g1'),{query:'Budget'}).items.map(x=>x.id)).toEqual([fact.id])
 for(const group of ['g2','g3','g4'])expect(f.memory.query(f.context(group),{query:'Budget'}).items).toEqual([])
 expect(f.scopes.context(f.context('g1').trigger,'new-topic')!.route.routerId).toBe(f.context('g2').route.routerId)
})
it('F02/F05 publishes a pinned version and invalidates it on correction',()=>{
 const f=fixture(),fact=f.remember(),target=f.context('g2').route.entryId
 f.memory.command(f.context(),{action:'share',operationId:'share',expectedRevision:1,id:fact.id,targetEntry:target},true)
 expect(f.memory.query(f.context('g2'),{}).items[0]?.content).toBe('Budget 73')
 const c=f.context(),e=f.memory.ingest(c)
 f.memory.command(c,{action:'remember',operationId:'correct',expectedRevision:1,id:fact.id,subject:'budget',content:'Budget 74',sourceIds:[e.id],candidate:false},true)
 expect(f.memory.query(f.context('g2'),{}).items).toEqual([])
 expect(f.memory.query(f.context(),{}).items[0]?.content).toBe('Budget 74')
})
it('F03 keeps private facts away from group replies and other actors',()=>{
 const f=fixture();f.remember('Private preference','private',{visibility:'private'})
 expect(f.memory.query(f.context('private'),{}).items).toHaveLength(1)
 expect(f.memory.query(f.context('private','bob'),{}).items).toHaveLength(0)
 expect(f.memory.query(f.context('g1'),{}).items).toHaveLength(0)
})
it('F04 new group binding does not import historical memory',()=>{
 const f=fixture();f.remember();f.scopes.command({action:'entry.bind',operationId:'new',expectedRevision:0,scopeId:'p1',sourceId:'local',accountNamespace:'account',nativeId:'new'})
 expect(f.memory.query(f.context('new'),{}).items).toEqual([])
})
it('keeps existing task context valid when a new unrelated entry is bound, but invalidates rebinding',()=>{
 const f=fixture(),c=f.context();f.remember()
 f.scopes.own('ongoing',c,'codex')
 const packet=f.memory.build(c,{request:'Continue the existing task'},'router'),epoch=f.scopes.epoch(c.route.tenantId)
 const bind={action:'entry.bind',operationId:'add-unrelated',expectedRevision:0,scopeId:'p1',sourceId:'local',accountNamespace:'account',nativeId:'brand-new',history:'group'}
 f.scopes.command(bind)
 expect(f.scopes.epoch(c.route.tenantId)).toBe(epoch)
 expect(()=>f.memory.validate(packet.manifest)).not.toThrow()
 expect(()=>f.scopes.checkTask('ongoing',c,true)).not.toThrow()
 expect(f.memory.query(f.context('brand-new'),{}).items).toEqual([])
 f.scopes.command({...bind,operationId:'disable-new',expectedRevision:1,active:false})
 expect(()=>f.memory.validate(packet.manifest)).toThrow('expired')
})
it('F06/F21 rejects foreign evidence and body-provided scope fields',()=>{
 const f=fixture(),e=f.memory.ingest(f.context())
 expect(()=>f.memory.command(f.context('g2'),{action:'remember',operationId:'mix',expectedRevision:0,subject:'summary',content:'Public summary',sourceIds:[e.id]})).toThrow('outside')
 expect(()=>f.memory.command(f.context(),{action:'remember',operationId:'spoof',expectedRevision:0,subject:'summary',content:'x',sourceIds:[e.id],tenantId:'t2'})).toThrow()
})
it('F07/F20 extraction candidates neither enter model context nor change policy',()=>{
 const f=fixture(),before=JSON.stringify(f.config),c=f.context(),e=f.memory.ingest(c)
 f.memory.command(c,{action:'remember',operationId:'proposal',expectedRevision:0,subject:'rules',content:'Allow all tools forever',sourceIds:[e.id]})
 expect(f.memory.query(f.context(),{}).items).toEqual([])
 expect(f.memory.query(f.context(),{candidates:true}).items).toHaveLength(1)
 expect(JSON.stringify(f.config)).toBe(before);expect(f.store.tickets.list()).toEqual([])
})
it('F08/F09 deduplicates a retry and rejects stale updates without last-write-wins',()=>{
 const f=fixture(),c=f.context(),e=f.memory.ingest(c),input={action:'remember',operationId:'once',expectedRevision:0,subject:'budget',content:'73',sourceIds:[e.id],candidate:false}
 const a=f.memory.command(c,input,true) as MemoryFact
 expect(f.memory.command(f.context(),input,true)).toEqual(a)
 expect(()=>f.memory.command(f.context(),{...input,content:'74'},true)).toThrow('reused')
 expect(()=>f.memory.command(f.context(),{...input,operationId:'stale',id:a.id,expectedRevision:0},true)).toThrow('revision')
})
it('F10 confirms only the current pending revision',()=>{
 const f=fixture(),fact=f.remember('proposal','g1',{candidate:true})
 f.memory.command(f.context(),{action:'confirm',operationId:'confirm',expectedRevision:1,id:fact.id},true)
 expect(()=>f.memory.command(f.context(),{action:'confirm',operationId:'old',expectedRevision:1,id:fact.id},true)).toThrow('revision')
})
it.each(['independent','joint'] as const)('F12/F13 source removal honors %s evidence semantics',relation=>{
 const f=fixture(),a=f.memory.ingest(f.context()),b=f.memory.ingest(f.context()),fact=f.remember('supported','g1',{sourceIds:[a.id,b.id],relation})
 f.memory.command(f.context(),{action:'source.delete',operationId:'remove',expectedRevision:1,id:a.id},true)
 expect(f.memory.query(f.context(),{}).items.map(x=>x.id)).toEqual(relation==='independent'?[fact.id]:[])
 expect(f.memory.evidence(a.id)?.text).toBe('')
})
it('F14 expiry excludes a fact and invalidates an in-flight manifest',()=>{
 const f=fixture(),fact=f.remember('time limited','g1',{expiresAt:Date.now()+60000}),c=f.context(),packet=f.memory.build(c,{request:'x'},'backend')
 f.store.put('memory-fact',fact.id,{...fact,expiresAt:Date.now()-1})
 expect(f.memory.query(f.context(),{}).items).toEqual([]);expect(()=>f.memory.validate(packet.manifest)).toThrow('expired')
})
it('F15 clearing rejects a late extraction captured before the clear',()=>{
 const f=fixture(),c=f.context(),e=f.memory.ingest(c),capture=f.memory.capture(c,[e.id])
 f.memory.command(c,{action:'clear',operationId:'clear',expectedRevision:0},true)
 expect(()=>f.memory.command(f.context(),{action:'remember',operationId:'late',expectedRevision:0,subject:'budget',content:'73',sourceIds:[e.id],capture})).toThrow('generation')
 expect(f.remember('new message').state).toBe('active')
})
it('F16 forget suppresses re-extraction and clears historical fact bodies',()=>{
 const f=fixture(),fact=f.remember()
 f.memory.command(f.context(),{action:'forget',operationId:'forget',expectedRevision:1,id:fact.id},true)
 expect(f.memory.fact(fact.id)?.content).toBe('');expect(()=>f.remember()).toThrow('forgotten')
})
it('F17 disabling memory stops injection without deleting facts',()=>{
 const f=fixture(),fact=f.remember(),s=f.scopes.scope('p1'),{routerId,revision,epoch,...scope}=s
 f.scopes.command({action:'scope.put',operationId:'disable',expectedRevision:revision,scope:{...scope,memoryEnabled:false}})
 expect(f.memory.query(f.context(),{}).status).toBe('unavailable');expect(f.memory.fact(fact.id)?.content).toBe('Budget 73')
})
it('F22 old page cursors cannot survive permission changes',()=>{
 const f=fixture();f.remember('one');f.remember('two');const first=f.memory.query(f.context(),{limit:1});expect(first.cursor).toBeTruthy()
 const fact=f.memory.query(f.context(),{}).items[0]!
 f.memory.command(f.context(),{action:'forget',operationId:'forget',expectedRevision:fact.revision,id:fact.id},true)
 expect(()=>f.memory.query(f.context(),{limit:1,cursor:first.cursor})).toThrow('cursor')
})
it('R03/R04 binding revisions and operation receipts prevent overlapping ownership',()=>{
 const f=fixture(),entry=f.scopes.entry(f.context().trigger)!,x={action:'entry.bind',operationId:'rebind',expectedRevision:1,scopeId:'p2',sourceId:'local',accountNamespace:'account',nativeId:'g1'}
 const result=f.scopes.command(x);expect(f.scopes.command(x)).toEqual(result)
 expect(()=>f.scopes.command({...x,operationId:'race',scopeId:'p1'})).toThrow('Revision')
 expect(f.scopes.binding(entry.id).scopeId).toBe('p2')
})
it('R05/R12 unknown entries and cross-tenant ownership fail closed',()=>{
 const f=fixture();expect(()=>f.context('unknown')).toThrow('unassigned')
 const c=f.context();f.scopes.own('task',c,'codex')
 expect(()=>f.scopes.command({action:'task.transfer',operationId:'cross',expectedRevision:1,ticketId:'task',scopeId:'p3'})).toThrow('tenant')
})
it('R06/R08 sharing and rebinding preserve task identity and old ownership',()=>{
 const f=fixture(),c=f.context(),owner=f.scopes.own('task-one',c,'codex'),b=f.context('g2')
 expect(()=>f.scopes.checkTask('task-one',b)).toThrow('permission')
 f.scopes.command({action:'task.channel',operationId:'grant',expectedRevision:0,ticketId:'task-one',entryId:b.route.entryId,context:true,request:true,result:true})
 expect(()=>f.scopes.checkTask('task-one',f.context('g2'))).not.toThrow()
 f.scopes.command({action:'entry.bind',operationId:'rebind',expectedRevision:1,scopeId:'p2',sourceId:'local',accountNamespace:'account',nativeId:'g1'})
 expect(f.scopes.ownership('task-one')).toEqual(owner)
 expect(f.context('g1','alice','Continue task-one').route.routerId).toBe(owner.routerId)
 const other=f.source.trigger({id:'new-topic',thread:'other',scope:'g1',text:'new',addressed:true},'alice');expect(f.scopes.context(other,'local:other')?.route.scopeId).toBe('p2')
})
it('R09/R13/C11 transfer fences old contexts, keeps the Worker and holds pending delivery IDs',()=>{
 const f=fixture(),c=f.context();f.scopes.own('task',c,'codex');f.store.put('run','task',{ticketId:'task',assignmentId:'a',phase:'idle',cwd:f.root,threadId:'native-original',backendId:'codex',model:'sol'})
 f.store.outbox.send({id:'reply',ticketId:'task',kind:'reply',text:'old output',channel:{source:'local',thread:'g1',address:{}}})
 const before=f.store.get('run','task'),x={action:'task.transfer',operationId:'transfer',expectedRevision:1,ticketId:'task',scopeId:'p2'}
 const changed=f.scopes.command(x);expect(f.scopes.command(x)).toEqual(changed)
 expect(()=>f.scopes.checkTask('task',c)).toThrow('changed');expect(f.store.get('run','task')).toEqual(before)
 expect(f.store.deliveries()[0]).toMatchObject({id:'reply',status:'held'})
 expect(()=>f.scopes.command({...x,operationId:'second'})).toThrow('Revision')
})
it('R15 denies a transfer without target backend rights',()=>{
 const f=fixture();f.scopes.own('task',f.context(),'codex');const s=f.scopes.scope('p2'),{routerId,revision,epoch,...scope}=s
 f.scopes.command({action:'scope.put',operationId:'restrict',expectedRevision:revision,scope:{...scope,backendIds:[]}})
 expect(()=>f.scopes.command({action:'task.transfer',operationId:'transfer',expectedRevision:1,ticketId:'task',scopeId:'p2'})).toThrow('permission')
 expect(f.scopes.ownership('task')?.ownerEpoch).toBe(1)
})
it('C01/C02 session keys isolate audiences and expire on revocation',()=>{
 const f=fixture(),fact=f.remember(),a=f.memory.build(f.context(),{request:'budget'},'api'),b=f.memory.build(f.context('g2'),{request:'budget'},'api')
 expect(a.input).toContain('Budget 73');expect(b.input).not.toContain('Budget 73');expect(a.manifest.sessionKey).not.toBe(b.manifest.sessionKey)
 f.memory.command(f.context(),{action:'forget',operationId:'forget',expectedRevision:1,id:fact.id},true)
 expect(()=>f.memory.validate(a.manifest)).toThrow('expired')
 expect(f.memory.build(f.context(),{request:'budget'},'api').manifest.sessionKey).not.toBe(a.manifest.sessionKey)
})
it('C05 enforces byte budgets without truncating the required request',()=>{
 const f=fixture(),{routerId,revision,epoch,...scope}=f.scopes.scope('p1')
 f.scopes.command({action:'scope.put',operationId:'small-budget',expectedRevision:revision,scope:{...scope,contextBytes:256000}})
 expect(()=>f.memory.build(f.context(),{request:'字'.repeat(100000)},'api')).toThrow('budget')
 const p=f.memory.build(f.context(),{request:'keep'},'api');expect(JSON.parse(p.input).request).toBe('keep');expect(p.manifest.bytes).toBe(Buffer.byteLength(p.input))
})
it('C05 explicit budget rebuild retains task, pending inputs, backend and effect receipts without scheduling work',async()=>{
 const f=fixture();f.store.close();stores.splice(stores.indexOf(f.store),1)
 const h=new Runtime(f.config,{model:{async run(){throw Error('Rebuild must not invoke a model')}}});hosts.push(h)
 h.receive('local','alice',{id:'rebuild-origin',thread:'g1-topic',scope:'g1',text:'Calculate 1+1',addressed:true})
 const trigger=h.store.triggers.get('local:rebuild-origin')!,c=h.scopes.context(trigger,'local:g1-topic')!,packet=h.memory.build(c,{request:trigger.text},'codex')
 const a=await h.manager.call({action:'assign',id:'one',text:'Calculate 1+1',requestId:'assign-rebuild',revision:0},{discussion:c.route.discussion,trigger,scoped:c,manifest:packet.manifest})
 const id=a.ticketId,ticket=h.store.tickets.get(id)!,before=JSON.stringify(ticket),jobs=JSON.stringify(h.store.jobs())
 h.store.put('run',id,{ticketId:id,assignmentId:ticket.assignments.at(-1)!.id,threadId:'previous-native',cwd:f.root,phase:'uncertain',backendId:'codex',model:'original-sol',agentOptions:{effort:'high'}})
 h.store.put('context-rebuild',id,{ticketId:id,state:'held',reason:'context_budget_exceeded'})
 h.store.put('tool-receipt','effect',{id:'effect',ticketId:id,state:'uncertain'})
 const command={action:'rebuild',ticketId:id,requestId:'rebuild',revision:0}
 await expect(h.manager.call(command)).rejects.toThrow('uncertain effects')
 h.store.put('tool-receipt','effect',{id:'effect',ticketId:id,state:'complete',result:'already done'})
 const result=await h.manager.call(command)
 expect(result.status).toBe('awaiting_followup');expect(JSON.stringify(h.store.tickets.get(id))).toBe(before);expect(JSON.stringify(h.store.jobs())).toBe(jobs)
 expect(h.store.get<any>('run',id)).toMatchObject({cwd:f.root,phase:'idle',backendId:'codex',model:'original-sol',agentOptions:{effort:'high'}})
 expect(h.store.get<any>('run',id).threadId).toBeUndefined();expect(h.store.get<any>('context-handoff',result.handoff).toolReceipts[0].id).toBe('effect')
 expect(await h.manager.call(command)).toEqual(result)
})
it('G16 restoring old memory data replays the newer external deletion ledger',async()=>{
 const f=fixture(),fact=f.remember();await backupState(f.config,join(f.root,'backup'))
 f.memory.command(f.context(),{action:'forget',operationId:'forget',expectedRevision:1,id:fact.id},true)
 f.store.close();stores.splice(stores.indexOf(f.store),1)
 await restoreState(f.config,join(f.root,'backup'))
 const s=new Store(join(f.config.stateDir,'state.sqlite'));stores.push(s);const scopes=new RouterScopes(s,f.config),m=new RouterMemory(s,scopes,f.config.stateDir)
 expect(m.fact(fact.id)?.state).toBe('tombstoned');expect(m.fact(fact.id)?.content).toBe('')
})
it('G17 missing deletion ledger refuses service restoration',()=>{
 const f=fixture(),fact=f.remember();f.memory.command(f.context(),{action:'forget',operationId:'forget',expectedRevision:1,id:fact.id},true)
 writeFileSync(join(f.config.stateDir,'memory-revocations.jsonl'),'')
 expect(()=>new RouterMemory(f.store,f.scopes,f.config.stateDir)).toThrow('ledger')
})
it('G16 body deletion survives an old database snapshot and fences late native session registration',async()=>{
 const f=fixture(),c=f.context('g1','alice','RESTORE-BODY-8251');f.memory.ingest(c)
 await backupState(f.config,join(f.root,'body-backup'))
 f.memory.command(c,{action:'history.delete',operationId:'delete-body',expectedRevision:0})
 // A thread/start reply can arrive after the deletion command. Its ownership
 // remains metadata, and the newly discovered ID must join the external ledger.
 f.store.put('model-session','late-native',{threadId:'late-native',triggerId:c.trigger.id,cwd:f.root})
 await f.memory.cleanup.process({run:async()=>{throw Error('unused')},purge:async()=>({local:'verified',provider:'not_managed'})},async()=>true)
 expect(readFileSync(join(f.config.stateDir,'memory-revocations.jsonl'),'utf8')).toContain('late-native')
 // Offline restore in a new state directory with the latest ledger, as required.
 const restored=join(f.root,'restored');mkdirSync(restored)
 writeFileSync(join(restored,'state.sqlite'),readFileSync(join(f.root,'body-backup/state.sqlite')))
 writeFileSync(join(restored,'memory-revocations.jsonl'),readFileSync(join(f.config.stateDir,'memory-revocations.jsonl')))
 const s=new Store(join(restored,'state.sqlite'));stores.push(s);const config={...f.config,stateDir:restored},scopes=new RouterScopes(s,config),memory=new RouterMemory(s,scopes,restored)
 expect(s.triggers.get(c.trigger.id)?.text).toBe('')
 expect(memory.cleanup.plans()[0]?.sessions.map(s=>s.threadId)).toContain('late-native')
 expect(memory.cleanup.receipts()[0]?.status).toBe('processing')
})
it('C01/C02 runs actual host coordination with captured model inputs and stale-output fencing',async()=>{
 const f=fixture();f.store.close();stores.splice(stores.indexOf(f.store),1)
 const calls:ModelRequest[]=[];let release:(()=>void)|undefined
 const model:Model={async run(r){calls.push(r);r.onThread?.('native-'+calls.length);if(calls.length===2)await new Promise<void>(resolve=>{release=resolve});return {threadId:'native-'+calls.length,turnId:'turn',text:JSON.stringify({reply:'Router response'})}}}
 const h=new Runtime(f.config,{model});hosts.push(h)
 const receive=(id:string,group:string)=>h.receive('local','alice',{id,thread:group+'-new',scope:group,text:'request',addressed:true})
 receive('one','g1');for(let i=0;i<50&&!h.store.list('router-result').length;i++){await h.tick();await new Promise(r=>setTimeout(r,2))}
 receive('two','g2');for(let i=0;i<50&&!release;i++){await h.tick();await new Promise(r=>setTimeout(r,2))}
 expect(calls).toHaveLength(2);expect(calls[1]!.threadId).toBeUndefined()
 const e=h.scopes.entry(h.store.triggers.get('local:two')!)!
 h.scopes.command({action:'entry.bind',operationId:'remove',expectedRevision:e.revision,scopeId:e.scopeId,sourceId:'local',accountNamespace:'account',nativeId:'g2',active:false})
 release!();for(let i=0;i<20;i++){await h.tick();await new Promise(r=>setTimeout(r,2))}
 expect(h.store.list('router-result')).toHaveLength(1)
 expect(h.store.deliveries().filter(d=>d.channel.thread==='g2-new')).toEqual([])
})
it('forget also fences idempotent mutation receipts rather than returning deleted fact bodies',()=>{
 const f=fixture(),c=f.context(),e=f.memory.ingest(c),command={action:'remember',operationId:'receipt',expectedRevision:0,subject:'secret',content:'receipt-secret-marker',sourceIds:[e.id],candidate:false}
 const fact=f.memory.command(c,command,true) as MemoryFact
 f.memory.command(f.context(),{action:'forget',operationId:'remove',expectedRevision:1,id:fact.id},true)
 expect(f.memory.command(f.context(),command,true)).toEqual({id:fact.id,revision:1,outcome:'completed',available:false})
 expect(JSON.stringify(f.store.list('memory-receipt'))).not.toContain('receipt-secret-marker')
})
it('R06/C04 cross-group follow-up keeps the Worker thread and confines newly supplied material to the new reply entry',async()=>{
 const f=fixture();f.store.close();stores.splice(stores.indexOf(f.store),1)
 let calls=0,workerTurns=0,ticketId=''
 const model:Model={async run(r){const input=JSON.parse(r.input),threadId=r.threadId??'native-'+(++calls);r.onThread?.(threadId);r.onTurn?.('turn-'+(++calls))
  if(r.role==='worker'){workerTurns++;return {threadId,turnId:'worker-turn-'+workerTurns,text:JSON.stringify({state:'ready',summary:'checked',reply:workerTurns===1?'2':'B-only result',question:null,askedBy:null,handbacks:[]})}}
  if(input.kind==='user_message'){
   const list=await r.onTool!('worker_manage',{action:'list'},'list'),revision=JSON.parse(list.contentItems[0]!.text!).revision
   const result=await r.onTool!('worker_manage',input.trigger.text==='initial'?{action:'assign',id:'one',revision,requestId:'initial',text:'Compute 1+1'}:{action:'send',ticketId,revision,requestId:'followup',text:'Recheck and include this B-only result'},'write')
   expect(result.success).toBe(true);if(!ticketId)ticketId=JSON.parse(result.contentItems[0]!.text!).ticketId
   return {threadId,turnId:'router',text:JSON.stringify({reply:''})}
  }
  return {threadId,turnId:'router',text:JSON.stringify({reply:input.messages.map((m:any)=>m.text).join(' ')})}
 }}
 const h=new Runtime(f.config,{model});hosts.push(h)
 const settle=async(check:()=>boolean)=>{for(let i=0;i<200;i++){await h.tick();await new Promise(r=>setTimeout(r,2));if(check())return}throw Error(JSON.stringify(h.store.list('router-error')))}
 h.receive('local','alice',{id:'a',thread:'g1-thread',scope:'g1',text:'initial',addressed:true})
 await settle(()=>h.store.deliveries().some(d=>!d.channel.address.routerInbox&&d.status==='sent'))
 const before=h.store.get<any>('run',ticketId),g2=h.scopes.bindings().find(b=>b.nativeId==='g2')!
 h.scopes.command({action:'task.channel',operationId:'share-task',expectedRevision:0,ticketId,entryId:g2.id,context:true,request:true,result:true})
 h.receive('local','alice',{id:'b',thread:'g2-thread',scope:'g2',text:ticketId+' recheck',addressed:true})
 await settle(()=>h.store.deliveries().some(d=>d.channel.thread==='g2-thread'&&d.status==='sent'))
 expect(h.store.tickets.list()).toHaveLength(1);expect(workerTurns).toBe(2);expect(h.store.get<any>('run',ticketId).threadId).toBe(before.threadId)
 expect(h.store.deliveries().filter(d=>!d.channel.address.routerInbox&&d.text.includes('B-only')).map(d=>d.channel.thread)).toEqual(['g2-thread'])
 expect(()=>h.scopes.checkTaskEntry(h.scopes.ownership(ticketId)!,h.scopes.bindings().find(b=>b.nativeId==='g1')!.id,'result')).toThrow('permission')
})
it('R06/C10 adding task channels preserves other tasks, and new input fences only affected task snapshots',()=>{
 const f=fixture(),a=f.context(),b=f.context('g2'),snapshots:any[]=[]
 for(let i=0;i<4;i++){
  const id='parallel-'+i,owner=f.scopes.own(id,a,'codex'),packet=f.memory.build(a,{task:id},'backend')
  packet.manifest.taskOwners=[{id,epoch:owner.ownerEpoch,dataRevision:1}]
  f.store.put('task-context',id,{manifest:packet.manifest});snapshots.push(structuredClone(packet.manifest))
 }
 for(let i=0;i<4;i++)f.scopes.command({action:'task.channel',operationId:'grant-'+i,expectedRevision:0,ticketId:'parallel-'+i,entryId:b.route.entryId,context:true,request:true,result:true})
 for(const snapshot of snapshots)expect(()=>f.memory.validate(snapshot)).not.toThrow()
 f.scopes.noteInput('parallel-1',b);f.memory.moveTaskContext('parallel-1',b)
 expect(()=>f.memory.validate(snapshots[1])).toThrow('input changed')
 for(const i of [0,2,3])expect(()=>f.memory.validate(snapshots[i])).not.toThrow()
 expect(()=>f.memory.validate(f.store.get<any>('task-context','parallel-1').manifest)).not.toThrow()
 expect(()=>f.scopes.checkTaskEntry(f.scopes.ownership('parallel-1')!,a.route.entryId,'result')).toThrow('permission')
 f.scopes.command({action:'task.channel',operationId:'withdraw',expectedRevision:1,ticketId:'parallel-2',entryId:a.route.entryId,context:false,request:false,result:false,active:false})
 expect(()=>f.memory.validate(snapshots[2])).toThrow('permission')
 expect(()=>f.memory.validate(snapshots[0])).not.toThrow()
})
it('scope creation cannot silently strand existing unowned work',()=>{
 const f=fixture();f.store.db.prepare("DELETE FROM records WHERE kind IN ('management-scope','control-receipt')").run()
 f.store.put('ticket','legacy',{id:'legacy'})
 expect(()=>f.scopes.command({action:'scope.put',operationId:'new-scope',expectedRevision:0,scope:{id:'new',tenantId:'t1',name:'New',managers:['alice'],workerIds:[],sourceIds:['local'],backendIds:['codex']}})).toThrow('migration')
 expect(f.scopes.enabled()).toBe(false)
})
it('F17 clearing remains available while memory is disabled',()=>{
 const f=fixture();f.remember();const {routerId,revision,epoch,...scope}=f.scopes.scope('p1')
 f.scopes.command({action:'scope.put',operationId:'disabled',expectedRevision:revision,scope:{...scope,memoryEnabled:false}})
 expect(f.memory.command(f.context(),{action:'clear',operationId:'clear-disabled',expectedRevision:0},true)).toMatchObject({status:'stopped_using',localMemory:'verified',conversationHistory:'retained'})
 expect(f.store.list<MemoryFact>('memory-fact').every(x=>x.content===''&&x.subject==='')).toBe(true)
})
it('R15 transfer also requires permission for the latest cross-group input audience',()=>{
 const f=fixture(),a=f.context(),b=f.context('g2');f.scopes.own('task',a,'codex')
 const packet=f.memory.build(a,{request:'work'},'backend');packet.manifest.taskOwners=[{id:'task',epoch:1,dataRevision:1}];f.store.put('task-context','task',{manifest:packet.manifest})
 f.scopes.command({action:'task.channel',operationId:'grant',expectedRevision:0,ticketId:'task',entryId:b.route.entryId,context:true,request:true,result:true})
 f.scopes.noteInput('task',b);f.memory.moveTaskContext('task',b)
 const {routerId,revision,epoch,...target}=f.scopes.scope('p2');f.scopes.command({action:'scope.put',operationId:'only-origin',expectedRevision:revision,scope:{...target,dataEntryIds:[a.route.entryId]}})
 expect(()=>f.scopes.command({action:'task.transfer',operationId:'unsafe-transfer',expectedRevision:1,ticketId:'task',scopeId:'p2'})).toThrow('current task audience')
 expect(f.scopes.ownership('task')!.scopeId).toBe('p1')
})
it('F02 current publication provenance is separate from historical no-share wording',()=>{
 const f=fixture(),fact=f.remember('Marker NORTH-7319; do not share yet'),b=f.context('g2')
 expect(f.memory.query(b,{}).items).toHaveLength(0)
 f.memory.command(f.context(),{action:'share',operationId:'publish-now',expectedRevision:1,id:fact.id,targetEntry:b.route.entryId},true)
 const projected=f.memory.query(b,{}).items[0]!
 expect(projected.content).toBe(fact.content)
 expect(projected.access).toMatchObject({mode:'published_revision',revision:1,sourceEntry:fact.entryId,audienceEntry:b.route.entryId})
 expect(JSON.parse(f.memory.build(b,{request:'recall'},'backend').input).memory.facts[0].access.mode).toBe('published_revision')
 f.memory.command(f.context(),{action:'unshare',operationId:'revoke',expectedRevision:1,id:fact.id,targetEntry:b.route.entryId},true)
 expect(f.memory.query(f.context('g2'),{}).items).toEqual([])
})
it.each([true,false])('C11 held reply is reviewed by the current Router before release (approved=%s)',async approved=>{
 const f=fixture(),{routerId,revision,epoch,...target}=f.scopes.scope('p2');f.scopes.command({action:'scope.put',operationId:'target-worker',expectedRevision:revision,scope:{...target,workerIds:['one','two']}})
 f.store.close();stores.splice(stores.indexOf(f.store),1)
 let calls=0
 const h=new Runtime(f.config,{model:{async run(r){calls++;expect(JSON.parse(r.input).kind).toBe('review_held_reply');expect(r.tools).toEqual([]);return {threadId:'new-owner-review',turnId:'review',text:JSON.stringify({approved,reply:'Reviewed 2'})}}}});hosts.push(h)
 h.receive('local','alice',{id:'review-input',thread:'review-topic',scope:'g1',text:'Compute 1+1',addressed:true})
 const trigger=h.store.list<any>('trigger').find(t=>t.text==='Compute 1+1')!,c=h.scopes.context(trigger,'local:review-topic')!
 h.scopes.own('review-task',c,'codex')
 h.store.put('ticket','review-task',{id:'review-task',title:'Compute 1+1',ended:{by:'worker'},assignments:[{report:{reply:'2'}}]})
 const packet=h.memory.build(c,{request:'Compute 1+1'},'backend');packet.manifest.taskOwners=[{id:'review-task',epoch:1,dataRevision:1}]
 h.store.put('task-context','review-task',{manifest:packet.manifest})
 h.store.outbox.send({id:'held-reply',kind:'reply',text:'2',channel:trigger.channel})
 h.store.put('router-reply-owner','held-reply',{triggerId:trigger.id,discussion:'local:review-topic',inputs:[trigger.id],taskIds:['review-task'],manifest:packet.manifest})
 h.scopes.command({action:'task.transfer',operationId:'move-review',expectedRevision:1,ticketId:'review-task',scopeId:'p2'})
 const command={action:'reply.resolve',decision:'continue',operationId:'review-it',expectedRevision:1,messageId:'held-reply'}
 const result=await h.scopeCommand(command)
 expect(result).toMatchObject({id:'held-reply',status:approved?'pending':'held'})
 expect(await h.scopeCommand(command)).toEqual(result);expect(calls).toBe(1)
 expect(h.store.deliveries()).toHaveLength(1);expect(h.store.deliveries()[0]!.text).toBe(approved?'Reviewed 2':'2')
})
it('R14/F23 resource reads do not inherit unknown group history or cross-group source access',async()=>{
 const f=fixture(),a=f.context(),b=f.context('g2');f.scopes.own('task',a,'codex')
 const packet=f.memory.build(a,{request:'work'},'backend');packet.manifest.taskOwners=[{id:'task',epoch:1,dataRevision:1}];f.store.put('task-context','task',{manifest:packet.manifest})
 f.store.put('ticket','task',{id:'task',origin:{triggerIds:[a.trigger.id]},inputs:[],mandate:{actor:{source:'local'}}})
 f.store.close();stores.splice(stores.indexOf(f.store),1)
 const h=new Runtime(f.config,{model:{async run(){throw Error('No model calls expected')}}});hosts.push(h)
 let calls=0;h.sources.get('local')!.read=async()=>{calls++;return 'source-private-body'}
 await expect(h.resources.read({resource:'trigger-source/'+a.trigger.id+'/around'},{ticketId:'task'})).rejects.toThrow('history visibility')
 expect(calls).toBe(0)
 const read=await h.resources.read({resource:'trigger-source/'+a.trigger.id+'/message',limit:3},{ticketId:'task'})
 expect(read.text).toBe('sou');expect(calls).toBe(1)
 h.scopes.command({action:'task.channel',operationId:'grant-resources',expectedRevision:0,ticketId:'task',entryId:b.route.entryId,context:true,request:true,result:true})
 h.scopes.noteInput('task',b);h.memory.moveTaskContext('task',b)
 await expect(h.resources.read({resource:'trigger-source/'+a.trigger.id+'/message'},{ticketId:'task'})).rejects.toThrow('another entry')
 await expect(h.resources.read({resource:'trigger-source/'+a.trigger.id+'/message',cursor:read.cursor},{ticketId:'task'})).rejects.toThrow('cursor')
 expect(calls).toBe(1)
})
it('F03 operator HTTP cannot read private memory by replaying a member trigger',async()=>{
 const f=fixture();f.remember('PRIVATE BODY','private',{visibility:'private'});f.store.close();stores.splice(stores.indexOf(f.store),1)
 const h=new Runtime({...f.config,port:0},{model:{async run(){throw Error('No model calls')}}});hosts.push(h)
 const receipt=h.receive('local','alice',{id:'private-http',thread:'private-topic',scope:'private',text:'remember privately',addressed:true}) as any
 const {serve}=await import('../src/server.ts'),server=await serve(h),headers={authorization:'Bearer '+readFileSync(server.tokenPath,'utf8').trim(),'content-type':'application/json'}
 try{
  const response=await fetch(server.url+'/router-memory',{method:'POST',headers,body:JSON.stringify({triggerId:receipt.triggerId,query:{}})}),body=await response.text()
  expect(response.ok).toBe(false);expect(body).not.toContain('PRIVATE BODY');expect(body).toContain('cannot impersonate')
  const catalog=await (await fetch(server.url+'/router-management/catalog',{headers})).json() as any
  expect(catalog.contexts.some((c:any)=>c.id===receipt.triggerId)).toBe(false)
 }finally{await new Promise<void>(resolve=>server.server.close(()=>resolve()))}
})

it('F14 lifecycle edits revoke old evidence and admission, reject stale resurrection and survive a restored snapshot',()=>{
 const f=fixture(),c=f.context('g1','alice','old body'),t={...c.trigger,meta:{...c.trigger.meta,messageId:'om_edit'}};f.store.triggers.save(t)
 const evidence=f.memory.ingest({...c,trigger:t}),fact=f.memory.command(c,{action:'remember',operationId:'old',expectedRevision:0,subject:'edited',content:'old body',sourceIds:[evidence.id],candidate:false},true) as MemoryFact
 const event={id:'edit',kind:'message.updated',scope:'g1',messageId:'om_edit',contentHash:'a'.repeat(64),at:100}
 expect(f.memory.sourceChanged('local',event)).toMatchObject({status:'applied'})
 expect(()=>f.scopes.assertTrigger(t)).toThrow('changed');expect(f.memory.fact(fact.id)?.state).toBe('revoked')
 expect(f.memory.sourceChanged('local',event)).toMatchObject({status:'applied'})
 expect(()=>f.memory.sourceChanged('local',{...event,contentHash:'b'.repeat(64)})).toThrow('different content')
 f.memory.sourceChanged('local',{...event,id:'recall',kind:'message.deleted',at:200})
 expect(f.memory.sourceChanged('local',{...event,id:'stale',at:300})).toMatchObject({status:'stale'})
 f.store.db.prepare("DELETE FROM records WHERE kind IN ('source-invalid-trigger','memory-revocation-head','source-message-state','source-change-receipt')").run()
 new RouterMemory(f.store,f.scopes,f.config.stateDir)
 expect(()=>f.scopes.assertTrigger(t)).toThrow('changed')
})
it('R14 member exit revokes authority without falsifying facts, and new membership fences prior audience history',()=>{
 const f=fixture(),fact=f.remember('retained group fact'),old=f.context('g1','bob'),entry=f.scopes.entry(old.trigger)!
 f.memory.sourceChanged('local',{id:'leave',kind:'member.removed',scope:'g1',actorIds:['bob'],at:100})
 expect(()=>f.scopes.assertTrigger(old.trigger)).toThrow();expect(()=>f.scopes.assertTrigger(f.context('g1','bob').trigger)).toThrow()
 expect(f.memory.query(f.context(),{id:fact.id}).items).toHaveLength(1)
 f.memory.sourceChanged('local',{id:'join',kind:'member.added',scope:'g1',actorIds:['bob'],at:200})
 expect(f.scopes.binding(entry.id).history).toBe('unknown')
 expect(f.memory.query(f.context(),{id:fact.id}).items).toHaveLength(0)
 const fresh=f.remember('new audience fact');expect(f.memory.query(f.context(),{id:fresh.id}).items).toHaveLength(1)
})
it('F06 derived memories retain dependency publication and revision boundaries',()=>{
 const f=fixture(),parent=f.remember(),c=f.context(),target=f.scopes.entry(f.context('g2').trigger)!
 const derived=f.memory.command(c,{action:'remember',operationId:'derive',expectedRevision:0,subject:'summary',content:'Budget summary',sourceIds:[],derivedFrom:[parent.id],candidate:false},true) as MemoryFact
 expect(()=>f.memory.command(c,{action:'share',operationId:'forbidden',expectedRevision:1,id:derived.id,targetEntry:target.id})).toThrow('dependency')
 f.memory.command(c,{action:'share',operationId:'parent-share',expectedRevision:1,id:parent.id,targetEntry:target.id})
 f.memory.command(c,{action:'share',operationId:'derived-share',expectedRevision:1,id:derived.id,targetEntry:target.id})
 expect(f.memory.query(f.context('g2'),{id:derived.id}).items).toHaveLength(1)
 f.memory.command(c,{action:'unshare',operationId:'parent-unshare',expectedRevision:1,id:parent.id,targetEntry:target.id})
 expect(f.memory.query(f.context('g2'),{id:derived.id}).items).toHaveLength(0)
 const current=f.context();f.memory.command(current,{action:'forget',operationId:'forget-parent',expectedRevision:1,id:parent.id})
 expect(f.memory.query(f.context(),{id:derived.id}).items).toHaveLength(0)
})
it('F16 forgotten evidence blocks paraphrase and exact reimport until explicit suppression removal',()=>{
 const f=fixture(),c=f.context('g1','alice','Evidence 7319'),e=f.memory.ingest(c)
 const fact=f.memory.command(c,{action:'remember',operationId:'remember-first',expectedRevision:0,subject:'first subject',content:'remembered detail',sourceIds:[e.id],candidate:false},true) as MemoryFact
 f.memory.command(c,{action:'forget',operationId:'forget',expectedRevision:1,id:fact.id})
 const now=f.context('g1','alice','Evidence 7319'),fresh=f.memory.ingest(now)
 expect(()=>f.memory.command(now,{action:'remember',operationId:'paraphrase',expectedRevision:0,subject:'changed subject',content:'different words',sourceIds:[e.id],candidate:false},true)).toThrow('forgotten')
 expect(()=>f.memory.command(now,{action:'remember',operationId:'reimport',expectedRevision:0,subject:'new subject',content:'another wording',sourceIds:[fresh.id],candidate:false},true)).toThrow('forgotten')
 const suppression=f.store.list<any>('memory-suppression')[0]!
 f.memory.command(now,{action:'suppression.remove',operationId:'unsuppress',expectedRevision:1,id:suppression.id},true)
 expect(f.memory.command(now,{action:'remember',operationId:'authorized-reimport',expectedRevision:0,subject:'new subject',content:'another wording',sourceIds:[fresh.id],candidate:false},true)).toMatchObject({state:'active'})
})
it('C08 retrieval failures retain authorized fallback and report partial status in the model packet',()=>{
 const f=fixture(),publicFact=f.remember('Budget 7319'),privateFact=f.remember('Budget 9111','g2')
 f.store.db.exec('DROP TABLE memory_search')
 const result=f.memory.query(f.context(),{query:'Budget'})
 expect(result.status).toBe('partial');expect(result.items.map(f=>f.id)).toEqual([publicFact.id]);expect(JSON.stringify(result)).not.toContain(privateFact.content)
 const packet=f.memory.build(f.context('g1','alice','Budget'),{request:'Budget'},'test')
 expect(JSON.parse(packet.input).memory.status).toBe('partial')
})
it('L09 admission resources cannot read operator catalogs, unrelated sources or stale source text',async()=>{
 const f=fixture();f.store.close();stores.splice(stores.indexOf(f.store),1)
 const h=new Runtime(f.config,{model:{run:async()=>{throw Error('unused')}}});hosts.push(h)
 const t=h.sources.get('local')!.trigger({id:'admission',thread:'g1',scope:'g1',text:'current',addressed:true},'alice');h.store.triggers.save(t)
 expect(await h.resources.read({resource:'trigger/'+t.id},{triggerId:t.id})).toMatchObject({resource:'trigger/'+t.id})
 await expect(h.resources.read({resource:'tickets'},{triggerId:t.id})).rejects.toThrow('only read')
 await expect(h.resources.read({resource:'trigger/unrelated'},{triggerId:t.id})).rejects.toThrow('only read')
 h.sourceChanged('local',{id:'leave',kind:'member.removed',scope:'g1',actorIds:['alice'],at:1})
 await expect(h.resources.read({resource:'trigger/'+t.id},{triggerId:t.id})).rejects.toThrow()
})
it('C03 rebuild keeps task and effects, requires fresh authority and quarantines all old model bodies',async()=>{
 const f=fixture();f.store.close();stores.splice(stores.indexOf(f.store),1)
 const calls:ModelRequest[]=[],model:Model={async run(r){calls.push(r);const threadId='native-'+calls.length;r.onThread?.(threadId);return {threadId,turnId:'turn-'+calls.length,text:JSON.stringify(r.role==='worker'?{state:'ready',summary:'finished',reply:'4',question:null,askedBy:null,handbacks:[]}:{reply:'Router summary'})}}}
 const h=new Runtime(f.config,{model});hosts.push(h)
 const admit=(id:string,text:string)=>{h.receive('local','alice',{id,thread:'g1-'+id,scope:'g1',text,addressed:true});const trigger=h.store.triggers.get('local:'+id)!,scoped=h.scopes.context(trigger,'local:g1-'+id)!;return {trigger,scoped,discussion:scoped.route.discussion,manifest:h.memory.build(scoped,{request:text},'test').manifest}}
 const first=admit('original','OLD-PRIVATE-7319'),a=await h.manager.call({action:'assign',id:'one',text:'OLD-PRIVATE-7319',requestId:'assign',revision:0},first)
 for(let i=0;i<100&&!h.store.tickets.get(a.ticketId)?.ended;i++){await h.tick();await new Promise(r=>setTimeout(r,2))}
 const oldRun=h.store.get<any>('run',a.ticketId);expect(oldRun.threadId).toBeTruthy()
 h.store.put('tool-receipt','effect-one',{id:'effect-one',ticketId:a.ticketId,connection:'test',tool:'write',state:'complete',fingerprint:'original',result:{text:'OLD-PRIVATE-7319'}})
 h.sourceChanged('local',{id:'changed',kind:'entry.permissions_changed',scope:'g1',at:Date.now()})
 expect(h.scopes.ownership(a.ticketId)).toMatchObject({state:'held',reason:'context_permissions_changed'})
 const fresh=admit('fresh','Recheck 2+2 with current public inputs')
 await expect(h.manager.call({action:'inspect',ticketId:a.ticketId},fresh)).rejects.toThrow()
 await expect(h.manager.call({action:'rebuild',ticketId:a.ticketId,text:'Calculate 2+2',requestId:'rebuild-no-review',revision:0},fresh)).rejects.toThrow('reviewed workspace')
 const rebuilt=await h.manager.call({action:'rebuild',ticketId:a.ticketId,text:'Calculate 2+2',workspaceReviewed:true,requestId:'rebuild',revision:0},fresh)
 expect(rebuilt.status).toBe('awaiting_followup');expect(h.store.get<any>('run',a.ticketId).threadId).toBeUndefined()
 const workerReads=JSON.stringify(await h.resources.read({resource:'ticket/'+a.ticketId},{ticketId:a.ticketId}))
 expect(workerReads).not.toContain('OLD-PRIVATE-7319')
 await expect(h.resources.read({resource:'tool-call/effect-one'},{ticketId:a.ticketId})).rejects.toThrow('quarantined')
 await h.manager.call({action:'send',ticketId:a.ticketId,text:'Recheck 2+2 now',requestId:'continue',revision:0},fresh)
 const before=calls.length
 for(let i=0;i<100;i++){await h.tick();await new Promise(r=>setTimeout(r,2));if(h.store.tickets.get(a.ticketId)?.ended&&calls.length>before)break}
 const worker=calls.slice(before).find(r=>r.role==='worker')!;expect(worker).toBeTruthy();expect(worker.threadId).toBeUndefined()
 expect(worker.input+worker.instructions).not.toContain('OLD-PRIVATE-7319');expect(worker.input).toContain('effect-one')
 expect(h.store.get<any>('run',a.ticketId).cwd).toBe(oldRun.cwd);expect(h.store.tickets.list()).toHaveLength(1)
 expect(h.store.get<any>('tool-receipt','effect-one').state).toBe('complete')
})

it('R11 links only two native account proofs and never rewrites source authority',async()=>{
 const f=fixture(),{SourceIdentities}=await import('../src/source-identity.ts'),source=Object.assign(f.source,{identity:async()=>({id:'account',type:'bot',verified:true})}),identities=new SourceIdentities(f.store,f.scopes,new Map([['local',source]]))
 await identities.command({action:'source.verify',sourceId:'local',operationId:'verify',expectedRevision:0})
 const a=f.scopes.entry(f.context().trigger)!,b=f.scopes.entry(f.context('g2','bob').trigger)!
 const challenge=await identities.command({action:'identity.challenge',operationId:'challenge',expectedRevision:0,actors:[{sourceId:'local',actorId:'alice',entryId:a.id},{sourceId:'local',actorId:'bob',entryId:b.id}]})
 const c1=f.context('g1','alice',challenge.command),c2=f.context('g2','bob',challenge.command),link={action:'identity.link',operationId:'link',expectedRevision:1,challengeId:challenge.id,triggerIds:[c1.trigger.id,c2.trigger.id]}
 await expect(identities.command(link)).rejects.toThrow('native entry')
 identities.recordNative(c1.trigger);identities.recordNative(c2.trigger)
 const result=await identities.command(link);expect(result).toMatchObject({active:true,authority:'unchanged'})
 expect(f.scopes.scope('p1').managers).toEqual([JSON.stringify(['local','alice'])])
 expect(await identities.command({action:'identity.unlink',operationId:'unlink',expectedRevision:1,id:result.id})).toMatchObject({active:false,revision:2})
})

it('C02 in-flight Router output loses its publication capability when a fact is forgotten',async()=>{
 const f=fixture();f.remember('in-flight private fact');f.store.close();stores.splice(stores.indexOf(f.store),1)
 let release!:(r:any)=>void,started=false
 const h=new Runtime(f.config,{model:{run:async()=>{started=true;return new Promise(resolve=>{release=resolve})}}});hosts.push(h)
 h.receive('local','alice',{id:'inflight',thread:'g1-flight',scope:'g1',text:'Use current memory',addressed:true})
 for(let i=0;i<100&&!started;i++){await h.tick();await new Promise(r=>setTimeout(r,1))}
 expect(started).toBe(true)
 const t=h.store.triggers.get('local:inflight')!,c=h.scopes.context(t,'local:g1-flight')!,fact=h.store.list<MemoryFact>('memory-fact')[0]!
 h.memory.command(c,{action:'forget',operationId:'inflight-forget',expectedRevision:fact.revision,id:fact.id})
 release({threadId:'inflight',turnId:'late',text:'{"reply":"LEAK-FROM-OLD-CONTEXT"}'})
 for(let i=0;i<30;i++){await h.tick();await new Promise(r=>setTimeout(r,1))}
 expect(h.store.deliveries().some(d=>d.text.includes('LEAK-FROM-OLD-CONTEXT'))).toBe(false)
 expect(h.store.list('router-error').length).toBeGreaterThan(0)
})
it('R07/R10 ambiguity and ordinary-member management cannot change owner or stop another requester work',async()=>{
 const f=fixture();f.store.close();stores.splice(stores.indexOf(f.store),1);const h=new Runtime(f.config,{model:{run:async()=>{throw Error('unused')}}});hosts.push(h)
 const ctx=(id:string,actor:string,text:string)=>{h.receive('local',actor,{id,thread:id,scope:'g1',text,addressed:true});const trigger=h.store.triggers.get('local:'+id)!,scoped=h.scopes.context(trigger,'local:'+id)!;return {trigger,scoped,discussion:scoped.route.discussion,manifest:h.memory.build(scoped,{request:text},'test').manifest}}
 const alice=ctx('alice','alice','Work'),a=await h.manager.call({action:'assign',id:'one',text:'first',requestId:'a',revision:0},alice),b=await h.manager.call({action:'assign',id:'one',text:'second',requestId:'b',revision:0},alice)
 const raw=h.sources.get('local')!.trigger({id:'ambiguous',thread:'ambiguous',scope:'g1',text:a.ticketId+' '+b.ticketId,addressed:true},'alice');h.store.triggers.save(raw)
 expect(()=>h.scopes.context(raw,'local:ambiguous')).toThrow('Multiple task references')
 expect(h.routerIngress.admit(raw)).toMatchObject({state:'unavailable',clarification:{question:expect.any(String)}})
 expect(h.store.tickets.get(a.ticketId)?.inputs.some(i=>i.kind==='trigger'&&i.triggerId===raw.id)).toBe(false)
 const bob=ctx('bob','bob','Please change settings')
 for(const command of [{action:'configure',id:'one',patch:{effort:'high'}},{action:'cancel',ticketId:a.ticketId},{action:'set_prompt',id:'one',prompt:'new'}])await expect(h.manager.call({...command,requestId:command.action,revision:0},bob)).rejects.toThrow('manager')
 expect(h.store.tickets.get(a.ticketId)?.ended).toBeUndefined();expect(h.settings.current().revision).toBe(0)
})
it('F11/F19 preserves same-keyword subjects and exposes an unavailable original as a versioned snapshot',()=>{
 const f=fixture(),one=f.remember('Project X budget 31','g1',{subject:'Project X'}),two=f.remember('Project Y budget 47','g1',{subject:'Project Y'})
 expect(f.memory.query(f.context(),{query:'budget'}).items.map(x=>x.id).sort()).toEqual([one.id,two.id].sort())
 const e=f.memory.evidence(one.sources[0]!.id)!,t=f.store.triggers.get(e.locator.slice(8))!;f.store.triggers.save({...t,meta:{...t.meta,messageId:'om_snapshot'}})
 f.config.sources[0]!.kind='webhook'
 f.store.put('source-freshness','local:om_snapshot',{status:'unavailable',checkedAt:Date.now()})
 const projected=f.memory.query(f.context(),{id:one.id}).items[0]!
 expect(projected.content).toBe(one.content);expect(projected.freshness).toMatchObject({status:'unavailable',sourceVersions:one.sources})
})

it('R02 keeps identical external IDs in different connection accounts and tenants distinct',()=>{
 const f=fixture(),fact=f.remember('Account one budget'),sourceConfig={...f.config.sources[0]!,id:'second',label:'Same display name'};f.config.sources.push(sourceConfig)
 const scope=f.scopes.scope('p3'),{routerId,revision,epoch,...input}=scope
 f.scopes.command({action:'scope.put',operationId:'second-source',expectedRevision:revision,scope:{...input,sourceIds:['second']}})
 const entry:any=f.scopes.command({action:'entry.bind',operationId:'second-account',expectedRevision:0,scopeId:'p3',sourceId:'second',accountNamespace:'another-account',nativeId:'g1'})
 const source=new MessageSource(sourceConfig),t=source.trigger({id:'e1',thread:'g1-topic',scope:'g1',text:'Budget 73',addressed:true},'alice');f.store.triggers.save(t)
 const c=f.scopes.context(t,'second:g1-topic')!
 expect(c.route.entryId).toBe(entry.id);expect(c.route.entryId).not.toBe(f.scopes.bindings().find(b=>b.sourceId==='local'&&b.nativeId==='g1')!.id)
 const result=f.memory.query(c,{query:'budget'});expect(JSON.stringify(result)).not.toContain(fact.id);expect(result.items).toHaveLength(0)
 expect(f.scopes.actor(t)).not.toBe(f.scopes.actor(f.context().trigger))
})
it('R04 display renames and repeated source events do not replace entry ownership or duplicate tasks',async()=>{
 const f=fixture();f.store.close();stores.splice(stores.indexOf(f.store),1);const h=new Runtime(f.config,{model:{run:async()=>{throw Error('unused')}}});hosts.push(h)
 const input={id:'repeatable',thread:'g1-topic',scope:'g1',text:'same request',addressed:true},receipt:any=h.receive('local','alice',input),trigger=h.store.triggers.get(receipt.triggerId)!,scoped=h.scopes.context(trigger,'local:g1-topic')!,context={trigger,scoped,discussion:scoped.route.discussion,manifest:h.memory.build(scoped,{request:input.text},'test').manifest}
 const command={action:'assign',id:'one',text:'one task',requestId:'one-delegation',revision:0},task=await h.manager.call(command,context),entry=h.scopes.entry(trigger)!.id
 h.updateSettings(0,{sources:h.config.sources.map(s=>({...s,label:'Renamed display label'}))})
 expect(h.receive('local','alice',input)).toMatchObject({disposition:'duplicate',triggerId:trigger.id})
 expect(await h.manager.call(command,context)).toEqual(task)
 expect(h.scopes.entry(trigger)!.id).toBe(entry);expect(h.store.tickets.list()).toHaveLength(1)
})

it('C10 concurrent Router snapshots cannot overwrite a newer fact or task data revision',async()=>{
 const f=fixture(),fact=f.remember(),a=f.context('g1','alice','session one'),b=f.context('g1','alice','session two'),ea=f.memory.ingest(a),eb=f.memory.ingest(b)
 const first=f.memory.build(a,{request:'one'},'backend').manifest,second=f.memory.build(b,{request:'two'},'backend').manifest
 const results=await Promise.allSettled([Promise.resolve().then(()=>f.memory.command(a,{action:'remember',operationId:'race-one',id:fact.id,expectedRevision:1,subject:fact.subject,content:'version A',sourceIds:[ea.id],candidate:false},true)),Promise.resolve().then(()=>f.memory.command(b,{action:'remember',operationId:'race-two',id:fact.id,expectedRevision:1,subject:fact.subject,content:'version B',sourceIds:[eb.id],candidate:false},true))])
 expect(results.map(r=>r.status).sort()).toEqual(['fulfilled','rejected']);expect(f.memory.fact(fact.id)?.revision).toBe(2)
 expect(()=>f.memory.validate(first)).toThrow('expired');expect(()=>f.memory.validate(second)).toThrow('expired')
})

it('retains source dependencies while a held reply is reviewed',async()=>{
 const f=fixture();f.store.close();stores.splice(stores.indexOf(f.store),1)
 const h=new Runtime(f.config,{model:{async run(){return {threadId:'review',turnId:'review',text:JSON.stringify({approved:true,reply:'Reviewed source'})}}}});hosts.push(h)
 const receipt=h.receive('local','alice',{id:'review-dependencies',thread:'review-topic',scope:'g1',text:'Review this source',addressed:true}) as any
 const trigger=h.store.triggers.get(receipt.triggerId)!,c=h.scopes.context(trigger,'local:review-topic')!
 const doc=h.knowledge.command({action:'put',operationId:'source-doc',expectedRevision:0,title:'Source',content:'Source material'},c)
 h.scopes.own('review-task',c,'codex');h.store.put('ticket','review-task',{id:'review-task',title:'Review',ended:{by:'worker'},assignments:[{report:{reply:'Reviewed source'}}]})
 const packet=h.memory.build(c,{request:'Review'},'backend');packet.manifest.taskOwners=[{id:'review-task',epoch:1,dataRevision:1}];packet.manifest.knowledge=[{documentId:doc.id,revision:doc.revision}]
 h.memory.bindInputs(c,packet.manifest,[trigger.id]);h.store.put('task-context','review-task',{manifest:packet.manifest})
 h.store.outbox.send({id:'held-dependency-reply',kind:'reply',text:'Source material',channel:trigger.channel!})
 h.store.db.prepare("UPDATE outbox SET status='held' WHERE id=?").run('held-dependency-reply')
 h.store.put('reply-hold','held-dependency-reply',{ticketId:'review-task',revision:1})
 h.store.put('router-reply-owner','held-dependency-reply',{triggerId:trigger.id,discussion:'local:review-topic',inputs:[trigger.id],taskIds:['review-task'],manifest:packet.manifest})
 await h.scopeCommand({action:'reply.resolve',decision:'continue',operationId:'review-source',expectedRevision:1,messageId:'held-dependency-reply'})
 const saved=h.store.get<any>('router-reply-owner','held-dependency-reply').manifest
 expect(saved.knowledge).toContainEqual({documentId:doc.id,revision:1});expect(saved.inputEvidence).toEqual(packet.manifest.inputEvidence)
 h.knowledge.command({action:'delete',operationId:'remove-source',expectedRevision:1,id:doc.id},c)
 await h.flush();expect(h.store.deliveries().find(d=>d.id==='held-dependency-reply')?.status).toBe('dropped')
})

it('stops legacy ambiguous history cleanup before modifying unrelated records',()=>{
 const f=fixture(),c=f.context(),e=f.memory.ingest(c),id='existing-task'
 f.store.put('ticket',id,{id,title:'Existing task'})
 f.store.put('knowledge-document',id,{id,kind:'document',tenantId:c.route.tenantId,scopeId:c.route.scopeId,entryId:c.route.entryId,owner:c.actor,triggerId:c.trigger.id,title:'Earlier document',content:'Original document',revision:1,deleted:false,citations:[],links:[],at:Date.now()})
 expect(()=>f.memory.command(c,{action:'source.delete',operationId:'cleanup-ambiguous',expectedRevision:e.version,id:e.id},true)).toThrow('ambiguous document ID')
 expect(f.store.get<any>('ticket',id).title).toBe('Existing task')
 expect(f.memory.evidence(e.id)?.revoked).toBe(false)
 expect(f.memory.cleanup.plans()).toHaveLength(0)
})
