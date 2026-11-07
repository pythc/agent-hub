const connectionStudio = { kind: 'api', capabilities: null, error: '', loaded: false, provider: '', name: '', command: '', args: '[]', model: '', check: null, auth: null, requestId: '', touched: false, native: false, accounts: [], editing: '', account: '', ownerSource: '', ownerActor: '', background: false, models: [] }
function connectionStudioReset() {
  Object.assign(connectionStudio, { kind: 'api', capabilities: null, error: '', loaded: false, provider: '', name: '', command: '', args: '[]', model: '', check: null, auth: null, requestId: '', touched: false, native: false, accounts: [], editing: '', account: '', ownerSource: '', ownerActor: '', background: false, models: [] })
  connectionStudio.definitionId = ''
}
async function connectionDiscover() {
  if (connectionStudio.loaded) return
  const epoch = workspaceContext.epoch
  try {
    const data = await api('/connection-capabilities')
    if (data.version !== 1 || !Array.isArray(data.subscriptionProviders) || !Array.isArray(data.cliProviders) ||
        ![...data.subscriptionProviders, ...data.cliProviders].every(item => typeof item.id === 'string' && typeof item.label === 'string'))
      throw Error('Invalid connection capabilities')
    if (epoch === workspaceContext.epoch) connectionStudio.capabilities = data
  } catch (error) {
    if (epoch !== workspaceContext.epoch) return
    if (![404, 405].includes(error.status)) connectionStudio.error = L('Connection options could not be loaded. Refresh to retry.', '连接能力未能读取，请刷新后重试。')
    else if (S.snap?.editableKeys?.includes('backends')) {
      // Compatibility with the concurrently implemented native backend contract.
      try {
        const accounts = await api('/subscription/accounts')
        if (!Array.isArray(accounts)) throw Error('Invalid subscription accounts')
        connectionStudio.native = true; connectionStudio.accounts = accounts
      } catch (nativeError) {
        if (![404, 405].includes(nativeError.status)) connectionStudio.error = nativeError.message
      }
    }
  }
  if (epoch === workspaceContext.epoch) connectionStudio.loaded = true
}
function connectionEdit(key, value) {
  connectionStudio[key] = value; connectionStudio.check = null
  if (key === 'account' || key === 'provider') {
    connectionStudio.background = false; connectionStudio.ownerSource = ''; connectionStudio.ownerActor = ''; connectionStudio.model = ''
  }
  if (!connectionStudio.native || connectionStudio.kind !== 'subscription' || key === 'provider' || key === 'account') {
    connectionStudio.auth = null; connectionStudio.models = []
  }
  connectionStudio.requestId = ''; connectionStudio.touched = true
  document.getElementById('connection-status')?.remove()
}
function connectionSelect(kind) {
  if (connectionStudio.kind === kind) return
  if ((connectionStudio.touched || entryModel.touched) && !confirm(L('Discard this unsaved connection draft?', '放弃当前尚未保存的连接草稿？'))) return
  Object.assign(connectionStudio, { kind, provider: '', name: '', command: '', args: '[]', model: '', check: null, auth: null, requestId: '', touched: false,
    account: '', ownerSource: '', ownerActor: '', background: false, models: [] })
  connectionStudio.definitionId = ''
  resetNewModel(); entryModel.mode = kind === 'cli' ? 'codex' : 'api'
  render()
}
function connectionKindTabs() {
  const row = el('div', 'connection-kinds'); row.setAttribute('role', 'group'); row.setAttribute('aria-label', L('Connection type', '连接方式'))
  for (const [kind, title, description, glyph] of [
    ['api', L('API service', 'API 服务'), L('Provider or your own endpoint', '服务商或自定义地址'), 'sources'],
    ['subscription', L('Subscription account', '订阅账号'), L('Official account authorization', '厂商官方账号授权'), 'key'],
    ['cli', L('CLI backend', 'CLI 后端'), L('Use an installed agent client', '复用已安装的 Agent 客户端'), 'terminal']
  ]) {
    const button = opButton('', () => connectionSelect(kind), 'connection-kind')
    button.setAttribute('aria-pressed', String(connectionStudio.kind === kind))
    button.replaceChildren(icon(glyph), add(el('span'), el('strong', '', title), el('small', '', description)))
    row.append(button)
  }
  return row
}
function connectionText(key, label, placeholder = '') {
  return teamField('connection-' + key, label, connectionStudio[key], value => connectionEdit(key, value), { placeholder })
}
function connectionStatus(node) {
  const result = el('div', 'connection-status'); result.id = 'connection-status'; result.setAttribute('role', 'status'); result.append(node); return result
}
function connectionSubscription() {
  if (connectionStudio.native) return connectionNativeSubscription()
  const providers = connectionStudio.capabilities?.subscriptionProviders || []
  const section = el('div', 'connection-editor')
  section.append(el('h2', '', L('Connect your subscription', '连接订阅账号')),
    el('p', 'team-help', L('Authorize with the provider. Plan eligibility and usage remain tied to that account.', '通过服务商授权，使用范围与额度由该账号的订阅计划决定。')))
  if (!providers.length) return add(section, el('p', 'alert warning', L('This host has no subscription login adapter available yet. API and native Codex connections are available.', '此宿主尚未提供订阅登录适配器，可先使用 API 或原生 Codex 连接。')))
  if (!providers.some(provider => provider.id === connectionStudio.provider)) connectionStudio.provider = providers[0].id
  const form = el('form', 'connection-form')
  form.append(connectionText('name', L('Connection name', '连接名称')), teamField('connection-provider', L('Provider', '服务商'), connectionStudio.provider, value => { connectionEdit('provider', value); render() }, {
    values: providers.map(provider => [provider.id, provider.label])
  }))
  form.querySelector('input').required = true
  const start = opButton(L('Prepare sign-in', '开始授权'), null, 'button primary'); start.type = 'submit'; form.append(start)
  form.onsubmit = event => {
    event.preventDefault()
    void entryRun('subscription-start', async () => {
      connectionStudio.requestId ||= crypto.randomUUID()
      const auth = await api('/connections/subscription/start', { provider: connectionStudio.provider, name: connectionStudio.name.trim(), requestId: connectionStudio.requestId })
      const url = new URL(auth.authorizationUrl)
      if (!auth.id || url.username || url.password || !(url.protocol === 'https:' || url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw Error('Invalid authorization URL')
      connectionStudio.auth = { id: auth.id, url: url.href, state: 'pending' }
    })
  }
  section.append(form)
  const auth = connectionStudio.auth
  if (auth) {
    const status = el('div', 'stack')
    if (auth.state === 'connected') status.append(el('p', 'alert', L('Account connected.', '账号已连接。')))
    else {
      const link = entryLink(L('Open provider sign-in', '打开服务商授权页'), auth.url, 'button primary')
      link.target = '_blank'; link.rel = 'noopener noreferrer'
      status.append(link, el('p', 'team-help', auth.message || L('Complete sign-in, then check the status here.', '在新页面完成授权后，返回检查连接状态。')),
        opButton(L('Check sign-in status', '检查授权状态'), () => entryRun('subscription-status', async () => {
          const result = await api('/connections/subscription/' + encodeURIComponent(auth.id))
          if (!['pending', 'connected', 'failed'].includes(result.state)) throw Error('Invalid authorization status')
          Object.assign(auth, { state: result.state, message: result.message })
          if (result.state === 'connected') { connectionStudio.touched = false; adopt(await snapshot(), true); await readEntries() }
        }), 'button'))
    }
    section.append(connectionStatus(status))
  }
  return section
}
function connectionCli() {
  const providers = [{ id: 'codex', label: 'Codex CLI' }, ...(connectionStudio.capabilities?.cliProviders || []).filter(provider => provider.id !== 'codex')]
  if (!providers.some(provider => provider.id === connectionStudio.provider)) connectionStudio.provider = 'codex'
  const section = el('div', 'connection-editor')
  section.append(teamField('connection-cli-provider', L('CLI client', 'CLI 客户端'), connectionStudio.provider, value => { connectionEdit('provider', value); render() }, {
    values: providers.map(provider => [provider.id, provider.label])
  }), el('p', 'team-help', L('Runs on the AgentHub host. Billing follows the CLI login: subscription, API or a local model.', '在 AgentHub 宿主运行。额度来源取决于 CLI 登录方式：订阅、API 或本地模型。')))
  if (connectionStudio.provider === 'codex') {
    if (S.snap?.editableKeys?.includes('backends')) section.append(connectionNativeCli())
    else { entryModel.mode = 'codex'; section.append(connectionLegacyForm()) }
    return section
  }
  const form = el('form', 'connection-form')
  form.append(connectionText('name', L('Connection name', '连接名称')), connectionText('command', L('Executable', '可执行程序'), L('Path on the host', '宿主上的程序路径')),
    connectionText('args', L('Arguments (JSON array)', '启动参数（JSON 数组）'), '[]'), connectionText('model', L('Default model', '默认模型')))
  form.querySelector('#connection-name').required = true; form.querySelector('#connection-command').required = true
  const check = opButton(L('Check CLI', '检查 CLI'), null, 'button primary'); check.type = 'submit'; form.append(check)
  form.onsubmit = event => {
    event.preventDefault()
    void entryRun('cli-check', async () => {
      let args
      try { args = JSON.parse(connectionStudio.args); if (!Array.isArray(args) || !args.every(value => typeof value === 'string')) throw Error() }
      catch { throw Error(L('Arguments must be a JSON array of strings.', '启动参数必须是由字符串组成的 JSON 数组。')) }
      const result = await api('/connections/cli/check', { provider: connectionStudio.provider, name: connectionStudio.name.trim(), command: connectionStudio.command.trim(), args, model: connectionStudio.model.trim() })
      if (typeof result.ok !== 'boolean' || !Array.isArray(result.checks) || result.ok && typeof result.checkId !== 'string') throw Error('Invalid CLI check')
      connectionStudio.check = result
    })
  }
  section.append(form)
  const result = connectionStudio.check
  if (result) {
    const status = el('div', 'stack')
    for (const item of result.checks) status.append(el('p', '', item.label + (item.detail ? ' — ' + item.detail : '')))
    if (result.ok) status.append(opButton(L('Create CLI connection', '创建 CLI 连接'), () => entryRun('cli-save', async () => {
      connectionStudio.requestId ||= crypto.randomUUID()
      await api('/connections/cli', { checkId: result.checkId, requestId: connectionStudio.requestId })
      connectionStudio.touched = false; connectionStudio.check = null; connectionStudio.requestId = ''
      adopt(await snapshot(), true); await readEntries(); entryState.page = 'models'; updateWorkspaceLocation()
    }), 'button primary'))
    section.append(connectionStatus(status))
  }
  return section
}
function connectionLegacyForm() {
  const settings = entryModelSettings()
  const form = settings.querySelector('.entry-form')
  form.querySelector('#entry-model-mode')?.closest('.entry-field')?.remove()
  for (const button of form.querySelectorAll('.btn')) {
    button.classList.remove('btn'); button.classList.add('button')
  }
  const wrapper = el('div', 'connection-editor'); wrapper.append(form)
  return wrapper
}
function connectionCreation() {
  const page = el('section', 'connection-studio')
  page.append(opButton(L('Model connections', '模型连接'), () => opNavigate('models'), 'back-link', 'arrow'),
    opHeading(L('New model connection', '新建模型连接'), null), connectionKindTabs())
  if (connectionStudio.error) page.append(add(el('p', 'alert warning'), el('span', '', connectionStudio.error),
    opButton(L('Retry', '重试'), () => entryRun('connection-options', async () => { connectionStudio.loaded = false; connectionStudio.error = ''; await connectionDiscover() }), 'button')))
  if (connectionStudio.kind === 'api') { entryModel.mode = 'api'; page.append(connectionLegacyForm()) }
  if (connectionStudio.kind === 'cli') page.append(connectionCli())
  if (connectionStudio.kind === 'subscription') page.append(connectionSubscription())
  return [page]
}
