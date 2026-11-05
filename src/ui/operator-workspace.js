// The expert's operator composition, connected to the existing same-origin host.
const operator = {work:null,error:false,filter:'all',search:'',menu:false,drawer:null,answers:{},focus:'',offset:0}
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
const opPages=()=>({home:L('Workspace','工作台'),attention:L('Needs your attention','待我处理'),activity:L('Work history','任务记录'),catalog:L('Connected software','接入软件'),detail:entryName(entryState.selected),models:L('AI services','模型服务'),usage:L('Usage guide','使用指引')})
function opButton(text,callback,kind='button',glyph){const button=action(text,callback,kind,glyph);if(kind.includes('icon-button')&&glyph){button.setAttribute('aria-label',text);button.title=text;button.replaceChildren(icon(glyph))}return button}
function opNavigate(page,id){if(operator.menu)setOperatorMenu(false);operator.drawer=null;entryNavigate(page,id)}
async function readOperatorWork(){
  try{operator.work=await api('/entry-workspace?offset='+operator.offset);operator.error=false}
  catch(error){operator.error=true;if(error.status===401)throw error}
}
function opMark(id,size=''){
  return add(el('span','app-mark '+id+' '+size),icon(({feishu:'message',wecom:'conversations',codex:'terminal',cursor:'pointer',vscode:'code',github:'branch',workbuddy:'spark'})[id]||'sources'))
}
function opPill(entry){const state=entry.status;return el('span','pill '+(state==='verified'?'green':state==='attention'?'amber':'neutral'),entryStateLabel(state))}
function opHeading(title,description,...buttons){
  const h=el('h1','',title);h.id='page-title';h.tabIndex=-1
  return add(el('div','page-heading'),add(el('div'),h,description?el('p','',description):null),buttons.length?add(el('div','heading-actions'),...buttons):null)
}
function opSection(title,count,actionNode){return add(el('div','section-heading'),add(el('div','title-with-count'),el('h2','',title),count!=null?el('span','count',count):null),actionNode)}
function opEmpty(text){return add(el('div','workspace-empty'),icon('check'),el('p','',text))}
function opTime(at){if(!at)return '';try{return new Intl.DateTimeFormat(lang==='en'?'en':'zh-CN',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(at))}catch{return ''}}
const opTaskLabel=state=>({attention:L('Needs input','待处理'),running:L('In progress','执行中'),replied:L('Reply sent','已回传'),ready:L('Result ready','结果已就绪'),closed:L('Ended','已结束'),queued:L('Queued','已排队'),understanding:L('Understanding your request…','正在理解你的请求…')})[state]||L('Pending','等待中')
function opTaskRow(task){
  const row=opButton('',()=>openOperatorTask(task.id),'task-row');row.id='work-'+task.id
  row.replaceChildren(opMark(task.entryId),add(el('span'),el('span','row-title',task.title),el('span','row-meta',entryName(task.entryId)+' · '+(task.summary||opTime(task.updatedAt)))),add(el('span','task-state '+(task.state==='replied'?'done':task.state==='running'?'running':'')),el('i','state-ring'),el('span','',opTaskLabel(task.state))),icon('forward'))
  return row
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
function opAttentionCard(task){
  const open=opButton(L('View details','查看详情'),()=>openOperatorTask(task.id),'button','arrow');open.id='attention-'+task.id
  return add(el('article','attention-item'),add(el('div','item-topline'),opMark(task.entryId,'small'),el('span','',task.context||entryName(task.entryId)),el('time','',opTime(task.updatedAt))),add(el('div','item-heading'),el('h3','',task.title),el('span','pill amber',L('Needs input','需要处理'))),el('p','',task.question||task.summary||L('Review the task details before continuing.','请先查看任务详情再继续。')),add(el('div','item-footer'),el('span','',L('Follow up in the original conversation.','继续在原会话补充或确认。')),open))
}
function opSideColumn(){
  const entries=entryState.data.entries.filter(e=>e.status!=='not-configured'),backend=entryState.data.backend
  const connections=add(el('section','side-panel'),add(el('div','panel-header'),icon('sources'),el('h2','',L('Connected software','已接入的软件')),opButton(L('Manage','管理'),()=>opNavigate('catalog'),'text-button','arrow')))
  for(const entry of entries.slice(0,4))connections.append(add(el('div','connection-row'),opMark(entry.id),add(el('div'),el('strong','',entryName(entry)),el('span','connection-detail',entry.usage?.location||L('Host connection','宿主连接'))),opPill(entry)))
  if(!entries.length)connections.append(el('p','panel-note',L('Connect your first software entry.','先接入一个常用软件。')))
  connections.append(el('p','panel-note',L('Verification uses real requests and replies in the selected software.','以所选软件的真实请求和结果回传为准。')))
  const model=add(el('section','side-panel'),add(el('div','panel-header'),icon('cpu'),el('h2','',L('Current AI service','当前模型服务'))),add(el('div','model-line'),add(el('span','model-symbol'),icon('cpu')),add(el('div'),el('strong','',backend.label||backend.kind),el('small','',backend.kind==='codex'?L('Uses host sign-in','复用宿主登录'):backend.kind)),el('span','pill '+(backend.configured?'neutral':'amber'),backend.configured?L('Configured','已配置'):L('Needs setup','需要配置'))),el('p','panel-note',L('New work uses the host service. Existing conversations keep their backend.','新任务使用宿主服务，已有会话保留原后端。')),opButton(L('Manage AI connections','管理模型连接'),()=>opNavigate('models'),'text-button','arrow'))
  return add(el('aside','right-column'),connections,model,add(el('p','context-note'),icon('policy'),el('span','',L('People use the assistant in their own software. This workspace is for the deployment operator.','普通使用者在原软件使用助手，此工作台用于部署和管理。'))))
}
function opOverview(attentionOnly=false){
  const data=operator.work,attention=data?.attention||[]
  const result=[opHeading(attentionOnly?L('Needs your attention','待我处理'):L('Workspace','工作台'),L('Your decisions, ongoing work and results, in one place.','需要你决定的事、助手正在做的事，都在这里。'),opButton(L('Connect software','接入软件'),()=>opNavigate('catalog'),'button primary','plus'))]
  if(!attentionOnly)result.push(add(el('div','summary-strip'),add(el('strong'),el('span','status-dot'),el('span','',data?.paused?L('Host paused','宿主已暂停'):L('Host connected','宿主已连接'))),el('span','divider'),el('span','host-summary',location.host),el('span','secondary-status',L('Results return to the original conversation','结果返回原会话')),opButton(L('How to use','查看使用方式'),()=>opNavigate('usage'),'text-button link','arrow')))
  const column=add(el('div'),opSection(L('Needs your attention','待我处理'),data?.attentionTotal??0),attention.length?add(el('div','attention-list'),...attention.map(opAttentionCard)):opEmpty(operator.error?L('Work status is unavailable. Refresh to retry.','任务状态读取失败，请刷新重试。'):L('No items need your attention right now.','目前没有需要你处理的事项。')))
  if(!attentionOnly){
    const recent=add(el('section','section-gap'),opSection(L('Recent work','最近任务'),null,opButton(L('All work','全部记录'),()=>opNavigate('activity'),'text-button','arrow')))
    for(const pending of data?.understanding||[])recent.append(add(el('p','panel-note'),el('strong','',L('Understanding your request…','正在理解你的请求…')),el('span','',pending.title)))
    recent.append(data?.tasks?.length?add(el('div','task-list'),...data.tasks.slice(0,6).map(opTaskRow)):opEmpty(L('Requests from connected software will appear here.','从已接入的软件交代任务后，会显示在这里。')));column.append(recent)
  }
  result.push(add(el('div','two-column'),column,opSideColumn()));return result
}
function opCatalogue(){
  const entries=entryState.data.entries,groups=[['all',L('All software','全部软件')],['connected',L('Connected','已接入')],['team',L('Team collaboration','团队协作')],['client',L('AI clients','开发工具')]]
  const matches=(e,filter)=>filter==='all'||filter==='connected'&&e.status!=='not-configured'||filter==='team'&&e.category!=='client'||filter==='client'&&e.category==='client'
  const tabs=el('div','tabs');tabs.setAttribute('role','group');tabs.setAttribute('aria-label',L('Software category','软件分类'))
  for(const [id,label]of groups){const b=opButton('',()=>{operator.filter=id;render()},'tab');b.setAttribute('aria-pressed',String(operator.filter===id));b.replaceChildren(el('span','',label),el('span','',entries.filter(e=>matches(e,id)).length));tabs.append(b)}
  const input=el('input');input.type='search';input.id='operator-search';input.value=operator.search;input.placeholder=L('Search software…','搜索软件…');input.setAttribute('aria-label',L('Search software','搜索软件'))
  const grid=el('div','integration-grid');grid.id='operator-catalogue'
  const cards=()=>{const visible=entries.filter(e=>matches(e,operator.filter)&&(entryName(e)+' '+e.id).toLowerCase().includes(operator.search.toLowerCase()));grid.replaceChildren(...(visible.length?visible.map(e=>{const card=opButton('',()=>opNavigate('detail',e.id),'integration-card');card.replaceChildren(add(el('div','integration-card-header'),opMark(e.id,'large'),el('h3','',entryName(e)),opPill(e)),el('p','',entryDescription(e.id)),add(el('div','integration-card-bottom'),el('span','',e.usage?.location||(e.category==='client'?L('Personal host connection','宿主个人连接'):L('Connect to your team','接入团队会话'))),icon('arrow')));return card}):[el('p','no-results',L('No matching software. Try another name.','没有找到匹配的软件，请换个名称搜索。'))]))}
  input.oninput=()=>{operator.search=input.value;cards()};cards()
  const configured=entries.filter(e=>e.status!=='not-configured')
  return [opHeading(L('Connected software','接入软件'),L('Bring the assistant to tools you already use.','让助手出现在你已经使用的工具里。'),configured.length?opButton(L('Prepare usage instructions','生成使用说明'),()=>shareEntries(configured.map(e=>e.id)),'button','message'):null),tabs,add(el('div','toolbar'),add(el('label','search-field'),icon('search'),input),el('small','',L('Reuse one AI service across entries','复用同一个模型服务，按需添加入口'))),grid,add(el('div','notice-inline'),icon('policy'),el('p','',L('Configured and verified are different. Verify a real request and reply in the original software.','已配置和已验证是两个状态。保存后，需要在原软件验证真实请求与回复。'))),entryState.share?entryShareResult():null]
}
function opActivity(){
  const data=operator.work
  return [opHeading(L('Work history','任务记录'),L('Follow requests and replies back to their original conversation.','沿着原会话查看请求、进展和结果。'),opButton(L('Refresh','刷新'),refreshEntries,'button','refresh')),opSection(L('All work','全部任务'),data?.total??0),data?.tasks?.length?add(el('div','task-list'),...data.tasks.map(opTaskRow)):opEmpty(L('No work on this page.','此页暂无任务。')),add(el('div','actions'),operator.offset?opButton(L('Previous','上一页'),()=>entryRun('work-page',async()=>{operator.offset=Math.max(0,operator.offset-25);await readOperatorWork()}),'button'):null,data?.more?opButton(L('Next','下一页'),()=>entryRun('work-page',async()=>{operator.offset+=25;await readOperatorWork()}),'button'):null)]
}
function opModels(){
  const form=entryModelSettings();form.open=true;form.classList.add('operator-model-form')
  return [opHeading(L('AI services','模型服务'),L('Reuse a saved service, or connect another provider when needed.','已有连接继续复用，需要时再添加其他服务。')),add(el('div','detail-layout'),add(el('div','model-config'),form),add(el('aside','flow-aside'),add(el('section','side-panel'),opSection(L('One service across your software','一处配置，共同使用')),el('p','flow-help',L('Check first, then save. Existing software entries and persistent conversations are retained.','先检查再保存，已有软件入口和持久会话会保留。')),el('p','panel-note',L('API checks make a small request to the service you select.','API 检查会向你选择的服务发送一个小请求。')))))]
}
function opConnection(){
  const entry=selectedEntry();if(!entry)return entryDetail()
  const sections=entryDetail().slice(3),configured=entry.status!=='not-configured',verified=entry.status==='verified'
  const heading=opHeading(entryName(entry),entryDescription(entry.id));heading.querySelector('h1').prepend(opMark(entry.id,'large'));heading.querySelector('h1').append(opPill(entry));heading.querySelector('h1').classList.add('platform-title')
  const steps=el('ol','flow-nav')
  for(const [label,done]of [[L('Check existing prerequisites','检查已有条件'),entryState.probe?.checks?.every(c=>c.status==='ok')||verified],[L('Add only missing settings','补充所需设置'),configured],[L('Save connection settings','保存连接配置'),configured],[L('Verify in the original software','在原软件验证'),verified]])steps.append(add(el('li',done?'complete':''),icon(done?'check':'message'),el('span','',label)))
  return [opButton(L('All software','所有软件'),()=>opNavigate('catalog'),'back-link','arrow'),heading,add(el('div','detail-layout'),add(el('div','connection-form'),...sections),add(el('aside','flow-aside'),add(el('section','side-panel'),opSection(L('Connection steps','接入步骤')),steps),el('p','flow-help',L('Settings apply to the host computer. A remote client needs its own bridge and secure connection.','设置作用于宿主电脑，远端客户端需要自己的桥接程序和安全连接。')),entryHostNote()))]
}
function opUsage(){
  const configured=entryState.data.entries.filter(e=>e.status!=='not-configured')
  return [opHeading(L('Use your assistant in your own software','在常用软件里使用助手'),L('Ordinary users do not need this management workspace.','普通使用者无需进入管理工作台。')),add(el('div','guide-layout'),...[[L('Find the enabled entry','找到已开通的入口'),L('Follow the owner’s instructions in your team chat. Find the bot or connected client there.','按管理员分享的说明，在群聊或客户端里找到已开通的助手。')],[L('Explain the result you need','说明你需要的结果'),L('Give the assistant your request in that software. It will ask there if anything needs clarification.','在原软件交代任务和希望得到的结果，需要补充时助手会在那里询问。')],[L('Continue in the same conversation','继续在原会话跟进'),L('Follow up, add context and receive the result in the original conversation.','任务在后台进行，在原会话追问、补充要求并接收结果。')]].map(([title,description])=>add(el('section','guide-block'),el('h2','',title),el('p','',description))),add(el('section','guide-block'),el('h2','',L('Share with users','分享给使用者')),el('p','',L('Share usage instructions instead of management credentials. MCP connections are for personal operators.','分享使用说明，不分发管理凭据。MCP 连接用于个人操作员。')),configured.length?opButton(L('Prepare usage instructions','生成使用说明'),()=>shareEntries(configured.map(e=>e.id)),'button primary','message'):opButton(L('Connect software','接入软件'),()=>opNavigate('catalog'),'button primary','plus'),entryState.share?entryShareResult():null))]
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
  const links=add(el('div','drawer-actions'),task.sourceUrl?entryLink(L('Open original conversation','打开原讨论'),task.sourceUrl,'button primary'):null,entryLink(L('Full task controls','完整任务控制台'),'/?ticket='+encodeURIComponent(task.id),'button'))
  body.append(add(el('section','handoff'),el('h3','',L('Continue in the source software','回到原软件继续')),el('p','',L('Use the original topic or client chat to add requirements and receive the reply.','在原话题或客户端聊天补充要求并接收回复。'))),links)
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
  document.documentElement.lang=lang;document.title=(opPages()[entryState.page]||opPages().home)+' · AgentHub'
  const root=el('div','operator-workspace'),shell=el('div','app-shell'),rail=el('aside','sidebar');rail.id='operator-sidebar';rail.setAttribute('aria-label',L('Workspace navigation','工作台导航'))
  const close=opButton(L('Close navigation','关闭导航'),()=>setOperatorMenu(false),'icon-button sidebar-close','close');close.id='operator-menu-close'
  rail.append(add(el('div','brand'),add(el('span','brand-symbol'),icon('brand')),el('span','','AgentHub'),el('span','version',S.health?.version||'0.10')),close,add(el('div','workspace'),el('span','workspace-avatar','A'),add(el('div'),el('strong','',L('My workspace','我的工作空间')),el('small','',L('Personal deployment','个人部署')))))
  const nav=el('nav');nav.setAttribute('aria-label',L('Main navigation','主导航'))
  for(const [page,glyph]of [['home','overview'],['attention','inbox'],['activity','activity'],['catalog','sources'],['models','cpu']]){
    if(page==='catalog')nav.append(el('span','nav-group',L('Configuration','配置')))
    const b=opButton('',()=>opNavigate(page),'operator-nav-link');b.replaceChildren(icon(glyph),el('span','',opPages()[page]));if(page===entryState.page||page==='catalog'&&entryState.page==='detail')b.setAttribute('aria-current','page');if(page==='attention'&&operator.work?.attentionTotal)b.append(el('span','nav-count',operator.work.attentionTotal));nav.append(b)
  }
  const host=add(el('div','host-mini'),el('span','status-dot'),add(el('div'),el('strong','',L('Management host','管理宿主')),el('span','',location.host)),icon('monitor'))
  rail.append(nav,add(el('div','sidebar-bottom'),host,opButton(L('Usage guide','使用指引'),()=>opNavigate('usage'),'utility-link','book'),opButton(L('Advanced settings','高级设置'),()=>{if(operator.menu)setOperatorMenu(false);switchSurface('advanced')},'utility-link','advanced'),add(el('div','profile'),el('span','profile-avatar','A'),add(el('div'),el('strong','',L('Operator','操作员')),el('span','',L('Manage this deployment','管理此部署'))))))
  const toggle=opButton(L('Open navigation','打开导航'),()=>setOperatorMenu(true),'icon-button mobile-menu','menu');toggle.id='operator-menu';toggle.setAttribute('aria-expanded',String(operator.menu));toggle.setAttribute('aria-controls','operator-sidebar')
  const top=add(el('header','topbar'),add(el('div','breadcrumb'),toggle,el('span','',L('My workspace','我的工作空间')),el('span','slash','/'),el('strong','',opPages()[entryState.page]||opPages().home)),add(el('div','topbar-tools'),languagePicker(),opButton(L('Refresh','刷新'),refreshEntries,'icon-button','refresh'),opButton(L('Use assistant','使用助手'),()=>chooseEntryRole('user'),'text-button')))
  const main=el('main');main.id='main';main.tabIndex=-1
  if(entryState.data.preview)main.append(el('p','alert warning',L('Isolated preview: installation and external execution are unavailable.','隔离预览：安装和外部执行不可用。')))
  if(entryState.error){const error=add(el('div','alert error'),el('p','',L(...entryState.error.text)),entryState.error.detail?detail(L('Details','详情'),raw(entryState.error.detail)):null,opButton(L('Refresh','刷新'),refreshEntries,'button'));error.id='entry-error';error.tabIndex=-1;error.setAttribute('role','alert');main.append(error)}
  if(operator.error)main.append(add(el('div','alert warning'),el('p','',L('Work status could not be loaded. Existing values may be outdated.','任务状态未能读取，已有数据可能已过时。')),opButton(L('Refresh','刷新'),refreshEntries,'button')))
  const content=el('fieldset','operator-body');content.disabled=!!entryState.busy||!!S.busy
  const page=entryState.page;content.append(...(page==='catalog'?opCatalogue():page==='detail'?opConnection():page==='activity'?opActivity():page==='attention'?opOverview(true):page==='models'?opModels():page==='usage'?opUsage():opOverview()).filter(Boolean))
  main.append(content);if(S.notice||S.busy)main.prepend(noticeView());if(entryState.busy)main.append(el('p','entry-progress',L('Working…','正在处理…')))
  const body=add(el('div','main-shell'),top,main,add(el('footer'),el('span','',L('Work starts and results return in your existing software.','从常用软件交代任务，结果返回原会话。')),el('span','',L('Private operator workspace','个人部署管理工作台'))))
  const scrim=opButton(L('Close navigation background','关闭导航背景'),()=>setOperatorMenu(false),'nav-scrim')
  shell.append(rail,scrim,body);const skip=el('a','skip',L('Skip to content','跳至主要内容'));skip.href='#main';root.append(skip,shell);const dialog=opTaskDialog();if(dialog)root.append(dialog);app.replaceChildren(root)
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
