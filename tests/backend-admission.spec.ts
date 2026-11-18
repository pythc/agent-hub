import {afterEach,expect,it} from 'vitest'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createServer,type Server} from 'node:http'
import {configSchema} from '../src/config.ts'
import {boundedBackendOptions,backendAdmission,checkWorkerAdmission} from '../src/backend-admission.ts'
import {BackendRegistry} from '../src/backends/registry.ts'
import {Runtime} from '../src/runtime.ts'
import type {ModelRequest} from '../src/model.ts'
const roots:string[]=[],servers:Server[]=[],hosts:Runtime[]=[]
afterEach(async()=>{for(const h of hosts.splice(0))await h.close();for(const s of servers.splice(0)){s.closeAllConnections();await new Promise<void>(r=>s.close(()=>r()))}for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true})})
function config(extra:any={}){const root=mkdtempSync(join(tmpdir(),'o04-'));roots.push(root);return configSchema.parse({stateDir:join(root,'state'),work:{sandboxDriver:'disabled'},sources:[{id:'local',kind:'local',cwd:root,allowedActors:['operator']}],...extra})}
const api=(extra:any={})=>({kind:'openai-chat',baseUrl:'http://127.0.0.1:9',model:'same-model',...extra})
function memory(){const m=new Map<string,any>();return {get:<T>(k:string,id:string)=>m.get(k+id) as T|undefined,put:(k:string,id:string,v:any)=>{m.set(k+id,v)}}}
const request:ModelRequest={cwd:tmpdir(),instructions:'Local fixture',input:'test',schema:{}}
it('keeps defaults distinct from policy, rejects explicit excess, and leaves identity/options untouched',()=>{
 const c=config({backends:{api:api({maxSteps:50,limits:{maxSteps:2,maxToolCalls:3,maxOutputTokens:128,timeoutMs:1000}})}}),d=c.backends.api!
 expect(boundedBackendOptions('api',d,{},5000)).toMatchObject({maxSteps:2,maxToolCalls:3,maxOutputTokens:128,timeoutMs:1000})
 for(const o of [{maxSteps:3},{maxToolCalls:4},{maxOutputTokens:129},{timeoutMs:1001}])expect(()=>boundedBackendOptions('api',d,o)).toThrow('quota_exhausted')
 expect(boundedBackendOptions('api',d,{maxSteps:1})).toMatchObject({maxSteps:1})
 expect(d).toMatchObject({model:'same-model',maxSteps:50});expect(d.defaults).toBeUndefined()
})
it('fails closed for unsupported native/plugin resource policies; native defaults retain compatibility',()=>{
 const c=config({backends:{codex:{kind:'codex',limits:{maxSteps:2}},remote:{kind:'plugin',plugin:'missing',limits:{maxToolCalls:2}}}})
 expect(backendAdmission(c,'codex')).toMatchObject({managedEligible:false,unsupportedLimits:true,cost:'not_estimated'})
 expect(backendAdmission(c,'remote')).toMatchObject({managedEligible:false,continuation:'new_task_only',managedMissing:['managed','tools','resume','history','contextBudget']})
 expect(()=>checkWorkerAdmission(c,'remote')).toThrow('unsupported')
 expect(()=>boundedBackendOptions('codex',c.backends.codex!)).toThrow('unsupported')
 expect(boundedBackendOptions('codex',{kind:'codex'},{maxSteps:12})).toMatchObject({maxSteps:12})
})
it('rejects over-budget delegation before creating a task or any request receipt',async()=>{
 const c=config({backends:{api:api({limits:{maxSteps:2}})},execution:{management:{enabled:true},workers:[{id:'limited',backend:'api',maxSteps:3}]}})
 let calls=0;const h=new Runtime(c,{model:{async run(){calls++;throw Error('must not execute')}}});hosts.push(h)
 const before=h.store.tickets.list().length
 await expect(h.manager.call({action:'assign',id:'limited',text:'test',discussion:'test',revision:0,requestId:'blocked'})).rejects.toThrow('quota_exhausted')
 expect(h.store.tickets.list()).toHaveLength(before);expect(calls).toBe(0)
 expect(h.manager.list().connections.find(x=>x.id==='api')?.admission.limits).toEqual({maxSteps:2})
})
async function fixture(handler:(body:any,res:any)=>void){const bodies:any[]=[],s=createServer(async(req,res)=>{let raw='';for await(const v of req)raw+=v;const body=JSON.parse(raw);bodies.push(body);handler(body,res)});servers.push(s);await new Promise<void>(r=>s.listen(0,'127.0.0.1',r));return {url:'http://127.0.0.1:'+(s.address() as any).port,bodies}}
const toolResponse={choices:[{finish_reason:'tool_calls',message:{role:'assistant',content:null,tool_calls:[{id:'once',type:'function',function:{name:'read',arguments:'{}'}}]}}]}
it('enforces step and output request ceilings through the real loopback API transport',async()=>{
 const f=await fixture((_b,res)=>res.end(JSON.stringify(toolResponse))),c=config({backends:{api:api({baseUrl:f.url,limits:{maxSteps:1,maxOutputTokens:128,maxToolCalls:1}})},execution:{backend:'api'}})
 const registry=new BackendRegistry(c,memory());let tools=0
 await expect(registry.run({...request,tools:[{type:'function',name:'read',description:'fixture',inputSchema:{type:'object'}}],onTool:async()=>{tools++;return {success:true,contentItems:[]}}})).rejects.toThrow()
 expect(f.bodies).toHaveLength(1);expect(f.bodies[0]).toMatchObject({model:'same-model',max_completion_tokens:128});expect(tools).toBe(1)
})
it('rejects changed policy on existing sessions before a further provider request, with no backend fallback',async()=>{
 const f=await fixture((_b,res)=>res.end(JSON.stringify({choices:[{finish_reason:'stop',message:{role:'assistant',content:'{}'}}]}))),c=config({backends:{api:api({baseUrl:f.url})},execution:{backend:'api'}})
 const registry=new BackendRegistry(c,memory()),first=await registry.run(request)
 c.backends.api!.limits={maxSteps:1}
 await expect(registry.run({...request,threadId:first.threadId,options:{maxSteps:2}})).rejects.toThrow('quota_exhausted')
 expect(f.bodies).toHaveLength(1)
})
it('bounds a hanging real HTTP request and preserves explicit cancellation',async()=>{
 const f=await fixture(()=>{}),c=config({backends:{api:api({baseUrl:f.url,limits:{timeoutMs:1000}})},execution:{backend:'api'}}),registry=new BackendRegistry(c,memory())
 await expect(registry.run(request)).rejects.toThrow();expect(f.bodies).toHaveLength(1)
 const stop=new AbortController();stop.abort()
 await expect(registry.run({...request,signal:stop.signal})).rejects.toThrow();expect(f.bodies).toHaveLength(1)
})
