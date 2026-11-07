import {expect,it} from 'vitest'
import {mkdtempSync,rmSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {Runtime} from '../src/runtime.ts'
import {configSchema} from '../src/config.ts'
import {serve} from '../src/server.ts'
it.each([false,true])('protects decision records and draft probing on the real HTTP host (preview=%s)',async preview=>{
 const root=mkdtempSync(join(tmpdir(),'decision-http-')),config=configSchema.parse({stateDir:root,port:0,sources:[{id:'local',kind:'local',allowedActors:['operator'],cwd:root}]})
 const runtime=new Runtime(config,{model:{async run(){throw Error('No model invocation authorized in this fixture')}}}),host=await serve(runtime,{configurationPreview:preview})
 const headers={authorization:'Bearer '+readFileSync(host.tokenPath,'utf8').trim(),'content-type':'application/json'}
 try{
  expect((await fetch(host.url+'/decision/calls')).status).toBe(401)
  const payload=JSON.stringify({config:{mode:'off',provider:{kind:'jev',apiKeyEnv:'ROPPO_ABSENT_TEST_KEY'}},text:'Do not stop'})
  expect((await fetch(host.url+'/decision/probe',{method:'POST',headers:{'content-type':'application/json'},body:payload})).status).toBe(401)
  expect((await fetch(host.url+'/decision/probe',{method:'POST',headers:{...headers,origin:'https://untrusted.invalid'},body:payload})).status).toBe(403)
  const response=await fetch(host.url+'/decision/probe',{method:'POST',headers,body:payload})
  expect(response.status).toBe(preview?403:200)
  if(!preview)expect(await response.json()).toMatchObject({status:'unavailable',code:'missing_credentials',purpose:'probe'})
  const records=await fetch(host.url+'/decision/calls',{headers}).then(r=>r.json()) as unknown[]
  expect(records).toHaveLength(preview?0:1);expect(runtime.settings.current().revision).toBe(0);expect(runtime.config.decision.mode).toBe('off');expect(runtime.store.tickets.list()).toHaveLength(0)
 }finally{host.server.closeAllConnections();await new Promise<void>(r=>host.server.close(()=>r()));await host.closeRuntime();rmSync(root,{recursive:true,force:true})}
})
