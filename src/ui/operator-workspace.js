// The expert's operator composition, connected to the existing same-origin host.
const operator = {drawerProof:null,drawerRequest:0,drawerController:null,drawerTracked:false,work:null,error:false,filter:'all',search:'',menu:false,drawer:null,workflowFeedback:'',answers:{},focus:'',offset:0,historySearch:'',historyState:''}
Object.assign(icons, {
  inbox:'M4 4h16l2 12v4H2v-4L4 4zM2 15h6l2 3h4l2-3h6',
  activity:'M3 12h4l3-8 4 16 3-8h4',cpu:'M5 5h14v14H5zM9 9h6v6H9zM9 1v4m6-4v4m-6 14v4m6-4v4M1 9h4m-4 6h4m14-6h4m-4 6h4',
  book:'M3 4h7l2 2 2-2h7v16h-7l-2 2-2-2H3V4zM12 6v16',monitor:'M3 4h18v13H3zM8 21h8m-4-4v4',
  menu:'M4 6h16M4 12h16M4 18h16',plus:'M12 5v14M5 12h14',close:'M5 5l14 14M19 5 5 19',
  message:'M3 3h18v14H8l-5 4V3zM7 8h10M7 12h6',terminal:'m4 6 6 6-6 6M13 18h7',
  pointer:'m4 3 5 18 4-8 8-4L4 3z',code:'m8 6-6 6 6 6m8-12 6 6-6 6m-3-15-2 18',
  spark:'m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3z',
  conversations:'M3 4h14v10H8l-5 4V4zM17 9h4v12l-5-4h-5v-3',search:'M21 21l-6-6M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0'
})
const opPages = () => ({
  home: L('Workspace', '工作区'), attention: L('Needs your attention', '待我处理'),
  activity: L('Tasks', '任务'), 'active-tasks': L('Tasks', '任务'), catalog: L('Conversation entries', '会话入口'),
  catalogue: L('New connection', '新建接入'), detail: entryName(entryState.selected),
  models: L('Model connections', '模型连接'), 'model-new': L('New model connection', '新建模型连接'),
  deployments: L('Deployments', '部署'), integrations: L('Tools and apps', '工具与应用'), execution: L('Agent team', 'Agent 团队'), prompts: L('Behavior rules', '行为规则'),
  usage: L('Usage guide', '使用指引'), advanced: L('Settings', '设置')
})
function opButton(text,callback,kind='button',glyph){const button=action(text,callback,kind,glyph);if(kind.includes('icon-button')&&glyph){button.setAttribute('aria-label',text);button.title=text;button.replaceChildren(icon(glyph))}return button}
function opNavigate(page, id, options) {
  if (operator.menu) setOperatorMenu(false)
  return entryNavigate(page, id, options)
}
function operatorWorkPath() {
  const params = new URLSearchParams()
  if (entryState.page === 'activity') {
    params.set('offset', String(operator.offset))
    if (operator.historySearch) params.set('search', operator.historySearch)
    if (operator.historyState) params.set('state', operator.historyState)
  }
  return '/entry-workspace' + (params.size ? '?' + params : '')
}
async function readOperatorWork() {
  try {
    operator.work = await api(operatorWorkPath())
    operator.error = false
    if(entryState.page==='attention')void readAttentionProjection(operator.attentionView.snapshot?.offset??0)
  } catch (error) {
    if (error.payload?.code === 'workspace_obsolete') return
    operator.error = true
    if (error.status === 401) throw error
  }
}
// A transient rendering cache of the existing GET projection, never permission.
operator.attentionView={bridge:null,unsubscribe:null,key:'',binding:null,request:0,controller:null,snapshot:null,loaded:false,busy:false,failed:false,drawer:null,focus:''}
const attentionKinds=['task_question','native_question','native_approval','workflow_review','project_review','effect_unknown']
const attentionStates=['needs_reply','waiting_permission','needs_review','outcome_unknown','expired','unavailable','stale']
function attentionContextKey(c){return JSON.stringify([c.state,c.managed,c.activeId,c.epoch,c.accountId,c.sessionIsolation])}
function operatorAuthenticationEnded(error,captured){
 const now=operator.attentionView.bridge?.context()
 return error?.status===401&&now?.state==='blocked'&&now.code==='workspace_session_ended'&&now.epoch===captured.epoch+1&&now.managed===captured.managed&&now.activeId===captured.activeId&&now.accountId===captured.accountId&&now.sessionIsolation!==captured.sessionIsolation
}
function attentionActive(){return S.authed&&S.surface==='entries'&&entryState.role==='operator'&&entryState.page==='attention'&&(typeof configurationHost==='undefined'||configurationHost.active())}
function attentionReset(){
 const v=operator.attentionView;v.request++;v.controller?.abort();v.controller=null;v.snapshot=null;v.loaded=false;v.busy=false;v.failed=false;v.binding=null;v.key=''
 if(v.drawer){v.drawer=null;const dialog=document.getElementById('operator-task');if(dialog?.open)dialog.close();dialog?.remove()}
}
function attentionPageChanged(){
 discardStaleOperatorTask()
 const v=operator.attentionView
 if(!v.bridge&&typeof workspaceBridge==='function'){
  v.bridge=workspaceBridge()
  v.unsubscribe=v.bridge.subscribe(()=>{const changed=discardStaleOperatorTask();attentionPageChanged();if(attentionActive()||changed&&operatorTaskHostActive())render()})
 }
 const context=v.bridge?.context()
 if(!attentionActive()||context?.state!=='ready'){attentionReset();return}
 const key=attentionContextKey(context)
 if(v.key!==key){attentionReset();v.key=key;try{v.binding=v.bridge.bind(context)}catch{attentionReset();return}}
 if(!v.loaded&&!v.busy)void readAttentionProjection()
}
function attentionCurrent(binding,key){
 const v=operator.attentionView,c=v.bridge?.context()
 return attentionActive()&&c?.state==='ready'&&v.binding===binding&&v.key===key&&attentionContextKey(c)===key
}
function attentionDTO(value,offset){
 const integer=n=>Number.isSafeInteger(n)&&n>=0,time=n=>integer(n)&&n<=8.64e15,ref=s=>typeof s==='string'&&s.length>0&&s.length<=500
 const sources=['Local operator','Feishu','Slack','WeCom','GitHub','HTTP events','Delegated team','Connection']
 if(value?.schema!==1||value.readOnly!==true||!time(value.observedAt)||!integer(value.total)||value.offset!==offset||value.limit!==25||typeof value.more!=='boolean'||value.more!==(value.offset+value.limit<value.total)||!Array.isArray(value.items)||value.items.length!==Math.min(value.limit,Math.max(0,value.total-value.offset)))throw Error('attention_invalid')
 const validStates={task_question:['needs_reply','stale'],native_question:['needs_reply','expired','unavailable'],native_approval:['waiting_permission','expired','unavailable'],workflow_review:['needs_review','stale'],project_review:['needs_review','stale'],effect_unknown:['outcome_unknown']}
 const seen=new Set(),items=value.items.map(item=>{
  if(!item||!ref(item.id)||!/^([a-z_]+):[a-f0-9]{64}$/.test(item.id)||seen.has(item.id)||!attentionKinds.includes(item.kind)||!attentionStates.includes(item.state)||!validStates[item.kind]?.includes(item.state)||!sources.includes(item.sourceLabel)||!(item.createdAt===null||time(item.createdAt))||!(item.expiresAt===null||time(item.expiresAt))||typeof item.observed!=='string'||!/^[a-f0-9]{64}$/.test(item.observed)||!item.next||!['task','records','workflow','project_review'].includes(item.next.kind)||!ref(item.next.id)||item.taskRef!==undefined&&(!ref(item.taskRef?.id)||item.taskRef.assignmentId!==undefined&&!ref(item.taskRef.assignmentId)))throw Error('attention_invalid')
  seen.add(item.id)
  return {id:item.id,kind:item.kind,state:item.state,sourceLabel:item.sourceLabel,createdAt:item.createdAt,expiresAt:item.expiresAt,next:{kind:item.next.kind,id:item.next.id},...(item.taskRef?{taskRef:{id:item.taskRef.id}}:{})}
 })
 return {observedAt:value.observedAt,total:value.total,offset:value.offset,limit:value.limit,more:value.more,items}
}
async function readAttentionProjection(offset=0,expectedBinding=operator.attentionView.binding,expectedKey=operator.attentionView.key){
 const v=operator.attentionView
 if(!attentionActive()||expectedBinding&&!attentionCurrent(expectedBinding,expectedKey))return
 if(!v.binding){attentionPageChanged();return}
 if(v.busy)return
 const binding=v.binding,key=v.key,request=++v.request,controller=new AbortController()
 v.controller=controller;v.busy=true;v.loaded=true
 const current=()=>request===v.request&&!controller.signal.aborted&&attentionCurrent(binding,key)
 try{
  const raw=await binding.request('/entry-workspace/attention?offset='+offset+'&limit=25',undefined,false,binding.context.activeId,controller.signal)
  if(!current())return
  const snapshot=attentionDTO(raw,offset);v.snapshot=snapshot;v.failed=false
 }catch(error){if(operatorAuthenticationEnded(error,binding.context)){entryError(error);render()}else if(current())v.failed=true}
 finally{if(request===v.request&&v.binding===binding&&v.key===key){v.busy=false;v.controller=null;if(!attentionCurrent(binding,key))attentionReset();else if(typeof editingProjectReview==='undefined'||!editingProjectReview())render()}}
}
function attentionLabel(item){
 const kinds={task_question:['Task question','任务提问'],native_question:['Execution question','助手提问'],native_approval:['Action confirmation','操作确认'],workflow_review:['External change','外部变更'],project_review:['Project review','项目验收'],effect_unknown:['Operation record','操作记录']}
 const states={needs_reply:['Needs a reply','需要回复'],waiting_permission:['Waiting for confirmation','等待确认'],needs_review:['Needs review','等待核对'],outcome_unknown:['Outcome unknown','结果待核查'],expired:['Expired','已到期'],unavailable:['Unavailable','暂不可用'],stale:['Changed since the request','事项已变化']}
 return L(...kinds[item.kind])+' · '+L(...states[item.state])
}
function attentionSourceLabel(value){
 const labels={'Local operator':['Local operator','本地入口'],Feishu:['Feishu','飞书'],Slack:['Slack','Slack'],WeCom:['WeCom','企业微信'],GitHub:['GitHub','GitHub'],'HTTP events':['HTTP events','HTTP 事件'],'Delegated team':['Delegated team','协作团队'],Connection:['Connection','接入来源']}
 return L(...labels[value])
}
function attentionTime(value){return value===null?L('Time not recorded','未记录时间'):new Date(value).toLocaleString(lang==='en'?'en-US':'zh-CN')}
function attentionCovered(item){
 if(!['needs_reply','waiting_permission','needs_review'].includes(item.state))return false
 if(item.next.kind==='workflow')return (operator.work?.workflowActions||[]).some(p=>p.id===item.next.id)
 if(item.next.kind==='project_review')return (operator.work?.projectReviews||[]).some(p=>p.id===item.next.id)
 return !!item.taskRef&&(operator.work?.attention||[]).some(t=>t.id===item.taskRef.id)
}
function attentionStatusRows(kind,id){
 const items=operator.attentionView.snapshot?.items.filter(item=>attentionCovered(item)&&(kind==='task'?item.taskRef?.id===id:['workflow','project_review'].includes(kind)&&item.next.kind===kind&&item.next.id===id))||[]
 return items.length?add(el('ul','attention-status-lines'),...items.map(item=>el('li','',attentionLabel(item)))):null
}
function attentionTarget(item){
 if(item.next.kind==='workflow'&&(operator.work?.workflowActions||[]).some(p=>p.id===item.next.id))return 'attention-workflow-'+item.next.id
 if(item.next.kind==='project_review'&&(operator.work?.projectReviews||[]).some(p=>p.id===item.next.id))return 'attention-project-'+item.next.id
 if(item.taskRef&&(operator.work?.attention||[]).some(t=>t.id===item.taskRef.id))return 'attention-'+item.taskRef.id
 return null
}
function openAttentionRecord(item,binding,key){
 const v=operator.attentionView,currentItem=v.snapshot?.items.find(row=>row.id===item.id);if(!attentionCurrent(binding,key)||!currentItem)return
 v.focus=document.activeElement?.id||'';clearOperatorTaskView()
 v.drawer={item:currentItem,observedAt:v.snapshot.observedAt,binding,key};render()
}
function closeAttentionRecord(expected=operator.attentionView.drawer){
 const v=operator.attentionView;if(expected&&v.drawer!==expected)return
 const focus=v.focus;v.drawer=null
 const dialog=document.getElementById('operator-task');if(dialog?.open)dialog.close();dialog?.remove()
 document.getElementById(focus)?.focus({preventScroll:true})
}
function attentionRecordDialog(){
 const v=operator.attentionView,d=v.drawer;if(!d||!attentionCurrent(d.binding,d.key))return null
 const item=d.item,dialog=el('dialog','attention-record-dialog');dialog.id='operator-task';dialog.setAttribute('aria-labelledby','attention-record-title')
 const title=el('h2','',attentionLabel(item));title.id='attention-record-title'
 const body=add(el('div','drawer-body'),title,el('p','',L('Read-only record. No action is taken here.','仅查看记录，不执行操作。')),el('p','',attentionSourceLabel(item.sourceLabel)),el('p','',L('Read at: ','读取于：')+attentionTime(d.observedAt)))
 if(item.createdAt!==null)body.append(el('p','',L('Requested: ','提出于：')+attentionTime(item.createdAt)))
 if(item.expiresAt!==null)body.append(el('p','',L('Expires: ','期限：')+attentionTime(item.expiresAt)))
 if(item.state==='expired')body.append(el('p','',L('This request expired. A fresh request is needed.','此请求已到期，需要重新发起。')))
 if(item.state==='unavailable')body.append(el('p','',L('This request cannot be answered here.','此请求无法在此处理。')))
 if(item.state==='stale')body.append(el('p','',L('The original request changed. Review current facts first.','原事项已变化，请先核对当前情况。')))
 if(item.state==='outcome_unknown')body.append(el('p','',L('Check what happened before repeating any work.','请先核查实际结果，勿直接重复执行。')))
 const target=attentionTarget(item)
 if(target)body.append(opButton(L('Find existing item','定位已有事项'),()=>{
  if(!attentionCurrent(d.binding,d.key))return
  closeAttentionRecord();const node=document.getElementById(target);node?.scrollIntoView({block:'center',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});node?.focus({preventScroll:true})
 },'button'))
 const records=el('a','button',L('Open all execution records','打开全部执行记录')),url=new URL('/configure#execution-trace',location.origin)
 if(d.binding.context.managed)url.searchParams.set('workspace',d.binding.context.activeId)
 records.href=url.href;records.onclick=event=>{if(!attentionCurrent(d.binding,d.key)){event.preventDefault();return}attentionReset()};body.append(records)
 dialog.append(add(el('div','drawer-header'),el('span','',L('Record details','记录详情')),opButton(L('Close details','关闭详情'),()=>closeAttentionRecord(d),'icon-button','close')),body)
 dialog.oncancel=event=>{event.preventDefault();closeAttentionRecord(d)}
 return dialog
}
function attentionSupplement(){
 const v=operator.attentionView,binding=v.binding,key=v.key,box=el('section','attention-supplement');box.setAttribute('aria-label',L('Individual request status','逐项状态'))
 const snapshot=v.snapshot
 if(!snapshot){const phase=v.bridge?.context().state,blocked=phase!=='ready'&&phase!=='pending';const text=el('p','',blocked?L('Open an available workspace or sign in again.','请打开可用工作区，或重新登录。'):v.failed?L('Request status is unavailable. Existing items below still work.','暂时无法读取逐项状态，原有事项仍可处理。'):L('Loading request status…','正在读取逐项状态…'));text.setAttribute('role',v.failed?'alert':'status');box.append(text);if(v.failed)box.append(opButton(L('Refresh status','刷新状态'),()=>void readAttentionProjection(0,binding,key),'button'));return box}
 const time=el('time','attention-observed',L('Read at: ','读取于：')+attentionTime(snapshot.observedAt));time.dateTime=new Date(snapshot.observedAt).toISOString();box.append(time)
 if(v.failed||operator.error){const error=el('p','attention-update-failed',L('Update failed. Showing records from the time above.','更新失败，显示上述时间读取的记录。'));error.setAttribute('role','alert');box.append(error)}
 const items=snapshot.items.filter(item=>!attentionCovered(item))
 for(const [index,item] of items.entries()){
  const open=opButton(L('View record','查看记录'),()=>openAttentionRecord(item,binding,key),'button');open.id='attention-record-'+index
  box.append(add(el('article','attention-record-row'),add(el('div'),el('h3','',attentionLabel(item)),el('p','',attentionSourceLabel(item.sourceLabel)+' · '+attentionTime(item.createdAt))),open))
 }
 if(snapshot.offset||snapshot.more)box.append(add(el('div','actions'),snapshot.offset?opButton(L('Previous page','上一页'),()=>void readAttentionProjection(Math.max(0,snapshot.offset-snapshot.limit),binding,key),'button'):null,snapshot.more?opButton(L('Next page','下一页'),()=>void readAttentionProjection(snapshot.offset+snapshot.limit,binding,key),'button'):null))
 return box
}
function confirmWorkspaceAction(title, description, label, callback) {
  const dialog = el('dialog', 'workspace-confirm')
  const heading = el('h2', '', title)
  heading.id = 'workspace-confirm-title'
  dialog.setAttribute('aria-labelledby', heading.id)
  const cancel = opButton(L('Cancel', '取消'), () => WorkspaceMotion.closeDialog(dialog), 'button')
  const confirmAction = opButton(label, () => {
    WorkspaceMotion.closeDialog(dialog, callback)
  }, 'button primary')
  dialog.append(heading, el('p', '', description), add(el('div', 'actions'), cancel, confirmAction))
  dialog.onclose = () => dialog.remove()
  app.querySelector('.operator-workspace').append(dialog)
  WorkspaceMotion.openDialog(dialog)
  cancel.focus()
}
function workspaceTable(headings, values) {
  const head = add(el('thead'), add(el('tr'), ...headings.map(title => {
    const cell = el('th', '', title)
    cell.scope = 'col'
    return cell
  })))
  const body = add(el('tbody'), ...values.map(row => add(el('tr'), ...row.map((value, i) => {
    const cell = add(el('td'), value)
    cell.dataset.label = headings[i]
    return cell
  }))))
  return add(el('div', 'workspace-table'), add(el('table'), head, body))
}
function opMark(id,size=''){
  if(executionAssets[id]){
    const mark=el('span','app-mark branded '+id+' '+size),image=el('img','brand-logo')
    image.src=executionAssets[id];image.alt='';image.setAttribute('aria-hidden','true')
    mark.append(image)
    if(executionAssets[id+'Dark']){image.classList.add('brand-light');const dark=image.cloneNode();dark.src=executionAssets[id+'Dark'];dark.className='brand-logo brand-dark';mark.append(dark)}
    return mark
  }
  return add(el('span','app-mark '+id+' '+size),icon(({feishu:'message',wecom:'conversations',codex:'terminal',cursor:'pointer',vscode:'code',github:'branch',workbuddy:'spark'})[id]||'sources'))
}
function opPill(entry){const state=entry.status;return el('span','pill '+(state==='verified'?'green':state==='attention'?'amber':'neutral'),entryStateLabel(state))}
function opHeading(title,description,...buttons){
  const h=el('h1','',title);h.id='page-title';h.tabIndex=-1
  return add(el('div','page-heading'),add(el('div'),h,null),buttons.length?add(el('div','heading-actions'),...buttons):null)
}
function opSection(title,count,actionNode){return add(el('div','section-heading'),add(el('div','title-with-count'),el('h2','',title),count!=null?el('span','count',count):null),actionNode)}
function opEmpty(text){return add(el('div','workspace-empty'),icon('check'),el('p','',text))}
function opTime(at){if(!at)return '';try{return new Intl.DateTimeFormat(lang==='en'?'en':'zh-CN',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(at))}catch{return ''}}
const opTaskLabel=state=>({attention:L('Needs input','待处理'),running:L('In progress','执行中'),replied:L('Reply sent','已回传'),ready:L('Result ready','结果已就绪'),closed:L('Ended','已结束'),queued:L('Queued','已排队'),understanding:L('Understanding your request…','正在理解你的请求…')})[state]||L('Pending','等待中')
function opTaskTable(tasks) {
  if (!tasks.length) return opEmpty(L('No matching tasks.', '没有符合条件的任务。'))
  return workspaceTable(
    [L('Task', '任务'), L('Source', '入口'), L('Status', '状态'), L('Updated', '更新')],
    tasks.map(task => {
      const button = opButton(task.displayTitle||task.title, () => openOperatorTask(task.id), 'text-button')
      button.id = 'work-' + task.id
      return [
        add(el('div', 'table-title'), opMark(task.entryId), add(el('div'), button,
          task.summary ? el('small', 'hint', task.summary) : null)),
        add(el('div'), el('span', '', entryName(task.entryId)),
          task.context ? el('small', 'hint', task.context) : null),
        el('span', 'pill ' + (task.state === 'attention' ? 'amber' : task.state === 'replied' ? 'green' : task.state === 'running' ? 'blue' : 'neutral'), opTaskLabel(task.state)),
        el('time', '', opTime(task.updatedAt))
      ]
    }))
}
// UI source attribution only. This neither authorizes nor cancels an action.
function operatorTaskHostActive(){return S.authed&&S.surface==='entries'&&entryState.role==='operator'&&(typeof configurationHost==='undefined'||configurationHost.active())}
function operatorTaskProofCurrent(proof){
 const current=operator.attentionView.bridge?.context()
 return !!proof&&operatorTaskHostActive()&&entryState.page===proof.page&&current?.state==='ready'&&attentionContextKey(current)===attentionContextKey(proof.context)
}
function clearOperatorTaskView(){
 operator.drawerRequest++;operator.drawerController?.abort();operator.drawerController=null;operator.drawer=null;operator.drawerProof=null;operator.answers={}
 if(!operator.attentionView.drawer){const dialog=document.getElementById('operator-task');if(dialog?.open)dialog.close();dialog?.remove()}
}
function discardStaleOperatorTask(){
 if(!operator.drawer&&!operator.drawerProof&&!operator.drawerController)return false
 if(!operatorTaskHostActive()||operator.drawerProof&&!operatorTaskProofCurrent(operator.drawerProof)||operator.drawerTracked&&!operator.drawerProof){clearOperatorTaskView();return true}
 return false
}
async function openOperatorTask(id){
  if(entryState.busy||S.busy)return
  attentionPageChanged()
  const context=operator.attentionView.bridge?.context()
  if(!operatorTaskHostActive()||context?.state!=='ready')return
  operator.focus=document.activeElement?.id||'';clearOperatorTaskView();operator.drawerTracked=true
  const proof=Object.freeze({context:Object.freeze({...context}),page:entryState.page}),request=operator.drawerRequest,controller=new AbortController()
  operator.drawerProof=proof;operator.drawerController=controller
  const current=()=>request===operator.drawerRequest&&operator.drawerProof===proof&&!controller.signal.aborted&&operatorTaskProofCurrent(proof)
  await entryRun('work-detail',async()=>{
   try{const task=await api('/entry-workspace/task/'+encodeURIComponent(id),undefined,false,context.activeId,controller.signal);if(current()){operator.drawer=task;operator.answers={}}}catch(error){if(current()||operatorAuthenticationEnded(error,proof.context))throw error}
   finally{if(request===operator.drawerRequest){operator.drawerController=null;if(!operatorTaskProofCurrent(proof))clearOperatorTaskView()}}
  })
}
function closeOperatorTask(){
  if(operator.attentionView.drawer){closeAttentionRecord();return}
  clearOperatorTaskView()
  const dialog=document.getElementById('operator-task');if(dialog?.open)dialog.close();dialog?.remove()
  document.getElementById(operator.focus)?.focus({preventScroll:true})
}
function opAttentionCard(task) {
  const open = opButton(L('View details', '查看详情'), () => openOperatorTask(task.id), 'button')
  open.id = 'attention-' + task.id
  const label = task.deliveryUncertain
    ? L('Check delivery in the original conversation.', '请到原会话核对回传。')
    : task.approvalIds?.length
      ? L('An action needs your approval.', '有一项操作需要确认。')
      : L('Continue in the original conversation.', '请在原会话跟进。')
  return add(el('article', 'attention-item'),
    add(el('div', 'item-topline'), opMark(task.entryId, 'small'),
      el('span', '', task.context || entryName(task.entryId)), el('time', '', opTime(task.updatedAt))),
    add(el('div', 'item-heading'), el('h3', '', task.displayTitle||task.title), open),
    el('p', '', task.question || task.summary || label),attentionStatusRows('task',task.id))
}
function workflowOutcome(p){
  const states={pending:['Awaiting approval','待确认'],applying:['Submitting change…','正在提交'],applied:['Written and verified','已写入并回读'],declined:['Declined','已拒绝'],stale:['The issue changed. A new proposal is needed.','事项已变化，需要重新提案'],uncertain:['The write outcome is still unknown','写入结果仍待核对'],observed:['Target state observed. Writer unconfirmed.','已回读目标状态，写入方未确认']}
  return p.view.label+' · '+L(...states[p.state])+(p.receipt?' · '+p.receipt.revision:'')
}
function projectReviewCard(review,editable) {
  const card = add(el('article','attention-item'),el('h3','',review.title),
    el('code','',review.head),el('p','',L('Base commit','起始提交')+' '+review.base),
    el('p','',L('Passed','测试通过')+' · '+review.test.command))
  if(editable){card.id='attention-project-'+review.id;card.tabIndex=-1}const status=attentionStatusRows('project_review',review.id);if(status)card.append(status)
  if(review.diffStat)card.append(el('pre','message',review.diffStat))
  if(review.diff?.text)card.append(detail(review.diff.truncated?L('Patch preview (truncated)','补丁预览（已截断）'):L('View changes','查看改动'),el('pre','message',review.diff.text)))
  if(review.test.output)card.append(detail(L('Test output','测试输出'),el('pre','message',review.test.output)))
  const download = kind => {
    const link=el('a','text-button',kind==='patch'?L('Download patch','下载补丁'):L('Download Git bundle','下载 Git 提交包'))
    link.href=workspacePath('/project-reviews/'+review.id+'/'+kind,false,workspaceContext.activeId)
    return link
  }
  card.append(add(el('p','actions'),download('patch'),download('bundle')))
  if(review.budget?.policy.maxMinutes!==undefined)card.append(el('p','hint',L('Project time','项目用时')+' '+(review.budget.elapsedMs/60000).toFixed(1)+' / '+review.budget.policy.maxMinutes+' '+L('min','分钟')))
  if(review.budget?.estimatedUsd!==undefined)card.append(el('p','hint',L('Estimated model cost','模型估算费用')+' $'+review.budget.estimatedUsd.toFixed(4)+' / $'+review.budget.policy.cost.maxUsd))
  if(!editable)return card
  const feedback=el('textarea'),label=el('label','',L('Changes requested','退回修改意见'))
  label.htmlFor=feedback.id='feedback-'+review.id
  feedback.maxLength=4000;feedback.rows=2
  const decide=decision=>entryRun('workflow',async()=>{
    if(decision==='return'&&!feedback.value.trim()){feedback.setCustomValidity(L('Describe the requested change.','请填写修改意见。'));feedback.reportValidity();return}
    await api('/project-reviews/'+review.id,{decision,...(decision==='return'?{feedback:feedback.value.trim()}:{})})
    operator.workflowFeedback=decision==='return'?L('Returned for changes.','已退回修改。'):L('Commit approved.','已通过该提交。')
    await readOperatorWork()
  })
  feedback.addEventListener('input',()=>feedback.setCustomValidity(''))
  card.append(label,feedback,add(el('div','actions'),opButton(L('Approve commit','验收通过'),()=>decide('approve'),'button'),opButton(L('Return for changes','退回修改'),()=>decide('return'),'button')))
  return card
}
function opAttention() {
  const items = operator.work?.attention || []
  const result = [opHeading(L('Needs your attention', '待我处理'), null,
    opButton(L('Refresh', '刷新'), refreshEntries, 'button', 'refresh')),attentionSupplement()]
  for (const [label, list] of [
    [L('Needs a reply', '需要回复'), items.filter(task => !task.deliveryUncertain && !task.approvalIds?.length)],
    [L('Needs confirmation', '需要确认'), items.filter(task => task.deliveryUncertain || task.approvalIds?.length)]
  ]) if (list.length) result.push(opSection(label, list.length),
    add(el('div', 'attention-list'), ...list.map(opAttentionCard)))
  if(operator.workflowFeedback){const feedback=el('p','message',operator.workflowFeedback);feedback.setAttribute('role','status');result.push(feedback)}
  const reviews = operator.work?.projectReviews || []
  if(reviews.length)result.push(opSection(L('Code projects','代码项目验收'),reviews.length),...reviews.map(review=>projectReviewCard(review,true)))
  const proposals = operator.work?.workflowActions || []
  if (proposals.length) {
    result.push(opSection(L('External changes', '外部操作'), proposals.length))
    for (const p of proposals) {
      const card = add(el('article','attention-item'), el('h3','',p.view.label),
        el('p','',p.view.current.name+' → '+p.next.name), el('small','',p.sourceId+' · '+p.view.account))
      card.id='attention-workflow-'+p.id;card.tabIndex=-1;const status=attentionStatusRows('workflow',p.id);if(status)card.append(status)
      const decide = decision => entryRun('workflow',async()=>{
        const result=await api('/workflow-actions',{id:p.id,decision})
        operator.workflowFeedback=workflowOutcome(result)
        await readOperatorWork()
      })
      if (p.state==='pending') card.append(opButton(L('Approve','批准'),()=>decide('approve'),'button'),opButton(L('Decline','拒绝'),()=>decide('decline'),'button'))
      if (p.state==='uncertain') card.append(opButton(L('Check remote state','核对远端状态'),()=>decide('reconcile'),'button'))
      if (p.state==='applying') card.append(el('p','',L('Submitting change…','正在提交变更…')))
      result.push(card)
    }
  }
  if (operator.work&&!operator.error&&!items.length && !proposals.length && !reviews.length && operator.attentionView.snapshot?.total===0&&!operator.attentionView.failed&&!operator.attentionView.busy&&attentionCurrent(operator.attentionView.binding,operator.attentionView.key)) result.push(opEmpty(L('No pending decisions.', '暂无待处理事项。')))
  return result
}
function opTasks() {
  const history = entryState.page === 'activity'
  const data = operator.work
  const result = [opHeading(L('Tasks', '任务'), null,
    opButton(L('Refresh', '刷新'), refreshEntries, 'button', 'refresh')),
    workspaceTabs(L('Task views', '任务视图'), [
      [L('In progress', '进行中'), !history, () => opNavigate('active-tasks')],
      [L('Work history', '任务记录'), history, () => opNavigate('activity')]
    ])]
  if (!history) {
    const tasks = data?.activeTasks || []
    for (const request of data?.understanding || [])
      result.push(add(el('p', 'understanding-request'),
        el('strong', '', L('Understanding your request…', '正在理解你的请求…')), el('span', '', request.title)))
    result.push(tasks.length ? opTaskTable(tasks) : opEmpty(L('No running work.', '暂无运行中的任务。')))
    if (data?.activeTotal > tasks.length) result.push(opButton(L('Search all work', '查看全部任务'), () => opNavigate('activity'), 'text-button'))
    return result
  }
  const search = el('input')
  search.type = 'search'
  search.id = 'task-search'
  search.maxLength = 200
  search.value = operator.historySearch
  search.placeholder = L('Search tasks', '搜索任务')
  search.setAttribute('aria-label', search.placeholder)
  const state = el('select')
  state.id = 'task-state'
  state.setAttribute('aria-label', L('Task status', '任务状态'))
  state.add(new Option(L('All states', '全部状态'), ''))
  for (const value of ['running', 'queued', 'attention', 'ready', 'replied', 'closed'])
    state.add(new Option(opTaskLabel(value), value))
  state.value = operator.historyState
  const find = opButton(L('Search', '搜索'), null, 'button')
  find.type = 'submit'
  const form = add(el('form', 'workspace-search'), search, state, find)
  form.onsubmit = event => {
    event.preventDefault()
    operator.historySearch = search.value.trim()
    operator.historyState = state.value
    operator.offset = 0
    void entryRun('work-page', readOperatorWork)
  }
  state.onchange = () => form.requestSubmit()
  const page = offset => entryRun('work-page', async () => {
    operator.offset = offset
    await readOperatorWork()
  })
  result.push(form, opTaskTable(data?.tasks || []),
    add(el('div', 'actions'),
      operator.offset ? opButton(L('Previous', '上一页'), () => page(Math.max(0, operator.offset - 25)), 'button') : null,
      data?.more ? opButton(L('Next', '下一页'), () => page(operator.offset + 25), 'button') : null))
  return result
}
function opCatalogue(){
  if(entryState.page==='catalog')return controlConnectionsPage()
  const entries=entryState.data.entries,groups=[['all',L('All software','全部软件')],['connected',L('Connected','已接入')],['team',L('Team collaboration','团队协作')],['client',L('AI clients','开发工具')]]
  const matches=(e,filter)=>filter==='all'||filter==='connected'&&e.status!=='not-configured'||filter==='team'&&e.category!=='client'||filter==='client'&&e.category==='client'
  const tabs=el('div','tabs');tabs.setAttribute('role','group');tabs.setAttribute('aria-label',L('Software category','软件分类'))
  for(const [id,label]of groups){const b=opButton('',()=>{operator.filter=id;render()},'tab');b.setAttribute('aria-pressed',String(operator.filter===id));b.replaceChildren(el('span','',label),el('span','',entries.filter(e=>matches(e,id)).length));tabs.append(b)}
  const input=el('input');input.type='search';input.id='operator-search';input.value=operator.search;input.placeholder=L('Search software…','搜索软件…');input.setAttribute('aria-label',L('Search software','搜索软件'))
  const grid=el('div','integration-grid');grid.id='operator-catalogue'
  const cards=()=>{const visible=entries.filter(e=>matches(e,operator.filter)&&(entryName(e)+' '+e.id).toLowerCase().includes(operator.search.toLowerCase()));grid.replaceChildren(...(visible.length?visible.map(e=>{const card=opButton('',()=>controlNewConnection(e.id),'integration-card');card.replaceChildren(add(el('div','integration-card-header'),opMark(e.id,'large'),el('h3','',entryName(e)),opPill(e)),el('p','',entryDescription(e.id)),add(el('div','integration-card-bottom'),el('span','',e.usage?.location||(e.category==='client'?L('Personal host connection','宿主个人连接'):L('Connect to your team','接入团队会话'))),icon('arrow')));return card}):[el('p','no-results',L('No matching software. Try another name.','没有找到匹配的软件，请换个名称搜索。'))]))}
  input.oninput=()=>{operator.search=input.value;cards()};cards()
  return [opButton(L('Software connections','软件接入'),()=>opNavigate('catalog'),'back-link','arrow'),
    opHeading(L('New connection','新建接入'),null),
    tabs,add(el('div','toolbar'),add(el('label','search-field'),icon('search'),input)),grid,
    entryState.share?entryShareResult():null]
}
function opModels(){ return controlModels() }
function opConnection() {
  if (entryState.selected === 'source') {
    const source = S.base.config.sources.find(item => item.id === entryState.source)
    if (source) return [
      opButton(L('Software connections', '软件接入'), () => opNavigate('catalog'), 'back-link', 'arrow'),
      opHeading(source.kind === 'local' ? L('Local assistant', '本机助手') : source.id, null),
      sourceSettings(source.id)
    ]
  }
  const entry = selectedEntry()
  if (!entry) return entryDetail()
  const source = (entry.sources || []).find(item => item.id === entryState.source) || entry.sources?.find(item => item.enabled) || entry.sources?.[0]
  const name = entryState.creating
    ? L('New ' + entryName(entry) + ' connection', '新建' + entryName(entry) + '接入')
    : source?.label || entryName(entry)
  const heading = opHeading(name, null)
  heading.querySelector('h1').prepend(opMark(entry.id, 'large'))
  heading.querySelector('h1').classList.add('platform-title')
  const content = entryDetail().slice(3)
  const permissions = !entryState.creating && source ? sourceSettings(source.id) : null
  const setup = permissions
    ? detail(L('Connection setup and verification', '接入配置与验证'), add(el('div', 'connection-form'), ...content))
    : add(el('div', 'connection-form'), ...content)
  if (permissions && (entryState.probe || entryState.plan || entryState.applied || entryState.verification?.stages?.some(item => item.status !== 'ok'))) setup.open = true
  const evidence = source ? panel(L('Connection evidence', '连接验证'),
    rows(
      datum(L('Platform', '平台'), entryName(entry)),
      datum(L('Verification', '验证状态'), source.enabled === false ? L('Disabled', '已停用') :
        source.verification?.verified ? L('Verified', '已验证') : L('Awaiting verification', '待验证')),
      datum(L('Listening scope', '监听范围'), connectionScope(entry, source) || notReported())
    )) : null
  const steps = el('ol', 'flow-nav')
  for (const [label, done] of [
    [L('Check existing prerequisites', '检查已有条件'), entryState.probe?.checks?.every(check => check.status === 'ok')],
    [L('Add required settings', '补充所需设置'), !entryState.creating && !!source],
    [L('Save the connection', '保存接入'), !entryState.creating && !!source],
    [L('Verify in the original software', '在原软件验证'), source?.verification?.verified || entry.status === 'verified']
  ]) steps.append(add(el('li', done ? 'complete' : ''), icon(done ? 'check' : 'message'), el('span', '', label)))
  return [
    opButton(L('Software connections', '软件接入'), () => opNavigate('catalog'), 'back-link', 'arrow'),
    heading,
    add(el('div', 'detail-layout'), add(el('div', 'settings-stack'), permissions, setup),
      add(el('aside', 'flow-aside'), evidence || add(el('section', 'side-panel'),
        opSection(L('Connection steps', '接入步骤')), steps)))
  ]
}
function opUsage() {
  const configured = entryState.data.entries.filter(entry => entry.status !== 'not-configured')
  const steps = [
    [L('Find your entry', '找到入口'), L('Open a connected chat or client and find the assistant there.', '打开已接入的会话或客户端，在那里找到助手。')],
    [L('Send a request', '交代任务'), L('Describe the work and the result you need.', '说明要做的事和你希望得到的结果。')],
    [L('Continue in the same conversation', '在原会话跟进'), L('Add context and collect the result in the original conversation.', '在原会话补充信息并接收结果。')]
  ]
  const list = add(el('ol', 'usage-steps'), ...steps.map(([title, text]) =>
    add(el('li'), el('h2', '', title), el('p', 'hint', text))))
  const connections = panel(L('Connected entries', '已接入的入口'),
    ...configured.map(entry => detail(entryName(entry), add(el('div', 'stack'),
      entry.usage?.location ? el('strong', '', entryText(entry.usage.location)) : null,
      entry.usage?.howToUse ? el('p', '', entryText(entry.usage.howToUse)) : null,
      entry.usage?.openUrl ? entryLink(L('Open ', '打开 ') + entryName(entry), entry.usage.openUrl, 'button') : null
    ))),
    configured.length ? null : opButton(L('Connect software', '接入软件'), () => opNavigate('catalogue'), 'button'))
  return [
    opHeading(L('Usage guide', '使用指引'), null,
      opButton(L('Open shared instructions', '打开共享使用说明'), () => chooseEntryRole('user'), 'button'),
      configured.length ? opButton(L('Prepare usage instructions', '生成使用说明'),
        () => shareEntries(configured.map(entry => entry.id)), 'button primary') : null),
    add(el('div', 'settings-with-aside guide-layout'), list, connections),
    entryState.share ? entryShareResult() : null
  ]
}
function setOperatorMenu(open){
  operator.menu=open;const rail=document.getElementById('operator-sidebar'),shell=document.querySelector('.operator-workspace'),main=document.querySelector('.operator-workspace .main-shell'),toggle=document.getElementById('operator-menu')
  document.body.classList.toggle('operator-menu-open',open)
  rail?.classList.toggle('open',open);shell?.classList.toggle('menu-open',open);toggle?.setAttribute('aria-expanded',String(open));if(main)main.inert=open
  if(open)document.getElementById('operator-menu-close')?.focus();else toggle?.focus()
}
function opTaskDialog(){
  if(operator.attentionView.drawer)return attentionRecordDialog()
  discardStaleOperatorTask()
  const task=operator.drawer;if(!task)return null
  const currentProof=operatorTaskProofCurrent(operator.drawerProof)
  const dialog=el('dialog');dialog.id='operator-task';dialog.setAttribute('aria-labelledby','operator-task-title')
  const title=el('h2','',task.displayTitle||task.title);title.id='operator-task-title'
  const body=add(el('div','drawer-body'),opMark(task.entryId,'large'),title,el('p','',task.context||entryName(task.entryId)),add(el('dl','drawer-meta'),el('dt','',L('State','当前状态')),el('dd','',opTaskLabel(task.state)),el('dt','',L('Source software','来源软件')),el('dd','',entryName(task.entryId)),el('dt','',L('Follow up','后续结果')),el('dd','',L('In the original conversation','返回发起任务的原会话'))),add(el('div','message'),el('small','',L('Original request','原始请求')),el('p','',task.message)))
  for(const [label,value]of [[L('Assistant needs your input','助手需要你补充'),task.question],[L('Latest progress','最新进展'),task.summary===task.question?'':task.summary],[L('Actual reply','实际回复'),task.result]])if(value)body.append(add(el('div','message'),el('small','',label),el('p','',value)))
  if(task.resultTruncated)body.append(el('p','flow-help',L('This result is shortened. Read the complete resource in advanced controls.','结果较长，此处已缩短。可在完整任务控制台读取全文。')))
  if(task.deliveryUncertain)body.append(el('p','alert warning',L('Delivery is uncertain. Inspect the original conversation before retrying.','回传结果不确定，请先核对原会话，再决定是否重试。')))
  if(task.acceptedGoal){const link=el('a','button',L('Save as a skill','保存为技能'));link.href='/router-proactive?'+new URLSearchParams({goal:task.acceptedGoal.id,scope:task.acceptedGoal.scopeId});body.append(link)}
  if(task.projectReview)body.append(projectReviewCard(task.projectReview,false))
  if(task.artifacts?.length){
    body.append(el('h3','',L('File versions','文件版本')))
    for(const file of task.artifacts){
      const link=el('a','text-button',file.path+' · v'+file.version+' · '+(file.size/1024).toFixed(1)+' KiB · '+file.sha256.slice(0,12))
      link.href='/goal-artifacts/'+encodeURIComponent(file.id)
      body.append(add(el('p'),link))
    }
  }
  for(const change of task.workflowActions||[])body.append(el('p','message',workflowOutcome(change)+' · '+change.view.current.name+' → '+change.next.name))
  for(const approval of task.approvals||[])body.append(opApproval(approval))
  if(typeof taskContractCard==='function')body.append(taskContractCard(currentProof?task.contractView:undefined,task.id))
  if(task.model)body.append(el('p','task-model',L('Execution model: ','执行模型：')+task.model))
  body.append(add(el('div','drawer-actions'),task.sourceUrl?entryLink(L('Open original conversation','打开原讨论'),task.sourceUrl,'button primary'):null,task.canStop?opButton(L('Stop task','停止任务'),()=>controlTaskAction('stop',task.id),'button'):null,task.canRetry?opButton(L('Retry after review','核对后重试'),()=>controlTaskAction('retry',task.id),'button'):null))

  dialog.append(add(el('div','drawer-header'),el('span','',L('Work details','任务详情')),opButton(L('Close details','关闭详情'),closeOperatorTask,'icon-button','close')),body)
  dialog.oncancel=event=>{event.preventDefault();closeOperatorTask()};dialog.onclick=event=>{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)closeOperatorTask()}}
  return dialog
}
function opApproval(approval){
  const box=add(el('section','message'),el('h3','',L('Approval requested','等待你的确认'))),request=approval.request||{}
  if(approval.method==='item/tool/requestUserInput'){
    const form=el('form','entry-form')
    for(const question of request.questions||[]){const label=el('label','',question.question||question.header||L('Your answer','你的回答'));const input=el(question.isSecret?'input':'textarea');if(question.isSecret){input.type='password';input.autocomplete='off'}input.required=true;input.id='approval-'+approval.id+'-'+question.id;input.value=operator.answers[input.id]||'';input.oninput=()=>{operator.answers[input.id]=input.value};label.append(input);form.append(label);if(question.options?.length)form.append(el('p','hint',question.options.map(o=>o.label).join(' · ')))}
    const submit=opButton(L('Submit answers','提交回答'),null,'button primary');submit.type='submit';form.append(submit);form.onsubmit=event=>{event.preventDefault();const answers=Object.fromEntries((request.questions||[]).map(q=>[q.id,{answers:[operator.answers['approval-'+approval.id+'-'+q.id]||'']} ]));void answerOperatorApproval(approval.id,answers)};box.append(form)
  }else{
    box.append(detail(L('Review the requested action','核对所请求的操作'),raw(request)),el('p','flow-help',L('Approval applies to this exact pending request.','仅确认当前这一条待审批请求。')),add(el('div','actions'),opButton(L('Approve once','批准这一次'),()=>answerOperatorApproval(approval.id,'accept'),'button primary'),opButton(L('Decline','拒绝'),()=>answerOperatorApproval(approval.id,'decline'),'button')))
  }
  return box
}
async function answerOperatorApproval(id,answer){await entryRun('approval',async()=>{await api('/approval',{id,answer});operator.drawer=await api('/entry-workspace/task/'+encodeURIComponent(operator.drawer.id));await readOperatorWork()})}
function renderOperatorWorkspace(){
  if(typeof configurationHost === 'undefined' || !configurationHost || configurationHost.active()) document.title=(opPages()[entryState.page]||opPages().home)+' · Roppo'
  const root=el('div','operator-workspace'),shell=el('div','app-shell'),rail=el('aside','sidebar');rail.id='operator-sidebar';rail.setAttribute('aria-label',L('Workspace navigation','工作台导航'))
  const close=opButton(L('Close navigation','关闭导航'),()=>setOperatorMenu(false),'icon-button sidebar-close','close');close.id='operator-menu-close'
  rail.append(add(el('div','brand'),el('span','roppo-brand-mark'),el('span','','Roppo'),el('span','version',S.health?.version||'0.10')),close,workspaceTrigger())
  const nav=el('nav');nav.setAttribute('aria-label',L('Main navigation','主导航'))
  const chatLink=add(el('a','operator-nav-link'),icon('prompts'),el('span','',L('Conversations','对话')));chatLink.href='/chat';nav.append(chatLink)
  for(const [page,glyph]of [['home','overview'],['activity','work'],['attention','inbox'],['execution','execution'],['models','cpu'],['deployments','monitor'],['catalog','sources'],['integrations','work'],['prompts','prompts']]){
    if(page==='execution')nav.append(el('span','nav-group',L('Configuration','配置')))
    const b=opButton('',()=>opNavigate(page,'',page==='execution'?{view:'configuration'}:undefined),'operator-nav-link');b.replaceChildren(icon(glyph),el('span','',opPages()[page]));if(page===entryState.page||page==='activity'&&entryState.page==='active-tasks'||page==='catalog'&&['detail','catalogue'].includes(entryState.page)||page==='models'&&entryState.page==='model-new')b.setAttribute('aria-current','page');if(page==='attention'&&operator.work?.attentionTotal)b.append(el('span','nav-count',operator.work.attentionTotal));nav.append(b)
  }
  const host=add(el('div','host-mini'),el('span','status-dot'),add(el('div'),el('strong','',L('Management host','管理宿主')),el('span','',location.host)),icon('monitor'))
  const guideLink = opButton(L('Usage guide','使用指引'),()=>opNavigate('usage'),'utility-link','book')
  const webhookLink=el('a','operator-nav-link',L('Event automations','事件自动化'));webhookLink.href='/configure#automations';nav.append(webhookLink)
  const routerScopeLink=el('a','operator-nav-link',L('Router management','Router 管理'));routerScopeLink.href='/router-management';nav.append(routerScopeLink)
  const settingsLink = opButton(L('Settings','设置'),()=>opNavigate('advanced'),'utility-link','advanced')
  if (entryState.page === 'advanced') settingsLink.setAttribute('aria-current','page')
  if (entryState.page === 'usage') guideLink.setAttribute('aria-current','page')
  const owner = entryState.account?.user
  const profile = add(el(owner ? 'a' : 'div','profile'),el('span','profile-avatar',owner?.displayName?.slice(0,1).toUpperCase() || 'R'),add(el('div'),el('strong','',owner?.displayName || L('Operator','操作员')),el('span','',owner ? L('Your account','你的账号') : L('Manage this deployment','管理此部署'))))
  if (owner) { profile.href='/account'; profile.setAttribute('aria-label',L('Your account','你的账号')) }
  rail.append(nav,add(el('div','sidebar-bottom'),host,guideLink,settingsLink,profile))
  const toggle=opButton(L('Open navigation','打开导航'),()=>setOperatorMenu(true),'icon-button mobile-menu','menu');toggle.id='operator-menu';toggle.setAttribute('aria-expanded',String(operator.menu));toggle.setAttribute('aria-controls','operator-sidebar')
  const top=add(el('header','topbar'),add(el('div','breadcrumb'),toggle,el('span','',workspaceName()),el('span','slash','/'),el('strong','',opPages()[entryState.page]||opPages().home)),add(el('div','topbar-tools'),themeToggle(),languagePicker(),opButton(L('Refresh','刷新'),refreshEntries,'icon-button','refresh'),opButton(L('New conversation','新建会话'),()=>{location.href='/chat'},'text-button')))
  const main=el('main');main.id='main';main.tabIndex=-1
  if(entryState.data?.preview)main.append(el('p','alert warning',L('Isolated preview: installation and external execution are unavailable.','隔离预览：安装和外部执行不可用。')))
  if(entryState.error){const error=add(el('div','alert error'),el('p','',L(...entryState.error.text)),entryState.error.detail?detail(L('Details','详情'),raw(entryState.error.detail)):null,opButton(L('Refresh','刷新'),refreshEntries,'button'));error.id='entry-error';error.tabIndex=-1;error.setAttribute('role','alert');main.append(error)}
  if(operator.error)main.append(add(el('div','alert warning'),el('p','',L('Work status could not be loaded. Existing values may be outdated.','任务状态未能读取，已有数据可能已过时。')),opButton(L('Refresh','刷新'),refreshEntries,'button')))
  const content=el('fieldset','operator-body');content.disabled=!!entryState.busy||!!S.busy
  const views = {
    home: workspaceHome, activity: opTasks, 'active-tasks': opTasks, attention: opAttention, catalog: opCatalogue, catalogue: opCatalogue,
    detail: opConnection, models: opModels, 'model-new': opModels, execution: controlExecution,
    deployments: renderDeployments, integrations: controlIntegrations, prompts: controlPrompts, usage: opUsage, advanced: renderWorkspaceSettings
  }
  if (S.latest) main.append(conflictPanel())
  if (entryState.page === 'advanced' && S.statusError) main.append(el('p','alert warning',L('Host status is unavailable. Refresh in Host status.','宿主状态暂不可用，请在宿主状态中刷新。')))
  const ready = S.authed && S.base
  const waitingForEntries = needsEntryInventory() && !entryState.data
  const waitingForWork = ['home','activity','active-tasks','attention'].includes(entryState.page) && !operator.work && !operator.error
  if (!ready || waitingForEntries || waitingForWork) {
    const failed = !entryState.loading && !ready || waitingForEntries && entryState.inventoryError
    const state = el('div', 'workspace-page-loading')
    state.append(opHeading(opPages()[entryState.page] || opPages().home, null))
    const label = el('p', failed ? 'workspace-load-error' : 'workspace-loading', failed ? L('Couldn’t load this page.', '页面加载失败。') : L('Loading…', '加载中…'))
    label.setAttribute('role', failed ? 'alert' : 'status');state.append(label)
    if (failed) state.append(opButton(L('Retry', '重试'), () => ready ? refreshEntries() : startEntrySession(), 'button'))
    content.append(state)
  } else content.append(...(views[entryState.page] || opTasks)().filter(Boolean))
  main.append(content)
  if (S.notice || S.busy && S.busy !== 'connect') main.prepend(noticeView())
  if (entryState.busy) main.append(el('p','entry-progress',L('Working…','正在处理…')))
  const savebar = el('div', 'savebar')
  savebar.id = 'savebar'
  savebar.hidden = document.getElementById('savebar')?.hidden ?? true
  if(typeof configurationHost !== 'undefined' && configurationHost) {
    const dialog=opTaskDialog()
    root.append(main,savebar)
    if(dialog)root.append(dialog)
    app.replaceChildren(root)
    updateBar()
    if(dialog && configurationHost.active())dialog.showModal()
    return
  }
  const body = add(el('div','main-shell'),top,main,savebar)
  const scrim=opButton(L('Close navigation background','关闭导航背景'),()=>setOperatorMenu(false),'nav-scrim')
  shell.append(rail,scrim,body);const skip=el('a','skip',L('Skip to content','跳至主要内容'));skip.href='#main';root.append(skip,shell);const dialog=opTaskDialog();if(dialog)root.append(dialog);app.replaceChildren(root)
  updateBar()
  if(dialog)dialog.showModal()
  if(operator.menu)setOperatorMenu(true)
}
document.addEventListener('keydown',event=>{
  if(!operator.menu)return
  if(event.key==='Escape'){event.preventDefault();setOperatorMenu(false)}
  if(event.key==='Tab'){const items=[...document.querySelectorAll('#operator-sidebar button:not(:disabled),#operator-sidebar a[href]')].filter(n=>n.getClientRects().length);const first=items[0],last=items.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus()}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus()}}
})
const editingProjectReview=()=>[...document.querySelectorAll('textarea[id^="feedback-"]')].some(field=>field===document.activeElement||field.value.trim())
let operatorPolling=false
setInterval(async()=>{
  if(operatorPolling||document.hidden||S.surface!=='entries'||!S.authed||entryState.role!=='operator'||entryState.busy||S.busy||operator.drawer||operator.attentionView.drawer||operator.menu||!['home','attention','activity','active-tasks'].includes(entryState.page))return
  if(entryState.page==='attention'&&editingProjectReview())return
  const page=entryState.page,previous=JSON.stringify([operator.work?.projectReviews,operator.work?.workflowActions,operator.work?.tasks,operator.work?.activeTasks,operator.work?.activeTotal,operator.work?.attention,operator.work?.understanding,operator.work?.paused,operator.work?.active,operator.error])
  operatorPolling=true
  try{await readOperatorWork();if(S.surface==='entries'&&page===entryState.page&&!operator.drawer&&!operator.menu&&!entryState.busy&&!editingProjectReview()&&previous!==JSON.stringify([operator.work?.projectReviews,operator.work?.workflowActions,operator.work?.tasks,operator.work?.activeTasks,operator.work?.activeTotal,operator.work?.attention,operator.work?.understanding,operator.work?.paused,operator.work?.active,operator.error]))render()}
  finally{operatorPolling=false}
},10000)
window.addEventListener('resize',()=>{if(operator.menu&&window.innerWidth>700)setOperatorMenu(false)})
