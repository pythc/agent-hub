import {useEffect, useRef, useState, type ReactNode} from 'react';
import {ArrowLeft, ChevronRight, Copy, Plus, RefreshCw, Search, Zap} from 'lucide-react';
import type {WebhookGrant, Webhooks} from '../../src/webhooks.ts';
import {automationCommand, automationState, defaultAutomationTask, type AutomationDraft, type SavedAutomationSkill} from './automations-model.ts';
import './automations.css';

type L = (en:string,zh:string)=>string;
type Grant = WebhookGrant & {rehearsalRequired?:boolean;rehearsal?:{required:boolean;current:boolean;code:string};keys?:{inbound:string;outbound:string;revision:number}};
type Snapshot = Omit<ReturnType<Webhooks['snapshot']>,'grants'> & {grants:Grant[]};
type Detail = ReturnType<Webhooks['detail']>;
type Catalog = {contexts:{id:string;title:string;label:string;scopeId:string;entryId:string}[];workers:{id:string;label:string}[]};
type Scopes = {scopes:{id:string;workerIds:string[]}[]};
type Run = (action:()=>Promise<void>)=>Promise<void>;

async function request<T>(path:string, body?:unknown):Promise<T> {
  const response=await fetch(path,body===undefined?{}:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  const value=await response.json();
  if(!response.ok)throw Error(response.status===401?'login_required':value.code??value.error??'request_failed');
  return value;
}
function errorMessage(error:unknown,L:L) {
  if(error instanceof SyntaxError)return L('Check the JSON in advanced settings.','请检查高级设置中的 JSON 格式。');
  const code=error instanceof Error?error.message:String(error);
  const messages:Record<string,[string,string]>={
    login_required:['Your session expired. Sign in again.','登录已过期，请重新登录。'],
    webhook_listener_not_configured:['Enable the webhook receiver in the startup configuration and restart Roppo.','请在启动配置中启用事件接收，然后重启 Roppo。'],
    real_human_authorization_required:['The authorization quote must match the selected message.','授权原文必须来自所选消息。'],
    scope_manager_authorization_required:['Choose a message from the Router’s owner.','请选择 Router 管理者发出的授权消息。'],
    automation_requires_group_entry:['Choose an authorized group conversation.','请选择已授权的群聊入口。'],
    template_worker_outside_scope:['Choose a Worker belonging to this conversation.','请选择所选会话所属的 Worker。'],
    template_worker_unavailable:['This Worker is unavailable. Choose another Worker.','该 Worker 不可用，请重新选择。'],
    credential_unavailable:['The signing key is missing or invalid on this host.','本机签名密钥未配置或格式不正确。'],
    callback_target_forbidden:['Use a permitted HTTPS callback URL.','请使用允许的 HTTPS 回传地址。'],
    invalid_secret:['Check the signing key on this host.','请检查本机签名密钥配置。'],
    separate_direction_credentials_required:['Use different keys for incoming events and callbacks.','事件和回调需使用不同的签名密钥。'],
    validation_error:['Check the fields and task rules.','请检查字段内容和任务规则。'],
    automation_permissions_changed:['Permissions changed. Create a new automation with current authorization.','权限已变更，请使用当前授权重新创建自动化。'],
    webhook_rehearsal_required:['Rehearse a valid sample with the current rules, refresh, then explicitly start receiving.','请按当前规则成功预演示例并刷新，再显式开始接收。'],
    grant_expired:['This automation expired. Create a new one.','该自动化已到期，请重新创建。'],
    webhook_protocol_upgrade_required:['Upgrade the webhook protocol in host settings before creating this automation.','请先完成宿主的 Webhook 协议升级。'],
  };
  return messages[code]?L(...messages[code]):L('Couldn’t complete the action. Try again.','操作未完成，请重试。');
}
function stateLabel(state:string,L:L) {
  const labels:Record<string,[string,string]>={active:['Receiving','接收中'],stopped:['Stopped','已停止'],revoked:['Revoked','已撤销'],expired:['Expired','已到期'],received:['Queued','待处理'],dispatched:['Started','已启动'],held:['Needs attention','需处理'],consumed:['Resumed','已续接'],ignored:['Closed','已关闭'],waiting:['Waiting for event','等待事件'],delivered:['Resumed','已唤醒'],stale:['Out of date','已失效'],cancelled:['Cancelled','已取消'],pending:['Pending','待发送'],sending:['Sending','发送中'],sent:['Delivered','已送达'],dead:['Retry stopped','重试已停止'],paused:['Paused','已暂停'],completed:['Accepted','验收通过'],needs_input:['Needs input','等待补充']};
  return labels[state]?L(...labels[state]):state;
}
const formatDate=(at:number,language:string)=>new Date(at).toLocaleString(language,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
function CompletionCheck({poll,language,L}:{poll?:Snapshot['completionPoll'];language:string;L:L}) {
  const time=(at?:number|null)=>at==null?L('Unknown','未知'):formatDate(at,language);
  const coverage=poll?.coverage==='complete'?L('Current sweep complete','本轮已核对所有已留存记录'):poll?.coverage==='partial'?L('Still checking','本轮仅核对了部分记录'):L('Unknown','未知');
  return <div className="automation-record"><h2>{L('Local completion check','本地完成状态核对')}</h2><dl className="automation-properties">
    <dt>{L('Last attempt','最近尝试')}</dt><dd>{time(poll?.lastAttempt)}</dd>
    <dt>{L('Last full success','最近完整通过')}</dt><dd>{time(poll?.lastSuccess)}</dd>
    <dt>{L('Coverage','覆盖情况')}</dt><dd>{coverage}</dd>
    <dt>{L('Next eligible','下次可核对')}</dt><dd>{time(poll?.nextEligible)}</dd>
  </dl></div>
}
function JsonDetails({title,value}:{title:string;value:unknown}) {return <details><summary>{title}</summary><pre>{JSON.stringify(value,null,2)}</pre></details>}
function Field({label,children}:{label:string;children:ReactNode}) {return <label className="automation-field"><span>{label}</span>{children}</label>}
function ReceiverSetup({L}:{L:L}) {return <details className="automation-receiver-setup"><summary>{L('Enable event receiver','启用方式')}</summary><p>{L('Add a receiver port to the startup configuration, restart Roppo, then refresh.','在启动配置中添加接收端口，重启 Roppo 后刷新。')}</p><pre>{JSON.stringify({webhooks:{port:4338}},null,2)}</pre></details>}

export function AutomationWorkspace({language}:{language:'en'|'zh-CN'}) {
  const L:L=(en,zh)=>language==='en'?en:zh;
  const [snapshot,setSnapshot]=useState<Snapshot>(),[selected,setSelected]=useState<string>(),[detail,setDetail]=useState<Detail>();
  const [selectedTab,setSelectedTab]=useState<'tasks'|'events'>('tasks');
  const [creating,setCreating]=useState(new URLSearchParams(location.search).has('skill'));
  const [query,setQuery]=useState(''),[filter,setFilter]=useState('all'),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [snapshotFailed,setSnapshotFailed]=useState(false),[detailFailed,setDetailFailed]=useState(false);
  const alive=useRef(false),working=useRef(false),pendingControls=useRef(new Map<string,string>());
  const generation=useRef(0),detailVersion=useRef(0),heading=useRef<HTMLHeadingElement>(null);
  const load=async()=>{const v=++generation.current;try{const data=await request<Snapshot>('/webhooks');if(alive.current&&v===generation.current){setSnapshot(data);setSnapshotFailed(false)}}catch(e){if(alive.current&&v===generation.current)setSnapshotFailed(true);throw e}};
  const readDetail=async(id:string)=>{const v=++detailVersion.current;try{const data=await request<Detail>('/webhooks/detail?id='+encodeURIComponent(id));if(alive.current&&v===detailVersion.current){setDetail(data);setDetailFailed(false)}}catch(e){if(alive.current&&v===detailVersion.current)setDetailFailed(true);throw e}};
  const run:Run=async action=>{if(working.current||!alive.current)return;working.current=true;setBusy(true);setError('');setNotice('');try{await action()}catch(e){if(alive.current)setError(errorMessage(e,L))}finally{working.current=false;if(alive.current)setBusy(false)}};
  useEffect(()=>{alive.current=true;void load().catch(e=>{if(alive.current)setError(errorMessage(e,L))});return()=>{alive.current=false;generation.current++;detailVersion.current++}},[]);
  useEffect(()=>{setDetail(undefined);setDetailFailed(false);if(selected)void readDetail(selected).catch(e=>{if(alive.current)setError(errorMessage(e,L))});return()=>{detailVersion.current++}},[selected]);
  useEffect(()=>{heading.current?.focus()},[selected,creating]);
  const refresh=async()=>{await load();if(selected)await readDetail(selected)};
  const openGrant=(id:string,tab:'tasks'|'events'='tasks')=>{setSelectedTab(tab);setSelected(id);setNotice('');setError('')};
  const reset=()=>{setSelected(undefined);setCreating(false);setError('');setNotice('');history.replaceState(null,'','/configure#automations')};
  const grant=snapshot?.grants.find(g=>g.id===selected);
  const results=snapshot?.grants.filter(g=>(filter==='all'||automationState(g)===filter)&&[g.template.title,g.namespace,g.id].some(v=>v.toLowerCase().includes(query.toLowerCase())));
  const control=async(g:Grant,action:string,extra={})=>{const body={id:g.id,action,...extra},key=JSON.stringify(body),operationId=pendingControls.current.get(key)??crypto.randomUUID();pendingControls.current.set(key,operationId);await request('/webhooks/control',{...body,operationId});pendingControls.current.delete(key);if(!alive.current)return;await refresh();if(alive.current)setNotice(L('Saved.','已保存。'))};
  return <section className="automation-page" aria-label={L('Event automations','事件自动化')}>
    <div className="automation-content">
      <header className="automation-heading">
        <div>{selected||creating?<button className="automation-back" onClick={reset}><ArrowLeft size={15}/>{L('Automations','自动化列表')}</button>:null}<h1 ref={heading} tabIndex={-1}>{creating?L('New automation','新建自动化'):grant?.template.title??L('Event automations','事件自动化')}</h1></div>
        {!creating?<div className="automation-actions"><button className="automation-icon" aria-label={L('Refresh','刷新')} title={L('Refresh','刷新')} disabled={busy} onClick={()=>void run(refresh)}><RefreshCw size={17}/></button>{!selected&&snapshot?.configured&&snapshot.grants.length?<button className="automation-primary" onClick={()=>{setCreating(true);setNotice('');setError('')}}><Plus size={16}/>{L('New automation','新建自动化')}</button>:null}</div>:null}
      </header>
      {error?<p className="automation-message" role="alert">{error} <button onClick={()=>void run(refresh)}>{L('Refresh','刷新')}</button></p>:null}
      {notice?<p className="automation-message" role="status">{notice}</p>:null}
      {!snapshot&&!error?<div className="automation-loading" role="status" aria-label={L('Loading automations','正在加载自动化')}><span/><span/><span/></div>:null}
      {creating&&snapshot&&!snapshot.configured?<div className="automation-empty"><h2>{L('Event receiver is not enabled','事件接收未启用')}</h2><ReceiverSetup L={L}/></div>:creating?<AutomationEditor language={language} cancel={reset} saved={grant=>{setSnapshot(s=>({...s!,grants:[...s!.grants.filter(g=>g.id!==grant.id),grant]}));setCreating(false);openGrant(grant.id);setNotice(grant.receiving?L('Automation created. Check its current receiving state.','自动化已创建，请核对当前接收状态。'):L('Created with receiving paused. Rehearse an event, then explicitly start receiving.','已创建并暂停接收。请先预演事件，再显式开始接收。'));history.replaceState(null,'','/configure#automations')}}/>:selected?grant&&detail?.grant.id===grant.id?<AutomationDetail key={grant.id} initialTab={selectedTab} grant={grant} detail={detail} hideRecoveredCompletions={snapshotFailed||detailFailed} snapshot={snapshot!} language={language} run={run} busy={busy} control={control} refresh={refresh} notice={setNotice}/>:<div className="automation-loading" role="status" aria-label={L('Loading details','正在加载详情')}><span/><span/></div>:snapshot?.grants.length===0?<div className="automation-empty"><Zap size={28}/><h2>{snapshot.configured?L('No automations yet','暂无自动化'):L('Event receiver is not enabled','事件接收未启用')}</h2>{snapshot.configured?<button className="automation-primary" onClick={()=>{setCreating(true);setNotice('');setError('')}}><Plus size={16}/>{L('New automation','新建自动化')}</button>:<ReceiverSetup L={L}/>}</div>:snapshot?<>
        {!snapshotFailed&&snapshot.recentCompletionNotices?.length?<section aria-label={L('Recent recovered completions','近期补记完成状态')}>
          <h2>{L('Recent recovered completions','近期补记完成状态')}</h2>
          {snapshot.recentCompletionNotices.map(n=>{
            const g=snapshot.grants.find(g=>g.id===n.grantId);
            if(!g)return null;
            return <article className="automation-record" key={n.completionEventId}>
              <div className="automation-record-title"><strong>{g.template.title}</strong><span>{n.confirmed?L('Callback confirmed','回传已确认'):L('Callback unconfirmed','回传尚未确认')}</span><time>{formatDate(n.observedAt,language)}</time></div>
              <div className="automation-actions"><button onClick={()=>openGrant(g.id,'events')}>{L('View event history','查看事件记录')}</button></div>
            </article>;
          })}
        </section>:null}
        <div className="automation-toolbar"><label className="automation-search"><Search size={17}/><input type="search" aria-label={L('Search automations','搜索自动化')} placeholder={L('Search automations','搜索自动化')} value={query} onChange={e=>setQuery(e.target.value)}/></label><select aria-label={L('Status','状态')} value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">{L('All statuses','全部状态')}</option>{['active','stopped','expired','revoked'].map(s=><option key={s} value={s}>{stateLabel(s,L)}</option>)}</select></div>
        <div className="automation-list" aria-label={L('Automations','自动化列表')}>{results?.map(g=>{const recent=snapshot.receipts.find(r=>r.grantId===g.id);return <button className="automation-row" key={g.id} onClick={()=>openGrant(g.id)}><span className="automation-row-name"><strong>{g.template.title}</strong><span>{g.eventTypes.join(', ')}</span></span><span className="automation-state" data-state={automationState(g)}>{stateLabel(automationState(g),L)}</span><time>{recent?formatDate(recent.at,language):L('No events','暂无事件')}</time><ChevronRight size={16}/></button>})}{results?.length===0?<p className="automation-no-results">{L('No matching automations','没有匹配的自动化')}</p>:null}</div>
      </>:null}
      {!creating&&!selected&&snapshot&&snapshot.grants.length>0?<CompletionCheck poll={snapshotFailed?undefined:snapshot.completionPoll} language={language} L={L}/>:null}
      {!creating&&!selected&&snapshot&&snapshot.grants.length>0?<details className="automation-maintenance"><summary>{L('Maintenance','维护')}</summary><button disabled={busy} onClick={()=>void run(async()=>{await request('/webhooks/reconcile',{});await refresh();setNotice(L('Local records refreshed. See coverage above.','已刷新本地记录，请查看上方覆盖情况。'))})}>{L('Reconcile delivery records','核对投递记录')}</button><JsonDetails title={L('Protocol details','协议详情')} value={{protocol:snapshot.protocol,reconciliation:snapshot.reconciliation}}/></details>:null}
    </div>
  </section>;
}

function AutomationDetail({grant:g,detail,initialTab,hideRecoveredCompletions,snapshot,language,run,busy,control,refresh,notice}:{grant:Grant;detail:Detail;initialTab:'tasks'|'events';hideRecoveredCompletions:boolean;snapshot:Snapshot;language:string;run:Run;busy:boolean;control:(g:Grant,action:string,extra?:Record<string,unknown>)=>Promise<void>;refresh:()=>Promise<void>;notice:(text:string)=>void}) {
  const L:L=(en,zh)=>language==='en'?en:zh,[tab,setTab]=useState<'tasks'|'events'|'connection'>(initialTab),[confirmation,setConfirmation]=useState<{title:string;action:()=>Promise<void>}|null>(null);
  const alive=useRef(false);useEffect(()=>{alive.current=true;return()=>{alive.current=false}},[g.id]);
  const [rehearsalInvalidated,setRehearsalInvalidated]=useState(false);
  const rehearsing=useRef(false),invalidatedSnapshot=useRef<Snapshot|null>(null);
  useEffect(()=>{if(invalidatedSnapshot.current&&invalidatedSnapshot.current!==snapshot){invalidatedSnapshot.current=null;setRehearsalInvalidated(false)}},[snapshot]);
  const strict=g.rehearsalRequired===true||g.rehearsal?.required===true;
  const rehearsalCurrent=!rehearsalInvalidated&&g.rehearsal?.required===true&&g.rehearsal.current===true&&g.rehearsal.code==='rehearsal_current';
  const startBlocked=strict&&!rehearsalCurrent;
  const state=automationState(g),live=state==='active'||state==='stopped';
  const [preview,setPreview]=useState(()=>JSON.stringify({specversion:'1.0',id:'preview-1',source:g.eventSource,type:g.eventTypes[0],data:Object.fromEntries(Object.entries(g.parameters).map(([k,p])=>[k,p.type==='string'?p.values?.[0]??'example':p.type==='number'?p.min:false]))},null,2));
  const [rotation,setRotation]=useState({inbound:g.keys?.inbound??g.secretEnvs[0]??'',outbound:g.keys?.outbound??g.callback.secretEnv,overlapSeconds:'3600'});
  const deliveries=snapshot.deliveries.filter(d=>d.grant_id===g.id),waits=snapshot.waits.filter(w=>w.grantId===g.id);
  const ask=(title:string,action:()=>Promise<void>)=>setConfirmation({title,action});
  return <div className="automation-detail">
    <div className="automation-detail-top"><span className="automation-state" data-state={state}>{stateLabel(state,L)}</span><span>{L('Expires ','到期 ')+formatDate(g.expiresAt,language)}</span><div className="automation-actions"><button disabled={busy||!live||(!g.receiving&&startBlocked)} onClick={()=>{if(!g.receiving&&startBlocked)return;void run(()=>control(g,g.receiving?'stop_receiving':'start_receiving'))}}>{g.receiving?L('Stop receiving','停止接收'):L('Start receiving','开始接收')}</button></div></div>
    <p className="automation-message">{L('Pausing reception only blocks new events. It does not stop existing queued events or tasks.','暂停接收仅阻止新事件，不会停止已有队列中的事件或任务。')}</p>
    {!g.receiving&&live?<p className="automation-message">{L('Before starting reception, open Connection and rehearse a sample event. Starting reception is a separate explicit action.','开始接收前，请打开接入设置预演示例事件。开始接收是单独的显式操作。')}</p>:null}
    {strict?<p className="automation-message" role="status">{rehearsalCurrent?L('Current local rehearsal: ready for explicit reception start.','当前本地预演有效，可显式开始接收。'):rehearsalInvalidated||g.rehearsal?.code==='rehearsal_stale'?L('Rehearsal evidence is stale or unconfirmed. Rehearse again and refresh before starting.','预演证据已失效或尚未确认，请重新预演并刷新后开始接收。'):L('Local rehearsal required before starting reception.','开始接收前需要完成本地预演。')}</p>:null}
    <p className="automation-objective">{g.template.objective}</p>
    <nav className="automation-tabs" aria-label={L('Automation details','自动化详情')}>{(['tasks','events','connection'] as const).map((key,i)=><button key={key} aria-current={tab===key?'page':undefined} onClick={()=>setTab(key)}>{[L('Tasks','任务'),L('Events','事件记录'),L('Connection','接入设置')][i]}</button>)}</nav>
    {confirmation?<div className="automation-confirm" role="alert"><p>{confirmation.title}</p><div className="automation-actions"><button onClick={()=>setConfirmation(null)} disabled={busy}>{L('Cancel','取消')}</button><button className="automation-primary" disabled={busy} onClick={()=>void run(async()=>{await confirmation.action();setConfirmation(null)})}>{L('Confirm','确认')}</button></div></div>:null}
    {tab==='tasks'?<section aria-label={L('Tasks','任务')}>
      {detail.goals.filter(Boolean).map(goal=>{if(!goal)return null;const paused=['paused','held','needs_input'].includes(goal.state);return <article className="automation-record" key={goal.id}><div className="automation-record-title"><strong>{goal.title}</strong><span>{goal.state==='active'?L('Working','进行中'):stateLabel(goal.state,L)}</span></div>{!['completed','cancelled'].includes(goal.state)?<div className="automation-actions"><button disabled={busy} onClick={()=>void run(async()=>{await request('/webhooks/goal',{id:goal.id,action:paused?'resume':'pause',operationId:crypto.randomUUID(),expectedRevision:goal.revision});await refresh()})}>{paused?L('Resume task','继续推进'):L('Pause task','暂停任务')}</button><button disabled={busy} onClick={()=>ask(L('Cancel this task and its running work?','取消此任务及其正在执行的工作？'),async()=>{await request('/webhooks/goal',{id:goal.id,action:'cancel',operationId:crypto.randomUUID(),expectedRevision:goal.revision});await refresh()})}>{L('Cancel task','取消任务')}</button></div>:null}<JsonDetails title={L('Task details','任务详情')} value={{nodes:goal.nodes,reason:goal.reason,finalRoundId:goal.finalRoundId}}/></article>})}
      {!detail.goals.length?<p className="automation-no-results">{L('No tasks yet','暂无任务')}</p>:null}
      {waits.length?<details><summary>{L('Waiting events','等待中的事件')}</summary>{waits.map(w=><JsonDetails key={w.id} title={w.ruleId+' · '+stateLabel(w.state,L)} value={w}/>)}</details>:null}
    </section>:null}
    {tab==='events'?<section aria-label={L('Event history','事件记录')}>
      {detail.receipts.slice().reverse().map(r=><article className="automation-record" key={r.id}><div className="automation-record-title"><strong>{r.event.type}</strong><span>{stateLabel(r.state,L)}</span><time>{formatDate(r.at,language)}</time></div>{r.error?<p>{r.error}</p>:null}{r.state==='held'&&r.error==='dispatch_failed'&&!r.goalId?<button disabled={busy} onClick={()=>void run(async()=>{await request('/webhooks/replay',{receiptId:r.id,operationId:crypto.randomUUID()});await refresh();notice(L('Event queued again.','事件已重新排队。'))})}>{L('Retry event','重试事件')}</button>:null}<JsonDetails title={L('Event data','事件内容')} value={r.event}/></article>)}
      {!detail.receipts.length?<p className="automation-no-results">{L('No events yet','暂无事件')}</p>:null}
      {deliveries.length?<><h2>{L('Result deliveries','结果回传')}</h2>{deliveries.map(d=><article className="automation-record" key={String(d.id)}><div className="automation-record-title"><strong>{stateLabel(String(d.state),L)}</strong><span>{String(d.attempts)} {L('attempts','次尝试')}</span></div>{d.error?<p>{String(d.error)}</p>:null}{['dead','held'].includes(String(d.state))?<button disabled={busy||!live} onClick={()=>void run(()=>control(g,'retry_delivery',{deliveryId:d.id}))}>{L('Retry delivery','重试回传')}</button>:null}<JsonDetails title={L('Delivery details','投递详情')} value={snapshot.attempts.filter(a=>a.delivery_id===d.id)}/></article>)}</>:null}
      {!hideRecoveredCompletions&&live&&detail.completionNotices?.items.length?<div aria-label={L('Recovered completions','补记完成状态')}><h2>{L('Recovered completions','补记完成状态')}</h2>{detail.completionNotices.items.map(n=><article className="automation-record" key={n.completionEventId}><div className="automation-record-title"><strong>{L('Completion found in local records','已从本地记录补记完成')}</strong><span>{n.confirmed?L('Callback confirmed','回传已确认'):L('Callback unconfirmed','回传尚未确认')}</span><time>{formatDate(n.observedAt,language)}</time></div><code>{n.completionEventId}</code></article>)}</div>:null}
      {!hideRecoveredCompletions&&live&&detail.completionNotices?.partial?<p className="automation-message">{L('Showing only recent recovered completions.','仅显示最近补记的完成记录。')}</p>:null}
      <JsonDetails title={L('Technical history','技术记录')} value={detail.events}/>
    </section>:null}
    {tab==='connection'?<section aria-label={L('Connection settings','接入设置')}>
      <dl className="automation-properties"><dt>{L('Endpoint path','接收路径')}</dt><dd><code>{'/webhooks/'+g.id}</code><button className="automation-icon" aria-label={L('Copy endpoint path','复制接收路径')} onClick={()=>void run(async()=>{await navigator.clipboard.writeText('/webhooks/'+g.id);notice(L('Endpoint path copied.','接收路径已复制。'))})}><Copy size={15}/></button></dd><dt>{L('Event source','事件来源')}</dt><dd>{g.eventSource}</dd><dt>{L('Event types','事件类型')}</dt><dd>{g.eventTypes.join(', ')}</dd><dt>{L('Callback URL','结果回传地址')}</dt><dd>{g.callback.url}</dd></dl>
      <div className="automation-actions"><button disabled={busy||!live} onClick={()=>void run(()=>control(g,g.deliveryPaused?'resume_delivery':'pause_delivery'))}>{g.deliveryPaused?L('Resume callbacks','恢复回传'):L('Pause callbacks','暂停回传')}</button></div>
      <details><summary>{L('Test event','预演事件')}</summary><p>{L('This rehearsal checks saved rules and may record local evidence only; it does not save the sample or execute tasks. It does not test real signatures, normalizer execution or platform delivery, and does not enable reception.','预演仅检查已保存规则并可能写入本地证据，不保存样本或执行任务；不验证真实签名、事件转换器执行或平台投递，也不会启用接收。')}</p><form onSubmit={e=>{e.preventDefault();if(rehearsing.current||busy||!live||!alive.current)return;rehearsing.current=true;void run(async()=>{try{invalidatedSnapshot.current=snapshot;setRehearsalInvalidated(true);let result:{valid?:boolean;effects?:string;localEvidence?:string};try{result=await request('/webhooks/dry-run',{id:g.id,event:JSON.parse(preview)})}finally{if(alive.current)await refresh()}if(alive.current){if(result.valid!==true||result.effects!=='none'||!['recorded','unchanged'].includes(result.localEvidence??''))throw Error('request_failed');notice(L('Event matches the saved rules. Only local rehearsal evidence may be recorded; the sample is not saved. No task was started; signatures, normalizers and the real platform were not tested.','事件符合已保存规则，仅可能写入本地预演证据，不保存样本。未启动任务；未验证签名、事件转换器或真实平台。'))}}finally{rehearsing.current=false}})}}><Field label={L('Event JSON','事件 JSON')}><textarea rows={8} className="automation-code" value={preview} onChange={e=>setPreview(e.target.value)}/></Field><button disabled={busy||!live}>{L('Test event','验证事件')}</button></form></details>
      <details><summary>{L('Advanced settings','高级设置')}</summary>
        <JsonDetails title={L('Task rules','任务规则')} value={{template:g.template,parameters:g.parameters,continuations:g.continuations,transport:g.transport,scopeId:g.scopeId,entryId:g.entryId,maxEvents:g.maxEvents,maxConcurrent:g.maxConcurrent}}/>
        <details><summary>{L('Rotate signing keys','轮换签名密钥')}</summary><form onSubmit={e=>{e.preventDefault();void run(async()=>{await request('/webhooks/rotate',{id:g.id,operationId:crypto.randomUUID(),expectedRevision:g.keys?.revision??0,...rotation,overlapSeconds:Number(rotation.overlapSeconds)});await refresh();notice(L('Signing keys updated.','签名密钥已更新。'))})}}>{(['inbound','outbound','overlapSeconds'] as const).map((key,i)=><Field key={key} label={[L('New inbound key variable','新输入密钥变量'),L('New callback key variable','新回调密钥变量'),L('Old key overlap (seconds)','旧密钥重叠秒数')][i]!}><input required type={key==='overlapSeconds'?'number':'text'} min={0} max={86400} value={rotation[key]} onChange={e=>setRotation({...rotation,[key]:e.target.value})}/></Field>)}<button disabled={busy||!live}>{L('Update keys','更新密钥')}</button></form></details>
        <button className="automation-danger" disabled={busy||!g.active} onClick={()=>ask(L('Revoke this automation? Its tasks and callbacks will stop. This cannot be undone.','撤销后将停止相关任务和回传，无法恢复。确认撤销？'),()=>control(g,'revoke'))}>{L('Revoke automation','撤销自动化')}</button>
      </details>
    </section>:null}
  </div>;
}

function AutomationEditor({language,cancel,saved}:{language:string;cancel:()=>void;saved:(grant:Grant)=>void}) {
  const L:L=(en,zh)=>language==='en'?en:zh;
  const [catalog,setCatalog]=useState<Catalog>(),[scopes,setScopes]=useState<Scopes>(),[skill,setSkill]=useState<SavedAutomationSkill>();
  const [step,setStep]=useState(0),[error,setError]=useState(''),[busy,setBusy]=useState(false),[pendingCreation,setPendingCreation]=useState(false);
  const alive=useRef(false),working=useRef(false);
  const [draft,setDraft]=useState<AutomationDraft>({triggerId:'',authorizationQuote:'',title:'',objective:'',workerId:'',resultPath:'result.json',acceptance:'',namespace:'events-'+crypto.randomUUID().slice(0,8),eventSource:'',eventTypes:'',secretEnv:'',url:'',callbackSecret:'',hours:'24',maxEvents:'100',maxConcurrent:'1',idempotent:false,parameters:'{}',continuations:'[]',transport:'{"kind":"standard"}',resultFiles:'[]',normalizerSourceId:'',customTask:false,criteria:'[]',nodes:'[]'});
  const command=useRef<{signature:string;value:ReturnType<typeof automationCommand>}|undefined>(undefined),stepHeading=useRef<HTMLHeadingElement>(null);
  useEffect(()=>{alive.current=true;let active=true;const params=new URLSearchParams(location.search);void Promise.all([request<Catalog>('/router-management/catalog'),request<Scopes>('/router-scopes'),params.has('skill')?request<SavedAutomationSkill>('/router-skills/read',{id:params.get('skill'),version:Number(params.get('version')),scopeId:params.get('scope'),entryId:params.get('entry')}):Promise.resolve(undefined)]).then(([c,s,k])=>{if(!active)return;setCatalog({...c,contexts:c.contexts.filter(x=>!k||x.entryId===k.entryId).reverse()});setScopes(s);setSkill(k);if(k)setDraft(d=>({...d,title:k.template.title,objective:k.template.objective,customTask:true,criteria:JSON.stringify(k.template.criteria,null,2),nodes:JSON.stringify(k.template.nodes,null,2)}))}).catch(e=>{if(active)setError(errorMessage(e,L))});return()=>{active=false;alive.current=false}},[]);
  useEffect(()=>{stepHeading.current?.focus()},[step]);
  const update=<K extends keyof AutomationDraft>(key:K,value:AutomationDraft[K])=>{setDraft(d=>({...d,[key]:value}));setError('')};
  const context=catalog?.contexts.find(c=>c.id===draft.triggerId),scope=scopes?.scopes.find(s=>s.id===context?.scopeId),workers=catalog?.workers.filter(w=>scope?.workerIds.includes(w.id))??[];
  const input=(key:keyof AutomationDraft,label:string,props:Record<string,unknown>={})=><Field label={label}><input name={key} value={String(draft[key])} onChange={e=>update(key,e.target.value)} {...props}/></Field>;
  const json=(key:keyof AutomationDraft,label:string,readOnly=false)=><Field label={label}><textarea name={key} className="automation-code" rows={5} value={String(draft[key])} readOnly={readOnly} onChange={e=>update(key,e.target.value)}/></Field>;
  const submit=async()=>{
    if(working.current||!alive.current)return;working.current=true;setBusy(true);setError('')
    try{
      const signature=JSON.stringify({draft,skill});if(!pendingCreation&&command.current?.signature!==signature)command.current={signature,value:automationCommand(draft,crypto.randomUUID(),Date.now(),skill)}
      if(!command.current)throw Error('request_failed')
      const grant=await request<Grant>('/webhooks/grants',command.current.value);if(alive.current){setPendingCreation(false);saved(grant)}
    }catch(e){if(alive.current){const code=e instanceof Error?e.message:'';const definitive=['validation_error','webhook_listener_not_configured','real_human_authorization_required','scope_manager_authorization_required','automation_requires_group_entry','template_worker_outside_scope','template_worker_unavailable','credential_unavailable','callback_target_forbidden','invalid_secret','separate_direction_credentials_required','automation_permissions_changed','grant_expired','webhook_protocol_upgrade_required'].includes(code);setPendingCreation(!!command.current&&!definitive);if(definitive)command.current=undefined;setError(errorMessage(e,L))}}
    finally{working.current=false;if(alive.current)setBusy(false)}
  };
  if(!catalog)return error?<p role="alert" className="automation-message">{error}</p>:<div className="automation-loading" role="status" aria-label={L('Loading conversations','正在加载会话')}><span/><span/></div>;
  if(!catalog.contexts.length)return <div className="automation-empty"><h2>{L('No authorized group conversation','暂无已授权的群聊')}</h2><a className="automation-primary" href="/configure#connections">{L('Conversation entries','会话入口')}<ChevronRight size={16}/></a></div>;
  return <form className="automation-editor" onSubmit={e=>{e.preventDefault();if(step===0)setStep(1);else void submit()}}>
    <fieldset disabled={busy||pendingCreation}>
    <nav className="automation-steps" aria-label={L('Setup steps','配置步骤')}><span aria-current={step===0?'step':undefined}>{L('Task','任务')}</span><ChevronRight size={14}/><span aria-current={step===1?'step':undefined}>{L('Event connection','事件接入')}</span></nav>
    <h2 ref={stepHeading} tabIndex={-1} className="sr-only">{step===0?L('Task','任务'):L('Event connection','事件接入')}</h2>
    {step===0?<>
      <Field label={L('Authorization message','授权消息')}><select name="triggerId" required value={draft.triggerId} onChange={e=>{const c=catalog.contexts.find(c=>c.id===e.target.value),s=scopes?.scopes.find(s=>s.id===c?.scopeId);setDraft(d=>({...d,triggerId:e.target.value,authorizationQuote:c?.title??'',workerId:catalog.workers.find(w=>s?.workerIds.includes(w.id))?.id??''}));setError('')}}><option value="">{L('Choose a message','选择消息')}</option>{catalog.contexts.map(c=><option key={c.id} value={c.id}>{c.title||c.label}</option>)}</select></Field>
      {input('title',L('Name','名称'),{required:true,readOnly:!!skill,maxLength:240})}
      <Field label={L('Task','要完成的任务')}><textarea name="objective" rows={4} required readOnly={!!skill} value={draft.objective} onChange={e=>update('objective',e.target.value)}/></Field>
      {!skill&&!draft.customTask?<><Field label={L('Worker','负责的 Worker')}><select name="workerId" required value={draft.workerId} onChange={e=>update('workerId',e.target.value)}><option value="">{L('Choose a Worker','选择 Worker')}</option>{workers.map(w=><option key={w.id} value={w.id}>{w.label||w.id}</option>)}</select></Field><Field label={L('Acceptance criteria','验收要求')}><textarea name="acceptance" rows={2} required value={draft.acceptance} onChange={e=>update('acceptance',e.target.value)}/></Field>{input('resultPath',L('Result file','结果文件'),{required:true})}</>:null}
      <details><summary>{L('Advanced task rules','高级任务规则')}</summary>{input('authorizationQuote',L('Authorization quote','授权原文'),{required:true})}<label className="automation-check"><input type="checkbox" checked={draft.customTask} disabled={!!skill} onChange={e=>{const d={...draft,customTask:false};const template=defaultAutomationTask(d);setDraft({...draft,customTask:e.target.checked,criteria:JSON.stringify(template.criteria,null,2),nodes:JSON.stringify(template.nodes,null,2)})}}/>{L('Edit task JSON','编辑任务 JSON')}</label>{draft.customTask?<>{json('criteria',L('Acceptance rules JSON','验收规则 JSON'),!!skill)}{json('nodes',L('Task nodes JSON','任务节点 JSON'),!!skill)}</>:null}</details>
    </>:<>
      {input('eventSource',L('Event source URL','事件来源地址'),{type:'url',required:true,placeholder:'https://example.com/events'})}
      {input('eventTypes',L('Event types','事件类型'),{required:true,placeholder:'ci.failed'})}
      {input('secretEnv',L('Incoming signing key variable','事件签名密钥变量'),{required:true,pattern:'[A-Za-z_][A-Za-z0-9_]*',placeholder:'WEBHOOK_INPUT_SECRET'})}
      {input('url',L('Result callback URL','结果回传地址'),{type:'url',required:true})}
      {input('callbackSecret',L('Callback signing key variable','回传签名密钥变量'),{required:true,pattern:'[A-Za-z_][A-Za-z0-9_]*',placeholder:'WEBHOOK_OUTPUT_SECRET'})}
      <div className="automation-field-pair">{input('hours',L('Valid for (hours)','有效时长（小时）'),{type:'number',required:true,min:1,max:8784})}{input('maxEvents',L('Event limit','最多接收事件'),{type:'number',required:true,min:1,max:100000})}</div>
      <details><summary>{L('Advanced connection settings','高级接入设置')}</summary>{input('namespace',L('Namespace','命名空间'),{required:true,pattern:'[A-Za-z0-9_-]+'})}{input('maxConcurrent',L('Concurrent tasks','同时执行任务'),{type:'number',required:true,min:1,max:10})}{json('parameters',L('Event parameters JSON','事件参数 JSON'))}{json('continuations',L('Continuation rules JSON','续接规则 JSON'))}{json('transport',L('Transport adapter JSON','传输适配器 JSON'))}{json('resultFiles',L('Callback files JSON','回传文件 JSON'))}{input('normalizerSourceId',L('Normalizer plugin ID','事件转换插件 ID'))}</details>
      <label className="automation-check"><input type="checkbox" name="idempotent" required checked={draft.idempotent} onChange={e=>update('idempotent',e.target.checked)}/>{L('The callback service deduplicates by webhook-id','回传服务已按 webhook-id 去重')}</label>
    </>}
    </fieldset>
    <p className="automation-message">{L('New automations are saved with receiving paused. Rehearse the rules before explicitly starting reception.','新自动化保存时暂停接收，请预演规则后再显式开始接收。')}</p>
    {pendingCreation?<p role="alert" className="automation-message">{L('Creation has no confirmed result. Retry the original request here. If you leave or reload, inspect existing automations before creating another.','创建结果尚未确认，请在此重试原请求。离开或重新加载后，请先核对已有自动化，再创建另一项。')}</p>:null}
    {error?<p className="automation-message" role="alert">{error}</p>:null}
    <footer className="automation-form-footer"><button type="button" disabled={busy} onClick={()=>pendingCreation?cancel():step?setStep(0):cancel()}>{pendingCreation?L('Cancel','取消'):step?L('Back','上一步'):L('Cancel','取消')}</button><button className="automation-primary" disabled={busy}>{busy?L('Creating…','正在创建…'):pendingCreation?L('Retry original creation','重试原创建请求'):step?L('Create automation','创建自动化'):L('Next','下一步')}</button></footer>
  </form>;
}
