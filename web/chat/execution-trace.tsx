import {useEffect,useRef,useState} from 'react'
import {Activity,ArrowRight,Check,CheckCircle2,Clock3,FileCheck2,GitCommitHorizontal,History,LoaderCircle,RefreshCw,ShieldQuestion,Square,Terminal,Wrench} from 'lucide-react'
import type {TraceEvent,TraceTask,TraceStage,TraceState} from '../../src/execution-trace.ts'
import {readTaskStatus,type StatusState} from './execution-status-view.ts'
import {useWorkspaceTransport} from './workspace-context.tsx'
import type {WorkspaceBinding} from './workspace-transport.ts'
import './execution-trace.css'

type Snapshot={visibility:string;at:number;revision:number;cursor:number;total:number;offset:number;more:boolean;tasks:TraceTask[]}
type Events={visibility:string;events:TraceEvent[];cursor:number;head:number;more:boolean;at:number}
type Action=TraceTask['actions'][number]
class TraceRequestError extends Error {constructor(readonly code:string){super(code)}}
async function request<T>(binding:WorkspaceBinding,path:string,isCurrent:()=>boolean,signal?:AbortSignal,body?:unknown):Promise<T>{
 try{return await binding.request<T>('/api/execution-trace'+path,body,false,undefined,body===undefined?signal:undefined)}catch(cause){
  if(!isCurrent())throw new TraceRequestError('trace_obsolete')
  const error=cause as {status?:number;payload?:{code?:unknown}}
  // The shared legacy transport owns current-session login handling. Never let an
  // old page add a second redirect after its context has already changed.
  if(error?.status===401)throw new TraceRequestError('login_required')
  const code=error?.payload?.code,allowed=['trace_changed','trace_settings_conflict','trace_task_missing','trace_reconcile_required','trace_recovery_uncertain','trace_action_unavailable','trace_cursor_ahead']
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
 const effectsHelp=status.effects==='unknown'?L('Check the outcome before trying again.','再次执行前，请先核查实际结果。'):status.effects==='recorded'?L('An operation result is recorded, but the actual outcome is not verified.','有操作结果记录，实际结果尚未核实。'):null
 const acceptanceHelp=status.acceptance==='unknown'?L('Acceptance has not been verified.','尚未核实验收情况。'):status.acceptance==='stale'?L('Recheck against the latest result.','请按最新结果重新验收。'):null
 const deliveryHelp=status.delivery==='unknown'?L('Sending has not been verified.','尚未核实发送情况。'):status.delivery==='recorded'?L('The system recorded it as sent; receipt is unconfirmed.','系统记录已发出，尚未确认对方收到。'):status.delivery==='uncertain'?L('Check whether it arrived before sending again.','再次发送前，请先核查对方是否收到。'):status.delivery==='partial'?L('Some sends are recorded; others still need attention.','部分已记录发出，其余仍待处理。'):status.delivery==='dropped'?L('Previously sent content is not recalled.','先前已发出的内容不会因此收回。'):null
 const tone=(state:string)=>['unknown','uncertain','stale','insufficient','waiting_input','held','retry_wait'].includes(state)?'attention':['failed','errored'].includes(state)?'failure':state==='passed'?'verified':'neutral'
 return <section className="trace-status" aria-label={L('Four independent task states','四项独立任务状态')}><dl className="trace-status-grid">
  <div data-facet="execution" data-state={status.execution} data-tone={tone(status.execution)}><dt><Terminal size={16} aria-hidden="true"/>{L('Execution','执行')}</dt><dd><strong>{word(executionLabels[status.execution])}</strong>{executionHelp?<p>{executionHelp}</p>:null}</dd></div>
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
export function ExecutionTrace({language='en'}:{language?:'en'|'zh-CN'}){
 const {binding,contextKey,readSignal}=useWorkspaceTransport()
 const L=(en:string,zh:string)=>language==='en'?en:zh,word=(names:[string,string])=>names[language==='en'?0:1]
 const [snapshot,setSnapshot]=useState<Snapshot|null>(null),[events,setEvents]=useState<TraceEvent[]>([]),[selected,setSelected]=useState(''),[more,setMore]=useState(false),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[error,setError]=useState(''),[actionError,setActionError]=useState(''),[notice,setNotice]=useState(''),[confirmStop,setConfirmStop]=useState(false),[truncated,setTruncated]=useState(false)
 const taskNumbers=useRef(new Map<string,number>())
 const taskName=(item:TraceTask)=>{if(!taskNumbers.current.has(item.id))taskNumbers.current.set(item.id,taskNumbers.current.size+1);return workerName(item.workerId,language)+L(' · Task ',' · 任务 ')+taskNumbers.current.get(item.id)}
 const cursor=useRef(0),visibility=useRef(''),generation=useRef(0),refreshRef=useRef<()=>Promise<void>>(async()=>{}),eventRef=useRef<()=>Promise<void>>(async()=>{})
 const page=useRef({binding,contextKey,selected}),pageRead=useRef<AbortSignal|null>(null)
 page.current={binding,contextKey,selected}
 const pageCurrent=()=>page.current.binding===binding&&page.current.contextKey===contextKey&&page.current.selected===selected&&!readSignal.aborted
 const task=snapshot?.tasks.find(t=>t.id===selected),active=snapshot?.tasks.filter(t=>['running','starting','background'].includes(t.state)).length??0,waiting=snapshot?.tasks.filter(t=>['waiting','blocked'].includes(t.state)).length??0,uncertain=snapshot?.tasks.filter(t=>t.unknownEffects).length??0
 useEffect(()=>{
  const controller=new AbortController(),signal=AbortSignal.any([controller.signal,readSignal]),current=++generation.current;let fetching=false,hasMore=false
  pageRead.current=signal
  const isCurrent=()=>generation.current===current&&pageCurrent()&&!signal.aborted
  cursor.current=0;visibility.current='';setEvents([]);setLoading(true);setMore(false);setTruncated(false);setNotice('');setActionError('');setConfirmStop(false);setBusy(false)
  const readEvents=async()=>{
   if(!isCurrent())return
   const query=new URLSearchParams({cursor:String(cursor.current),limit:'100',...(selected?{ticketId:selected}:{})})
   const data=await request<Events>(binding,'/events?'+query,isCurrent,signal)
   if(!isCurrent())return
   if(visibility.current&&visibility.current!==data.visibility){visibility.current=data.visibility;cursor.current=0;setEvents([]);hasMore=false;setMore(false);return}
   visibility.current=data.visibility;cursor.current=data.cursor;hasMore=data.more;setMore(data.more)
   setEvents(previous=>{const seen=new Set(previous.map(e=>e.id)),all=[...previous,...data.events.filter(e=>!seen.has(e.id))];if(all.length>600)setTruncated(true);return all.slice(-600)})
  }
  const refresh=async()=>{
   if(fetching||!isCurrent())return
   fetching=true
   try{
    const data=await request<Snapshot>(binding,'?limit=100',isCurrent,signal)
    if(!isCurrent())return
    if(visibility.current&&visibility.current!==data.visibility){cursor.current=0;setEvents([]);hasMore=false;setMore(false)}
    visibility.current=data.visibility;setSnapshot(data)
    if(!hasMore)await readEvents()
    if(isCurrent())setError('')
   }catch(cause){if(isCurrent()){const code=cause instanceof TraceRequestError?cause.code:'trace_refresh_failed';setError(code);if(code==='trace_task_missing'){setEvents([]);setSelected('')}if(code==='trace_cursor_ahead'){cursor.current=0;setEvents([]);hasMore=false;setMore(false)}}}
   finally{if(isCurrent()){setLoading(false);fetching=false}}
  }
  refreshRef.current=refresh
  eventRef.current=async()=>{if(fetching||!isCurrent())return;fetching=true;try{await readEvents();if(isCurrent())setError('')}catch{if(isCurrent())setError('trace_refresh_failed')}finally{if(isCurrent())fetching=false}}
  void refresh();const timer=setInterval(()=>void refresh(),3000)
  return()=>{controller.abort();clearInterval(timer);if(generation.current===current)generation.current++}
 },[selected,binding,contextKey,readSignal])
 const failure=(code:string)=>code==='trace_changed'||code==='trace_settings_conflict'?L('This task changed. Review its current state before trying again.','任务状态已变更，请核对最新状态后重试。'):code==='trace_reconcile_required'?L('Check the external outcome before repeating any work.','请先核查外部结果，再决定是否重复执行。'):code==='trace_recovery_uncertain'?L('The action could not be confirmed. Check the current task and original session.','操作结果尚未确认，请检查当前任务和原会话。'):code==='trace_action_unavailable'?L('This action is no longer available. Review the latest task state.','此操作已不可用，请查看最新任务状态。'):code==='trace_cursor_ahead'?L('The saved history changed. Refresh to reload the timeline.','历史记录已变更，请刷新以重新加载轨迹。'):L('Updates are unavailable. Your last known state is still shown.','暂时无法更新，当前显示最近一次已知状态。')
 async function recover(action:Action){
  const current=generation.current,signal=pageRead.current
  const isCurrent=()=>generation.current===current&&pageCurrent()&&!!signal&&!signal.aborted
  if(!task||busy||!isCurrent())return
  setBusy(true);setActionError('');setNotice('');setConfirmStop(false)
  try{
   const result=await request<{status:string}>(binding,'/recover',isCurrent,undefined,{ticketId:task.id,action,revision:task.revision,observed:task.observed,requestId:crypto.randomUUID()})
   if(!isCurrent())return
   const messages:Record<string,[string,string]>={inspected:['Current task state checked.','已核对当前任务状态。'],history_verified:['The original session is readable. External outcomes still need review.','原会话可读取，外部结果仍需核查。'],history_unavailable:['The original session could not be read. No work was repeated.','暂时无法读取原会话，未重复执行任务。'],resumed:['Resuming the original task and session.','正在恢复原任务及原会话。'],cancelled:['Task stopped. Existing external effects remain.','任务已停止，已发生的外部效果仍保留。']}
   setNotice(word(messages[result.status]??['Action completed.','操作已完成。']))
  }catch(cause){if(isCurrent())setActionError(cause instanceof TraceRequestError?cause.code:'trace_recovery_uncertain')}
  finally{if(isCurrent()){await refreshRef.current();if(isCurrent())setBusy(false)}}
 }
 const guidance=task?.next==='reconcile'?L('Check the actual outcome before trying again.','请先核查实际结果，再决定是否重试。'):task?.next==='answer_approval'?L('This task needs permission. Use its existing approval controls.','任务需要授权，请在原任务中处理。'):task?.next==='reconnect'?L('Review the connection and verify authentication before continuing.','请先检查连接配置并验证认证状态。'):task?.next==='review_context'?L('Access changed. Review it before continuing.','访问权限已变更，请核对后再继续。'):task?.next==='follow_up'?L('The Worker needs your reply in the original conversation.','Worker 等待你的回复，请回到原会话继续。'):null
 const timeline=<>
  <div className="trace-timeline-heading"><h2>{L('Activity','动态记录')}</h2></div>
  {loading&&!events.length?<div className="trace-empty" role="status"><LoaderCircle size={23} className="trace-spin"/><p>{L('Loading activity…','正在加载动态…')}</p></div>:events.length?<ol className="trace-timeline">{events.map(event=><li key={event.id} data-state={event.state}><div className="trace-event-icon"><StageIcon stage={event.stage}/></div><div className="trace-event-main"><div><strong>{word(stageNames[event.stage])}</strong><span className="trace-state" data-state={event.state}>{word(stateNames[event.state])}</span></div><p>{event.ticketId?(()=>{const item=snapshot?.tasks.find(t=>t.id===event.ticketId);return item?taskName(item):L('Earlier task','较早任务')})():L('Team activity','团队动态')}{event.baseline?' · '+L('First recorded state','首次记录的状态'):''}{event.hasResult?' · '+L('Result saved','结果已保留'):''}{event.stage==='delivery'&&event.state==='sent'?' · '+L('Receipt is unconfirmed','尚未确认对方收到'):''}</p></div><time dateTime={event.at} title={new Date(event.at).toLocaleString(language)}>{new Date(event.at).toLocaleTimeString(language,{hour:'2-digit',minute:'2-digit'})}</time></li>)}</ol>:<div className="trace-empty"><Activity size={32} strokeWidth={1.3}/><h2>{L('Your team’s progress appears here','团队进展会显示在这里')}</h2><p>{L('Choose a task to see its progress and next steps.','选择任务，查看进展和下一步。')}</p><a href="/chat">{L('Return to the conversation','返回会话')}<ArrowRight size={15}/></a></div>}
  {more?<button className="trace-load-more" disabled={busy||loading} onClick={()=>void eventRef.current()}>{L('Load more','加载更多')}</button>:null}
  {truncated?<p className="trace-muted">{L('Showing the latest 600 loaded activities. Reload to read earlier records.','显示最近加载的 600 条动态，重新加载可查看较早记录。')}</p>:null}
 </>
 return <section className="trace-page" aria-labelledby="trace-title">
  <header className="trace-heading"><div><h1 id="trace-title">{L('Task progress','任务进展')}</h1></div><button type="button" disabled={loading||busy} onClick={()=>{setActionError('');void refreshRef.current()}}><RefreshCw size={16} className={loading?'trace-spin':''}/>{L('Refresh','刷新')}</button></header>
  <div className="trace-summary" aria-label={L('Shown task counts','当前所示任务统计')}><div><Activity size={17}/><strong>{active}</strong><span>{L('Working','正在执行')}</span></div><div><ShieldQuestion size={17}/><strong>{waiting}</strong><span>{L('Needs input','等待处理')}</span></div><div data-attention={uncertain>0}><History size={17}/><strong>{uncertain}</strong><span>{L('Needs checking','待核查结果')}</span></div></div>
  {actionError||error?<p className="trace-notice trace-error" role="alert">{failure(actionError||error)}<button onClick={()=>{setActionError('');void refreshRef.current()}}>{L('Try refresh','重试刷新')}</button></p>:null}
  {notice?<p className="trace-notice" role="status"><Check size={16}/>{notice}</p>:null}
  <div className="trace-toolbar"><label htmlFor="trace-task">{L('Task','任务')}</label><select id="trace-task" aria-label={L('Show','显示')} value={selected} onChange={e=>setSelected(e.target.value)}><option value="">{L('All tasks','全部任务')}</option>{snapshot?.tasks.map(t=><option value={t.id} key={t.id}>{taskName(t)}</option>)}</select></div>
  {snapshot?.more?<p className="trace-muted">{L('Showing the 100 latest tasks.','显示最近更新的 100 项任务。')}</p>:null}
  {task?<article className="trace-task-detail"><header><h2>{taskName(task)}</h2></header><TaskStatus value={task.status} language={language}/>
   {guidance?<p className="trace-guidance">{guidance}{task.next==='reconnect'?<a href="/configure#connectors">{L('Open connections','打开连接设置')}<ArrowRight size={14}/></a>:null}</p>:null}
   {task.next!=='reconnect'&&['auth_required','configuration_invalid'].includes(task.problem)?<p className="trace-guidance">{L('Also check the account and connection.','还需核对账号与连接。')}<a href="/configure#connectors">{L('Open connections','打开连接设置')}<ArrowRight size={14}/></a></p>:null}
   <footer className="trace-task-actions">{task.actions.includes('inspect')?<button disabled={busy} onClick={()=>void recover('inspect')}><RefreshCw size={15}/>{L('Check current state','核对当前状态')}</button>:null}{task.actions.includes('read_history')?<button disabled={busy} onClick={()=>void recover('read_history')}><History size={15}/>{L('Check history','核查历史')}</button>:null}{task.actions.includes('resume_session')?<button className="trace-primary" disabled={busy} onClick={()=>void recover('resume_session')}><ArrowRight size={15}/>{L('Continue task','继续任务')}</button>:null}{task.actions.includes('cancel')?<button disabled={busy} onClick={()=>setConfirmStop(true)}><Square size={13}/>{L('Stop task','停止任务')}</button>:null}{busy?<span role="status"><LoaderCircle size={15} className="trace-spin"/>{L('Checking…','处理中…')}</span>:null}</footer>
   {confirmStop?<div className="trace-confirm" role="group" aria-label={L('Confirm stop','确认停止')}><p>{L('Stop this task? Earlier actions will not be undone.','停止此任务？先前已发生的操作不会因此撤销。')}</p><button className="trace-primary" disabled={busy} onClick={()=>void recover('cancel')}>{L('Stop task','停止任务')}</button><button onClick={()=>setConfirmStop(false)}>{L('Keep working','继续运行')}</button></div>:null}
   <details className="trace-records"><summary>{L('View records','查看记录')}</summary><div className="trace-records-body"><dl className="trace-facts"><div><dt>{L('Session reference','会话编号')}</dt><dd>{task.sessionRef??L('Not started','尚未启动')}</dd></div><div><dt>{L('Result','结果')}</dt><dd>{task.hasResult?L('Saved','已保留'):L('Not recorded','尚无记录')}</dd></div><div><dt>{L('Backend','执行后端')}</dt><dd>{task.backendId??L('Not recorded','尚无记录')}</dd></div></dl>
    <div className="trace-evidence" aria-label={L('Evidence checks','证据核查')}><div><GitCommitHorizontal size={16}/><span>{L('Commit','提交')}</span><strong>{task.evidence.commit==='recorded'?task.evidence.commitRef?.slice(0,12):L('Unverified','未验证')}</strong></div><div><FileCheck2 size={16}/><span>{L('Tests','测试')}</span><strong>{task.evidence.tests==='unverified'?L('Unverified','未验证'):task.evidence.tests==='passed'?L('Passed','通过'):L('Failed','失败')}</strong></div><div><CheckCircle2 size={16}/><span>{L('Deployment','部署')}</span><strong>{L('Unverified','未验证')}</strong></div></div>
    {timeline}
   </div></details>
  </article>:timeline}
 </section>
}
