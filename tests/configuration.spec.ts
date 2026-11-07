import {mkdtempSync,rmSync,readFileSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {afterEach,expect,it} from 'vitest'
import {configSchema} from '../src/config.ts'
import {Runtime} from '../src/runtime.ts'
import {serve} from '../src/server.ts'
import {Script} from 'node:vm'

const roots:string[]=[],closers:(()=>Promise<void>)[]=[]
afterEach(async()=>{for(const close of closers.splice(0))await close();for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true})})
async function fixture(root=mkdtempSync(join(tmpdir(),'agenthub-config-')),preview=false){
 if(!roots.includes(root))roots.push(root)
 const config=configSchema.parse({stateDir:join(root,'state'),port:0,work:{sandboxDriver:'disabled'},backends:{responses:{kind:'openai-responses',baseUrl:'http://127.0.0.1:9/v1',model:'fixture',apiKeyEnv:'AGENTHUB_CONFIGURATION_TEST_KEY'}},execution:{backend:'responses'},sources:[{id:'local',kind:'local',cwd:root,allowedActors:['operator']}]})
 const runtime=new Runtime(config,{model:{async run(){throw Error('Configuration tests never execute work')}}}),host=await serve(runtime,{configurationPreview:preview})
 const headers={'content-type':'application/json',authorization:'Bearer '+readFileSync(host.tokenPath,'utf8').trim()}
 let closed=false
 const close=async()=>{if(closed)return;closed=true;await new Promise<void>(r=>host.server.close(()=>r()));await runtime.close()};closers.push(close)
 const post=(revision:number,patch:unknown)=>fetch(host.url+'/settings',{method:'POST',headers,body:JSON.stringify({revision,patch})})
 return {root,runtime,host,headers,close,post}
}
it('serves public preview probes without operator authentication and retains private API authorization',async()=>{
 const f=await fixture()
 for(const path of ['/', '/configure', '/configure/', '/configure?preview=1', '/health']){
  const get=await fetch(f.host.url+path),head=await fetch(f.host.url+path,{method:'HEAD'})
  expect(get.status).toBe(200);expect(head.status).toBe(200)
  expect(head.headers.get('content-type')).toBe(get.headers.get('content-type'))
  expect(head.headers.get('content-security-policy')).toBe(get.headers.get('content-security-policy'))
  expect(await head.text()).toBe('');expect(await get.text()).not.toBe('')
 }
 for(const path of ['/configuration','/entry-workspace','/settings'])expect((await fetch(f.host.url+path,{method:'HEAD'})).status).toBe(401)
 expect(f.runtime.store.tickets.list()).toHaveLength(0)
})
it('returns an authenticated configuration inventory without testing providers or exposing environment secrets',async()=>{
 const previous=process.env.AGENTHUB_CONFIGURATION_TEST_KEY;process.env.AGENTHUB_CONFIGURATION_TEST_KEY='synthetic-do-not-expose-provider-key'
 try{
  const f=await fixture();expect((await fetch(f.host.url+'/configuration')).status).toBe(401)
  const page=await fetch(f.host.url+'/configure');expect(page.status).toBe(200);expect(page.headers.get('content-type')).toContain('text/html');expect(page.headers.get('content-security-policy')).toContain("connect-src 'self'")
  const scripts=[...(await page.text()).matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match=>match[1]!)
  expect(scripts.length).toBeGreaterThan(0)
  for(const script of scripts)expect(()=>new Script(script)).not.toThrow()
  const response=await fetch(f.host.url+'/configuration',{headers:f.headers}),data=await response.json()
  expect(response.status).toBe(200);expect(data.editableKeys).toContain('execution');expect(data.editableKeys).toContain('backends')
  expect(data.restartRequiredKeys).toContain('sources.deployment');expect(data.sourceEditableKeys).toContain('allowedActors')
  expect(data.backendCatalog).toEqual(expect.arrayContaining([expect.objectContaining({id:'responses',kind:'openai-responses',remoteVerified:false}),expect.objectContaining({id:'codex',nativeTakeover:true})]))
  expect(JSON.stringify(data)).not.toContain('synthetic-do-not-expose-provider-key');expect(data.current.config.backends.responses.apiKeyEnv).toBe('AGENTHUB_CONFIGURATION_TEST_KEY')
 }finally{if(previous===undefined)delete process.env.AGENTHUB_CONFIGURATION_TEST_KEY;else process.env.AGENTHUB_CONFIGURATION_TEST_KEY=previous}
})
it('persists real settings, preserves unknown nested values and returns a conflict without overwriting the newer revision',async()=>{
 const f=await fixture(),initial=(await(await fetch(f.host.url+'/configuration',{headers:f.headers})).json()).current
 const sources=initial.config.sources.map((s:any)=>({...s,allowedActors:[...s.allowedActors,'confirmed-user']}))
 const saved=await f.post(initial.revision,{concurrency:3,sources,prompts:{...initial.config.prompts,shared:'Keep this team instruction',skills:{'office-style':'Preserve original files'}}})
 expect(saved.status).toBe(200);expect((await saved.json()).revision).toBe(1)
 const stale=await f.post(initial.revision,{concurrency:4});expect(stale.status).toBe(409);expect(await stale.json()).toMatchObject({code:'settings_conflict',currentRevision:1})
 await f.close();const restarted=await fixture(f.root),current=(await(await fetch(restarted.host.url+'/configuration',{headers:restarted.headers})).json()).current
 expect(current).toMatchObject({revision:1,config:{concurrency:3,prompts:{shared:'Keep this team instruction',skills:{'office-style':'Preserve original files'}}}})
 expect(current.config.sources[0].allowedActors).toEqual(['operator','confirmed-user'])
 const restored=await restarted.post(1,{concurrency:initial.config.concurrency,sources:initial.config.sources,prompts:initial.config.prompts})
 expect(restored.status).toBe(200);expect((await restored.json()).revision).toBe(2)
})
it('rejects invalid settings and deployment edits atomically with actionable error codes',async()=>{
 const f=await fixture(),source=f.runtime.config.sources[0]!
 const invalid=await f.post(0,{concurrency:999});expect(invalid.status).toBe(400);expect(await invalid.json()).toMatchObject({code:'validation_error',issues:[{path:['concurrency']}]})
 const deployment=await f.post(0,{sources:[{...source,cwd:'/different/startup/workspace'}]});expect(deployment.status).toBe(400);expect(await deployment.json()).toMatchObject({code:'restart_required'})
 expect(f.runtime.settings.current().revision).toBe(0);expect(f.runtime.config.sources[0]!.cwd).toBe(source.cwd)
})
it('lets the isolated preview save settings while rejecting task execution and operational actions',async()=>{
 const f=await fixture(undefined,true),snapshot=await(await fetch(f.host.url+'/configuration',{headers:f.headers})).json()
 expect(snapshot.preview).toBe(true)
 const sent=await fetch(f.host.url+'/send',{method:'POST',headers:f.headers,body:JSON.stringify({source:'local',event:{id:'preview-request',thread:'preview',text:'Do not execute'}})})
 expect(sent.status).toBe(403);expect(await sent.json()).toMatchObject({code:'preview_restricted'})
 const action=await fetch(f.host.url+'/action',{method:'POST',headers:f.headers,body:JSON.stringify({action:'resume'})})
 expect(action.status).toBe(403);expect(f.runtime.store.list('trigger')).toEqual([])
 expect((await f.post(0,{concurrency:3})).status).toBe(200)
})
