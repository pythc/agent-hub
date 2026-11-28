import {afterEach,expect,it,vi} from 'vitest'
import {mkdtempSync,readFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createServer} from 'node:http'
import {randomUUID} from 'node:crypto'
import {configSchema} from '../src/config.ts'
import {Runtime} from '../src/runtime.ts'
import {serve} from '../src/server.ts'
import {TerminalClient} from '../src/terminal/client.ts'
import {accountSetup,configureConnection,SetupCancelled,type SetupUI} from '../src/terminal/setup.ts'

const cleanup:(()=>Promise<void>)[]=[]
afterEach(async()=>{for(const close of cleanup.splice(0).reverse())await close();vi.unstubAllEnvs()})
async function fixture(invalidUsername?:string){
 const root=mkdtempSync(join(tmpdir(),'roppo-terminal-setup-'))
 cleanup.push(async()=>rmSync(root,{recursive:true,force:true}))
 vi.stubEnv('ROPPO_CLI_HOME',join(root,'cli'))
 const config=configSchema.parse({port:0,stateDir:join(root,'state'),codex:'/missing/codex',work:{sandboxDriver:'disabled',network:false},sources:[{id:'local',kind:'local',cwd:root,allowedActors:['operator']}]})
 const host=await serve(new Runtime(config))
 cleanup.push(async()=>{host.server.closeAllConnections();await new Promise<void>(r=>host.server.close(()=>r()));await host.closeRuntime()})
 const client=new TerminalClient(host.url),notes:string[]=[]
 const answers=['test-user','Test User','synthetic-password-123','synthetic-password-123','']
 if(invalidUsername)answers.unshift(invalidUsername)
 await accountSetup(client,{text:async()=>answers.shift()!,choose:async()=>{throw Error('Unexpected retry')},note:m=>notes.push(m)})
 return {root,host,client,notes}
}
async function provider(){
 let fail=false;const requests:{path:string;authorization?:string}[]=[]
 const server=createServer(async(req,res)=>{
  requests.push({path:req.url!,authorization:req.headers.authorization})
  for await(const _ of req){}
  res.writeHead(fail?401:200,{'content-type':'application/json'})
  res.end(JSON.stringify(fail?{error:{message:'Rejected'}}:req.url==='/v1/models'?{data:[{id:'fixture-model'}]}:{choices:[{message:{content:'{"ok":true}'}}]}))
 })
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r))
 cleanup.push(async()=>{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()))})
 return {url:'http://127.0.0.1:'+(server.address() as {port:number}).port+'/v1',requests,reject:()=>{fail=true}}
}
it('onboards a new local account and checked model, enables memory, and manages Workers through paired CLI access',async()=>{
 const f=await fixture('cc'),api=await provider()
 expect(f.notes[1]).toContain('3–40 characters')
 expect(f.client.signedIn).toBe(true);expect(f.notes.join('\n')).toContain('recovery code')
 const choices=[0,6,1,0,0],answers=[api.url,'synthetic-api-key','My test connection']
 const dialog:SetupUI={choose:async()=>choices.shift()!,text:async(_m,o)=>answers.shift()??o?.initial??'',note:m=>f.notes.push(m)}
 await configureConnection(f.client,dialog)
 expect(api.requests).toContainEqual({path:'/v1/chat/completions',authorization:'Bearer synthetic-api-key'})
 const host=f.host.runtime
 expect(host.config.execution.router).toMatchObject({mode:'host'})
 expect(host.config.execution.workers).toHaveLength(1)
 expect(host.config.execution.management?.enabled).toBe(true)
 expect(host.scopes.enabled()).toBe(true)
 expect(host.chat.readiness().ready).toBe(true)
 const info=await f.client.request<any>('/api/terminal/setup')
 expect(info.ready).toBe(true);expect(JSON.stringify(info)).not.toContain('synthetic-api-key')
 const space=await f.client.request<any>('/api/chat/space',{})
 expect(space.conversation.id).toBeTruthy()
 const compactPath='/api/chat/conversations/'+space.conversation.id+'/compact'
 expect(await f.client.request(compactPath,{action:'compact'})).toMatchObject({status:'unchanged'})
 await f.client.request(compactPath,{action:'settings',settings:{automatic:true,threshold:0.7}})
 expect(await f.client.request(compactPath)).toMatchObject({settings:{automatic:true,threshold:0.7}})
 await expect(f.client.request(compactPath,{action:'settings',settings:{automatic:true,threshold:1.2}})).rejects.toThrow()
 const list=()=>f.client.request<any>('/api/terminal/workers')
 const change=async(body:object)=>f.client.request<any>('/api/terminal/workers',{...body,revision:(await list()).revision,requestId:randomUUID()})
 const backend=host.config.execution.router!.backend
 await change({action:'create',profile:{id:'helper',label:'Helper',backend}})
 await change({action:'clone',from:'helper',id:'copy',patch:{label:'Copy'}})
 await change({action:'pause',id:'copy'})
 expect((await list()).workers.find((w:any)=>w.id==='copy').state).toBe('paused')
 await change({action:'resume',id:'copy'})
 expect((await list()).workers.find((w:any)=>w.id==='copy').state).toBe('enabled')
 await change({action:'destroy',id:'copy',cancelRunning:false})
 expect((await list()).workers.some((w:any)=>w.id==='copy')).toBe(false)
 const settings=JSON.stringify(f.host.runtime.config)
 expect(settings).not.toContain('synthetic-api-key')
 const startup=f.host.runtime.config
 await f.host.closeRuntime()
 const restarted=new Runtime(startup)
 try{expect(restarted.chat.readiness().ready).toBe(true);expect(restarted.config.execution.workers?.some(w=>w.id==='helper')).toBe(true);expect(restarted.scopes.enabled()).toBe(true)}finally{await restarted.close()}
},30_000)
it('requires a successful check and preserves existing Worker configuration when changing the Router',async()=>{
 const f=await fixture(),api=await provider(),request=(body:unknown)=>f.client.request<any>('/api/terminal/setup',body)
 const initial=await request({action:'plan',value:{revision:0,connection:{kind:'api',protocol:'openai-chat',baseUrl:api.url,apiKey:'synthetic-api-key',model:'fixture-model'}}})
 await expect(request({action:'apply',id:initial.id})).rejects.toThrow('Test this connection')
 await request({action:'check',id:initial.id});await request({action:'apply',id:initial.id})
 const workers=structuredClone(f.host.runtime.config.execution.workers)
 const info=await f.client.request<any>('/api/terminal/setup')
 const second=await request({action:'plan',value:{revision:info.revision,connection:{kind:'api',protocol:'openai-chat',baseUrl:api.url,model:'other-model'},target:'router'}})
 await request({action:'check',id:second.id});await request({action:'apply',id:second.id})
 expect(f.host.runtime.config.execution.workers).toEqual(workers)
 const revision=(await f.client.request<any>('/api/terminal/setup')).revision
 const execution=structuredClone(f.host.runtime.config.execution)
 const library=await request({action:'plan',value:{revision,connection:{kind:'api',protocol:'openai-chat',baseUrl:api.url,model:'library-model'},target:'library'}})
 await request({action:'check',id:library.id});await request({action:'apply',id:library.id})
 expect(f.host.runtime.config.execution).toEqual(execution)
 api.reject()
 const bad=await request({action:'plan',value:{revision:(await f.client.request<any>('/api/terminal/setup')).revision,connection:{kind:'api',protocol:'openai-chat',baseUrl:api.url,model:'bad'}}})
 expect((await request({action:'check',id:bad.id})).ok).toBe(false)
 await expect(request({action:'apply',id:bad.id})).rejects.toThrow('Test this connection')
},30_000)
it('keeps account authentication required for setup and does not expand the CLI token to arbitrary operator routes',async()=>{
 const f=await fixture(),token=readFileSync(f.host.tokenPath,'utf8').trim()
 expect((await fetch(f.host.url+'/api/terminal/setup',{headers:{authorization:'Bearer '+token}})).status).toBe(401)
 await expect(f.client.request('/configuration')).rejects.toThrow()
 const before=f.host.runtime.settings.current().revision
 await expect(configureConnection(f.client,{choose:async()=>3,text:async()=>'',note:()=>{}})).rejects.toBeInstanceOf(SetupCancelled)
 expect(f.host.runtime.settings.current().revision).toBe(before)
})
it('walks the existing OAuth flow and requires background-use consent before saving',async()=>{
 const calls:any[]=[],choices=[1,0,0,0,0,0]
 const client={request:async(_path:string,body:any)=>{
  calls.push(body)
  if(!body)return {initial:true,revision:0,accounts:[],owners:{defaultOwner:{source:'local',actor:'operator'}},connections:[]}
  if(body.action==='oauth.start')return {account:'account-fixture',attempt:'attempt-fixture',url:'https://auth.openai.com/authorize'}
  if(body.action==='oauth.status')return {status:'completed'}
  if(body.action==='oauth.models')return {data:[{id:'fixture-model'}]}
  if(body.action==='plan')return {id:'plan',connection:{label:'ChatGPT',model:'fixture-model'}}
  if(body.action==='check')return {ok:true,remoteVerified:true}
  return {}
 }} as unknown as TerminalClient
 await configureConnection(client,{choose:async()=>choices.shift()!,text:async()=>'',note:()=>{}})
 expect(calls.find(c=>c?.action==='plan').value.connection).toMatchObject({kind:'subscription',account:'account-fixture',backgroundAuthorized:true,owner:{source:'local',actor:'operator'}})
 expect(calls.at(-1)).toEqual({action:'apply',id:'plan'})
 const canceled=[1,0,0,1];calls.length=0
 await expect(configureConnection(client,{choose:async()=>canceled.shift()!,text:async()=>'',note:()=>{}})).rejects.toBeInstanceOf(SetupCancelled)
 expect(calls.some(c=>c?.action==='plan')).toBe(false)
})
