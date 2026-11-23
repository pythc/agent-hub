import {useEffect,useRef,useState} from 'react'
import {useWorkspaceTransport} from './workspace-context.tsx'
import './connector-management.css'
interface Environment {schema:1;kind:'current-host';ref:string;observedAt:number;workspace:{readOnly:boolean;workspaceWrite:boolean};eligibility:{sandboxCheck:boolean;sandboxStartup:'disabled'|'verified'|'failed'|'unverified';browserPublish:false;browserPublishReason:'browser_disabled'|'browser_identity_unverified';crossMachine:false}}
interface Snapshot {revision:number;environment?:Environment;platform:string;nodeVersion:string;sandboxDriver:string;browser:{state:'unsupported';code:'browser_isolation_unverified'};result:null|{revision:number;checkedAt:number;state:'passed'|'failed'|'disabled';code:string};busy:boolean}
function parse(value:unknown):Snapshot{
 const s=value as Snapshot,r=s?.result
 if(!s||!Number.isSafeInteger(s.revision)||s.revision<0||typeof s.busy!=='boolean'||![s.platform,s.nodeVersion,s.sandboxDriver].every(v=>typeof v==='string'&&v.length>0&&v.length<100)||s.browser?.state!=='unsupported'||s.browser.code!=='browser_isolation_unverified'||r!==null&&(!r||r.revision!==s.revision||!Number.isFinite(r.checkedAt)||r.checkedAt<0||r.checkedAt>8640000000000000||!['passed','failed','disabled'].includes(r.state)||!(r.state==='passed'?r.code==='sandbox_started':r.state==='disabled'?r.code==='sandbox_disabled':['sandbox_start_failed','sandbox_unverified'].includes(r.code))))throw Error('diagnostic_invalid')
 const e=s.environment
 if(e!==undefined){
  const a=e?.eligibility
  if(e?.schema!==1||e.kind!=='current-host'||typeof e.ref!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(e.ref)||!Number.isSafeInteger(e.observedAt)||e.observedAt<0||e.observedAt>8640000000000000||typeof e.workspace?.readOnly!=='boolean'||typeof e.workspace?.workspaceWrite!=='boolean'||!a||a.sandboxCheck!==(s.sandboxDriver!=='disabled')||a.sandboxStartup!==(s.sandboxDriver==='disabled'?'disabled':r?.state==='passed'?'verified':r?.state==='failed'?'failed':'unverified')||a.browserPublish!==false||!['browser_disabled','browser_identity_unverified'].includes(a.browserPublishReason)||a.crossMachine!==false)throw Error('diagnostic_invalid')
 }
 return s
}
export function LocalDiagnostics({language}:{language:'en'|'zh-CN'}){
 const workspace=useWorkspaceTransport(),L=(en:string,zh:string)=>language==='en'?en:zh
 const [data,setData]=useState<{owner:string;binding:typeof workspace.binding;value:Snapshot}|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false)
 const lifetime=useRef<{signal:AbortSignal;binding:typeof workspace.binding;owner:string}|null>(null),generation=useRef(0),working=useRef(false)
 const current=(token:NonNullable<typeof lifetime.current>)=>lifetime.current===token&&!token.signal.aborted
 const load=async()=>{
  const token=lifetime.current;if(!token||!current(token)||working.current)return
  const turn=++generation.current;setData(null);setError('')
  try{const value=parse(await token.binding.request('/api/local-diagnostics',undefined,false,undefined,token.signal));if(current(token)&&turn===generation.current)setData({owner:token.owner,binding:token.binding,value})}
  catch{if(current(token)&&turn===generation.current)setError('read')}
 }
 useEffect(()=>{
  const controller=new AbortController(),token={signal:AbortSignal.any([controller.signal,workspace.readSignal]),binding:workspace.binding,owner:workspace.contextKey}
  lifetime.current=token;working.current=false;setBusy(false);setData(null);setError('');void load()
  return()=>{controller.abort();if(lifetime.current===token)lifetime.current=null}
 },[workspace.binding,workspace.contextKey,workspace.readSignal])
 const value=!workspace.readSignal.aborted&&data?.owner===workspace.contextKey&&data.binding===workspace.binding?data.value:null
 const probe=async()=>{
  const token=lifetime.current;if(!token||!current(token)||!value||working.current||value.busy||value.environment?.eligibility.sandboxCheck===false)return
  working.current=true;setBusy(true);setError('');setData(null);++generation.current
  try{
   // Cancelling the page cancels display, not a server action. Keep the captured
   // binding and do not redirect/retry this POST in another workspace.
   const next=parse(await token.binding.request('/api/local-diagnostics/probe',{revision:value.revision,...(value.environment?{environmentRef:value.environment.ref}:{})}))
   if(!current(token))return
   if(value.environment&&(next.environment?.ref!==value.environment.ref||next.revision!==value.revision)){setError('changed');return}
   setData({owner:token.owner,binding:token.binding,value:next})
  }catch(cause){if(current(token)){const code=(cause as {payload?:{code?:unknown}})?.payload?.code;setError(code==='diagnostic_busy'?'busy':code==='settings_conflict'||code==='diagnostic_stale'?'changed':'probe')}}
  finally{if(current(token)){working.current=false;setBusy(false)}}
 }
 const result=value?.result,environment=value?.environment
 return <section className="connector-page" aria-label={L('Current environment','当前环境')}>
  <header className="connector-heading"><h1>{L('Current environment','当前环境')}</h1><button type="button" disabled={busy} onClick={()=>void load()}>{L('Refresh','刷新')}</button></header>
  <p className="connector-notice">{L('Only the host serving this workspace is checked. No other computer, website, account login or model is contacted. Results do not grant task permissions.','仅检查服务当前工作区的宿主，不联系其他电脑、网站、账号登录或模型。检查结果不授予任务权限。')}</p>
  {error?<p role="alert" className="connector-error">{error==='changed'?L('Settings or host changed. Refresh before checking again.','配置或宿主已变化，请刷新后重新检查。'):error==='busy'?L('A check is already running. Refresh to see its result.','已有检查正在运行，请刷新查看结果。'):L('The check is unavailable. Refresh and try again.','暂时无法完成检查，请刷新后重试。')}</p>:null}
  {busy?<p role="status">{L('Checking the local sandbox… Leaving this page hides the result; the bounded host check may still finish.','正在检查本地沙箱……离开页面后不再展示结果，有时限的宿主检查仍可能完成。')}</p>:!value&&!error?<p role="status">{L('Loading current environment…','正在读取当前环境……')}</p>:null}
  {value?<><p className="connector-detail">{L('Platform','平台')}: {value.platform} · Node {value.nodeVersion} · {L('Settings revision','配置版本')}: {value.revision}</p>
   <div className="connector-grid">{environment?<article className="connector-card"><h2>{L('Workspace binding','工作区绑定')}</h2>
    <p>{L('Current host only. If this workspace disconnects, there is no automatic fallback.','仅限当前宿主。此工作区断开时不会自动切换。')}</p>
    <p>{L('Configured local entry modes','已配置的本地入口模式')}: {[
     ...(environment.workspace.readOnly?[L('Read-only','只读')]:[]),
     ...(environment.workspace.workspaceWrite?[L('Workspace write','工作区写入')]:[])
    ].join(' · ')||L('None configured','未配置')}</p>
    <p className="connector-detail">{L('Configured modes are not proof of access to a particular task directory. Moving work to another machine is unavailable here.','配置模式不证明可访问具体任务目录。此处不能将任务迁到其他机器。')}</p>
    <p className="connector-detail">{L('Observed','观察时间')}: <time dateTime={new Date(environment.observedAt).toISOString()}>{new Date(environment.observedAt).toLocaleString(language)}</time></p>
   </article>:null}<article className="connector-card"><h2>{L('Command sandbox','命令沙箱')}</h2><p>{L('Configured driver','配置驱动')}: {value.sandboxDriver}</p>
    <p role="status">{value.busy?L('A local check is running. Refresh for its result.','本地检查正在运行，请刷新查看结果。'):result?.state==='passed'?L('Local sandbox startup passed.','本地沙箱启动检查通过。'):result?.state==='disabled'?L('Commands are disabled. Not verified.','命令已禁用，未验证。'):result?.state==='failed'?L('Sandbox startup failed. No unrestricted fallback was used. Review the configured driver and host sandbox policy.','沙箱启动失败，未回退到无限制执行。请检查配置的驱动和宿主沙箱策略。'):environment?.eligibility.sandboxStartup==='disabled'?L('Commands are disabled. Sandbox check unavailable.','命令已禁用，无法检查沙箱。'):L('Not checked on this host.','尚未检查此宿主。')}</p>
    {result?<time dateTime={new Date(result.checkedAt).toISOString()}>{new Date(result.checkedAt).toLocaleString(language)}</time>:null}
    <p className="connector-detail">{L('Uses a fixed read-only local probe with task-side network disabled. It does not verify a task workspace or external tool.','使用固定的只读本地探测，关闭任务侧网络。不验证具体任务工作区或外部工具。')}</p>
    <button type="button" disabled={busy||value.busy||environment?.eligibility.sandboxCheck===false} onClick={()=>void probe()}>{L('Check sandbox','检查沙箱')}</button>
   </article><article className="connector-card"><h2>{L('Browser','浏览器')}</h2><p>{L('Safe browser isolation is not verified here. Browser startup checks are unsupported; no browser was opened.','此处尚未验证安全的浏览器隔离，不支持浏览器启动检查，未打开浏览器。')}</p><p>{environment?.eligibility.browserPublishReason==='browser_disabled'?L('Unavailable for publishing: browser disabled.','不能作为发布环境：浏览器已禁用。'):L('Unavailable for publishing: no verified browser identity.','不能作为发布环境：没有已核实的浏览器身份。')}</p><p className="connector-detail">{L('Website login, publishing and model availability remain unverified.','网站登录、发布和模型可用性均未验证。')}</p></article></div></>:null}
 </section>
}
