import {mkdtempSync,rmSync,readFileSync,existsSync,statSync,symlinkSync,mkdirSync,appendFileSync,writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {createServer} from 'node:http'
import {afterEach,it,expect} from 'vitest'
import {Runtime} from '../src/runtime.ts'
import {configSchema,type Config} from '../src/config.ts'
import {serve} from '../src/server.ts'
import {managedFiles,prepareManagedConfig,prepareManagedFiles,managedConnections} from '../src/managed-config.ts'
import {backupState,verifyBackup,restoreState} from '../src/backup.ts'
import {Store} from '../src/store.ts'
import {Setup} from '../src/setup.ts'

const cleanup:(()=>Promise<void>)[]=[],roots:string[]=[],envKeys:string[]=[]
afterEach(async()=>{for(const close of cleanup.splice(0).reverse())await close();for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});for(const key of envKeys.splice(0))delete process.env[key]})
async function fixture(options:{preview?:boolean;failRestart?:boolean}={}){
 const root=mkdtempSync(join(tmpdir(),'agenthub-first-run-'));roots.push(root)
 const config=configSchema.parse({stateDir:join(root,'state'),port:0,codex:'/missing/codex',work:{sandboxDriver:'disabled',network:false},sources:[{id:'local',kind:'local',cwd:root,allowedActors:['operator']}]})
 let failures=options.failRestart?1:0
 const createRuntime=(cfg:Config)=>{if(failures-->0)throw Error('Injected restart failure');return new Runtime(cfg)}
 const runtime=new Runtime(config),host=await serve(runtime,{configurationPreview:options.preview,createRuntime})
 cleanup.push(async()=>{await new Promise<void>(r=>host.server.close(()=>r()));await host.closeRuntime()})
 const token=readFileSync(host.tokenPath,'utf8').trim(),headers={authorization:'Bearer '+token,'content-type':'application/json'}
 const post=async(path:string,value:unknown)=>{const response=await fetch(host.url+path,{method:'POST',headers,body:JSON.stringify(value)});return {status:response.status,body:await response.json()}}
 const get=async(path:string,auth=true)=>{const response=await fetch(host.url+path,{headers:auth?headers:{}});return {status:response.status,body:await response.json()}}
 return {root,config,runtime,host,headers,post,get,token,failNextRestart:()=>{failures=1}}
}
async function provider(response?:{status:number;body:unknown}){
 const requests:{authorization?:string;key?:string;body:any}[]=[]
 const server=createServer(async(req,res)=>{
  const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=JSON.parse(Buffer.concat(chunks).toString()),all=JSON.stringify(body)
  requests.push({authorization:req.headers.authorization,key:req.headers['x-api-key'] as string|undefined,body})
  if(response){res.writeHead(response.status,{'content-type':'application/json'});res.end(JSON.stringify(response.body));return}
  if(req.headers.authorization!=='Bearer synthetic-onboarding-key'&&req.headers['x-api-key']!=='synthetic-onboarding-key'){res.writeHead(401);res.end('{}');return}
  const answer=all.includes('targetTicketId')?{action:'accept',title:'First request',scope:'Say hello',reason:'Explicit local request',rules:[],ruleAssessments:[],targetTicketId:null}:all.includes('handbacks')?{state:'ready',summary:'Hello',reply:'Hello from your assistant.',question:null,askedBy:null,handbacks:[]}:{ok:true}
  const text=JSON.stringify(answer),value=req.url==='/v1/responses'?{status:'completed',output:[{type:'message',content:[{type:'output_text',text}]}]}:req.url==='/v1/messages'?{stop_reason:'end_turn',content:[{type:'text',text}]}:{choices:[{message:{content:text}}]}
  res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(value))
 });await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));cleanup.push(async()=>{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()))})
 return {url:'http://127.0.0.1:'+(server.address() as any).port+'/v1',requests}
}
it('creates a checked CLI profile in the library without changing component assignments',async()=>{
 const f=await fixture(),binary=join(f.root,'library-cli'),log=join(f.root,'cli-args.jsonl')
 writeFileSync(binary,'#!'+process.execPath+'\n'+`require('node:fs').appendFileSync(${JSON.stringify(log)},JSON.stringify(process.argv.slice(2))+'\\n');console.log('ready')`,{mode:0o700})
 const original=structuredClone(f.runtime.config.execution)
 const plan=await f.post('/entry-setup/model/plan',{revision:0,select:false,name:'Work profile',connection:{kind:'codex',command:binary,args:['--profile','work'],model:'chosen-model'}})
 expect(plan.status).toBe(200)
 expect((await f.post('/entry-setup/model/check',{id:plan.body.id})).body).toMatchObject({ok:true,remoteVerified:false})
 expect(readFileSync(log,'utf8').trim().split('\n').map(s=>JSON.parse(s))).toEqual([['--profile','work','--version'],['--profile','work','login','status']])
 const applied=await f.post('/entry-setup/model/apply',{id:plan.body.id})
 expect(applied.status).toBe(200);expect(f.host.runtime.config.execution).toEqual(original)
 expect(f.host.runtime.config.backends[applied.body.connection.id]).toMatchObject({kind:'codex',command:binary,args:['--profile','work'],model:'chosen-model'})
 expect((await f.get('/configuration')).body.connectionChecks[applied.body.connection.id]).toMatchObject({ok:true,remoteVerified:false})
})
it('retains test records across display renames but invalidates model and credential changes',async()=>{
 const api=await provider(),f=await fixture(),key='LIBRARY_TEST_CREDENTIAL';envKeys.push(key);process.env[key]='synthetic-onboarding-key'
 f.runtime.updateSettings(0,{backends:{library:{kind:'openai-chat',baseUrl:api.url,model:'fixture',apiKeyEnv:key}}})
 expect((await f.post('/model-connections/check',{id:'library',revision:1})).body).toMatchObject({ok:true,remoteVerified:true})
 const snap=await f.get('/configuration');expect(snap.body.connectionChecks.library).toMatchObject({ok:true,remoteVerified:true});expect(JSON.stringify(snap.body.connectionChecks)).not.toContain('synthetic-onboarding-key')
 f.runtime.updateSettings(1,{backends:{library:{...f.runtime.config.backends.library!,label:'Renamed'}}})
 expect((await f.get('/configuration')).body.connectionChecks.library.ok).toBe(true)
 process.env[key]='rotated-key';expect((await f.get('/configuration')).body.connectionChecks.library).toBeUndefined()
 expect((await f.post('/model-connections/check',{id:'library',revision:2})).body).toMatchObject({ok:false,remoteVerified:false,checks:[{code:'api_key_rejected'}]})
 f.runtime.updateSettings(2,{backends:{library:{...f.runtime.config.backends.library!,model:'another'}}})
 expect((await f.get('/configuration')).body.connectionChecks.library).toBeUndefined()
 expect((await f.post('/model-connections/check',{id:'library',revision:1})).status).toBe(409)
})
it('replaces a tested API credential without changing the connection ID or component selections',async()=>{
 const api=await provider(),f=await fixture();f.runtime.updateSettings(0,{backends:{library:{kind:'openai-chat',baseUrl:api.url,model:'fixture',label:'Saved API'}},execution:{...f.runtime.config.execution,router:{backend:'library'}}})
 f.runtime.store.db.prepare("DELETE FROM records WHERE kind='settings-backends' AND id='managed'").run()
 const startup=configSchema.parse(f.runtime.config)
 const selection=structuredClone(f.runtime.config.execution)
 const plan=await f.post('/entry-setup/model/plan',{revision:1,select:false,connection:{kind:'existing',id:'library',apiKey:'synthetic-onboarding-key'}})
 expect(plan.body.connection.id).toBe('library');expect(JSON.stringify(plan.body)).not.toContain('synthetic-onboarding-key')
 expect((await f.post('/entry-setup/model/check',{id:plan.body.id})).body.ok).toBe(true)
 expect((await f.post('/entry-setup/model/apply',{id:plan.body.id})).status).toBe(200)
 expect(Object.keys(f.host.runtime.config.backends)).toEqual(['library']);expect(f.host.runtime.config.execution).toEqual(selection)
 const definition=f.host.runtime.config.backends.library!;expect(definition).toMatchObject({label:'Saved API'})
 if('apiKeyEnv'in definition)envKeys.push(definition.apiKeyEnv!)
 expect((await f.get('/configuration')).body.connectionChecks.library).toMatchObject({ok:true,remoteVerified:true})
 await f.host.closeRuntime();const restarted=new Runtime(startup)
 try{expect(restarted.config.backends.library).toEqual(definition);expect(restarted.config.execution).toEqual(selection)}finally{await restarted.close()}
})
it('does not exhaust the draft limit when repeatedly testing saved connections',async()=>{
 const f=await fixture();for(let i=0;i<22;i++)expect((await f.post('/model-connections/check',{id:'codex',revision:0})).status).toBe(200)
})
it('keeps live library edits and deletions when another connection restarts the host',async()=>{
 const f=await fixture(),binary=join(f.root,'library-cli');writeFileSync(binary,'#!'+process.execPath+'\nconsole.log("ready")',{mode:0o700})
 const create=async(revision:number)=>{const plan=await f.post('/entry-setup/model/plan',{revision,select:false,connection:{kind:'codex',command:binary}});return f.post('/entry-setup/model/apply',{id:plan.body.id})}
 const first=await create(0);expect(first.status).toBe(200);const id=first.body.connection.id
 f.host.runtime.updateSettings(1,{backends:{[id]:{...f.host.runtime.config.backends[id]!,label:'Renamed profile',model:'chosen'}}})
 f.failNextRestart();expect((await create(2)).body.code).toBe('setup_apply_failed')
 expect(f.host.runtime.config.backends[id]).toMatchObject({label:'Renamed profile',model:'chosen'})
 const second=await create(2);expect(second.status).toBe(200)
 expect(f.host.runtime.config.backends[id]).toMatchObject({label:'Renamed profile',model:'chosen'})
 const remaining={...f.host.runtime.config.backends};delete remaining[id];f.host.runtime.updateSettings(3,{backends:remaining})
 expect((await create(4)).status).toBe(200)
 expect(f.host.runtime.config.backends[id]).toBeUndefined();expect(managedConnections(f.config.stateDir).backends[id]).toBeUndefined()
 await f.host.closeRuntime();const restarted=new Runtime(configSchema.parse(f.config))
 try{expect(restarted.config.backends[id]).toBeUndefined();expect(Object.keys(restarted.config.backends)).toHaveLength(2)}finally{await restarted.close()}
})
it('rejects an in-flight test when another session changes the connection',async()=>{
 let received!:()=>void,respond!:()=>void
 const started=new Promise<void>(r=>{received=r}),provider=createServer((req,res)=>{received();respond=()=>{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({choices:[{message:{content:'{"ok":true}'}}]}))}})
 await new Promise<void>(r=>provider.listen(0,'127.0.0.1',r));cleanup.push(async()=>{provider.closeAllConnections();await new Promise<void>(r=>provider.close(()=>r()))})
 const f=await fixture();f.runtime.updateSettings(0,{backends:{library:{kind:'openai-chat',baseUrl:'http://127.0.0.1:'+(provider.address() as any).port+'/v1',model:'before'}}})
 const checking=f.post('/model-connections/check',{revision:1,id:'library'});await started
 f.runtime.updateSettings(1,{backends:{library:{...f.runtime.config.backends.library!,model:'after'}}});respond()
 expect((await checking).status).toBe(409)
 expect((await f.get('/configuration')).body.connectionChecks.library).toBeUndefined()
})
it('restores the original API credential and selections if replacement cannot restart',async()=>{
 const f=await fixture({failRestart:true}),api=await provider(),key='LIBRARY_ROLLBACK_CREDENTIAL';envKeys.push(key);process.env[key]='original-key'
 f.runtime.updateSettings(0,{backends:{library:{kind:'openai-chat',baseUrl:api.url,model:'fixture',apiKeyEnv:key}},execution:{...f.runtime.config.execution,router:{backend:'library'}}})
 const previous=structuredClone(f.runtime.config),plan=await f.post('/entry-setup/model/plan',{revision:1,select:false,connection:{kind:'existing',id:'library',apiKey:'synthetic-onboarding-key'}})
 expect((await f.post('/entry-setup/model/check',{id:plan.body.id})).body.ok).toBe(true)
 expect((await f.post('/entry-setup/model/apply',{id:plan.body.id})).body.code).toBe('setup_apply_failed')
 expect(f.host.runtime.config.backends).toEqual(previous.backends);expect(f.host.runtime.config.execution).toEqual(previous.execution)
 expect(process.env[key]).toBe('original-key');expect(existsSync(managedFiles(f.config.stateDir).secrets)).toBe(false)
 const current=await f.get('/configuration');expect(current.body.current.revision).toBe(1);expect(current.body.connectionChecks.library).toBeUndefined()
})
it('automatically binds only an unambiguous local subscription identity and still requires consent',async()=>{
 const f=await fixture();f.runtime.subscriptions.list=()=>[{id:'signed-in',signedIn:true,subject:'fixture',email:'fixture@example.test',usage:'unknown',expiresAt:undefined}]
 expect((await f.get('/configuration')).body.subscriptionOwners.defaultOwner).toEqual({source:'local',actor:'operator'})
 const connection={kind:'subscription',account:'signed-in',model:'fixture',backgroundAuthorized:true}
 expect((await f.post('/entry-setup/model/plan',{revision:0,connection,select:false})).status).toBe(200)
 expect((await f.post('/entry-setup/model/plan',{revision:0,connection:{...connection,backgroundAuthorized:false},select:false})).status).toBe(400)
 f.runtime.updateSettings(0,{sources:f.runtime.config.sources.map(s=>({...s,allowedActors:['operator','another']}))})
 expect((await f.get('/configuration')).body.subscriptionOwners.defaultOwner).toBeUndefined()
 expect((await f.post('/entry-setup/model/plan',{revision:1,connection,select:false})).body.code).toBe('subscription_owner_required')
 expect((await f.post('/entry-setup/model/plan',{revision:1,connection:{...connection,owner:{source:'local',actor:'another'}},select:false})).status).toBe(200)
 expect((await f.post('/entry-setup/model/plan',{revision:1,connection:{...connection,owner:{source:'local',actor:'unknown'}},select:false})).body.code).toBe('subscription_owner_required')
})
it('reads API model catalogs with the chosen credentials and keeps errors safe',async()=>{
 const requests:any[]=[],provider=createServer((req,res)=>{requests.push(req.headers);res.writeHead(req.headers.authorization==='Bearer catalog-key'?200:401,{'content-type':'application/json'});res.end(req.headers.authorization==='Bearer catalog-key'?JSON.stringify({data:[{id:'one'},{id:'two'},{id:'one'}]}):JSON.stringify({error:'echo-secret'}))})
 await new Promise<void>(r=>provider.listen(0,'127.0.0.1',r));cleanup.push(async()=>{provider.closeAllConnections();await new Promise<void>(r=>provider.close(()=>r()))})
 const f=await fixture(),connection={kind:'api',protocol:'openai-chat',baseUrl:'http://127.0.0.1:'+(provider.address() as any).port+'/v1',model:'_catalog',apiKey:'catalog-key'}
 expect((await f.post('/model-connections/models',connection)).body.models).toEqual(['one','two']);expect(requests[0].authorization).toBe('Bearer catalog-key')
 const failed=await f.post('/model-connections/models',{...connection,apiKey:'bad-key'});expect(failed.body.code).toBe('model_catalog_unavailable');expect(JSON.stringify(failed.body)).not.toContain('echo-secret')
 expect((await f.post('/model-connections/models',{...connection,baseUrl:'https://user:password@example.org'})).status).toBe(400)
})
it('checks the actual CLI profile and environment for independently configured Workers',async()=>{
 const f=await fixture(),binary=join(f.root,'profile-cli'),log=join(f.root,'profile-checks.jsonl'),key='AGENTHUB_TEST_CLI_PROFILE'
 envKeys.push(key);process.env[key]='fixture-profile'
 writeFileSync(binary,'#!'+process.execPath+'\n'+`require('node:fs').appendFileSync(${JSON.stringify(log)},JSON.stringify({args:process.argv.slice(2),profile:process.env.CLI_PROFILE})+'\\n');console.log('CLI ready')`,{mode:0o700})
 f.runtime.updateSettings(0,{backends:{profile:{kind:'codex',command:binary,args:['--profile','work'],env:{CLI_PROFILE:key}}},execution:{...f.runtime.config.execution,workers:[{id:'independent',backend:'profile'}]}})
 const checked=await new Setup(f.runtime).check()
 expect(checked.checks.find(c=>c.id==='profile-auth')?.status).toBe('ok')
 const plan=await f.post('/onboarding/plan',{revision:1,connection:{kind:'existing',id:'profile'}})
 expect((await f.post('/onboarding/check',{id:plan.body.id})).body).toMatchObject({ok:true,remoteVerified:false})
 const requests=readFileSync(log,'utf8').trim().split('\n').map(l=>JSON.parse(l))
 expect(requests).toHaveLength(4);expect(requests.every(r=>r.profile==='fixture-profile'&&r.args.slice(0,2).join(' ')==='--profile work')).toBe(true)
})
it('uses the selected subscription account for connection checks and reports missing sign-in',async()=>{
 const f=await fixture();f.runtime.updateSettings(0,{backends:{subscription:{kind:'openai-responses',baseUrl:'https://api.openai.com/v1',model:'fixture',subscription:{provider:'chatgpt',account:'selected',owner:{source:'local',actor:'operator'},backgroundAuthorized:true}}}})
 let account:string|undefined;f.runtime.subscriptions.credential=async id=>{account=id;throw Error('Subscription sign-in required')}
 const plan=await f.post('/onboarding/plan',{revision:1,connection:{kind:'existing',id:'subscription'}})
 expect((await f.post('/onboarding/check',{id:plan.body.id})).body).toMatchObject({ok:false,remoteVerified:false,checks:[{code:'subscription_sign_in_required'}]})
 expect(account).toBe('selected')
})
it('does not start a second Router for ordinary requests in CLI client mode',async()=>{
 const f=await fixture();f.runtime.updateSettings(0,{execution:{...f.runtime.config.execution,router:{mode:'client'}}})
 const result=await f.post('/request',{text:'Do work'})
 expect(result.status).toBe(409);expect(result.body.code).toBe('client_router_use_worker_manage');expect(f.runtime.store.list('trigger')).toEqual([])
})
it.each(['openai-responses','openai-chat','anthropic'] as const)('takes a beginner from %s setup through a real protocol check, restart and first Runtime reply',async protocol=>{
 const api=await provider(),f=await fixture();f.runtime.store.put('run','retained',{ticketId:'retained',threadId:'legacy-native-thread',cwd:f.root,phase:'idle'})
 const plan=await f.post('/onboarding/plan',{revision:0,connection:{kind:'api',protocol,baseUrl:api.url,model:'fixture',apiKey:'synthetic-onboarding-key'}})
 expect(plan.status).toBe(200);expect(JSON.stringify(plan.body)).not.toContain('synthetic-onboarding-key')
 const checked=await f.post('/onboarding/check',{id:plan.body.id});expect(checked.body).toMatchObject({ok:true,remoteVerified:true,preview:false})
 expect(api.requests[0]!.body[protocol==='openai-responses'?'max_output_tokens':protocol==='openai-chat'?'max_completion_tokens':'max_tokens']).toBe(4096)
 const applied=await f.post('/onboarding/apply',{id:plan.body.id});expect(applied.status).toBe(200);expect(applied.body).toMatchObject({applied:true,ready:true,revision:1})
 const config=f.host.runtime.config,env=Object.values(config.backends).find(d=>'apiKeyEnv'in d&&d.apiKeyEnv)?.kind;expect(env).toBe(protocol)
 for(const d of Object.values(config.backends))if('apiKeyEnv'in d&&d.apiKeyEnv)envKeys.push(d.apiKeyEnv)
 expect(f.host.runtime.store.get<any>('run','retained').threadId).toBe('legacy-native-thread')
 expect(config.sources.find(s=>s.id===applied.body.sourceId)).toMatchObject({sandbox:'read-only',allowedActors:['operator'],cwd:applied.body.workspace})
 expect(statSync(managedFiles(config.stateDir).secrets).mode&0o777).toBe(0o600)
 const visible=await f.get('/configuration');expect(JSON.stringify(visible.body)).not.toContain('synthetic-onboarding-key');expect(readFileSync(f.host.tokenPath,'utf8').trim()).toBe(f.token)
 const sent=await f.post('/send',{source:applied.body.sourceId,event:{id:'first-request',thread:'welcome',text:'Say hello',addressed:true}});expect(sent.status).toBe(202)
 for(let n=0;n<150&&!f.host.runtime.store.deliveries().some(d=>d.kind==='reply'&&d.status==='sent');n++)await new Promise(r=>setTimeout(r,20))
 expect(f.host.runtime.store.deliveries()).toEqual(expect.arrayContaining([expect.objectContaining({kind:'reply',status:'sent',text:'Hello from your assistant.'})]))
 const replay=await f.post('/onboarding/apply',{id:plan.body.id});expect(replay.status).toBe(200);expect(replay.body).toMatchObject({replayed:true,revision:1});expect(f.host.runtime.settings.current().revision).toBe(1)
 expect(api.requests.length).toBeGreaterThanOrEqual(3)
})
it('creates a private connection file while exposing only its location before authentication',async()=>{
 const f=await fixture(),hint=await f.get('/connect-info',false),file=JSON.parse(readFileSync(f.host.connectionFile,'utf8'))
 expect(hint.status).toBe(200);expect(hint.body.connectionFile).toBe(f.host.connectionFile);expect(JSON.stringify(hint.body)).not.toContain(f.token)
 expect(file).toMatchObject({application:'agent-hub',version:1,url:f.host.url,accessToken:f.token});expect(statSync(f.host.connectionFile).mode&0o777).toBe(0o600)
 expect((await f.get('/onboarding',false)).status).toBe(401)
})
it('rejects private folders, escaping folder aliases, stale revisions and unsafe service URLs before writing deployment files',async()=>{
 const f=await fixture(),base={revision:0,connection:{kind:'codex'}};symlinkSync(f.root,join(f.root,'root-alias'))
 for(const workspace of [f.root,f.config.stateDir,join(f.config.stateDir,'setup'),join(f.root,'root-alias')])expect((await f.post('/onboarding/plan',{...base,workspace})).status).toBe(400)
 const bad=await f.post('/onboarding/plan',{revision:0,connection:{kind:'api',protocol:'openai-chat',baseUrl:'http://untrusted.example/v1',model:'fixture'}});expect(bad.status).toBe(400)
 expect((await f.post('/onboarding/plan',{...base,revision:99})).status).toBe(409)
 expect(existsSync(managedFiles(f.config.stateDir).connections)).toBe(false)
})
it('retains previous settings, connections and identities when the controlled restart fails',async()=>{
 const f=await fixture({failRestart:true}),api=await provider();f.runtime.store.put('run','retained',{ticketId:'retained',threadId:'legacy-native-thread',cwd:f.root,phase:'idle'})
 const plan=await f.post('/onboarding/plan',{revision:0,connection:{kind:'api',protocol:'openai-chat',baseUrl:api.url,model:'fixture',apiKey:'synthetic-onboarding-key'}})
 const result=await f.post('/onboarding/apply',{id:plan.body.id});expect(result.status).toBe(503);expect(result.body.code).toBe('setup_apply_failed')
 const current=await f.get('/configuration');expect(current.status).toBe(200);expect(current.body.current.revision).toBe(0);expect(current.body.current.config.execution.backend).toBe('codex');expect(current.body.current.config.sources).toHaveLength(1)
 expect(f.host.runtime.store.get<any>('run','retained').threadId).toBe('legacy-native-thread');expect(managedConnections(f.config.stateDir).sources).toEqual([]);expect(existsSync(managedFiles(f.config.stateDir).secrets)).toBe(false)
})
it('keeps preview checks pending and permits setup without making model requests or sending a first task',async()=>{
 const f=await fixture({preview:true}),api=await provider(),plan=await f.post('/onboarding/plan',{revision:0,connection:{kind:'api',protocol:'openai-chat',baseUrl:api.url,model:'fixture',apiKey:'synthetic-onboarding-key'}})
 expect((await f.post('/onboarding/check',{id:plan.body.id})).body).toMatchObject({ok:false,preview:true,remoteVerified:false})
 const applied=await f.post('/onboarding/apply',{id:plan.body.id});expect(applied.status).toBe(200);expect(applied.body.ready).toBe(false);expect(api.requests).toEqual([])
 for(const d of Object.values(f.host.runtime.config.backends))if('apiKeyEnv'in d&&d.apiKeyEnv)envKeys.push(d.apiKeyEnv)
 expect((await f.post('/send',{source:applied.body.sourceId,event:{id:'first',thread:'welcome',text:'Hello'}})).status).toBe(403)
})
it('restores the original pause state when unfinished background work prevents a configuration change',async()=>{
 const f=await fixture(),plan=await f.post('/onboarding/plan',{revision:0,connection:{kind:'codex'}})
 f.runtime.store.put('work','running-fixture',{id:'running-fixture',kind:'shell',state:'running',ticketId:'fixture',assignmentId:'fixture',notify:'held'})
 const result=await f.post('/onboarding/apply',{id:plan.body.id});expect(result.status).toBe(409);expect(result.body.code).toBe('configuration_busy');expect(f.runtime.status().paused).toBe(false);expect(f.runtime.settings.current().revision).toBe(0)
 f.runtime.store.put('work','running-fixture',{id:'running-fixture',kind:'shell',state:'completed',ticketId:'fixture',assignmentId:'fixture',notify:'held'})
})
it('recovers an uncommitted file journal only after acquiring the host lock',async()=>{
 const root=mkdtempSync(join(tmpdir(),'managed-recovery-'));roots.push(root);const raw={stateDir:join(root,'state'),sources:[{id:'local',kind:'local',cwd:root,allowedActors:['operator']}]},host=new Runtime(configSchema.parse(raw))
 prepareManagedConfig(host.config.stateDir,'uncommitted',{format:1,backends:{fixture:{kind:'codex'}},sources:[]},{AGENTHUB_SETUP_RECOVERY:'synthetic-only'})
 expect(()=>new Runtime(configSchema.parse(raw))).toThrow('live host');expect(existsSync(managedFiles(host.config.stateDir).journal)).toBe(true)
 await host.close();const recovered=new Runtime(configSchema.parse(raw));try{expect(managedConnections(recovered.config.stateDir).backends).toEqual({});expect(existsSync(managedFiles(recovered.config.stateDir).secrets)).toBe(false)}finally{await recovered.close()}
})
it('loads committed connections and credentials after a completely new host starts from the original startup configuration',async()=>{
 const f=await fixture(),api=await provider(),plan=await f.post('/onboarding/plan',{revision:0,connection:{kind:'api',protocol:'openai-chat',baseUrl:api.url,model:'fixture',apiKey:'synthetic-onboarding-key'}})
 const applied=await f.post('/onboarding/apply',{id:plan.body.id});expect(applied.status).toBe(200)
 const key=(Object.values(f.host.runtime.config.backends).find(d=>'apiKeyEnv'in d) as any).apiKeyEnv;envKeys.push(key);delete process.env[key]
 await f.host.closeRuntime();const restarted=new Runtime(configSchema.parse(f.config))
 try{expect(restarted.settings.current().revision).toBe(1);expect(restarted.config.execution.backend).toBe(applied.body.connection.id);expect(process.env[key]).toBe('synthetic-onboarding-key');expect(restarted.sources.has(applied.body.sourceId)).toBe(true)}finally{await restarted.close()}
})
it('retains files for a journal with an atomic deployment commit marker',async()=>{
 const root=mkdtempSync(join(tmpdir(),'managed-committed-'));roots.push(root);const raw={stateDir:join(root,'state'),sources:[{id:'local',kind:'local',cwd:root,allowedActors:['operator']}]},host=new Runtime(configSchema.parse(raw))
 prepareManagedConfig(host.config.stateDir,'committed',{format:1,backends:{retained:{kind:'codex'}},sources:[]},{AGENTHUB_SETUP_COMMITTED:'synthetic-committed-key'});envKeys.push('AGENTHUB_SETUP_COMMITTED')
 host.store.atomic(()=>host.store.put('onboarding-deployment','committed',{revision:1}));await host.close()
 const restarted=new Runtime(configSchema.parse(raw));try{expect(restarted.config.backends.retained).toMatchObject({kind:'codex'});expect(process.env.AGENTHUB_SETUP_COMMITTED).toBe('synthetic-committed-key');expect(existsSync(managedFiles(restarted.config.stateDir).journal)).toBe(false)}finally{await restarted.close()}
})
it('reports rejected credentials without echoing or persisting their value',async()=>{
 const f=await fixture(),api=await provider(),plan=await f.post('/onboarding/plan',{revision:0,connection:{kind:'api',protocol:'openai-chat',baseUrl:api.url,model:'fixture',apiKey:'synthetic-wrong-key'}})
 const checked=await f.post('/onboarding/check',{id:plan.body.id});expect(checked.body).toMatchObject({ok:false,remoteVerified:false,checks:[{code:'api_key_rejected'}]});expect(JSON.stringify(checked.body)).not.toContain('synthetic-wrong-key');expect(existsSync(managedFiles(f.config.stateDir).secrets)).toBe(false)
 const malformed=await fetch(f.host.url+'/onboarding/plan',{method:'POST',headers:f.headers,body:'{"apiKey":"synthetic-broken-secret",'});expect(malformed.status).toBe(400);expect(await malformed.text()).not.toContain('synthetic-broken-secret')
})
it('backs up managed credentials with integrity checks and restores both pre-setup and configured states',async()=>{
 const f=await fixture(),api=await provider(),before=join(f.root,'before-setup'),configured=join(f.root,'with-service')
 await backupState(f.runtime.config,before)
 const plan=await f.post('/onboarding/plan',{revision:0,connection:{kind:'api',protocol:'openai-chat',baseUrl:api.url,model:'fixture',apiKey:'synthetic-onboarding-key'}}),applied=await f.post('/onboarding/apply',{id:plan.body.id})
 expect(applied.status).toBe(200)
 const key=(Object.values(f.host.runtime.config.backends).find(d=>'apiKeyEnv'in d) as any).apiKeyEnv;envKeys.push(key)
 await backupState(f.host.runtime.config,configured);expect(verifyBackup(configured).managed.secrets).toMatch(/^[a-f0-9]{64}$/);expect(statSync(join(configured,'setup','credentials.json')).mode&0o777).toBe(0o600)
 await f.host.closeRuntime();await restoreState(f.config,before)
 expect(existsSync(managedFiles(f.config.stateDir).secrets)).toBe(false)
 let restored=new Runtime(configSchema.parse(f.config));expect(restored.config.execution.backend).toBe('codex');expect(restored.config.sources).toHaveLength(1);await restored.close()
 await restoreState(f.config,configured);delete process.env[key];restored=new Runtime(configSchema.parse(f.config))
 try{expect(restored.config.execution.backend).toBe(applied.body.connection.id);expect(process.env[key]).toBe('synthetic-onboarding-key');expect(restored.sources.has(applied.body.sourceId)).toBe(true)}finally{await restored.close()}
 appendFileSync(join(configured,'setup','credentials.json'),'tampered');expect(()=>verifyBackup(configured)).toThrow('checksum')
})
it.each([false,true])('recovers interrupted offline restore files from the database commit marker (committed=%s)',async committed=>{
 const root=mkdtempSync(join(tmpdir(),'restore-journal-'));roots.push(root);const raw={stateDir:join(root,'state'),sources:[{id:'local',kind:'local',cwd:root,allowedActors:['operator']}]},host=new Runtime(configSchema.parse(raw));await host.close()
 prepareManagedFiles(raw.stateDir,'restore-fixture',{connections:JSON.stringify({format:1,backends:{restored:{kind:'codex'}},sources:[]}),secrets:JSON.stringify({AGENTHUB_SETUP_RESTORE:'synthetic-restored'}),restore:true});envKeys.push('AGENTHUB_SETUP_RESTORE')
 const store=new Store(join(raw.stateDir,'state.sqlite'));store.put('sample','retained',{value:2});if(committed)store.put('restore-commit','restore-fixture',{});store.close()
 const recovered=new Runtime(configSchema.parse(raw));try{expect(!!recovered.config.backends.restored).toBe(committed);expect(recovered.store.get('sample','retained')).toEqual({value:2});expect(existsSync(managedFiles(raw.stateDir).journal)).toBe(false)}finally{await recovered.close()}
})

it.each([
 [401,'invalid_api_key','api_key_rejected'],[403,'permission_denied','model_access_denied'],
 [404,'model_not_found','model_not_found'],[400,'unsupported_parameter','api_request_invalid'],
 [402,'insufficient_balance','api_quota_exhausted'],[429,'insufficient_quota','api_quota_exhausted'],[429,'rate_limit_exceeded','api_rate_limited'],[503,'overloaded_error','provider_unavailable'],
] as const)('reports HTTP %s / %s without exposing provider error messages or credentials',async(status,code,expected)=>{
 const secret='synthetic-sensitive-key',api=await provider({status,body:{error:{code,param:'max_completion_tokens',message:'Credential '+secret+' was rejected'}}}),f=await fixture()
 const plan=await f.post('/entry-setup/model/plan',{revision:0,select:false,connection:{kind:'api',protocol:'openai-chat',baseUrl:api.url,model:'fixture',apiKey:secret}})
 const checked=await f.post('/entry-setup/model/check',{id:plan.body.id})
 expect(checked.body).toMatchObject({ok:false,checks:[{code:expected,detail:'HTTP '+status+' · '+code+' · max_completion_tokens'}]})
 expect(JSON.stringify(checked.body)).not.toContain(secret);expect(f.host.runtime.settings.current().revision).toBe(0)
})
it('reports exhausted reasoning output separately from authentication and hides reflected credentials in identifiers',async()=>{
 const api=await provider({status:200,body:{choices:[{finish_reason:'length',message:{content:''}}]}}),f=await fixture()
 const plan=await f.post('/entry-setup/model/plan',{revision:0,select:false,connection:{kind:'api',protocol:'openai-chat',baseUrl:api.url,model:'fixture'}})
 expect((await f.post('/entry-setup/model/check',{id:plan.body.id})).body).toMatchObject({ok:false,checks:[{code:'model_output_limit'}]})
 const secret='synthetic-sensitive-key',rejected=await provider({status:401,body:{error:{code:secret,param:secret}}})
 const draft=await f.post('/entry-setup/model/plan',{revision:0,select:false,connection:{kind:'api',protocol:'openai-chat',baseUrl:rejected.url,model:'fixture',apiKey:secret}})
 const result=await f.post('/entry-setup/model/check',{id:draft.body.id})
 expect(result.body.checks[0]).toEqual({id:'connection',status:'required',code:'api_key_rejected',detail:'HTTP 401'})
})
