function controlConnections() {
  return Object.entries({ codex: { kind: 'codex' }, ...(S.base?.config.backends || {}) }).map(([id, backend]) => {
    let endpoint = ''
    try { endpoint = new URL(backend.baseUrl).hostname } catch {}
    return { id, kind: backend.kind, model: backend.model || (backend.kind === 'codex' ? S.base?.config.model : ''),
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
function executionDraft() {
  const config = S.draft
  const route = config.execution || S.base.config.execution
  const backend = route.backend ?? S.base.config.execution.backend
  return {
    router: route.router?.backend ?? route.roles?.router ?? backend,
    routerOptions: clone(route.router || {}),
    routerModel: route.router?.model || config.models?.router || '',
    workers: clone(route.workers?.length ? route.workers : Array.from(
      { length: Math.min(10, Math.max(1, config.concurrency || 1)) },
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
function controlPrompts() {
  const templates = entryState.promptView === 'templates'
  const nav = workspaceTabs(L('Prompt views', '提示词视图'), [
    [L('Role instructions', '角色指令'), !templates, () => opNavigate('prompts', '', { view: 'roles' })],
    [L('Team and templates', '团队与模板'), templates, () => opNavigate('prompts', '', { view: 'templates' })]
  ])
  const result = [opHeading(L('Prompts', '提示词'), null), nav]
  const preview = add(el('div', 'settings-stack'),
    selector('preview-role', L('Instruction role', '合成指令角色'), [['router', 'Router'], ['worker', 'Worker']], S.previewRole, role => {
      S.previewRole = role
      S.previewMode = ''
      S.preview = null
      render()
    }),
    selector('preview-mode', L('Task mode', '任务模式'), [
      ['', L('From entry configuration', '按入口配置')],
      ['standalone', L('Standalone task', '独立任务')],
      ...(S.previewRole === 'worker' ? [['delegated', L('Router delegation', 'Router 委派')]] : []),
      ['goal', L('Managed goal', '受管理目标')],
      ['project', L('Code project', '代码项目')],
      ...(S.previewRole === 'worker' ? [['subagent', L('Worker helper', 'Worker 助手')]] : []),
    ], S.previewMode, mode => { S.previewMode = mode; S.preview = null; render() }),
    selector('preview-source', L('Saved entry', '已保存入口'), [['', L('Default entry', '默认入口')],
      ...(S.base.config.sources || []).map(source => [source.id, source.label || source.id])
    ], S.previewSourceId, id => { S.previewSourceId = id; S.preview = null; render() }),
    S.previewRole === 'worker' ? selector('preview-worker', 'Worker', [['', L('Default Worker', '默认 Worker')],
      ...executionDraft().workers.map(worker => [worker.id, worker.label || worker.id])
    ], S.previewWorkerId, id => { S.previewWorkerId = id; S.preview = null; render() }) : null,
    opButton(L('Preview complete role instructions', '预览完整角色指令'), previewPrompt, 'button'),
    el('p', 'hint', L('Uses the selected configuration and task mode. Task-specific context uses placeholders.', '按所选配置与任务模式组装，具体任务上下文使用占位符。')))
  if (S.preview) {
    const output = detail(S.preview.fromDraft
      ? L('Draft instructions (based on r', '草稿合成指令（基于 r') + S.preview.baseRevision + ')'
      : L('Saved instructions (r', '已保存的合成指令（r') + S.preview.revision + ')', add(el('div', 'stack'),
        el('p', 'hint', [S.preview.mode, S.preview.workerId, S.preview.backendId].filter(Boolean).join(' · ')),
        S.preview.baseInstructions ? detail(L('Managed runtime base', '受管理运行基础指令'), raw(S.preview.baseInstructions)) : null,
        ...(S.preview.sections || []).map(section => detail(section.id, add(el('div', 'stack'), el('p', 'hint', section.source), raw(section.text)))),
        detail(L('Combined role text', '完整角色文本'), raw(S.preview.text)),
        el('p', 'hint', L('Task input and output/tool schemas are supplied separately. Provider framing and platform-owned instructions are outside this preview.', '任务输入与输出、工具 schema 单独提供；此处不包含模型服务的协议封装和平台内部指令。'))))
    output.id = 'control-prompt-preview'
    output.open = true
    preview.append(output)
  }
  if (templates) {
    result.push(add(el('div', 'workspace-settings settings-with-aside'),
      add(el('div', 'settings-stack'),
        group(L('Team instructions', '团队指令'), null,
          inputField('prompts.team.communication', L('Communication', '沟通'), { type: 'area' }),
          inputField('prompts.team.scope', L('Scope', '范围'), { type: 'area' }),
          inputField('prompts.team.delivery', L('Delivery expectations', '交付要求'), { type: 'area' })),
        group(L('Built-in templates', '内置模板'), null,
          ...(S.promptIndex?.parts || []).map(promptTemplate),
          S.promptIndex ? null : opButton(L('Load templates', '读取模板'), loadPrompts, 'button')),
        detail(L('Team skills', '团队技能'), jsonField('prompts.skills', L('Skills (JSON)', '技能（JSON）'), { objectType: 'object' }))),
      panel(L('Effective instructions', '生效指令'), preview)))
    return result
  }
  const roles = [['shared', L('Shared', '共享')], ['router', 'Router'], ['worker', 'Worker'], ['delivery', L('Reply format', '回复格式')]]
  const label = ({
    shared: L('Applies to Router and every Worker', '作用于 Router 和所有 Worker'),
    router: L('When to accept work and how to define its scope', '何时接任务，如何确定处理范围'),
    worker: L('How work is carried out and checked', '如何执行任务和验证结果'),
    delivery: L('How replies are formatted', '结果如何组织和回复')
  })[promptTarget]
  const roleTabs = affectSegmented({
    id: 'prompt-role', label: L('Instruction target', '指令用途'), value: promptTarget,
    options: roles.map(([value, label]) => ({ value, label, controls: 'prompt-role-panel' })),
    onChange: value => {
      promptTarget = value
      if (value === 'router' || value === 'worker') S.previewRole = value
      S.previewMode = ''
      S.preview = null
      render()
    }
  })
  roleTabs.classList.add('workspace-role-tabs')
  const input = el('textarea', 'prompt-editor')
  input.id = 'control-prompt-editor'
  input.value = S.draft.prompts?.[promptTarget] || ''
  input.placeholder = L('Leave empty to use built-in instructions.', '留空使用系统默认指令。')
  input.oninput = () => editPrompt(promptTarget, input.value)
  const field = el('label', 'prompt-purpose', label)
  field.htmlFor = input.id
  const editor = add(el('section', 'prompt-config'), field, input)
  editor.id = 'prompt-role-panel'
  editor.setAttribute('role', 'tabpanel')
  editor.setAttribute('aria-labelledby', 'prompt-role-' + promptTarget)
  result.push(roleTabs, add(el('div', 'settings-with-aside'), editor, panel(L('Effective instructions', '生效指令'), preview)))
  return result
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
    Object.assign(connectionStudio, { kind: 'api', provider: '', name: '', command: '', args: '[]', model: '', auth: null, check: null, requestId: '', definitionId: '', editing: '',
      account: '', ownerSource: '', ownerActor: '', background: false, models: [] })
  }
  opNavigate('model-new')
}
function controlModels() {
  if (entryState.page === 'model-new') return connectionCreation()
  if (connectionStudio.editing && S.snap?.editableKeys?.includes('backends')) return connectionDefinitionEditor()
  const architecture = operator.work?.architecture
  const services = controlConnections()
  const rows = services.map(service => {
    const check = opButton(L('Check connection', '检查连接'), () => {
      if (entryModel.touched && !confirm(L('Discard the unsaved service draft?', '放弃未保存的模型服务草稿？'))) return
      Object.assign(entryModel, {
        creating: false, name: '', mode: 'existing', existingId: service.id, open: true,
        plan: null, check: null, saved: false, touched: false, credential: ''
      })
      void checkEntryModel()
    }, 'button')
    const roles = []
    if (S.base.config.decision?.provider?.kind === 'backend' && S.base.config.decision.provider.id === service.id) roles.push(L('Decision layer', '决策层'))
    if (architecture?.router?.backend === service.id) roles.push('Router')
    for (const [index, worker] of (architecture?.workers || []).entries())
      if (worker.backend === service.id) roles.push('Worker ' + (index + 1))
    if (S.base.config.execution.roles.subagent === service.id) roles.push(L('Subagent', '子代理'))
    const protocol = ({codex: 'Codex CLI', 'openai-responses': 'OpenAI Responses',
      'openai-chat': 'OpenAI Chat Completions', anthropic: 'Anthropic Messages'})[service.kind] || service.kind
    const actions = add(el('div', 'actions'), check)
    if (S.snap?.editableKeys?.includes('backends') && S.draft.backends?.[service.id]) actions.append(opButton(L('Edit', '编辑'), () => {
      connectionStudio.editing = service.id; render()
    }, 'button'))
    const type = ({api: L('API service', 'API 服务'), cli: L('CLI backend', 'CLI 后端'), subscription: L('Subscription', '订阅账号')})[service.connectionType]
    const mark = add(el('span', 'model-service-mark'), icon(service.connectionType === 'cli' ? 'terminal' : 'cpu'))
    return add(el('li', 'model-service-row'),
      add(el('div', 'model-service-identity'), mark, add(el('div'), el('h3', '', service.label), el('span', 'model-service-meta', type + ' · ' + protocol))),
      add(el('div', 'model-service-assignment'), el('span', 'model-service-model', service.model || L('Service default', '服务默认模型')),
        add(el('div', 'model-service-roles'), ...roles.map(role => el('span', '', role)), roles.length ? null : el('span', '', L('Unassigned', '未分配')))), actions)
  })
  const page = el('div', 'models-page')
  page.append(opHeading(L('Model connections', '模型连接'), null,
    opButton(L('New model connection', '新建模型连接'), controlNewModel, 'button primary', 'plus')),
    add(el('ul', 'model-service-list'), ...rows))
  if (entryModel.check || entryModel.saved) page.append(entryModelResult())
  if (S.snap?.editableKeys?.includes('decision')) page.append(decisionSettings())
  return [page]
}

async function controlTaskAction(action,id){
 if(action==='retry'&&!confirm(L('Have you checked the original conversation and files for uncertain effects?','是否已核对原会话和文件，确认没有不确定的副作用？')))return
 await entryRun('task-action',async()=>{await api('/action',{action,id});operator.drawer=await api('/entry-workspace/task/'+encodeURIComponent(id));await readOperatorWork()})
}
