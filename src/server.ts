import {deploymentMaintenance,DeploymentError} from './deployment-maintenance.ts'
import {requestHostOrigin} from './http-deployment.ts'
import {serveDelegation} from './delegation/server.ts'
import {DelegationError} from './delegation/contract.ts'
import {PluginMarket,MarketError} from './plugin-market.ts'
import {PluginGitHub} from './plugin-github.ts'
import {Ajv2020} from 'ajv/dist/2020.js'
import {decisionConfigSchema} from './decision-config.ts'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createReadStream, statSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { Runtime } from './runtime.ts'
import { incomingSchema } from './sources.ts'
import { deliverDraft } from './delivery.ts'
import {configSchema,type Config} from './config.ts'
import {randomUUID} from 'node:crypto'
import {readSchema} from './resources.ts'
import {promptStatus} from './prompts.ts'
import {previewModes} from './execution-prompts.ts'
import {configurationSnapshot} from './configuration.ts'
import {SettingsError,patchSchema} from './settings.ts'
import {routerManagementPage} from './ui/router-management.ts'
import {webhookWorkbenchPage} from './ui/webhook-workbench.ts'
import {routerProactivePage} from './ui/router-proactive.ts'
import {configurationPage} from './ui/configuration.ts'
import {Onboarding,OnboardingError} from './onboarding.ts'
import {atomicPrivateFile} from './managed-config.ts'
import {OperatorSessions} from './operator-session.ts'
import {EntrySetup,entryIds} from './entry-setup.ts'
import {clientIds} from './clients.ts'
import {clientStatus} from './client-status.ts'
import {operatorWorkspace,operatorTask} from './operator-workspace.ts'
import {PersonalAccount,AccountError,setupAccountSchema,loginAccountSchema,recoverAccountSchema,passwordSchema} from './personal-account.ts'
import {accountPage} from './ui/account.ts'
import {chatPage,chatAsset} from './ui/chat-page.ts'
import {ChatError} from './chat.ts'
import {BrowserError} from './browser-contract.ts'
import {browserRequest} from './browser-http.ts'
import {serveWebhooks} from './webhook-http.ts'
import {WebhookError} from './webhook-protocol.ts'
import {enabledView,viewCatalog} from './workspace-view-package.ts'
import {viewQuerySchema,workspaceViewData} from './workspace-view-data.ts'

export async function serve(runtime: Runtime,options:{configurationPreview?:boolean;createRuntime?:(config:Config,activationId?:string)=>Runtime|Promise<Runtime>;pluginGitHub?:PluginGitHub;clientHome?:string;clientName?:string}={}) {
  const tokenPath = join(runtime.config.stateDir, 'access-token')
  const connectionFile=join(runtime.config.stateDir,'connection.json')
  const account=new PersonalAccount(runtime.config.stateDir,Date.now,runtime.config.http?.publicOrigin)
  let changing=false,unavailable=false,runtimeClosed=false,endpoint='',stopping=false,closingRuntime:Promise<void>|undefined
  let delegationServer:Awaited<ReturnType<typeof serveDelegation>>|undefined
  const onboarding=new Onboarding(()=>runtime,options.configurationPreview===true)
  const sessions=new OperatorSessions(),entries=new EntrySetup(()=>runtime,onboarding,()=>endpoint,options.configurationPreview===true,options.clientHome,options.clientName)
  async function stopRuntime(){if(!runtimeClosed){runtimeClosed=true;closingRuntime=(async()=>{await delegationServer?.close();delegationServer=undefined;await runtime.close()})()}await closingRuntime}
  const market=new PluginMarket(()=>runtime,options.pluginGitHub)
  async function rebuild(config:Config,activationId?:string){
    await stopRuntime()
    if(stopping)throw Error('Host is stopping')
    const next=await (options.createRuntime?options.createRuntime(configSchema.parse(config),activationId):Runtime.create(configSchema.parse(config),{pluginActivation:activationId}))
    runtime=next;runtimeClosed=false;closingRuntime=undefined;runtime.endpoint=endpoint;delegationServer=runtime.delegation.enabled?await serveDelegation(runtime.delegation,runtime.delegation.preferredPort):undefined;runtime.start()
  }
  let token: string
  try { token = readFileSync(tokenPath, 'utf8').trim() }
  catch { token = randomBytes(32).toString('hex'); writeFileSync(tokenPath, token, { mode: 0o600, flag: 'wx' }) }
  const watchdogTokenPath=join(runtime.config.stateDir,'watchdog-access-token')
  let watchdogToken:string
  try{watchdogToken=readFileSync(watchdogTokenPath,'utf8').trim()}catch{watchdogToken=randomBytes(32).toString('hex');writeFileSync(watchdogTokenPath,watchdogToken,{mode:0o600,flag:'wx'})}
  const server = createServer((request, response) => { void handle(request, response).catch(error => {
    if(response.headersSent){response.end();return}
    if(error instanceof DeploymentError){send(response,error.status,{code:error.code,error:error.message});return}
    if(error instanceof MarketError){if(error.code==='market_recovery_required')unavailable=true;send(response,error.status,{error:error.message,code:error.code});return}
    if(error instanceof WebhookError){send(response,error.status,{code:error.code});return}
    if(error instanceof ChatError||error instanceof BrowserError){send(response,error.status,{error:error.message,code:error.code});return}
    if(error instanceof AccountError){send(response,error.status,{error:error.message,code:error.code});return}
    if(error instanceof OnboardingError){if(error.code==='setup_recovery_required')unavailable=true;send(response,error.status,{error:error.message,code:error.code});return}
    if(error instanceof DelegationError){send(response,error.status,{error:error.code,code:error.code});return}
    if(error instanceof SettingsError){send(response,error.status,{error:error.message,code:error.code,...(error.code==='settings_conflict'?{currentRevision:runtime.settings.current().revision}:{})});return}
    if(error instanceof z.ZodError){send(response,400,{error:'Configuration or request validation failed',code:'validation_error',issues:error.issues.map(issue=>({path:issue.path,message:issue.message}))});return}
    send(response,400,{error:String(error).slice(0,500),code:'request_failed'})
  }) })
  function authorized(request: IncomingMessage, secret = token): boolean {
    const actual = Buffer.from(request.headers.authorization ?? '')
    const expected = Buffer.from('Bearer ' + secret)
    return actual.length === expected.length && timingSafeEqual(actual, expected)
  }
  async function body(request: IncomingMessage): Promise<any> {
    const chunks: Buffer[] = []
    let bytes = 0
    for await (const chunk of request) {
      bytes += chunk.length
      if (bytes > 256_000) throw new Error('Request exceeds 256KB')
      chunks.push(chunk)
    }
    try{return JSON.parse(Buffer.concat(chunks).toString('utf8'))}catch{throw Error('Request body must be valid JSON')}
  }
  function requireCurrentOperator(req: IncomingMessage) {
    if(stopping||changing||unavailable)throw new OnboardingError('configuration_busy','The host is changing configuration.',503)
    if(!authorized(req)&&!(account.configured?account.authorized(req):sessions.authorized(req)))throw new AccountError('operator_session_ended','Operator session ended',401)
  }
  async function operatorBody(req: IncomingMessage) {
    const input=await body(req)
    requireCurrentOperator(req)
    return input
  }
  async function handle(req: IncomingMessage, res: ServerResponse) {
    const path = new URL(req.url!, 'http://localhost').pathname
    res.setHeader('cache-control', 'no-store')
    res.setHeader('x-content-type-options', 'nosniff')
    res.setHeader('referrer-policy','no-referrer')
    let requestOrigin=''
    try{requestOrigin=requestHostOrigin(req.headers.host,endpoint,runtime.config.http?.publicOrigin)}catch{send(res,403,{error:'Use this host’s local origin',code:'host_origin_required'});return}
    if(['POST','PATCH'].includes(req.method??'')&&req.headers.origin&&req.headers.origin!==requestOrigin){send(res,403,{error:'Use this page’s own origin',code:'same_origin_required'});return}
    const browserOperator=account.configured?account.authorized(req):sessions.authorized(req)
    if((req.method==='GET'||req.method==='HEAD')&&path.startsWith('/chat-assets/')){
      const name=path.slice('/chat-assets/'.length),asset=chatAsset(name)
      if(!asset){send(res,404,{code:'not_found'});return}
      const type=name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':name.endsWith('.png')?'image/png':name.endsWith('.svg')?'image/svg+xml':name.endsWith('.ico')?'image/x-icon':name.endsWith('.woff2')?'font/woff2':'application/octet-stream'
      res.writeHead(200,{'content-type':type});res.end(req.method==='HEAD'?undefined:asset);return
    }
    if((req.method==='GET'||req.method==='HEAD')&&path==='/chat'){
      res.setHeader('content-security-policy',"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self' data:; frame-ancestors 'none'")
      res.setHeader('content-type','text/html; charset=utf-8')
      const page=account.authorized(req)?chatPage():accountPage
      res.end(req.method==='HEAD'?undefined:page);return
    }
    if ((req.method === 'GET' || req.method === 'HEAD') && ['/', '/configure', '/configure/', '/auth', '/account', '/usage', '/router-management', '/memory-workbench', '/webhook-workbench', '/router-proactive'].includes(path)) {
      if(path==='/memory-workbench'){res.writeHead(302,{location:'/configure#advanced/memory','cache-control':'no-store'});res.end();return}
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'" })
      const page=path==='/usage'?configurationPage:path==='/auth'||path==='/account'||!account.authorized(req)?accountPage:path==='/webhook-workbench'?webhookWorkbenchPage:path==='/router-management'?routerManagementPage:path==='/router-proactive'?routerProactivePage:chatPage()
      res.end(req.method==='HEAD'?undefined:page)
      return
    }
    if ((req.method === 'GET' || req.method === 'HEAD') && path === '/health') { send(res, 200, { ok: !unavailable, version: '0.10.0',...(changing?{restarting:true}:{}) }); return }
    if(req.method==='GET'&&path==='/connect-info'){
      if(account.configured&&!browserOperator&&!authorized(req)){send(res,401,{code:'account_login_required'});return}
      send(res,200,{connectionFile,preview:options.configurationPreview===true});return
    }
    if(req.method==='GET'&&path==='/session'){send(res,200,{operator:authorized(req)||browserOperator,...(account.configured?{account:account.status(req)}:{})});return}
    if(req.method==='GET'&&path==='/account/status'){send(res,200,account.status(req,authorized(req)||sessions.authorized(req)));return}
    if(req.method==='POST'&&path.startsWith('/account/')){
      if(req.headers.origin!==requestOrigin&&!authorized(req)){send(res,403,{code:'same_origin_required'});return}
      if(path==='/account/setup'){
        if(!authorized(req)&&!sessions.authorized(req))throw new AccountError('account_setup_link_required','Open the setup link printed by the local launcher.',403)
        const result=await account.setup(setupAccountSchema.parse(await body(req)),res)
        sessions.revokeAll();send(res,201,result);return
      }
      if(path==='/account/login'){send(res,200,await account.login(loginAccountSchema.parse(await body(req)),res));return}
      if(path==='/account/recover'){send(res,200,await account.recover(recoverAccountSchema.parse(await body(req)),res));return}
      if(!account.authorized(req))throw new AccountError('account_login_required','Sign in to your account.',401)
      if(path==='/account/logout'||path==='/account/logout-all'){send(res,200,account.logout(req,res,path==='/account/logout-all'));return}
      if(path==='/account/profile'){
        const input=z.object({displayName:z.string().trim().min(1).max(60)}).strict().parse(await body(req));send(res,200,account.updateProfile(req,input.displayName));return
      }
      if(path==='/account/password'){
        const input=z.object({currentPassword:z.string().min(1).max(128),password:passwordSchema}).strict().parse(await body(req));send(res,200,await account.changePassword(req,res,input.currentPassword,input.password));return
      }
      if(path==='/account/recovery-code'){
        const input=z.object({currentPassword:z.string().min(1).max(128)}).strict().parse(await body(req));send(res,200,await account.replaceRecovery(req,input.currentPassword));return
      }
      send(res,404,{code:'not_found'});return
    }
    if(req.method==='POST'&&path==='/pair'){
      if(req.headers.origin!==requestOrigin){send(res,403,{code:'same_origin_required'});return}
      const input=z.object({code:z.string().min(32).max(100)}).strict().parse(await body(req))
      const paired=account.configured?sessions.consume(input.code):sessions.pair(input.code,res)
      send(res,paired?200:401,{operator:paired&&(!account.configured||account.authorized(req)),...(account.configured?{loginRequired:!account.authorized(req)}:{}),...(!paired?{code:'pair_expired'}:{})});return
    }
    if(req.method==='GET'&&path==='/entry-guide'){send(res,200,entries.publicGuide());return}
    if(req.method==='POST'&&path==='/entry-guide'){const input=z.object({invite:z.string().min(20).max(100)}).strict().parse(await body(req));send(res,200,await entries.invitation(input.invite));return}
    if(changing||unavailable){send(res,503,{error:'The host is applying configuration. Please try again shortly.',code:unavailable?'setup_recovery_required':'configuration_restarting'});return}
    const operator=authorized(req)||browserOperator
    if(['POST','PATCH'].includes(req.method??'')&&!authorized(req)&&browserOperator&&req.headers.origin!==requestOrigin){send(res,403,{code:'same_origin_required'});return}
    if(options.configurationPreview&&req.method==='POST'&&!['/settings','/prompt-preview','/setup-check','/onboarding/plan','/onboarding/check','/onboarding/apply','/entry-setup/probe','/entry-setup/plan','/entry-setup/apply','/entry-setup/model/plan','/entry-setup/model/check','/entry-setup/model/apply','/entry-setup/verification','/operator-link','/logout'].includes(path)){
      if(!operator){send(res,401,{error:'Access token required',code:'token_required'});return}
      send(res,403,{error:'This configuration preview cannot execute work or external actions',code:'preview_restricted'});return
    }
    if(req.method==='POST'&&path==='/worker'){
      const owner=runtime.workerTools.authenticate(req.headers.authorization)
      const input=z.object({name:z.string(),args:z.unknown()}).strict().parse(await body(req))
      send(res,200,await runtime.workerTools.call(owner,input.name,input.args));return
    }
    // Connector identities may only submit to their configured source.
    if (req.method === 'POST' && path.startsWith('/events/')) {
      const id = decodeURIComponent(path.slice('/events/'.length))
      const source = runtime.sources.get(id)?.config
      const secret = source?.tokenEnv && process.env[source.tokenEnv]
      if (!source || source.kind === 'local' || !secret || !authorized(req, secret)) { send(res, 401, { error: 'Unauthorized connector' }); return }
      const input = z.object({ actor: z.string().min(1).max(300), human: z.boolean(), event: incomingSchema }).strict().parse(await body(req))
      send(res, 202, runtime.receive(id, input.actor, input.event, input.human))
      return
    }
    if(path==='/watchdog/snapshot'||path==='/watchdog/recover'||path==='/watchdog/heartbeat'){
      if(!authorized(req,watchdogToken)){send(res,401,{error:'Dedicated watchdog credential required'});return}
      if(req.method==='GET'&&path==='/watchdog/snapshot'){send(res,200,runtime.watchdog.snapshot(true));return}
      if(req.method==='POST'&&path==='/watchdog/recover'){send(res,200,runtime.watchdog.accept(await body(req)));return}
      if(req.method==='POST'&&path==='/watchdog/heartbeat'){
        const value=z.object({at:z.number(),instanceId:z.string(),observed:z.number().int().nonnegative(),unavailable:z.number().int().nonnegative(),reviews:z.number().int().nonnegative(),pending:z.number().int().nonnegative()}).strict().parse(await body(req))
        if(value.instanceId!==runtime.watchdog.instanceId)throw Error('Watchdog heartbeat belongs to an old host')
        runtime.store.put('health','watchdog',{...value,receivedAt:Date.now()});send(res,200,{ok:true});return
      }
      send(res,405,{error:'Method not allowed'});return
    }
    if (!operator) { send(res, 401, { error: 'Operator access required',code:'token_required' }); return }
    if(path==='/deployment/maintenance'&&req.method==='POST'){send(res,200,await deploymentMaintenance(runtime,await body(req)));return}
    if(path==='/webhooks'&&req.method==='GET'){send(res,200,runtime.webhooks.snapshot());return}
    if(path==='/webhooks/detail'&&req.method==='GET'){send(res,200,runtime.webhooks.detail(new URL(req.url??'/',requestOrigin).searchParams.get('id')??''));return}
    if(path==='/webhooks/goal'&&req.method==='POST'){send(res,200,runtime.webhooks.goalControl(await body(req)));return}
    if(path==='/webhooks/replay'&&req.method==='POST'){send(res,200,runtime.webhooks.replay(await body(req)));return}
    if(path==='/webhooks/rotate'&&req.method==='POST'){send(res,200,runtime.webhooks.rotate(await body(req)));return}
    if(path==='/webhooks/dry-run'&&req.method==='POST'){send(res,200,runtime.webhooks.dryRun(await body(req)));return}
    if(path==='/webhooks/reconcile'&&req.method==='POST'){runtime.webhooks.reconcile(true);send(res,200,runtime.webhooks.snapshot().reconciliation);return}
    if(path==='/webhooks/grants'&&req.method==='POST'){send(res,201,runtime.webhooks.create(await body(req)));return}
    if(path==='/webhooks/control'&&req.method==='POST'){send(res,200,runtime.webhooks.control(await body(req)));return}
    if(path==='/deployments'&&req.method==='GET'){send(res,200,runtime.delegation.snapshot());return}
    if(path==='/deployments/pairing'&&req.method==='POST'){send(res,200,runtime.delegation.pairing(await body(req)));return}
    if(path==='/deployments/connect'&&req.method==='POST'){send(res,200,await runtime.delegation.connect(await body(req)));return}
    if(path==='/deployments/command'&&req.method==='POST'){send(res,200,await runtime.delegation.command(await body(req)));return}
    if(path==='/deployments/recover'&&req.method==='POST'){const result=await runtime.delegation.recover(await body(req));delegationServer=await serveDelegation(runtime.delegation,runtime.delegation.preferredPort);send(res,200,result);return}
    if(path==='/deployments/revoke'&&req.method==='POST'){const input=z.object({id:z.string()}).strict().parse(await body(req));send(res,200,await runtime.delegation.revoke(input.id));return}
    if(path==='/api/plugin-market'&&req.method==='GET'){send(res,200,{...market.snapshot(),platform:process.platform,settingsRevision:runtime.settings.current().revision});return}
    if(path==='/api/plugin-market/preview'&&req.method==='GET'){
      const query=z.object({catalog:z.string().max(80),plugin:z.string().max(64),index:z.coerce.number().int().min(0).max(3)}).strict().parse(Object.fromEntries(new URL(req.url!,'http://localhost').searchParams))
      const preview=await market.preview(query.catalog,query.plugin,query.index);res.writeHead(200,{'content-type':preview.type});res.end(preview.bytes);return
    }
    if(path==='/api/plugin-market/catalogs'&&req.method==='POST'){
      const input=z.object({url:z.string().url().max(800).optional(),tokenEnv:z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/).max(100).optional(),remove:z.string().max(80).optional()}).strict().parse(await body(req))
      send(res,200,await market.catalogs(input));return
    }
    if(path==='/api/plugin-market/plan'&&req.method==='POST'){send(res,200,market.plan(await body(req)));return}
    if(path==='/api/plugin-market/execute'&&req.method==='POST'){
      const input=z.object({planId:z.string().uuid(),requestId:z.string().uuid()}).strict().parse(await body(req))
      const plan=runtime.store.get<any>('plugin-market-plan',input.planId)
      if(plan?.action!=='install')changing=true
      try{send(res,200,await market.execute(input.planId,input.requestId,rebuild))}finally{changing=false}return
    }
    if(path.startsWith('/api/plugin-market/manifest/')&&req.method==='GET'){send(res,200,market.manifest(path.slice('/api/plugin-market/manifest/'.length)));return}
    if(path==='/api/plugin-market/connection/plan'&&req.method==='POST'){
      const input=z.object({pluginId:z.string(),revision:z.number().int().nonnegative(),label:z.string().min(1).max(100),actors:z.array(z.string().min(1).max(200)).min(1).max(100),options:z.record(z.string(),z.unknown()),credentials:z.record(z.string(),z.string().min(1).max(16000)).default({})}).strict().parse(await body(req))
      const manifest=market.manifest(input.pluginId),credentials:Record<string,string>={},values=structuredClone(input.options)
      for(const [key,value]of Object.entries(input.credentials)){
        const path=manifest.credentials[key];if(!path||!/^\/options\/[A-Za-z_][A-Za-z0-9_]*$/.test(path))throw Error('This credential needs advanced source configuration')
        const env='AGENTHUB_SETUP_PLUGIN_'+randomUUID().replaceAll('-','').toUpperCase()+'_'+key
        values[path.split('/')[2]!]=env;credentials[env]=value
      }
      const source=configSchema.shape.sources.element.parse({id:'app-'+randomUUID().slice(0,8),kind:manifest.kind,label:input.label,options:values,allowedActors:input.actors,cwd:runtime.config.sources[0]!.cwd,sandbox:'read-only'})
      const validator=new Ajv2020({strict:false,validateFormats:false}).compile(manifest.configSchema)
      if(!validator(source))throw Error('Connection fields do not match the plugin schema: '+JSON.stringify(validator.errors?.map(e=>({path:e.instancePath,message:e.message}))))
      send(res,200,onboarding.sourcePlan(input.revision,source,credentials));return
    }
    if(path==='/api/plugin-market/connection/apply'&&req.method==='POST'){
      const input=z.object({id:z.string().uuid()}).strict().parse(await body(req));changing=true
      try{send(res,200,await onboarding.apply(input.id,rebuild))}finally{changing=false}return
    }
    if(path==='/api/workspace-views'||path.startsWith('/api/workspace-views/')){
      if(req.method!=='GET'){send(res,405,{code:'method_not_allowed'});return}
      if(path==='/api/workspace-views'){send(res,200,{views:viewCatalog(runtime.config)});return}
      const match=path.match(/^\/api\/workspace-views\/([a-z][a-z0-9_-]{0,63})\/(bundle|runtime)$/)
      if(!match){send(res,404,{code:'view_not_found'});return}
      const params=new URL(req.url!,'http://localhost').searchParams,digest=params.get('digest')
      if(!digest||!/^[a-f0-9]{64}$/.test(digest)){send(res,400,{code:'view_digest_required'});return}
      let pkg
      try{pkg=enabledView(runtime.config,match[1]!,digest)}catch{send(res,404,{code:'view_unavailable'});return}
      if(match[2]==='bundle'){send(res,200,{digest:pkg.digest,code:pkg.code});return}
      if(!pkg.manifest.capabilities.includes('workspace.runtime.read')){send(res,403,{code:'view_capability_required'});return}
      params.delete('digest')
      const query=viewQuerySchema.parse(Object.fromEntries(params))
      if(query.source&&!runtime.config.sources.some(s=>s.id===query.source)){send(res,400,{code:'view_source_unknown'});return}
      send(res,200,workspaceViewData(runtime,query,account.status(req).user?.id??'local-operator'));return
    }
    if(req.method==='GET'&&path==='/router-management/catalog'){
      send(res,200,{sources:runtime.config.sources.filter(s=>s.enabled).map(s=>({id:s.id,name:s.label??s.id,kind:s.kind})),workers:runtime.manager.list().workers.map(w=>({id:w.id,label:w.label})),backends:[...new Set(runtime.manager.list().workers.map(w=>w.backend))],tasks:runtime.store.tickets.list().map(t=>({id:t.id,title:t.title})),contexts:runtime.store.list<any>('router-admission').filter(a=>a.state==='accepted'&&runtime.store.get<any>('router-route',a.triggerId)&&!runtime.scopes.binding(runtime.store.get<any>('router-route',a.triggerId).entryId).privateActor&&runtime.scopes.sourceActive(runtime.scopes.binding(runtime.store.get<any>('router-route',a.triggerId).entryId))).map(a=>{const route=runtime.store.get<any>('router-route',a.triggerId),entry=runtime.scopes.binding(route.entryId);return {id:a.triggerId,scopeId:route.scopeId,entryId:entry.id,title:runtime.store.triggers.get(a.triggerId)?.text.slice(0,70),conversationId:runtime.store.get<any>('chat-run',a.triggerId)?.conversationId,label:entry.nativeId+' · '+a.at}})});return
    }
    if(req.method==='GET'&&path==='/router-scopes'){send(res,200,runtime.scopes.snapshot());return}
    if(req.method==='GET'&&path==='/router-proactive/state'){send(res,200,runtime.proactive.snapshot(new URL(req.url!,'http://localhost').searchParams.get('scopeId')??''));return}
    if(req.method==='GET'&&path.startsWith('/goal-artifacts/')){
      const {artifact,bytes}=runtime.artifacts.download(path.slice('/goal-artifacts/'.length))
      res.writeHead(200,{'content-type':artifact.mime,'content-disposition':"attachment; filename*=UTF-8''"+encodeURIComponent(artifact.path.split('/').at(-1)!),'cache-control':'no-store','x-content-type-options':'nosniff'})
      res.end(bytes);return
    }
    const projectRoute=path.match(/^\/project-reviews\/([a-f0-9]{16})(?:\/(bundle|patch))?$/)
    if(projectRoute){
      const id=projectRoute[1]!,kind=projectRoute[2] as 'bundle'|'patch'|undefined
      if(req.method==='GET'&&kind){
        const goal=runtime.goals.operatorReview(id),file=runtime.projectCode.file(goal,kind)
        const size=statSync(file).size
        res.writeHead(200,{'content-type':'application/octet-stream','content-length':size,'content-disposition':'attachment; filename="'+goal.project!.review!.head+'.'+kind+'"','cache-control':'no-store','x-content-type-options':'nosniff'})
        const stream=createReadStream(file);stream.on('error',e=>res.destroy(e));res.on('close',()=>stream.destroy());stream.pipe(res);return
      }
      if(req.method==='POST'&&!kind){
        const input=z.object({decision:z.enum(['approve','return']),feedback:z.string().trim().min(1).max(4000).optional()}).strict().parse(await operatorBody(req))
        send(res,200,runtime.goals.decideOperator(id,input.decision,account.status(req).user?.id??'local-operator',input.feedback));return
      }
    }
    if(req.method==='POST'&&path==='/workflow-actions'){
      const operatorId=account.status(req).user?.id??'local-operator'
      send(res,200,await runtime.workflows.decide(await body(req),{operatorId,authorize:()=>requireCurrentOperator(req)}));return
    }
    if(req.method==='POST'&&path==='/router-skills/read'){send(res,200,runtime.skills.read(await operatorBody(req)));return}
    if(req.method==='POST'&&path==='/router-skills'){send(res,200,runtime.skills.command(await operatorBody(req)));return}
    if(req.method==='POST'&&path==='/router-proactive'){send(res,200,runtime.proactive.command(await body(req)));return}
    if(req.method==='GET'&&path==='/router-cleanup'){send(res,200,{items:runtime.memory.cleanup.receipts()});return}
    if(req.method==='POST'&&path==='/router-scopes'){send(res,200,await runtime.scopeCommand(await body(req)));return}
    if(req.method==='POST'&&path==='/agent-memory'){
      const input=z.object({triggerId:z.string(),command:z.any()}).strict().parse(await body(req))
      const trigger=runtime.store.triggers.get(input.triggerId);if(!trigger)throw Error('Known authorized input required')
      runtime.routerIngress.authority(trigger.id)
      const context=runtime.scopes.context(trigger,trigger.source+':'+trigger.threads[0]!.id);if(!context)throw Error('Configure Router scopes first')
      if(runtime.scopes.binding(context.route.entryId).privateActor)throw Error('Private memory requires the actual member identity')
      send(res,200,input.command?.action==='consolidate'?await runtime.agentMemory.consolidate(context):input.command?.action==='search'?await runtime.agentMemory.tool(context,{...input.command,action:'query'}):runtime.agentMemory.manage(context,input.command));return
    }
    if(req.method==='POST'&&path==='/router-memory'){
      const input=z.object({triggerId:z.string(),query:z.unknown().optional(),command:z.unknown().optional(),suppressions:z.boolean().optional()}).strict().parse(await body(req))
      const trigger=runtime.store.triggers.get(input.triggerId);if(!trigger)throw Error('Known authorized input required')
      runtime.routerIngress.authority(trigger.id)
      const context=runtime.scopes.context(trigger,trigger.source+':'+trigger.threads[0]!.id);if(!context)throw Error('Configure Router scopes first')
      if(runtime.scopes.binding(context.route.entryId).privateActor)throw Error('Private memory requires the actual member identity; operator access cannot impersonate a saved message author')
      runtime.memory.ingest(context)
      send(res,200,input.suppressions?{items:runtime.memory.suppressions(context)}:input.command?runtime.memory.command(context,input.command,true):runtime.memory.query(context,input.query??{}));return
    }
    if(req.method==='POST'&&['/router-knowledge','/router-journal','/router-goals'].includes(path)){
      const input=z.object({triggerId:z.string(),command:z.unknown()}).strict().parse(await body(req))
      const trigger=runtime.store.triggers.get(input.triggerId);if(!trigger)throw Error('Known authorized input required')
      runtime.routerIngress.authority(trigger.id)
      const context=runtime.scopes.context(trigger,trigger.source+':'+trigger.threads[0]!.id);if(!context)throw Error('Configure Router scopes first')
      if(runtime.scopes.binding(context.route.entryId).privateActor)throw Error('Private context requires the actual member identity; operator access cannot impersonate a saved message author')
      const target=path==='/router-knowledge'?runtime.knowledge:path==='/router-journal'?runtime.continuity:runtime.goals
      send(res,200,target.command(input.command,context));return
    }
    if(path==='/api/browser'||path.startsWith('/api/browser/')){
      await browserRequest(runtime,account.status(req).user?.id??'local-operator',req,res,()=>body(req),()=>!changing&&!unavailable&&!stopping&&(authorized(req)||(account.configured?account.authorized(req):sessions.authorized(req))));return
    }
    if(path.startsWith('/api/chat/')){
      if(options.configurationPreview&&req.method!=='GET'){send(res,403,{code:'preview_restricted'});return}
      const owner=account.status(req).user?.id??'local-operator'
      const query=new URL(req.url!,'http://localhost').searchParams
      if(path==='/api/chat/readiness'&&req.method==='GET'){send(res,200,{...runtime.chat.readiness(),...(options.configurationPreview?{ready:false,code:'preview_restricted'}:{}),user:account.status(req).user??null});return}
      if(path==='/api/chat/space'){
        if(req.method==='GET'){send(res,200,runtime.chat.space(owner));return}
        if(req.method==='POST'){send(res,200,runtime.chat.space(owner,true));return}
        if(req.method==='PATCH'){const input=z.object({display:z.enum(['group','agents'])}).strict().parse(await body(req));send(res,200,runtime.chat.display(owner,input.display));return}
      }
      if(path==='/api/chat/reset'&&req.method==='POST'){
        const input=z.object({operationId:z.string().uuid()}).strict().parse(await body(req))
        send(res,202,runtime.chat.reset(owner,input.operationId));return
      }
      if(path==='/api/chat/conversations'){
        if(req.method==='GET'){send(res,200,{conversations:runtime.chat.list(owner,query.get('archived')==='true')});return}
        if(req.method==='POST'){send(res,201,runtime.chat.create(owner));return}
      }
      const match=path.match(/^\/api\/chat\/conversations\/([a-f0-9-]{36})(?:\/(messages|events|cancel|files|memory))?$/)
      if(match){
        const id=match[1]!,action=match[2]
        if(action==='memory'&&req.method==='GET'){send(res,200,runtime.chat.memory(id,owner));return}
        if(action==='memory'&&req.method==='POST'){
          const input=z.object({kind:z.enum(['manage','memory']),command:z.unknown()}).strict().parse(await body(req))
          send(res,200,runtime.chat.memory(id,owner,input));return
        }
        if(!action&&req.method==='PATCH'){
          const patch=z.object({title:z.string().trim().min(1).max(100).optional(),archived:z.boolean().optional()}).strict().parse(await body(req))
          send(res,200,runtime.chat.update(id,owner,patch));return
        }
        if((!action||action==='messages')&&req.method==='GET'){
          const before=query.has('before')?z.coerce.number().int().positive().parse(query.get('before')):undefined
          const participant=query.has('participant')?z.string().min(1).max(300).parse(query.get('participant')):undefined
          send(res,200,runtime.chat.view(id,owner,before,participant));return
        }
        if(action==='files'&&req.method==='GET'){
          const input=z.object({ticket:z.string().min(1).optional(),path:z.string().max(1800).optional(),kind:z.enum(['directory','files']).optional(),offset:z.coerce.number().int().nonnegative().optional(),cursor:z.string().uuid().optional()}).strict().parse(Object.fromEntries(query))
          send(res,200,await runtime.chat.files(id,owner,input));return
        }
        if(action==='messages'&&req.method==='POST'){
          const input=z.object({text:z.string().trim().min(1).max(100000),clientMessageId:z.string().uuid()}).strict().parse(await body(req))
          send(res,202,runtime.chat.send(id,owner,input));return
        }
        if(action==='cancel'&&req.method==='POST'){
          const input=z.object({runId:z.string().min(1).max(500)}).strict().parse(await body(req))
          send(res,200,await runtime.chat.cancel(id,owner,input.runId));return
        }
        if(action==='events'&&req.method==='GET'){
          runtime.chat.view(id,owner)
          res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache','connection':'keep-alive','x-accel-buffering':'no'});res.flushHeaders()
          let last=String(req.headers['last-event-id']??''),heartbeat=0
          const update=()=>{
            if(res.writableEnded||res.destroyed)return
            if(res.writableLength>131072){res.end();return}
            if(changing||unavailable||stopping||!authorized(req)&&!(account.configured?account.authorized(req):sessions.authorized(req))){res.write('event: reconnect\ndata: {}\n\n');res.end();return}
            try{
              const revision=String(runtime.chat.revision(id,owner))
              if(revision!==last){last=revision;res.write('id: '+revision+'\nevent: change\ndata: '+JSON.stringify({revision})+'\n\n')}
              else if(++heartbeat%20===0)res.write(': keepalive\n\n')
            }catch(error){if(error instanceof ChatError&&error.code==='conversation_reset')res.write('event: reset\ndata: {}\n\n');res.end()}
          }
          const unsubscribe=runtime.chat.subscribe(id,owner,update)
          const timer=setInterval(update,750);timer.unref();res.on('close',()=>{clearInterval(timer);unsubscribe()});update();return
        }
      }
      send(res,404,{code:'not_found'});return
    }
    if(req.method==='GET'&&path==='/integrations'){send(res,200,{adapters:runtime.sourceRegistry.catalog(),sources:runtime.config.sources.map(s=>({id:s.id,kind:s.kind,enabled:s.enabled,capabilities:s.capabilities})),tools:runtime.toolConnections.configured()});return}
    if(req.method==='POST'&&path==='/workers'){send(res,200,await runtime.manager.call(await body(req)));return}
    if(req.method==='GET'&&path==='/workers'){send(res,200,runtime.manager.list());return}
    if(req.method==='GET'&&path==='/subscription/accounts'){send(res,200,runtime.subscriptions.list());return}
    if(req.method==='POST'&&path==='/subscription/login'){const input=z.object({account:z.string()}).strict().parse(await body(req));send(res,200,await runtime.subscriptions.begin(input.account));return}
    if(req.method==='POST'&&path==='/subscription/status'){const input=z.object({attempt:z.string()}).strict().parse(await body(req));send(res,200,runtime.subscriptions.status(input.attempt));return}
    if(req.method==='POST'&&path==='/subscription/logout'){const input=z.object({account:z.string()}).strict().parse(await body(req));send(res,200,await runtime.subscriptions.logout(input.account));return}
    if(req.method==='POST'&&path==='/subscription/models'){const input=z.object({account:z.string()}).strict().parse(await body(req));send(res,200,await runtime.subscriptions.models(input.account));return}
    if(req.method==='POST'&&path==='/operator-link'){send(res,200,{url:sessions.link(runtime.config.http?.publicOrigin??endpoint),expiresIn:600});return}
    if(req.method==='POST'&&path==='/logout'){if(account.configured)account.logout(req,res);else sessions.logout(req,res);send(res,200,{operator:false});return}
    if(req.method==='GET'&&path==='/entry-setup'){send(res,200,await entries.info());return}
    if(req.method==='GET'&&path==='/entry-workspace'){
      const query=new URL(req.url!,'http://localhost').searchParams,input=z.object({offset:z.coerce.number().int().min(0).default(0),limit:z.coerce.number().int().min(1).max(100).default(25),
        state:z.enum(['attention','running','replied','ready','closed','queued']).optional(),search:z.string().max(200).optional()}).parse(Object.fromEntries(query))
      send(res,200,operatorWorkspace(runtime,input.offset,input.limit,{state:input.state,search:input.search}));return
    }
    if(req.method==='GET'&&path.startsWith('/entry-workspace/task/')){
      const task=operatorTask(runtime,decodeURIComponent(path.slice('/entry-workspace/task/'.length)));send(res,task?200:404,task??{code:'task_missing',error:'This work is no longer available.'});return
    }
    if(req.method==='POST'&&path==='/entry-setup/probe'){const input=z.object({entryId:z.enum(entryIds),credentials:z.object({appId:z.string().trim().min(1).max(16000).optional(),appSecret:z.string().trim().min(1).max(16000).optional()}).strict().optional()}).strict().parse(await body(req));send(res,200,await entries.probe(input.entryId,input.credentials));return}
    if(req.method==='POST'&&path==='/entry-setup/plan'){send(res,200,entries.plan(await body(req)));return}
    if(req.method==='POST'&&path==='/entry-setup/model/plan'){send(res,200,onboarding.connectionPlan(await body(req)));return}
    if(req.method==='POST'&&path==='/entry-setup/model/check'){const input=z.object({id:z.string().uuid()}).strict().parse(await body(req));send(res,200,await onboarding.check(input.id));return}
    if(req.method==='POST'&&(path==='/entry-setup/apply'||path==='/entry-setup/model/apply')){
      const input=z.object({id:z.string().uuid()}).strict().parse(await body(req));changing=true
      try{send(res,200,await entries.apply(input.id,rebuild))}finally{changing=false}return
    }
    if(req.method==='POST'&&path==='/entry-setup/install'){const input=z.object({entryId:z.enum(entryIds)}).strict().parse(await body(req));send(res,200,await entries.install(input.entryId));return}
    if(req.method==='GET'&&path==='/entry-setup/client-config'){const id=new URL(req.url!,'http://localhost').searchParams.get('entryId');send(res,200,entries.clientConfig(z.enum(entryIds).parse(id)));return}
    if(req.method==='POST'&&path==='/entry-setup/verification'){const input=z.object({entryId:z.enum(entryIds),sourceId:z.string().optional(),language:z.enum(['en','zh']).default('en')}).strict().parse(await body(req));send(res,200,entries.beginVerification(input.entryId,input.sourceId,input.language));return}
    if(req.method==='GET'&&path.startsWith('/entry-setup/verification/')){send(res,200,entries.verification(path.slice('/entry-setup/verification/'.length)));return}
    if(req.method==='POST'&&path==='/entry-setup/allow'){const input=z.object({revision:z.number().int(),sourceId:z.string(),actor:z.string()}).strict().parse(await body(req));send(res,200,entries.allow(input.revision,input.sourceId,input.actor));return}
    if(req.method==='POST'&&path==='/entry-setup/share'){const input=z.object({entryIds:z.array(z.enum(entryIds)).min(1).max(20)}).strict().parse(await body(req));send(res,200,await entries.share(input.entryIds));return}
    if(req.method==='GET'&&path==='/onboarding'){send(res,200,onboarding.info());return}
    if(req.method==='POST'&&path==='/onboarding/plan'){send(res,200,onboarding.plan(await body(req)));return}
    if(req.method==='POST'&&path==='/onboarding/check'){const input=z.object({id:z.string().uuid()}).strict().parse(await body(req));send(res,200,await onboarding.check(input.id));return}
    if(req.method==='POST'&&path==='/onboarding/apply'){
      const input=z.object({id:z.string().uuid()}).strict().parse(await body(req));if(changing)throw new OnboardingError('configuration_busy','Another setup is being applied.',409);changing=true
      try{send(res,200,await onboarding.apply(input.id,rebuild))}finally{changing=false}
      return
    }
    if(req.method==='POST'&&path==='/decision/probe'){
      const input=z.object({config:decisionConfigSchema,text:z.string().min(1).max(4000)}).strict().parse(await body(req))
      if(options.configurationPreview){send(res,403,{code:'preview_restricted'});return}
      send(res,200,await runtime.decision.probe(input.config,input.text));return
    }
    if(req.method==='GET'&&path==='/decision/calls'){send(res,200,runtime.decision.records());return}
    if(req.method==='GET'&&path==='/configuration'){send(res,200,{...configurationSnapshot(runtime),preview:options.configurationPreview===true});return}
    if(req.method==='POST'&&path==='/merge-authorize'){
      const input=z.object({id:z.string(),source:z.string(),number:z.number().int().positive(),head:z.string().regex(/^[a-f0-9]{40}$/)}).strict().parse(await body(req))
      send(res,200,await runtime.merger.authorize(input.id,input.source,input.number,input.head));return
    }
    if(req.method==='POST'&&path==='/merge-revoke'){
      const input=z.object({source:z.string(),number:z.number().int().positive()}).strict().parse(await body(req))
      runtime.merger.revoke(input.source,input.number);send(res,200,{ok:true});return
    }
    if(req.method==='POST'&&path==='/setup-check'){send(res,200,await runtime.setup.check());return}
    if(req.method==='POST'&&path==='/members-preview'){const input=z.object({source:z.string(),scope:z.string().optional()}).strict().parse(await body(req));send(res,200,await runtime.setup.previewMembers(input.source,input.scope));return}
    if(req.method==='POST'&&path==='/members-apply'){const input=z.object({id:z.string()}).strict().parse(await body(req));send(res,200,runtime.setup.applyMembers(input.id));return}
    if(req.method==='POST'&&path==='/read'){const {ticketId,...input}=readSchema.extend({ticketId:z.string().optional()}).parse(await body(req));send(res,200,await runtime.resources.read(input,ticketId?{ticketId}:{}));return}
    if(req.method==='POST'&&path==='/prompt-preview'){
      const input=z.object({role:z.enum(['router','worker']),mode:z.enum(previewModes).optional(),sourceId:z.string().optional(),workerId:z.string().optional(),prompts:patchSchema.shape.prompts,execution:patchSchema.shape.execution,backends:patchSchema.shape.backends}).strict().parse(await body(req)),id=randomUUID()
      const previewConfig={...runtime.config,...(input.prompts?{prompts:input.prompts}:{}),...(input.execution?{execution:input.execution}:{}),...(input.backends?{backends:input.backends}:{})}
      const result={id,...runtime.previewPrompt(input,previewConfig),revision:runtime.settings.current().revision,at:Date.now()};runtime.store.put('prompt-preview',id,result);send(res,200,{...result,resource:'prompt-preview/'+id});return
    }
    if(req.method==='GET'&&path==='/prompts'){send(res,200,{parts:promptStatus(runtime.config),history:runtime.store.list('prompt-use')});return}
    if(req.method==='POST'&&path==='/source-replay'){
      const input=z.object({source:z.string(),scope:z.string().optional(),since:z.string().datetime()}).strict().parse(await body(req))
      const source=runtime.sources.get(input.source)
      if(!source)throw Error('Unknown source')
      if(!source.replay)throw Error('This adapter does not support polling replay; resend original event IDs through its event transport')
      const cursor=source.replay(input.scope,input.since)
      runtime.store.put('source-cursor',cursor.key,{since:cursor.since})
      send(res,200,{ok:true});return
    }
    if(req.method==='POST'&&path==='/retry-delivery'){
      const input=z.object({id:z.string()}).strict().parse(await body(req))
      runtime.store.retryDelivery(input.id);send(res,200,{ok:true});return
    }
    if(req.method==='POST'&&path==='/deliver-pr'){
      const input=z.object({id:z.string(),source:z.string(),title:z.string().min(1),body:z.string()}).strict().parse(await body(req))
      send(res,200,await deliverDraft(runtime,input.id,input.source,input.title,input.body));return
    }
    if(req.method==='POST'&&path==='/domain'){
      const input=z.object({action:z.enum(['reevaluate','attach','bind','context','unrelated','unsubscribe','note','dismiss']),id:z.string(),source:z.string().optional(),thread:z.string().optional(),triggerId:z.string().optional(),text:z.string().optional()}).strict().parse(await body(req))
      if(input.action==='reevaluate')runtime.engine.reevaluate(input.id)
      else if(input.action==='dismiss')runtime.engine.dismiss(input.id)
      else if(input.action==='unsubscribe')runtime.engine.unsubscribe(input.id)
      else if(input.action==='note')runtime.engine.note(input.id,input.text??'')
      else if(input.action==='attach'){if(!input.triggerId)throw Error('triggerId required');runtime.engine.attach(input.id,input.triggerId)}
      else {
        if(!input.source||!input.thread)throw Error('source and thread required')
        const source=runtime.sources.get(input.source);if(!source)throw Error('Unknown source')
        if(source.validThread&&!source.validThread(input.thread))throw Error('Thread is outside configured source')
        if(input.action==='bind')runtime.engine.bindThread(input.id,{source:input.source,id:input.thread},true)
        else if(input.action==='context')runtime.engine.followForContext(input.id,{source:input.source,id:input.thread})
        else runtime.engine.markUnrelated(input.id,input.source+':'+input.thread,input.text??'Unrelated')
      }
      send(res,200,{ok:true});return
    }
    if(req.method==='GET'&&path==='/settings'){send(res,200,{current:runtime.settings.current(),history:runtime.settings.history()});return}
    if(req.method==='POST'&&path==='/settings'){
      const input=z.object({revision:z.number().int(),patch:z.unknown()}).strict().parse(await body(req))
      send(res,200,runtime.updateSettings(input.revision,input.patch));return
    }
    if(req.method==='POST'&&path==='/approval'){
      const input=z.object({id:z.string(),answer:z.unknown()}).strict().parse(await body(req))
      runtime.approvals.answer(input.id,input.answer);send(res,200,{ok:true});return
    }
    if(req.method==='POST'&&path==='/steer'){
      const input=z.object({id:z.string(),text:z.string().min(1).max(10000)}).strict().parse(await body(req))
      await runtime.steer(input.id,input.text);send(res,200,{accepted:true});return
    }
    if(req.method==='POST'&&path==='/watchdog'){
      const input=z.object({at:z.number(),uncertain:z.array(z.string()),stalled:z.array(z.string()).default([])}).strict().parse(await body(req))
      runtime.store.put('health','watchdog',input);send(res,200,{ok:true});return
    }
    if(req.method==='POST'&&path==='/context'){
      const input=z.object({source:z.string(),thread:z.string()}).strict().parse(await body(req))
      if(input.source==='$agent'){send(res,200,await runtime.resources.read({resource:input.thread}));return}
      const source=runtime.sources.get(input.source)
      if(!source?.context||!source.config.enabled||!source.config.capabilities.resources)throw Error('Source does not provide enabled context reading')
      send(res,200,await source.context(input.thread));return
    }
    if (req.method === 'GET' && path === '/status') {
      const status=runtime.status(),client=String(req.headers['x-agenthub-client']??''),bridge=String(req.headers['x-agenthub-bridge']??''),query=new URL(req.url!,'http://localhost').searchParams
      const filter=z.object({discussion:z.string().min(1).max(300).optional(),requestId:z.string().min(1).max(200).optional()}).strict().parse(Object.fromEntries(['discussion','requestId'].filter(k=>query.has(k)).map(k=>[k,query.get(k)])))
      const compact=clientIds.includes(client as any)||!!filter.discussion||!!filter.requestId,view=compact?clientStatus(status,filter):status
      if(clientIds.includes(client as any)&&bridge.length<=100)for(const ticket of view.tickets){
        const request=runtime.store.get<any>('entry-client-event',ticket.origin.triggerId)
        if(request?.client===client&&request.bridge===bridge&&ticket.run?.phase==='idle'&&ticket.run.result&&!(ticket.run as any).replyTruncated&&ticket.run.result.length<=4000&&status.deliveries.some(d=>d.ticketId===ticket.id&&d.kind==='reply'&&d.status==='sent'))runtime.store.put('entry-client-receipt',ticket.id,{client,bridge,legacyBridge:!bridge,at:Date.now()})
      }
      send(res,200,view);return
    }
    if(req.method==='POST'&&path==='/request'){
      if(runtime.config.execution.router?.mode==='client'){send(res,409,{code:'client_router_use_worker_manage',error:'This CLI conversation is the Router. Use worker_manage list/assign/result in this conversation; no second Router model is started.'});return}
      const input=z.object({text:z.string().min(1).max(100000),discussion:z.string().min(1).max(300).optional(),requestId:z.string().min(1).max(200).optional()}).strict().parse(await body(req))
      const source=runtime.config.sources.find(s=>s.kind==='local'&&s.enabled);if(!source)throw new OnboardingError('local_entry_missing','Add a local operator source before connecting a client.')
      const discussion=input.discussion??randomUUID(),requestId=input.requestId??randomUUID(),result=runtime.receive(source.id,source.allowedActors[0]!,{id:requestId,thread:discussion,text:input.text,addressed:true}) as any
      const client=String(req.headers['x-agenthub-client']??''),bridge=String(req.headers['x-agenthub-bridge']??'').slice(0,100);if(clientIds.includes(client as any))runtime.store.put('entry-client-event',result.triggerId,{client,bridge,at:Date.now()})
      send(res,202,{...result,discussion,requestId,next:{tool:'agent_status',arguments:{discussion,requestId}}});return
    }
    if (req.method === 'POST' && path === '/send') {
      const input = z.object({ source: z.string(), event: incomingSchema }).strict().parse(await body(req))
      const source = runtime.sources.get(input.source)
      if (!source || source.config.kind !== 'local') throw new Error('Use the authenticated connector for external events')
      const result=runtime.receive(input.source, source.config.allowedActors[0]!, input.event) as any,client=String(req.headers['x-agenthub-client']??'')
      if(clientIds.includes(client as any))runtime.store.put('entry-client-event',result.triggerId,{client,bridge:String(req.headers['x-agenthub-bridge']??'').slice(0,100),at:Date.now()})
      send(res, 202, result)
      return
    }
    if (req.method === 'POST' && path === '/action') {
      const input = z.object({ action: z.enum(['pause', 'resume', 'stop', 'retry', 'takeover', 'return']), id: z.string().optional() }).strict().parse(await body(req))
      if (input.action === 'pause' || input.action === 'resume') runtime.pause(input.action === 'pause')
      else {
        if (!input.id) throw new Error('Select the work to control')
        if (input.action === 'stop') await runtime.stop(input.id)
        else if (input.action === 'retry') runtime.retry(input.id)
        else if (input.action === 'return') {
          runtime.returnControl(input.id)
          send(res,200,{ok:true,threadId:runtime.store.get<any>('run',input.id)?.threadId,next:'Release the desktop writer before retry. In Codex desktop, archive this worker chat with the official set_thread_archived tool and leave it archived, preserving history. The host unarchives it for each activation and archives it afterward. In CLI, exit codex resume. Then agent_retry resumes the same native thread.'});return
        }
        else { send(res, 200, await runtime.takeover(input.id)); return }
      }
      send(res, 200, { ok: true })
      return
    }
    send(res, 404, { error: 'Unknown endpoint' })
  }
  server.requestTimeout = 30_000
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(runtime.config.port, runtime.config.http?.listenHost??'127.0.0.1', resolve) })
  let webhookListener:Awaited<ReturnType<typeof serveWebhooks>>|undefined
  try{if(runtime.config.webhooks&&!options.configurationPreview)webhookListener=await serveWebhooks(()=>runtime,runtime.config.webhooks.port,()=>!changing&&!unavailable&&!runtimeClosed)}catch(error){server.close();throw error}
  server.once('close',()=>{void webhookListener?.close().catch(()=>{})})
  const address = server.address() as { port: number }
  runtime.endpoint='http://'+(runtime.config.http?.listenHost==='::1'?'[::1]':'127.0.0.1')+':'+address.port
  endpoint=runtime.endpoint
  sessions.bindOrigin(runtime.config.http?.publicOrigin??endpoint)
  try{atomicPrivateFile(connectionFile,JSON.stringify({application:'agent-hub',version:1,url:endpoint,accessToken:token},null,2)+'\n')}catch(error){await new Promise<void>(r=>server.close(()=>r()));throw error}
  try{delegationServer=runtime.delegation.enabled?await serveDelegation(runtime.delegation,runtime.delegation.preferredPort):undefined}catch(error){await new Promise<void>(resolve=>server.close(()=>resolve()));await runtime.close();throw error}
  runtime.start()
  return {server,url:endpoint,webhookUrl:webhookListener?.url,operatorUrl:sessions.link(runtime.config.http?.publicOrigin??endpoint),tokenPath,connectionFile,get runtime(){return runtime},async closeRuntime(){stopping=true;await webhookListener?.close().catch(()=>{});await stopRuntime()}}
}
function send(response: ServerResponse, status: number, value: unknown) {
  if (!response.headersSent) response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify(value))
}
