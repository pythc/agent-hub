import {redactBody} from '../src/history-cleanup.ts'
import {WorkManager} from '../src/work.ts'
import {afterEach,expect,it,vi} from 'vitest'
import {mkdtempSync,rmSync,mkdirSync,symlinkSync,existsSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {configSchema} from '../src/config.ts'
import {Store} from '../src/store.ts'
import {schedulerAdmission} from '../src/scheduler-admission.ts'
import {workspaceTarget,prepareWorkspace} from '../src/workspace.ts'
import {projectWorkspace} from '../src/project-code.ts'
const close:(()=>void)[]=[]
afterEach(()=>{for(const f of close.splice(0).reverse())f()})
function fixture(){
 const root=mkdtempSync(join(tmpdir(),'scheduler-quota-')),config=configSchema.parse({stateDir:join(root,'state'),scheduler:{backendConcurrency:{codex:1,other:1},workspaceConcurrency:1,projectConcurrency:1},sources:[{id:'local',kind:'local',cwd:root,allowedActors:['alice']}]})
 const store=new Store(join(config.stateDir,'state.sqlite'));close.push(()=>{store.close();rmSync(root,{recursive:true,force:true})})
 const host={config,store},ticket=(id:string,source='local')=>store.put('ticket',id,{id,mandate:{actor:{source,id:'alice'}},assignments:[],inputs:[]}),run=(id:string,phase='running',extra={})=>store.put('run',id,{ticketId:id,assignmentId:'a-'+id,cwd:root,prepared:true,phase,backendId:'codex',...extra}),work=(id:string,ticketId:string,state='running',extra={})=>store.put('work',id,{id,ticketId,assignmentId:'a-'+ticketId,kind:'shell',state,cwd:root,sandbox:'read-only',depth:0,...extra})
 ticket('a');ticket('b');ticket('c')
 return {root,host,config,store,ticket,run,work}
}
it('counts root and background/child work once per ticket and does not write any state',()=>{
 const f=fixture();f.run('a');f.work('shell','a');f.work('child','a','running',{kind:'agent',leaseId:'lease'});f.store.put('task-workspace-lease','lease',{backendId:'codex'})
 const before=f.store.db.prepare('SELECT * FROM records ORDER BY kind,id').all(),result=schedulerAdmission(f.host,{ticketId:'b',backendId:'codex'},[{ticketId:'a',backendId:'codex'}])
 expect(result.allowed).toBe(false);expect(result.dimensions.backend).toMatchObject({used:1,reserved:0,available:0});expect(result.dimensions.workspace).toMatchObject({used:1,reserved:0})
 expect(result.occupancy.usedTicketIds).toEqual(['a']);expect(f.store.db.prepare('SELECT * FROM records ORDER BY kind,id').all()).toEqual(before)
 expect(JSON.stringify(result.dimensions)).not.toContain(f.root)
})
it('reserves admission-before-run without double counting duplicate in-flight tickets',()=>{
 const f=fixture(),result=schedulerAdmission(f.host,{ticketId:'b',backendId:'codex'},[{ticketId:'a',backendId:'codex'},{ticketId:'a',backendId:'codex'}])
 expect(result.dimensions.backend).toMatchObject({used:0,reserved:1});expect(result.allowed).toBe(false)
 expect(schedulerAdmission(f.host,{ticketId:'a',backendId:'codex'},[{ticketId:'a',backendId:'codex'}]).allowed).toBe(true)
})
it('dynamic lowered limits hold new tickets but do not revoke already counted work',()=>{
 const f=fixture();f.run('a');f.run('b');f.config.scheduler.backendConcurrency.codex=1;f.config.scheduler.workspaceConcurrency=1
 expect(schedulerAdmission(f.host,{ticketId:'c',backendId:'codex'}).allowed).toBe(false)
 expect(schedulerAdmission(f.host,{ticketId:'a',backendId:'codex'}).allowed).toBe(true)
 expect(f.store.get<any>('run','a').phase).toBe('running')
})
it('keeps background work counted when the root is idle, and releases confirmed terminal work',()=>{
 const f=fixture();f.run('a','idle');f.work('background','a')
 expect(schedulerAdmission(f.host,{ticketId:'b',backendId:'codex'}).dimensions.backend.used).toBe(1)
 f.work('background','a','completed',{endedAt:Date.now(),exitCode:0})
 expect(schedulerAdmission(f.host,{ticketId:'b',backendId:'codex'}).allowed).toBe(true)
})
it.each(['uncertain','interrupted'])('reserves %s roots without killing or implicitly replaying them',phase=>{
 const f=fixture();f.run('a',phase)
 expect(schedulerAdmission(f.host,{ticketId:'b',backendId:'codex'}).dimensions.backend).toMatchObject({used:0,reserved:1})
 expect(f.store.get<any>('run','a').phase).toBe(phase)
})
it('reserves interrupted work even when endedAt exists, not cancelled/completed work',()=>{
 const f=fixture();f.run('a','idle');f.work('unknown','a','interrupted',{endedAt:Date.now()})
 expect(schedulerAdmission(f.host,{ticketId:'b',backendId:'codex'}).dimensions.backend.reserved).toBe(1)
 f.work('unknown','a','cancelled',{endedAt:Date.now()})
 expect(schedulerAdmission(f.host,{ticketId:'b',backendId:'codex'}).allowed).toBe(true)
})
it('accounts a child actual backend separately without changing its root backend',()=>{
 const f=fixture();f.run('a');f.work('child','a','running',{kind:'agent',threadId:'thread-child'});f.store.put('backend-binding','thread-child',{id:'other'})
 expect(schedulerAdmission(f.host,{ticketId:'b',backendId:'other'}).dimensions.backend.used).toBe(1)
 expect(schedulerAdmission(f.host,{ticketId:'b',backendId:'codex'}).dimensions.backend.used).toBe(1)
})
it('unknown active backend or workspace fails closed for the affected configured quota',()=>{
 const f=fixture();f.run('a','idle');f.work('unknown','a','running',{kind:'agent',cwd:join(f.root,'missing')})
 const result=schedulerAdmission(f.host,{ticketId:'b',backendId:'codex'})
 expect(result.blockers).toContainEqual({dimension:'backend',code:'identity_unknown'});expect(result.blockers).toContainEqual({dimension:'workspace',code:'identity_unknown'})
})
it('source symlinks and actual prepared workspace aliases share the same quota',()=>{
 const f=fixture(),alias=join(f.root,'alias');symlinkSync(f.root,alias,'dir');f.config.sources.push({...f.config.sources[0]!,id:'alias',cwd:alias});f.ticket('b','alias');f.run('a')
 const result=schedulerAdmission(f.host,{ticketId:'b',backendId:'other'})
 expect(result.dimensions.workspace).toMatchObject({used:1,available:0});expect(result.allowed).toBe(false)
})
it('predicts a fresh isolated directory without creating it and matches actual preparation',async()=>{
 const f=fixture();f.config.sources[0]!.sandbox='workspace-write';f.config.sources[0]!.workspace={mode:'directory'}
 const expected=workspaceTarget(f.config,f.config.sources[0]!,'b'),before=schedulerAdmission(f.host,{ticketId:'b',backendId:'codex'})
 expect(existsSync(expected)).toBe(false);expect(before.allowed).toBe(true)
 expect(await prepareWorkspace(f.config,f.config.sources[0]!,'b')).toBe(expected)
 f.run('b','running',{cwd:expected});expect(schedulerAdmission(f.host,{ticketId:'b',backendId:'codex'}).dimensions.workspace?.alreadyCounted).toBe(true)
})
it('uses actual prepared cwd rather than source and predicts project node paths without creating them',()=>{
 const f=fixture(),prepared=join(f.root,'actual');mkdirSync(prepared);f.run('a','running',{cwd:prepared})
 expect(schedulerAdmission(f.host,{ticketId:'b',backendId:'other'}).dimensions.workspace?.used).toBe(0)
 f.store.put('router-goal','project',{id:'project',project:{base:'a'},taskIds:['a','b'],nodes:[{id:'node-b',ticketId:'b'}]})
 const result=schedulerAdmission(f.host,{ticketId:'b',backendId:'other'})
 expect(result.dimensions.project).toMatchObject({used:1,available:0});expect(existsSync(projectWorkspace(f.config.stateDir,'b'))).toBe(false)
})
it('no configured quota does not invent capacity limits or an execution permission',()=>{
 const f=fixture();f.config.scheduler={interactiveBurst:3,backendConcurrency:{}};f.run('a');f.run('b')
 const result=schedulerAdmission(f.host,{ticketId:'c',backendId:'codex'})
 expect(result.allowed).toBe(true);expect(result.dimensions.backend.limit).toBeNull();expect(result.dimensions.workspace?.limit).toBeNull()
})
it('dangling source symlinks and missing prepared roots are unknown, not fallback source capacity',()=>{
 const f=fixture(),alias=join(f.root,'dangling');symlinkSync(join(f.root,'absent'),alias);f.config.sources[0]!.cwd=alias
 expect(schedulerAdmission(f.host,{ticketId:'b',backendId:'codex'}).blockers).toContainEqual({dimension:'workspace',code:'identity_unknown'})
 f.config.sources[0]!.cwd=f.root;f.run('b','idle',{cwd:join(f.root,'missing-prepared')})
 expect(schedulerAdmission(f.host,{ticketId:'b',backendId:'codex'}).blockers).toContainEqual({dimension:'workspace',code:'identity_unknown'})
})
it('uses the admitted backend reservation while the new starting run has no backend receipt yet',()=>{
 const f=fixture();f.run('a','starting',{backendId:undefined,prepared:false})
 const result=schedulerAdmission(f.host,{ticketId:'b',backendId:'codex'},[{ticketId:'a',backendId:'codex'}])
 expect(result.blockers).not.toContainEqual({dimension:'backend',code:'identity_unknown'})
 expect(result.dimensions.backend).toMatchObject({used:1,reserved:0});expect(result.allowed).toBe(false)
})
it('predicts contract and remote-delegation read-only narrowing as the source root, not an isolated write directory',()=>{
 const f=fixture();f.config.sources[0]!.sandbox='workspace-write';f.config.sources[0]!.workspace={mode:'directory'};f.run('a')
 f.store.put('task-assignment-contract','b',{effective:{sandbox:'read-only'}})
 expect(schedulerAdmission(f.host,{ticketId:'b',backendId:'other'}).dimensions.workspace?.used).toBe(1)
 f.store.put('worker-assignment','c',{parentTrigger:'remote-trigger'});f.store.put('trigger','remote-trigger',{id:'remote-trigger',meta:{delegationId:'remote'}})
 f.store.put('delegation-inbound','remote',{triggerId:'remote-trigger',contract:{permissions:{write:false}}})
 expect(schedulerAdmission(f.host,{ticketId:'c',backendId:'other'}).dimensions.workspace?.used).toBe(1)
})
it('distinguishes project isolated roots while enforcing the shared project quota',()=>{
 const f=fixture();f.config.sources[0]!.sandbox='workspace-write'
 f.store.put('router-goal','project',{id:'project',project:{base:'a'},taskIds:['a','b'],nodes:[{id:'node-a',ticketId:'a'},{id:'node-b',ticketId:'b'}]})
 const cwd=projectWorkspace(f.config.stateDir,'a');mkdirSync(cwd,{recursive:true});f.run('a','running',{cwd})
 const result=schedulerAdmission(f.host,{ticketId:'b',backendId:'other'})
 expect(result.dimensions.workspace?.used).toBe(0);expect(result.dimensions.project?.used).toBe(1)
 expect(result.blockers).toEqual([{dimension:'project',code:'limit_reached'}])
})

it('excludes only the new activation, so another backend cannot self-admit above its limit',()=>{
 const f=fixture();f.config.scheduler.workspaceConcurrency=undefined;f.run('a','running',{backendId:'other'});f.run('b','starting',{backendId:'other'})
 expect(schedulerAdmission(f.host,{ticketId:'b',backendId:'other',excludeRun:true}).allowed).toBe(false)
 f.run('b','running',{backendId:'codex'});f.work('new-child','b','starting',{kind:'agent',schedulerBackendId:'other'})
 expect(schedulerAdmission(f.host,{ticketId:'b',backendId:'other',excludeWorkId:'new-child'}).allowed).toBe(false)
 expect(schedulerAdmission(f.host,{ticketId:'b',backendId:'codex',excludeWorkId:'new-child'}).allowed).toBe(true)
})
it('uses captured actual child backend and does not use last-wins multi-backend hints',()=>{
 const f=fixture();f.config.scheduler.workspaceConcurrency=undefined;f.run('a','idle');f.work('child','a','running',{kind:'agent',schedulerBackendId:'other',threadId:'old-binding'})
 f.store.put('backend-binding','old-binding',{id:'codex'})
 expect(schedulerAdmission(f.host,{ticketId:'b',backendId:'other'}).dimensions.backend.used).toBe(1)
 f.run('c','starting',{backendId:undefined,prepared:false})
 const result=schedulerAdmission(f.host,{ticketId:'b',backendId:'codex'},[{ticketId:'c',backendId:'codex'},{ticketId:'c',backendId:'other'}])
 expect(result.blockers).toContainEqual({dimension:'backend',code:'identity_unknown'})
 expect(result.dimensions.backend.reserved).toBe(1)
})
it('releases recovered old child occupancy after cancellation while retaining its interrupted history',async()=>{
 const f=fixture();f.run('a','uncertain');f.work('old-child','a','running',{kind:'agent'})
 const work=new WorkManager(f.store,f.config,{valid:()=>false,wake:()=>{},expired:()=>{},agent:async()=>{throw Error('No new agent execution')}})
 await work.recovered
 expect(f.store.get<any>('work','old-child')).toMatchObject({state:'interrupted',schedulerReleasedAt:expect.any(Number)})
 // Root reconciliation is still pending until an explicit terminal decision.
 expect(schedulerAdmission(f.host,{ticketId:'b',backendId:'codex'}).allowed).toBe(false)
 const task=f.store.tickets.get('a')!;f.store.tickets.save({...task,ended:{by:'human',at:new Date().toISOString()}} as typeof task)
 expect(schedulerAdmission(f.host,{ticketId:'b',backendId:'codex'}).allowed).toBe(true)
 expect(f.store.get<any>('work','old-child').state).toBe('interrupted')
})
it('does not release an unconfirmed interrupted shell just because its ticket was cancelled',()=>{
 const f=fixture();f.run('a','uncertain');f.work('old-shell','a','interrupted',{endedAt:Date.now()})
 const task=f.store.tickets.get('a')!;f.store.tickets.save({...task,ended:{by:'human',at:new Date().toISOString()}} as typeof task)
 const result=schedulerAdmission(f.host,{ticketId:'b',backendId:'codex'})
 expect(result.allowed).toBe(false);expect(result.dimensions.backend.reserved).toBe(1)
})

it.skipIf(process.platform==='win32')('does not release a missing runner while its process group still exists',async()=>{
 const f=fixture();f.run('a','idle');f.work('orphan-group','a','interrupted',{pid:123456789,endedAt:Date.now()})
 let groupExists=true
 const probe=vi.spyOn(process,'kill').mockImplementation((pid,signal)=>{expect(signal).toBe(0);expect(pid).toBe(-123456789);if(groupExists)return true;throw Object.assign(Error('gone'),{code:'ESRCH'})})
 try{
  const work=new WorkManager(f.store,f.config,{valid:()=>false,wake:()=>{},expired:()=>{},agent:async()=>{throw Error('No execution')}})
  expect(f.store.get<any>('work','orphan-group').schedulerReleasedAt).toBeUndefined()
  expect(schedulerAdmission(f.host,{ticketId:'b',backendId:'codex'}).allowed).toBe(false)
  groupExists=false;await work.recovered
  expect(f.store.get<any>('work','orphan-group').schedulerReleasedAt).toEqual(expect.any(Number))
  expect(schedulerAdmission(f.host,{ticketId:'b',backendId:'codex'}).allowed).toBe(true)
 }finally{probe.mockRestore()}
})

it('retains host quota identity and confirmed release across history redaction',()=>{
 expect(redactBody({id:'w',state:'interrupted',schedulerBackendId:'codex',schedulerReleasedAt:123,prompt:'private'})).toEqual({id:'w',state:'interrupted',schedulerBackendId:'codex',schedulerReleasedAt:123,prompt:''})
})
