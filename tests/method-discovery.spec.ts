import {appendFileSync,mkdtempSync,readFileSync,rmSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {afterEach,expect,it,vi} from 'vitest'
import {Runtime} from '../src/runtime.ts'
import {configSchema} from '../src/config.ts'
import {serve} from '../src/server.ts'
import {stableDigest} from '../src/sources.ts'
import type {RouterGoal} from '../src/router-goals.ts'
import type {ScheduledRun} from '../src/router-proactive.ts'
import type {Run} from '../src/store.ts'

const roots:string[]=[],hosts:Runtime[]=[],servers:Awaited<ReturnType<typeof serve>>[]=[]
afterEach(async()=>{
 vi.restoreAllMocks()
 for(const server of servers.splice(0)){server.server.closeAllConnections();await new Promise<void>(resolve=>server.server.close(()=>resolve()));await server.closeRuntime();hosts.splice(hosts.indexOf(server.runtime),1)}
 for(const host of hosts.splice(0))await host.close()
 for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true})
})
function fixture(){
 const root=mkdtempSync(join(tmpdir(),'method-discovery-'));roots.push(root)
 const config=configSchema.parse({stateDir:join(root,'state'),port:0,acceptMode:'auto',work:{sandboxDriver:'disabled',autoRecover:false},execution:{router:{mode:'host'},management:{enabled:true,maxWorkers:1},workers:[{id:'one',backend:'codex'}]},sources:[{id:'local',kind:'local',cwd:root,workspace:{mode:'source'},allowedActors:['operator']}]})
 const model=vi.fn(async()=>{throw Error('No model permitted')}),history=vi.fn(async()=>{throw Error('No history read permitted')})
 const host=new Runtime(config,{model:{describe:()=>({id:'codex',kind:'codex',resume:true,tools:true,images:false,nativeTakeover:false,steering:false,promptRefresh:false}),run:model,history}});hosts.push(host);host.pause(true)
 const deliver=vi.spyOn(host.sources.get('local')!,'deliver')
 host.scopes.command({action:'scope.put',operationId:'scope',expectedRevision:0,scope:{id:'team',tenantId:'org',name:'Team',contextBytes:128000,managers:[JSON.stringify(['local','operator'])],workerIds:['one'],sourceIds:['local'],backendIds:['codex']}})
 host.scopes.command({action:'entry.bind',operationId:'entry',expectedRevision:0,scopeId:'team',sourceId:'local',accountNamespace:'local',nativeId:'topic',history:'group'})
 const receive=(id:string,thread:string)=>{
  const result=host.receive('local','operator',{id,thread,scope:'topic',text:'Continuously inspect this project and report findings',addressed:true}) as {triggerId:string}
  const trigger=host.store.triggers.get(result.triggerId)!
  return {trigger,context:host.scopes.context(trigger,'local:'+thread)!}
 }
 return {root,host,model,history,deliver,receive,original:receive('original','topic')}
}

const ref=(s:any)=>({id:s.id,version:s.version,scopeId:s.scopeId,entryId:s.entryId})
function seed(f:ReturnType<typeof fixture>,version=1){
 const c=f.original.context,ref={id:'review-method',version}
 const item={...ref,scopeId:c.route.scopeId,entryId:c.route.entryId,goalId:'seed',acceptanceId:'acceptance',validation:'source',parameters:[],template:{title:'Review',objective:'Review the supplied file',criteria:[{id:'result',description:'Report findings',files:[],documents:[]}],nodes:[{id:'review',title:'Review',instruction:'Read the exact supplied input',workerId:'one',criterionIds:['result'],dependsOn:[]}]}}
 f.host.store.put('skill-version',stableDigest([ref.id,ref.version]),item)
 return item
}
it('discovers metadata and reads complete immutable versions without grants or model calls',()=>{
 const f=fixture(),first=seed(f),second=seed(f,2);second.template.objective='New method';f.host.store.put('skill-version',stableDigest([second.id,2]),second)
 const before=f.host.store.db.prepare('SELECT total_changes() AS n').get()!.n
 const view=f.host.skills.read(ref(first))
 expect(view.template.objective).toBe(first.template.objective)
 expect(view.inspection).toMatchObject({authorization:'fresh_request_required',providerVerification:'not_tested',grants:[],changesConfiguration:false,dependencies:[{nodeId:'review',state:'configured',workerId:'one',backendId:'codex',authorization:'not_granted'}]})
 expect(f.host.skills.list('team',f.original.context).map(s=>s.version)).toEqual([2,1])
 expect(f.host.store.db.prepare('SELECT total_changes() AS n').get()!.n).toBe(before)
 expect(f.model).not.toHaveBeenCalled();expect(f.deliver).not.toHaveBeenCalled()
})
it('reports revoked Worker and backend dependencies without disclosing inaccessible configuration',()=>{
 const f=fixture(),item=seed(f),scope=f.host.scopes.scope('team')
 const {routerId,revision,epoch,...input}=scope;input.workerIds=[]
 f.host.scopes.command({action:'scope.put',operationId:'revoke',expectedRevision:revision,scope:input})
 const view=f.host.skills.read(ref(item))
 expect(view.inspection.dependencies).toEqual([{nodeId:'review',state:'blocked',reason:'worker_unavailable',authorization:'not_granted',connections:[]}])
})
it('requires current entry visibility and never substitutes latest version',()=>{
 const f=fixture(),item=seed(f)
 expect(()=>f.host.skills.read({...ref(item),version:9})).toThrow('unavailable')
 expect(()=>f.host.skills.read({...ref(item),entryId:'other'})).toThrow()
 const entry=f.host.scopes.binding(item.entryId)
 f.host.scopes.command({action:'entry.bind',operationId:'disable',expectedRevision:entry.revision,scopeId:'team',sourceId:'local',accountNamespace:'local',nativeId:'topic',history:'group',active:false})
 // A read uses current source and entry checks, not a cached list result.
 expect(()=>f.host.skills.read(ref(item))).toThrow('unavailable')
 expect(entry.scopeId).toBe('team')
})

it('serves protected real HTTP/SQLite inspection without writes or external calls',async()=>{
 const f=fixture(),item=seed(f),server=await serve(f.host);servers.push(server)
 clearInterval((f.host as unknown as {timer:ReturnType<typeof setInterval>}).timer)
 const headers={Authorization:'Bearer '+readFileSync(server.tokenPath,'utf8').trim(),'Content-Type':'application/json'}
 const post=(extra:Record<string,string>={})=>fetch(server.url+'/router-skills/read',{method:'POST',headers:{...headers,...extra},body:JSON.stringify(ref(item))})
 expect((await fetch(server.url+'/router-skills/read',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(ref(item))})).status).toBe(401)
 expect((await post({Origin:'https://invalid.example'})).status).toBe(403)
 const before=f.host.store.db.prepare('SELECT total_changes() AS n').get()!.n
 const response=await post();expect(response.status).toBe(200);expect(await response.json()).toMatchObject({id:item.id,version:1,inspection:{grants:[],changesConfiguration:false}})
 expect(f.host.store.db.prepare('SELECT total_changes() AS n').get()!.n).toBe(before)
 expect(f.model).not.toHaveBeenCalled();expect(f.deliver).not.toHaveBeenCalled()
})
it('does not expose private entry methods to the operator fallback',()=>{
 const f=fixture(),item=seed(f),entry=f.host.scopes.binding(item.entryId)
 f.host.store.put('entry-binding',entry.id,{...entry,privateActor:JSON.stringify(['local','operator'])})
 expect(()=>f.host.skills.read(ref(item))).toThrow('unavailable')
 expect(f.host.skills.list('team')).toEqual([])
})

it('explains disabled selected connections without connecting or enabling them',()=>{
 const f=fixture(),item=seed(f)
 f.host.config.execution.workers![0]!.toolConnections=['missing']
 const view=f.host.skills.read(ref(item))
 expect(view.inspection.dependencies[0]!.connections).toEqual([{id:'missing',state:'blocked',reason:'connection_disabled_or_missing'}])
 expect(view.inspection.implicitMethodRequirements).toBe('not_inferred');expect(f.host.config.toolConnections.missing).toBeUndefined()
 expect(f.model).not.toHaveBeenCalled()
})
it.each(['paused','native_fallback','unmanaged_plugin'] as const)('explains %s without starting work',kind=>{
 const f=fixture(),item=seed(f),profile=f.host.config.execution.workers![0]!
 if(kind==='paused')profile.state='paused'
 else {profile.backend=kind==='native_fallback'?'codex':'plugin';if(kind==='native_fallback')delete f.host.config.backends.codex
  if(kind==='unmanaged_plugin'){
   // Scope permits this backend, but no verified managed package is installed.
   f.host.store.put('management-scope','team',{...f.host.scopes.scope('team'),backendIds:['codex','plugin']})
   f.host.config.backends.plugin={kind:'plugin',plugin:'missing',config:{},env:{},readPaths:[],writePaths:[]}
  }
 }
 const d=f.host.skills.read(ref(item)).inspection.dependencies[0]!
 if(kind==='paused')expect(d).toMatchObject({reason:'worker_paused'})
 if(kind==='unmanaged_plugin')expect(d).toMatchObject({reason:'backend_not_managed'})
 if(kind==='native_fallback')expect(d.state).toBe('configured') // reserved native Codex fallback
 expect(f.model).not.toHaveBeenCalled()
})
it('execution rechecks paused workers after a successful preview',()=>{
 const f=fixture(),item=seed(f)
 expect(f.host.skills.read(ref(item)).inspection.dependencies[0]!.state).toBe('configured')
 f.host.config.execution.workers![0]!.state='paused'
 expect(()=>f.host.skills.execute({id:item.id,version:item.version},f.original.context,'new-run','Continuously inspect')).toThrow('Worker is unavailable')
 expect(f.model).not.toHaveBeenCalled()
})

it.each(['unsupported','worker_excess','default_excess'] as const)('previews current backend resource admission: %s',kind=>{
 const f=fixture(),item=seed(f),profile=f.host.config.execution.workers![0]!
 f.host.config.backends.codex={kind:'codex',limits:kind==='unsupported'?{maxSteps:2}:{timeoutMs:1000}}
 if(kind==='worker_excess')profile.timeoutMs=2000
 if(kind==='default_excess')f.host.config.backends.codex.defaults={timeoutMs:2000}
 profile.toolConnections=['private-connection']
 const before=f.host.store.db.prepare('SELECT total_changes() AS n').get()!.n
 const d=f.host.skills.read(ref(item)).inspection.dependencies[0]!
 expect(d).toEqual({nodeId:'review',state:'blocked',reason:kind==='unsupported'?'backend_policy_unsupported':'backend_resource_limit',authorization:'not_granted',connections:[]})
 expect(f.host.store.db.prepare('SELECT total_changes() AS n').get()!.n).toBe(before)
 delete f.host.config.backends.codex.limits
 expect(f.host.skills.read(ref(item)).inspection.dependencies[0]!.state).toBe('configured')
 expect(f.model).not.toHaveBeenCalled();expect(f.deliver).not.toHaveBeenCalled()
})
