/** Functional Git/process tests only: this launcher shim does NOT test sandbox isolation. */
import {afterEach,expect,it,vi} from 'vitest'
import {spawn,execFileSync} from 'node:child_process'
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,symlinkSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createServer} from 'node:http'
vi.mock('../src/sandbox.ts',async original=>{
 const actual=await original<typeof import('../src/sandbox.ts')>()
 return {...actual,sandboxCommand:(s:{command:string})=>({command:'/bin/sh',args:['-c',s.command]}),startSandboxRunner:(file:string)=>{
  const script=`const fs=require('fs'),{spawn}=require('child_process');const s=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));const fd=fs.openSync(s.directory+'/'+s.id+'.output','w');const c=spawn('/bin/sh',['-c',s.command],{cwd:s.cwd,env:process.env,stdio:['ignore',fd,fd]});c.on('close',exitCode=>{fs.closeSync(fd);fs.writeFileSync(s.directory+'/'+s.id+'.result.json',JSON.stringify({exitCode}));});`
  return spawn(process.execPath,['-e',script,file],{detached:true,stdio:'ignore'})
 }}
})
import {configSchema,type ProjectPolicy} from '../src/config.ts'
import {ProjectCode,startCodeProject,type CodeReceipt} from '../src/project-code.ts'
import {Store} from '../src/store.ts'
import type {RouterGoal} from '../src/router-goals.ts'
const cleanups:(()=>Promise<void>|void)[]=[]
afterEach(async()=>{for(const cleanup of cleanups.splice(0).reverse())await cleanup()})
const git=(cwd:string,...args:string[])=>execFileSync('git',['-c','core.hooksPath=/dev/null',...args],{cwd,encoding:'utf8'}).trim()
async function freePort(){const s=createServer();await new Promise<void>(r=>s.listen(0,'127.0.0.1',r));const p=(s.address() as {port:number}).port;await new Promise<void>(r=>s.close(()=>r()));return p}
function fixture(policy:ProjectPolicy,baseline?:(cwd:string)=>void){
 const root=mkdtempSync(join(tmpdir(),'project-functional-')),repo=join(root,'repo'),stateDir=join(root,'state');mkdirSync(repo);mkdirSync(stateDir)
 cleanups.push(()=>rmSync(root,{recursive:true,force:true}))
 git(repo,'init','-q');git(repo,'config','user.name','Test');git(repo,'config','user.email','test@example.com');writeFileSync(join(repo,'schema.json'),'{}');writeFileSync(join(repo,'server.cjs'),`require('node:http').createServer((q,s)=>s.end(process.env.AGENT_HUB_START_CHECK_TOKEN)).listen(Number(process.env.PORT),'127.0.0.1')`);baseline?.(repo);git(repo,'add','.');git(repo,'commit','-qm','base')
 const config=configSchema.parse({stateDir,work:{sandboxDriver:'disabled',backgroundTimeoutMs:5000},sources:[{id:'local',kind:'local',cwd:repo,sandbox:'workspace-write',allowedActors:['alice'],workspace:{mode:'directory',project:policy}}]})
 const store=new Store(join(stateDir,'state.db')),code=new ProjectCode(config,store);cleanups.push(async()=>{await code.close();store.db.close()})
 const g={id:'goal',triggerId:'human',criteria:[],nodes:['one','two'].map(id=>({id,workerId:id,dependsOn:[],criterionIds:[],state:'pending'}))} as unknown as RouterGoal
 startCodeProject(config.sources[0]!,g)
 for(const n of g.nodes!)n.ticketId='ticket-'+n.id
 let seq=0
 async function prepare(id:string){const n=g.nodes!.find(n=>n.id===id)!;await code.prepare(g,n,new AbortController().signal);store.put('run',n.ticketId!,{cwd:code.workspace(n.ticketId!)});return code.workspace(n.ticketId!)}
 async function capture(id:string){const n=g.nodes!.find(n=>n.id===id)!,delivery={id:'delivery-'+ ++seq,ticketId:n.ticketId!};code.check(g,n,delivery as never);const end=Date.now()+10000;while(Date.now()<end){const r=code.receipt(delivery.id);if(r){if(!r.error){n.state='passed';store.put('goal-delivery',n.ticketId!,delivery)}return r}await new Promise(r=>setTimeout(r,10))}throw Error('capture timeout')}
 async function branches(){for(const id of ['one','two']){const cwd=await prepare(id);writeFileSync(join(cwd,id+'.txt'),id);git(cwd,'add','.');git(cwd,'commit','-qm',id);expect((await capture(id)).error).toBeUndefined()}}
 return {code,store,g,repo,prepare,capture,branches}
}
it('captures two real isolated repositories and one commit-bound staged integration',async()=>{
 const p=await freePort(),f=fixture({testCommand:'test -f one.txt && test -f two.txt',sharedFiles:['schema.json'],stages:{buildCommand:'test -f one.txt',startCheck:{command:`exec env PORT=${p} node server.cjs`,url:`http://127.0.0.1:${p}`,timeoutMs:1000},businessCommand:'test -f two.txt'}})
 await f.branches();await f.prepare('integration');const r=await f.capture('integration');expect(r.error).toBeUndefined();expect(r.stages?.map(s=>s.kind)).toEqual(['build','start','business']);expect(new Set(r.stages?.map(s=>s.head))).toEqual(new Set([r.head]));expect(r.parents).toHaveLength(3);expect(r.ownership?.workerId).toBe('two');f.code.validateReceipt(f.g,f.g.nodes!.at(-1)!,r)
},20000)
it('rejects a clean nonowner schema modification before it becomes an accepted parent',async()=>{
 const f=fixture({testCommand:'true',sharedFiles:['schema.json']}),cwd=await f.prepare('one');writeFileSync(join(cwd,'schema.json'),'changed');git(cwd,'add','.');git(cwd,'commit','-qm','unauthorized');expect((await f.capture('one')).error).toContain('belongs to integration')
})
it.each(['business','bytes','start'] as const)('rejects failed %s stage',async failure=>{
 const p=await freePort(),f=fixture({testCommand:'true',stages:{buildCommand:failure==='bytes'?'echo changed > schema.json':'true',startCheck:{command:failure==='start'?'exec true':`exec env PORT=${p} node server.cjs`,url:`http://127.0.0.1:${p}`,timeoutMs:500},businessCommand:failure==='business'?'exit 7':'true'}})
 await f.branches();await f.prepare('integration');expect((await f.capture('integration')).error).toContain('stage failed')
},20000)
it('cancellation prevents an in-flight capture from publishing late success',async()=>{
 const f=fixture({testCommand:'sleep 2'});await f.branches();await f.prepare('integration');const n=f.g.nodes!.at(-1)!;f.code.check(f.g,n,{id:'cancelled',ticketId:n.ticketId} as never);await new Promise(r=>setTimeout(r,40));await f.code.stop(f.g.id);expect(f.code.receipt('cancelled')).toBeUndefined()
})

it('rejects a real unchanged lockfile symlink whose unprotected target was modified',async()=>{
 const f=fixture({testCommand:'true'},cwd=>{writeFileSync(join(cwd,'target.json'),'original');symlinkSync('target.json',join(cwd,'package-lock.json'))})
 const cwd=await f.prepare('one'),before=git(cwd,'ls-tree','HEAD','package-lock.json');writeFileSync(join(cwd,'target.json'),'changed');git(cwd,'add','.');git(cwd,'commit','-qm','target edit');expect(git(cwd,'ls-tree','HEAD','package-lock.json')).toBe(before)
 expect((await f.capture('one')).error).toContain('regular Git file')
})
it('rejects a newly committed directory symlink hiding an explicitly protected descendant',async()=>{
 const f=fixture({testCommand:'true',sharedFiles:['schema/api.json']}),cwd=await f.prepare('one')
 mkdirSync(join(cwd,'real'));writeFileSync(join(cwd,'real','api.json'),'changed');symlinkSync('real',join(cwd,'schema'));git(cwd,'add','.');git(cwd,'commit','-qm','hidden shared path')
 expect((await f.capture('one')).error).toContain('ancestor must be a Git directory')
})
