import {afterEach,expect,it,vi} from 'vitest'
import {mkdtempSync,rmSync,readFileSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {Runtime} from '../src/runtime.ts'
import {configSchema} from '../src/config.ts'
import {LocalDiagnostics} from '../src/local-diagnostics.ts'
import {serve} from '../src/server.ts'
const roots:string[]=[],hosts:Runtime[]=[]
afterEach(async()=>{for(const host of hosts.splice(0))await host.close();for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true})})
function host(){const root=mkdtempSync(join(tmpdir(),'local-diagnostics-'));roots.push(root);const h=new Runtime(configSchema.parse({stateDir:join(root,'state'),port:0,work:{sandboxDriver:'disabled',autoRecover:false},sources:[{id:'local',kind:'local',cwd:root,allowedActors:['operator']}]}),{model:{async run(){throw Error('No model calls')}}});hosts.push(h);return h}
it('GET is read-only and disabled is not a pass',async()=>{
 const h=host(),probe=vi.fn(),service=new LocalDiagnostics(()=>h,probe)
 const before=JSON.stringify(h.store.db.prepare('SELECT * FROM records').all())
 expect(service.snapshot()).toMatchObject({result:null,browser:{state:'unsupported'}});expect(probe).not.toHaveBeenCalled()
 expect(await service.check({revision:0})).toMatchObject({busy:false,result:{state:'disabled',code:'sandbox_disabled'}})
 expect(probe).not.toHaveBeenCalled();expect(JSON.stringify(h.store.db.prepare('SELECT * FROM records').all())).toBe(before)
})
it('rechecks authority and revision, rejects concurrent checks, and discards late evidence',async()=>{
 const h=host();h.config.work.sandboxDriver='bubblewrap'
 let release!:(value:any)=>void
 const probe=vi.fn(()=>new Promise<any>(resolve=>{release=resolve})),service=new LocalDiagnostics(()=>h,probe),authorize=vi.fn()
 const pending=service.check({revision:0},authorize)
 expect(service.snapshot().busy).toBe(true)
 await expect(service.check({revision:0})).rejects.toThrow('diagnostic_busy')
 h.updateSettings(0,{work:{...h.config.work,network:false}})
 release({verified:true});await expect(pending).rejects.toThrow('diagnostic_stale')
 expect(authorize).toHaveBeenCalledTimes(2);expect(service.snapshot()).toMatchObject({result:null,busy:false})
 await expect(service.check({revision:0})).rejects.toThrow('settings_conflict')
})
it('host replacement and lost operator cannot publish results',async()=>{
 let h=host();h.config.work.sandboxDriver='bubblewrap'
 let release!:(value:any)=>void
 const service=new LocalDiagnostics(()=>h,()=>new Promise<any>(resolve=>{release=resolve}))
 const pending=service.check({revision:0});h=host();release({verified:true})
 await expect(pending).rejects.toThrow('diagnostic_stale');expect(service.snapshot().result).toBeNull()
 h.config.work.sandboxDriver='bubblewrap';let allowed=true
 const second=service.check({revision:0},()=>{if(!allowed)throw Error('ended')});allowed=false;release({verified:true})
 await expect(second).rejects.toThrow('ended');expect(service.snapshot().result).toBeNull()
})
it('returns only safe error codes, retries, and expires evidence on settings change',async()=>{
 const h=host();h.config.work.sandboxDriver='bubblewrap'
 const probe=vi.fn().mockRejectedValueOnce(Error('SECRET path token stderr')).mockResolvedValue({verified:true})
 const service=new LocalDiagnostics(()=>h,probe)
 const failed=await service.check({revision:0});expect(failed.result?.state).toBe('failed');expect(JSON.stringify(failed)).not.toMatch(/SECRET|stderr/)
 expect((await service.check({revision:0})).result?.state).toBe('passed')
 expect(probe).toHaveBeenLastCalledWith('bubblewrap',h.config.codex)
 h.updateSettings(0,{work:{...h.config.work,network:false}});expect(service.snapshot().result).toBeNull()
})
it('protects HTTP reads and probes with operator and same-origin checks',async()=>{
 const h=host(),http=await serve(h),base=`http://127.0.0.1:${(http.server.address() as any).port}`
 const headers={authorization:'Bearer '+readFileSync(http.tokenPath,'utf8').trim(),'content-type':'application/json'}
 try{
 expect((await fetch(base+'/api/local-diagnostics')).status).toBe(401)
 expect((await fetch(base+'/api/local-diagnostics',{headers})).status).toBe(200)
 expect((await fetch(base+'/api/local-diagnostics/probe',{method:'POST',headers:{...headers,origin:'https://untrusted.invalid'},body:JSON.stringify({revision:0})})).status).toBe(403)
 const response=await fetch(base+'/api/local-diagnostics/probe',{method:'POST',headers,body:JSON.stringify({revision:0})})
 expect(response.status).toBe(200);expect(await response.json()).toMatchObject({result:{state:'disabled'},busy:false})
 }finally{await new Promise<void>(resolve=>http.server.close(()=>resolve()))}
})

it('rejects query selectors on both local-only endpoints before invoking diagnostics',async()=>{
 const h=host(),http=await serve(h),base=`http://127.0.0.1:${(http.server.address() as any).port}`
 const headers={authorization:'Bearer '+readFileSync(http.tokenPath,'utf8').trim(),'content-type':'application/json'}
 const check=vi.spyOn(LocalDiagnostics.prototype,'check'),snapshot=vi.spyOn(LocalDiagnostics.prototype,'snapshot')
 try{
  for(const query of ['workspace=other','source=other','unknown=anything'])for(const probe of [false,true]){
   const response=await fetch(base+'/api/local-diagnostics'+(probe?'/probe':'')+'?'+query,{headers,...(probe?{method:'POST',body:JSON.stringify({revision:0})}:{})})
   expect(response.status).toBe(400);expect(await response.json()).toEqual({code:'local_diagnostics_query_invalid'})
  }
  expect(check).not.toHaveBeenCalled();expect(snapshot).not.toHaveBeenCalled()
 }finally{check.mockRestore();snapshot.mockRestore();await new Promise<void>(resolve=>http.server.close(()=>resolve()))}
})
