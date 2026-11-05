import {mkdtempSync,rmSync,readFileSync,writeFileSync,existsSync,statSync,mkdirSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {request as httpRequest,createServer} from 'node:http'
import {afterEach,it,expect,vi} from 'vitest'
import {Client} from '@modelcontextprotocol/sdk/client/index.js'
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js'
import {configSchema,type Config} from '../src/config.ts'
import {Runtime} from '../src/runtime.ts'
import {serve} from '../src/server.ts'
import {MessageSource} from '../src/sources.ts'
import {clientConfig,restoreClient} from '../src/clients.ts'
import {installEntryClient} from '../src/client-setup.ts'
import {managedFiles} from '../src/managed-config.ts'
import {EntrySetup} from '../src/entry-setup.ts'
import {Onboarding} from '../src/onboarding.ts'
import {backupState,verifyBackup} from '../src/backup.ts'

const cleanup:(()=>Promise<void>)[]=[],roots:string[]=[],keys:string[]=[]
afterEach(async()=>{vi.restoreAllMocks();for(const fn of cleanup.splice(0).reverse())await fn();for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});for(const key of keys.splice(0))delete process.env[key]})
const model={async run(r:any){const threadId=r.threadId??'fixture-thread',turnId='fixture-turn-'+Date.now();r.onThread?.(threadId);r.onTurn?.(turnId);return {threadId,turnId,text:JSON.stringify(r.ephemeral?{action:'accept',title:'Entry test',scope:'Reply to the connection check',reason:'Explicit request',rules:[],ruleAssessments:[],targetTicketId:null}:{state:'ready',summary:'Checked',reply:'Entry reply delivered.',question:null,handbacks:[]})}}}
async function fixture(options:{preview?:boolean;failRestart?:boolean}={}){
 const root=mkdtempSync(join(tmpdir(),'agenthub-entry-'));roots.push(root)
 mkdirSync(join(root,'files'))
 const config=configSchema.parse({stateDir:join(root,'state'),port:0,codex:'/missing/codex',execution:{backend:'fixture'},backends:{fixture:{kind:'openai-chat',baseUrl:'http://127.0.0.1:9/v1',model:'fixture'}},work:{sandboxDriver:'disabled',network:false},sources:[{id:'local',kind:'local',cwd:join(root,'files'),allowedActors:['operator']}]})
 let failures=options.failRestart?1:0
 const create=(cfg:Config)=>{if(failures-->0)throw Error('fixture restart failure');return make(cfg)}
 const make=(cfg:Config)=>new Runtime(cfg,{model,sources:cfg.sources.map(s=>new class extends MessageSource{async deliver(){} }(s))})
 const runtime=make(config),host=await serve(runtime,{configurationPreview:options.preview,clientHome:join(root,'client-home'),createRuntime:create})
 cleanup.push(async()=>{await new Promise<void>(r=>host.server.close(()=>r()));await host.closeRuntime()})
 const headers={authorization:'Bearer '+readFileSync(host.tokenPath,'utf8').trim(),'content-type':'application/json'}
 const request=async(path:string,value?:unknown,auth=true,extra:Record<string,string>={})=>{const response=await fetch(host.url+path,{method:value===undefined?'GET':'POST',headers:{...(auth?headers:{}),...extra},...(value===undefined?{}:{body:JSON.stringify(value)})});return {status:response.status,body:await response.json(),cookie:response.headers.get('set-cookie')}}
 return {root,config,host,runtime,headers,request}
}
it('pairs once without a copied permanent token, survives refresh, and refuses cross-origin cookie writes',async()=>{
 const f=await fixture(),code=new URL(f.host.operatorUrl).hash.slice('#pair='.length)
 expect((await f.request('/session',undefined,false)).body).toEqual({operator:false})
 expect((await f.request('/pair',{code},false)).status).toBe(403)
 const paired=await f.request('/pair',{code},false,{origin:f.host.url});expect(paired.status).toBe(200);expect(paired.cookie).toContain('HttpOnly; SameSite=Strict')
 const cookie=paired.cookie!.split(';')[0]!
 expect((await f.request('/pair',{code},false,{origin:f.host.url})).status).toBe(401)
 expect((await f.request('/session',undefined,false,{cookie})).body.operator).toBe(true)
 expect((await f.request('/entry-setup',undefined,false,{cookie})).status).toBe(200)
 expect((await f.request('/entry-setup/verification',{entryId:'cursor'},false,{cookie,origin:'https://other.example'})).status).toBe(403)
 expect((await f.request('/entry-setup/verification',{entryId:'cursor'},false,{cookie})).status).toBe(403)
 expect((await f.request('/logout',{},false,{cookie,origin:f.host.url})).body.operator).toBe(false)
 expect((await f.request('/entry-setup',undefined,false,{cookie})).status).toBe(401)
 const status=await new Promise<number>(resolve=>{const req=httpRequest(f.host.url+'/entry-setup',{headers:{...f.headers,host:'untrusted.example'}},res=>{res.resume();resolve(res.statusCode!)});req.end()});expect(status).toBe(403)
})
it('keeps ordinary users outside management and shares only selected usage instructions',async()=>{
 const f=await fixture(),publicInfo=await f.request('/entry-guide',undefined,false)
 expect(publicInfo.status).toBe(200);expect(publicInfo.body.entries.some((x:any)=>x.id==='wecom')).toBe(true)
 expect(JSON.stringify(publicInfo.body)).not.toContain(f.root)
 expect((await f.request('/entry-setup',undefined,false)).status).toBe(401)
 const installed=await f.request('/entry-setup/install',{entryId:'cursor'});expect(installed.status).toBe(200);expect(installed.body.verified).toBe(false)
 const shared=await f.request('/entry-setup/share',{entryIds:['cursor']});expect(shared.body.operator).toBe(false)
 const invite=new URL(shared.body.url).hash.slice('#invite='.length),guide=await f.request('/entry-guide',{invite},false)
 expect(guide.body.entries.map((e:any)=>e.id)).toEqual(['cursor']);expect(guide.body.entries[0].status).toBe('configured');expect(shared.body.text.zh).toContain('Cursor');expect(JSON.stringify(guide.body)).not.toContain(f.root);expect(JSON.stringify(guide.body)).not.toContain(readFileSync(f.host.tokenPath,'utf8').trim())
 expect((await f.request('/entry-setup',undefined,false,{authorization:'Bearer '+invite})).status).toBe(401)
 expect((await f.request('/entry-setup/share',{entryIds:['wecom']})).status).toBe(400)
})
it('installs a named client entry with a recoverable backup, preserving other settings and conflicts',async()=>{
 const f=await fixture(),path=join(f.root,'client-home','.cursor','mcp.json');mkdirSync(join(f.root,'client-home','.cursor'),{recursive:true});const before='// user comment\n{"mcpServers":{"other":{"command":"keep"}},"theme":"dark"}\n';writeFileSync(path,before)
 const installed=await f.request('/entry-setup/install',{entryId:'cursor'});expect(installed.status).toBe(200);expect(readFileSync(path,'utf8')).toContain('// user comment');expect(readFileSync(path,'utf8')).toContain('"other"')
 expect((await f.request('/entry-setup/install',{entryId:'cursor'})).body.changed).toBe(false)
 expect((await f.request('/entry-setup',undefined)).body.entries.find((e:any)=>e.id==='cursor').status).toBe('configured')
 restoreClient(installed.body.backupDir,installed.body.backupId);expect(readFileSync(path,'utf8')).toBe(before)
 writeFileSync(path,'{"mcpServers":{"agent-hub":{"command":"different"}}}')
 expect((await f.request('/entry-setup/install',{entryId:'cursor'})).body.code).toBe('client_conflict');expect(readFileSync(path,'utf8')).toContain('different')
})
it('uses the official Codex CLI for TOML, leaves other servers intact, and supports exact guarded restoration',async()=>{
 const root=mkdtempSync(join(tmpdir(),'codex-install-'));roots.push(root);const path=join(root,'config.toml'),before='# user text\nmodel="keep"\n[mcp_servers.other]\ncommand="other"\n';writeFileSync(path,before)
 const options={client:'codex' as const,home:root,url:'http://127.0.0.1:4319',tokenFile:join(root,'token'),backupDir:join(root,'backups'),tagged:true},definition=clientConfig(options)
 let installed=false;const calls:string[][]=[]
 const runner=async(_binary:string,args:string[])=>{calls.push(args);if(args[1]==='list')return JSON.stringify(installed?[{name:'agent-hub',enabled:true,transport:{type:'stdio',command:definition.server.command,args:definition.server.args}}]:[]);expect(args.slice(0,4)).toEqual(['mcp','add','agent-hub','--']);writeFileSync(path,before+definition.text);installed=true;return ''}
 const result=await installEntryClient(options,'fixture-codex',runner);expect(result.changed).toBe(true);expect(readFileSync(path,'utf8')).toContain('[mcp_servers.other]');expect(calls.some(c=>c[1]==='add')).toBe(true)
 restoreClient(options.backupDir,result.backupId!);expect(readFileSync(path,'utf8')).toBe(before)
})
it('deploys office sources without changing models, persists private credentials, and reloads from the original startup config',async()=>{
 const f=await fixture(),plan=await f.request('/entry-setup/plan',{revision:0,entryId:'wecom',credentials:{botId:'synthetic-bot',secret:'synthetic-office-secret'}})
 expect(plan.status).toBe(200);expect(JSON.stringify(plan.body)).not.toContain('synthetic-office-secret')
 const applied=await f.request('/entry-setup/apply',{id:plan.body.id});expect(applied.status).toBe(200);expect(applied.body.applied).toBe(true)
 const host=f.host.runtime;expect(host.config.execution.backend).toBe('fixture');expect(host.config.sources).toHaveLength(2);expect(host.config.sources[1]?.allowedActors).toEqual([]);expect(host.store.get('onboarding','current')).toBeUndefined()
 const credentialNames=Object.keys(JSON.parse(readFileSync(managedFiles(host.config.stateDir).secrets,'utf8')));keys.push(...credentialNames);expect(statSync(managedFiles(host.config.stateDir).secrets).mode&0o777).toBe(0o600)
 expect(JSON.stringify((await f.request('/entry-setup')).body)).not.toContain('synthetic-office-secret')
 expect((await f.request('/entry-setup/apply',{id:plan.body.id})).body.replayed).toBe(true)
 await f.host.closeRuntime();for(const key of credentialNames)delete process.env[key]
 const restarted=new Runtime(configSchema.parse(f.config),{model});try{expect(restarted.sources.has(plan.body.sourceId)).toBe(true);expect(credentialNames.some(key=>process.env[key]==='synthetic-office-secret')).toBe(true)}finally{await restarted.close()}
})
it('rolls back an office deployment and credentials when rebuilding fails',async()=>{
 const f=await fixture({failRestart:true}),plan=await f.request('/entry-setup/plan',{revision:0,entryId:'wecom',credentials:{botId:'synthetic-bot',secret:'synthetic-rollback-secret'}})
 expect((await f.request('/entry-setup/apply',{id:plan.body.id})).body.code).toBe('setup_apply_failed');expect(f.host.runtime.config.sources).toHaveLength(1);expect(f.host.runtime.config.execution.backend).toBe('fixture');expect(existsSync(managedFiles(f.config.stateDir).secrets)).toBe(false)
})
it('distinguishes saved, received, permission required, execution and actual adapter delivery',async()=>{
 const f=await fixture(),plan=await f.request('/entry-setup/plan',{revision:0,entryId:'wecom',credentials:{botId:'synthetic-bot',secret:'synthetic-verify-secret'}});await f.request('/entry-setup/apply',{id:plan.body.id});keys.push(...Object.keys(JSON.parse(readFileSync(managedFiles(f.config.stateDir).secrets,'utf8'))))
 const v=(await f.request('/entry-setup/verification',{entryId:'wecom',sourceId:plan.body.sourceId})).body
 expect(v.instructions.en).toMatch(/^This is a connection check/);expect(v.instructions.en).not.toContain('agent_request')
 expect(v.verified).toBe(false);expect(v.stages.every((s:any)=>s.status==='pending')).toBe(true)
 const source=f.host.runtime.sources.get(plan.body.sourceId)!,send=(id:string)=>{const trigger=source.trigger({id,thread:'single:synthetic-user',text:v.instruction,addressed:true},'synthetic-user');trigger.meta={chat:'synthetic-user'};return f.host.runtime.ingest(trigger)}
 send('before-allow');const pending=(await f.request('/entry-setup/verification/'+v.id)).body;expect(pending.stages[0].status).toBe('ok');expect(pending.stages[1].status).toBe('required');expect(pending.observedSender.actor).toBe('synthetic-user')
 expect((await f.request('/entry-setup/allow',{revision:1,sourceId:plan.body.sourceId,actor:'not-observed'})).status).toBe(400)
 expect((await f.request('/entry-setup/allow',{revision:1,sourceId:plan.body.sourceId,actor:'synthetic-user'})).status).toBe(200)
 expect(f.host.runtime.store.tickets.list()).toHaveLength(0);send('after-allow')
 let result:any;for(let n=0;n<150;n++){result=(await f.request('/entry-setup/verification/'+v.id)).body;if(result.verified)break;await new Promise(r=>setTimeout(r,20))}
 expect(result.verified).toBe(true);expect(result.stages.every((s:any)=>s.status==='ok')).toBe(true)
})
it.each(['cursor','generic'])('verifies a %s MCP bridge through a natural-language request without source identifiers',async entryId=>{
 const f=await fixture(),v=(await f.request('/entry-setup/verification',{entryId})).body,client=new Client({name:'synthetic-'+entryId+'-protocol-client',version:'1'})
 expect(v.instructions.en).toMatch(/^Use AgentHub/);expect(v.instructions.en).toContain('agent_request');expect(v.instructions.en).toContain('agent_status');expect(v.instructions.zh).toContain('仅约束后台助手')
 cleanup.push(()=>client.close())
 await client.connect(new StdioClientTransport({command:process.execPath,args:['--import',join(process.cwd(),'node_modules/tsx/dist/loader.mjs'),join(process.cwd(),'src/cli.ts'),'mcp',f.host.url,f.host.tokenPath,'--client',entryId],stderr:'pipe'}))
 const result:any=await client.callTool({name:'agent_request',arguments:{text:v.instruction}});expect(result.isError).toBe(false)
 let progress:any;for(let n=0;n<150;n++){await client.callTool({name:'agent_status',arguments:{}});progress=(await f.request('/entry-setup/verification/'+v.id)).body;if(progress.verified)break;await new Promise(r=>setTimeout(r,20))}
 expect(progress.verified).toBe(true);const sent=JSON.parse(result.content[0].text);expect(sent.discussion).toBeTruthy();expect(sent.requestId).toBeTruthy();expect((await f.request('/entry-setup')).body.entries.find((e:any)=>e.id===entryId).status).toBe('verified')
 const wrong=(await f.request('/entry-setup/verification',{entryId:'vscode'})).body;expect((await f.request('/entry-setup/verification/'+wrong.id)).body.verified).toBe(false)
})
it('keeps real-client polling concise, filters the requested discussion and acknowledges only its originating bridge',async()=>{
 const f=await fixture(),v=(await f.request('/entry-setup/verification',{entryId:'vscode'})).body,bridge={'x-agenthub-client':'vscode','x-agenthub-bridge':'same-bridge'}
 const request=await f.request('/request',{text:v.instruction+'\n'+('Synthetic source context. '.repeat(2500))},true,bridge)
 expect(request.status).toBe(202);expect(request.body.next.arguments.discussion).toBe(request.body.discussion)
 for(let n=0;n<150&&!f.host.runtime.store.deliveries().some(d=>d.kind==='reply'&&d.status==='sent');n++)await new Promise(r=>setTimeout(r,20))
 const full=await f.request('/status');expect(JSON.stringify(full.body).length).toBeGreaterThan(60000)
 expect((await f.request('/entry-setup/verification/'+v.id)).body.verified).toBe(false)
 const foreign=await f.request('/status',undefined,true,{...bridge,'x-agenthub-bridge':'different-bridge'});expect(foreign.body.tickets[0].run.result).toBe('Entry reply delivered.');expect((await f.request('/entry-setup/verification/'+v.id)).body.verified).toBe(false)
 const short=await f.request('/status?discussion='+request.body.discussion,undefined,true,bridge)
 expect(JSON.stringify(short.body).length).toBeLessThan(12000);expect(short.body.tickets).toHaveLength(1);expect(short.body.more).toBe(false);expect(short.body).not.toHaveProperty('events');expect((await f.request('/entry-setup/verification/'+v.id)).body.verified).toBe(true)
 expect((await f.request('/status?discussion=unrelated',undefined,true,bridge)).body.tickets).toEqual([])
})
it('rejects unsafe source drafts and keeps a preview from installing or fabricating successful verification',async()=>{
 const f=await fixture({preview:true});expect((await f.request('/entry-setup/install',{entryId:'cursor'})).status).toBe(403)
 expect((await f.request('/entry-setup/probe',{entryId:'feishu'})).body.checks[0].code).toBe('preview_not_connected')
 expect((await f.request('/entry-setup/plan',{revision:99,entryId:'wecom',credentials:{botId:'bot',secret:'secret'}})).status).toBe(409)
 expect((await f.request('/entry-setup/plan',{revision:0,entryId:'wecom',workspace:f.root,credentials:{botId:'bot',secret:'secret'}})).status).toBe(400)
 expect((await f.request('/entry-setup/plan',{revision:0,entryId:'feishu',scopeIds:['oc_forged']})).body.code).toBe('probe_required')
 expect((await f.request('/entry-setup/plan',{revision:0,entryId:'github',repository:'https://elsewhere.example/private'})).status).toBe(400)
})
it.each(['openai-responses','openai-chat','anthropic'] as const)('adds a %s AI connection within entry setup without creating a browser inbox or losing entries',async protocol=>{
 const f=await fixture(),calls:string[]=[],provider=createServer(async(req,res)=>{for await(const _ of req){};calls.push(req.url!);const text='{"ok":true}';res.setHeader('content-type','application/json');res.end(JSON.stringify(protocol==='openai-responses'?{status:'completed',output:[{type:'message',content:[{type:'output_text',text}]}]}:protocol==='anthropic'?{stop_reason:'end_turn',content:[{type:'text',text}]}:{choices:[{message:{content:text}}]}))})
 await new Promise<void>(r=>provider.listen(0,'127.0.0.1',r));cleanup.push(async()=>{provider.closeAllConnections();await new Promise<void>(r=>provider.close(()=>r()))})
 const connection={kind:'api',protocol,baseUrl:'http://127.0.0.1:'+(provider.address() as any).port+'/v1',model:'synthetic-model',apiKey:'synthetic-entry-model-secret'},plan=await f.request('/entry-setup/model/plan',{revision:0,connection})
 expect(plan.status).toBe(200);expect(JSON.stringify(plan.body)).not.toContain(connection.apiKey)
 expect((await f.request('/entry-setup/model/check',{id:plan.body.id})).body).toMatchObject({ok:true,remoteVerified:true})
 const applied=await f.request('/entry-setup/model/apply',{id:plan.body.id});expect(applied.status).toBe(200);expect(f.host.runtime.config.sources.map(s=>s.id)).toEqual(['local']);expect(f.host.runtime.store.get('onboarding','current')).toBeUndefined();expect(calls.length).toBe(1)
 keys.push(...Object.keys(JSON.parse(readFileSync(managedFiles(f.config.stateDir).secrets,'utf8'))))
 const backup=join(f.root,'model-backup');await backupState(f.host.runtime.config,backup);expect(verifyBackup(backup).managed.secrets).toBeTruthy()
 await f.host.closeRuntime();const restarted=new Runtime(configSchema.parse(f.config),{model});try{expect(restarted.config.execution.backend).toBe(applied.body.connection.id);expect(restarted.config.sources.map(s=>s.id)).toEqual(['local'])}finally{await restarted.close()}
})
