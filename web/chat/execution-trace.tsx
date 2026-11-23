import {RecoveryPackageExport} from './recovery-package-export.tsx'
import {RecoverySummary} from './recovery-summary.tsx'
import {useEffect,useRef,useState,type ReactNode} from 'react'
import {Activity,ArrowRight,Check,CheckCircle2,Clock3,FileCheck2,GitCommitHorizontal,History,LoaderCircle,RefreshCw,ShieldQuestion,Square,Terminal,Wrench} from 'lucide-react'
import type {TraceEvent,TraceTask,TraceStage,TraceState} from '../../src/execution-trace.ts'
import {readTaskStatus,type StatusState} from './execution-status-view.ts'
import {useWorkspaceTransport} from './workspace-context.tsx'
import type {WorkspaceBinding} from './workspace-transport.ts'
import './execution-trace.css'

type Snapshot={visibility:string;at:number;revision:number;cursor:number;total:number;offset:number;more:boolean;tasks:TraceTask[]}
type Events={visibility:string;events:TraceEvent[];cursor:number;head:number;more:boolean;at:number}
type Action=TraceTask['actions'][number]
const recoveryBasis=(task:TraceTask)=>JSON.stringify([task.id,task.observed,task.revision])
class TraceRequestError extends Error {constructor(readonly code:string){super(code)}}
async function request<T>(binding:WorkspaceBinding,path:string,isCurrent:()=>boolean,signal?:AbortSignal,body?:unknown):Promise<T>{
 try{return await binding.request<T>('/api/execution-trace'+path,body,false,undefined,body===undefined?signal:undefined)}catch(cause){
  if(!isCurrent())throw new TraceRequestError('trace_obsolete')
  const error=cause as {status?:number;payload?:{code?:unknown}}
  // The shared legacy transport owns current-session login handling. Never let an
  // old page add a second redirect after its context has already changed.
  if(error?.status===401)throw new TraceRequestError('login_required')
  const code=error?.payload?.code,allowed=['trace_changed','trace_settings_conflict','trace_task_missing','trace_reconcile_required','trace_recovery_uncertain','trace_action_unavailable','trace_repair_confirmation_required','trace_cursor_ahead']
  throw new TraceRequestError(typeof code==='string'&&allowed.includes(code)?code:'trace_request_failed')
 }
}
const stageNames:Record<TraceStage,[string,string]>={task:['Task','任务'],assignment:['Dispatch','派工'],run:['Execution','执行'],approval:['Permission','授权'],tool:['Tool activity','工具动态'],result:['Result','结果'],acceptance:['Acceptance','验收'],job:['Scheduled work','调度'],delivery:['Delivery','交付'],recovery:['Recovery','恢复'],commit:['Commit evidence','提交证据'],test:['Test evidence','测试证据'],deployment:['Deployment evidence','部署证据']}
const stateNames:Record<TraceState,[string,string]>={queued:['Queued','已排队'],running:['Running','运行中'],waiting:['Waiting','等待中'],ready:['Result ready','结果就绪'],blocked:['Needs input','需要处理'],failed:['Failed','失败'],cancelled:['Stopped','已停止'],completed:['Completed','已完成'],interrupted:['Interrupted','已中断'],uncertain:['Check outcome','核查结果'],pending:['Pending','待处理'],resolved:['Resolved','已处理'],expired:['Expired','已过期'],passed:['Passed','通过'],insufficient:['Evidence missing','证据不足'],errored:['Check failed','检查失败'],stale:['Out of date','已过时'],sent:['Sent, receipt unconfirmed','已发出，待确认收到'],held:['On hold','已挂起'],dropped:['Stopped','已停止'],idle:['Idle','空闲'],starting:['Starting','启动中'],background:['Working','处理中'],human:['Human control','人工接管'],delivering:['Delivering','交付中'],merging:['Merging','合并中'],complete:['Result recorded','有结果记录'],ended:['Ended','已结束'],observed:['Observed','已记录'],sending:['Sending','发送中'],applying:['Applying','正在应用'],applied:['Applied','已应用'],declined:['Declined','已拒绝']}
const executionLabels:Record<StatusState<'execution'>,[string,string]>={not_started:['Not started','尚未开始'],queued:['Queued','已排队'],running:['Running','执行中'],waiting_input:['Waiting for input','等待输入'],interrupted:['Interrupted','已中断'],failed:['Execution failed','执行失败'],cancelled:['Stopped','已停止'],finished:['Execution finished','执行已结束'],unknown:['Unknown','未知']}
const effectLabels:Record<StatusState<'effects'>,[string,string]>={not_recorded:['No operation record','暂无操作记录'],in_progress:['In progress','效果处理中'],recorded:['Result recorded','有结果记录'],unknown:['Outcome unknown','效果未知']}
const acceptanceLabels:Record<StatusState<'acceptance'>,[string,string]>={not_recorded:['Not checked yet','尚无验收'],pending:['Awaiting acceptance','等待验收'],running:['Checking evidence','正在验收'],passed:['Passed','通过'],failed:['Acceptance failed','验收未通过'],insufficient:['Evidence insufficient','证据不足'],errored:['Check failed','验收出错'],stale:['Recheck required','需重新验收'],unknown:['Unknown','未知']}
const deliveryLabels:Record<StatusState<'delivery'>,[string,string]>={not_recorded:['No current send evidence','无当前发送证据'],pending:['Pending delivery','等待投递'],retry_wait:['Waiting to retry','等待重试'],sending:['Sending','正在投递'],uncertain:['Delivery uncertain','投递结果未知'],held:['Delivery on hold','投递已挂起'],dropped:['Delivery dropped','投递已停止'],recorded:['Sent, receipt unconfirmed','已发出，待确认收到'],partial:['Some sends need attention','部分发送待处理'],unknown:['Unknown','未知']}
function TaskStatus({value,language}:{value:unknown;language:'en'|'zh-CN'}){
 const status=readTaskStatus(value),L=(en:string,zh:string)=>language==='en'?en:zh,word=(pair:[string,string])=>pair[language==='en'?0:1]
 const executionHelp=status.execution==='unknown'?L('Execution has not been verified.','尚未核实执行情况。'):status.execution==='cancelled'?L('Stopping does not undo earlier actions.','停止不会撤销先前已发生的操作。'):null
 const cancellationHelp=status.cancellation==='requested'?L('Stop requested; managed work may still be running.','已请求停止，受管工作可能仍在运行。'):status.cancellation==='unconfirmed'?L('Could not confirm managed work stopped; review before retrying.','尚未确认受管工作停止，重试前请先核查。'):status.cancellation==='stopped'?L('Managed work stopped; earlier effects may remain.','受管工作已停止，先前影响可能仍然存在。'):null
 const effectsHelp=status.effects==='unknown'?L('Check the outcome before trying again.','再次执行前，请先核查实际结果。'):status.effects==='recorded'?L('An operation result is recorded, but the actual outcome is not verified.','有操作结果记录，实际结果尚未核实。'):null
 const acceptanceHelp=status.acceptance==='unknown'?L('Acceptance has not been verified.','尚未核实验收情况。'):status.acceptance==='stale'?L('Recheck against the latest result.','请按最新结果重新验收。'):null
 const deliveryHelp=status.delivery==='unknown'?L('Sending has not been verified.','尚未核实发送情况。'):status.delivery==='recorded'?L('The system recorded it as sent; receipt is unconfirmed.','系统记录已发出，尚未确认对方收到。'):status.delivery==='uncertain'?L('Check whether it arrived before sending again.','再次发送前，请先核查对方是否收到。'):status.delivery==='partial'?L('Some sends are recorded; others still need attention.','部分已记录发出，其余仍待处理。'):status.delivery==='dropped'?L('Previously sent content is not recalled.','先前已发出的内容不会因此收回。'):null
 const tone=(state:string)=>['unknown','uncertain','stale','insufficient','waiting_input','held','retry_wait'].includes(state)?'attention':['failed','errored'].includes(state)?'failure':state==='passed'?'verified':'neutral'
 return <section className="trace-status" aria-label={L('Four independent task states','四项独立任务状态')}><dl className="trace-status-grid">
  <div data-facet="execution" data-state={status.execution} data-tone={tone(status.execution)}><dt><Terminal size={16} aria-hidden="true"/>{L('Execution','执行')}</dt><dd><strong>{word(executionLabels[status.execution])}</strong>{cancellationHelp||executionHelp?<p>{cancellationHelp||executionHelp}</p>:null}</dd></div>
  <div data-facet="effects" data-state={status.effects} data-tone={tone(status.effects)}><dt><History size={16} aria-hidden="true"/>{L('Operation outcome','操作结果')}</dt><dd><strong>{word(effectLabels[status.effects])}</strong>{effectsHelp?<p>{effectsHelp}</p>:null}</dd></div>
  <div data-facet="acceptance" data-state={status.acceptance} data-tone={tone(status.acceptance)}><dt><FileCheck2 size={16} aria-hidden="true"/>{L('Acceptance','验收')}</dt><dd><strong>{word(acceptanceLabels[status.acceptance])}</strong>{acceptanceHelp?<p>{acceptanceHelp}</p>:null}</dd></div>
  <div data-facet="delivery" data-state={status.delivery} data-tone={tone(status.delivery)}><dt><ArrowRight size={16} aria-hidden="true"/>{L('Sending','发送')}</dt><dd><strong>{word(deliveryLabels[status.delivery])}</strong>{deliveryHelp?<p>{deliveryHelp}</p>:null}</dd></div>
 </dl></section>
}
function workerName(id:string|undefined,language:'en'|'zh-CN'){
 const worker=language==='en'?'Worker':'Worker',number=id?.match(/^worker[-_](\d+)$/)
 if(number)return worker+' '+number[1]
 const known:Record<string,[string,string]>={research:['Research','研究'],planning:['Planning','规划'],review:['Review','审阅']}
 if(id&&known[id])return known[id]![language==='en'?0:1]
 if(id&&/^[a-z]+(?:[-_][a-z]+){0,3}$/.test(id)&&id.length<=32&&!/secret|token|password/.test(id))return id.replaceAll(/[-_]/g,' ').replace(/^./,c=>c.toUpperCase())
 return worker
}
function StageIcon({stage}:{stage:TraceStage}){const Icon=stage==='approval'?ShieldQuestion:stage==='acceptance'||stage==='test'?FileCheck2:stage==='commit'?GitCommitHorizontal:stage==='tool'?Wrench:stage==='run'?Terminal:stage==='result'?CheckCircle2:stage==='assignment'?ArrowRight:Clock3;return <Icon size={16} aria-hidden="true"/>}
function readProjectIntegration(value:unknown){
 const own=(v:any,k:string):any=>{if(!v||typeof v!=='object'||Array.isArray(v))return undefined;const d=Object.getOwnPropertyDescriptor(v,k);return d&&Object.hasOwn(d,'value')?d.value:undefined},sha=(v:unknown)=>typeof v==='string'&&/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(v),states=['passed','failed','unverified']
 try{
  const role=own(value,'role'),ownership=own(value,'ownership'),head=own(value,'head'),count=own(value,'sharedFileCount'),lockfiles=own(value,'defaultLockfiles'),legacy=own(value,'legacyTest'),complete=own(value,'complete'),owner=own(value,'ownerWorkerId'),raw=own(value,'checks')
  if(own(value,'schema')!==1||!['integration','contributor'].includes(role)||!['checked','blocked','legacy_unknown','unverified'].includes(ownership)||!(head===null||sha(head))||!Number.isSafeInteger(count)||count<0||typeof lockfiles!=='boolean'||!states.includes(legacy)||typeof complete!=='boolean'||!(owner===null||typeof owner==='string'&&owner.length>0&&owner.length<=1000)||!Array.isArray(raw)||raw.length!==3)return null
  const checks:{kind:string;state:string}[]=[]
  for(let i=0;i<3;i++){const item=Object.getOwnPropertyDescriptor(raw,String(i))?.value,kind=own(item,'kind'),state=own(item,'state'),at=own(item,'head');if(!['build','start','business'].includes(kind)||checks.some(c=>c.kind===kind)||!states.includes(state)||!(at===null||sha(at)))return null;checks.push({kind,state:ownership==='checked'&&head&&at===head?state:'unverified'})}
  return {role,ownership,head,count,lockfiles,legacy,checks,complete:complete&&role==='integration'&&ownership==='checked'&&!!head&&legacy==='passed'&&checks.every(c=>c.state==='passed')}
 }catch{return null}
}
export function ProjectIntegrationEvidence({value,language='en'}:{value:unknown;language?:'en'|'zh-CN'}){
 const L=(en:string,zh:string)=>language==='zh-CN'?zh:en,data=readProjectIntegration(value),label=(state:string)=>state==='passed'?L('Passed','通过'):state==='failed'?L('Failed','失败'):L('Not recorded','未记录')
 return <details className="trace-records"><summary>{L('Integration evidence','集成证据')}</summary><div className="trace-records-body">{data?<>
  <p>{data.role==='integration'?L('Integration responsibility, not additional permission','集成责任，不构成额外权限'):L('Contributor responsibility, not additional permission','贡献责任，不构成额外权限')}</p>
  <p>{data.ownership==='checked'?L('Ownership checked','归属已核对'):data.ownership==='blocked'?L('Ownership blocked','归属检查受阻'):L('Ownership unverified','归属未核实')}</p><p>{L('Protected shared files: ','受保护的共享文件：')}{data.count}</p><p>{data.lockfiles?L('Default lockfiles are protected','默认锁文件受保护'):L('Default lockfile protection not recorded','默认锁文件保护未记录')}</p>
  {data.head?<p>{L('Commit','提交')} · {data.head.slice(0,12)}</p>:null}
  <dl className="trace-facts">{['build','start','business'].map(kind=><div key={kind}><dt>{kind==='build'?L('Build','构建'):kind==='start'?L('Start readiness','启动就绪'):L('Business checks','业务验证')}</dt><dd>{label(data.checks.find(c=>c.kind===kind)!.state)}</dd></div>)}</dl>
  <p>{L('Legacy combined test','旧综合测试')} · {label(data.legacy)}</p><p>{data.complete?L('Same-commit integration evidence complete','同提交集成证据完整'):L('Integration evidence incomplete','集成证据不完整')}</p>
 </>:<p>{L('Not recorded','未记录')}</p>}</div></details>
}

export function TaskQueueSummary({value,language='en'}:{value:unknown;language?:'en'|'zh-CN'}){
 const L=(en:string,zh:string)=>language==='zh-CN'?zh:en
 const labels:Record<string,[string,string]>={control:['Host control','主机控制'],uncertain:['Outcome needs checking','结果待核查'],not_pending:['Not pending','非待执行状态'],retry_delay:['Retry delay','等待重试时间'],paused:['Scheduling paused','调度暂停'],authority_held:['Authority held','授权暂挂'],project_held:['Project held','项目暂挂'],external_wait:['External work','等待外部工作'],recovery:['Recovery pending','等待恢复'],routing_ownership:['Router ownership','Router 归属'],discussion_serialization:['Conversation serialization','会话串行等待'],routing_capacity:['Router capacity','Router 容量'],background_capacity:['Background capacity','后台容量'],worker_capacity:['Worker capacity','Worker 容量'],task_running:['Task already running','任务已在运行'],task_held:['Task held','任务暂挂'],worker_busy:['Worker busy','Worker 忙碌'],resource_quota:['Resource quota','资源配额'],eligible:['Eligible, not a start guarantee','符合条件，不保证立即开始'],context_unavailable:['Context unavailable','上下文不可用']}
 const read=()=>{
  const own=(v:unknown,key:string):unknown=>{if(!v||typeof v!=='object'||Array.isArray(v))return undefined;const d=Object.getOwnPropertyDescriptor(v,key);return d&&Object.hasOwn(d,'value')?d.value:undefined},count=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0,nullable=(v:unknown):v is number|null=>v===null||count(v)
  try{
   const reason=own(value,'reason'),waitMs=own(value,'waitMs'),raw=own(value,'resources')
   if(own(value,'schema')!==1||typeof reason!=='string'||!Object.hasOwn(labels,reason)||!nullable(waitMs)||!Array.isArray(raw)||raw.length>1000)return null
   const resources:{kind:'project'|'backend'|'workspace';ref:string;limit:number|null;used:number;reserved:number;available:number|null;blocker:'limit_reached'|'identity_unknown'|null}[]=[]
   for(let i=0;i<raw.length;i++){const r=Object.getOwnPropertyDescriptor(raw,String(i))?.value,kind=own(r,'kind'),ref=own(r,'ref'),limit=own(r,'limit'),used=own(r,'used'),reserved=own(r,'reserved'),available=own(r,'available'),blocker=own(r,'blocker');if(!['project','backend','workspace'].includes(kind as string)||typeof ref!=='string'||!/^resource-[a-f0-9]{12}$/.test(ref)||!nullable(limit)||!count(used)||!count(reserved)||!nullable(available)||![null,'limit_reached','identity_unknown'].includes(blocker as string|null))return null;resources.push({kind:kind as 'project'|'backend'|'workspace',ref,limit,used,reserved,available,blocker:blocker as 'limit_reached'|'identity_unknown'|null})}
   return {reason,waitMs,resources}
  }catch{return null}
 }
 const data=read(),unknown=L('Not recorded','未记录'),row=(name:string,value:ReactNode)=><div><dt>{name}</dt><dd>{value}</dd></div>
 return <details className="trace-records"><summary>{L('Queue and resource limits','排队与资源限制')}</summary><div className="trace-records-body">{data?<>
  <dl className="trace-facts">{row(L('Current reason','当前原因'),L(...labels[data.reason]!))}{row(L('Waited (ms)','已等待（毫秒）'),data.waitMs??unknown)}</dl>
  {data.resources.map((r,i)=><section key={i}><h4>{r.kind==='project'?L('Project','项目'):r.kind==='backend'?L('Backend','后端'):L('Workspace','工作区')} · {r.ref}</h4><dl className="trace-facts">{row(L('Limit','上限'),r.limit??unknown)}{row(L('In use','已使用'),r.used)}{row(L('Reserved','已预留'),r.reserved)}{row(L('Available','可用'),r.available??unknown)}{row(L('Restriction','限制'),r.blocker==='limit_reached'?L('Limit reached','已达上限'):r.blocker==='identity_unknown'?L('Resource identity unverified','资源身份未核实'):L('No restriction recorded','未记录限制'))}</dl></section>)}
 </>:<p>{unknown}</p>}</div></details>
}

export function TaskAssignmentSummary({value,language='en'}:{value:unknown;language?:'en'|'zh-CN'}){
 const L=(en:string,zh:string)=>language==='zh-CN'?zh:en
 const read=()=>{
  const own=(v:unknown,key:string):unknown=>{if(!v||typeof v!=='object'||Array.isArray(v))return undefined;const field=Object.getOwnPropertyDescriptor(v,key);return field&&Object.hasOwn(field,'value')?field.value:undefined}
  const text=(v:unknown,max=4000):v is string=>typeof v==='string'&&v.length>0&&v.length<=max
  const count=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0
  const list=(v:unknown):string[]|null=>{if(!Array.isArray(v)||v.length>1000)return null;const out:string[]=[];for(let i=0;i<v.length;i++){const item=Object.getOwnPropertyDescriptor(v,String(i))?.value;if(!text(item))return null;out.push(item)}return out}
  try{
   const objective=own(value,'objective'),inputCount=own(value,'inputCount'),dependencyCount=own(value,'dependencyCount'),tools=list(own(value,'tools')),connections=list(own(value,'connections')),workspace=own(value,'workspace'),budget=own(value,'budget'),createdAt=own(value,'createdAt'),blocker=own(value,'blocker')
   const access=own(workspace,'access'),network=own(workspace,'network'),leaseCount=own(workspace,'leaseCount'),revision=own(value,'contractRevision')
   if(own(value,'schema')!==1||!text(objective,100000)||!count(inputCount)||!count(dependencyCount)||!tools||!connections||!['read-only','workspace-write'].includes(access as string)||own(workspace,'scope')!=='whole_root'||typeof network!=='boolean'||!count(leaseCount)||!count(createdAt)||createdAt>8640000000000000||!budget||typeof budget!=='object'||Array.isArray(budget)||blocker!==undefined&&!text(blocker))return null
   const limits:Record<string,number>={}
   for(const key of ['timeoutMs','maxSteps','maxToolCalls','maxOutputTokens']){const v=own(budget,key);if(Object.hasOwn(budget,key)){if(!count(v)||v===0)return null;limits[key]=v}}
   let contract:null|{key:string;version:number;digest:string;inputs:string[];outputs:string[];acceptance:string[]}=null
   if(Object.hasOwn(value as object,'interface')){const v=own(value,'interface'),inputs=list(own(v,'inputs')),outputs=list(own(v,'outputs')),acceptance=list(own(v,'acceptance')),version=own(v,'version'),digest=own(v,'digest');if(!text(own(v,'key'))||!count(version)||!text(digest,64)||!/^([a-f0-9]{64})$/.test(digest)||!inputs||!outputs||!acceptance)return null;contract={key:own(v,'key') as string,version,digest,inputs,outputs,acceptance}}
   return {objective,inputCount,dependencyCount,tools,connections,access:access as string,network,leaseCount,limits,contract,createdAt,contractRevision:count(revision)&&revision>0?revision:null,blocker:typeof blocker==='string'?blocker:null}
  }catch{return null}
 }
 const data=read(),unknown=L('Not recorded','未记录'),unconfigured=L('Not configured','未配置')
 const blockerLabels:Record<string,string>={
  assignment_contract_interface_superseded:L('The collaboration interface was replaced. This assignment cannot use the old version.','协作接口已替代，此派工不能继续使用旧版本。'),
  required_capability_unavailable:L('A required capability is unavailable.','所需能力当前不可用。'),
  capability_changed:L('Available capabilities changed after dispatch.','派工后的可用能力已变更。'),
  backend_changed:L('The execution backend changed after dispatch.','派工后的执行后端已变更。'),
  basis_changed:L('The assignment basis changed.','派工依据已变更。'),
  initial_input_changed:L('The initial input changed after dispatch.','派工后的初始输入已变更。'),
  dependency_not_independently_accepted:L('A dependency has not passed independent acceptance.','依赖尚未通过独立验收。'),
  authority_ended:L('The authority for this assignment ended.','此派工的授权已结束。'),
 }
 const row=(label:string,content:ReactNode)=><div><dt>{label}</dt><dd>{content}</dd></div>
 const items=(values:string[])=>values.length?<ul>{values.map((v,i)=><li key={i}>{v}</li>)}</ul>:L('None recorded','已记录为空')
 return <details className="trace-records"><summary>{data?.contractRevision?L('Assignment agreement','派工约定'):L('Assignment agreement at dispatch','派工时约定')}</summary><div className="trace-records-body">{data?<>
  <p>{data.objective}</p><dl className="trace-facts">{data.contractRevision!==null?row(L('Contract revision','派工约定版本'),data.contractRevision):null}{row(L('Inputs','输入'),data.inputCount)}{row(L('Dependencies','依赖'),data.dependencyCount)}{row(L('Recorded at','记录时间'),new Date(data.createdAt).toLocaleString(language,{timeZone:'UTC',timeZoneName:'short'}))}</dl>
  {data.contract?<dl className="trace-facts">{row(L('Interface name','接口名称'),data.contract.key)}{row(L('Interface version','接口版本'),data.contract.version)}{row(L('Interface fingerprint','接口指纹'),data.contract.digest.slice(0,12))}</dl>:null}
  <dl className="trace-facts">{row(L('Interface inputs','接口输入'),data.contract?items(data.contract.inputs):unknown)}{row(L('Interface outputs','接口输出'),data.contract?items(data.contract.outputs):unknown)}{row(L('Acceptance requirements','验收要求'),data.contract?items(data.contract.acceptance):unknown)}</dl>
  <dl className="trace-facts">{row(L('Tool ceiling','工具权限上限'),items(data.tools))}{row(L('Connection ceiling','连接权限上限'),items(data.connections))}</dl><p>{L('These limits do not grant additional permission.','这些上限不构成额外授权。')}</p>
  <dl className="trace-facts">{row(L('Workspace access','工作区访问'),data.access==='read-only'?L('Read only','只读'):L('Workspace write','工作区可写'))}{row(L('Workspace scope','工作区范围'),L('Whole root, not individual files','整个根目录，非文件粒度'))}{row(L('Managed workspace network','受管工作区网络'),data.network?L('Allowed','允许'):L('Disabled','禁用'))}{row(L('Workspace leases','工作区租约'),data.leaseCount===0?L('Awaiting start · no lease acquired','待启动 · 未获得租约'):data.leaseCount)}</dl><p>{L('Workspace network policy does not describe provider network access.','工作区网络策略不代表模型服务方的联网状态。')}</p>
  <dl className="trace-facts">{row(L('Timeout (ms)','超时（毫秒）'),data.limits.timeoutMs??unconfigured)}{row(L('Step limit','步骤上限'),data.limits.maxSteps??unconfigured)}{row(L('Tool-call limit','工具调用上限'),data.limits.maxToolCalls??unconfigured)}{row(L('Output token limit','输出 token 上限'),data.limits.maxOutputTokens??unconfigured)}</dl><p>{L('Unconfigured is not unlimited or a cost guarantee.','未配置不表示无限，也不构成费用承诺。')}</p>
  {data.blocker?<p>{Object.hasOwn(blockerLabels,data.blocker)?blockerLabels[data.blocker]:L('Assignment restriction recorded','已记录派工限制')}</p>:null}
 </>:<p>{unknown}</p>}</div></details>
}

export function AsyncInboxSummary({value,language='en'}:{value:unknown;language?:'en'|'zh-CN'}){
 const L=(en:string,zh:string)=>language==='zh-CN'?zh:en
 const read=()=>{
  const own=(v:unknown,key:string):unknown=>{if(!v||typeof v!=='object'||Array.isArray(v))return undefined;const field=Object.getOwnPropertyDescriptor(v,key);return field&&Object.hasOwn(field,'value')?field.value:undefined}
  const count=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0
  try{
   const received=own(value,'received'),applied=own(value,'applied'),archived=own(value,'archived'),latest=own(value,'latest')
   if(own(value,'schema')!==1||!count(received)||!count(applied)||!count(archived)||applied+archived!==received)return null
   if(latest===null)return {received,applied,archived,latest:null}
   const kind=own(latest,'kind'),disposition=own(latest,'disposition'),observedAt=own(latest,'observedAt')
   if(!['progress','blocked','result'].includes(kind as string)||!['applied','archived'].includes(disposition as string)||!count(observedAt)||observedAt>8640000000000000||received===0||disposition==='applied'&&applied===0||disposition==='archived'&&archived===0)return null
   return {received,applied,archived,latest:{kind:kind as 'progress'|'blocked'|'result',disposition:disposition as 'applied'|'archived',observedAt}}
  }catch{return null}
 }
 const inbox=read()
 return <details className="trace-records"><summary>{L('Async events','异步事件')}</summary><div className="trace-records-body">
  {inbox?<><dl className="trace-facts"><div><dt>{L('Received','已接收')}</dt><dd>{inbox.received}</dd></div><div><dt>{L('Applied','已采用')}</dt><dd>{inbox.applied}</dd></div><div><dt>{L('Archived only','仅归档')}</dt><dd>{inbox.archived}</dd></div></dl>
   {inbox.latest?<dl className="trace-facts"><div><dt>{L('Latest event','最近事件')}</dt><dd>{({progress:L('Progress','进展'),blocked:L('Blocked','受阻'),result:L('Result','结果')})[inbox.latest.kind]}</dd></div><div><dt>{L('Handling','处理状态')}</dt><dd>{inbox.latest.disposition==='applied'?L('Applied','已采用'):L('Archived only','仅归档')}</dd></div><div><dt>{L('Recorded at','记录时间')}</dt><dd><time dateTime={new Date(inbox.latest.observedAt).toISOString()}>{new Date(inbox.latest.observedAt).toLocaleString(language,{timeZone:'UTC',timeZoneName:'short'})}</time></dd></div></dl>:<p>{L('Latest event not recorded','最近事件未记录')}</p>}
   <p>{L('Receiving or applying a result does not mean task acceptance passed.','接收或采用结果不等于任务验收通过。')}</p></>:<p>{L('Not recorded','未记录')}</p>}
 </div></details>
}

export function ExecutionTrace({language='en'}:{language?:'en'|'zh-CN'}){
 const {binding,contextKey,readSignal}=useWorkspaceTransport()
 const L=(en:string,zh:string)=>language==='en'?en:zh,word=(names:[string,string])=>names[language==='en'?0:1]
 const [snapshot,setSnapshot]=useState<Snapshot|null>(null),[events,setEvents]=useState<TraceEvent[]>([]),[selected,setSelected]=useState(''),[more,setMore]=useState(false),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[error,setError]=useState(''),[actionError,setActionError]=useState(''),[notice,setNotice]=useState(''),[confirmResume,setConfirmResume]=useState(''),[confirmStop,setConfirmStop]=useState(''),[truncated,setTruncated]=useState(false)
 const taskNumbers=useRef(new Map<string,number>())
 const taskName=(item:TraceTask)=>{if(!taskNumbers.current.has(item.id))taskNumbers.current.set(item.id,taskNumbers.current.size+1);return workerName(item.workerId,language)+L(' · Task ',' · 任务 ')+taskNumbers.current.get(item.id)}
 const cursor=useRef(0),visibility=useRef(''),generation=useRef(0),refreshRef=useRef<(retryPage?:boolean)=>Promise<void>>(async()=>{}),eventRef=useRef<()=>Promise<void>>(async()=>{})
 const page=useRef({binding,contextKey,selected}),pageRead=useRef<AbortSignal|null>(null)
 page.current={binding,contextKey,selected}
 const pageCurrent=()=>page.current.binding===binding&&page.current.contextKey===contextKey&&page.current.selected===selected&&!readSignal.aborted
 const task=snapshot?.tasks.find(t=>t.id===selected),active=snapshot?.tasks.filter(t=>['running','starting','background'].includes(t.state)).length??0,waiting=snapshot?.tasks.filter(t=>['waiting','blocked'].includes(t.state)).length??0,uncertain=snapshot?.tasks.filter(t=>t.unknownEffects).length??0
 const basis=task?recoveryBasis(task):'',latestBasis=useRef('')
 useEffect(()=>{
  const controller=new AbortController(),signal=AbortSignal.any([controller.signal,readSignal]),current=++generation.current;let fetching=false,hasMore=false,pageFailed=false,retryQueued=false
  pageRead.current=signal
  const isCurrent=()=>generation.current===current&&pageCurrent()&&!signal.aborted
  cursor.current=0;visibility.current='';latestBasis.current='';setEvents([]);setLoading(true);setMore(false);setTruncated(false);setNotice('');setActionError('');setConfirmStop('');setConfirmResume('');setBusy(false)
  const resetTimeline=()=>{cursor.current=0;hasMore=false;pageFailed=false;setEvents([]);setMore(false);setTruncated(false)}
  const readEvents=async()=>{
   if(!isCurrent())return
   const query=new URLSearchParams({cursor:String(cursor.current),limit:'100',...(selected?{ticketId:selected}:{})})
   const data=await request<Events>(binding,'/events?'+query,isCurrent,signal)
   if(!isCurrent())return
   if(visibility.current&&visibility.current!==data.visibility){visibility.current=data.visibility;resetTimeline();return}
   visibility.current=data.visibility;cursor.current=data.cursor;hasMore=data.more;pageFailed=false;setMore(data.more)
   setEvents(previous=>{const seen=new Set(previous.map(e=>e.id)),all=[...previous,...data.events.filter(e=>!seen.has(e.id))];if(all.length>600)setTruncated(true);return all.slice(-600)})
  }
  const refresh=async(retryPage=false)=>{
   if(!isCurrent())return
   if(fetching){if(retryPage&&pageFailed)retryQueued=true;return}
   fetching=true
   try{
    const data=await request<Snapshot>(binding,'?limit=100',isCurrent,signal)
    if(!isCurrent())return
    if(visibility.current&&visibility.current!==data.visibility)resetTimeline()
    const observedTask=data.tasks.find(t=>t.id===selected),observedBasis=observedTask?recoveryBasis(observedTask):''
    if(latestBasis.current!==observedBasis){latestBasis.current=observedBasis;setConfirmStop('');setConfirmResume('')}
    visibility.current=data.visibility;setSnapshot(data)
    if(!hasMore||(retryPage&&pageFailed))await readEvents()
    if(isCurrent()&&!pageFailed)setError('')
   }catch(cause){if(isCurrent()){const code=cause instanceof TraceRequestError?cause.code:'trace_refresh_failed';setError(code);if(code==='trace_task_missing'){setEvents([]);setSelected('')}if(code==='trace_cursor_ahead')resetTimeline()}}
   finally{if(isCurrent()){setLoading(false);finishRead()}}
  }
  const finishRead=()=>{
   if(!isCurrent())return
   fetching=false
   if(retryQueued){retryQueued=false;if(pageFailed)void refresh(true)}
  }
  refreshRef.current=refresh
  eventRef.current=async()=>{if(fetching||!isCurrent())return;fetching=true;try{await readEvents();if(isCurrent())setError('')}catch(cause){if(isCurrent()){if(cause instanceof TraceRequestError&&cause.code==='trace_cursor_ahead'){resetTimeline();setError(cause.code)}else{pageFailed=true;setError('trace_refresh_failed')}}}finally{finishRead()}}
  void refresh();const timer=setInterval(()=>void refresh(),3000)
  return()=>{controller.abort();clearInterval(timer);if(generation.current===current)generation.current++}
 },[selected,binding,contextKey,readSignal])
 const failure=(code:string)=>code==='trace_changed'||code==='trace_settings_conflict'?L('This task changed. Review its current state before trying again.','任务状态已变更，请核对最新状态后重试。'):code==='trace_reconcile_required'?L('Check the external outcome before repeating any work.','请先核查外部结果，再决定是否重复执行。'):code==='trace_recovery_uncertain'?L('The action could not be confirmed. Check the current task and original session.','操作结果尚未确认，请检查当前任务和原会话。'):code==='trace_action_unavailable'?L('This action is no longer available. Review the latest task state.','此操作已不可用，请查看最新任务状态。'):code==='trace_repair_confirmation_required'?L('Confirm that you have checked or repaired the reported problem before a single manual continuation.','请确认已核查或修复所报问题，再手动继续一次。'):code==='trace_cursor_ahead'?L('The saved history changed. Refresh to reload the timeline.','历史记录已变更，请刷新以重新加载轨迹。'):L('Updates are unavailable. Your last known state is still shown.','暂时无法更新，当前显示最近一次已知状态。')
 async function recover(action:Action,repairConfirmed=false,confirmedBasis?:string){
  const current=generation.current,signal=pageRead.current
  const isCurrent=()=>generation.current===current&&pageCurrent()&&!!signal&&!signal.aborted
  if(!task||busy||!isCurrent()||(confirmedBasis!==undefined&&confirmedBasis!==latestBasis.current))return
  setBusy(true);setActionError('');setNotice('');setConfirmStop('');setConfirmResume('')
  try{
   const result=await request<{status:string}>(binding,'/recover',isCurrent,undefined,{ticketId:task.id,action,revision:task.revision,observed:task.observed,...(repairConfirmed?{repairConfirmed:true}:{}),requestId:crypto.randomUUID()})
   if(!isCurrent())return
   const messages:Record<string,[string,string]>={inspected:['Current task state checked.','已核对当前任务状态。'],history_verified:['The original session is readable. External outcomes still need review.','原会话可读取，外部结果仍需核查。'],history_unavailable:['The original session could not be read. No work was repeated.','暂时无法读取原会话，未重复执行任务。'],resumed:['Resuming the original task and session.','正在恢复原任务及原会话。'],cancelled:['Task stopped. Existing external effects remain.','任务已停止，已发生的外部效果仍保留。']}
   setNotice(word(messages[result.status]??['Action completed.','操作已完成。']))
  }catch(cause){if(isCurrent())setActionError(cause instanceof TraceRequestError?cause.code:'trace_recovery_uncertain')}
  finally{if(isCurrent()){await refreshRef.current();if(isCurrent())setBusy(false)}}
 }
 const guidance=task?.next==='reconcile'?L('Check the actual outcome before trying again.','请先核查实际结果，再决定是否重试。'):task?.next==='answer_approval'?L('This task needs permission. Use its existing approval controls.','任务需要授权，请在原任务中处理。'):task?.next==='reconnect'?L('Review the connection and verify authentication before continuing.','请先检查连接配置并验证认证状态。'):task?.next==='review_context'?L('Access changed. Review it before continuing.','访问权限已变更，请核对后再继续。'):task?.next==='follow_up'?L('The Worker needs your reply in the original conversation.','Worker 等待你的回复，请回到原会话继续。'):null
 const receiptLabels={progress:L('Worker progress','Worker 进展'),blocked:L('Worker blocked','Worker 受阻'),result:L('Worker result','Worker 结果')}
 const timeline=<>
  <div className="trace-timeline-heading"><h2>{L('Activity','动态记录')}</h2></div>
  {loading&&!events.length?<div className="trace-empty" role="status"><LoaderCircle size={23} className="trace-spin"/><p>{L('Loading activity…','正在加载动态…')}</p></div>:events.length?<ol className="trace-timeline">{events.map(event=><li key={event.id} data-state={event.state}><div className="trace-event-icon"><StageIcon stage={event.stage}/></div><div className="trace-event-main"><div><strong>{event.workerEvent?receiptLabels[event.workerEvent.kind]:word(stageNames[event.stage])}</strong><span className="trace-state" data-state={event.state}>{event.workerEvent?.disposition==='archived'?L('Archived only','仅归档'):word(stateNames[event.state])}</span></div><p>{event.ticketId?(()=>{const item=snapshot?.tasks.find(t=>t.id===event.ticketId);return item?taskName(item):L('Earlier task','较早任务')})():L('Team activity','团队动态')}{event.baseline?' · '+L('First recorded state','首次记录的状态'):''}{event.hasResult?' · '+L('Result saved','结果已保留'):''}{event.stage==='delivery'&&event.state==='sent'?' · '+L('Receipt is unconfirmed','尚未确认对方收到'):''}</p></div><time dateTime={event.at} title={new Date(event.at).toLocaleString(language)}>{new Date(event.at).toLocaleTimeString(language,{hour:'2-digit',minute:'2-digit'})}</time></li>)}</ol>:<div className="trace-empty"><Activity size={32} strokeWidth={1.3}/><h2>{L('Your team’s progress appears here','团队进展会显示在这里')}</h2><p>{L('Choose a task to see its progress and next steps.','选择任务，查看进展和下一步。')}</p><a href="/chat">{L('Return to the conversation','返回会话')}<ArrowRight size={15}/></a></div>}
  {more?<button className="trace-load-more" disabled={busy||loading} onClick={()=>void eventRef.current()}>{L('Load more','加载更多')}</button>:null}
  {truncated?<p className="trace-muted">{L('Showing the latest 600 loaded activities. Reload to read earlier records.','显示最近加载的 600 条动态，重新加载可查看较早记录。')}</p>:null}
 </>
 return <section className="trace-page" aria-labelledby="trace-title">
  <header className="trace-heading"><div><h1 id="trace-title">{L('Task progress','任务进展')}</h1></div><button type="button" disabled={loading||busy} onClick={()=>{setActionError('');void refreshRef.current(true)}}><RefreshCw size={16} className={loading?'trace-spin':''}/>{L('Refresh','刷新')}</button></header>
  <div className="trace-summary" aria-label={L('Shown task counts','当前所示任务统计')}><div><Activity size={17}/><strong>{active}</strong><span>{L('Working','正在执行')}</span></div><div><ShieldQuestion size={17}/><strong>{waiting}</strong><span>{L('Needs input','等待处理')}</span></div><div data-attention={uncertain>0}><History size={17}/><strong>{uncertain}</strong><span>{L('Needs checking','待核查结果')}</span></div></div>
  {actionError||error?<p className="trace-notice trace-error" role="alert">{failure(actionError||error)}<button onClick={()=>{setActionError('');void refreshRef.current(true)}}>{L('Try refresh','重试刷新')}</button></p>:null}
  {notice?<p className="trace-notice" role="status"><Check size={16}/>{notice}</p>:null}
  <div className="trace-toolbar"><label htmlFor="trace-task">{L('Task','任务')}</label><select id="trace-task" aria-label={L('Show','显示')} value={selected} onChange={e=>setSelected(e.target.value)}><option value="">{L('All tasks','全部任务')}</option>{snapshot?.tasks.map(t=><option value={t.id} key={t.id}>{taskName(t)}</option>)}</select></div>
  {snapshot?.more?<p className="trace-muted">{L('Showing the 100 latest tasks.','显示最近更新的 100 项任务。')}</p>:null}
  {task?<article className="trace-task-detail"><header><h2>{taskName(task)}</h2></header><TaskStatus value={task.status} language={language}/>
   {guidance?<p className="trace-guidance">{guidance}{task.next==='reconnect'?<a href="/configure#connectors">{L('Open connections','打开连接设置')}<ArrowRight size={14}/></a>:null}</p>:null}
   {task.next!=='reconnect'&&['auth_required','configuration_invalid'].includes(task.problem)?<p className="trace-guidance">{L('Also check the account and connection.','还需核对账号与连接。')}<a href="/configure#connectors">{L('Open connections','打开连接设置')}<ArrowRight size={14}/></a></p>:null}
   {task.blocker?<p className="trace-guidance" role="status">{({
    reconnect_same_account:L('Reconnect the account used by this task. Reconnection does not replay earlier actions.','请重新连接此任务原来使用的账号；重连不会重放先前操作。'),
    wait_for_policy:L('Rate limited. Wait for the existing retry policy; this view does not schedule or repeat requests.','请求受限。请等待现有重试策略处理；此页面不会调度或重复请求。'),
    review_rate_limit:L('Rate limited, with no future retry schedule recorded. Check the provider limit before a single manual continuation.','请求受限，尚无未来重试计划记录。请先核查服务方限制，再手动继续一次。'),
    review_quota:L('Quota is exhausted. Check the existing account quota before continuing; do not repeatedly retry.','额度已耗尽。继续前请核对原账号额度，不要反复重试。'),
    reconcile:L('The effect is unknown. Verify the existing operation before retrying; do not resend it.','操作效果未知。先核实已有操作，不要直接重发。'),
    review_context:L('Review current context access or limits before continuing.','继续前请核对当前上下文权限或限制。'),
    review_configuration:L('Review the current backend configuration; do not switch accounts to bypass the problem.','请核对当前后端配置，不要通过切换账号绕过问题。'),
    inspect:L('Inspect current state before choosing a recovery action.','先核对当前状态，再选择恢复操作。'),
   })[task.blocker.resolution]}{task.blocker.retryPolicy.notBefore?<span>{L(' Scheduled retry no earlier than: ',' 已有重试计划不早于：')}{new Date(task.blocker.retryPolicy.notBefore).toLocaleString()}</span>:null}</p>:null}
   <ProjectIntegrationEvidence value={task.projectIntegration} language={language}/>
   <TaskQueueSummary value={task.queue} language={language}/>
   <TaskAssignmentSummary value={task.assignment} language={language}/>
   <AsyncInboxSummary value={task.asyncInbox} language={language}/>
   <RecoverySummary task={task} language={language}/>
   <RecoveryPackageExport task={task} language={language}/>
   <footer className="trace-task-actions">{task.actions.includes('inspect')?<button disabled={busy} onClick={()=>void recover('inspect')}><RefreshCw size={15}/>{L('Check current state','核对当前状态')}</button>:null}{task.actions.includes('read_history')?<button disabled={busy} onClick={()=>void recover('read_history')}><History size={15}/>{L('Check history','核查历史')}</button>:null}{task.actions.includes('resume_session')?<button className="trace-primary" disabled={busy} onClick={()=>task.blocker?.retryPolicy.mode==='after_repair'?setConfirmResume(basis):void recover('resume_session')}><ArrowRight size={15}/>{L('Continue task','继续任务')}</button>:null}{task.actions.includes('cancel')?<button disabled={busy} onClick={()=>setConfirmStop(basis)}><Square size={13}/>{L('Stop task','停止任务')}</button>:null}{busy?<span role="status"><LoaderCircle size={15} className="trace-spin"/>{L('Checking…','处理中…')}</span>:null}</footer>
   {confirmResume&&confirmResume===basis?<div className="trace-confirm" role="group" aria-label={L('Confirm repair','确认修复')}><p>{L('Have you checked or repaired the reported problem? Continue once using the same account and session. This does not verify credentials or replay uncertain effects.','已核查或修复所报问题？将使用同一账号和会话继续一次；这不代表凭据验证成功，也不会重放效果未知的操作。')}</p><button disabled={busy} onClick={()=>void recover('resume_session',true,confirmResume)}>{L('Checked, continue once','已核查，继续一次')}</button><button onClick={()=>setConfirmResume('')}>{L('Cancel','取消')}</button></div>:null}
   {confirmStop&&confirmStop===basis?<div className="trace-confirm" role="group" aria-label={L('Confirm stop','确认停止')}><p>{L('Stop this task? Earlier actions will not be undone.','停止此任务？先前已发生的操作不会因此撤销。')}</p><button className="trace-primary" disabled={busy} onClick={()=>void recover('cancel',false,confirmStop)}>{L('Stop task','停止任务')}</button><button onClick={()=>setConfirmStop('')}>{L('Keep working','继续运行')}</button></div>:null}
   <details className="trace-records"><summary>{L('View records','查看记录')}</summary><div className="trace-records-body"><dl className="trace-facts"><div><dt>{L('Session reference','会话编号')}</dt><dd>{task.sessionRef??L('Not started','尚未启动')}</dd></div><div><dt>{L('Result','结果')}</dt><dd>{task.hasResult?L('Saved','已保留'):L('Not recorded','尚无记录')}</dd></div><div><dt>{L('Backend','执行后端')}</dt><dd>{task.backendId??L('Not recorded','尚无记录')}</dd></div></dl>
    <div className="trace-evidence" aria-label={L('Evidence checks','证据核查')}><div><GitCommitHorizontal size={16}/><span>{L('Commit','提交')}</span><strong>{task.evidence.commit==='recorded'?task.evidence.commitRef?.slice(0,12):L('Unverified','未验证')}</strong></div><div><FileCheck2 size={16}/><span>{L('Tests','测试')}</span><strong>{task.evidence.tests==='unverified'?L('Unverified','未验证'):task.evidence.tests==='passed'?L('Passed','通过'):L('Failed','失败')}</strong></div><div><CheckCircle2 size={16}/><span>{L('Deployment','部署')}</span><strong>{L('Unverified','未验证')}</strong></div></div>
    {timeline}
   </div></details>
  </article>:timeline}
 </section>
}
