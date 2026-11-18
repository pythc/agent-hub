function controlConnections() {
  return Object.entries({ codex: { kind: 'codex' }, ...(S.base?.config.backends || {}) }).map(([id, backend]) => {
    let endpoint = ''
    try { endpoint = new URL(backend.baseUrl).hostname } catch {}
    const capabilities = S.snap?.backendCatalog?.find(item => item.id === id)
    return { id, admission: capabilities?.admission, definition: backend, endpoint, managedEligible: capabilities?.managedEligible, managedMissing: capabilities?.managedMissing || [], kind: backend.kind, model: backend.model || (backend.kind === 'codex' ? S.base?.config.model : ''),
      label: backend.label || (backend.kind === 'codex' ? 'Codex' : [endpoint, backend.model].filter(Boolean).join(' · ') || id),
      connectionType: backend.subscription ? 'subscription' : backend.kind === 'codex' || backend.kind === 'plugin' ? 'cli' : 'api' }
  })
}
function controlField(id,label,value,onChange,options=null,placeholder=''){
 const input=el(options?'select':'input');input.id=id
 if(options)for(const [v,name]of options)input.add(new Option(name,v))
 input.value=value??'';if(!options){input.type='text';input.autocomplete='off';input.placeholder=placeholder}
 input[options?'onchange':'oninput']=()=>onChange(input.value)
 const title=el('label','',label);title.htmlFor=id
 return add(el('div','control-field'),title,input)
}
let promptTarget = 'shared'
let promptPreviewOpen = false
let promptPreviewFocus = 'prompt-preview-close'
function executionDraft() {
  const config = S.draft
  const route = config.execution || S.base.config.execution
  const backend = route.backend ?? S.base.config.execution.backend
  return {
    router: route.router?.backend ?? route.roles?.router ?? backend,
    routerOptions: clone(route.router || {}),
    routerModel: route.router?.model || config.models?.router || '',
    workers: clone(route.workers !== undefined ? route.workers : Array.from(
      { length: Math.max(0, config.concurrency ?? 1) },
      (_, index) => ({
        id: 'worker-' + (index + 1),
        backend: route.roles?.worker ?? backend,
        ...(config.models?.worker ? { model: config.models.worker } : {})
      })
    ))
  }
}
function editExecution(draft) {
  S.preview = null
  const config = S.draft
  const execution = config.execution || S.base.config.execution
  const roles = { ...execution.roles }
  if (draft.router !== (roles.router ?? execution.backend)) roles.router = draft.router
  const workers = draft.workers.map(({ model, ...worker }) => ({
    ...worker, ...(model?.trim() ? { model: model.trim() } : {})
  }))
  const models = { ...config.models }
  if (draft.routerModel.trim()) models.router = draft.routerModel.trim()
  else delete models.router
  for (const [key, next] of Object.entries({
    execution: { ...execution, roles, workers,router:{...draft.routerOptions,backend:draft.router,...(draft.routerModel.trim()?{model:draft.routerModel.trim()}:{model:undefined})} }, models, concurrency: workers.length
  })) {
    if (same(config[key], next)) continue
    clearRelated(key)
    config[key] = next
  }
  updateBar()
}
function editPrompt(target, text) {
  clearRelated('prompts.' + target)
  set(S.draft, 'prompts.' + target, text)
  S.preview = null
  document.getElementById('control-prompt-preview')?.remove()
  if (S.notice?.level === 'success') {
    S.notice = null
    document.getElementById('notice')?.replaceChildren()
  }
  updateBar()
}
function promptTemplate(part) {
  const current = S.draft.prompts?.overrides?.[part.id]
  const input = el('textarea')
  input.value = current?.text ?? part.default
  const label = add(el('label', 'template-editor'), el('span', 'field-label', L('Template text', '模板内容')), input)
  const update = text => {
    clearRelated('prompts.overrides')
    const overrides = { ...S.draft.prompts?.overrides }
    if (text === part.default) delete overrides[part.id]
    else overrides[part.id] = { text, base: part.base }
    set(S.draft, 'prompts.overrides', overrides)
    S.preview = null
    document.getElementById('control-prompt-preview')?.remove()
    updateBar()
  }
  input.oninput = () => update(input.value)
  return detail(part.id, add(el('div', 'stack'), label,
    current && current.base !== part.base
      ? el('p', 'hint', L('The built-in template changed. Compare it before saving.', '内置模板已更新，请对照后再保存。'))
      : null,
    detail(L('Built-in value', '查看内置值'), raw(part.default)),
    opButton(L('Use built-in template', '使用内置模板'), () => {
      input.value = part.default
      update(input.value)
    }, 'button')
  ))
}
function promptDisclosure(id, title, content) {
  const disclosure = detail(title, content)
  disclosure.id = id
  disclosure.open = document.getElementById(id)?.open || false
  return disclosure
}
function promptRuleField(target, title, placeholder = '') {
  const input = el('textarea', 'prompt-rule-input')
  input.id = 'prompt-rule-' + target.replaceAll('.', '-')
  input.value = get(S.draft.prompts, target) || ''
  input.placeholder = placeholder
  input.oninput = () => editPrompt(target, input.value)
  const label = el('label', 'prompt-rule-label', title)
  label.htmlFor = input.id
  return add(el('div', 'prompt-rule-field'), label, input)
}
function updatePromptActions() {
  const button = document.getElementById('prompt-rules-save')
  if (!button) return
  button.disabled = !!S.busy || !!entryState.busy || (!S.latest && (S.errors.size > 0 || !changed().includes('prompts')))
  button.querySelector('span').textContent = S.latest ? L('Review conflict', '核对冲突')
    : S.busy === 'save' ? L('Saving…', '保存中…') : L('Save changes', '保存更改')
}
function closePromptPreview() {
  promptPreviewOpen = false
  document.getElementById('prompt-rules-preview-dialog')?.close()
  render()
  document.getElementById('prompt-rules-preview')?.focus({ preventScroll: true })
}
function openPromptPreview() {
  promptPreviewFocus = 'prompt-preview-close'
  promptPreviewOpen = true
  S.preview = null
  void previewPrompt()
}
function promptPreviewDialog() {
  if (!promptPreviewOpen) return null
  const dialog = el('dialog', 'prompt-preview-dialog')
  dialog.id = 'prompt-rules-preview-dialog'
  dialog.setAttribute('aria-labelledby', 'prompt-preview-title')
  const title = el('h2', '', L('Instruction preview', '指令预览'))
  title.id = 'prompt-preview-title'
  const close = opButton(L('Close', '关闭'), closePromptPreview, 'button')
  close.id = 'prompt-preview-close'
  const change = (focus, update) => { promptPreviewFocus = focus; update(); S.preview = null; void previewPrompt() }
  const role = selector('preview-role', L('View role', '查看角色'), [['router', 'Router'], ['worker', 'Worker']], S.previewRole,
    value => change('preview-role', () => { S.previewRole = value; S.previewMode = ''; S.previewWorkerId = '' }))
  const context = detail(L('Preview scenario', '预览场景'), add(el('div', 'prompt-preview-options'),
    selector('preview-mode', L('Task mode', '任务模式'), [
      ['', L('From entry configuration', '按入口配置')], ['standalone', L('Standalone task', '独立任务')],
      ...(S.previewRole === 'worker' ? [['delegated', L('Router delegation', 'Router 委派')]] : []),
      ['goal', L('Managed goal', '受管理目标')], ['project', L('Code project', '代码项目')],
      ...(S.previewRole === 'worker' ? [['subagent', L('Worker helper', 'Worker 助手')]] : [])
    ], S.previewMode, value => change('preview-mode', () => { S.previewMode = value })),
    selector('preview-source', L('Entry', '会话入口'), [['', L('Default entry', '默认入口')],
      ...(S.base.config.sources || []).map(source => [source.id, source.label || source.id])
    ], S.previewSourceId, value => change('preview-source', () => { S.previewSourceId = value })),
    S.previewRole === 'worker' ? selector('preview-worker', 'Worker', [['', L('Default Worker', '默认 Worker')],
      ...executionDraft().workers.map(worker => [worker.id, worker.label || worker.id])
    ], S.previewWorkerId, value => change('preview-worker', () => { S.previewWorkerId = value })) : null))
  // Keep the scenario controls open while the selected scenario is recomposed.
  const previous = document.querySelector('#prompt-rules-preview-dialog .prompt-preview-scenario')
  context.className = 'prompt-preview-scenario'
  context.open = previous?.open || false
  const body = el('div', 'prompt-preview-body')
  if (S.busy === 'preview') {
    const loading = el('p', 'prompt-preview-status', L('Generating preview…', '正在生成预览…'))
    loading.setAttribute('role', 'status')
    body.append(loading)
  } else if (S.preview) {
    body.append(el('p', 'prompt-preview-status', S.preview.fromDraft ? L('Unsaved draft', '未保存的草稿') : L('Saved rules', '已保存的规则')),
      raw(S.preview.text))
    if (S.preview.baseInstructions) body.append(detail(L('Runtime base rules', '运行基础规则'), raw(S.preview.baseInstructions)))
  } else if (S.notice?.level === 'error') {
    body.append(noticeView(), opButton(L('Retry', '重试'), previewPrompt, 'button'))
  }
  dialog.append(add(el('div', 'prompt-preview-heading'), title, close), role, context, body)
  dialog.oncancel = event => { event.preventDefault(); closePromptPreview() }
  queueMicrotask(() => {
    if (dialog.isConnected && promptPreviewOpen && !dialog.open &&
        (typeof configurationHost === 'undefined' || !configurationHost || configurationHost.active())) {
      dialog.showModal()
      if (!S.busy) dialog.querySelector('#' + CSS.escape(promptPreviewFocus))?.focus({ preventScroll: true })
    }
  })
  return dialog
}
function controlPrompts() {
  const page = el('section', 'prompt-rules-page')
  const preview = opButton(L('Preview instructions', '预览指令'), openPromptPreview, 'button')
  preview.id = 'prompt-rules-preview'
  const saveButton = opButton(L('Save changes', '保存更改'), () => S.latest ? revealRecovery() : save(['prompts']), 'button primary')
  saveButton.id = 'prompt-rules-save'
  page.append(opHeading(L('Behavior rules', '行为规则'), null, preview, saveButton))
  const roles = [['shared', L('General rules', '通用规则')], ['router', L('Router rules', 'Router 规则')], ['worker', L('Worker rules', 'Worker 规则')]]
  const tabs = el('div', 'prompt-rules-tabs')
  tabs.setAttribute('role', 'tablist')
  tabs.setAttribute('aria-label', L('Rule target', '规则对象'))
  const select = target => {
    promptTarget = target
    if (target !== 'shared') S.previewRole = target
    S.previewMode = ''
    S.preview = null
    render()
    document.getElementById('prompt-tab-' + target)?.focus({ preventScroll: true })
  }
  for (const [target, label] of roles) {
    const tab = opButton(label, () => select(target), 'prompt-rules-tab')
    tab.id = 'prompt-tab-' + target
    tab.setAttribute('role', 'tab')
    tab.setAttribute('aria-selected', String(promptTarget === target))
    tab.setAttribute('aria-controls', 'prompt-rules-panel')
    tab.tabIndex = promptTarget === target ? 0 : -1
    tabs.append(tab)
  }
  tabs.onkeydown = event => {
    const index = roles.findIndex(([target]) => event.target.id === 'prompt-tab-' + target)
    if (index < 0) return
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? 2 : event.key === 'ArrowRight' ? (index + 1) % 3 : event.key === 'ArrowLeft' ? (index + 2) % 3 : -1
    if (next < 0) return
    event.preventDefault()
    select(roles[next][0])
  }
  const form = el('div', 'prompt-rules-form')
  form.id = 'prompt-rules-panel'
  form.setAttribute('role', 'tabpanel')
  form.setAttribute('aria-labelledby', 'prompt-tab-' + promptTarget)
  if (promptTarget === 'shared') {
    form.append(
      promptRuleField('personality', L('Shared personality', '共同性格'), L('For example: direct, thoughtful and warm.', '例如：自然直接、有主见、认真负责。')),
      promptRuleField('team.communication', L('Communication', '沟通方式'), L('Use the language of the request; lead with the result.', '使用用户的语言，先说结论，再说明依据。')),
      promptRuleField('team.scope', L('Work scope', '工作范围'), L('Describe the work your team handles.', '填写团队负责的工作和处理范围。')),
      promptRuleField('team.delivery', L('Delivery standards', '交付标准'), L('Provide usable results, files and verification.', '提供可直接使用的结果、文件或链接，以及检查情况。')))
  } else {
    form.classList.add('prompt-rules-role')
    form.append(promptRuleField(promptTarget, promptTarget === 'router' ? L('Task coordination', '任务协调要求') : L('Task execution', '任务执行要求'),
      promptTarget === 'router' ? L('Define how Router accepts, delegates and follows up on work.', '填写接收需求、分派任务和汇报结果的要求。') : L('Define how Workers carry out and check their work.', '填写执行任务、检查结果和交付产物的要求。')))
  }
  const advanced = detail(L('Advanced settings', '高级设置'), add(el('div', 'prompt-advanced-fields'),
    promptRuleField('shared', L('Additional shared rules', '补充通用规则')),
    promptRuleField('delivery', L('Reply format', '回复格式')),
    promptDisclosure('prompt-builtins', L('Built-in rules', '内置规则'), add(el('div', 'prompt-template-list'),
      ...(S.promptIndex?.parts || []).map(promptTemplate),
      S.promptIndex ? null : opButton(L('View built-in rules', '查看内置规则'), loadPrompts, 'button'))),
    promptDisclosure('prompt-skills', L('Team skills', '团队技能'), jsonField('prompts.skills', L('Skills (JSON)', '技能（JSON）'), { objectType: 'object' }))))
  advanced.className = 'prompt-rules-advanced'
  advanced.open = entryState.promptView === 'templates'
  advanced.ontoggle = () => {
    if (!advanced.isConnected) return
    entryState.promptView = advanced.open ? 'templates' : 'roles'
  }
  advanced.querySelector('summary').append(icon('forward'))
  page.append(tabs, form, advanced)
  const dialog = promptPreviewDialog()
  if (dialog) page.append(dialog)
  return [page]
}
function controlNewConnection(id) {
  opNavigate('detail', id, { creating: true, source: '' })
}
function controlConnectionsPage() {
  const configured = entryState.data.entries.filter(entry => entry.status !== 'not-configured')
  const result = [opHeading(L('Conversation entries', '会话入口'), null,
    configured.length ? opButton(L('Prepare usage instructions', '生成使用说明'),
      () => shareEntries(configured.map(entry => entry.id)), 'button') : null,
    opButton(L('New connection', '新建接入'), () => opNavigate('catalogue'), 'button primary', 'plus'))]
  const connections = []
  for (const entry of entryState.data.entries) {
    const sources = entry.category === 'client' ? (entry.status !== 'not-configured' ? [null] : []) : entry.sources || []
    for (const source of sources) {
      const name = source?.label || entryName(entry)
      const scopes = connectionScope(entry, source)
      const state = source
        ? source.enabled === false ? 'disabled' : source.verification?.verified ? 'verified' : 'configured'
        : entry.status
      const label = state === 'disabled' ? L('Disabled', '已停用') :
        state === 'configured' ? L('Awaiting verification', '待验证') : entryStateLabel(state)
      const cells = [
        add(el('div', 'table-title'), opMark(entry.id), add(el('div'), el('strong', '', name), el('small', 'hint', entryName(entry)))),
        el('span', '', scopes || '—'),
        el('span', 'pill ' + (state === 'verified' ? 'green' : state === 'disabled' ? 'neutral' : 'amber'), label),
        opButton(L('Manage', '管理'), () => opNavigate('detail', entry.id, { source: source?.id || '' }), 'button')
      ]
      connections.push({ title: name + ' ' + entryName(entry) + ' ' + scopes, state, cells })
    }
  }
  const mapped = new Set(entryState.data.entries.flatMap(entry => (entry.sources || []).map(source => source.id)))
  for (const source of S.base.config.sources.filter(source => !mapped.has(source.id))) {
    const name = source.kind === 'local' ? L('Local assistant', '本机助手') : source.id
    const state = source.enabled ? 'configured' : 'disabled'
    connections.push({ title: name, state, cells: [
      add(el('div', 'table-title'), opMark(source.kind), el('strong', '', name)),
      el('span', '', source.listenScopes?.length ? L(source.listenScopes.length + ' scopes', source.listenScopes.length + ' 个监听范围') : '—'),
      el('span', 'pill neutral', source.enabled ? L('Configured', '已配置') : L('Disabled', '已停用')),
      opButton(L('Manage', '管理'), () => opNavigate('detail', 'source', { source: source.id }), 'button')
    ] })
  }
  if (!connections.length) return [...result, opEmpty(L('No connections. Use New connection to add one.', '尚无接入。点击「新建接入」开始。'))]
  const search = el('input')
  search.type = 'search'
  search.id = 'connection-search'
  search.placeholder = L('Search software or connection', '搜索软件或接入')
  search.setAttribute('aria-label', search.placeholder)
  const states = el('select')
  states.setAttribute('aria-label', L('Connection status', '接入状态'))
  for (const [key, text] of [['', L('All states', '全部状态')], ['verified', L('Verified', '已验证')],
    ['configured', L('Awaiting verification', '待验证')], ['attention', L('Needs attention', '需处理')],
    ['disabled', L('Disabled', '已停用')]]) states.add(new Option(text, key))
  states.selectedIndex = 0
  const list = el('div')
  const draw = () => {
    const matches = connections.filter(item => (states.selectedIndex <= 0 || item.state === states.value) &&
      item.title.toLowerCase().includes(search.value.trim().toLowerCase()))
    list.replaceChildren(matches.length ? workspaceTable([
      L('Connection', '接入名称'), L('Listening scope', '监听范围'), L('Status', '状态'), L('Action', '操作')
    ], matches.map(item => item.cells)) : opEmpty(L('No matching connections.', '没有符合条件的接入。')))
  }
  search.oninput = states.onchange = draw
  draw()
  return [...result, add(el('div', 'workspace-search'), search, states), list,
    entryState.share ? entryShareResult() : null]
}
function connectionScope(entry, source) {
  if (!source) return entry.usage?.location || L('Host client', '宿主客户端')
  const scopes = source.scopes || []
  const labels = scopes.map(scope => typeof scope === 'object' ? scope.label :
    entry.id === 'github' ? scope : '').filter(Boolean)
  if (labels.length) return labels.join(', ')
  if (scopes.length) return L(scopes.length + ' configured scopes', scopes.length + ' 个监听范围')
  return entry.usage?.location || ''
}
function resetNewModel() {
  Object.assign(entryModel, {
    creating: true, name: '', mode: 'api', existingId: '', provider: 'openai',
    endpoint: '', protocol: 'openai-responses', model: '', credential: '', open: true,
    touched: false, plan: null, check: null, saved: false
  })
}
function controlNewModel() {
  if (!connectionStudio.touched && !entryModel.touched) {
    resetNewModel()
    Object.assign(connectionStudio, { kind: 'api', provider: '', name: '', command: '', args: '', model: '', auth: null, check: null, requestId: '', definitionId: '', editing: '', drafts: {}, plan: null,
      account: '', ownerSource: '', ownerActor: '', background: false, models: [] })
  }
  opNavigate('model-new')
}
function controlModels() { return connectionLibrary() }

async function controlTaskAction(action,id){
 if(action==='retry'&&!confirm(L('Have you checked the original conversation and files for uncertain effects?','是否已核对原会话和文件，确认没有不确定的副作用？')))return
 await entryRun('task-action',async()=>{await api('/action',{action,id});operator.drawer=await api('/entry-workspace/task/'+encodeURIComponent(id));await readOperatorWork()})
}
