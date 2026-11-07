// An inventory opt-in is required before any workspace-scoped request is sent.
const workspaceContext = { managed: false, activeId: '', items: [], canCreate: false, epoch: 0, error: '', requestId: '', creation: { name: '', kind: 'organization' } }
function workspaceCurrent() {
  return workspaceContext.items.find(item => item.id === workspaceContext.activeId) ||
    { id: '', name: L('Current workspace', '当前工作区'), kind: 'personal', role: 'owner' }
}
function workspaceName() { return workspaceCurrent().name }
function workspaceReset() {
  Object.assign(workspaceContext, { managed: false, activeId: '', items: [], canCreate: false, epoch: workspaceContext.epoch + 1, error: '', requestId: '' })
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
  try {
    const data = workspaceValidate(await api('/workspaces'))
    const requested = new URL(location.href).searchParams.get('workspace')
    if (requested && !data.items.some(item => item.id === requested)) throw Error(L('This workspace is unavailable for the current account.', '当前账号无法访问此工作区。'))
    workspaceContext.items = data.items
    workspaceContext.activeId = requested || data.currentId
    workspaceContext.canCreate = data.canCreate === true
    workspaceContext.managed = true
    workspaceContext.error = ''
  } catch (error) {
    if (![404, 405].includes(error.status)) throw error
    if (new URL(location.href).searchParams.has('workspace')) throw Error(L('This host does not support the workspace in this link.', '此宿主不支持链接指定的工作区。'))
    workspaceContext.managed = false
    workspaceContext.activeId = ''
    workspaceContext.items = []
    workspaceContext.canCreate = false
  }
}
async function workspaceSwitch(id) {
  if (id === workspaceContext.activeId) return true
  if (dirty() || entryHasDraft()) {
    workspaceContext.error = L('Save or discard your current draft before switching workspaces.', '请先保存或放弃当前草稿，再切换工作区。')
    workspaceShowPicker(); return false
  }
  if (!workspaceContext.items.some(item => item.id === id)) return false
  let success = false
  await entryRun('workspace-switch', async () => {
    // Load everything before swapping identity; a failing scope cannot borrow old data.
    const [snap, entries, work] = await Promise.all([
      api('/configuration', undefined, false, id), api('/entry-setup', undefined, false, id), api('/entry-workspace', undefined, false, id)
    ])
    if (!Number.isInteger(snap.current?.revision) || !snap.current.config || !Array.isArray(snap.history) ||
        !Array.isArray(entries.entries) || !Number.isInteger(entries.revision) || !Array.isArray(work.tasks))
      throw Error('Invalid workspace response')
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
    await loadGuideContext()
    await Promise.all([connectionDiscover(), integrationsDiscover()])
    entryState.page = 'home'
    const url = new URL(location.href); url.searchParams.set('workspace', id); history.replaceState(null, '', url)
    updateWorkspaceLocation(); success = true
  })
  return success
}
function workspaceTrigger() {
  const current = workspaceCurrent()
  const button = opButton('', workspaceShowPicker, 'workspace workspace-switch')
  button.disabled = !!entryState.busy || !!S.busy
  button.id = 'workspace-switch'; button.setAttribute('aria-haspopup', 'dialog')
  button.replaceChildren(add(el('span', 'workspace-avatar'), icon(current.kind === 'organization' ? 'conversations' : 'overview')),
    add(el('div'), el('strong', '', current.name), el('small', '', workspaceContext.managed ? workspaceKind(current.kind) : L('Single workspace host', '单工作区宿主'))), icon('forward'))
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
    L('This host has one workspace. Personal and organization switching requires workspace support on the host.', '此宿主只有一个工作区。后端支持工作区隔离后，即可在个人与组织间切换。')))
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
    add(el('div'), el('h3', '', 'Router'), el('p', '', route.routerModel || controlConnections().find(item => item.id === route.router)?.model || L('Connection default model', '连接默认模型'))),
    opButton(L('Configure Router', '配置 Router'), () => { teamStudio.selected = 'router'; opNavigate('execution', '', { view: 'configuration' }) }, 'text-button')))
  for (const [index, worker] of route.workers.entries()) members.append(add(el('div', 'workspace-team-summary'),
    add(el('span', 'team-avatar'), icon('cpu')), add(el('div'), el('h3', '', worker.label || 'Worker ' + (index + 1)),
      el('p', '', worker.model || controlConnections().find(item => item.id === worker.backend)?.model || L('Connection default model', '连接默认模型'))),
    opButton(L('Configure', '配置'), () => { teamStudio.selected = worker.id; opNavigate('execution', '', { view: 'configuration' }) }, 'text-button')))
  const setup = add(el('aside', 'workspace-start'), el('h2', '', L('Workspace setup', '工作区配置')),
    add(el('div', 'workspace-start-actions'),
      opButton(L('Connect a model', '接入模型'), controlNewModel, 'text-button', 'cpu'),
      opButton(L('Connect your conversation', '接入会话入口'), () => opNavigate('catalog'), 'text-button', 'conversations'),
      opButton(L('Set shared instructions', '设置共享指令'), () => opNavigate('prompts'), 'text-button', 'prompts')))
  main.append(add(el('div', 'workspace-overview'), members, setup), opSection(L('Work in progress', '进行中的任务'), null,
    opButton(L('All tasks', '全部任务'), () => opNavigate('activity'), 'text-button')))
  if (operator.work?.understanding?.length) for (const request of operator.work.understanding) main.append(el('p', 'understanding-request', L('Understanding: ', '正在理解：') + request.title))
  main.append(tasks.length ? opTaskTable(tasks) : add(el('div', 'workspace-empty'), icon('conversations'),
    el('p', '', L('Give Router a goal in your connected conversation. Work will appear here.', '在已接入的会话中向 Router 交代目标，任务将在这里显示。')),
    opButton(L('Find my conversation entry', '查看会话入口'), () => opNavigate('usage'), 'button')))
  return [main]
}
