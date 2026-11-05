import {randomBytes,randomUUID,createHash} from 'node:crypto'
import {join} from 'node:path'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {existsSync,accessSync,constants} from 'node:fs'
import {delimiter,resolve} from 'node:path'
import {z} from 'zod'
import {configSchema,type Config} from './config.ts'
import type {Runtime} from './runtime.ts'
import {Onboarding,OnboardingError,setupWorkspace} from './onboarding.ts'
import {clientIds,clientInfo,clientConfig,type ClientId,type ClientOptions} from './clients.ts'
import {inspectClient,installEntryClient} from './client-setup.ts'

const exec=promisify(execFile),hash=(s:string)=>createHash('sha256').update(s).digest('hex')
const names:Record<string,string>={feishu:'Feishu / 飞书',wecom:'WeCom / 企业微信',codex:'Codex',cursor:'Cursor',vscode:'VS Code',workbuddy:'WorkBuddy',github:'GitHub',generic:'Other MCP clients / 其他 MCP 客户端',copilot:'Copilot CLI','claude-code':'Claude Code','claude-desktop':'Claude Desktop',gemini:'Gemini CLI',qwen:'Qwen Code',opencode:'OpenCode',cline:'Cline',roo:'Roo Code',kiro:'Kiro'}
function executable(binary:string){try{const path=binary.includes('/')?binary:(process.env.PATH??'').split(delimiter).map(p=>resolve(p,binary)).find(existsSync);if(!path)return false;accessSync(path,constants.X_OK);return true}catch{return false}}
const officeDocs={feishu:'https://open.feishu.cn/document/client-docs/bot-v3/bot-overview',wecom:'https://github.com/WecomTeam/aibot-node-sdk',github:'https://docs.github.com/en/issues'}
export const entryIds=['feishu','wecom','codex','cursor','vscode','workbuddy','github',...clientIds.filter(id=>!['codex','cursor','vscode','workbuddy'].includes(id))] as const
const entryId=z.enum(entryIds)
export const entryPlanSchema=z.object({revision:z.number().int().min(0),entryId,sourceId:z.string().optional(),name:z.string().trim().min(1).max(100).optional(),scopeIds:z.array(z.string().min(1).max(200)).max(50).default([]),actors:z.array(z.string().min(1).max(200)).max(50).default([]),command:z.string().regex(/^\/[a-z][a-z0-9_-]{0,30}$/).optional(),credentials:z.object({appId:z.string().trim().min(1).max(16000).optional(),appSecret:z.string().trim().min(1).max(16000).optional(),botId:z.string().trim().min(1).max(16000).optional(),secret:z.string().trim().min(1).max(16000).optional()}).strict().optional(),repository:z.string().optional(),workspace:z.string().min(1).max(4000).optional()}).strict()
type Check={id:string;status:'ok'|'required'|'pending';code:string}
type Verification={id:string;entryId:string;sourceId:string;code:string;createdAt:number;language?:'en'|'zh'}
const catalog=()=>entryIds.map(id=>({id,label:names[id]!,category:['feishu','wecom'].includes(id)?'office':id==='github'?'source':'client',docs:id in officeDocs?officeDocs[id as keyof typeof officeDocs]:clientInfo[id as ClientId].docs}))

/** Entry inventory, deployment and evidence. Never sends an artificial test task from the web page. */
export class EntrySetup {
 private choices=new Map<string,{expires:number;items:{id:string;label:string}[];botId?:string;credentials?:{appId:string;appSecret:string}}>()
 private installing=false
 private clientCache=new Map<string,{at:number;value:Awaited<ReturnType<typeof inspectClient>>}>()
 constructor(private host:()=>Runtime,private deployment:Onboarding,private origin:()=>string,private preview=false,private clientHome?:string,private clientName='agent-hub'){}
 publicGuide(){return {entries:catalog(),requiresInvite:true,preview:this.preview}}
 private options(id:ClientId):ClientOptions{return {client:id,url:this.origin(),tokenFile:join(this.host().config.stateDir,'access-token'),name:this.clientName,tagged:true,...(this.clientHome?{home:this.clientHome}:{})}}
 private async inspect(id:ClientId,refresh=false){const previous=this.clientCache.get(id);if(!refresh&&previous&&Date.now()-previous.at<10000)return previous.value;const value=await inspectClient(this.options(id),this.host().config.codex);this.clientCache.set(id,{at:Date.now(),value});return value}
 private sourceIds(id:string){return this.host().config.sources.filter(s=>s.kind===id)}
 private usage(id:string,sourceId?:string){
  const source=this.host().config.sources.find(s=>s.id===sourceId)??this.sourceIds(id)[0]
  const saved=source&&this.host().store.get<any>('entry-label',source.id)
  const location=saved?.location??(id==='github'?source?.repository:undefined)
  const command=source?.feishu?.command??source?.github?.command??'/agent'
  const howToUse=id==='feishu'?{en:`Find the configured bot in the selected Feishu chat. Mention it or start with ${command}. Continue in the same topic; results return there.`,zh:`在已开通的飞书群里找到机器人，@ 它或用 ${command} 开头交代工作。在同一话题补充要求并接收结果。`}:id==='wecom'?{en:'Open the configured smart bot in WeCom and send a direct message, or mention it in an enabled group. Replies return to that conversation.',zh:'在企业微信打开已开通的智能机器人发私聊，或在已开通的群里 @ 它。继续在原会话补充要求、接收结果。'}:id==='github'?{en:`In the configured repository, start an Issue or PR comment with ${command}. Follow up and receive results in that discussion.`,zh:`在已开通仓库的 Issue 或 PR 评论里用 ${command} 开头交代工作，在原讨论跟进和接收结果。`}:{en:'In your connected client, ask the AI to use AgentHub to carry out your request in the background. Continue in that chat and ask it to check the result. This is a personal operator connection on the host computer.',zh:'在已接入的客户端里，让 AI 使用 AgentHub 在后台处理你的要求。在同一聊天追问进展和结果。这是宿主电脑上个人使用的操作员连接。'}
  return {id,label:saved?.label??names[id]??id,howToUse,...(location?{location}:{})}
 }
 async info(){
  for(const [key,probe]of this.choices)if(probe.expires<Date.now())this.choices.delete(key)
  const host=this.host(),status=host.status(),all=host.store.list<Verification>('entry-verification')
  const entries=await Promise.all(catalog().map(async item=>{
   const sources=this.sourceIds(item.id).map(s=>{const latest=all.filter(v=>v.entryId===item.id&&v.sourceId===s.id).sort((a,b)=>b.createdAt-a.createdAt)[0];return {id:s.id,enabled:s.enabled,label:host.store.get<any>('entry-label',s.id)?.label??names[item.id],scopes:host.store.get<any>('entry-label',s.id)?.scopes??(s.feishu?.chats??s.wecom?.chats??(s.repository?[s.repository]:[])),allowedCount:s.allowedActors.length,liveStatus:host.store.get<any>('source-live',s.id)?.status,observed:status.observedSenders.filter(x=>x.source===s.id),...(latest?{verification:{id:latest.id,verified:this.verification(latest.id).verified}}:{})}})
   const client=clientIds.includes(item.id as ClientId)?await this.inspect(item.id as ClientId):undefined
   const last=all.filter(v=>v.entryId===item.id).sort((a,b)=>b.createdAt-a.createdAt)[0],verification=last?this.verification(last.id):undefined
   const configured=verification?.verified===true||(client?.installed??sources.some(s=>s.enabled))
   return {...item,status:verification?.verified&&configured?'verified':sources.some(s=>s.enabled&&(!s.allowedCount||['credentials-required','configuration-error','connection-error'].includes(s.liveStatus)))?'attention':configured?'configured':'not-configured',sources,...(client?{client:{...client,serverName:this.clientName}}:{}),...(verification?{verification}:{}),usage:this.usage(item.id)}
  }))
  const backendId=host.config.execution.roles.worker??host.config.execution.backend,d=host.config.backends[backendId]??{kind:'codex' as const}
  return {revision:host.settings.current().revision,preview:this.preview,host:{platform:process.platform,localOnly:true,clientInstallLocation:'host',label:'AgentHub host computer'},backend:{id:backendId,kind:d.kind,label:('label'in d&&d.label)||(d.kind==='codex'?'Codex':d.model),configured:d.kind==='codex'?executable(d.command??host.config.codex):!d.apiKeyEnv||!!process.env[d.apiKeyEnv],remoteVerified:false},entries,connections:this.deployment.info().connections,attention:[...status.approvals.filter((a:any)=>a.status==='pending').map((a:any)=>({kind:'approval',id:a.id,label:'Approval needed',count:1})),...status.tickets.filter((t:any)=>t.stage.stage==='person').map((t:any)=>({kind:'work',id:t.id,label:t.attention?.question??t.title,count:1})),...status.deliveries.filter((d:any)=>d.status==='uncertain').map((d:any)=>({kind:'delivery',id:d.id,label:'Check an uncertain delivery',count:1}))]}
 }
 async probe(id:string,credentials?:{appId?:string;appSecret?:string}){
  entryId.parse(id);const host=this.host(),checks:Check[]=[],choices:{id:string;label:string}[]=[]
  if(this.preview)return {entryId:id,checks:[{id:'preview',status:'pending',code:'preview_not_connected'}],choices}
  if(clientIds.includes(id as ClientId)){
   const result=await this.inspect(id as ClientId,true)
   checks.push({id:'client',status:result.installed?'ok':result.conflict?'required':'pending',code:result.installed?'client_configured':result.conflict?'client_conflict':result.reason??'client_install_required'})
   checks.push({id:'round-trip',status:'pending',code:'send_request_in_client'})
  }else if(id==='feishu'){
   const existing=this.sourceIds(id).find(s=>s.enabled),binary=existing?.feishu?.cli??'lark-cli'
   const appId=credentials?.appId??(existing?.feishu?.appIdEnv?process.env[existing.feishu.appIdEnv]:undefined),appSecret=credentials?.appSecret??(existing?.feishu?.appSecretEnv?process.env[existing.feishu.appSecretEnv]:undefined)
   try{
    let botId:string|undefined
    if(appId&&appSecret){
     const response=await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',{method:'POST',body:JSON.stringify({app_id:appId,app_secret:appSecret}),headers:{'content-type':'application/json'},redirect:'error',signal:AbortSignal.timeout(15000)}),auth=await response.json() as any
     if(!response.ok||auth.code!==0||!auth.tenant_access_token)throw Error('auth unavailable')
     const read=async(path:string)=>{const r=await fetch('https://open.feishu.cn/open-apis/'+path,{headers:{authorization:'Bearer '+auth.tenant_access_token},redirect:'error',signal:AbortSignal.timeout(15000)}),data=await r.json() as any;if(!r.ok||data.code!==0)throw Error('feishu read unavailable');return data.data??data}
     const identity=await read('bot/v3/info');botId=identity.bot?.open_id??identity.open_id
     let cursor='';for(let page=0;page<10;page++){
      const data=await read('im/v1/chats?page_size=100'+(cursor?'&page_token='+encodeURIComponent(cursor):''))
      for(const chat of data.items??[])if(/^oc_[A-Za-z0-9_-]+$/.test(chat.chat_id))choices.push({id:chat.chat_id,label:chat.name||'Feishu chat'})
      if(!data.has_more)break;if(!data.page_token||data.page_token===cursor)throw Error('pagination unavailable');cursor=data.page_token
     }
    }else{
     const identity=existing&&host.sources.get(existing.id)?.identity?await host.sources.get(existing.id)!.identity!():await new (await import('./connectors/feishu.ts')).FeishuSource(configSchema.shape.sources.element.parse({id:'probe',kind:'feishu',cwd:host.config.stateDir,feishu:{cli:binary,chats:['oc_probe']}})).identity()
     botId=identity.id
     const {stdout}=await exec(binary,['im','+chat-list','--as','bot','--json','--page-size','100','--page-all','--page-limit','10'],{encoding:'utf8',timeout:20000,maxBuffer:1000000}),result=JSON.parse(stdout)
     if(result.ok===false)throw Error('list unavailable')
     for(const chat of result.data?.chats??result.chats??result.data?.items??[])if(/^oc_[A-Za-z0-9_-]+$/.test(chat.chat_id))choices.push({id:chat.chat_id,label:chat.name||'Feishu chat'})
    }
    if(!botId)throw Error('missing identity')
    checks.push({id:'identity',status:'ok',code:'feishu_bot_signed_in'})
    this.choices.set(id,{expires:Date.now()+600000,items:choices,botId,...(appId&&appSecret?{credentials:{appId,appSecret}}:{})})
    checks.push({id:'chats',status:choices.length?'ok':'required',code:choices.length?'choose_visible_chat':'add_bot_to_chat'})
   }catch{this.choices.delete(id);checks.push({id:'connection',status:'required',code:'feishu_bot_setup_required'})}
  }else if(id==='wecom'){
   const sources=this.sourceIds(id)
   if(!sources.length)checks.push({id:'credentials',status:'required',code:'wecom_create_smart_bot'})
   for(const source of sources){try{const identity=await host.sources.get(source.id)?.identity?.();checks.push({id:'identity:'+source.id,status:identity?.verified?'ok':'pending',code:identity?.verified?'wecom_authenticated':'wecom_connection_pending'})}catch{checks.push({id:'credentials:'+source.id,status:'required',code:'wecom_credentials_required'})}}
  }else{
   try{await exec('gh',['auth','status'],{encoding:'utf8',timeout:10000,maxBuffer:100000});checks.push({id:'identity',status:'ok',code:'github_signed_in'})}catch{checks.push({id:'identity',status:'required',code:'github_sign_in_required'})}
  }
  for(const source of this.sourceIds(id))if(source.enabled&&!source.allowedActors.length)checks.push({id:'members:'+source.id,status:'required',code:'allow_observed_sender'})
  return {entryId:id,checks,choices}
 }
 plan(value:unknown){
  const input=entryPlanSchema.parse(value),host=this.host()
  if(!['feishu','wecom','github'].includes(input.entryId))throw new OnboardingError('client_install_required','Use the client installation action for this entry.')
  if(input.sourceId)throw new OnboardingError('source_conflict','Use the existing entry. This flow adds entries without replacing deployed ones.',409)
  const id=input.entryId+'-'+randomUUID().slice(0,8),credentials:Record<string,string>={},prefix='AGENTHUB_SETUP_'+randomUUID().replaceAll('-','').toUpperCase()
  const cwd=setupWorkspace(host.config,input.workspace??join(host.config.stateDir,'workspace',id))
  let fields:Record<string,unknown>={}
  if(input.entryId==='feishu'){
   const seen=this.choices.get('feishu')
   if(!seen||seen.expires<Date.now()){this.choices.delete('feishu');throw new OnboardingError('probe_required','Check the Feishu bot and available chats first.')}
   if(!input.scopeIds.length||input.scopeIds.some(id=>!seen.items.some(c=>c.id===id)))throw new OnboardingError('chat_unavailable','Choose a chat returned by the bot connection check.')
   const binary=this.sourceIds('feishu').find(s=>s.feishu?.cli)?.feishu?.cli??'lark-cli'
   if(seen.credentials){credentials[prefix+'_APP']=seen.credentials.appId;credentials[prefix+'_SECRET']=seen.credentials.appSecret;fields={pollSeconds:5,feishu:{appIdEnv:prefix+'_APP',appSecretEnv:prefix+'_SECRET',chats:input.scopeIds,mentionId:seen.botId,command:input.command}}}
   else fields={feishu:{cli:binary,chats:input.scopeIds,liveEvents:true,mentionId:seen.botId,command:input.command}}
  }else if(input.entryId==='wecom'){
   const bot=input.credentials?.botId,secret=input.credentials?.secret
   if(!bot||!secret)throw new OnboardingError('wecom_credentials_required','Create an API-mode smart bot with a long connection, then provide its Bot ID and Secret locally.')
   credentials[prefix+'_BOT']=bot;credentials[prefix+'_SECRET']=secret
   fields={wecom:{botIdEnv:prefix+'_BOT',secretEnv:prefix+'_SECRET',chats:input.scopeIds,directMessages:true}}
  }else{
   if(!input.repository)throw new OnboardingError('repository_required','Choose the GitHub repository to connect.')
   const repository=input.repository.replace(/^https:\/\/github\.com\//,'').replace(/\/$/,'')
   fields={repository,github:{transport:'gh',gh:'gh',command:input.command}}
  }
  const source=configSchema.shape.sources.element.parse({id,kind:input.entryId,cwd,sandbox:'read-only',workspace:{mode:'source'},allowedActors:input.actors,...fields})
  const plan=this.deployment.sourcePlan(input.revision,source,credentials)
  const scopes=input.scopeIds.map(id=>this.choices.get(input.entryId)?.items.find(c=>c.id===id)??{id,label:id})
  host.store.put('entry-plan',plan.id,{sourceId:id,entryId:input.entryId,label:input.name??names[input.entryId],scopes,location:scopes.map(x=>x.label).join(', ')||input.repository,expiresAt:plan.expiresAt})
  return {...plan,changes:[{code:'add_entry',entryId:input.entryId},{code:'reuse_current_backend'},{code:'read_only_workspace'},{code:'explicit_sender_access'}],usage:this.usage(input.entryId)}
 }
 async apply(id:string,rebuild:(config:Config)=>Promise<void>){
  const label=this.host().store.get<any>('entry-plan',id),receipt=await this.deployment.apply(id,rebuild)
  if(label){this.host().store.put('entry-label',receipt.sourceId,label);this.choices.delete(label.entryId)}
  return {...receipt,entryId:label?.entryId,usage:label?this.usage(label.entryId,receipt.sourceId):undefined}
 }
 async install(id:string){
  entryId.parse(id);if(this.preview)throw new OnboardingError('preview_restricted','Preview cannot install client connections.',403)
  if(!clientIds.includes(id as ClientId)||id==='generic')throw new OnboardingError('manual_client','Use the generated configuration for this client.')
  if(this.installing)throw new OnboardingError('client_install_busy','Another client installation is running.',409)
  this.installing=true
  try{
   const inspection=await this.inspect(id as ClientId,true)
   if(inspection.conflict)throw new OnboardingError('client_conflict','This client already has a different AgentHub entry. It was retained.',409)
   if(!inspection.canInstall)throw new OnboardingError(inspection.reason??'client_unavailable','Use this client’s official configuration page.')
   const result=inspection.installed?{changed:false,path:inspection.configPath,name:this.clientName}:await installEntryClient({...this.options(id as ClientId),backupDir:join(this.host().config.stateDir,'client-backups')},this.host().config.codex)
   this.host().store.put('entry-client-install',id,{entryId:id,at:Date.now(),...result})
   this.clientCache.delete(id)
   return {...result,entryId:id,requiresClientTrust:true,verified:false,device:'host',usage:this.usage(id)}
  }catch(error){if(error instanceof OnboardingError)throw error;throw new OnboardingError('client_install_failed','The client connection could not be installed. Existing entries were retained; inspect its private backup.',409)}finally{this.installing=false}
 }
 clientConfig(id:string){entryId.parse(id);if(!clientIds.includes(id as ClientId))throw new OnboardingError('client_required','Select a client.');const c=clientConfig(this.options(id as ClientId));return {entryId:id,text:c.text,device:'host',containsOperatorToken:false,portable:false,docs:c.info.docs,remoteHelp:{en:'For another computer, first establish an SSH local tunnel to the host and install AgentHub there. Generate configuration on that computer; host file paths cannot be copied directly. This personal connection requires operator access.',zh:'在另一台电脑使用时，先建立到宿主的 SSH 本地隧道，并在该电脑安装 AgentHub 桥接程序，在该电脑生成配置。不要直接复制宿主文件路径；此个人连接需要操作员权限。'}}}
 beginVerification(id:string,sourceId?:string,language:'en'|'zh'='en'){
  entryId.parse(id);const source=sourceId?this.host().config.sources.find(s=>s.id===sourceId):this.host().config.sources.find(s=>s.kind===(clientIds.includes(id as ClientId)?'local':id)&&s.enabled)
  if(!source||source.kind!==(clientIds.includes(id as ClientId)?'local':id))throw new OnboardingError('source_missing','Configure this entry before sending a test request.')
  const record:Verification={id:randomUUID(),entryId:id,sourceId:source.id,code:'AGH-'+randomBytes(5).toString('hex').toUpperCase(),createdAt:Date.now(),language}
  this.host().store.put('entry-verification',record.id,record);return this.verification(record.id)
 }
 verification(id:string){
  const host=this.host(),v=host.store.get<Verification>('entry-verification',id)
  if(!v)throw new OnboardingError('verification_missing','This verification is unavailable.',404)
  const triggers=host.store.list<any>('trigger').filter(t=>t.source===v.sourceId&&t.human&&Date.parse(t.at)>=v.createdAt&&t.text.includes(v.code)&&(!clientIds.includes(v.entryId as ClientId)||host.store.get<any>('entry-client-event',t.id)?.client===v.entryId)).sort((a,b)=>Date.parse(b.at)-Date.parse(a.at))
  const trigger=triggers[0],ticket=trigger&&host.store.tickets.list().find(t=>t.origin.triggerId===trigger.id),run=ticket&&host.store.get<any>('run',ticket.id),assignment=ticket?.assignments.at(-1)
  const executed=!!ticket&&assignment?.report?.state==='ready'&&run?.phase==='idle'
  const replied=!!ticket&&host.store.deliveries().some(d=>d.ticketId===ticket.id&&d.kind==='reply'&&d.status==='sent')&&(!clientIds.includes(v.entryId as ClientId)||!!host.store.get('entry-client-receipt',ticket.id))
  const allowed=trigger&&host.config.sources.find(s=>s.id===v.sourceId)?.allowedActors.includes(trigger.actor.id)
  const source=host.config.sources.find(s=>s.id===v.sourceId),expired=Date.now()-v.createdAt>24*60*60*1000
  const stages=[{id:'received',status:trigger?'ok':'pending'},{id:'authorized',status:ticket?'ok':trigger&&!allowed?'required':'pending'},{id:'executed',status:executed?'ok':assignment?.report&&['failed','blocked'].includes(assignment.report.state)?'required':'pending'},{id:'replied',status:replied?'ok':'pending'}] as {id:string;status:'ok'|'required'|'pending'}[]
  const prefix=source?.github?.command??source?.feishu?.command??'',instructions={en:(prefix+' This is a connection check. '+v.code+' is only a correlation marker, not a task ID. Reply only “Connection verified.” Do not call tools or modify files.').trim(),zh:(prefix+' 这是接入连通性测试。标记 '+v.code+' 仅用于关联本次测试，不是任务编号。请只回复“接入验收成功。”，不要调用工具或修改文件。').trim()}
  if(clientIds.includes(v.entryId as ClientId)){
   instructions.en='Use AgentHub to forward the message below to the background assistant with agent_request. Then use agent_status with the returned discussion and requestId to check completion and show the actual reply. The no-tools instruction applies only to the background assistant.\n\nMessage to forward:\n'+instructions.en
   instructions.zh='请使用 AgentHub 的 agent_request 把下面这段消息转交给后台助手，再用返回的 discussion 和 requestId 调用 agent_status 查询完成情况，并展示后台实际回复。“不要调用工具”仅约束后台助手。\n\n要转交的消息：\n'+instructions.zh
  }
  return {...v,expired,instructions,instruction:instructions[v.language??'zh'],stages,verified:!this.preview&&!!source?.enabled&&!expired&&stages.every(s=>s.status==='ok'),...(trigger&&!allowed?{observedSender:{sourceId:v.sourceId,actor:trigger.actor.id}}:{}),...(ticket?{ticketId:ticket.id}:{})}
 }
 allow(revision:number,sourceId:string,actor:string){
  const host=this.host(),source=host.config.sources.find(s=>s.id===sourceId),observed=host.store.get<any>('source-observed',sourceId+':'+actor)
  if(!source||!observed||observed.source!==sourceId||observed.actor!==actor)throw new OnboardingError('sender_not_observed','Send a message to this entry first; unknown identities cannot be added here.')
  return host.updateSettings(revision,{sources:host.config.sources.map(s=>s.id===sourceId?{...s,allowedActors:[...new Set([...s.allowedActors,actor])]}:s)})
 }
 private async configured(id:string){
  if(this.sourceIds(id).some(s=>s.enabled))return true
  const latest=this.host().store.list<Verification>('entry-verification').filter(v=>v.entryId===id).sort((a,b)=>b.createdAt-a.createdAt)[0]
  if(latest&&this.verification(latest.id).verified)return true
  return clientIds.includes(id as ClientId)&&(await this.inspect(id as ClientId)).installed
 }
 async share(ids:string[]){
  if(!ids.length||ids.some(id=>!entryIds.includes(id as any)))throw new OnboardingError('entry_required','Select entries to share.')
  const published=(await Promise.all(ids.map(async id=>({id,configured:await this.configured(id)})))).filter(e=>e.configured)
  if(published.length!==ids.length)throw new OnboardingError('entry_unconfigured','Configure the selected entries first.')
  const invite=randomBytes(24).toString('base64url'),id=hash(invite)
  this.host().store.put('entry-invite',id,{entryIds:[...new Set(ids)],at:Date.now()})
  const entries=ids.map(id=>this.usage(id))
  const text={en:entries.map(e=>`${e.label}${e.location?' — '+e.location:''}\n${e.howToUse.en}`).join('\n\n'),zh:entries.map(e=>`${e.label}${e.location?' · '+e.location:''}\n${e.howToUse.zh}`).join('\n\n')}
  return {url:this.origin()+'/configure#invite='+invite,text,entries,operator:false,localOnly:true}
 }
 async invitation(invite:string){
  const record=this.host().store.get<any>('entry-invite',hash(invite));if(!record)throw new OnboardingError('invite_invalid','This usage guide link is unavailable. Ask the deployment owner for a new one.',404)
  return {operator:false,localOnly:true,entries:await Promise.all(record.entryIds.map(async(id:string)=>({...this.usage(id),status:await this.configured(id)?'configured':'not-configured'})))}
 }
}
