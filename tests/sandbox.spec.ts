import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync,realpathSync,symlinkSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {afterEach,it,expect} from 'vitest'
import {configSchema} from '../src/config.ts'
import {Store} from '../src/store.ts'
import {WorkManager,type WorkOwner} from '../src/work.ts'
import {sandboxCommand} from '../src/sandbox.ts'
import {prepareWorkspace} from '../src/workspace.ts'
import {createServer} from 'node:http'
import {execFileSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
const roots:string[]=[],managers:WorkManager[]=[],stores:Store[]=[]
const supported=process.platform==='darwin'||process.platform==='linux'
const driver=process.platform==='linux'?'bubblewrap':'seatbelt'
const originalEnvFile=process.env.AGENTHUB_ENV_FILE
afterEach(async()=>{for(const m of managers.splice(0))await m.close();for(const s of stores.splice(0))s.close();for(const r of roots.splice(0))rmSync(r,{recursive:true,force:true});delete process.env.AGENTHUB_FIXTURE_KEY;if(originalEnvFile===undefined)delete process.env.AGENTHUB_ENV_FILE;else process.env.AGENTHUB_ENV_FILE=originalEnvFile})
function fixture(sandbox:'read-only'|'workspace-write'='workspace-write'){
 const root=mkdtempSync(join(tmpdir(),'portable-sandbox-'));roots.push(root);const cwd=join(root,'files');mkdirSync(cwd)
 const config=configSchema.parse({stateDir:join(root,'state'),codex:'/missing/codex',work:{sandboxDriver:driver,network:false},sources:[{id:'local',kind:'local',cwd,allowedActors:['operator']}]})
 const store=new Store(join(config.stateDir,'state.sqlite'));stores.push(store);writeFileSync(join(config.stateDir,'host.lock'),String(process.pid));writeFileSync(join(config.stateDir,'secret'),'sandbox-secret-marker')
 const manager=new WorkManager(store,config,{valid:()=>true,wake:()=>{},agent:async()=>{throw Error('unused')}});managers.push(manager)
 const owner:WorkOwner={ticketId:'test',assignmentId:'one',cwd,sandbox,depth:0}
 return {root,cwd,config,store,manager,owner}
}
async function settle(f:ReturnType<typeof fixture>,id:string){for(let i=0;i<100;i++){await f.manager.tick();const item=f.store.get<any>('work',id);if(!['starting','running'].includes(item.state))return item;await new Promise(r=>setTimeout(r,20))}throw Error('Command did not finish')}
const git=(cwd:string,...args:string[])=>execFileSync('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim()
function seedRepository(cwd:string){
 git(cwd,'init','-b','main')
 writeFileSync(join(cwd,'version.txt'),'original\n')
 git(cwd,'add','version.txt')
 git(cwd,'-c','user.name=Fixture','-c','user.email=fixture@example.invalid','-c','commit.gpgsign=false','commit','-m','Seed')
 return git(cwd,'rev-parse','HEAD')
}
it.skipIf(!supported)('prepares one Git checkout per ticket and lets the offline Worker review and commit its fix',async()=>{
 const f=fixture(),base=seedRepository(f.cwd),source=f.config.sources[0]!
 source.sandbox='workspace-write'
 source.workspace={mode:'directory',prepare:{command:'/bin/sh',args:[fileURLToPath(new URL('../examples/prepare-git-repo.sh',import.meta.url))]}}
 const cwd=await prepareWorkspace(f.config,source,f.owner.ticketId),owner={...f.owner,cwd}
 const job=await f.manager.shell(owner,[
  'set -e','cd repo','git rev-parse HEAD','printf "patched\\n" > version.txt','git diff --check','git diff -- version.txt',
  'git add version.txt','git commit -m "Patch in Worker"','git status --short','git rev-parse HEAD'
 ].join('\n'),'local-commit',0)
 const ended=await settle(f,job.id),output=f.manager.read(owner,job.id).output
 expect(ended.exitCode,output).toBe(0)
 const repo=join(cwd,'repo'),head=git(repo,'rev-parse','HEAD')
 expect(output).toContain(base);expect(output).toContain('+patched');expect(output).toContain(head);expect(output).not.toContain('xcrun_db')
 expect(git(repo,'rev-parse','HEAD^')).toBe(base)
 expect(git(repo,'status','--porcelain')).toBe('')
 expect(git(repo,'branch','--show-current')).toMatch(/^superagent\/[a-f0-9]{20}$/)
 expect(git(repo,'remote')).toBe('')
 expect(git(f.cwd,'rev-parse','HEAD')).toBe(base);expect(git(f.cwd,'status','--porcelain')).toBe('')
 // A host that stopped after publishing the checkout can finish preparing the same ticket.
 rmSync(join(cwd,'.superagent-prepared'))
 expect(await prepareWorkspace(f.config,source,f.owner.ticketId)).toBe(cwd)
 expect(git(repo,'rev-parse','HEAD')).toBe(head)
})
it.skipIf(process.platform!=='darwin')('reads a linked checkout with Apple Git while keeping its shared refs read-only',async()=>{
 const f=fixture(),base=seedRepository(f.cwd),linked=join(f.root,'linked')
 git(f.cwd,'worktree','add','-b','fix',linked,'HEAD')
 const owner={...f.owner,cwd:linked}
 const command=['set -e','/usr/bin/git --version','git rev-parse HEAD','git status --short','git diff --stat',
  'if git update-ref refs/heads/outside HEAD 2>/dev/null; then exit 11; fi'].join('\n')
 const job=await f.manager.shell(owner,command,'linked-git',0),ended=await settle(f,job.id),output=f.manager.read(owner,job.id).output
 expect(ended.exitCode,output).toBe(0);expect(output).toContain(base)
 expect(git(f.cwd,'branch','--list','outside')).toBe('')
})
it.skipIf(!supported)('keeps a Worker gitfile from granting another repository to its shell',async()=>{
 const f=fixture(),external=join(f.root,'unassigned')
 mkdirSync(external);seedRepository(external)
 const forged=await f.manager.shell(f.owner,'printf "gitdir: %s\\n" "'+join(external,'.git')+'" > .git','forge-gitfile',0)
 expect((await settle(f,forged.id)).exitCode).toBe(0)
 const read=await f.manager.shell(f.owner,'git show HEAD:version.txt','read-other-repo',0)
 expect((await settle(f,read.id)).exitCode).not.toBe(0)
 expect(f.manager.read(f.owner,read.id).output).not.toContain('original\n')
})
it.skipIf(process.platform!=='darwin')('keeps the Seatbelt workspace root in place across commands',async()=>{
 const f=fixture(),outside=join(f.root,'unassigned')
 mkdirSync(outside);writeFileSync(join(outside,'private-marker'),'unassigned')
 const swap=await f.manager.shell(f.owner,'cd "$TMPDIR" && mv "'+f.cwd+'" old && ln -s "'+outside+'" "'+f.cwd+'"','swap-root',0)
 expect((await settle(f,swap.id)).exitCode).not.toBe(0)
 const next=await f.manager.shell(f.owner,'touch legitimate && test ! -f private-marker','check-root',0)
 expect((await settle(f,next.id)).exitCode).toBe(0)
 expect(existsSync(join(outside,'legitimate'))).toBe(false)
 const link=join(f.root,'old-linked-workspace')
 symlinkSync(outside,link)
 expect(()=>sandboxCommand({codex:'codex',sandboxDriver:'seatbelt',cwd:link,scratch:f.root,sandbox:'workspace-write',network:false,command:'true'})).toThrow('workspace root')
})
it.skipIf(process.platform!=='darwin')('gives the macOS Codex driver read access to the selected developer tools',()=>{
 const f=fixture('read-only')
 const selected=execFileSync('/usr/bin/xcode-select',['--print-path'],{encoding:'utf8',env:{}}).trim()
 const launch=sandboxCommand({codex:'codex',sandboxDriver:'codex',cwd:f.cwd,scratch:f.root,sandbox:'read-only',network:false,command:'git status'})
 const filesystem=launch.args.find(arg=>arg.startsWith('permissions.superagent-managed.filesystem='))
 expect(filesystem).toContain(JSON.stringify(selected)+'="read"')
 expect(launch.developerBin).toBe(join(selected,'usr','bin'))
})
it.skipIf(!supported)('runs a real sandboxed command without Codex and denies private state/outside writes/credential environment',async()=>{
 const f=fixture();process.env.AGENTHUB_FIXTURE_KEY='must-not-be-inherited'
 const outside=join(f.root,'outside');writeFileSync(outside,'outside-original-private')
 const command="printf safe > result.txt; if cat "+JSON.stringify(join(f.config.stateDir,'secret'))+" >/dev/null 2>&1; then exit 12; fi; if cat "+JSON.stringify(outside)+" >/dev/null 2>&1; then exit 13; fi; (printf changed > "+JSON.stringify(outside)+") 2>/dev/null || true; /usr/bin/env; printf sandbox-ok"
 const item=await f.manager.shell(f.owner,command,'one',0),ended=await settle(f,item.id)
 expect(ended.state).toBe('completed');expect(ended.exitCode).toBe(0);expect(readFileSync(join(f.cwd,'result.txt'),'utf8')).toBe('safe');expect(readFileSync(outside,'utf8')).toBe('outside-original-private')
 const output=f.manager.read(f.owner,item.id).output;expect(output).toContain('sandbox-ok');expect(output).not.toContain('must-not-be-inherited');expect(output).not.toContain('sandbox-secret-marker')
})
it.skipIf(!supported)('blocks network access when disabled and permits the explicitly enabled local network',async()=>{
 const f=fixture(),server=createServer((_,res)=>res.end('sandbox-network-marker'))
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+(server.address() as any).port
 const quote=(s:string)=>"'"+s.replace(/'/g,"'\\''")+"'"
 try{for(const enabled of [false,true]){
  f.config.work.network=enabled
  const script='fetch('+JSON.stringify(url)+',{signal:AbortSignal.timeout(350)}).then(r=>r.text()).then(t=>process.exit(t==="sandbox-network-marker"?'+(enabled?'0':'11')+':12)).catch(()=>process.exit('+(enabled?'13':'0')+'))'
  const item=await f.manager.shell(f.owner,quote(process.execPath)+' -e '+quote(script),'network-'+enabled,0),ended=await settle(f,item.id)
  expect(ended.exitCode).toBe(0)
 }}finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()))}
})
it.skipIf(!supported)('enforces read-only workspaces in the standalone sandbox',async()=>{
 const f=fixture('read-only');writeFileSync(join(f.cwd,'input'),'read-marker')
 const item=await f.manager.shell(f.owner,"cat input; if touch denied 2>/dev/null; then exit 14; fi",'one',0),ended=await settle(f,item.id)
 expect(ended.exitCode).toBe(0);expect(existsSync(join(f.cwd,'denied'))).toBe(false);expect(f.manager.read(f.owner,item.id).output).toContain('read-marker')
})
it.skipIf(!supported)('hides the host credential environment file even inside an otherwise readable directory',async()=>{
 const f=fixture(),file=join(f.cwd,'host-credentials.env'),alias=join(f.cwd,'credentials-link.env');writeFileSync(file,'must-not-read-office-credentials');symlinkSync(file,alias);process.env.AGENTHUB_ENV_FILE=alias
 const item=await f.manager.shell(f.owner,'cat host-credentials.env credentials-link.env 2>/dev/null; (printf changed > host-credentials.env) 2>/dev/null || true; printf private-file-probe-ok','host-private-file',0),ended=await settle(f,item.id)
 const output=f.manager.read(f.owner,item.id).output;expect(ended.exitCode).toBe(0);expect(output).toContain('private-file-probe-ok');expect(output).not.toContain('must-not-read-office-credentials');expect(readFileSync(file,'utf8')).toBe('must-not-read-office-credentials')
})
it.skipIf(!supported)('allows only the active nested workspace and an assigned attachment within private state',async()=>{
 const f=fixture(),cwd=join(f.config.stateDir,'work','active'),other=join(f.config.stateDir,'work','other'),asset=join(f.config.stateDir,'assets','attachment.txt')
 mkdirSync(cwd,{recursive:true});mkdirSync(other,{recursive:true});mkdirSync(join(f.config.stateDir,'assets'),{recursive:true});writeFileSync(join(other,'secret'),'other-task-secret');writeFileSync(asset,'assigned-attachment')
 f.store.put('asset','one',{ticketId:f.owner.ticketId,path:asset});const owner={...f.owner,cwd}
 const command='printf active-ok > result.txt; cat result.txt; cat '+JSON.stringify(asset)+'; if cat '+JSON.stringify(join(f.config.stateDir,'secret'))+' >/dev/null 2>&1; then exit 12; fi; if cat '+JSON.stringify(join(other,'secret'))+' >/dev/null 2>&1; then exit 13; fi'
 const item=await f.manager.shell(owner,command,'nested',0),ended=await settle(f,item.id)
 expect(ended.exitCode).toBe(0);expect(readFileSync(join(cwd,'result.txt'),'utf8')).toBe('active-ok');expect(f.manager.read(owner,item.id).output).toContain('assigned-attachment')
})
it.skipIf(!supported)('stops command descendants on assignment end with the standalone sandbox',async()=>{
 const f=fixture(),item=await f.manager.shell(f.owner,'printf started > started; sleep 0.4; printf escaped > escaped','one',0)
 for(let n=0;n<100&&!existsSync(join(f.cwd,'started'));n++)await new Promise(r=>setTimeout(r,10))
 expect(existsSync(join(f.cwd,'started'))).toBe(true)
 await f.manager.endAssignment('test','one');await new Promise(r=>setTimeout(r,650))
 expect(existsSync(join(f.cwd,'escaped'))).toBe(false);expect(f.store.get<any>('work',item.id).state).toBe('cancelled')
})
it('does not fall back to an unrestricted process when a sandbox is disabled or mismatched',()=>{
 const f=fixture(),spec={...f.config.sources[0]!,codex:'/missing/codex',privateState:f.config.stateDir,network:false,command:'true',scratch:f.cwd}
 expect(()=>sandboxCommand({...spec,sandboxDriver:'disabled'})).toThrow('disabled')
 expect(()=>sandboxCommand({...spec,sandboxDriver:'seatbelt'},'linux')).toThrow('requires macOS')
 expect(()=>sandboxCommand({...spec,sandboxDriver:'bubblewrap'},'darwin')).toThrow('requires Linux')
})
it('rejects a sandbox for another platform without leaving a running job',async()=>{
 const f=fixture();f.config.work.sandboxDriver=process.platform==='darwin'?'bubblewrap':'seatbelt'
 await expect(f.manager.shell(f.owner,'true','wrong-platform',0)).rejects.toThrow('requires')
 expect(f.manager.list()).toHaveLength(0)
})
it('constructs a minimal Linux namespace with read-only root inputs and hidden private state',()=>{
 const f=fixture('read-only'),cwd=join(f.config.stateDir,'work','active'),scratch=join(f.root,'scratch');mkdirSync(cwd,{recursive:true});mkdirSync(scratch)
 const command=sandboxCommand({codex:'/missing',sandboxDriver:'bubblewrap',cwd,sandbox:'read-only',privateState:f.config.stateDir,scratch,network:false,command:'true'},'linux')
 expect(command.args).toContain('--unshare-all');expect(command.args).not.toContain('--share-net');expect(command.args).toContain('--ro-bind');expect(command.args.slice(-3)).toEqual(['/bin/sh','-c','true'])
 expect(command.args).toContain(f.config.stateDir);expect(command.command.endsWith('bwrap')).toBe(true)
 const masked=command.args.lastIndexOf(realpathSync(f.config.stateDir)),remounted=command.args.indexOf(realpathSync(cwd),masked+1)
 expect(remounted).toBeGreaterThan(masked);expect(command.args[remounted-1]).toBe('--ro-bind')
})
