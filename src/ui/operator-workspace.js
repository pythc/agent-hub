// The expert's operator composition, connected to the existing same-origin host.
const operator = {work:null,error:false,filter:'all',search:'',menu:false,drawer:null,answers:{},focus:'',offset:0,historySearch:'',historyState:''}
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
  activity: L('Tasks', '任务'), catalog: L('Conversation entries', '会话入口'),
  catalogue: L('New connection', '新建接入'), detail: entryName(entryState.selected),
  models: L('Model connections', '模型连接'), 'model-new': L('New model connection', '新建模型连接'),
  integrations: L('Tools and apps', '工具与应用'), execution: L('Agent team', 'Agent 团队'), prompts: L('Shared instructions', '共享指令'),
  usage: L('Usage guide', '使用指引'), advanced: L('Advanced settings', '高级设置')
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
  } catch (error) {
    if (error.payload?.code === 'workspace_obsolete') return
    operator.error = true
    if (error.status === 401) throw error
  }
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
      const button = opButton(task.title, () => openOperatorTask(task.id), 'text-button')
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
async function openOperatorTask(id){
  operator.focus=document.activeElement?.id||''
  await entryRun('work-detail',async()=>{operator.drawer=await api('/entry-workspace/task/'+encodeURIComponent(id));operator.answers={}})
}
function closeOperatorTask(){
  operator.drawer=null
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
    add(el('div', 'item-heading'), el('h3', '', task.title), open),
    el('p', '', task.question || task.summary || label))
}
function opAttention() {
  const items = operator.work?.attention || []
  const result = [opHeading(L('Needs your attention', '待我处理'), null,
    opButton(L('Refresh', '刷新'), refreshEntries, 'button', 'refresh'))]
  for (const [label, list] of [
    [L('Needs a reply', '需要回复'), items.filter(task => !task.deliveryUncertain && !task.approvalIds?.length)],
    [L('Needs confirmation', '需要确认'), items.filter(task => task.deliveryUncertain || task.approvalIds?.length)]
  ]) if (list.length) result.push(opSection(label, list.length),
    add(el('div', 'attention-list'), ...list.map(opAttentionCard)))
  if (!items.length) result.push(opEmpty(L('No pending decisions.', '暂无待处理事项。')))
  return result
}
function opTasks() {
  const history = entryState.page === 'activity'
  const data = operator.work
  const result = [opHeading(L('Tasks', '任务'), null,
    opButton(L('Refresh', '刷新'), refreshEntries, 'button', 'refresh')),
    workspaceTabs(L('Task views', '任务视图'), [
      [L('In progress', '进行中'), !history, () => opNavigate('home')],
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
  const task=operator.drawer;if(!task)return null
  const dialog=el('dialog');dialog.id='operator-task';dialog.setAttribute('aria-labelledby','operator-task-title')
  const title=el('h2','',task.title);title.id='operator-task-title'
  const body=add(el('div','drawer-body'),opMark(task.entryId,'large'),title,el('p','',task.context||entryName(task.entryId)),add(el('dl','drawer-meta'),el('dt','',L('State','当前状态')),el('dd','',opTaskLabel(task.state)),el('dt','',L('Source software','来源软件')),el('dd','',entryName(task.entryId)),el('dt','',L('Follow up','后续结果')),el('dd','',L('In the original conversation','返回发起任务的原会话'))),add(el('div','message'),el('small','',L('Original request','原始请求')),el('p','',task.message)))
  for(const [label,value]of [[L('Assistant needs your input','助手需要你补充'),task.question],[L('Latest progress','最新进展'),task.summary===task.question?'':task.summary],[L('Actual reply','实际回复'),task.result]])if(value)body.append(add(el('div','message'),el('small','',label),el('p','',value)))
  if(task.resultTruncated)body.append(el('p','flow-help',L('This result is shortened. Read the complete resource in advanced controls.','结果较长，此处已缩短。可在完整任务控制台读取全文。')))
  if(task.deliveryUncertain)body.append(el('p','alert warning',L('Delivery is uncertain. Inspect the original conversation before retrying.','回传结果不确定，请先核对原会话，再决定是否重试。')))
  for(const approval of task.approvals||[])body.append(opApproval(approval))
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
  for(const [page,glyph]of [['home','overview'],['activity','work'],['attention','inbox'],['execution','execution'],['models','cpu'],['catalog','sources'],['integrations','work'],['prompts','prompts']]){
    if(page==='execution')nav.append(el('span','nav-group',L('Configuration','配置')))
    const b=opButton('',()=>opNavigate(page,'',page==='execution'?{view:'configuration'}:undefined),'operator-nav-link');b.replaceChildren(icon(glyph),el('span','',opPages()[page]));if(page===entryState.page||page==='catalog'&&['detail','catalogue'].includes(entryState.page)||page==='models'&&entryState.page==='model-new')b.setAttribute('aria-current','page');if(page==='attention'&&operator.work?.attentionTotal)b.append(el('span','nav-count',operator.work.attentionTotal));nav.append(b)
  }
  const host=add(el('div','host-mini'),el('span','status-dot'),add(el('div'),el('strong','',L('Management host','管理宿主')),el('span','',location.host)),icon('monitor'))
  const guideLink = opButton(L('Usage guide','使用指引'),()=>opNavigate('usage'),'utility-link','book')
  const webhookLink=el('a','operator-nav-link',L('Webhooks','事件自动化'));webhookLink.href='/webhook-workbench';nav.append(webhookLink)
  const routerScopeLink=el('a','operator-nav-link',L('Router and memory','Router 与记忆'));routerScopeLink.href='/router-management';nav.append(routerScopeLink)
  const settingsLink = opButton(L('Advanced settings','高级设置'),()=>opNavigate('advanced'),'utility-link','advanced')
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
    home: workspaceHome, activity: opTasks, attention: opAttention, catalog: opCatalogue, catalogue: opCatalogue,
    detail: opConnection, models: opModels, 'model-new': opModels, execution: controlExecution,
    integrations: controlIntegrations, prompts: controlPrompts, usage: opUsage, advanced: renderWorkspaceSettings
  }
  if (S.latest) main.append(conflictPanel())
  if (entryState.page === 'advanced' && S.statusError) main.append(el('p','alert warning',L('Host status is unavailable. Refresh in Host status.','宿主状态暂不可用，请在宿主状态中刷新。')))
  const ready = S.authed && S.base
  const waitingForEntries = needsEntryInventory() && !entryState.data
  const waitingForWork = ['home','activity','attention'].includes(entryState.page) && !operator.work && !operator.error
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
let operatorPolling=false
setInterval(async()=>{
  if(operatorPolling||document.hidden||S.surface!=='entries'||!S.authed||entryState.role!=='operator'||entryState.busy||S.busy||operator.drawer||operator.menu||!['home','attention','activity'].includes(entryState.page))return
  const page=entryState.page,previous=JSON.stringify([operator.work?.tasks,operator.work?.attention,operator.work?.understanding,operator.work?.paused,operator.work?.active,operator.error])
  operatorPolling=true
  try{await readOperatorWork();if(S.surface==='entries'&&page===entryState.page&&!operator.drawer&&!operator.menu&&!entryState.busy&&previous!==JSON.stringify([operator.work?.tasks,operator.work?.attention,operator.work?.understanding,operator.work?.paused,operator.work?.active,operator.error]))render()}
  finally{operatorPolling=false}
},10000)
window.addEventListener('resize',()=>{if(operator.menu&&window.innerWidth>700)setOperatorMenu(false)})
