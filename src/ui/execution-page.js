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
