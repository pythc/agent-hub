import {afterEach,it,expect} from 'vitest'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {Store} from '../src/store.ts'
import {ApiUsage,retentionDay,interfacePath,apiUsagePage} from '../src/api-usage.ts'
const roots:string[]=[],stores:Store[]=[]
afterEach(()=>{for(const s of stores.splice(0))s.close();for(const r of roots.splice(0))rmSync(r,{recursive:true,force:true})})
it.each([
 ['2026-04-30T16:00:00Z','2026-03-01'],
 ['2026-04-30T15:59:59Z','2026-02-28'],
 ['2024-04-30T00:00:00Z','2024-02-29'],
 ['2026-01-31T00:00:00Z','2025-11-30'],
])('uses two calendar months at Beijing month boundaries %s',(date,expected)=>expect(retentionDay(Date.parse(date))).toBe(expected))
it('persists separate interface and source totals and prunes only expired telemetry',()=>{
 const root=mkdtempSync(join(tmpdir(),'api-usage-'));roots.push(root);const store=new Store(join(root,'state.sqlite'));stores.push(store)
 let now=Date.parse('2026-09-16T01:00:00Z');let usage=new ApiUsage(store,()=>now)
 const sample={method:'GET',path:'im/v1/messages/om_private?token=secret',measurement:'cli-operation' as const,ok:true,durationMs:40}
 usage.record('f',sample);usage.record('f',{...sample,ok:false,durationMs:60});usage.record('second',sample)
 store.put('api-usage','expired',{day:'2026-09-15'});store.put('trigger','keep',{text:'original'})
 now=Date.parse('2026-11-16T01:00:00Z');usage=new ApiUsage(store,()=>now)
 const result=usage.snapshot();expect(result.interfaces).toHaveLength(2)
 expect(result.interfaces.find(r=>r.source==='f')).toMatchObject({count:2,successes:1,failures:1,averageMs:50,maxMs:60})
 expect(JSON.stringify(result)).not.toMatch(/om_private|token=|secret/);expect(store.get('api-usage','expired')).toBeUndefined();expect(store.get('trigger','keep')).toEqual({text:'original'})
 now=Date.parse('2026-11-17T01:00:00Z');expect(usage.snapshot().interfaces).toEqual([])
})
it('normalizes resource IDs and escapes all rendered source labels',()=>{
 expect(interfacePath('im/v1/messages/om_x/resources/img_secret?type=image')).toBe('/open-apis/im/v1/messages/:message_id/resources/:file_key')
 expect(interfacePath('unknown/secret?secret=yes')).toBe('other')
 const root=mkdtempSync(join(tmpdir(),'api-usage-'));roots.push(root);const store=new Store(join(root,'state.sqlite'));stores.push(store);const usage=new ApiUsage(store)
 usage.record('<script>alert(1)</script>',{method:'GET',path:'bot/v3/info',measurement:'http-request',ok:true,durationMs:1})
 const html=apiUsagePage(usage.snapshot());expect(html).not.toContain('<script>');expect(html).toContain('&lt;script&gt;');expect(html).toContain('不等同于飞书配额账单')
})
it('requires operator authentication for both statistics formats on the real host',async()=>{
 const {Runtime}=await import('../src/runtime.ts'),{configSchema}=await import('../src/config.ts'),{serve}=await import('../src/server.ts'),{readFileSync}=await import('node:fs')
 const root=mkdtempSync(join(tmpdir(),'api-usage-http-'));roots.push(root)
 const config=configSchema.parse({stateDir:root,port:0,sources:[{id:'local',kind:'local',allowedActors:['operator'],cwd:root}]})
 const runtime=new Runtime(config,{model:{async run(){throw Error('No model use in API statistics test')}}}),host=await serve(runtime)
 try{
  const headers={authorization:'Bearer '+readFileSync(host.tokenPath,'utf8').trim()}
  runtime.apiUsage.record('f',{method:'GET',path:'im/v1/messages',measurement:'cli-operation',ok:true,durationMs:2})
  for(const path of ['/api-usage','/api-usage/view']){
   expect((await fetch(host.url+path)).status).toBe(401)
   expect((await fetch(host.url+path,{headers:{authorization:'Bearer invalid-token'}})).status).toBe(401)
   const response=await fetch(host.url+path,{headers});expect(response.status).toBe(200)
   if(path.endsWith('/view'))expect(await response.text()).toContain('飞书接口统计')
   else expect((await response.json() as any).interfaces[0]).toMatchObject({source:'f',count:1})
  }
  expect(runtime.store.tickets.list()).toHaveLength(0)
 }finally{host.server.closeAllConnections();await new Promise<void>(r=>host.server.close(()=>r()));await host.closeRuntime()}
})
