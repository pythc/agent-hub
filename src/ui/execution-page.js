// Execution content only. The existing application header and sidebar own navigation.
const executionView={root:null,motion:null,mode:'calls',instructions:null,instructionFocus:'',selected:null,inspect:null,callId:null,dialogVersion:0,stale:false}
function executionSetCount(count){
 if(!Number.isInteger(count)||count<1||count>10)return
 const draft=executionDraft(),next=draft.workers.slice(0,count)
 while(next.length<count){let index=next.length+1;while(next.some(w=>w.id==='worker-'+index))index++;next.push({id:'worker-'+index,backend:draft.workers[0]?.backend??draft.router})}
 draft.workers=next;editExecution(draft);render();queueMicrotask(()=>document.getElementById('worker-count')?.focus())
}
function executionModel(id,value,backend,onChange){
 const services=controlConnections(),draft=executionDraft(),service=services.find(s=>s.id===backend),field=controlField(id,L('Model','模型'),value,onChange,null,service?.model||L('Service default','服务默认模型'))
 const input=field.querySelector('input'),list=el('datalist');list.id=id+'-options';input.setAttribute('list',list.id)
 const values=[service?.model,...draft.workers.filter(w=>w.backend===backend).map(w=>w.model),...(draft.router===backend?[draft.routerModel]:[])].filter(Boolean)
 for(const model of new Set(values)){const option=el('option');option.value=model;list.append(option)}
 field.append(list);return field
}
function executionEditInstructions(role,index){
 const button=affectButton(L('Edit instructions','编辑指令'),()=>{executionView.instructions=role;executionView.instructionFocus=button.id;render()},{variant:'ghost',glyph:'prompts'})
 button.id='execution-instructions-'+role+(index==null?'':'-'+index);button.classList.add('execution-edit-instructions')
 button.setAttribute('aria-label',role==='worker'?L('Edit shared Worker instructions','编辑所有 Worker 的共同指令'):L('Edit Router instructions','编辑 Router 指令'))
 if(role==='worker')button.title=L('Applies to all Workers','作用于全部 Worker')
 return button
}
function executionCloseInstructions(){
 executionView.instructions=null;document.getElementById('execution-instructions')?.close();render();document.getElementById(executionView.instructionFocus)?.focus({preventScroll:true})
}
function executionInstructions(){
 if(!executionView.instructions)return null
 const role=executionView.instructions,dialog=el('dialog','execution-instructions');dialog.id='execution-instructions';dialog.setAttribute('aria-labelledby','execution-instructions-title')
 const title=el('h2','',L('Instructions','指令'));title.id='execution-instructions-title'
 const close=affectButton(L('Close','关闭'),executionCloseInstructions,{variant:'ghost'})
 const tabs=affectSegmented({id:'execution-instruction-tab',label:L('Instruction target','指令用途'),value:role,options:[{value:'router',label:'Router',controls:'execution-instruction-panel'},{value:'worker',label:'Workers',controls:'execution-instruction-panel'}],onChange:value=>{executionView.instructions=value;render()}})
 const panel=el('div','execution-instruction-panel');panel.id='execution-instruction-panel';panel.setAttribute('role','tabpanel');panel.setAttribute('aria-labelledby','execution-instruction-tab-'+role)
 const label=el('label','',role==='worker'?L('Shared by all Workers','作用于全部 Worker'):L('How Router accepts and scopes work','Router 如何接收任务和确定范围'));label.htmlFor='execution-instruction-text'
 const input=el('textarea');input.id=label.htmlFor;input.value=S.draft.prompts?.[role]||'';input.placeholder=L('Leave empty to keep the built-in instructions.','留空保留系统默认指令。');input.disabled=!!S.busy
 input.oninput = () => {
  editPrompt(role, input.value)
  saveButton.disabled = !!S.latest || !!S.errors.size || !changed().includes('prompts')
 }
 panel.append(label,input)
 const saveButton = affectButton(L('Save instructions','保存指令'), async () => {
  if (await save(['prompts'])) executionCloseInstructions()
  else if (S.latest) { executionCloseInstructions(); revealRecovery() }
 }, { variant:'primary', loading:S.busy==='save', disabled:!!S.latest || !!S.errors.size || !changed().includes('prompts') })
 const feedback=S.notice?.level==='error'?noticeView():null
 add(dialog,add(el('div','execution-dialog-heading'),title,close),tabs,panel,el('p','control-hint',L('These requirements supplement the system instructions.','补充要求会与系统指令一起使用。')),feedback,add(el('div','execution-dialog-actions'),saveButton))
 dialog.oncancel=event=>{event.preventDefault();if(!S.busy)executionCloseInstructions()}
 return dialog
}
function controlExecution() {
  if (!S.base) return [accessPanel()]
  if (executionView.mode === 'calls') return executionCallsPage(el('section', 'execution-page'))
  return teamConfiguration()
}

// Read-only observations from the existing scheduler, never an admission decision.
const schedulerView={root:null,data:null,scope:'',busy:false,failed:false,request:0,lastRead:0}
function schedulerScope(){return JSON.stringify([workspaceContext.epoch,workspaceContext.activeId])}
function schedulerResetScope(){
 const scope=schedulerScope();if(scope===schedulerView.scope)return
 Object.assign(schedulerView,{scope,data:null,busy:false,failed:false,lastRead:0,request:schedulerView.request+1})
}
function schedulerSnapshot(value){
 const counts=(item,keys)=>item&&keys.every(key=>Number.isSafeInteger(item[key])&&item[key]>=0)
 const occupancy=['jobs','routingJobs','workerJobs','controllers','backgroundReservations','activeManagedWork'],workers=['configured','enabled','paused','retiring','idleEnabled'],queue=['ready','delayed','blocked','uncertain']
 if(value?.schema!==1||!Number.isSafeInteger(value.observedAt)||value.observedAt<0||value.observedAt>8640000000000000||typeof value.paused!=='boolean'||
  !counts(value.occupancy,occupancy)||!counts(value.workers,workers)||!counts(value.queue,queue)||
  value.routing?.countedLimit!==4||!counts(value.routing,['admittedButWorkerCountedJobs'])||value.interactive?.additionalLimit!==1||
  !counts(value.interactive,['eligibleQueued','activeReservedExecutions'])||!['existing_session','legacy_pool'].includes(value.interactive.mode)||
  value.occupancy.jobs!==value.occupancy.routingJobs+value.occupancy.workerJobs||value.workers.configured!==value.workers.enabled+value.workers.paused+value.workers.retiring||
  value.workers.idleEnabled>value.workers.enabled||value.routing.admittedButWorkerCountedJobs>value.occupancy.workerJobs||value.interactive.eligibleQueued>value.queue.ready)throw Error('scheduler_status_invalid')
 // Retain only the public aggregate fields, even when an older host sends extras.
 const pick=(item,keys)=>Object.fromEntries(keys.map(key=>[key,item[key]]))
 return {schema:1,observedAt:value.observedAt,paused:value.paused,occupancy:pick(value.occupancy,occupancy),workers:pick(value.workers,workers),queue:pick(value.queue,queue),routing:pick(value.routing,['countedLimit','admittedButWorkerCountedJobs']),interactive:pick(value.interactive,['additionalLimit','eligibleQueued','activeReservedExecutions','mode'])}
}
function schedulerVisible(){
 const root=schedulerView.root
 return !!(root?.isConnected&&!document.hidden&&root.getClientRects().length&&S.authed&&(typeof configurationHost==='undefined'||configurationHost.active()))
}
function schedulerPaint(){
 const root=schedulerView.root;if(!root?.isConnected)return
 const fields=root.schedulerFields,data=schedulerView.data
 root.dataset.state=schedulerView.failed?'stale':data?.paused?'paused':data?'ready':'loading'
 fields.state.textContent=data?(data.paused?L('Scheduling paused','调度已暂停'):L('Scheduling active','调度运行中')):schedulerView.failed?L('Team status unavailable','团队状态不可用'):L('Loading team status…','正在读取团队状态…')
 fields.time.hidden=!data
 if(data){fields.time.dateTime=new Date(data.observedAt).toISOString();fields.time.textContent=L('Status at ','状态时间 ')+new Date(data.observedAt).toLocaleString(lang,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit'})}
 fields.refresh.textContent=schedulerView.busy?L('Refreshing…','正在刷新…'):L('Refresh status','刷新状态');fields.refresh.disabled=schedulerView.busy
 fields.failure.hidden=!schedulerView.failed
 fields.failure.textContent=data?L('Couldn’t refresh. Showing the last recorded state.','刷新失败，显示上次记录的状态。'):L('Team status is unavailable. Try refreshing.','暂时无法读取团队状态，请重试刷新。')
 fields.paused.hidden=!data?.paused;fields.paused.textContent=L('Existing work may still be running.','已有工作可能仍在继续。')
 fields.metrics.hidden=!data;fields.details.hidden=!data
 if(!data)return
 for(const [key,node]of Object.entries(fields.values)){const [group,name]=key.split('.');node.textContent=String(data[group][name])}
 fields.interactive.textContent=data.interactive.mode==='existing_session'?L('An existing conversation may use at most one additional slot. Access and other scheduling checks still apply.','已有会话最多可使用一个额外名额，仍须通过权限及其他调度检查。'):L('Some conversation replies may use at most one additional slot. Access and other scheduling checks still apply.','部分会话回复最多可使用一个额外名额，仍须通过权限及其他调度检查。')
}
async function schedulerRefresh(){
 schedulerResetScope()
 if(schedulerView.busy||!schedulerVisible())return
 const request=++schedulerView.request,scope=schedulerView.scope
 schedulerView.busy=true;schedulerView.lastRead=Date.now();schedulerPaint()
 try{
  const data=schedulerSnapshot(await api('/api/scheduler-status'))
  if(request!==schedulerView.request||scope!==schedulerScope())return
  schedulerView.data=data;schedulerView.failed=false
 }catch{
  if(request!==schedulerView.request||scope!==schedulerScope())return
  schedulerView.failed=true
 }finally{if(request===schedulerView.request){if(scope!==schedulerScope())schedulerResetScope();schedulerView.busy=false;schedulerPaint()}}
}
function schedulerPanel(){
 schedulerResetScope()
 const root=el('section','scheduler-panel');root.id='team-scheduler-status';root.setAttribute('aria-labelledby','team-scheduler-title')
 const title=el('h2','',L('Team status','团队状态'));title.id='team-scheduler-title'
 const state=el('strong','scheduler-state'),time=el('time','scheduler-time'),refresh=opButton(L('Refresh status','刷新状态'),()=>void schedulerRefresh(),'button');refresh.id='scheduler-refresh'
 const failure=el('p','scheduler-failure');failure.setAttribute('role','alert')
 const paused=el('p','scheduler-paused'),metrics=el('dl','scheduler-metrics'),details=el('details','scheduler-details'),values={}
 const metric=(list,key,en,zh)=>{const cell=el('div'),label=el('dt','',L(en,zh)),count=el('dd','','—');count.dataset.schedulerValue=key;values[key]=count;cell.append(label,count);list.append(cell)}
 metric(metrics,'occupancy.jobs','Working','正在处理');metric(metrics,'queue.ready','Waiting','正在排队');metric(metrics,'occupancy.backgroundReservations','Background work','后台处理');metric(metrics,'workers.idleEnabled','Idle Workers','空闲 Worker')
 const summary=el('summary','',L('View details','查看详情')),explanation=el('p','',L('Waiting work is not guaranteed to start next. An idle Worker may not be available to a particular task.','排队不代表马上开始，空闲 Worker 也不一定能执行当前任务。')),extra=el('dl','scheduler-extra')
 for(const [key,en,zh]of [
  ['queue.delayed','Scheduled for later','尚未到时'],['queue.blocked','Needs attention','等待处理'],['queue.uncertain','Outcome needs checking','结果待核查'],
  ['workers.enabled','Enabled Workers','已启用 Worker'],['workers.paused','Paused Workers','已暂停 Worker'],['workers.retiring','Retiring Workers','正在退出的 Worker'],
  ['occupancy.routingJobs','Counted Router work','计入 Router 限额的工作'],['occupancy.workerJobs','Other active work','其他正在处理的工作'],['occupancy.controllers','Active execution controls','活动执行控制'],
  ['occupancy.activeManagedWork','Managed work in progress','正在处理的受管工作'],['routing.countedLimit','Router counting limit','Router 计数上限'],['routing.admittedButWorkerCountedJobs','Router work counted elsewhere','计入其他工作一侧的 Router 工作'],
  ['interactive.eligibleQueued','Conversation work meeting the extra-slot rule','符合额外名额规则的会话工作'],['interactive.activeReservedExecutions','Recorded use of the extra slot','记录中使用额外名额的执行']])metric(extra,key,en,zh)
 const interactive=el('p');details.append(summary,explanation,interactive,extra)
 const heading=add(el('div','scheduler-heading'),add(el('div'),title,state),refresh)
 root.append(heading,time,failure,paused,metrics,details);root.schedulerFields={state,time,refresh,failure,paused,metrics,details,values,interactive};schedulerView.root=root
 queueMicrotask(()=>{schedulerPaint();if(!schedulerView.lastRead||Date.now()-schedulerView.lastRead>=5000)void schedulerRefresh()})
 return root
}
setInterval(()=>{if(schedulerVisible())void schedulerRefresh()},5000)

// Retained resource observations; no timer, quota calculation or execution control.
const resourceView={root:null,data:null,identity:null,busy:false,failed:false,loaded:false,request:0,controller:null,bridge:null,unsubscribe:null}
function resourceIdentity(){
 const account=entryState.account??null,bridge=resourceView.bridge?.context()
 return {epoch:bridge?.epoch??workspaceContext.epoch,activeId:bridge?.activeId??workspaceContext.activeId,account,accountId:account?.authenticated===true?account.user?.id??null:null,session:account?.session??null,sessionExpiresAt:account?.session?.expiresAt??null,sessionRemember:account?.session?.remember??null,sessionIsolation:bridge?.sessionIsolation??workspaceContext.sessionIsolation??null,phase:bridge?.state??workspaceContext.transportPhase??null,authed:S.authed===true}
}
function resourceSameIdentity(a,b){return !!a&&Object.keys(b).every(key=>a[key]===b[key])}
function resourceResetIdentity(){
 const identity=resourceIdentity();if(resourceSameIdentity(resourceView.identity,identity))return
 resourceView.controller?.abort()
 Object.assign(resourceView,{identity,data:null,busy:false,failed:false,loaded:false,request:resourceView.request+1,controller:null})
}
function resourceSnapshot(value){
 const number=n=>Number.isSafeInteger(n)&&n>=0,time=n=>number(n)&&n<=8640000000000000,fields=['inputTokens','cachedInputTokens','cacheWriteInputTokens','outputTokens','reasoningOutputTokens','totalTokens'],counts=['calls','reportedCalls','unknownCalls','partialCalls','steps'],purposes=['router','worker','subagent','verification','replanning','plan_review','memory','auxiliary','watchdog'],states=['starting','running','completed','failed','cancelled','interrupted']
 const row=r=>r&&counts.every(key=>number(r[key]))&&r.reportedCalls<=r.calls&&r.unknownCalls===r.calls-r.reportedCalls&&r.partialCalls<=r.reportedCalls&&r.tokens&&fields.every(key=>r.tokens[key]===null||number(r.tokens[key]))
 const total=(items,key)=>items.reduce((sum,item)=>{if(!number(item[key])||item[key]>Number.MAX_SAFE_INTEGER-sum)throw Error('resource_usage_invalid');return sum+item[key]},0)
 const usage=value?.usage,context=value?.context,work=value?.work
 if(value?.schema!==1||value.scope!=='host'||!time(value.observedAt)||!number(value.settingsRevision)||!row(usage)||!(usage.since===null||time(usage.since))||!number(usage.legacyUntrackedCalls)||(usage.watchdogUnavailable!==undefined&&typeof usage.watchdogUnavailable!=='boolean')||!usage.fieldReported||!fields.every(key=>number(usage.fieldReported[key])&&usage.fieldReported[key]<=usage.steps)||!Array.isArray(usage.groups)||usage.groups.length>purposes.length||!usage.groups.every(group=>row(group)&&purposes.includes(group.purpose))||new Set(usage.groups.map(group=>group.purpose)).size!==usage.groups.length||counts.some(key=>total(usage.groups,key)!==usage[key]))throw Error('resource_usage_invalid')
 const contextFields=['retainedActivities','withinBudgetActivities','exceededActivities','unrecognizedActivities']
 if(!context||!contextFields.every(key=>number(context[key]))||!(context.lastCheckAt===null||time(context.lastCheckAt))||total([{n:context.withinBudgetActivities},{n:context.exceededActivities},{n:context.unrecognizedActivities}],'n')!==context.retainedActivities||(context.withinBudgetActivities+context.exceededActivities===0)!==(context.lastCheckAt===null))throw Error('resource_usage_invalid')
 const workFields=['retainedItems','unrecognizedStateItems','deadlineItems','pastDeadlineItems','invalidDeadlineItems'],limits=['maxAgentsPerTicket','maxDepth','backgroundTimeoutMs','maxOutputBytesPerShell']
 if(!work||!workFields.every(key=>number(work[key]))||!work.states||!states.every(key=>number(work.states[key]))||total([...states.map(key=>({n:work.states[key]})),{n:work.unrecognizedStateItems}],'n')!==work.retainedItems||work.pastDeadlineItems>work.deadlineItems||work.deadlineItems>work.states.starting+work.states.running||work.invalidDeadlineItems>work.states.starting+work.states.running-work.deadlineItems||!work.limits||!limits.every(key=>number(work.limits[key])&&work.limits[key]>0))throw Error('resource_usage_invalid')
 const pick=(item,keys)=>Object.fromEntries(keys.map(key=>[key,item[key]]))
 return {schema:1,scope:'host',observedAt:value.observedAt,settingsRevision:value.settingsRevision,usage:{...pick(usage,['calls','reportedCalls','unknownCalls','partialCalls','legacyUntrackedCalls','since']),totalTokens:usage.tokens.totalTokens,watchdogUnavailable:usage.watchdogUnavailable===true},context:pick(context,[...contextFields,'lastCheckAt']),work:{...pick(work,workFields),states:pick(work.states,states),limits:pick(work.limits,limits)}}
}
function resourceAuthorized(){const phase=resourceView.bridge?.context().state??workspaceContext.transportPhase;return S.authed&&(!phase||phase==='ready')}
function resourceVisible(){const root=resourceView.root;return !!(root?.isConnected&&!document.hidden&&root.getClientRects().length&&resourceAuthorized()&&(typeof configurationHost==='undefined'||configurationHost.active()))}
function resourcePaint(){
 resourceResetIdentity()
 const root=resourceView.root;if(!root?.isConnected)return
 const fields=root.resourceFields,data=resourceView.data,format=n=>n.toLocaleString(lang),date=n=>new Date(n).toLocaleString(lang,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit'})
 root.dataset.state=resourceView.failed?(data?'stale':'unavailable'):data?'ready':resourceAuthorized()?'loading':'unavailable'
 fields.state.hidden=!!data
 fields.state.textContent=data?L('Recorded usage','已记录用量'):resourceView.failed||!resourceAuthorized()?L('Usage unavailable','用量暂不可用'):L('Loading usage…','正在读取用量…')
 fields.refresh.textContent=resourceView.busy?L('Refreshing…','正在刷新…'):L('Refresh usage','刷新用量');fields.refresh.disabled=resourceView.busy||!resourceAuthorized()
 fields.time.hidden=!data;if(data){fields.time.dateTime=new Date(data.observedAt).toISOString();fields.time.textContent=L('Updated ','更新于 ')+date(data.observedAt)}
 fields.failure.hidden=!resourceView.failed;fields.failure.textContent=data?L('Refresh failed. Showing earlier data from the time above.','刷新失败，暂显示上方时间的数据。'):L('Usage could not be loaded. Try refreshing.','无法读取用量，请重试刷新。')
 fields.metrics.hidden=!data;fields.details.hidden=!data;fields.coverage.hidden=!data;fields.note.hidden=!data;fields.observer.hidden=!data?.usage.watchdogUnavailable;fields.legacy.hidden=!data?.usage.legacyUntrackedCalls
 if(!data){fields.time.dateTime='';for(const node of [...Object.values(fields.values),...Object.values(fields.extraValues)])node.textContent='—';for(const node of [fields.time,fields.coverage,fields.note,fields.observer,fields.legacy,fields.contextTime])node.textContent='';return}
 fields.values.tokens.textContent=data.usage.totalTokens===null?L('No data','暂无数据'):format(data.usage.totalTokens)
 fields.coverage.textContent=data.usage.calls===0?L('No calls recorded.','尚无调用记录。'):L(format(data.usage.reportedCalls)+' of '+format(data.usage.calls)+' calls supplied usage',format(data.usage.calls)+' 次调用中 '+format(data.usage.reportedCalls)+' 次提供用量')+(data.usage.partialCalls?L('; '+format(data.usage.partialCalls)+' incomplete.','，'+format(data.usage.partialCalls)+' 次不完整。'):L('.','。'))
 fields.note.textContent=L('Usage may be incomplete. This is not a bill or remaining quota.','用量可能不全，不是账单或剩余额度。')
 fields.observer.textContent=L('Background usage is unavailable.','后台用量暂时缺失。');fields.legacy.textContent=L('Older calls missing usage: ','另有旧调用缺少用量：')+format(data.usage.legacyUntrackedCalls)
 for(const [key,node]of Object.entries(fields.extraValues)){const [group,section,name]=key.split('.'),value=name?data[group][section][name]:data[group][section];node.textContent=typeof value==='number'?format(value):L('Not recorded','尚无记录')}
 fields.contextTime.textContent=data.context.lastCheckAt===null?L('No check recorded.','尚无检查记录。'):L('Last check: ','最近检查：')+date(data.context.lastCheckAt)
}
async function resourceRefresh(){
 resourceResetIdentity();if(resourceView.busy||!resourceVisible())return
 const request=++resourceView.request,identity=resourceView.identity,controller=new AbortController();resourceView.controller=controller;resourceView.busy=true;resourceView.loaded=true;resourcePaint()
 try{const data=resourceSnapshot(await api('/api/resource-usage',undefined,false,workspaceContext.activeId,controller.signal));if(request!==resourceView.request||!resourceSameIdentity(identity,resourceIdentity()))return;resourceView.data=data;resourceView.failed=false}
 catch(error){if(request!==resourceView.request||!resourceSameIdentity(identity,resourceIdentity()))return;if(error?.status===401||error?.status===403)resourceView.data=null;resourceView.failed=true}
 finally{if(request===resourceView.request){resourceResetIdentity();resourceView.busy=false;resourceView.controller=null;resourcePaint()}}
}
function resourcePanel(){
 if(!resourceView.bridge&&typeof workspaceBridge==='function')resourceView.bridge=workspaceBridge()
 resourceResetIdentity()
 if(!resourceView.unsubscribe&&resourceView.bridge)resourceView.unsubscribe=resourceView.bridge.subscribe(()=>{resourceResetIdentity();resourcePaint();queueMicrotask(()=>{if(!resourceView.loaded)void resourceRefresh()})})
 const root=el('section','resource-panel');root.id='team-resource-usage';root.setAttribute('aria-labelledby','resource-usage-title')
 const title=el('h2','',L('Workspace usage','当前环境用量'));title.id='resource-usage-title'
 const state=el('strong','resource-state'),time=el('time','resource-time'),refresh=opButton(L('Refresh usage','刷新用量'),()=>void resourceRefresh(),'button');refresh.id='resource-refresh'
 const failure=el('p','resource-failure');failure.setAttribute('role','alert')
 const coverage=el('p','resource-coverage'),note=el('p','resource-note'),observer=el('p','resource-warning'),legacy=el('p','resource-warning'),metrics=el('dl','resource-metrics'),values={},details=el('details','resource-details'),extra=el('dl','resource-extra'),extraValues={}
 const metric=(list,key,en,zh,target)=>{const cell=el('div'),value=el('dd','','—');target[key]=value;cell.append(el('dt','',L(en,zh)),value);list.append(cell)}
 metric(metrics,'tokens','Recorded usage (tokens)','已记录用量（token）',values)
 for(const [key,en,zh]of [
  ['context.retainedActivities','Context checks','上下文检查'],['context.withinBudgetActivities','Within limit','未超限'],['context.exceededActivities','Over limit','已超限'],['context.unrecognizedActivities','Unrecognized checks','无法识别的检查'],
  ['work.retainedItems','Work records','工作记录'],['work.states.starting','Starting','启动中'],['work.states.running','Running','运行中'],['work.states.completed','Completed','已完成'],['work.states.failed','Failed','失败'],['work.states.cancelled','Cancelled','已取消'],['work.states.interrupted','Interrupted','已中断'],['work.unrecognizedStateItems','Unrecognized work states','无法识别的工作状态'],['work.deadlineItems','Active work with deadlines','设定期限的进行中工作'],['work.pastDeadlineItems','Past deadline','已超过期限'],['work.invalidDeadlineItems','Invalid deadlines','无法识别的期限'],
  ['work.limits.maxAgentsPerTicket','Subagents per task limit','单任务子 Agent 上限'],['work.limits.maxDepth','Nesting depth limit','嵌套层数上限'],['work.limits.backgroundTimeoutMs','Background timeout (ms)','后台超时（毫秒）'],['work.limits.maxOutputBytesPerShell','Stored shell output limit (bytes)','Shell 输出保留上限（字节）']])metric(extra,key,en,zh,extraValues)
 const contextTime=el('p','resource-context-time');details.append(el('summary','',L('Details and limits','明细与上限')),el('p','',L('These saved records do not show free capacity. Overdue work may still be running.','这些记录不代表当前可用名额，超过期限的工作也可能仍在继续。')),contextTime,extra)
 root.append(add(el('div','resource-heading'),add(el('div'),title,state),refresh),time,failure,metrics,coverage,note,observer,legacy,details)
 root.resourceFields={state,time,refresh,failure,metrics,coverage,note,observer,legacy,values,details,extraValues,contextTime};resourceView.root=root
 queueMicrotask(()=>{resourcePaint();if(!resourceView.loaded)void resourceRefresh()})
 return root
}
