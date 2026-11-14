import {mkdtempSync,mkdirSync,rmSync,writeFileSync,existsSync,readFileSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {it,expect,afterEach} from 'vitest'
import {configSchema} from '../src/config.ts'
import {Store} from '../src/store.ts'
import {WorkManager,type WorkOwner} from '../src/work.ts'
const roots:string[]=[],managers:WorkManager[]=[],stores:Store[]=[]
afterEach(async()=>{for(const m of managers.splice(0))await m.close();for(const s of stores.splice(0))s.close();for(const r of roots.splice(0))rmSync(r,{recursive:true,force:true})})
function fixture(timeout=2000){
 const root=mkdtempSync(join(tmpdir(),'managed-work-'));roots.push(root);const cwd=join(root,'project');mkdirSync(cwd)
 const config=configSchema.parse({stateDir:join(root,'state'),codex:process.env.CODEX_BINARY??'codex',work:{backgroundTimeoutMs:timeout,sandboxDriver:process.env.CODEX_BINARY?'codex':process.platform==='darwin'?'seatbelt':'bubblewrap'},sources:[{id:'local',kind:'local',allowedActors:['operator'],cwd}]})
 const store=new Store(join(config.stateDir,'state.sqlite'));stores.push(store);writeFileSync(join(config.stateDir,'host.lock'),String(process.pid))
 const wakes:any[]=[],owner:WorkOwner={ticketId:'task',assignmentId:'a',cwd,sandbox:'workspace-write',depth:0}
 const manager=new WorkManager(store,config,{valid:()=>true,wake:w=>wakes.push(w),agent:async(item,signal)=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('cancelled')),{once:true}))});managers.push(manager)
 return {manager,store,owner,wakes,cwd,root}
}
async function settle(f:ReturnType<typeof fixture>,id:string){for(let i=0;i<200;i++){await f.manager.tick();const item=f.store.get<any>('work',id);if(!['running','starting'].includes(item.state))return item;await new Promise(r=>setTimeout(r,25))}throw Error('Managed process did not finish')}
it('keeps a command after its caller returns, deduplicates starts and sends one completion',async()=>{
 const f=fixture(),command='sleep 0.3; printf hello; printf result > result.txt'
 const first=await f.manager.shell(f.owner,command,'same',0)
 expect(first.state).toBe('running')
 const second=await f.manager.shell(f.owner,command,'same',0)
 expect(second.id).toBe(first.id)
 expect((await settle(f,first.id)).state).toBe('completed')
 await Promise.all([f.manager.tick(),f.manager.tick()])
 expect(f.wakes).toHaveLength(1)
 expect(readFileSync(join(f.cwd,'result.txt'),'utf8')).toBe('result')
 expect(f.manager.read(f.owner,first.id).output).toContain('hello')
 await expect(f.manager.shell(f.owner,'different','same',0)).rejects.toThrow('reused')
})
it.each([[true,false,false],[false,true,false],[true,true,true],[undefined,false,false],[undefined,true,true]] as const)('intersects a retained network cap %s with current global policy %s',async(retained,current,expected)=>{
 const f=fixture();f.manager.config.work.network=current
 const owner={...f.owner,network:retained},item=await f.manager.shell(owner,'printf policy','network-policy',0)
 const spec=JSON.parse(readFileSync(join(f.manager.directory,item.id+'.spec.json'),'utf8'))
 expect(spec.network).toBe(expected)
 expect((await settle(f,item.id)).state).toBe('completed')
})
it('holds a review server without a slot or completion wake after handoff',async()=>{
 const f=fixture(100)
 const item=await f.manager.shell(f.owner,'sleep 0.5; printf done','review',0)
 await f.manager.handoff('task','a')
 await new Promise(r=>setTimeout(r,180));await f.manager.tick()
 expect(f.store.get<any>('work',item.id).state).toBe('running')
 expect(f.manager.active('task','a')).toHaveLength(0)
 await settle(f,item.id);expect(f.wakes).toEqual([])
})
it('copies its granted attachment from private state while keeping another task attachment unreadable',async()=>{
 const f=fixture(),directory=join(f.root,'state','assets');mkdirSync(directory)
 const own=join(directory,'own.png'),other=join(directory,'other.png');writeFileSync(own,'captured image',{mode:0o400});writeFileSync(other,'private other task',{mode:0o400})
 f.store.put('asset','own',{id:'own',ticketId:f.owner.ticketId,path:own})
 f.store.put('asset','other',{id:'other',ticketId:'different-task',path:other})
 const quote=(path:string)=>"'"+path.replaceAll("'","'\\''")+"'"
 const item=await f.manager.shell(f.owner,'cp '+quote(own)+' copied.png && ! cat '+quote(other)+' >/dev/null 2>&1','copy-attachment',0)
 expect((await settle(f,item.id)).exitCode).toBe(0)
 expect(readFileSync(join(f.cwd,'copied.png'),'utf8')).toBe('captured image')
})
it('kills command descendants when its assignment ends',async()=>{
 const f=fixture(),item=await f.manager.shell(f.owner,'(printf ready > ready.txt; while [ ! -f release.txt ]; do sleep 0.05; done; printf escaped > escaped.txt) & wait','slow',0)
 // A release barrier prevents a busy CI runner from writing before cancellation.
 for(let n=0;n<200&&!existsSync(join(f.cwd,'ready.txt'));n++)await new Promise(r=>setTimeout(r,20))
 expect(existsSync(join(f.cwd,'ready.txt'))).toBe(true)
 await f.manager.endAssignment('task','a')
 writeFileSync(join(f.cwd,'release.txt'),'released')
 await new Promise(r=>setTimeout(r,1200))
 expect(existsSync(join(f.cwd,'escaped.txt'))).toBe(false)
 expect(f.store.get<any>('work',item.id).state).toBe('cancelled')
 expect(f.wakes).toEqual([])
})
it('stops subagents on handoff and revokes their active state',async()=>{
 const f=fixture(),item=await f.manager.agent(f.owner,'Inspect','agent')
 await f.manager.handoff('task','a')
 expect(f.store.get<any>('work',item.id).state).toBe('cancelled')
})
it('enforces the background deadline and wakes with the retained cancellation result',async()=>{
 const f=fixture(100),item=await f.manager.shell(f.owner,'sleep 2','deadline',0)
 f.manager.turnEnded('task','a');await new Promise(r=>setTimeout(r,160));await f.manager.tick()
 expect(f.store.get<any>('work',item.id)).toMatchObject({state:'cancelled',notify:'sent'})
 expect(f.wakes[0].error).toContain('deadline')
})
it('enforces read-only commands and prevents another task from accessing jobs',async()=>{
 const f=fixture(),owner={...f.owner,sandbox:'read-only' as const}
 const item=await f.manager.shell(owner,'printf forbidden > forbidden.txt','readonly',0)
 const done=await settle(f,item.id)
 expect(done.state).toBe('failed');expect(existsSync(join(f.cwd,'forbidden.txt'))).toBe(false)
 expect(()=>f.manager.read({...f.owner,ticketId:'other'},item.id)).toThrow('outside')
})

it('does not let sandboxed work read the host capability or access token',async()=>{
 const f=fixture();writeFileSync(join(f.root,'state','access-token'),'synthetic-private-token')
 const item=await f.manager.shell(f.owner,'cat '+join(f.root,'state','access-token'),'secret',0)
 const done=await settle(f,item.id)
 expect(done.state).toBe('failed')
 expect(f.manager.read(f.owner,item.id).output).not.toContain('synthetic-private-token')
})

it('returns the same subagent for a duplicate request even at concurrency limits',async()=>{
 const f=fixture();(f.manager as any).config.work.maxAgents=1
 const first=await f.manager.agent(f.owner,'Read','same-agent')
 expect((await f.manager.agent(f.owner,'Read','same-agent')).id).toBe(first.id)
 await expect(f.manager.agent(f.owner,'Different','same-agent')).rejects.toThrow('different content')
 await expect(f.manager.agent(f.owner,'Another','another')).rejects.toThrow('concurrency')
})

it('collects killed jobs without waking on a background timeout and retains subagents',async()=>{
 const f=fixture(100),expired:any[]=[]
 ;(f.manager as any).hooks.expired=(...args:any[])=>expired.push(args)
 const shell=await f.manager.shell(f.owner,'sleep 2','timed',0),agent=await f.manager.agent(f.owner,'Continue','long-agent')
 f.manager.turnEnded('task','a');await new Promise(r=>setTimeout(r,150));await f.manager.tick()
 expect(f.store.get<any>('work',shell.id)).toMatchObject({state:'cancelled',notify:'held'})
 expect(f.store.get<any>('work',agent.id).state).toBe('running')
 expect(expired[0][1]).toEqual([shell.id]);expect(expired[0][2]).toEqual([agent.id]);expect(f.wakes).toEqual([])
})

it('collects foreground command completion without queuing a redundant worker wake',async()=>{
 const f=fixture(),result=await f.manager.shell(f.owner,'printf foreground','foreground',5000)
 expect(result.state).toBe('completed');expect(result.notify).toBe('collected')
 await f.manager.tick();expect(f.wakes).toEqual([])
})
