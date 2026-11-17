const connectionLibraryState = { search: '', filter: 'all', selected: '' }
function connectionProvider(service) {
  const definition = service.definition || S.base?.config.backends?.[service.id] || { kind: service.kind }
  if (definition.subscription) return 'openai'
  if (definition.kind === 'codex') return 'codex'
  if (definition.kind === 'plugin') return ({ 'claude-code': 'anthropic', 'gemini-cli': 'gemini', opencode: 'opencode' })[definition.plugin] || definition.plugin
  let host = ''; try { host = new URL(definition.baseUrl).hostname } catch {}
  return host === 'api.deepseek.com' ? 'deepseek' : host === 'api.openai.com' ? 'openai' : host === 'api.anthropic.com' ? 'anthropic' : 'custom'
}
function connectionBrand(provider) {
  const mark = opMark(provider, 'small'); mark.classList.add('connection-brand'); return mark
}
function connectionUses(id, config = S.base.config) {
  const uses = [], route = config.execution, fallback = route.backend
  if ((route.router?.backend ?? route.roles?.router ?? fallback) === id) uses.push(route.router?.label || 'Router')
  const workers = route.workers ?? Array.from({ length: config.concurrency }, (_, i) => ({ id: 'worker-' + (i + 1), backend: route.roles?.worker ?? fallback }))
  for (const worker of workers) if (worker.backend === id) uses.push(worker.label || worker.id)
  if ((route.roles?.subagent ?? fallback) === id) uses.push(L('Subagent default', '子代理默认'))
  if (config.decision?.provider?.kind === 'backend' && config.decision.provider.id === id) uses.push(L('Router decision layer', 'Router 决策层'))
  if (route.management?.backends?.includes(id)) uses.push(L('External Router access', '外部 Router 授权'))
  if (fallback === id && !uses.length) uses.push(L('Execution default', '执行默认'))
  // Even inactive legacy role references must be replaced before configuration deletion.
  for (const [role, value] of Object.entries(route.roles || {})) if (value === id && !uses.length) uses.push(role)
  return [...new Set(uses)]
}
function connectionProtocolProbe(service) {
  const probe = connectionStudio.backendProbes?.[service.id]
  return probe?.revision === S.snap?.current?.revision && probe?.workspaceId === workspaceContext.activeId ? probe : null
}
async function connectionRunCheck(service) {
  if (service.kind === 'plugin') {
    const workspaceId = workspaceContext.activeId
    const result = await api('/api/execution-backends/probe', {id: service.id, revision: S.snap.current.revision})
    connectionStudio.backendProbes ||= {}
    connectionStudio.backendProbes[service.id] = {...result, workspaceId}
  } else {
    await api('/model-connections/check', {id: service.id, revision: S.base.revision})
    adopt(await snapshot())
  }
}
function connectionCheckStatus(service) {
  if (service.kind === 'plugin') {
    const probe = connectionProtocolProbe(service)
    return {result: null, text: !probe ? L('Protocol untested', '协议未探测') : probe.available ? L('Protocol reachable', '协议可达') : L('Protocol unavailable', '协议不可用'), state: !probe ? 'untested' : probe.available ? 'ready' : 'error'}
  }
  const result = S.snap?.connectionChecks?.[service.id]
  return { result, text: !result ? L('Not tested', '未测试') : !result.ok ? L('Test failed', '测试失败') : result.remoteVerified ? L('Model replied', '模型已回复') : L('Tool ready', '工具已就绪'),
    state: !result ? 'untested' : !result.ok ? 'error' : result.remoteVerified ? 'verified' : 'ready' }
}
function connectionStatusLabel(service) {
  const { text, state } = connectionCheckStatus(service)
  const label = add(el('span', 'connection-state state-' + state), icon(state === 'error' ? 'info' : ['ready', 'verified'].includes(state) ? 'check' : 'work'), el('span', '', text))
  return label
}
function connectionIdentity(service, clickable = false) {
  const label = clickable ? opButton(service.label, () => { connectionLibraryState.selected = service.id; render() }, 'connection-name') : el('strong', '', service.label)
  const type = { api: 'API', subscription: L('Subscription', '订阅账号'), cli: 'CLI' }[service.connectionType]
  const definition = service.definition, account = connectionStudio.accounts.find(a => a.id === definition?.subscription?.account)
  const meta = service.connectionType === 'subscription' ? account?.email || 'ChatGPT' : service.connectionType === 'cli' ? definition?.plugin || L('Roppo host', 'Roppo 运行主机') : service.endpoint
  return add(el('div', 'model-service-identity'), connectionBrand(connectionProvider(service)), add(el('div'), label, el('span', 'model-service-meta', [type, meta].filter(Boolean).join(' · '))))
}
function connectionLibrary() {
  if (entryState.page === 'model-new') return connectionCreation()
  if (connectionStudio.editing && S.snap?.editableKeys?.includes('backends')) return connectionDefinitionEditor()
  const page = el('section', 'models-page'), services = controlConnections()
  page.append(opHeading(L('Model connections', '模型连接'), null, opButton(L('New connection', '新建连接'), controlNewModel, 'button primary', 'plus')))
  const tabs = el('div', 'connection-filters'); tabs.setAttribute('role', 'group'); tabs.setAttribute('aria-label', L('Connection type', '接入方式'))
  for (const [id, label] of [['all', L('All', '全部')], ['api', 'API'], ['subscription', L('Subscription', '订阅账号')], ['cli', 'CLI']]) {
    const button = opButton('', () => { connectionLibraryState.filter = id; render() }, 'button')
    button.setAttribute('aria-pressed', String(connectionLibraryState.filter === id)); button.append(el('span', '', label), el('span', 'connection-count', String(services.filter(c => id === 'all' || c.connectionType === id).length))); tabs.append(button)
  }
  const search = el('input'); search.id = 'model-connection-search'; search.type = 'search'; search.placeholder = L('Search name, account or address', '搜索名称、账号或地址'); search.value = connectionLibraryState.search; search.setAttribute('aria-label', search.placeholder)
  page.append(add(el('div', 'connection-toolbar'), tabs, add(el('label', 'connection-search'), icon('search'), search)))
  const headings = add(el('div', 'connection-columns'), ...[L('Connection', '连接'), L('Latest test', '最近测试'), L('Used by', '使用情况'), L('Actions', '操作')].map(t => el('span', '', t))); headings.setAttribute('aria-hidden', 'true'); page.append(headings)
  const list = el('ul', 'model-service-list'), footer = el('div', 'connection-list-footer')
  const draw = () => {
    const query = connectionLibraryState.search.toLowerCase(), filtered = services.filter(s => (connectionLibraryState.filter === 'all' || s.connectionType === connectionLibraryState.filter) && [s.label, s.endpoint, connectionStudio.accounts.find(a => a.id === s.definition?.subscription?.account)?.email].join(' ').toLowerCase().includes(query))
    list.replaceChildren(...filtered.map(service => {
      const status = connectionCheckStatus(service), uses = connectionUses(service.id)
      const test = opButton(L('Test connection', '测试连接'), () => { connectionLibraryState.selected = service.id; render() }, 'text-button')
      const manage = opButton(L('Manage ', '管理 ') + service.label, () => { connectionLibraryState.selected = service.id; render() }, 'icon-button', 'advanced'); manage.dataset.connection = service.id
      return add(el('li', 'model-service-row'), connectionIdentity(service, true), add(el('div', 'connection-latest'), connectionStatusLabel(service), status.result ? el('time', 'model-service-meta', new Date(status.result.at).toLocaleString(lang === 'zh-CN' ? 'zh-CN' : 'en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })) : el('span', 'model-service-meta', L('No test recorded', '暂无测试记录'))),
        el('span', 'connection-usage', uses.length ? L(uses.length + ' uses', uses.length + ' 处使用') : L('Unused', '未使用')), add(el('div', 'actions'), test, manage))
    }))
    if (!filtered.length) list.append(add(el('li', 'connection-empty'), el('h3', '', L('No matching connections', '没有匹配的连接')), opButton(L('Clear search', '清除搜索'), () => { connectionLibraryState.search = ''; connectionLibraryState.filter = 'all'; render() }, 'button')))
    footer.replaceChildren(el('span', '', L(filtered.length + ' connections', filtered.length + ' 个连接')), el('span', '', L('Results reflect the last test only.', '测试结果仅反映上次检查状态。')))
  }
  search.oninput = () => { connectionLibraryState.search = search.value; draw() }; draw(); page.append(list, footer)
  const selected = services.find(s => s.id === connectionLibraryState.selected)
  if (selected) page.append(connectionDetails(selected))
  return [page]
}
function connectionDetails(service) {
  const dialog = el('dialog', 'connection-sheet'); dialog.setAttribute('aria-labelledby', 'connection-detail-title')
  const close = () => { connectionLibraryState.selected = ''; render(); queueMicrotask(() => document.querySelector('[data-connection="' + CSS.escape(service.id) + '"]')?.focus()) }
  const heading = el('h2', '', L('Connection details', '连接详情')); heading.id = 'connection-detail-title'
  dialog.append(add(el('div', 'connection-sheet-head'), heading, opButton(L('Close', '关闭'), close, 'icon-button', 'close')))
  const body = el('div', 'connection-sheet-body'), status = connectionCheckStatus(service), busy = entryState.busy === 'connection-check', uses = connectionUses(service.id)
  body.append(connectionIdentity(service), add(el('div', 'connection-key-value'), el('span', '', L('Default model', '默认模型')), el('span', '', service.model || L('Tool default', '工具默认模型'))))
  if (service.managedEligible === false) body.append(el('p', 'team-help', L('Cannot serve as a managed Worker. Missing: ', '无法担任受管 Worker，缺少：') + service.managedMissing.join(', ')))
  const probe = connectionProtocolProbe(service)
  const test = el('section', 'connection-test-section')
  test.append(el('h3', '', L('Connection test', '连接测试')), busy ? add(el('p', 'connection-check-line'), icon('refresh'), el('span', '', L('Checking…', '正在测试…'))) : connectionStatusLabel(service))
  if (status.result) test.append(connectionCheckView(status.result))
  if (service.kind === 'plugin' && probe) test.append(el('p', 'team-help', L('Authentication: ', '认证：') + (probe.authenticated === true ? L('verified', '已验证') : probe.authenticated === false ? L('required', '待认证') : L('unknown', '未知')) + ' · ' + new Date(probe.checkedAt).toLocaleTimeString() + ' · ' + L('Model call unverified', '模型调用未验证')))
  test.append(el('p', 'team-help', service.kind === 'plugin' ? L('Probes the protocol only. Model calls remain unverified.', '仅探测协议，模型调用仍未验证。') : service.connectionType === 'cli' ? L('Verifies installation and sign-in. It does not send a model request.', '验证安装和登录，不会发送模型请求。') : L('Sends a model request and may use credits.', '会发送少量模型请求，可能消耗额度。')))
  const check = opButton(service.kind === 'plugin' ? L('Probe protocol', '探测协议') : service.connectionType === 'cli' ? L('Check tool', '检查工具') : L('Run model test', '模型试运行'), () => entryRun('connection-check', () => connectionRunCheck(service)), 'button primary', 'play'); check.disabled = !!(entryState.busy || S.busy); test.append(check); body.append(test)
  body.append(el('h3', '', L('Used by', '正在使用')), uses.length ? add(el('div', 'model-service-roles'), ...uses.map(u => el('span', '', u))) : el('p', 'team-help', L('Available as a spare connection.', '暂无组件使用，可作为备用连接。')))
  const definition = S.draft.backends?.[service.id]
  if (definition || service.id === 'codex') body.append(opButton(L('Edit connection', '编辑连接'), () => {
    if (!S.draft.backends[service.id]) set(S.draft, 'backends.' + service.id, { kind: 'codex' })
    connectionStudio.editing = service.id; connectionStudio.check = null; connectionStudio.plan = null; connectionLibraryState.selected = ''; render()
  }, 'button'))
  dialog.append(body)
  const remove = opButton(L('Delete connection', '删除连接'), () => confirmWorkspaceAction(L('Delete this connection?', '删除此连接？'), L('The connection will be removed from the library. Existing conversation history is retained.', '连接将从储备库中移除，已有对话记录会保留。'), L('Delete', '删除'), async () => {
    const next = clone(S.draft.backends); delete next[service.id]; clearRelated('backends.' + service.id); S.draft.backends = next
    if (await save(['backends'])) { connectionLibraryState.selected = ''; render() }
  }), 'text-button team-danger')
  remove.disabled = uses.length > 0 || service.id === 'codex' || service.kind === 'plugin' || dirty() || !!entryState.busy || !!S.busy
  dialog.append(add(el('div', 'connection-sheet-footer'), remove, el('span', 'team-help', service.id === 'codex' ? L('Built-in executor', '内置执行器') : service.kind === 'plugin' ? L('Manage this backend in deployments', '请在部署中管理此后端') : uses.length ? L('Replace its usages first', '请先替换使用中的连接') : dirty() ? L('Save or discard your edits first', '请先保存或放弃未保存的更改') : '')))
  dialog.oncancel = e => { e.preventDefault(); close() }
  queueMicrotask(() => { if (dialog.isConnected && !dialog.open) dialog.showModal() })
  return dialog
}
function connectionPickerField(id, selected, change) {
  const service = controlConnections().find(s => s.id === selected)
  const button = opButton('', () => connectionOpenPicker(selected, change, button), 'button connection-picker-trigger'); button.id = id
  if (service) button.append(connectionBrand(connectionProvider(service)), el('span', '', service.label), connectionStatusLabel(service))
  else button.append(el('span', '', L('Choose connection', '选择连接')))
  const label = el('label', '', L('Model connection', '模型连接')); label.htmlFor = id
  return add(el('div', 'control-field'), label, button)
}
function connectionOpenPicker(selected, change, trigger) {
  const dialog = el('dialog', 'connection-sheet'); dialog.setAttribute('aria-labelledby', 'connection-picker-title')
  const close = () => { dialog.close(); dialog.remove(); trigger?.focus() }
  const heading = el('h2', '', L('Choose model connection', '选择模型连接')); heading.id = 'connection-picker-title'
  dialog.append(add(el('div', 'connection-sheet-head'), heading, opButton(L('Close', '关闭'), close, 'icon-button', 'close')))
  const body = el('div', 'connection-sheet-body'), search = el('input'); search.type = 'search'; search.placeholder = L('Search connections', '搜索连接'); search.setAttribute('aria-label', search.placeholder)
  const list = el('div', 'connection-picker-list'), draw = () => {
    const services = controlConnections().filter(s => (s.label + ' ' + s.endpoint).toLowerCase().includes(search.value.toLowerCase()))
    list.replaceChildren(...services.map(service => {
      const option = opButton('', () => { selected = service.id; draw() }, 'connection-picker-option'); option.setAttribute('aria-pressed', String(selected === service.id))
      option.append(connectionIdentity(service), connectionStatusLabel(service)); return option
    }))
    if (!services.length) list.append(el('p', 'team-help', L('No matching connections.', '没有匹配的连接。')))
  }
  search.oninput = draw; draw(); body.append(search, list); dialog.append(body)
  dialog.append(add(el('div', 'connection-sheet-footer'), opButton(L('Manage connections', '管理连接'), () => { close(); opNavigate('models') }, 'text-button'), opButton(L('Use connection', '使用此连接'), () => { close(); change(selected) }, 'button primary')))
  dialog.oncancel = e => { e.preventDefault(); close() }; app.querySelector('.operator-workspace').append(dialog); dialog.showModal(); search.focus()
}
