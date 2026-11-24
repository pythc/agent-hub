import {useEffect,useRef,useState,type FormEvent} from 'react'
import {Check,ChevronRight,ExternalLink,LoaderCircle,Plug,Plus,RefreshCw,ShieldCheck,X} from 'lucide-react'
import type {ConnectorManagement as ConnectorService,ConnectorLayer,ConnectorFieldIssue} from '../../src/connector-management.ts'
import {connectorCheck,connectorCheckLabel,connectorLayerNames,connectorTime,connectorMessageEvidence} from './connector-status-view.ts'
import {readCredentialInformation,credentialInformationLabel,type CredentialInformation} from './credential-reference-view.ts'
import {useWorkspaceTransport,type WorkspacePageContext} from './workspace-context.tsx'
import type {WorkspaceBinding} from './workspace-transport.ts'
import './connector-management.css'
type Snapshot=ReturnType<ConnectorService['snapshot']>
type Definition=Snapshot['definitions'][number]
type InformationView={owner:string;data:CredentialInformation|null;phase:'loading'|'ready'|'failed'|'stale'|'changed'}
const split=(value:string)=>value.split(/[\n,]/).map(s=>s.trim()).filter(Boolean)
const requestCodes=['setup_recovery_required','connector_repair_unavailable','connector_invalid','connector_conflict','connector_missing','connector_disabled','connector_unsupported','connector_request_conflict','connector_busy','connector_actors_required','connector_plan_expired']
class ConnectorRequestError extends Error {constructor(readonly code:string,readonly issues:ConnectorFieldIssue[]=[]){super(code)}}
function setupIssues(value:unknown,fields:readonly string[]):ConnectorFieldIssue[]{
 const codes=['required','invalid_format','invalid_environment_reference','credential_unavailable','too_many','unsupported_field'],allowed=new Set(fields),seen=new Set<string>(),result:ConnectorFieldIssue[]=[]
 if(!Array.isArray(value))return result
 for(const item of value.slice(0,64)){
  if(!item||typeof item!=='object')continue
  const field=Object.getOwnPropertyDescriptor(item,'field'),code=Object.getOwnPropertyDescriptor(item,'code')
  if(!field||!code||!('value'in field)||!('value'in code)||typeof field.value!=='string'||!allowed.has(field.value)||typeof code.value!=='string'||!codes.includes(code.value)||seen.has(field.value))continue
  seen.add(field.value);result.push({field:field.value,code:code.value as ConnectorFieldIssue['code']})
 }
 return result
}
function requestFailure(value:unknown){return value instanceof ConnectorRequestError&&requestCodes.includes(value.code)?value.code:'connector_request_failed'}
function setupBody(revision:number,kind:string,label:string,actors:string,fields:Record<string,string>,credentials:Record<string,string>,environment:boolean){
 const people=split(actors)
 return {revision,kind,label,actors:people,...(!people.length?{intent:'draft' as const}:{}),fields,credentials,credentialMode:environment?'environment':'value'}
}
function contextEnded(cause:unknown){const error=cause as {status?:number;payload?:{code?:unknown}}|null;return error?.status===401||typeof error?.payload?.code==='string'&&error.payload.code==='workspace_obsolete'}
async function connectorRequest<T>(binding:WorkspaceBinding,path:string,body?:unknown,fields:readonly string[]=[],readSignal?:AbortSignal):Promise<T>{
 try{return await binding.request<T>(path,body,false,undefined,body===undefined?readSignal:undefined)}
 catch(cause){
  if(contextEnded(cause))throw cause
  const payload=(cause as {payload?:{code?:unknown;issues?:unknown}}|null)?.payload
  const raw=payload?.code,code=raw==='plan_expired'?'connector_plan_expired':raw==='settings_conflict'?'connector_conflict':typeof raw==='string'&&requestCodes.includes(raw)?raw:'connector_request_failed'
  throw new ConnectorRequestError(code,['connector_invalid','connector_actors_required'].includes(code)?setupIssues(payload?.issues,fields):[])
 }
}
function api<T>(binding:WorkspaceBinding,path='',body?:unknown,fields:readonly string[]=[],readSignal?:AbortSignal){return connectorRequest<T>(binding,'/api/connectors'+path,body,fields,readSignal)}
export function ConnectorManagement({language}:{language:'en'|'zh-CN'}){
 const L=(en:string,zh:string)=>language==='en'?en:zh,workspace=useWorkspaceTransport()
 const [viewContext,setViewContext]=useState(workspace.contextKey)
 const [data,setData]=useState<Snapshot|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(''),[creating,setCreating]=useState(false),[needsPeople,setNeedsPeople]=useState(false),[repair,setRepair]=useState<{sourceId:string;revision:number;kind:string}|null>(null)
 const [information,setInformation]=useState<InformationView>({owner:workspace.contextKey,data:null,phase:'loading'})
 const informationFlight=useRef<{owner:string;revision:number}|null>(null),informationWanted=useRef<{owner:string;revision:number}|null>(null)
 const alive=useRef(true),working=useRef(false),loadGeneration=useRef(0),lifetime=useRef(workspace)
 lifetime.current=workspace
 const current=(captured:WorkspacePageContext)=>alive.current&&!captured.readSignal.aborted&&lifetime.current.contextKey===captured.contextKey&&lifetime.current.binding===captured.binding
 const message=(code:string)=>code==='connector_plan_expired'?L('This review expired. Check the settings again.','本次核对已过期，请重新检查配置。'):code==='connector_actors_required'?L('Set who can request work before enabling this connection.','请先设置谁能发起工作，再启用连接。'):code==='connector_conflict'?L('Settings changed. Refresh and review the current connection.','配置已变化，请刷新并核对当前连接。'):code==='connector_disabled'?L('This connection is disabled. Only local settings can be checked.','此连接已停用，目前只能检查本地配置。'):code==='connector_invalid'?L('Check the details you entered.','请检查填写的内容。'):code==='connector_unsupported'?L('This app does not offer this setup or check.','此应用暂不支持这项设置或检查。'):code==='connector_busy'?L('Diagnostics are busy. Try again shortly.','诊断正在进行，请稍后重试。'):L('The request could not finish. Refresh before trying again.','请求未能完成，请刷新后再试。')
 const loadInformation=async(captured:WorkspacePageContext,revision:number)=>{
  if(!current(captured))return
  informationWanted.current={owner:captured.contextKey,revision}
  if(informationFlight.current?.owner===captured.contextKey)return
  const token={owner:captured.contextKey,revision};informationFlight.current=token
  setInformation(before=>({owner:token.owner,data:before.owner===token.owner&&before.data?.settingsRevision===revision?before.data:null,phase:'loading'}))
  try{
   const value=await captured.binding.request<unknown>('/api/credential-references',undefined,false,undefined,captured.readSignal)
   if(!current(captured)||informationFlight.current!==token||informationWanted.current?.revision!==revision)return
   const next=readCredentialInformation(value)
   setInformation({owner:token.owner,data:next.settingsRevision===revision?next:null,phase:next.settingsRevision===revision?'ready':'changed'})
  }catch(cause){
   if(!current(captured)||informationFlight.current!==token||informationWanted.current?.revision!==revision)return
   const status=(cause as {status?:number}|null)?.status,clear=status===401||status===403||contextEnded(cause)
   setInformation(before=>{const retained=!clear&&before.owner===token.owner&&before.data?.settingsRevision===revision?before.data:null;return {owner:token.owner,data:retained,phase:retained?'stale':'failed'}})
  }finally{
   if(informationFlight.current===token){informationFlight.current=null;const wanted=informationWanted.current;if(current(captured)&&wanted?.owner===captured.contextKey&&wanted.revision!==revision)void loadInformation(captured,wanted.revision)}
  }
 }
 const load=async(captured=workspace)=>{if(!current(captured))return;const generation=++loadGeneration.current,next=await api<Snapshot>(captured.binding,'',undefined,[],captured.readSignal);if(current(captured)&&generation===loadGeneration.current){setData(next);void loadInformation(captured,next.revision)}}
 useEffect(()=>{
  const captured=workspace;alive.current=true;working.current=false;loadGeneration.current++;informationFlight.current=null;informationWanted.current=null;setInformation({owner:captured.contextKey,data:null,phase:'loading'});setViewContext(captured.contextKey);setData(null);setError('');setNotice('');setBusy('');setCreating(false);setNeedsPeople(false);setRepair(null)
  void load(captured).catch(cause=>{if(current(captured)&&!contextEnded(cause))setError(requestFailure(cause))})
  const update=()=>{void load(captured).catch(()=>{})};window.addEventListener('roppo:plugins-changed',update)
  return()=>{alive.current=false;loadGeneration.current++;informationFlight.current=null;informationWanted.current=null;window.removeEventListener('roppo:plugins-changed',update)}
 },[workspace.binding,workspace.contextKey,workspace.readSignal])
 const run=async(key:string,action:(binding:WorkspaceBinding,stillCurrent:()=>boolean)=>Promise<unknown>)=>{const captured=workspace;if(working.current||!current(captured))return;working.current=true;setBusy(key);setError('');setNotice('');setNeedsPeople(false);try{await action(captured.binding,()=>current(captured));if(current(captured))await load(captured)}catch(cause){if(current(captured)&&!contextEnded(cause))setError(requestFailure(cause))}finally{if(current(captured)){working.current=false;setBusy('')}}}
 const layers=(Object.keys(connectorLayerNames) as ConnectorLayer[]).map(id=>({id,names:connectorLayerNames[id]}))
 const word=(pair:[string,string])=>L(...pair)
 const time=(at:number|null)=>at===null?L('Time unavailable','时间未知'):new Date(at).toLocaleString(language,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})
 const explanation=(code:string)=>{
  const messages:Record<string,[string,string]>={adapter_restart_required:['The adapter still uses earlier credentials. Reload it through the existing configuration flow before checking again. This page does not restart it automatically.','适配器仍使用旧凭据。请通过现有配置流程受控重新载入后再检查；本页不会自动重启。'],credential_changed:['Credential information changed. Use Check to verify the current account again.','凭据资料已变化，请使用检查按钮重新核验当前账号。'],credential_missing:['Required credential information is missing. Configure its reference before checking again.','缺少必需的凭据资料，请先配置凭据引用，再重新检查。'],adapter_changed:['The adapter changed. Use Check to verify the current adapter again.','适配器已变化，请使用检查按钮重新核验当前适配器。'],evidence_lifecycle_changed:['The runtime changed. Earlier evidence no longer verifies this connection; check again.','运行环境已变化，先前证据不能验证当前连接，请重新检查。'],credential_basis_unavailable:['The credentials actually used by the adapter could not be confirmed. Not verified.','无法确认适配器使用的凭据依据，尚未验证。'],configuration_valid:['Local settings checked. No service call was made.','本地配置已检查，未连接外部服务。'],configuration_invalid:['Check the required information.','请核对必填资料。'],service_reachable:['The service responded. This check does not verify account identity.','服务有响应，此项检查不验证账号身份。'],service_unreachable:['The service did not answer this check.','服务未能响应本次检查。'],identity_verified:['Account identity confirmed. Messaging is unverified.','账号身份已确认，消息收发尚未验证。'],identity_unverified:['Account identity is unconfirmed.','尚未确认账号身份。'],authentication_not_verified:['Account identity is unconfirmed. Check the app details and workspace.','暂未确认账号，请核对应用资料和工作区。'],directory_read_verified:['Selected members are readable. Message and channel permissions are unverified.','可读取所选范围的成员，不代表消息或频道权限可用。'],directory_not_verified:['Member access is unverified. Check the bot’s access to the selected conversations.','尚未确认成员读取权限，请核对机器人在所选会话中的权限。'],configuration_changed:['This result is out of date. Check again.','结果已过期，请重新检查。'],probe_interrupted:['The check stopped. Review the connection before checking again.','检查已中断，请核对连接后重试。'],diagnostic_store_unavailable:['The result was not saved. Refresh and check again.','检查结果未保存，请刷新后重新检查。']}
  const unavailable:Record<string,[string,string]>={reachability_probe_unavailable:['This app does not provide a service check.','此应用未提供服务检查。'],identity_probe_unavailable:['This app does not provide an identity check.','此应用未提供身份检查。'],directory_probe_unavailable:['This app does not provide a directory check here.','此应用暂未提供目录检查。']}
  const value=messages[code]??unavailable[code];return value?L(...value):L('No verified result. Check again.','尚无已验证结果，请重新检查。')
 }
 const informationRow=(kind:'source'|'tool',id:string)=>{
  const same=information.owner===workspace.contextKey,retained=same&&information.data?.settingsRevision===data?.revision?information.data:null
  const row=retained?.connections.find(item=>item.kind===kind&&item.id===id),phase=!same?'loading':information.data&&information.data.settingsRevision!==data?.revision?'changed':information.phase
  const label=phase==='changed'?L('Settings changed. Refresh to check.','配置已变化，请刷新后检查。'):row?word(credentialInformationLabel(row.state)):phase==='loading'?L('Checking saved information…','正在检查已保存资料…'):L('Information check unavailable','暂时无法检查资料')
  return <div className="connector-information" data-information-kind={kind} data-information-id={id} data-information-state={phase==='stale'?'stale':phase==='changed'?'changed':row?.state??phase}><strong>{L('Connection information','接入资料')}</strong><span>{phase==='stale'?L('Earlier record · ','先前记录 · '):''}{label}</span></div>
 }
 if(viewContext!==workspace.contextKey)return <section className="connector-page" role="status">{L('Loading connections…','正在读取连接…')}</section>
 return <section className="connector-page" aria-labelledby="connector-title">
  <header className="connector-heading"><div><h1 id="connector-title">{L('Connections','连接器')}</h1></div><div className="connector-actions"><button disabled={!!busy} onClick={()=>void run('refresh',async()=>{})}><RefreshCw size={16} className={busy==='refresh'?'connector-spin':''}/>{L('Refresh','刷新')}</button><button className="connector-primary" disabled={!!busy} onClick={()=>{if(current(workspace))setCreating(true)}}><Plus size={16}/>{L('Add connection','添加连接')}</button></div></header>
  <nav className="connector-links" aria-label={L('Integration settings','集成设置')}><a href="#integrations/market">{L('Plugin market','插件市场')}<ExternalLink size={14}/></a><a href="#integrations/tools">{L('Tools','工具')}<ExternalLink size={14}/></a></nav>
  <div role="status" aria-live="polite">{notice?<p className="connector-notice">{notice}{needsPeople?<> <a href="#connections">{L('Set people','设置人员')}</a></>:null}</p>:null}</div>{error?<p className="connector-error" role="alert">{message(error)}{error==='connector_actors_required'?<> <a href="#connections">{L('Set people','设置人员')}</a></>:null}</p>:null}
  {!data?<p className="connector-loading">{!error?<LoaderCircle className="connector-spin" size={18}/>:null}{error?L('Connections are unavailable. Try refreshing.','暂时无法读取连接，请重试刷新。'):L('Loading connections…','正在读取连接…')}</p>:<>
   {!data.instances.length?<div className="connector-empty"><Plug size={28}/><h2>{L('Connect your first app','连接第一个应用')}</h2><p>{L('Choose an installed app. More platforms are available through plugins.','选择已安装应用，其他平台可通过插件添加。')}</p><button onClick={()=>{if(current(workspace))setCreating(true)}}>{L('Choose an installed app','选择已安装应用')}<ChevronRight size={16}/></button></div>:null}
   <div className="connector-information-note" aria-live="polite"><p>{L('Service access is not verified by this check.','此项检查不代表服务可用。')}</p>{information.owner===workspace.contextKey&&['failed','stale'].includes(information.phase)?<p role="status">{L('Information check unavailable','暂时无法检查资料')}</p>:null}{information.owner===workspace.contextKey&&information.data?.settingsRevision===data.revision?<time dateTime={new Date(information.data.observedAt).toISOString()}>{information.phase==='stale'?L('Earlier record · ','先前记录 · '):L('Read at · ','读取于 · ')}{time(information.data.observedAt)}</time>:null}</div>
   <div className="connector-grid">{data.instances.map(instance=><article className="connector-card" key={instance.id} data-source-id={instance.id}>
    <header><div>{(data.definitions.find(d=>d.kind===instance.kind)?.label??instance.kind)!==instance.label?<span className="connector-kind">{data.definitions.find(d=>d.kind===instance.kind)?.label??instance.kind}</span>:null}<h2>{instance.label}</h2></div><span className={'connector-pill '+(instance.enabled?'is-enabled':'')}>{instance.enabled?L('Enabled','已启用'):L('Disabled','已停用')}</span></header>
    {!instance.enabled?<p className="connector-detail">{L('Review access before enabling this connection.','启用连接前，请先核对访问权限。')}</p>:null}
    {informationRow('source',instance.id)}
    <ol className="connector-layers">{layers.map(layer=>{const check=connectorCheck(instance.layers[layer.id],layer.id,data.revision),passed=check.state==='passed';return <li key={layer.id} data-layer={layer.id} data-state={check.state}>
      <div><span className={'connector-dot '+(passed?'is-passed':'')} aria-hidden="true">{passed?<Check size={12}/>:null}</span><div><strong>{word(layer.names)}</strong><span className="connector-result">{word(connectorCheckLabel(check.state,layer.id))}</span></div><button disabled={!!busy||!instance.enabled&&layer.id!=='configuration'} onClick={()=>void run(instance.id+':'+layer.id,async(binding)=>{await api(binding,'/probe',{sourceId:instance.id,revision:data.revision,level:layer.id,requestId:crypto.randomUUID()})})} aria-label={L('Check '+layer.names[0]+' for '+instance.label,'检查'+instance.label+'的'+layer.names[1])}>{busy===instance.id+':'+layer.id?<LoaderCircle size={14} className="connector-spin"/>:<RefreshCw size={14}/>}<span>{L('Check','检查')}</span></button></div>
      {check.at!==null?<time className="connector-check-time" dateTime={new Date(check.at).toISOString()}>{time(check.at)}{check.fixture?' · '+L('Simulated result','模拟结果'):''}</time>:null}
      {['failed','unknown','interrupted','unsupported','stale'].includes(check.state)?<p className="connector-evidence">{explanation(check.code)}{['credential_missing','adapter_restart_required'].includes(check.code)?<> <a href="#connections">{L('Review connection settings','查看连接配置')}</a></>:null}</p>:null}
     </li>})}<li data-layer="messages" data-state="not_tested"><div><span className="connector-dot"/><div><strong>{L('Messages and channel access','消息与频道权限')}</strong><span className="connector-result">{L('Not verified','尚未验证')}</span></div></div><p className="connector-evidence">{L('Reading, receiving, sending and target-channel access are unverified.','尚未验证消息读取、收发及目标频道权限。')}</p>{connectorMessageEvidence(instance.realCall,instance.id,data.revision)==='missing_proof'?<p className="connector-evidence">{L('No receipt for this connection and configuration: provider acceptance, the remote message ID, and independent readback or callback are not recorded together.','此连接及当前配置缺少完整回执：未同时记录平台受理、远端消息 ID 和独立回读或回调。')}</p>:connectorMessageEvidence(instance.realCall,instance.id,data.revision)==='accepted_unobserved'?<p className="connector-evidence">{L('Feishu accepted a reply and returned its message ID. Independent readback or callback is not recorded.','飞书已受理一条回复并返回消息 ID；尚未有独立回读或回调证据。')}</p>:null}</li></ol>
    <details className="connector-records"><summary>{L('View records','查看记录')}</summary><dl><dt>{L('Connection ID','连接编号')}</dt><dd>{instance.id}</dd><dt>{L('Settings version','配置版本')}</dt><dd>{data.revision}</dd><dt>{L('Configured scopes','已配置范围')}</dt><dd>{instance.scopeCount}</dd></dl>
     <h3>{L('Earlier checks','先前检查')}</h3><p>{L('Earlier results may no longer apply.','先前结果可能已不适用。')}</p><ul className="connector-history">{data.diagnostics.filter(record=>record.sourceId===instance.id).slice(-5).reverse().map(record=><li key={record.id}><strong>{word(connectorLayerNames[record.level]??['Earlier check','先前检查'])}</strong><time>{time(connectorTime(record.finishedAt??record.startedAt))}{record.evidenceMode==='fixture'?' · '+L('Simulated result','模拟结果'):''}</time><p>{explanation(record.code)}</p></li>)}</ul>
    </details>
    <footer>{instance.repairAvailable&&!instance.enabled?<button disabled={!!busy} onClick={()=>setRepair({sourceId:instance.id,revision:data.revision,kind:instance.kind})}>{L('Repair connection','修复连接')}</button>:null}<a href="#connections">{L('Who can request work','谁能发起工作')}<ExternalLink size={14}/></a><button disabled={!!busy} onClick={()=>void run(instance.id+':control',async(binding,stillCurrent)=>{await api(binding,'/control',{sourceId:instance.id,revision:data.revision,enabled:!instance.enabled,requestId:crypto.randomUUID()});if(!stillCurrent())return;setNotice(instance.enabled?L('Connection disabled. New calls are blocked; earlier actions are not undone.','连接已停用。已阻止新调用，先前操作不会因此撤销。'):L('Connection enabled. Its checks are still separate.','连接已启用，各项检查仍需分别进行。'))})}>{instance.enabled?L('Disable connection','停用连接'):L('Enable connection','启用连接')}</button></footer>
   </article>)}</div>
   {data.tools.length?<details className="connector-tools"><summary>{L('Tool connections','工具连接')} ({data.tools.length})</summary><p>{L('Existing Worker permissions still apply. This page does not call tools.','沿用现有 Worker 权限，本页不会调用工具。')}</p>{data.tools.map(tool=><div key={tool.id}><strong>{tool.label}</strong><span>{tool.enabled?L('Enabled','已启用'):L('Disabled','已停用')} · {L('Not tested','未测试')}</span><a href="#integrations/tools">{L('Manage','管理')}</a>{informationRow('tool',tool.id)}</div>)}</details>:null}
  </>}
  {repair&&data?<Repair key={workspace.contextKey+':'+repair.sourceId} target={repair} definition={data.definitions.find(d=>d.kind===repair.kind)} L={L} close={()=>setRepair(null)} saved={()=>{if(!current(workspace))return;setRepair(null);setNotice(L('Connection repaired and still disabled. People and permissions were not changed.','连接已修复并保持停用，人员和权限未改变。'));void load(workspace).catch(()=>{})}}/>:null}
  {creating&&data?<Setup definitions={data.definitions.filter(d=>d.setupAvailable)} revision={data.revision} L={L} close={()=>{if(current(workspace))setCreating(false)}} created={hasPeople=>{if(!current(workspace))return;setCreating(false);setError('');setNeedsPeople(!hasPeople);setNotice(hasPeople?L('Connection saved and disabled.','连接已保存并保持停用。'):L('Connection saved and disabled. Set who can request work before enabling it.','连接已保存并保持停用。启用前请先设置谁能发起工作。'));void load(workspace).catch(cause=>{if(current(workspace)&&!contextEnded(cause))setError(requestFailure(cause))})}} message={message}/>:null}
 </section>
}

function Setup({definitions,revision,L,close,created,message}:{definitions:Definition[];revision:number;L:(en:string,zh:string)=>string;close:()=>void;created:(hasPeople:boolean)=>void;message:(code:string)=>string}){
 const workspace=useWorkspaceTransport(),[viewContext,setViewContext]=useState(workspace.contextKey),mounted=useRef(true),lifetime=useRef(workspace)
 lifetime.current=workspace
 const active=(captured:WorkspacePageContext)=>mounted.current&&!captured.readSignal.aborted&&lifetime.current.contextKey===captured.contextKey&&lifetime.current.binding===captured.binding
 const dialog=useRef<HTMLDialogElement>(null),[kind,setKind]=useState(definitions[0]?.kind??''),[label,setLabel]=useState(''),[actors,setActors]=useState(''),[fields,setFields]=useState<Record<string,string>>({}),[credentials,setCredentials]=useState<Record<string,string>>({}),[environment,setEnvironment]=useState(false),[step,setStep]=useState(1),[plan,setPlan]=useState<{id:string;expiresAt:number}|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[issues,setIssues]=useState<ConnectorFieldIssue[]>([]),[focusAttempt,setFocusAttempt]=useState(0),[availability,setAvailability]=useState<Record<string,boolean>>({})
 const inputs=useRef<Record<string,HTMLInputElement|null>>({}),errorSummary=useRef<HTMLParagraphElement>(null),generation=useRef(0),working=useRef(false),pending=useRef<AbortController|null>(null)
 const definition=definitions.find(d=>d.kind===kind),latest=useRef(close);latest.current=()=>{if(!busy)close()}
 useEffect(()=>{mounted.current=true;const element=dialog.current!,opener=document.activeElement as HTMLElement|null;element.showModal();const cancel=(event:Event)=>{event.preventDefault();latest.current()};element.addEventListener('cancel',cancel);return()=>{mounted.current=false;element.removeEventListener('cancel',cancel);generation.current++;pending.current?.abort();element.close();opener?.focus()}},[])
 useEffect(()=>{generation.current++;pending.current?.abort();pending.current=null;working.current=false;setViewContext(workspace.contextKey);setKind(definitions[0]?.kind??'');setLabel('');setActors('');setFields({});setCredentials({});setEnvironment(false);setStep(1);setPlan(null);setBusy(false);setError('');setIssues([]);setAvailability({})},[workspace.binding,workspace.contextKey,workspace.readSignal])
 const names=['label','actors',...(definition?.fields?.map(field=>field.name)??[])]
 useEffect(()=>{if(!focusAttempt||busy||step!==2)return;const first=names.find(name=>issues.some(issue=>issue.field===name));if(first)inputs.current[first]?.focus();else errorSummary.current?.focus()},[focusAttempt,busy,step])
 const changed=(field?:string)=>{generation.current++;pending.current?.abort();pending.current=null;working.current=false;setBusy(false);setPlan(null);setError('');setAvailability({});setIssues(previous=>field?previous.filter(issue=>issue.field!==field):[])}
 const issueMessage=(code:ConnectorFieldIssue['code'])=>({required:L('Fill in this field.','请填写此项。'),invalid_format:L('Check the format of this field.','请核对此项格式。'),invalid_environment_reference:L('Enter a valid environment variable name.','请填写有效的环境变量名。'),credential_unavailable:L('This stored credential is unavailable.','此项已存凭据暂不可用。'),too_many:L('Use fewer or shorter values.','请减少数量或缩短内容。'),unsupported_field:L('Use the credential field provided for this app.','请使用此应用提供的凭据字段。')})[code]
 const fieldIssue=(field:string)=>issues.find(issue=>issue.field===field)
 const errorText=(field:string)=>{const issue=fieldIssue(field);return issue?<span className="connector-error" id={'connector-error-'+field}>{issueMessage(issue.code)}</span>:null}
 const attributes=(field:string,help=false,environmentHelp=false)=>({id:'connector-field-'+field,ref:(input:HTMLInputElement|null)=>{inputs.current[field]=input},'aria-invalid':!!fieldIssue(field),'aria-describedby':[...(help?['connector-help-'+field]:[]),...(environmentHelp?['connector-env-help-'+field]:[]),...(fieldIssue(field)?['connector-error-'+field]:[])].join(' ')||undefined})
 const submit=async(event:FormEvent)=>{
  event.preventDefault();const captured=workspace;if(working.current||busy||!definition||viewContext!==captured.contextKey||!active(captured))return
  const request=++generation.current,controller=new AbortController(),current=()=>request===generation.current&&!controller.signal.aborted&&active(captured)
  pending.current=controller;working.current=true;setBusy(true);setError('');setIssues([])
  try{
   if(step===1){setLabel(definition.label);setStep(2)}
   else if(!plan){
    const local:ConnectorFieldIssue[]=[]
    if(!label.trim())local.push({field:'label',code:'required'})
    for(const field of definition.fields??[]){const value=(field.credential?credentials:fields)[field.name]??'';if(field.required&&(!value.trim()||field.input==='tags'&&!split(value).length))local.push({field:field.name,code:'required'});else if(field.credential&&environment&&value&&!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value))local.push({field:field.name,code:'invalid_environment_reference'})}
    if(local.length)throw new ConnectorRequestError('connector_invalid',local)
    const value=setupBody(revision,kind,label,actors,fields,credentials,environment),valid=await api<{valid:boolean;issues?:unknown;credentialAvailability?:{field:string;available:boolean}[]}>(captured.binding,'/validate',value,names)
    if(!current())return
    if(valid.valid!==true)throw new ConnectorRequestError('connector_invalid',setupIssues(valid.issues,names))
    const available:Record<string,boolean>={};for(const item of valid.credentialAvailability??[])if(definition.fields?.some(field=>field.name===item.field&&field.credential)&&typeof item.available==='boolean')available[item.field]=item.available
    setAvailability(available)
    const reviewed=await api<{id:string;expiresAt:number}>(captured.binding,'/plan',value,names)
    if(!current())return
    if(typeof reviewed.id!=='string'||!Number.isFinite(reviewed.expiresAt))throw new ConnectorRequestError('connector_request_failed')
    if(reviewed.expiresAt<=Date.now())throw new ConnectorRequestError('connector_plan_expired')
    setPlan(reviewed);setStep(3)
   }else{
    if(plan.expiresAt<=Date.now())throw new ConnectorRequestError('connector_plan_expired')
    const result=await connectorRequest<{applied?:boolean}>(captured.binding,'/api/plugin-market/connection/apply',{id:plan.id},names)
    if(!current())return
    if(result?.applied!==true)throw new ConnectorRequestError('connector_request_failed')
    setCredentials({});created(split(actors).length>0)
   }
  }catch(cause){if(current()&&!contextEnded(cause)){const code=requestFailure(cause),next=cause instanceof ConnectorRequestError?setupIssues(cause.issues,names):[];setError(code);setIssues(next);setFocusAttempt(value=>value+1);if(next.length||code==='connector_plan_expired'||code==='connector_conflict'){setPlan(null);setStep(2)}}}
  finally{if(current()){pending.current=null;working.current=false;setBusy(false)}}
 }
 if(viewContext!==workspace.contextKey)return null
 return <dialog ref={dialog} className="connector-dialog" aria-labelledby="connector-setup-title"><header><div><span>{L('STEP','步骤')} {step} / 3</span><h2 id="connector-setup-title">{L('Add a connection','添加连接')}</h2></div><button disabled={busy} type="button" onClick={close} aria-label={L('Close','关闭')}><X size={18}/></button></header><form noValidate onSubmit={event=>void submit(event)}><div className="connector-dialog-body"><fieldset disabled={busy}>
  {step===1?<><p>{L('Choose an installed app.','选择已安装应用。')}</p>{definitions.length?<label>{L('Installed app','已安装应用')}<select value={kind} onChange={event=>{changed();setKind(event.target.value);setLabel('');setActors('');setFields({});setCredentials({});setEnvironment(false)}}>{definitions.map(d=><option key={d.kind} value={d.kind}>{d.label}</option>)}</select></label>:<p>{L('No installed plugin provides a setup form.','没有已安装插件提供配置表单。')}</p>}{definition?.setup?.description?<details className="connector-advanced"><summary>{L('App instructions','应用说明')}</summary><p>{definition.setup.description}</p></details>:null}<a href="#integrations/market" onClick={close}>{L('Find another platform in the plugin market','前往插件市场添加其他平台')}<ExternalLink size={13}/></a></>:null}
  {step===2&&definition?<><label>{L('Connection name','连接名称')}<input {...attributes('label')} required maxLength={100} value={label} onChange={event=>{setLabel(event.target.value);changed('label')}}/>{errorText('label')}</label><label>{L('Who can request work (optional)','谁能发起工作（可稍后设置）')}<input {...attributes('actors',true)} value={actors} placeholder={L('Comma-separated user IDs','以逗号分隔用户 ID')} onChange={event=>{setActors(event.target.value);changed('actors')}}/><span className="connector-draft-note" id="connector-help-actors">{L('You can set this later. The connection stays disabled.','可以稍后设置。连接会保持停用。')}</span>{errorText('actors')}</label>{definition.fields?.map(field=><label key={field.name}>{field.label}{field.required?' *':''}<input {...attributes(field.name,!!field.help,field.credential&&environment)} type={field.credential&&!environment?'password':'text'} required={field.required} autoComplete={field.credential?'new-password':'off'} value={(field.credential?credentials:fields)[field.name]??''} placeholder={environment&&field.credential?'MY_APP_CREDENTIAL':field.placeholder??''} onChange={event=>{if(field.credential)setCredentials({...credentials,[field.name]:event.target.value});else setFields({...fields,[field.name]:event.target.value});changed(field.name)}}/>{errorText(field.name)}{availability[field.name]===false?<span className="connector-warning">{L('Credential unavailable. Saving keeps the connection disabled.','凭据不可用，保存后连接保持停用。')}</span>:null}{field.credential&&environment?<small id={'connector-env-help-'+field.name}>{L('Enter the environment variable name, not its value.','填写环境变量名，不填凭据值。')}</small>:null}</label>)}
   {definition.fields?.some(field=>field.help)?<details className="connector-advanced"><summary>{L('Field help','填写说明')}</summary>{definition.fields.filter(field=>field.help).map(field=><p key={field.name}><strong>{field.label}</strong><br/><small id={'connector-help-'+field.name}>{field.help}</small></p>)}</details>:null}
   <details className="connector-advanced"><summary>{L('Advanced settings','高级设置')}</summary><label className="connector-check"><input type="checkbox" checked={environment} onChange={event=>{setEnvironment(event.target.checked);setCredentials({});changed()}}/>{L('Use credentials from environment variables','使用环境变量中的凭据')}</label><p>{L('Changing this option clears the credential fields.','切换此选项会清空凭据字段。')}</p></details></>:null}
  {step===3&&plan?<div className="connector-review"><ShieldCheck size={22}/><h3>{L('Review settings','核对配置')}</h3><dl><dt>{L('App','应用')}</dt><dd>{definition?.label}</dd><dt>{L('Connection','连接')}</dt><dd>{label}</dd><dt>{L('Who can request work','谁能发起工作')}</dt><dd>{split(actors).length||L('Not set; connection stays disabled','尚未设置，连接保持停用')}</dd><dt>{L('Initial state','初始状态')}</dt><dd>{L('Disabled','停用')}</dd></dl><p className="connector-save-note">{L('Saving reloads the configuration. Connections may briefly disconnect.','保存后会重新载入配置，连接可能短暂断开。')}</p><p className="connector-save-note">{L('This connection stays disabled. No message test or Worker tool access is added.','此连接保持停用，不测试消息收发，也不新增 Worker 工具权限。')}</p>{Object.values(availability).includes(false)?<p className="connector-warning">{L('Credential unavailable. Connection stays disabled.','凭据不可用，连接保持停用。')}</p>:null}<p>{L('Save before','请在此时间前保存')} {new Date(plan.expiresAt).toLocaleTimeString()}</p></div>:null}
 </fieldset>{error?<p ref={errorSummary} tabIndex={-1} className="connector-error" role="alert">{issues.length?L('Check the marked fields.','请检查标出的字段。'):message(error)}</p>:null}</div><footer><button type="button" disabled={busy} onClick={()=>{if(step>1){changed();setStep(step-1)}else close()}}>{step>1?L('Back','上一步'):L('Cancel','取消')}</button><button className="connector-primary" disabled={busy||!definition}>{busy?<LoaderCircle size={15} className="connector-spin"/>:null}{step===1?L('Continue','继续'):plan?L('Save connection','保存连接'):L('Review settings','核对配置')}</button></footer></form></dialog>
}

function Repair({target,definition,L,close,saved}:{target:{sourceId:string;revision:number;kind:string};definition:Definition|undefined;L:(en:string,zh:string)=>string;close:()=>void;saved:()=>void}){
 const workspace=useWorkspaceTransport(),dialog=useRef<HTMLDialogElement>(null),latest=useRef(workspace),lifetime=useRef<AbortController|null>(null),working=useRef(false),attempted=useRef(false)
 latest.current=workspace
 const [loaded,setLoaded]=useState(false),[label,setLabel]=useState(''),[fields,setFields]=useState<Record<string,string>>({}),[credentials,setCredentials]=useState<Record<string,string>>({}),[availability,setAvailability]=useState<Record<string,boolean>>({}),[environment,setEnvironment]=useState(false),[plan,setPlan]=useState<{id:string;expiresAt:number;review:{fields:{label:string;value:string}[];credentials:{label:string;replace:boolean}[]}}|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[retry,setRetry]=useState(0)
 const key=JSON.stringify([workspace.contextKey,target.sourceId,target.revision,target.kind]),currentKey=useRef(key);currentKey.current=key
 const active=(captured:WorkspacePageContext,controller:AbortController,capturedKey:string)=>lifetime.current===controller&&!controller.signal.aborted&&!captured.readSignal.aborted&&latest.current.binding===captured.binding&&latest.current.contextKey===captured.contextKey&&currentKey.current===capturedKey
 useEffect(()=>{const element=dialog.current!,opener=document.activeElement as HTMLElement|null;element.showModal();const cancel=(event:Event)=>{event.preventDefault();close()};element.addEventListener('cancel',cancel);return()=>{element.removeEventListener('cancel',cancel);element.close();opener?.focus()}},[])
 useEffect(()=>{
  const controller=new AbortController(),captured=workspace,capturedKey=key;lifetime.current=controller;working.current=false;attempted.current=false;setLoaded(false);setLabel('');setFields({});setCredentials({});setAvailability({});setPlan(null);setBusy(false);setError('');setEnvironment(false)
  void api<any>(captured.binding,'/repair/read',{sourceId:target.sourceId,revision:target.revision}).then(value=>{
   if(!active(captured,controller,capturedKey))return
   if(!definition||value?.sourceId!==target.sourceId||value.revision!==target.revision||value.kind!==target.kind||value.enabled!==false||typeof value.label!=='string'||!value.fields||typeof value.fields!=='object'||Array.isArray(value.fields)||!Array.isArray(value.credentialAvailability))throw Error('invalid')
   const editable=definition.fields?.filter(f=>!f.credential)??[],next:Record<string,string>={}
   for(const [name,field] of Object.entries(value.fields)){if(!editable.some(f=>f.name===name)||!(typeof field==='string'||Array.isArray(field)&&field.every(v=>typeof v==='string')))throw Error('invalid');next[name]=Array.isArray(field)?field.join('\n'):field as string}
   const available:Record<string,boolean>={};for(const item of value.credentialAvailability){if(!item||!definition.fields?.some(f=>f.credential&&f.name===item.field)||typeof item.available!=='boolean')throw Error('invalid');available[item.field]=item.available}
   setLabel(value.label);setFields(next);setAvailability(available);setLoaded(true)
  }).catch(cause=>{if(active(captured,controller,capturedKey))setError(requestFailure(cause))})
  return()=>{controller.abort();if(lifetime.current===controller)lifetime.current=null}
 },[workspace.binding,workspace.contextKey,workspace.readSignal,key,retry])
 const message=error==='setup_recovery_required'?L('Configuration rollback could not finish. The host requires setup recovery before another change. Do not keep applying this plan.','配置回滚未能完成，宿主需要先恢复配置再进行其他变更，请勿继续应用此计划。'):error==='connector_conflict'||error==='connector_repair_unavailable'||error==='connector_unsupported'?L('The connection changed or is no longer repairable here. Close and refresh its current settings.','连接已变化或不再支持此修复，请关闭并刷新当前配置。'):error==='connector_plan_expired'?L('This plan expired. Close and prepare a fresh repair.','计划已过期，请关闭后重新准备修复。'):L('The repair could not be confirmed. No automatic retry was made.','修复结果尚未确认，未自动重试。')
 const submit=async(event:FormEvent)=>{
  event.preventDefault();const captured=workspace,controller=lifetime.current,capturedKey=key;if(!controller||!active(captured,controller,capturedKey)||working.current||!loaded||!definition||error==='setup_recovery_required')return
  working.current=true;setBusy(true);setError('')
  try{
   if(!plan){
    const supplied=Object.fromEntries(Object.entries(credentials).filter(([,v])=>v.trim()!==''))
    const review={fields:(definition.fields??[]).filter(field=>!field.credential).map(field=>({label:field.label,value:fields[field.name]??''})),credentials:(definition.fields??[]).filter(field=>field.credential).map(field=>({label:field.label,replace:Object.hasOwn(supplied,field.name)}))}
    const next=await api<{id:string;expiresAt:number}>(captured.binding,'/repair/plan',{sourceId:target.sourceId,revision:target.revision,fields,credentials:supplied,credentialMode:environment?'environment':'value'})
    if(!active(captured,controller,capturedKey))return
    setCredentials({})
    if(typeof next?.id!=='string'||!next.id||!Number.isFinite(next.expiresAt))throw new ConnectorRequestError('connector_request_failed')
    if(next.expiresAt<=Date.now())throw new ConnectorRequestError('connector_plan_expired')
    setPlan({id:next.id,expiresAt:next.expiresAt,review})
   }else{
    if(!attempted.current&&plan.expiresAt<=Date.now())throw new ConnectorRequestError('connector_plan_expired')
    attempted.current=true
    const value=await connectorRequest<{applied:boolean}>(captured.binding,'/api/plugin-market/connection/apply',{id:plan.id})
    if(!active(captured,controller,capturedKey))return
    if(value?.applied!==true)throw new ConnectorRequestError('connector_request_failed')
    setCredentials({});saved()
   }
  }catch(cause){if(active(captured,controller,capturedKey)){setCredentials({});setError(requestFailure(cause))}}
  finally{if(active(captured,controller,capturedKey)){working.current=false;setBusy(false)}}
 }
 return <dialog ref={dialog} className="connector-dialog" aria-labelledby="connector-repair-title"><header><h2 id="connector-repair-title">{L('Repair disabled connection','修复停用的连接')}</h2><button type="button" onClick={()=>{setCredentials({});close()}}>{L('Close','关闭')}</button></header><form noValidate onSubmit={event=>void submit(event)}><div className="connector-dialog-body">
  <p>{L('Repair preserves people and permissions. The connection stays disabled; no service check, message or tool call is made. Leave a credential blank to keep its existing reference.','修复保留人员和权限，连接保持停用，不进行服务检查、发消息或调用工具。凭据留空会保留现有引用。')}</p>
  {!loaded&&!error?<p role="status">{L('Reading editable settings…','正在读取可编辑配置……')}</p>:null}
  {loaded?<><label>{L('Connection name (unchanged)','连接名称（不变）')}<input readOnly value={label}/></label>{!plan?<fieldset disabled={busy}>{definition?.fields?.map(field=><label key={field.name}>{field.label}<input id={'repair-field-'+field.name} type={field.credential&&!environment?'password':'text'} autoComplete={field.credential?'new-password':'off'} value={(field.credential?credentials:fields)[field.name]??''} placeholder={field.credential?L('Blank keeps existing reference','留空保留现有引用'):field.placeholder??''} onChange={event=>field.credential?setCredentials({...credentials,[field.name]:event.target.value}):setFields({...fields,[field.name]:event.target.value})}/>{field.credential?<span>{availability[field.name]===true?L('Existing credential available; value hidden.','现有凭据可用，值已隐藏。'):L('Existing credential unavailable or unverified.','现有凭据不可用或尚未验证。')}</span>:null}</label>)}<label className="connector-check"><input type="checkbox" checked={environment} onChange={event=>{setEnvironment(event.target.checked);setCredentials({})}}/>{L('Replacement credentials are environment variable names','替换凭据填写环境变量名')}</label></fieldset>:<><section aria-label={L('Repair changes to review','待核对修复内容')}><h3>{L('Review repair changes','核对修复内容')}</h3><dl>{plan.review.fields.map((field,index)=><div key={'field-'+index}><dt>{field.label}</dt><dd style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{field.value||L('(empty)','（空）')}</dd></div>)}{plan.review.credentials.map((field,index)=><div key={'credential-'+index}><dt>{field.label}</dt><dd>{field.replace?L('Replace credential reference (value hidden)','替换凭据引用（值已隐藏）'):L('Keep existing credential reference','保留现有凭据引用')}</dd></div>)}</dl></section><p>{L('Review complete. Applying reloads the configuration and may briefly disconnect connections. The connection stays disabled.','核对完成，应用会重新载入配置，连接可能短暂断开；此连接保持停用。')}</p><p>{L('If the result is interrupted, retry this same plan. After leaving, inspect the connection before preparing another repair.','若结果中断，请重试同一计划。离开页面后，请先核对连接，再准备另一项修复。')}</p><time>{new Date(plan.expiresAt).toLocaleString()}</time></>}</>:null}
  {error?<p role="alert" className="connector-error">{message}</p>:null}
 </div><footer><button type="button" onClick={()=>{setCredentials({});close()}}>{L('Cancel','取消')}</button>{!loaded?<button type="button" onClick={()=>setRetry(n=>n+1)}>{L('Read settings again','重新读取配置')}</button>:<button className="connector-primary" disabled={busy||error==='setup_recovery_required'||error==='connector_plan_expired'}>{busy?L('Working…','处理中……'):plan?attempted.current?L('Retry same repair plan','重试同一修复计划'):L('Apply repair','应用修复'):L('Review repair','核对修复')}</button>}</footer></form></dialog>
}
