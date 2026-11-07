import {afterEach,it,expect} from 'vitest'
import {mkdtempSync,rmSync,readFileSync,writeFileSync,existsSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {DatabaseSync} from 'node:sqlite'
import {configSchema} from '../src/config.ts'
import {Store} from '../src/store.ts'
import {previewScopeMigration,applyScopeMigration as applyMigration,rollbackScopeMigration} from '../src/scope-migration.ts'
import {backupState,restoreState} from '../src/backup.ts'
const applyScopeMigration=(config:Parameters<typeof applyMigration>[0],spec:unknown,expected:string,options:Parameters<typeof applyMigration>[3]={})=>applyMigration(config,spec,expected,{...options,historyReader:async ref=>({id:ref.threadId,turns:[],cwd:ref.cwd})})
const roots:string[]=[]
afterEach(()=>{for(const p of roots.splice(0))rmSync(p,{recursive:true,force:true})})
function fixture(){
 const root=mkdtempSync(join(tmpdir(),'scope-migration-'));roots.push(root)
 const config=configSchema.parse({stateDir:join(root,'state'),sources:[{id:'local',kind:'local',allowedActors:['alice'],cwd:root}]})
 const store=new Store(join(config.stateDir,'state.sqlite'))
 const trigger={id:'input',source:'local',threads:[{source:'local',id:'topic'}],actor:{id:'alice',source:'local'},human:true,text:'bounded request',at:new Date().toISOString(),meta:{scope:'group'},channel:{source:'local',thread:'topic',address:{}}}
 const mandate={strength:'explicit',actor:trigger.actor,scope:'bounded request',policyVersion:'v1',basis:{via:'addressed'}}
 store.put('trigger','input',trigger);store.put('trigger','delegation',{...trigger,id:'delegation'})
 store.put('router-admission','input',{triggerId:'input',discussion:'local:topic',state:'accepted',mandate})
 for(const [id,state] of [['queued',undefined],['done',{by:'worker'}],['stopped',{by:'human'}]] as const){
  store.put('ticket',id,{id,origin:{triggerId:'delegation'},mandate,assignments:[{id:'assignment-'+id,state:'ended'}],inputs:[],undelivered:[],ended:state})
  store.put('worker-assignment',id,{ticketId:id,workerId:'one',source:'local',actor:'alice',parentTrigger:'input',discussion:'local:topic',mode:'host'})
  store.put('run',id,{ticketId:id,assignmentId:'assignment-'+id,phase:'idle',cwd:root,threadId:'native-'+id,backendId:'codex',model:'sol',agentOptions:{effort:'high'}})
 }
 store.enqueue('execute:queued','execute',{ticketId:'queued',assignmentId:'assignment-queued'})
 store.outbox.send({id:'sent',ticketId:'done',kind:'reply',text:'already delivered',channel:trigger.channel});store.delivered('sent')
 store.put('source-cursor','local','original-watermark');store.db.exec('PRAGMA user_version=5');store.close()
 const spec={operationId:'migration-one',commands:[{action:'scope.put',operationId:'scope',expectedRevision:0,scope:{id:'team',tenantId:'tenant',name:'Team',managers:[JSON.stringify(['local','alice'])],workerIds:['one'],sourceIds:['local'],backendIds:['codex']}},{action:'entry.bind',operationId:'bind',expectedRevision:0,scopeId:'team',sourceId:'local',accountNamespace:'account',nativeId:'group'}]}
 return {root,config,spec,path:join(config.stateDir,'state.sqlite')}
}
const get=(db:DatabaseSync,kind:string,id:string)=>db.prepare('SELECT body FROM records WHERE kind=? AND id=?').get(kind,id)?.body
it('G01 preview is read-only, exhaustive and conserves classified records',()=>{
 const f=fixture(),before=readFileSync(f.path),p=previewScopeMigration(f.config,f.spec)
 expect(p.counts.mapped).toBe(3);expect(p.items.length).toBe(Object.values(p.counts).reduce((a,b)=>a+b,0));expect(readFileSync(f.path)).toEqual(before)
 expect(new Set(p.items.map(i=>i.kind+':'+i.id)).size).toBe(p.items.length)
})
it('G02/G04/G07 migration preserves immutable work and delivery receipts while pausing activation',async()=>{
 const f=fixture(),p=previewScopeMigration(f.config,f.spec),old=new DatabaseSync(f.path,{readOnly:true}),before=['queued','done','stopped'].map(id=>get(old,'ticket',id));old.close()
 const result=await applyScopeMigration(f.config,f.spec,p.fingerprint);expect(result.phase).toBe('verified_paused')
 const s=new Store(f.path)
 try{
  for(const [i,id] of ['queued','done','stopped'].entries()){expect(JSON.stringify(s.get('ticket',id))).toBe(before[i]);expect(s.get<any>('run',id).threadId).toBe('native-'+id)}
  expect(new Set(s.list<any>('task-ownership').map(x=>x.routerId)).size).toBe(1)
  expect(s.deliveries()[0]).toMatchObject({id:'sent',status:'sent',text:'already delivered'})
  expect(s.get('settings','paused')).toBe(true);expect(s.get('source-cursor','local')).toBe('original-watermark')
 }finally{s.close()}
 expect(await applyScopeMigration(f.config,f.spec,p.fingerprint)).toEqual(result)
})
it('G03 unknown kinds block application without deleting data',async()=>{
 const f=fixture(),db=new DatabaseSync(f.path);db.prepare('INSERT INTO records VALUES(?,?,?)').run('third-party-format','x','{}');db.close()
 const p=previewScopeMigration(f.config,f.spec);expect(p.counts.conflict).toBe(1)
 await expect(applyScopeMigration(f.config,f.spec,p.fingerprint)).rejects.toThrow('conflicting')
 expect(existsSync(join(f.config.stateDir,'host.lock'))).toBe(false)
})
it.each(['running','background','human','uncertain'] as const)('G05/G06 drain requirement preserves a %s native task',async phase=>{
 const f=fixture(),db=new DatabaseSync(f.path),run=JSON.parse(String(get(db,'run','queued')));db.prepare("UPDATE records SET body=? WHERE kind='run' AND id='queued'").run(JSON.stringify({...run,phase}));db.close()
 const p=previewScopeMigration(f.config,f.spec);expect(p.items.find(i=>i.kind==='ticket'&&i.id==='queued')?.status).toBe('held')
 await expect(applyScopeMigration(f.config,f.spec,p.fingerprint)).rejects.toThrow('Drain')
})
it.each(['sending','uncertain'] as const)('G07 rejects %s delivery until reconciled',async state=>{
 const f=fixture(),db=new DatabaseSync(f.path);db.prepare('UPDATE outbox SET status=?').run(state);db.close();const p=previewScopeMigration(f.config,f.spec)
 await expect(applyScopeMigration(f.config,f.spec,p.fingerprint)).rejects.toThrow('reconcile')
})
it('G08 rejects a stale preview after a new input',async()=>{
 const f=fixture(),p=previewScopeMigration(f.config,f.spec),db=new DatabaseSync(f.path);db.prepare('INSERT INTO records VALUES(?,?,?)').run('source-cursor','other','"changed"');db.close()
 await expect(applyScopeMigration(f.config,f.spec,p.fingerprint)).rejects.toThrow('expired')
})
it('G10 a live process lease prevents migration',async()=>{
 const f=fixture(),p=previewScopeMigration(f.config,f.spec);writeFileSync(join(f.config.stateDir,'host.lock'),String(process.pid))
 await expect(applyScopeMigration(f.config,f.spec,p.fingerprint)).rejects.toThrow('Stop host')
})
it('G18 normal startup refuses legacy schema without mutating its records',()=>{
 const f=fixture(),before=readFileSync(f.path);expect(()=>new Store(f.path)).toThrow('migration required');expect(readFileSync(f.path)).toEqual(before)
})
it('G21 restore refuses dropping tasks accepted after the backup',async()=>{
 const f=fixture(),p=previewScopeMigration(f.config,f.spec);await applyScopeMigration(f.config,f.spec,p.fingerprint)
 await backupState(f.config,join(f.root,'backup'))
 const s=new Store(f.path);s.put('ticket','new',{id:'new'});s.close()
 await expect(restoreState(f.config,join(f.root,'backup'))).rejects.toThrow('advanced')
 const check=new Store(f.path);try{expect(check.get('ticket','new')).toEqual({id:'new'})}finally{check.close()}
})
it('G15 restore refuses replaying an external effect that happened after backup',async()=>{
 const f=fixture(),p=previewScopeMigration(f.config,f.spec);await applyScopeMigration(f.config,f.spec,p.fingerprint)
 const s=new Store(f.path);s.outbox.send({id:'later',kind:'reply',text:'new',channel:{source:'local',thread:'topic',address:{}}});s.close();await backupState(f.config,join(f.root,'backup'))
 const live=new Store(f.path);live.delivered('later');live.close()
 await expect(restoreState(f.config,join(f.root,'backup'))).rejects.toThrow('effects advanced')
})
it.each(['M2','M3','M4','M5.before','M5.after','M6'])('G10/G11 fault at %s leaves one version and never activates work',async phase=>{
 const f=fixture(),p=previewScopeMigration(f.config,f.spec)
 await expect(applyScopeMigration(f.config,f.spec,p.fingerprint,{onPhase:at=>{if(at===phase)throw Error('injected crash')}})).rejects.toThrow('injected')
 const db=new DatabaseSync(f.path,{readOnly:true})
 try{
  const schema=Number(db.prepare('PRAGMA user_version').get()!.user_version)
  expect(schema).toBe(['M5.after','M6'].includes(phase)?6:5)
  expect(JSON.parse(String(get(db,'run','queued'))).threadId).toBe('native-queued')
  if(schema===6){expect(get(db,'settings','paused')).toBe('true');expect(JSON.parse(String(get(db,'scope-migration','current'))).phase).toBe('verified_paused')}
  expect(db.prepare("SELECT status FROM outbox WHERE id='sent'").get()?.status).toBe('sent')
 }finally{db.close()}
 expect(existsSync(join(f.config.stateDir,'host.lock'))).toBe(false)
})
it('G08 configuration changes invalidate an otherwise unchanged database preview',async()=>{
 const f=fixture(),p=previewScopeMigration(f.config,f.spec)
 f.config.sources[0]!.allowedActors=['someone-else']
 await expect(applyScopeMigration(f.config,f.spec,p.fingerprint)).rejects.toThrow('expired')
})
it.each(['M2','M3','M4','M5.before','M5.after','M6'])('G10/G11 retry after %s preserves task IDs and resumes one migration',async phase=>{
 const f=fixture(),p=previewScopeMigration(f.config,f.spec)
 await expect(applyScopeMigration(f.config,f.spec,p.fingerprint,{onPhase:at=>{if(at===phase)throw Error('crash')}})).rejects.toThrow('crash')
 const result=await applyScopeMigration(f.config,f.spec,p.fingerprint)
 expect(result.phase).toBe('verified_paused')
 const s=new Store(f.path);try{expect(s.list('task-ownership')).toHaveLength(3);expect(s.get<any>('run','done').threadId).toBe('native-done');expect(s.get('settings','paused')).toBe(true)}finally{s.close()}
})
it('G14 offline rollback before activation restores exact old records and requires the matching old program',async()=>{
 const f=fixture(),p=previewScopeMigration(f.config,f.spec),before=new DatabaseSync(f.path,{readOnly:true}),rows=before.prepare('SELECT * FROM records ORDER BY kind,id').all();before.close()
 await applyScopeMigration(f.config,f.spec,p.fingerprint)
 expect(await rollbackScopeMigration(f.config,f.spec.operationId)).toMatchObject({phase:'rolled_back',requiresProgram:'schema-5-compatible'})
 const db=new DatabaseSync(f.path,{readOnly:true});try{expect(db.prepare('PRAGMA user_version').get()!.user_version).toBe(5);expect(db.prepare('SELECT * FROM records ORDER BY kind,id').all()).toEqual(rows)}finally{db.close()}
 expect(await rollbackScopeMigration(f.config,f.spec.operationId)).toMatchObject({phase:'rolled_back'})
})
it('G14/G15 rollback refuses to lose a maintenance-window input or external effect',async()=>{
 const f=fixture(),p=previewScopeMigration(f.config,f.spec);await applyScopeMigration(f.config,f.spec,p.fingerprint)
 const s=new Store(f.path);s.put('trigger','maintenance-input',{text:'new request'});s.close()
 await expect(rollbackScopeMigration(f.config,f.spec.operationId)).rejects.toThrow('State advanced')
 const check=new Store(f.path);try{expect(check.get('trigger','maintenance-input')).toBeTruthy()}finally{check.close()}
})
it('G08 rejects a base config that differs from persisted effective permissions',()=>{
 const f=fixture(),db=new DatabaseSync(f.path),saved=structuredClone(f.config);saved.sources[0]!.allowedActors=['bob']
 db.prepare('INSERT INTO records VALUES(?,?,?)').run('settings','current',JSON.stringify({revision:1,config:saved}));db.close()
 expect(()=>previewScopeMigration(f.config,f.spec)).toThrow('effective configuration')
})
it('G03/G12 an operator can retain unresolved records as held while activating verified work',async()=>{
 const f=fixture(),db=new DatabaseSync(f.path);db.prepare("DELETE FROM records WHERE kind='worker-assignment' AND id='queued'").run();db.close()
 const p=previewScopeMigration(f.config,f.spec);await applyScopeMigration(f.config,f.spec,p.fingerprint)
 const s=new Store(f.path),{RouterScopes}=await import('../src/router-scope.ts'),scopes=new RouterScopes(s,f.config)
 try{
  expect(()=>scopes.command({action:'migration.activate',operationId:'too-early',expectedRevision:1})).toThrow('unresolved')
  scopes.command({action:'migration.hold',operationId:'keep-quarantined',expectedRevision:1,items:[{kind:'ticket',id:'queued'}]})
  scopes.command({action:'migration.activate',operationId:'activate-verified',expectedRevision:2})
  expect(scopes.taskRunnable('queued')).toBe(false);expect(scopes.taskRunnable('done')).toBe(true)
  expect(s.get('ticket','queued')).toBeTruthy();expect(s.get('settings','paused')).toBe(true)
 }finally{s.close()}
})
it('unscoped schema 6 work can enter an explicit ownership migration and roll back before activation',async()=>{
 const f=fixture(),db=new DatabaseSync(f.path);db.exec('PRAGMA user_version=6');db.close()
 const plan=previewScopeMigration(f.config,f.spec);expect(plan.schema).toBe(6)
 await applyScopeMigration(f.config,f.spec,plan.fingerprint)
 expect(await rollbackScopeMigration(f.config,f.spec.operationId)).toMatchObject({phase:'rolled_back',requiresProgram:'schema-6-compatible'})
 const restored=new Store(f.path);try{expect(restored.list('management-scope')).toEqual([]);expect(restored.list('ticket')).toHaveLength(3)}finally{restored.close()}
})

it.each(['starting','running'])('G05 drains orphan %s jobs before migration',async state=>{
 const f=fixture(),db=new DatabaseSync(f.path);db.prepare('INSERT INTO records VALUES(?,?,?)').run('work','orphan',JSON.stringify({id:'orphan',ticketId:'absent',kind:'shell',state}));db.close()
 const plan=previewScopeMigration(f.config,f.spec);expect(plan.items.find(i=>i.kind==='work'&&i.id==='orphan')).toMatchObject({status:'held'})
 await expect(applyScopeMigration(f.config,f.spec,plan.fingerprint)).rejects.toThrow('Drain')
})
it('G09 verifies native export identity and detects a modified history backup',async()=>{
 const f=fixture(),p=previewScopeMigration(f.config,f.spec)
 await expect(applyMigration(f.config,f.spec,p.fingerprint,{historyReader:async()=>({id:'wrong-thread'})})).rejects.toThrow('identity mismatch')
 const result=await applyScopeMigration(f.config,f.spec,p.fingerprint),{verifyBackup}=await import('../src/backup.ts')
 const index=JSON.parse(readFileSync(join(result.backup,'history-index.json'),'utf8'))
 expect(index.items).toHaveLength(3);expect(verifyBackup(result.backup).history.status).toBe('verified')
 writeFileSync(join(result.backup,'history',index.items[0].file),'{}')
 expect(()=>verifyBackup(result.backup)).toThrow('identity mismatch')
})
it('G19 records maintenance watermarks and per-source recovery boundaries',async()=>{
 const f=fixture(),p=previewScopeMigration(f.config,f.spec);await applyScopeMigration(f.config,f.spec,p.fingerprint)
 const store=new Store(f.path);try{const gap=store.get<any>('maintenance-gap',f.spec.operationId);expect(gap.state).toBe('open');expect(gap.cursorFingerprint).toBeTruthy();expect(gap.sources[0].mode).toBe('external_replay_required');expect(store.get('source-cursor','local')).toBe('original-watermark')}finally{store.close()}
})
it('G09 never silently omits unresolved previous threads or substitutes a migrated destination directory',async()=>{
 const {historyReferences}=await import('../src/history-backup.ts'),db=new DatabaseSync(':memory:')
 db.exec('CREATE TABLE records(kind TEXT,id TEXT,body TEXT)')
 const put=(kind:string,id:string,body:unknown)=>db.prepare('INSERT INTO records VALUES(?,?,?)').run(kind,id,JSON.stringify(body))
 try{
  put('run','current',{threadId:'current',cwd:'/current',backendId:'new'})
  put('context-handoff','old',{previousThread:'unresolved'})
  expect(()=>historyReferences(db)).toThrow('lacks a verified working directory')
  put('model-session','resolved',{threadId:'unresolved',cwd:'/original'})
  put('worker-migration','migrated',{cwd:'/destination',backendId:'new',from:{threadId:'migrated',cwd:'/previous',backendId:'old'}})
  expect(historyReferences(db)).toEqual(expect.arrayContaining([{threadId:'unresolved',cwd:'/original',backendId:'codex'},{threadId:'migrated',cwd:'/previous',backendId:'old'}]))
 }finally{db.close()}
})

it('G07 preserves all five delivery outcomes and refuses the uncertain subset as a whole',async()=>{
 const f=fixture(),db=new DatabaseSync(f.path),template=db.prepare('SELECT * FROM outbox LIMIT 1').get()!
 for(const status of ['pending','sending','uncertain','dropped'])db.prepare('INSERT INTO outbox(id,body,status,attempts,next_at,error) VALUES(?,?,?,?,?,?)').run(status,template.body!,status,0,0,null)
 db.close();const before=new DatabaseSync(f.path,{readOnly:true}),rows=before.prepare('SELECT id,status FROM outbox ORDER BY id').all();before.close()
 const p=previewScopeMigration(f.config,f.spec);await expect(applyScopeMigration(f.config,f.spec,p.fingerprint)).rejects.toThrow('reconcile')
 const after=new DatabaseSync(f.path,{readOnly:true});try{expect(after.prepare('SELECT id,status FROM outbox ORDER BY id').all()).toEqual(rows)}finally{after.close()}
})

it('G05 detects a real living background process even when its stored status is terminal',async()=>{
 const {spawn}=await import('node:child_process'),child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'})
 try{
  const f=fixture(),db=new DatabaseSync(f.path);db.prepare('INSERT INTO records VALUES(?,?,?)').run('work','hidden-shell',JSON.stringify({id:'hidden-shell',ticketId:'queued',kind:'shell',state:'cancelled',pid:child.pid}));db.close()
  const p=previewScopeMigration(f.config,f.spec);expect(p.items.find(i=>i.id==='hidden-shell')).toMatchObject({status:'held',reason:'background_work_not_drained'})
  await expect(applyScopeMigration(f.config,f.spec,p.fingerprint)).rejects.toThrow('Drain')
 }finally{child.kill('SIGTERM');await new Promise<void>(resolve=>child.once('close',()=>resolve()))}
})
it('G19 distinguishes replayed message cursors, failed sources and unrecoverable platform event gaps',async()=>{
 const f=fixture(),{recordMaintenanceReplay}=await import('../src/maintenance-replay.ts'),p=previewScopeMigration(f.config,f.spec);await applyScopeMigration(f.config,f.spec,p.fingerprint)
 const s=new Store(f.path),now=Date.now(),source=configSchema.parse({sources:[{id:'feishu',kind:'feishu',cwd:f.root,feishu:{cli:'fixture',chats:['oc_one','oc_two']}}]}).sources[0]!
 try{
  s.put('maintenance-gap','window',{id:'window',startedAt:now-60000,resumedAt:now,cursors:['oc_one','oc_two'].map(id=>({key:'feishu:'+id,value:{since:String(Math.floor(now/1000)-60)}})),sources:[{sourceId:'feishu',mode:'cursor_replay'},{sourceId:'external',mode:'external_replay_required'}]})
  for(const id of ['oc_one','oc_two'])s.put('source-cursor','feishu:'+id,{since:String(Math.floor(now/1000)-2)})
  s.put('thread-health','failed',{source:'feishu',consecutiveFailures:1});recordMaintenanceReplay(s,source)
  expect(s.get<any>('maintenance-gap','window').sources[0].status).toBe('partial')
  s.put('thread-health','failed',{source:'feishu',consecutiveFailures:0});recordMaintenanceReplay(s,source)
  const gap=s.get<any>('maintenance-gap','window');expect(gap.sources[0]).toMatchObject({status:'messages_replayed',unrecoverable:['unretained_platform_events']});expect(gap.sources[1].mode).toBe('external_replay_required');expect(gap.zeroLossVerified).toBe(false)
 }finally{s.close()}
})
