// Inventory is reported by the host. Reading it never connects to a tool server.
const integrations = { data: null, error: '', receipts: null, next: null, draft: '', draftError: '', resources: new Map() }
function integrationsReset() {
  Object.assign(integrations, { data: null, error: '', receipts: null, next: null, draft: '', draftError: '', resources: new Map() })
}
async function integrationsDiscover() {
  try {
    const data = await api('/integrations')
    if (!Array.isArray(data.tools) || !data.tools.every(item => typeof item?.id === 'string' && typeof item.label === 'string' && typeof item.enabled === 'boolean' && Array.isArray(item.allowedTools) && item.allowedTools.every(name => typeof name === 'string')) ||
        !Array.isArray(data.sources) || !data.sources.every(item => typeof item?.id === 'string' && typeof item.kind === 'string') ||
        !Array.isArray(data.adapters) || !data.adapters.every(item => typeof item?.kind === 'string' && typeof item.label === 'string')) throw Error('Invalid integration inventory')
    integrations.data = data; integrations.error = ''
  } catch (error) {
    if (error.payload?.code === 'workspace_obsolete') return
    integrations.data = null
    integrations.error = [404, 405].includes(error.status) ? '' : error.message
  }
}
function integrationTools() { return integrations.data?.tools || S.snap?.toolConnections || [] }
function integrationGrants(current) {
  const section = el('section', 'integration-grants')
  section.append(el('h3', '', L('External tools', '外部工具')))
  if (current.router) {
    section.append(el('p', 'team-help', L('Router delegates external tool work to Workers.', 'Router 通过 Worker 执行外部工具任务。')))
    return section
  }
  const tools = integrationTools(), own = get(S.draft, current.path + '.toolConnections')
  const definition = S.draft.backends?.[get(S.draft, current.path + '.backend')]
  const effective = own ?? definition?.defaults?.toolConnections ?? []
  section.append(el('p', 'team-help', L('Grants apply on the next activation. Connection status is not a connectivity test.', '授权在下次激活时生效。已配置不代表连接已验证。')))
  const mode = el('select'); mode.id = 'team-tool-grant-mode'
  for (const [value, text] of [['inherit', L('Inherit connection defaults', '继承模型连接默认授权')], ['custom', L('Set for this Worker', '单独设置此 Worker')]]) {
    const option = el('option', '', text); option.value = value; mode.append(option)
  }
  mode.value = own === undefined ? 'inherit' : 'custom'
  mode.onchange = () => { teamWrite('toolConnections', mode.value === 'inherit' ? undefined : [...effective]); render() }
  const label = el('label', '', L('Authorization mode', '授权方式')); label.htmlFor = mode.id
  section.append(label, mode)
  const known = new Set(tools.map(item => item.id))
  for (const item of [...tools, ...effective.filter(id => !known.has(id)).map(id => ({ id, label: id, enabled: false, missing: true, allowedTools: [] }))]) {
    const check = el('input'); check.type = 'checkbox'; check.checked = effective.includes(item.id)
    check.id = 'tool-grant-' + item.id
    check.disabled = own === undefined || (!item.enabled && !check.checked)
    check.onchange = () => {
      const next = new Set(get(S.draft, current.path + '.toolConnections') || [])
      if (check.checked) next.add(item.id); else next.delete(item.id)
      teamWrite('toolConnections', [...next])
    }
    const row = el('label', 'team-toggle'); row.htmlFor = check.id
    row.append(check, add(el('span'), el('strong', '', item.label), el('small', '', item.missing ? L('Unavailable; remove this grant', '连接不存在，请移除授权') : (item.enabled ? item.allowedTools.join(', ') : L('Disabled', '已停用')))))
    section.append(row)
  }
  if (!tools.length) section.append(el('p', 'team-help', L('No external tool connections configured.', '尚未配置外部工具连接。')))
  section.append(opButton(L('Manage tools and apps', '管理工具与应用'), () => opNavigate('integrations'), 'text-button'))
  return section
}
// /read returns bounded pages, not the resource object itself. Keep the cursor
// stable when appending text so a receipt is never assembled from two snapshots.
function integrationResource(resource, title) {
  const box = el('section', 'integration-resource'), output = el('div'), button = opButton(L('Read receipt', '读取回执'), read, 'button')
  const epoch = workspaceContext.epoch
  let state = integrations.resources.get(resource)
  if (!state) { state = { offset: 0, content: '', busy: false, done: false, error: '' }; integrations.resources.set(resource, state) }
  box.append(el('h4', '', title), output, button)
  state.paint = () => {
    if (epoch !== workspaceContext.epoch) return
    output.replaceChildren(...(state.content ? [raw(state.content)] : []))
    if (state.error) { const message = el('p', 'alert error', state.error); message.setAttribute('role', 'alert'); output.append(message) }
    button.disabled = state.busy
    button.textContent = state.busy ? L('Reading…', '正在读取…') : state.content ? L('Load more', '继续读取') : L('Read receipt', '读取回执')
    button.hidden = state.done
    output.tabIndex = state.done ? 0 : -1
  }
  state.paint()
  async function read() {
    if (state.busy || state.done) return
    state.busy = true; state.error = ''; state.paint()
    try {
      const page = await api('/read', { resource, offset: state.offset, limit: 8000, ...(state.cursor ? { cursor: state.cursor } : {}) })
      if (epoch !== workspaceContext.epoch) return
      if (typeof page.text !== 'string') throw Error('Invalid resource page')
      state.content += page.text; state.cursor = page.cursor; state.offset = page.nextOffset; state.done = page.nextOffset == null
    } catch (error) {
      if (epoch === workspaceContext.epoch) state.error = error.message
    } finally { state.busy = false; if (epoch === workspaceContext.epoch) state.paint() }
  }
  return box
}
async function integrationReadReceipts(append = false) {
  await entryRun('tool-receipts', async () => {
    const page = await api('/read', { resource: 'tool-calls', offset: append ? integrations.next : 0, pageSize: 20 })
    if (!Array.isArray(page.items)) throw Error('Invalid tool receipts')
    if (!append) for (const key of integrations.resources.keys()) if (key.startsWith('tool-call/')) integrations.resources.delete(key)
    integrations.receipts = append ? [...integrations.receipts, ...page.items] : page.items
    integrations.next = page.nextOffset
  })
}
function integrationDeployment() {
  const panel = el('section', 'integration-deployment')
  panel.append(el('h2', '', L('Deploy a connection', '部署新连接')),
    el('p', 'team-help', L('Download a configuration fragment, merge it into the host configuration, then restart the host. This does not save online settings or test connectivity.', '下载配置片段，合并至宿主配置后重启。这不会保存在线设置，也不会测试连通性。')))
  const templates = {
    stdio: { toolConnections: { my_tools: { label: 'My tools', transport: { kind: 'stdio', command: '/absolute/path/to/mcp-server', args: [], env: {} }, allowedTools: ['exact_tool_name'], timeoutMs: 30000 } } },
    http: { toolConnections: { my_tools: { label: 'My tools', transport: { kind: 'http', url: 'https://example.com/mcp', headerEnv: { Authorization: 'MY_MCP_AUTHORIZATION' } }, allowedTools: ['exact_tool_name'], timeoutMs: 30000 } } },
    adapter: { sourcePlugins: [{ module: '/absolute/path/to/source-plugin.mjs' }], sources: [{ id: 'my_app', kind: 'my_adapter', cwd: '/absolute/path/to/workspace', allowedActors: ['actor-id'], capabilities: { events: true, replies: true, resources: true }, options: {} }] }
  }
  const choices = el('div', 'integration-actions')
  for (const [key, label] of [['stdio', 'MCP · stdio'], ['http', 'MCP · HTTP'], ['adapter', L('Application adapter', '应用适配器')]]) choices.append(opButton(label, () => {
    if (integrations.draft && !confirm(L('Replace the deployment draft?', '替换当前部署草稿？'))) return
    integrations.draft = JSON.stringify(templates[key], null, 2); integrations.draftError = ''; render()
  }, 'button'))
  panel.append(choices)
  if (integrations.draft) {
    const input = el('textarea', 'json-editor'); input.id = 'integration-deployment-json'; input.rows = 14; input.spellcheck = false; input.value = integrations.draft
    input.oninput = () => { integrations.draft = input.value; integrations.draftError = ''; panel.querySelector('.alert')?.remove() }
    const label = el('label', '', L('Deployment fragment (JSON)', '部署配置片段（JSON）')); label.htmlFor = input.id
    panel.append(label, input, el('p', 'team-help', L('Use exact tool names. env and headerEnv reference host environment variable names. Replace example values; preserve existing sources and plugins when merging. Export checks JSON syntax only.', '工具名须完整匹配。env 和 headerEnv 填宿主环境变量名。请替换示例值，合并时保留原有 sources 和插件。导出仅检查 JSON 语法。')),
      opButton(L('Download fragment', '下载配置片段'), () => {
        try {
          const value = JSON.parse(integrations.draft)
          if (!value || Array.isArray(value) || typeof value !== 'object') throw Error(L('Expected a JSON object.', '请输入 JSON 对象。'))
          const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2) + '\n'], { type: 'application/json' }))
          const a = el('a'); a.href = url; a.download = 'agenthub-integration.fragment.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
        } catch (error) { integrations.draftError = error.message; render() }
      }, 'button primary'), opButton(L('Discard draft', '放弃草稿'), () => { integrations.draft = ''; integrations.draftError = ''; render() }, 'text-button'))
    if (integrations.draftError) { const error = el('p', 'alert error', integrations.draftError); error.setAttribute('role', 'alert'); panel.append(error) }
  }
  return panel
}
function controlIntegrations() {
  const root = el('section', 'integrations-page')
  root.append(el('h1', '', L('Tools and apps', '工具与应用')))
  if (integrations.error) root.append(el('p', 'alert error', integrations.error))
  if (!integrations.data) {
    root.append(el('p', 'team-help', L('Integration inventory is unavailable on this host.', '此宿主尚未提供接入清单。')))
    return [root]
  }
  const tools = el('section'), cards = el('div', 'integration-grid')
  tools.append(el('h2', '', L('Worker tool connections', 'Worker 工具连接')), el('p', 'team-help', L('Configured connections. Grant access per Worker in Agent team → Tools.', '以下为已配置连接。请在 Agent 团队 → 工具中逐个授权 Worker。')))
  for (const item of integrations.data.tools) {
    const workers = teamWorkers().filter(worker => (worker.toolConnections ?? S.draft.backends?.[worker.backend]?.defaults?.toolConnections ?? []).includes(item.id))
    cards.append(add(el('article', 'integration-card'), el('h3', '', item.label), el('span', 'pill', (item.enabled ? L('Configured', '已配置') : L('Disabled', '已停用')) + ' · ' + item.transport),
      el('p', 'integration-tool-names', item.allowedTools.join(' · ')), el('p', 'team-help', L('Granted in draft: ', '当前草稿授权：') + (workers.map(w => w.label || w.id).join(', ') || L('None', '无'))),
      opButton(L('Set Worker access', '设置 Worker 授权'), () => { teamStudio.selected = teamWorkers()[0]?.id || 'router'; teamStudio.tab = 'tools'; opNavigate('execution', '', { view: 'configuration' }) }, 'button')))
  }
  if (!integrations.data.tools.length) cards.append(el('p', 'team-help', L('No tool connections configured.', '尚未配置工具连接。')))
  tools.append(cards); root.append(tools)
  const apps = el('section'); apps.append(el('h2', '', L('Application adapters', '应用适配器')))
  const grid = el('div', 'integration-grid')
  for (const adapter of integrations.data.adapters) {
    const card = add(el('article', 'integration-card'), el('h3', '', adapter.label || adapter.kind))
    const sources = integrations.data.sources.filter(source => source.kind === adapter.kind)
    for (const source of sources) card.append(el('strong', '', source.id + (source.enabled ? '' : ' · ' + L('Disabled', '已停用'))), el('p', 'team-help', ['events', 'replies', 'resources'].filter(key => source.capabilities?.[key]).map(key => ({ events: L('Receive events', '接收事件'), replies: L('Send replies', '发送回复'), resources: L('Read resources', '读取资源') })[key]).join(' · ') || L('No capabilities enabled', '未开启能力')))
    if (!sources.length) card.append(el('p', 'team-help', L('Available; no source configured', '可用，尚未配置来源')))
    grid.append(card)
  }
  apps.append(grid); root.append(apps)
  const receipts = el('section'); receipts.append(el('h2', '', L('Tool receipts', '工具回执')), opButton(L('Refresh receipts', '刷新回执'), () => integrationReadReceipts(), 'button'))
  for (const receipt of integrations.receipts || []) {
    const state = { running: L('Running', '执行中'), complete: L('Complete', '已完成'), uncertain: L('Outcome uncertain', '结果待核实') }[receipt.state] || receipt.state
    const row = add(el('article', 'integration-card'), el('h3', '', receipt.connection + ' / ' + receipt.tool), el('p', '', state))
    if (receipt.state === 'uncertain') row.append(el('p', 'team-help', L('Check the external result before retrying.', '重试前请先核对外部执行结果。')))
    row.append(integrationResource(receipt.resource, L('Arguments and result', '参数与结果'))); receipts.append(row)
  }
  if (integrations.receipts?.length === 0) receipts.append(el('p', 'team-help', L('No recorded tool calls.', '尚无工具调用记录。')))
  if (integrations.next != null) receipts.append(opButton(L('More receipts', '更多回执'), () => integrationReadReceipts(true), 'button'))
  root.append(receipts, integrationDeployment()); return [root]
}
