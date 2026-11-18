import {mkdtempSync,rmSync,appendFileSync,writeFileSync,existsSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterEach,it,expect} from 'vitest'
import {configSchema} from '../src/config.ts'
import {Store} from '../src/store.ts'
import {backupState,verifyBackup,restoreState} from '../src/backup.ts'
const roots:string[]=[]
afterEach(()=>{for(const r of roots.splice(0))rmSync(r,{recursive:true,force:true})})
it('refuses a schema downgrade that would erase Webhook execution and receipt semantics',async()=>{
 const root=mkdtempSync(join(tmpdir(),'webhook-downgrade-'));roots.push(root)
 const config=configSchema.parse({stateDir:join(root,'state'),sources:[{id:'local',kind:'local',allowedActors:['operator'],cwd:root}]})
 const store=new Store(join(config.stateDir,'state.sqlite'));store.db.exec('PRAGMA user_version=7');store.close()
 await backupState(config,join(root,'backup'))
 const current=new Store(join(config.stateDir,'state.sqlite'));current.db.exec('PRAGMA user_version=8');current.close()
 await expect(restoreState(config,join(root,'backup'))).rejects.toThrow('Downgrade cannot preserve Webhook')
})

it('keeps a paused skill routine from being reactivated by an old backup',async()=>{
 const root=mkdtempSync(join(tmpdir(),'restore-routine-'));roots.push(root)
 const config=configSchema.parse({stateDir:join(root,'state'),sources:[{id:'local',kind:'local',allowedActors:['operator'],cwd:root}]})
 const file=join(config.stateDir,'state.sqlite'),store=new Store(file)
 const value={id:'routine',skill:{id:'skill',version:1},active:true,revision:1}
 store.requireWorkflowSchema();store.put('router-schedule','routine',value);store.close()
 await backupState(config,join(root,'backup'))
 expect(verifyBackup(join(root,'backup')).schema).toBe(12)
 const live=new Store(file);live.put('router-schedule','routine',{...value,active:false,revision:2});live.close()
 await expect(restoreState(config,join(root,'backup'))).rejects.toThrow('skill schedule or run advanced')
 const reread=new Store(file)
 try{expect(reread.get('router-schedule','routine')).toMatchObject({active:false,revision:2})}finally{reread.close()}
})
it('backs up WAL state, verifies integrity and refuses restoring under a live host',async()=>{
 const root=mkdtempSync(join(tmpdir(),'agent-backup-'));roots.push(root)
 const config=configSchema.parse({stateDir:join(root,'state'),sources:[{id:'local',kind:'local',allowedActors:['operator'],cwd:root}]})
 const store=new Store(join(config.stateDir,'state.sqlite'));store.put('sample','a',{value:1})
 try{
  await backupState(config,join(root,'backup'))
  expect(verifyBackup(join(root,'backup')).schema).toBe(6)
  writeFileSync(join(config.stateDir,'host.lock'),String(process.pid))
  await expect(restoreState(config,join(root,'backup'))).rejects.toThrow('Stop the host')
  appendFileSync(join(root,'backup','state.sqlite'),'tampered')
  expect(()=>verifyBackup(join(root,'backup'))).toThrow('checksum')
 }finally{store.close()}
})
it('restores offline state and retains a backup of the previous database',async()=>{
 const root=mkdtempSync(join(tmpdir(),'agent-restore-'));roots.push(root)
 const config=configSchema.parse({stateDir:join(root,'state'),sources:[{id:'local',kind:'local',allowedActors:['operator'],cwd:root}]})
 const first=new Store(join(config.stateDir,'state.sqlite'));first.put('sample','a',{value:1});first.close()
 await backupState(config,join(root,'backup'))
 const second=new Store(join(config.stateDir,'state.sqlite'));second.put('sample','a',{value:2});second.close()
 const result=await restoreState(config,join(root,'backup'))
 expect(verifyBackup(result.previous).schema).toBe(6)
 const restored=new Store(join(config.stateDir,'state.sqlite'))
 try{expect(restored.get('sample','a')).toEqual({value:1})}finally{restored.close()}
})
it.each(['tool-receipt','browser-receipt','merge-attempt','backend-plugin-tool','workflow-action'])('refuses to erase new %s external-effect evidence on restore',async kind=>{
 const root=mkdtempSync(join(tmpdir(),'restore-effects-'));roots.push(root)
 const config=configSchema.parse({stateDir:join(root,'state'),sources:[{id:'local',kind:'local',cwd:root,allowedActors:['operator']}]})
 const store=new Store(join(config.stateDir,'state.sqlite'));store.close()
 await backupState(config,join(root,'backup'))
 const live=new Store(join(config.stateDir,'state.sqlite')),receipt={id:'write',state:'complete',phase:'merged',result:{saved:true}}
 live.put(kind,'write',receipt);live.close()
 await expect(restoreState(config,join(root,'backup'))).rejects.toThrow('External tool or merge effects advanced')
 const unchanged=new Store(join(config.stateDir,'state.sqlite'))
 try{expect(unchanged.get(kind,'write')).toEqual(receipt)}finally{unchanged.close()}
 expect(existsSync(join(config.stateDir,'host.lock'))).toBe(false)
})
it.each(['tool-receipt','browser-receipt','merge-attempt','backend-plugin-tool','workflow-action'])('preserves advanced %s evidence but permits an unchanged receipt',async kind=>{
 const root=mkdtempSync(join(tmpdir(),'restore-effects-'));roots.push(root)
 const config=configSchema.parse({stateDir:join(root,'state'),sources:[{id:'local',kind:'local',cwd:root,allowedActors:['operator']}]})
 const store=new Store(join(config.stateDir,'state.sqlite')),before={id:'write',state:'running',phase:'submitting'}
 store.put(kind,'write',before);store.close();await backupState(config,join(root,'backup'))
 const live=new Store(join(config.stateDir,'state.sqlite')),after={...before,state:'uncertain',phase:'uncertain'}
 live.put(kind,'write',after);live.close()
 await expect(restoreState(config,join(root,'backup'))).rejects.toThrow('External tool or merge effects advanced')
 await backupState(config,join(root,'current-backup'))
 expect((await restoreState(config,join(root,'current-backup'))).restored).toBe(true)
 const restored=new Store(join(config.stateDir,'state.sqlite'))
 try{expect(restored.get(kind,'write')).toEqual(after)}finally{restored.close()}
})

it('preserves goal replacement barriers and refuses restoring an earlier version chain',async()=>{
 const root=mkdtempSync(join(tmpdir(),'restore-goal-contract-'));roots.push(root)
 const config=configSchema.parse({stateDir:join(root,'state'),sources:[{id:'local',kind:'local',allowedActors:['operator'],cwd:root}]})
 const file=join(config.stateDir,'state.sqlite'),initial=new Store(file);initial.close()
 const legacy=join(root,'legacy');await backupState(config,legacy)
 const current=new Store(file);current.requireGoalReplacementSchema();current.put('router-goal','old',{id:'old',state:'cancelled',supersededBy:'new'});current.put('router-goal','new',{id:'new',state:'active',supersedes:'old'});current.close()
 await expect(restoreState(config,legacy)).rejects.toThrow('Downgrade cannot preserve goal contract replacement')
 const bound=join(root,'bound');await backupState(config,bound);expect(verifyBackup(bound).schema).toBe(17)
 await restoreState(config,bound)
 const later=new Store(file);later.put('router-goal','new',{id:'new',state:'cancelled',supersedes:'old',supersededBy:'latest'});later.put('router-goal','latest',{id:'latest',supersedes:'new'});later.close()
 await expect(restoreState(config,bound)).rejects.toThrow('Goal contract replacement advanced')
 const reread=new Store(file);try{expect(reread.get('router-goal','new')).toMatchObject({supersededBy:'latest'})}finally{reread.close()}
})

it('refuses to roll back asynchronous Worker event deduplication receipts',async()=>{
 const root=mkdtempSync(join(tmpdir(),'restore-worker-inbox-'));roots.push(root)
 const config=configSchema.parse({stateDir:join(root,'state'),sources:[{id:'local',kind:'local',allowedActors:['operator'],cwd:root}]})
 const file=join(config.stateDir,'state.sqlite'),initial=new Store(file);initial.close()
 const legacy=join(root,'legacy');await backupState(config,legacy)
 const current=new Store(file);current.requireAsyncWorkerSchema();current.put('async-worker-attempt','attempt',{ticketId:'ticket',id:'attempt'});current.close()
 await expect(restoreState(config,legacy)).rejects.toThrow('Downgrade cannot preserve async Worker')
 const captured=join(root,'captured');await backupState(config,captured);expect(verifyBackup(captured).schema).toBe(18)
 await restoreState(config,captured)
 const changed=new Store(file);changed.put('async-worker-event','event',{ticketId:'ticket',attemptId:'attempt',disposition:'applied'});changed.close()
 await expect(restoreState(config,captured)).rejects.toThrow('Async Worker event receipts advanced')
 const reread=new Store(file);try{expect(reread.get('async-worker-event','event')).toMatchObject({disposition:'applied'})}finally{reread.close()}
})

it('preserves task assignment permissions and refuses older contract or lease pointers',async()=>{
 const root=mkdtempSync(join(tmpdir(),'restore-assignment-'));roots.push(root)
 const config=configSchema.parse({stateDir:join(root,'state'),sources:[{id:'local',kind:'local',allowedActors:['operator'],cwd:root}]})
 const file=join(config.stateDir,'state.sqlite'),legacy=new Store(file);legacy.requireAsyncWorkerSchema();legacy.close()
 const old=join(root,'old');await backupState(config,old)
 const current=new Store(file);current.requireTaskAssignmentSchema();current.put('task-assignment-contract','task',{ticketId:'task',digest:'original'});current.put('task-workspace-lease-current','task',{ticketId:'task',id:'first'});current.close()
 await expect(restoreState(config,old)).rejects.toThrow('Downgrade cannot preserve task assignment')
 const captured=join(root,'captured');await backupState(config,captured);expect(verifyBackup(captured).schema).toBe(19);await restoreState(config,captured)
 const narrowed=new Store(file);narrowed.put('task-workspace-lease-current','task',{ticketId:'task',id:'narrowed'});narrowed.close()
 await expect(restoreState(config,captured)).rejects.toThrow('Task assignment contracts advanced')
 const reread=new Store(file);try{expect(reread.get('task-workspace-lease-current','task')).toMatchObject({id:'narrowed'})}finally{reread.close()}
 const revisionBackup=join(root,'revision-backup');await backupState(config,revisionBackup)
 const revised=new Store(file);revised.put('task-assignment-revision','next',{ticketId:'task',digest:'next',previousDigest:'original'});revised.put('task-assignment-current','task',{ticketId:'task',digest:'next',revision:2});revised.close()
 await expect(restoreState(config,revisionBackup)).rejects.toThrow('Task assignment contracts advanced')
 const final=new Store(file);try{expect(final.get('task-assignment-current','task')).toMatchObject({digest:'next'})}finally{final.close()}
})

it('fences project responsibility downgrade and receipt removal across restore',async()=>{
 const root=mkdtempSync(join(tmpdir(),'restore-integration-'));roots.push(root)
 const config=configSchema.parse({stateDir:join(root,'state'),sources:[{id:'local',kind:'local',allowedActors:['operator'],cwd:root}]})
 const file=join(config.stateDir,'state.sqlite'),legacy=new Store(file);legacy.requireTaskAssignmentSchema();legacy.close()
 const old=join(root,'old');await backupState(config,old)
 const current=new Store(file);current.requireCodeProjectSchema();current.put('project-commit','d',{id:'d',goalId:'g',ticketId:'t',parents:[],head:'a'.repeat(40)});current.close()
 await expect(restoreState(config,old)).rejects.toThrow('Downgrade cannot preserve project integration')
 const captured=join(root,'captured');await backupState(config,captured);expect(verifyBackup(captured).schema).toBe(20);await restoreState(config,captured)
 const removed=new Store(file);removed.db.prepare("DELETE FROM records WHERE kind='project-commit' AND id='d'").run();removed.close()
 await expect(restoreState(config,captured)).rejects.toThrow('Project integration responsibility or evidence advanced')
 const reread=new Store(file);try{expect(reread.get('project-commit','d')).toBeUndefined();expect(reread.db.prepare('PRAGMA user_version').get()!.user_version).toBe(20)}finally{reread.close()}
})
