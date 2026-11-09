// Agent configuration is a revisioned draft. The graph never invents running work.
const teamStudio = { selected: 'router', tab: 'essentials', explain: false, step: 0 }
function teamFeatures() {
  const execution = S.draft?.execution || {}
  const declared = S.snap?.capabilities || {}
  const existing = !!execution.router || (execution.workers || []).some(worker =>
    ['effort', 'prompt', 'parameters', 'tools', 'timeoutMs'].some(key => Object.hasOwn(worker, key)))
  return {
    options: declared.agentOptions === true || existing || S.snap?.editableKeys?.includes('backends') === true,
    management: declared.workerManagement === true || !!execution.management || S.snap?.editableKeys?.includes('backends') === true
  }
}
function teamWorkers() { return executionDraft().workers }
function teamCurrent() {
  const workers = teamWorkers()
  const index = workers.findIndex(worker => worker.id === teamStudio.selected)
  if (index < 0) teamStudio.selected = 'router'
  return index < 0
    ? { router: true, index: -1, value: S.draft.execution.router || {}, path: 'execution.router', name: 'Router' }
    : { router: false, index, value: workers[index], path: 'execution.workers.' + index, name: workers[index].label || 'Worker ' + (index + 1) }
}
function teamMaterializeWorkers() {
  if (!S.draft.execution.workers?.length) S.draft.execution.workers = teamWorkers()
}
function teamWrite(key, value) {
  const current = teamCurrent()
  if (!current.router) teamMaterializeWorkers()
  let path = current.path + '.' + key
  if (current.router && !teamFeatures().options) {
    if (key === 'backend') path = 'execution.roles.router'
    if (key === 'model') path = 'models.router'
    if (key === 'prompt') path = 'prompts.router'
  }
  clearRelated(path)
  set(S.draft, path, value)
  S.preview = null
  updateBar()
  teamRefreshSummary()
}
function teamRefreshSummary() {
  const current = teamCurrent(), node = document.querySelector('[data-team-id="' + CSS.escape(teamStudio.selected) + '"]')
  if (!node) return
  const route = executionDraft(), value = current.router ? route.routerModel : current.value.model
  const service = controlConnections().find(item => item.id === (current.router ? route.router : current.value.backend))
  node.querySelector('.team-node-name').textContent = current.name
  node.querySelector('.team-node-model').textContent = value || service?.model || L('Service default', '连接默认模型')
}
function teamSelect(id, tab = teamStudio.tab) {
  teamStudio.selected = id
  teamStudio.tab = tab
  render()
  document.getElementById('team-inspector-title')?.focus({ preventScroll: true })
  if (matchMedia('(max-width: 960px)').matches) document.getElementById('team-inspector')?.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' })
}
function teamAddWorker(cloneSelected = false) {
  const workers = teamWorkers()
  if (workers.length >= 10) return
  const selected = workers.find(worker => worker.id === teamStudio.selected)
  let index = 1
  while (workers.some(worker => worker.id === 'worker-' + index)) index++
  const worker = cloneSelected && selected ? { ...clone(selected), id: 'worker-' + index,
    label: (selected.label || L('Worker', '执行者')) + L(' copy', ' 副本') }
    : { id: 'worker-' + index, backend: executionDraft().router }
  if (Object.hasOwn(worker, 'state')) worker.state = 'enabled'
  workers.push(worker)
  set(S.draft, 'execution.workers', workers)
  S.draft.concurrency = workers.length
  teamStudio.selected = worker.id
  teamStudio.tab = 'essentials'
  render()
  document.getElementById('team-name')?.focus()
}
function teamRemoveWorker() {
  const current = teamCurrent()
  if (current.router || teamWorkers().length <= 1) return
  confirmWorkspaceAction(L('Remove this Worker?', '移除此 Worker？'),
    L('Remove it from the configuration. Existing work is not cancelled; its history is retained.',
      '将其从配置中移除。正在执行的任务不会因此取消，历史记录会保留。'),
    L('Remove Worker', '移除 Worker'), () => {
      const previous = teamWorkers(), workers = previous.filter(worker => worker.id !== teamStudio.selected)
      for (const map of [S.buffers, S.errors]) {
        const moved = []
        for (const [path, value] of map) {
          const match = /^execution\.workers\.(\d+)(\..*)$/.exec(path)
          if (!match) continue
          map.delete(path)
          const index = workers.findIndex(worker => worker.id === previous[Number(match[1])]?.id)
          if (index >= 0) moved.push(['execution.workers.' + index + match[2], value])
        }
        for (const [path, value] of moved) map.set(path, value)
      }
      S.draft.execution.workers = workers
      S.draft.concurrency = workers.length
      teamStudio.selected = 'router'
      render()
      document.getElementById('team-node-router')?.focus()
    })
}
function teamNode(id, name, role, model, state) {
  const button = opButton('', () => teamSelect(id), 'team-node')
  button.id = 'team-node-' + id
  button.dataset.teamId = id
  button.setAttribute('aria-pressed', String(teamStudio.selected === id))
  button.setAttribute('aria-controls', 'team-inspector')
  button.replaceChildren(add(el('span', 'team-node-head'), add(el('span', 'team-avatar'), icon(id === 'router' ? 'execution' : 'cpu')),
    add(el('span', 'team-node-identity'), el('strong', 'team-node-name', name), el('span', 'team-node-role', role)),
    icon('forward')), el('span', 'team-node-model', model || L('Service default', '连接默认模型')))
  if (state) button.append(el('span', 'team-node-state', state))
  return button
}
function teamGraph() {
  const route = executionDraft(), connections = controlConnections(), workers = teamWorkers()
  const graph = el('section', 'team-map')
  graph.setAttribute('aria-label', L('Router and Worker configuration', 'Router 与 Worker 配置关系'))
  const source = add(el('div', 'team-origin'), icon('conversations'), el('span', '', L('You & your team', '你与团队')),
    opButton(L('Conversation entries', '会话入口'), () => opNavigate('catalog'), 'text-button'))
  const model = route.routerModel || connections.find(item => item.id === route.router)?.model
  const router = teamNode('router', 'Router', L('Coordinates work and returns results', '统筹任务 · 汇总结果'), model)
  const line = el('div', 'team-route-label', L('Delegates work · receives results', '分派任务 · 接收结果'))
  line.setAttribute('aria-hidden', 'true')
  const list = el('div', 'team-worker-list')
  for (const [index, worker] of workers.entries()) {
    const status = worker.state === 'paused' ? L('Intake: paused', '接单设置：暂停') : worker.state === 'retiring' ? L('Retire after existing work', '完成已有任务后退出') : ''
    list.append(teamNode(worker.id, worker.label || 'Worker ' + (index + 1), L('Executor', '执行者'),
      worker.model || connections.find(item => item.id === worker.backend)?.model, status))
  }
  const addWorker = opButton(L('Add Worker', '添加 Worker'), () => teamAddWorker(), 'button', 'plus')
  addWorker.disabled = workers.length >= 10
  graph.append(source, el('div', 'team-trunk'), router, line,
    add(el('div', 'team-pool-heading'), el('h2', '', L('Workers', '执行者')), el('span', 'team-capacity', workers.length + ' / 10'), addWorker), list)
  const remote=el('div','team-remote-list')
  remote.append(add(el('div','team-pool-heading'),el('h2','',L('Child teams','子团队')),opButton(L('Connect a team','连接子团队'),()=>opNavigate('deployments'),'button','plus')))
  for(const target of S.draft.execution.teamTargets||[])remote.append(add(opButton('',()=>opNavigate('deployments'),'team-node'),el('strong','',target.label),el('span','team-node-role',L('Independent team coordination','由子团队独立统筹')),el('span','team-node-state',target.state==='paused'?L('Intake paused','暂停接单'):L('Accepting work','接收任务'))))
  graph.append(remote)
  return graph
}
function teamField(id, label, value, change, options = {}) {
  const field = controlField(id, label, value, change, options.values || null, options.placeholder || '')
  const input = field.querySelector('input, select')
  if (options.number) { input.type = 'number'; input.min = options.min; input.max = options.max; input.step = '1' }
  if (options.help) {
    const help = el('small', 'team-help', options.help); help.id = id + '-help'
    input.setAttribute('aria-describedby', help.id); field.append(help)
  }
  return field
}
function teamReasoning(current) {
  const backend = current.router ? executionDraft().router : current.value.backend
  if (S.draft.backends?.[backend]?.kind === 'anthropic') {
    const field = add(el('div', 'team-fields'), el('p', 'team-help', L('Anthropic thinking is configured using thinking / output_config in Advanced parameters. Generic reasoning effort is not supported.', 'Anthropic 思考能力请在高级参数中设置 thinking / output_config，不支持通用 effort。')))
    if (current.value.effort !== undefined) field.append(opButton(L('Remove generic effort override', '移除通用 effort 覆盖'), () => { teamWrite('effort', undefined); render() }, 'button'))
    return field
  }
  const capability = S.snap?.agentCapabilities?.[backend]
  const supported = capability?.efforts
  const standard = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh']
  const values = [['', L('Inherit default', '继承默认')], ...(supported || standard).map(value => [value,
    ({ none: L('Off', '关闭思考'), minimal: L('Minimal', '最少'), low: L('Low', '低'), medium: L('Medium', '中'), high: L('High', '高'), xhigh: L('Extra high', '最高') })[value] || value])]
  if (current.value.effort && !values.some(([value]) => value === current.value.effort)) values.push([current.value.effort, current.value.effort + L(' (unverified)', '（未核实）')])
  return teamField('team-effort', L('Reasoning effort', '思考强度'), current.value.effort || '', value => teamWrite('effort', value || undefined), {
    values, help: supported ? L('Options reported by this connection.', '选项由此连接报告。') :
      L('Model support is not reported. Unsupported values are rejected by the provider; off is never mapped to low.', '尚未取得模型能力。不支持的选项由服务商拒绝；关闭思考不会被替换成低强度。')
  })
}
function teamPrompt(current) {
  const independent = teamFeatures().options
  const value = independent ? current.value.prompt || '' : S.draft.prompts?.[current.router ? 'router' : 'worker'] || ''
  const input = el('textarea', 'team-prompt'); input.id = 'team-prompt'; input.value = value; input.rows = 6
  input.placeholder = current.router
    ? L('What should Router coordinate, and when should it ask you?', 'Router 负责协调什么？哪些情况需要向你确认？')
    : L('Describe this Worker’s responsibilities and how it should verify its work.', '描述该 Worker 的职责，以及如何验证工作结果。')
  input.oninput = () => independent || current.router ? teamWrite('prompt', input.value || undefined) : editPrompt('worker', input.value)
  const label = el('label', '', independent ? L('Instructions', '职责与提示词') : current.router ? L('Router instructions', 'Router 指令') : L('Shared Worker instructions', '所有 Worker 的共同指令'))
  label.htmlFor = input.id
  return add(el('div', 'control-field'), label, input,
    el('small', 'team-help', independent ? L('Added to the system instructions for this agent.', '补充到此 Agent 的系统指令中。') : L('This host currently supports shared role instructions.', '此宿主目前支持按角色共享指令。')))
}
function teamBasics(current) {
  const route = executionDraft(), backend = current.router ? route.router : current.value.backend
  const fields = el('div', 'team-fields')
  if (current.router && teamFeatures().options) fields.append(teamField('team-router-mode', L('Router mode', 'Router 模式'), current.value.mode || 'assessment', value => { teamWrite('mode', value); render() }, {
    values: [['assessment', L('Task intake', '任务受理')], ['host', L('Persistent host Router', '宿主持久 Router')], ['client', L('Current CLI is Router', '当前 CLI 会话作为 Router')]],
    help: L('Client mode uses the model and session of your connected CLI.', '客户端模式使用已接入 CLI 的模型与会话。')
  }))
  if (current.router && current.value.mode === 'client') {
    fields.append(el('p', 'team-help', L('Your connected CLI session is Router. Set its model, reasoning and instructions in that client. Host Router overrides are retained for host mode.', '已接入的 CLI 会话就是 Router。请在 CLI 中设置它的模型、思考和指令。宿主 Router 参数会保留，切回宿主模式后使用。')),
      opButton(L('Conversation entries', '会话入口'), () => opNavigate('catalog'), 'button'))
    return fields
  }
  if (!current.router) fields.append(teamField('team-name', L('Name', '名称'), current.value.label || '', value => teamWrite('label', value.trim() || undefined), { placeholder: current.name }))
  fields.append(teamField('team-backend', L('Model connection', '模型连接'), backend, value => {
    teamWrite('backend', value); teamWrite('model', undefined); render()
  }, { values: controlConnections().map(service => [service.id, service.label]) }))
  const model = current.router ? route.routerModel : current.value.model
  fields.append(teamField('team-model', L('Model', '模型'), model || '', value => teamWrite('model', value.trim() || undefined), {
    placeholder: controlConnections().find(service => service.id === backend)?.model || L('Connection default', '使用连接默认模型')
  }))
  if (teamFeatures().options) fields.append(teamReasoning(current))
  else fields.append(add(el('p', 'team-compatibility'), icon('advanced'), el('span', '', L('This host uses one shared reasoning setting. Independent settings become available with the backend upgrade.', '当前宿主使用全局思考设置。后端升级后可逐个设置。')),
    opButton(L('Shared setting', '全局设置'), () => opNavigate('advanced', '', { view: 'json' }), 'text-button')))
  if (!current.router && teamFeatures().options) fields.append(teamField('team-worker-state', L('Scheduling', '任务调度'), current.value.state || 'enabled', value => teamWrite('state', value), {
    values: [['enabled', L('Accept tasks', '接收任务')], ['paused', L('Pause new tasks', '暂停新任务')], ['retiring', L('Finish existing tasks', '完成现有任务后退出')]],
    help: L('Existing work continues. Pausing or retiring does not cancel running tasks.', '已有任务继续执行。暂停或退出不会取消运行中的任务。')
  }))
  fields.append(teamPrompt(current))
  return fields
}
function teamLimits(current) {
  const fields = el('div', 'team-fields')
  for (const [key, label, min, max] of [
    ['maxOutputTokens', L('Maximum output tokens', '最大输出 Token'), 64, 200000],
    ['maxSteps', L('Maximum model steps', '模型调用步数上限'), 1, 256],
    ['maxToolCalls', L('Maximum tool calls', '工具调用次数上限'), 1, 10000],
    ['timeoutMs', L('Timeout (milliseconds)', '超时（毫秒）'), 1000, 3600000]
  ]) {
    const path = current.path + '.' + key
    const field = teamField('team-' + key, label, S.buffers.get(path)?.text ?? current.value[key] ?? '', value => {
    const path = current.path + '.' + key
    if (value !== '' && (!Number.isInteger(Number(value)) || Number(value) < min || Number(value) > max)) {
      S.errors.set(path, ['Enter a whole number in range.', '请输入范围内的整数。']);
      S.buffers.set(path, { type: 'num', text: value }); updateBar(); showError(); return
    }
    teamWrite(key, value === '' ? undefined : Number(value))
    showError()
  }, { number: true, min, max, placeholder: L('Inherit default', '继承默认') })
    const input = field.querySelector('input'), error = el('small', 'field-error')
    error.id = input.id + '-error'; input.setAttribute('aria-errormessage', error.id)
    const showError = () => { error.hidden = !S.errors.has(path); error.textContent = S.errors.has(path) ? L('Enter a whole number from ', '请输入范围内的整数：') + min + '–' + max : ''; input.setAttribute('aria-invalid', String(S.errors.has(path))) }
    showError(); field.append(error); fields.append(field)
  }
  if (!current.router) fields.append(teamField('team-state', L('Accept new work', '接收新任务'), current.value.state || 'enabled', value => teamWrite('state', value), {
    values: [['enabled', L('Enabled', '启用')], ['paused', L('Paused', '暂停')], ['retiring', L('Finish existing work, then retire', '完成已有任务后退出')]]
  }))
  return fields
}
function teamJson(path, label, shape) {
  const field = jsonField(path, label, { objectType: shape })
  const input = field.querySelector('textarea'), edit = input.oninput
  input.oninput = event => { if (path.startsWith('execution.workers.')) teamMaterializeWorkers(); edit(event) }
  const inherit = opButton(L('Reset to inherited', '恢复继承'), () => {
    clearRelated(path)
    if (get(S.draft, path) !== undefined) set(S.draft, path, undefined)
    updateBar(); render()
    document.getElementById('f-' + path.replaceAll('.', '-'))?.focus()
  }, 'text-button')
  field.append(inherit)
  return field
}
function teamUpdatePreview() {
  const current = teamCurrent(), output = document.getElementById('team-config-preview')
  if (output) output.replaceChildren(raw(current.router ? S.draft.execution.router || {} : current.value))
}
function teamAdvanced(current) {
  if (current.router && current.value.mode === 'client') return el('p', 'team-help', L('Configure the Router model and API parameters in your connected CLI. Worker options remain independently editable.', '请在已接入 CLI 中设置 Router 模型和 API 参数。Worker 仍可独立配置。'))
  if (!teamFeatures().options) return add(el('div', 'team-fields'), el('p', 'team-help', L('This host does not support per-agent parameters yet. Existing settings remain editable.', '此宿主尚不支持独立 Agent 参数，现有配置仍可编辑。')))
  const backend = current.router ? executionDraft().router : current.value.backend
  const parameters = teamJson(current.path + '.parameters', L('Provider parameters (JSON)', '服务商参数（JSON）'), 'object')
  const supported = S.snap?.agentCapabilities?.[backend]?.parameters !== false
  parameters.querySelector('textarea').disabled = !supported
  const result = add(el('div', 'team-fields'), parameters,
    !supported ? el('p', 'team-help', L('This connection does not accept provider JSON. Other agent settings remain available.', '此连接不接受服务商 JSON，其他 Agent 设置仍可使用。')) : null,
    el('p', 'team-help', L('Overrides connection defaults. Omit a key to inherit; null remains an explicit provider value. Managed history and tool receipts cannot be replaced.', '覆盖连接默认参数。删除键表示继承，null 保留为显式值。会话历史和工具回执由宿主管理。')),
    teamLimits(current))
  const output = el('div'); output.id = 'team-config-preview'
  const preview = detail(L('Configuration to save', '查看将保存的配置'), output)
  preview.ontoggle = teamUpdatePreview
  result.append(preview)
  return result
}
function teamTools(current) {
  const fields = el('div', 'team-fields')
  if (!current.router && teamFeatures().options) {
    const enabled=el('input');enabled.type='checkbox';enabled.id='team-browser-enabled';enabled.checked=current.value.browser?.enabled!==false
    enabled.onchange=()=>teamWrite('browser',{...current.value.browser,enabled:enabled.checked})
    const label=el('label','team-toggle');label.htmlFor=enabled.id
    fields.append(add(label,enabled,el('span','',L('Browser access','浏览器访问'))),teamField('team-browser-tabs',L('Maximum browser tabs','浏览器标签页上限'),current.value.browser?.maxTabs??8,value=>teamWrite('browser',{...current.value.browser,maxTabs:Number(value)}),{values:[1,2,4,8,12,20].map(n=>[String(n),String(n)])}))
  }
  const catalog = operator.work?.architecture?.tools
  const tools = Array.isArray(catalog) ? current.router ? executionRouterTools() : catalog : catalog?.[current.router ? 'router' : 'worker'] || []
  if (teamFeatures().options) {
    fields.append(teamJson(current.path + '.tools', L('Allowed tools (JSON array)', '允许使用的工具（JSON 数组）'), 'array'),
      el('p', 'team-help', L('Omitted inherits the host tools; an empty array allows no tools.', '未设置时继承宿主工具；空数组表示不允许任何工具。')))
  }
  if (current.router && teamFeatures().management) {
    const policy = S.draft.execution.management || { enabled: false, maxWorkers: 10 }
    const enabled = el('input'); enabled.type = 'checkbox'; enabled.id = 'team-management'; enabled.checked = policy.enabled === true
    enabled.onchange = () => { clearRelated('execution.management'); set(S.draft, 'execution.management', { ...policy, enabled: enabled.checked }); updateBar(); render() }
    const label = el('label', 'team-toggle'); label.htmlFor = enabled.id
    fields.append(add(label, enabled, el('span', '', L('Allow Router to manage Workers', '允许 Router 管理 Worker'))),
      teamField('team-max-workers', L('Maximum Workers', 'Worker 数量上限'), policy.maxWorkers || 10, value => {
        const count = Number(value)
        if (!Number.isInteger(count) || count < 1 || count > 10) { S.errors.set('execution.management.maxWorkers', ['Enter a whole number from 1 to 10.', '请输入 1 到 10 的整数。']); updateBar(); return }
        clearRelated('execution.management.maxWorkers'); set(S.draft, 'execution.management.maxWorkers', count); updateBar()
      }, { values: Array.from({ length: 10 }, (_, index) => [String(index + 1), String(index + 1)]) }),
      teamJson('execution.management.backends', L('Allowed connection IDs (JSON array)', '可用连接 ID（JSON 数组）'), 'array'))
  }
  if (integrations.data || S.snap?.toolConnections) fields.append(integrationGrants(current))
  fields.append(el('h3', '', L('Host tool catalog', '宿主工具目录')))
  if (!tools.length) fields.append(el('p', 'team-help', L('No tool catalog has been reported.', '尚未取得工具目录。')))
  for (const tool of tools) {
    const name = typeof tool === 'string' ? tool : tool.name || tool.id
    fields.append(add(el('div', 'team-tool-row'), icon('work'), el('span', '', L(...(executionToolLabels[name] || [name, name])))))
  }
  return fields
}
function teamInspector() {
  const current = teamCurrent(), pane = el('section', 'team-inspector'); pane.id = 'team-inspector'
  const title = el('h2', '', current.name); title.id = 'team-inspector-title'; title.tabIndex = -1
  pane.append(add(el('div', 'team-inspector-heading'), add(el('span', 'team-avatar'), icon(current.router ? 'execution' : 'cpu')),
    add(el('div'), title, el('span', 'team-help', current.router ? L('Manager', '管理者') : L('Executor', '执行者')))))
  const tabs = affectSegmented({ id: 'team-tabs', label: L('Agent settings', 'Agent 设置'), value: teamStudio.tab,
    options: [['essentials', L('Essentials', '基本配置')], ['tools', L('Tools & control', '工具与管理')], ['advanced', L('Advanced', '高级参数')]].map(([value, label]) => ({ value, label, controls: 'team-tab-panel' })),
    onChange: value => { teamStudio.tab = value; render() } })
  const panel = el('div', 'team-tab-panel'); panel.id = 'team-tab-panel'; panel.setAttribute('role', 'tabpanel'); panel.setAttribute('aria-labelledby', 'team-tabs-' + teamStudio.tab)
  panel.append(({ essentials: teamBasics, tools: teamTools, advanced: teamAdvanced })[teamStudio.tab](current))
  panel.addEventListener('input', teamUpdatePreview)
  pane.append(tabs, panel)
  if (!current.router) {
    const copy = opButton(L('Duplicate', '复制 Worker'), () => teamAddWorker(true), 'button')
    copy.disabled = teamWorkers().length >= 10
    const remove = opButton(L('Remove', '移除'), teamRemoveWorker, 'text-button team-danger'); remove.disabled = teamWorkers().length <= 1
    pane.append(add(el('div', 'team-inspector-footer'), copy, remove))
  }
  return pane
}
function teamExplanation() { return workflowStory() }
function teamConfiguration() {
  teamCurrent()
  const section = el('section', 'team-studio')
  const explain = opButton(L('How it works', '了解任务流转'), () => { teamStudio.explain = !teamStudio.explain; render() }, 'button', 'execution')
  explain.id = 'team-story-toggle'; explain.setAttribute('aria-expanded', String(teamStudio.explain))
  section.append(opHeading(L('Agent team', 'Agent 团队'), null,
    explain,
    opButton(L('New connection', '新建模型连接'), controlNewModel, 'button', 'plus')), executionModeTabs())
  if (teamStudio.explain) section.append(teamExplanation())
  const layout = add(el('div', 'team-studio-layout'), teamGraph(), teamInspector())
  layout.id = 'execution-mode-panel'; layout.setAttribute('role', 'tabpanel'); layout.setAttribute('aria-labelledby', 'execution-mode-tab-configuration')
  section.append(layout,
    add(el('div', 'team-footer'), el('span', '', L('Select an agent to configure it. Changes remain a draft until saved.', '选择成员进行配置，未保存的更改仅是草稿。')),
      opButton(L('Shared instructions', '共享指令'), () => opNavigate('prompts'), 'text-button')))
  return [section]
}
