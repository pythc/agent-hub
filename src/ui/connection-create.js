function connectionProviderChoices(providers, selected, change, label = L('Provider', '服务商')) {
  const group = el('div', 'connection-providers'); group.setAttribute('role', 'group'); group.setAttribute('aria-label', label)
  for (const provider of providers) {
    const button = opButton('', () => change(provider.id), 'button connection-provider')
    button.setAttribute('aria-pressed', String(provider.id === selected)); button.disabled = !!(entryState.busy || S.busy)
    button.append(connectionBrand(provider.brand || provider.id), el('span', '', provider.label)); group.append(button)
  }
  return add(el('div', 'connection-provider-field'), el('span', 'connection-field-label', label), group)
}
function connectionAdvanced(...nodes) { const box = detail(L('Advanced settings', '高级设置'), add(el('div', 'connection-advanced-fields'), ...nodes)); box.classList.add('connection-advanced'); return box }
function connectionFormFooter(button, metered = true) {
  return add(el('div', 'connection-form-footer'), el('span', 'team-help', metered
    ? L('Testing sends a model request and may use credits.', '测试会发送少量模型请求，可能消耗额度。')
    : L('Checks installation and sign-in only.', '仅检查工具安装与登录状态。')),
    add(el('div', 'actions'), opButton(L('Cancel', '取消'), () => opNavigate('models'), 'text-button'), button))
}
function connectionCheckView(check) {
  if (!check) return null
  const result = el('div', 'connection-check-result'); result.setAttribute('role', 'status'); result.id = 'connection-status'
  for (const item of check.checks) {
    const [title, hint] = checkCopy(item)
    result.append(add(el('div', 'connection-check-line'), icon(item.status === 'ok' ? 'check' : 'info'),
      add(el('div'), el('strong', '', title), item.status === 'required' && hint ? el('p', 'team-help', hint) : null,
        item.detail ? detail(L('Technical detail', '技术详情'), raw(entrySafeDetail(item.detail))) : null)))
  }
  return result
}
async function connectionApplyPlan(plan) {
  const receipt = await api('/entry-setup/model/apply', { id: plan.id })
  if (receipt.applied !== true || !Number.isInteger(receipt.revision)) throw Error('Invalid connection receipt')
  entryModel.credential = ''; entryModel.touched = false; entryModel.plan = null; entryModel.check = null; entryModel.creating = false
  connectionStudio.touched = false; connectionStudio.plan = null; connectionStudio.check = null; connectionStudio.drafts = {}
  adopt(await snapshot(), true); await readEntries(true)
  connectionLibraryState.selected = ''; entryState.page = 'models'; updateWorkspaceLocation(true)
  announce(L('Connection saved.', '连接已保存。'))
}
async function connectionPlanAndCheck(connection, name, apply = false) {
  const plan = await api('/entry-setup/model/plan', { revision: S.base.revision, connection, select: false, ...(name?.trim() ? { name: name.trim() } : {}) })
  const check = await api('/entry-setup/model/check', { id: plan.id })
  if (!Array.isArray(check.checks) || typeof check.ok !== 'boolean') throw Error('Invalid connection check')
  connectionStudio.plan = plan; connectionStudio.check = check
  if (apply && (check.ok || S.snap?.preview && check.preview)) await connectionApplyPlan(plan)
}
function connectionApiForm() {
  entryModel.mode = 'api'; entryModel.creating = true
  const form = el('form', 'connection-form connection-simple-form')
  form.append(connectionProviderChoices([
    { id: 'openai', label: 'OpenAI' }, { id: 'deepseek', label: 'DeepSeek' }, { id: 'anthropic', label: 'Anthropic' }, { id: 'custom', label: L('Custom', '自定义') }
  ], entryModel.provider, value => { entryModelEdit('provider', value); connectionStudio.models = []; connectionStudio.modelError = ''; connectionStudio.check = null; entryModel.endpoint = ''; entryModel.credential = ''; entryModel.model = ''; render() }))
  if (entryModel.provider === 'custom') form.append(entryModelField('endpoint', L('API address', 'API 地址'), null, 'url', true))
  form.append(entryModelField('credential', 'API Key', null, 'password'))
  const model = entryModelField('model', L('Default model', '默认模型'), null, 'text', true)
  const load = opButton(L('Load models', '读取模型'), () => entryRun('connection-models', async () => {
    connectionStudio.modelError = ''
    try {
      const input = { ...entryModelConnection(), model: entryModel.model.trim() || '_catalog' }
      const result = await api('/model-connections/models', input)
      if (!Array.isArray(result.models)) throw Error('Invalid model list')
      connectionStudio.models = result.models
      if (!entryModel.model && result.models.length) entryModelEdit('model', result.models[0])
      if (!result.models.length) connectionStudio.modelError = L('No models returned. Enter a model ID manually.', '未返回模型列表，可手动填写模型 ID。')
    } catch { connectionStudio.modelError = L('Could not load models. Check the key or enter a model ID manually.', '无法读取模型列表，请检查密钥，或手动填写模型 ID。') }
  }), 'button')
  model.append(load, el('small', 'team-help', L('Components can select a different model.', '组件中可以选择其他模型。')))
  if (connectionStudio.modelError) model.append(el('p', 'team-help', connectionStudio.modelError))
  if (connectionStudio.models.length) {
    const list = el('datalist'); list.id = 'connection-model-catalog'
    for (const id of connectionStudio.models) { const option = el('option'); option.value = id; list.append(option) }
    model.querySelector('input').setAttribute('list', list.id); model.append(list)
  }
  form.append(model)
  const advanced = connectionAdvanced(entryModelField('name', L('Connection name (optional)', '连接名称（选填）')))
  advanced.querySelector('input').placeholder = providerDefaults[entryModel.provider]?.label || L('Custom API', '自定义 API')
  if (entryModel.provider !== 'custom') advanced.append(entryModelField('endpoint', L('Custom API address (optional)', '自定义 API 地址（选填）'), null, 'url'))
  if (entryModel.provider !== 'anthropic') advanced.append(entryModelField('protocol', L('API format', 'API 协议'), Object.entries(guideApiFormats).filter(([id]) => entryModel.provider === 'custom' || id !== 'anthropic')))
  form.append(advanced)
  if (connectionStudio.check) form.append(connectionCheckView(connectionStudio.check))
  const submit = opButton(entryState.busy ? L('Testing…', '正在测试…') : L('Test and save', '测试并保存'), null, 'button primary'); submit.type = 'submit'
  form.append(connectionFormFooter(submit))
  form.onsubmit = e => { e.preventDefault(); void entryRun('connection-save', async () => {
    connectionStudio.check = null
    await connectionPlanAndCheck(entryModelConnection(), entryModel.name || providerDefaults[entryModel.provider]?.label || 'API', true)
  }) }
  return form
}
function connectionCliDefinition() {
  return { kind: 'codex', ...(connectionStudio.command.trim() ? { command: connectionStudio.command.trim() } : {}),
    args: connectionStudio.args.split('\n').map(v => v.trim()).filter(Boolean), ...(connectionStudio.model.trim() ? { model: connectionStudio.model.trim() } : {}) }
}
function connectionNativeCli() {
  const form = el('form', 'connection-form connection-simple-form')
  const plugins = controlConnections().filter(c => c.kind === 'plugin')
  connectionStudio.provider ||= 'codex'
  form.append(connectionProviderChoices([{ id: 'codex', label: 'Codex' }, ...plugins.map(c => ({ id: c.id, label: c.label, brand: connectionProvider(c) }))], connectionStudio.provider, value => { connectionEdit('provider', value); render() }, L('Tool', '工具')))
  const plugin = plugins.find(c => c.id === connectionStudio.provider)
  const status = el('div', 'connection-host-check')
  status.append(el('h3', '', L('Roppo host', 'Roppo 运行主机')),
    connectionCheckView(connectionStudio.check) || el('p', 'team-help', L('Detect the installed tool and its sign-in status.', '检测工具是否已安装，以及账号是否已登录。')))
  const detect = opButton(entryState.busy ? L('Checking…', '正在检测…') : connectionStudio.check ? L('Check again', '重新检测') : L('Detect tool', '检测工具'), () => entryRun('connection-cli-check', async () => {
    await connectionPlanAndCheck(plugin ? { kind: 'existing', id: plugin.id } : connectionCliDefinition(), connectionStudio.name || 'Codex')
  }), 'button', 'refresh')
  status.append(detect); form.append(status)
  if (!plugin) {
    form.append(connectionText('model', L('Default model (optional)', '默认模型（选填）'), L('Use tool default', '跟随工具默认设置')))
    const args = teamField('connection-args', L('Launch arguments (one per line)', '启动参数（每行一项）'), '', () => {})
    const old = args.querySelector('input'), area = el('textarea'); area.id = old.id; area.value = connectionStudio.args; area.rows = 3; area.placeholder = L('Usually left empty', '通常无需填写')
    area.oninput = () => connectionEdit('args', area.value); old.replaceWith(area)
    form.append(connectionAdvanced(connectionText('name', L('Connection name (optional)', '连接名称（选填）'), 'Codex'), connectionText('command', L('Executable path (optional)', '可执行文件路径（选填）'), L('Detect codex automatically', '自动检测 codex')), args))
  } else form.append(el('p', 'team-help', L('This installed backend is already in your connection library. Select it in the component settings.', '此后端已在连接库中，可直接在组件配置中选择。')))
  const save = opButton(plugin ? L('Back to connections', '返回连接库') : L('Save connection', '保存连接'), null, 'button primary'); save.type = 'submit'; save.id = 'connection-save'
  save.disabled = !plugin && !(connectionStudio.check?.ok || S.snap?.preview && connectionStudio.check?.preview)
  form.append(connectionFormFooter(save, false))
  form.onsubmit = e => { e.preventDefault(); if (plugin) { opNavigate('models'); return } if (!connectionStudio.plan || !connectionStudio.check?.ok && !S.snap?.preview) return; void entryRun('connection-cli-save', () => connectionApplyPlan(connectionStudio.plan)) }
  return form
}
function connectionOwner() {
  const inventory = S.snap?.subscriptionOwners
  if (inventory?.defaultOwner && !connectionStudio.ownerSource) Object.assign(connectionStudio, { ownerSource: inventory.defaultOwner.source, ownerActor: inventory.defaultOwner.actor })
  return inventory
}
function connectionNativeSubscription() {
  const form = el('form', 'connection-form connection-simple-form')
  form.append(connectionProviderChoices([{ id: 'chatgpt', label: 'ChatGPT', brand: 'openai' }], 'chatgpt', () => {}))
  const saved = connectionStudio.accounts.find(a => a.id === connectionStudio.account), auth = connectionStudio.auth
  const signedIn = saved?.signedIn || auth?.state === 'connected'
  const account = el('div', 'connection-account')
  if (signedIn) {
    account.append(connectionBrand('openai'), add(el('div'), el('strong', '', saved?.email || L('ChatGPT account', 'ChatGPT 账号')), el('p', 'team-help', L('Signed in', '已登录'))),
      opButton(L('Change account', '更换账号'), () => { connectionEdit('account', ''); render() }, 'text-button'))
  } else {
    if (connectionStudio.accounts.some(a => a.signedIn)) form.append(teamField('connection-saved-account', L('Saved account', '已登录账号'), connectionStudio.account,
      value => { connectionEdit('account', value); render() }, { values: [['', L('Sign in to another account', '登录其他账号')], ...connectionStudio.accounts.filter(a => a.signedIn).map(a => [a.id, a.email || a.id])] }))
    account.append(el('h3', '', L('Connect your ChatGPT account', '连接你的 ChatGPT 账号')))
    if (!auth || auth.state === 'failed') account.append(opButton(L('Continue with ChatGPT', '使用 ChatGPT 登录'), () => entryRun('subscription-login', async () => {
      const result = await api('/subscription/login', {})
      const url = new URL(result.url)
      if (url.origin !== 'https://auth.openai.com' || !result.attempt || !result.account) throw Error('Invalid provider authorization response')
      connectionStudio.account = result.account; connectionStudio.auth = { id: result.attempt, url: url.href, state: 'pending' }; connectionStudio.touched = true
    }), 'button primary'))
    if (auth?.state === 'pending') {
      const link = entryLink(L('Open official sign-in', '打开官方登录页'), auth.url, 'button primary'); link.target = '_blank'; link.rel = 'noopener noreferrer'
      account.append(link, opButton(L('I have signed in', '我已完成登录'), () => entryRun('subscription-status', async () => {
        const result = await api('/subscription/status', { attempt: auth.id })
        auth.state = result.status === 'completed' ? 'connected' : result.status === 'failed' ? 'failed' : 'pending'; auth.message = result.error
        if (auth.state === 'connected') {
          connectionStudio.accounts = await api('/subscription/accounts')
          try { await connectionLoadAccountModels() } catch { connectionStudio.modelError = L('Enter an available model ID or retry loading.', '请填写可用模型 ID，或重试读取。') }
        }
      }), 'button'), el('p', 'team-help', L('Complete sign-in on the provider page, then return here.', '在服务商页面完成登录后返回此处。')))
    }
    if (auth?.state === 'failed') account.append(el('p', 'alert warning', L('Sign-in failed or expired. Start again.', '登录失败或已过期，请重新登录。')))
  }
  form.append(account)
  const owners = connectionOwner()
  if (signedIn) {
    if (!owners?.defaultOwner) form.append(teamField('subscription-owner', L('Who may use this account?', '允许哪个身份使用此账号？'), JSON.stringify([connectionStudio.ownerSource, connectionStudio.ownerActor]), value => {
      const [source, actor] = JSON.parse(value); connectionEdit('ownerSource', source); connectionEdit('ownerActor', actor); connectionStudio.background = false; render()
    }, { values: [[JSON.stringify(['', '']), L('Select identity', '选择身份')], ...(owners?.choices || []).map(o => [JSON.stringify([o.source, o.actor]), o.label])] }))
    const consent = el('input'); consent.type = 'checkbox'; consent.id = 'subscription-background'; consent.checked = connectionStudio.background
    consent.onchange = () => { connectionEdit('background', consent.checked); render() }
    const label = el('label', 'connection-consent'); label.htmlFor = consent.id
    form.append(add(label, consent, el('span', '', L('Allow Roppo to use this account for background tasks from this identity', '允许 Roppo 在此身份发起的后台任务中使用该账号'))))
    if (owners?.defaultOwner) form.append(el('p', 'team-help connection-owner-note', L('Bound to your local workspace identity.', '已绑定当前本机工作区身份。')))
    const model = connectionText('model', L('Default model', '默认模型'), L('Choose an available model', '选择账号可用的模型'))
    model.querySelector('input').required = true
    model.append(opButton(L('Load account models', '读取账号模型'), () => entryRun('subscription-models', connectionLoadAccountModels), 'button'))
    if (connectionStudio.modelError) model.append(el('p', 'team-help', connectionStudio.modelError))
    if (connectionStudio.models.length) { const list = el('datalist'); list.id = 'subscription-account-models'; for (const id of connectionStudio.models) { const option = el('option'); option.value = id; list.append(option) }; model.querySelector('input').setAttribute('list', list.id); model.append(list) }
    form.append(model, connectionAdvanced(connectionText('name', L('Connection name (optional)', '连接名称（选填）'), saved?.email ? 'ChatGPT · ' + saved.email : 'ChatGPT')))
  }
  if (connectionStudio.check) form.append(connectionCheckView(connectionStudio.check))
  const save = opButton(entryState.busy ? L('Testing…', '正在测试…') : L('Test and save', '测试并保存'), null, 'button primary'); save.type = 'submit'; save.id = 'connection-save'
  save.disabled = !signedIn || !connectionStudio.background || !connectionStudio.ownerSource || !connectionStudio.ownerActor
  form.append(connectionFormFooter(save))
  form.onsubmit = e => { e.preventDefault(); if (save.disabled) return; void entryRun('connection-subscription-save', () => connectionPlanAndCheck({ kind: 'subscription', account: connectionStudio.account, model: connectionStudio.model.trim(), owner: { source: connectionStudio.ownerSource, actor: connectionStudio.ownerActor }, backgroundAuthorized: true }, connectionStudio.name || 'ChatGPT', true)) }
  return form
}
async function connectionLoadAccountModels() {
  connectionStudio.modelError = ''
  const result = await api('/subscription/models', { account: connectionStudio.account }), models = Array.isArray(result) ? result : result.data || result.models
  if (!Array.isArray(models)) throw Error('Invalid account model catalog')
  connectionStudio.models = models.map(m => typeof m === 'string' ? m : m.id).filter(id => typeof id === 'string')
  if (!connectionStudio.models.length) connectionStudio.modelError = L('No models returned. Enter an available model ID.', '未返回模型列表，请填写账号可用的模型 ID。')
  if (!connectionStudio.model && connectionStudio.models.length) connectionStudio.model = connectionStudio.models[0]
}
function connectionCreatePage() {
  const page = el('section', 'connection-studio')
  page.append(opButton(L('Model connections', '模型连接'), () => opNavigate('models'), 'back-link', 'arrow'), opHeading(L('New connection', '新建连接'), null), connectionKindTabs())
  if (connectionStudio.error) page.append(el('p', 'alert warning', connectionStudio.error))
  const editor = el('div', 'connection-editor')
  editor.append(connectionStudio.kind === 'api' ? connectionApiForm() : connectionStudio.kind === 'cli' ? connectionNativeCli() : connectionNativeSubscription())
  page.append(editor)
  if (entryState.busy || S.busy) for (const control of page.querySelectorAll('input,select,textarea,button')) control.disabled = true
  return [page]
}
