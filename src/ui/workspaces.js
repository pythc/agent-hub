// An inventory opt-in is required before any workspace-scoped request is sent.
const workspaceContext = { managed: false, activeId: '', items: [], canCreate: false, epoch: 0, error: '', requestId: '', creation: { name: '', kind: 'organization' }, discovered: false, transportPhase: 'pending', transportCode: '', sessionIsolation: crypto.randomUUID() }

// Readiness is a UI projection of the existing context, never permission authority.
const workspaceListeners = new Set()
function workspaceNotify() { for (const listener of [...workspaceListeners]) { try { listener() } catch {} } }
function workspaceAccountId() { const account=entryState.account; return account?.authenticated === true && typeof account.user?.id === 'string' && account.user.id ? account.user.id : null }
function workspaceRequested() {
  const params=new URL(location.href).searchParams, values=params.getAll('workspace')
  if (!params.has('workspace')) return null
  if (values.length !== 1 || !values[0] || !/^[a-zA-Z0-9_-]{1,80}$/.test(values[0])) throw new ApiError(409,{code:'workspace_invalid',error:'This workspace link is invalid. Open a valid workspace link.'})
  return values[0]
}
function workspaceTransportPending() { workspaceContext.epoch++; workspaceContext.transportPhase='pending';workspaceContext.transportCode='';workspaceNotify() }
function workspaceTransportBlock(code) { workspaceContext.transportPhase='blocked';workspaceContext.transportCode=code;workspaceNotify() }
function workspaceSessionCommit() { workspaceContext.epoch++;workspaceContext.sessionIsolation=crypto.randomUUID();workspaceContext.transportPhase='pending';workspaceContext.transportCode='';workspaceNotify() }
function workspaceSessionEnded() { workspaceContext.epoch++;workspaceContext.sessionIsolation=crypto.randomUUID();workspaceTransportBlock('workspace_session_ended') }
function workspaceTransportCommitReady() { if (!workspaceContext.discovered || !S.authed) {workspaceTransportBlock('workspace_initialization_failed');return} workspaceContext.transportPhase='ready';workspaceContext.transportCode='';workspaceNotify() }
function workspaceBridgeSnapshot() {
  let state=workspaceContext.transportPhase, code=workspaceContext.transportCode
  try {
    const requested=workspaceRequested()
    if (requested && workspaceContext.discovered && !workspaceContext.managed) {state='blocked';code='workspace_unsupported'}
    else if (requested && workspaceContext.discovered && (!workspaceContext.items.some(item=>item.id===requested) || requested!==workspaceContext.activeId)) {state='blocked';code='workspace_unavailable'}
    if (state==='ready' && (!workspaceContext.discovered || !S.authed || workspaceContext.managed && !workspaceContext.items.some(item=>item.id===workspaceContext.activeId))) {state='blocked';code='workspace_unavailable'}
  } catch {state='blocked';code='workspace_invalid'}
  return Object.freeze({state,code:code||null,managed:workspaceContext.managed,activeId:workspaceContext.activeId,epoch:workspaceContext.epoch,accountId:workspaceAccountId(),sessionIsolation:workspaceContext.sessionIsolation})
}
function workspaceBridgeError(context) { return new ApiError(409,{code:context.code || 'workspace_pending',error:context.state==='pending'?'The workspace is still loading.':'This workspace is unavailable. Open a valid workspace link or sign in again.'}) }
function workspaceBridge() {
  let cached,serialized=''
  const context=()=>{const next=workspaceBridgeSnapshot(),text=JSON.stringify(next);if(text!==serialized){serialized=text;cached=next}return cached}
  const subscribe=listener=>{workspaceListeners.add(listener);const changed=()=>listener();for(const event of ['popstate','hashchange','roppo:navigation'])window.addEventListener(event,changed);return()=>{workspaceListeners.delete(listener);for(const event of ['popstate','hashchange','roppo:navigation'])window.removeEventListener(event,changed)}}
  const ready=()=>new Promise((resolve,reject)=>{let unsubscribe=()=>{};const check=()=>{const current=context();if(current.state==='pending')return;unsubscribe();if(current.state==='ready')resolve(current);else reject(workspaceBridgeError(current))};unsubscribe=subscribe(check);check()})
  const matches=(current,captured)=>current.state==='ready'&&captured.state==='ready'&&current.managed===captured.managed&&current.epoch===captured.epoch&&current.activeId===captured.activeId&&current.accountId===captured.accountId&&current.sessionIsolation===captured.sessionIsolation
  const obsolete=()=>new ApiError(409,{code:'workspace_obsolete',error:'Workspace changed during request'})
  const boundRequest=async(captured,path,body,publicRead=false,scope=captured.activeId,readSignal)=>{
    const before=context()
    if(before.state!=='ready')throw workspaceBridgeError(before)
    if(!matches(before,captured)||scope!==captured.activeId)throw obsolete()
    if(publicRead&&!['/health','/session','/pair','/operator-link','/entry-guide','/connect-info','/logout','/workspaces'].includes(path))throw obsolete()
    let value
    try {value=await api(path,body,publicRead,scope,readSignal)} catch(error) {const current=context();if(error instanceof ApiError&&error.status===401&&current.code==='workspace_session_ended'&&current.epoch===captured.epoch+1&&current.activeId===captured.activeId&&current.accountId===captured.accountId)throw error;if(!matches(current,captured))throw obsolete();throw error}
    if(!matches(context(),captured))throw obsolete()
    return value
  }
  const request=(path,body,publicRead=false,scope=workspaceContext.activeId,readSignal)=>boundRequest(context(),path,body,publicRead,scope,readSignal)
  const bind=expected=>{
    const current=context()
    if(current.state!=='ready')throw workspaceBridgeError(current)
    if(!matches(current,expected))throw obsolete()
    const captured=Object.freeze({...expected})
    return Object.freeze({context:captured,request:(path,body,publicRead=false,scope=captured.activeId,readSignal)=>boundRequest(captured,path,body,publicRead,scope,readSignal)})
  }
  return Object.freeze({context,subscribe,ready,request,bind})
}

function workspaceCurrent() {
  return workspaceContext.items.find(item => item.id === workspaceContext.activeId) ||
    { id: '', name: L('Current workspace', '当前工作区'), kind: 'personal', role: 'owner' }
}
function workspaceName() { return workspaceCurrent().name }
function workspaceReset() {
  Object.assign(workspaceContext, { managed: false, activeId: '', items: [], canCreate: false, epoch: workspaceContext.epoch + 1, error: '', requestId: '', discovered:false, transportPhase:'blocked', transportCode:'workspace_disconnected', sessionIsolation:crypto.randomUUID() })
  workspaceNotify()
  connectionStudioReset(); integrationsReset()
  entryState.inventoryRequest++;entryState.inventoryLoading = false;entryState.inventoryError = false
}
function workspaceKind(kind) { return kind === 'organization' ? L('Organization', '组织') : L('Personal', '个人') }
function workspacePath(path, publicRead, scope) {
  const global = ['/health', '/session', '/pair', '/operator-link', '/entry-guide', '/connect-info', '/logout', '/workspaces']
  if (publicRead || !workspaceContext.managed || !scope || global.includes(path)) return path
  return '/workspaces/' + encodeURIComponent(scope) + path
}
function workspaceValidate(data) {
  if (data?.version !== 1 || !Array.isArray(data.items) || !data.items.length ||
      !data.items.every(item => typeof item.id === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(item.id) &&
        typeof item.name === 'string' && item.name.trim() && ['personal', 'organization'].includes(item.kind)) ||
      new Set(data.items.map(item => item.id)).size !== data.items.length || !data.items.some(item => item.id === data.currentId))
    throw Error('Invalid workspace inventory')
  return data
}
async function workspaceDiscover() {
  workspaceContext.discovered=false
  workspaceTransportPending()
  const discoveryEpoch=workspaceContext.epoch
  try {
    const requested=workspaceRequested()
    const data = workspaceValidate(await api('/workspaces'))
    if (requested && !data.items.some(item => item.id === requested)) throw Error(L('This workspace is unavailable for the current account.', '当前账号无法访问此工作区。'))
    workspaceContext.items = data.items
    workspaceContext.activeId = requested || data.currentId
    workspaceContext.canCreate = data.canCreate === true
    workspaceContext.managed = true
    workspaceContext.error = ''
    workspaceContext.discovered = true
    workspaceNotify()
  } catch (error) {
    if(workspaceContext.epoch!==discoveryEpoch)throw error
    if (![404, 405].includes(error.status)) {workspaceContext.discovered=false;workspaceTransportBlock(error.payload?.code==='workspace_invalid'?'workspace_invalid':'workspace_unavailable');throw error}
    if (new URL(location.href).searchParams.has('workspace')) {workspaceContext.discovered=false;workspaceTransportBlock('workspace_unsupported');throw Error(L('The current environment does not support the workspace in this link.', '当前环境不支持链接指定的工作区。'))}
    workspaceContext.managed = false
    workspaceContext.activeId = ''
    workspaceContext.items = []
    workspaceContext.canCreate = false
    workspaceContext.discovered = true
    workspaceNotify()
  }
}
async function workspaceSwitch(id) {
  if (id === workspaceContext.activeId) return true
  if (dirty() || entryHasDraft()) {
    workspaceContext.error = L('Save or discard your current draft before switching workspaces.', '请先保存或放弃当前草稿，再切换工作区。')
    workspaceShowPicker(); return false
  }
  if (!workspaceContext.items.some(item => item.id === id)) return false
  let success = false,current=()=>false
  await entryRun('workspace-switch', async () => {
    // Load everything before swapping identity; a failing scope cannot borrow old data.
    const [snap, entries, work] = await Promise.all([
      api('/configuration', undefined, false, id), api('/entry-setup', undefined, false, id), api('/entry-workspace', undefined, false, id)
    ])
    if (!Number.isInteger(snap.current?.revision) || !snap.current.config || !Array.isArray(snap.history) ||
        !Array.isArray(entries.entries) || !Number.isInteger(entries.revision) || !Array.isArray(work.tasks))
      throw Error('Invalid workspace response')
    // Commit the URL before notifying: no observer may see a new ID with the old selector.
    const url = new URL(location.href)
    if(typeof configurationHost!=='undefined'&&configurationHost){url.pathname='/configure';url.search=''}
    url.searchParams.set('workspace', id); url.hash='tasks'; history.replaceState(null, '', url)
    workspaceContext.epoch++
    entryState.inventoryRequest++;entryState.inventoryLoading = false;entryState.inventoryError = false
    workspaceContext.activeId = id
    workspaceContext.error = ''
    S.snap = snap; resetDraft(snap.current); S.notice = null; S.status = null; S.promptIndex = null
    entryState.data = entries; entryState.error = null; entryState.draft = {}; entryState.touched = false
    entryState.plan = null; entryState.probe = null; entryState.applied = null; entryState.verification = null; entryState.share = null
    entryState.clientConfig = null; entryState.source = ''; entryState.creating = false
    operator.work = work; operator.error = false; operator.drawer = null; operator.answers = {}; operator.offset = 0
    operator.historySearch = ''; operator.historyState = ''; operator.filter = 'all'; operator.search = ''
    Object.assign(entryModel, { creating: false, name: '', mode: '', existingId: '', provider: 'openai', endpoint: '', protocol: 'openai-responses', model: '', credential: '', open: false, touched: false, plan: null, check: null, saved: false })
    teamStudio.selected = 'router'; teamStudio.tab = 'essentials'; connectionStudioReset(); integrationsReset()
    executionView.selected = null; executionView.inspect = null; executionView.callId = null; executionView.instructions = null
    resetGuideSession()
    entryState.page = 'home'
    const committedEpoch=workspaceContext.epoch,committedAccount=workspaceAccountId(),committedSession=workspaceContext.sessionIsolation
    current=()=>workspaceContext.epoch===committedEpoch&&workspaceContext.activeId===id&&workspaceAccountId()===committedAccount&&workspaceContext.sessionIsolation===committedSession
    // Publish one complete identity/default-route commit. Secondary reads must
    // never restore this default after the user has chosen another page.
    workspaceNotify()
    if(typeof configurationHost!=='undefined'&&configurationHost)window.dispatchEvent(new Event('roppo:navigation'))
    success = true
  })
  // entryRun owns its busy/finally lifecycle. Optional read-only refreshes must
  // not keep navigation locked after the workspace identity has committed.
  if(!success||!current())return false
  try{
    await loadGuideContext()
    if(!current())return false
    await Promise.all([connectionDiscover(), integrationsDiscover()])
  }catch{
    if(current()){entryError(new ApiError(503,{code:'workspace_refresh_failed',error:L('Workspace details could not be refreshed. Reload to try again.','工作区详情未能更新，请重新加载后重试。')}));render()}
  }
  return current()
}
function workspaceTrigger() {
  const current = workspaceCurrent()
  const button = opButton('', workspaceShowPicker, 'workspace workspace-switch')
  button.disabled = !!entryState.busy || !!S.busy
  button.id = 'workspace-switch'; button.setAttribute('aria-haspopup', 'dialog')
  button.replaceChildren(add(el('span', 'workspace-avatar'), icon(current.kind === 'organization' ? 'conversations' : 'overview')),
    add(el('div'), el('strong', '', current.name), el('small', '', workspaceContext.managed ? workspaceKind(current.kind) : L('Single workspace environment', '单工作区环境'))), icon('forward'))
  return button
}
function workspaceShowPicker() {
  document.getElementById('workspace-picker')?.remove()
  const dialog = el('dialog', 'workspace-picker'); dialog.id = 'workspace-picker'; dialog.setAttribute('aria-labelledby', 'workspace-picker-title')
  const body = el('div', 'workspace-picker-body'), title = el('h2', '', L('Switch workspace', '切换工作区')); title.id = 'workspace-picker-title'
  const close = () => WorkspaceMotion.closeDialog(dialog)
  body.append(add(el('div', 'workspace-picker-head'), title, opButton(L('Close', '关闭'), close, 'icon-button', 'close')))
  if (workspaceContext.error) { const error = el('p', 'alert warning', workspaceContext.error); error.setAttribute('role', 'alert'); body.append(error) }
  for (const kind of ['personal', 'organization']) {
    body.append(el('h3', 'workspace-type-title', workspaceKind(kind)))
    const items = workspaceContext.managed ? workspaceContext.items.filter(item => item.kind === kind) : kind === 'personal' ? [workspaceCurrent()] : []
    for (const item of items) {
      const selected = item.id === workspaceContext.activeId
      const button = opButton('', () => WorkspaceMotion.closeDialog(dialog, () => { void workspaceSwitch(item.id) }), 'workspace-choice')
      button.setAttribute('aria-current', String(selected)); button.disabled = !!entryState.busy || !!S.busy
      button.replaceChildren(add(el('span', 'workspace-avatar'), icon(kind === 'organization' ? 'conversations' : 'overview')),
        add(el('span', 'workspace-choice-text'), el('strong', '', item.name), el('small', 'team-help', workspaceKind(kind))), selected ? icon('check') : icon('forward'))
      body.append(button)
    }
    if (!items.length) body.append(el('p', 'team-help', L('No accessible workspace.', '暂无可访问的工作区。')))
  }
  if (workspaceContext.managed && workspaceContext.canCreate) {
    const form = el('form', 'workspace-create')
    const name = el('input'); name.id = 'workspace-new-name'; name.required = true; name.maxLength = 80; name.placeholder = L('Workspace name', '工作区名称'); name.value = workspaceContext.creation.name
    const label = el('label', '', L('New workspace', '新建工作区')); label.htmlFor = name.id
    const type = el('select'); type.id = 'workspace-new-kind'; type.setAttribute('aria-label', L('Workspace type', '工作区类型'))
    type.add(new Option(workspaceKind('personal'), 'personal')); type.add(new Option(workspaceKind('organization'), 'organization'))
    type.value = workspaceContext.creation.kind
    const create = opButton(L('Create workspace', '创建工作区'), null, 'button primary'); create.type = 'submit'
    form.append(label, name, type, create)
    form.onsubmit = async event => {
      event.preventDefault()
      if (dirty() || entryHasDraft()) { workspaceContext.error = L('Save or discard the current draft first.', '请先保存或放弃当前草稿。'); workspaceShowPicker(); return }
      if (!name.value.trim()) { name.setCustomValidity(L('Enter a name.', '请输入名称。')); name.reportValidity(); return }
      workspaceContext.requestId ||= crypto.randomUUID()
      const request = { name: name.value.trim(), kind: type.value, requestId: workspaceContext.requestId }
      let nextId = ''
      dialog.close()
      await entryRun('workspace-create', async () => {
        const data = workspaceValidate(await api('/workspaces', request))
        workspaceContext.requestId = ''; workspaceContext.creation = { name: '', kind: 'organization' }; workspaceContext.items = data.items; workspaceContext.canCreate = data.canCreate === true
        workspaceNotify()
        nextId = data.currentId
      })
      if (nextId) await workspaceSwitch(nextId)
      else {
        workspaceContext.error = entryState.error?.detail || L('Workspace creation was not confirmed. Retry with the same draft.', '工作区创建尚未确认，可使用保留的草稿重试。')
        workspaceShowPicker()
      }
    }
    name.oninput = () => { name.setCustomValidity(''); workspaceContext.requestId = ''; workspaceContext.creation.name = name.value }
    type.onchange = () => { workspaceContext.requestId = ''; workspaceContext.creation.kind = type.value }
    body.append(form)
  } else if (!workspaceContext.managed) body.append(el('p', 'team-help workspace-create',
    L('The current environment has one workspace. Switching between personal and organization workspaces requires workspace support.', '当前环境只有一个工作区。支持工作区隔离后，即可在个人与组织间切换。')))
  dialog.append(body)
  dialog.onclose = () => { dialog.remove(); document.getElementById('workspace-switch')?.focus({ preventScroll: true }) }
  app.querySelector('.operator-workspace').append(dialog); WorkspaceMotion.openDialog(dialog)
}
function workspaceHome() {
  const route = executionDraft(), tasks = operator.work?.activeTasks || []
  const main = el('section')
  main.append(opHeading(workspaceName(), null,
    opButton(L('Configure team', '配置团队'), () => opNavigate('execution', '', { view: 'configuration' }), 'button primary', 'execution')))
  const members = add(el('div'), el('h2', '', L('Your agent team', '你的 Agent 团队')))
  members.append(add(el('div', 'workspace-team-summary'), add(el('span', 'team-avatar'), icon('execution')),
    add(el('div'), el('h3', '', route.routerOptions.label || 'Router'), el('p', '', route.routerModel || controlConnections().find(item => item.id === route.router)?.model || L('Connection default model', '连接默认模型'))),
    opButton(L('Configure Router', '配置 Router'), () => { teamStudio.selected = 'router'; opNavigate('execution', '', { view: 'configuration' }) }, 'text-button')))
  for (const [index, worker] of route.workers.entries()) members.append(add(el('div', 'workspace-team-summary'),
    add(el('span', 'team-avatar'), icon('cpu')), add(el('div'), el('h3', '', worker.label || 'Worker ' + (index + 1)),
      el('p', '', worker.model || controlConnections().find(item => item.id === worker.backend)?.model || L('Connection default model', '连接默认模型'))),
    opButton(L('Configure', '配置'), () => { teamStudio.selected = worker.id; opNavigate('execution', '', { view: 'configuration' }) }, 'text-button')))
  const setup = add(el('aside', 'workspace-start'), el('h2', '', L('Workspace setup', '工作区配置')),
    add(el('div', 'workspace-start-actions'),
      opButton(L('Connect a model', '接入模型'), controlNewModel, 'text-button', 'cpu'),
      opButton(L('Connect your conversation', '接入会话入口'), () => opNavigate('catalog'), 'text-button', 'conversations'),
      opButton(L('Set behavior rules', '设置行为规则'), () => opNavigate('prompts'), 'text-button', 'prompts')))
  main.append(add(el('div', 'workspace-overview'), members, setup), opSection(L('Work in progress', '进行中的任务'), null,
    opButton(L('All tasks', '全部任务'), () => opNavigate('activity'), 'text-button')))
  if (operator.work?.understanding?.length) for (const request of operator.work.understanding) main.append(el('p', 'understanding-request', L('Understanding: ', '正在理解：') + request.title))
  main.append(tasks.length ? opTaskTable(tasks) : add(el('div', 'workspace-empty'), icon('conversations'),
    el('p', '', L('Give Router a goal in your connected conversation. Work will appear here.', '在已接入的会话中向 Router 交代目标，任务将在这里显示。')),
    opButton(L('Find my conversation entry', '查看会话入口'), () => opNavigate('usage'), 'button')))
  return [main]
}
