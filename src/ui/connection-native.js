// Adapt the real /settings and /subscription/* APIs without changing the host.
async function connectionSaveDefinition(definition) {
  const id = connectionStudio.definitionId || ('connection-' + crypto.randomUUID().slice(0, 8))
  connectionStudio.definitionId = id
  clearRelated('backends.' + id)
  set(S.draft, 'backends.' + id, definition)
  if (await save(['backends'])) {
    connectionStudio.touched = false; connectionStudio.definitionId = ''
    entryState.page = 'models'; connectionStudio.editing = ''; updateWorkspaceLocation(); render()
  }
}
function connectionNativeCli() {
  const form = el('form', 'connection-form')
  form.append(connectionText('name', L('Connection name', '连接名称')),
    connectionText('command', L('Executable on host', '宿主上的程序'), 'codex'),
    connectionText('args', L('Arguments (JSON array)', '启动参数（JSON 数组）'), '[]'),
    connectionText('model', L('Default model', '默认模型')),
    el('p', 'team-help', L('Uses Codex app-server. Saving configures the executor; use Check connection afterward to verify it.', '通过 Codex app-server 执行。保存后可在连接列表中检查可用性。')))
  form.querySelector('#connection-name').required = true
  const submit = opButton(L('Save CLI configuration', '保存 CLI 配置'), null, 'button primary'); submit.type = 'submit'; form.append(submit)
  form.onsubmit = event => {
    event.preventDefault()
    let args
    try { args = JSON.parse(connectionStudio.args); if (!Array.isArray(args) || !args.every(value => typeof value === 'string')) throw Error() }
    catch { setNotice('error', 'Arguments must be a JSON array of strings.', '启动参数必须是由字符串组成的 JSON 数组。'); render(); return }
    void connectionSaveDefinition({ kind: 'codex', label: connectionStudio.name.trim(), command: connectionStudio.command.trim() || 'codex', args,
      ...(connectionStudio.model.trim() ? { model: connectionStudio.model.trim() } : {}) })
  }
  return form
}
function connectionNativeSubscription() {
  const section = el('section', 'connection-editor'), form = el('form', 'connection-form')
  section.append(el('h2', '', L('ChatGPT subscription', 'ChatGPT 订阅')),
    el('p', 'team-help', L('Sign in with the official provider, then assign the account to its owner’s requests.', '通过服务商官方页面登录，再将账号用于所属用户的请求。')))
  form.append(connectionText('name', L('Connection name', '连接名称')),
    connectionText('account', L('Account alias', '账号别名'), L('For example: personal', '例如 personal')))
  form.querySelector('#connection-name').required = true
  const accountInput = form.querySelector('#connection-account'); accountInput.required = true; accountInput.pattern = '[a-z][a-z0-9_-]{0,63}'
  accountInput.oninput = () => { connectionEdit('account', accountInput.value); render() }
  if (connectionStudio.accounts.length) {
    const list = el('datalist'); list.id = 'subscription-account-aliases'; accountInput.setAttribute('list', list.id)
    for (const account of connectionStudio.accounts) { const option = el('option'); option.value = account.id; option.label = account.email || account.id; list.append(option) }
    form.append(list)
  }
  const auth = connectionStudio.auth, saved = connectionStudio.accounts.find(account => account.id === connectionStudio.account)
  const signedIn = auth?.state === 'connected' || saved?.signedIn === true
  const begin = opButton(L('Continue with ChatGPT', '使用 ChatGPT 登录'), () => {
    if (!accountInput.reportValidity()) return
    void entryRun('subscription-login', async () => {
      const result = await api('/subscription/login', { account: connectionStudio.account })
      const url = new URL(result.url)
      if (url.origin !== 'https://auth.openai.com' || !result.attempt) throw Error('Invalid provider authorization response')
      connectionStudio.auth = { id: result.attempt, url: url.href, state: 'pending' }
    })
  }, 'button')
  begin.disabled = auth?.state === 'pending'
  form.append(begin)
  if (auth) {
    const status = el('div', 'stack')
    if (auth.state === 'connected') status.append(el('p', 'alert', L('Authorization completed.', '授权已完成。')))
    else {
      const link = entryLink(L('Open official sign-in', '打开官方授权页'), auth.url, 'button'); link.target = '_blank'; link.rel = 'noopener noreferrer'
      status.append(link, opButton(L('Check sign-in status', '检查授权状态'), () => entryRun('subscription-status', async () => {
        const result = await api('/subscription/status', { attempt: auth.id })
        if (!['pending', 'exchanging', 'completed', 'failed'].includes(result.status)) throw Error('Invalid subscription status')
        auth.state = result.status === 'completed' ? 'connected' : result.status === 'failed' ? 'failed' : 'pending'
        auth.message = result.error
        if (auth.state === 'connected') connectionStudio.accounts = await api('/subscription/accounts')
      }), 'button'), el('p', 'team-help', auth.message || L('Complete the sign-in in the provider page.', '请在服务商页面完成登录。')))
    }
    form.append(connectionStatus(status))
  } else if (saved?.signedIn) form.append(el('p', 'team-help', L('Saved account selected. Tokens are verified when used.', '已选择保存的账号，令牌将在使用时核验。')))
  const sources = S.draft.sources || []
  if (!connectionStudio.ownerSource && sources.length === 1) connectionStudio.ownerSource = sources[0].id
  form.append(teamField('subscription-source', L('Owner’s conversation entry', '账号所属用户的会话入口'), connectionStudio.ownerSource, value => {
    connectionStudio.ownerSource = value; connectionStudio.ownerActor = ''; connectionStudio.background = false; connectionStudio.touched = true; render()
  }, { values: [['', L('Select entry', '选择会话入口')], ...sources.map(source => [source.id, source.label || entryName(source.kind)])] }))
  const actors = sources.find(source => source.id === connectionStudio.ownerSource)?.allowedActors || []
  form.append(teamField('subscription-owner', L('Account owner', '账号所属用户'), connectionStudio.ownerActor, value => {
    connectionStudio.ownerActor = value; connectionStudio.background = false; connectionStudio.touched = true; render()
  }, { values: [['', L('Select user', '选择用户')], ...actors.map(actor => [actor, actor])] }),
    connectionText('model', L('Model', '模型'), L('Choose a model available to this account', '使用此账号可用的模型')))
  form.querySelector('#connection-model').required = true
  if (connectionStudio.ownerSource && !actors.length) form.append(el('p', 'team-help', L('Configure the owner in this conversation entry’s allowed users first.', '请先在该会话入口的允许用户中配置账号所属用户。')))
  const loadModels = opButton(L('Load account models', '读取账号模型'), () => entryRun('subscription-models', async () => {
    const result = await api('/subscription/models', { account: connectionStudio.account })
    const models = Array.isArray(result) ? result : result.data || result.models
    if (!Array.isArray(models)) throw Error('Invalid account model catalog')
    connectionStudio.models = models.map(model => typeof model === 'string' ? model : model.id).filter(value => typeof value === 'string')
  }), 'text-button'); loadModels.disabled = !signedIn; form.append(loadModels)
  if (connectionStudio.models.length) {
    const list = el('datalist'); list.id = 'subscription-account-models'
    for (const model of connectionStudio.models) { const option = el('option'); option.value = model; list.append(option) }
    form.append(list); form.querySelector('#connection-model').setAttribute('list', list.id)
  }
  const consent = el('input'); consent.type = 'checkbox'; consent.id = 'subscription-background'; consent.checked = connectionStudio.background
  consent.onchange = () => { connectionStudio.background = consent.checked; connectionStudio.touched = true; render() }
  const consentLabel = el('label', 'team-toggle'); consentLabel.htmlFor = consent.id
  form.append(add(consentLabel, consent, el('span', '', L('Allow background tasks for this account owner to use this subscription', '允许该账号所属用户的后台任务使用此订阅'))))
  const save = opButton(L('Save subscription connection', '保存订阅连接'), null, 'button primary'); save.type = 'submit'
  save.disabled = !signedIn || !connectionStudio.ownerSource || !connectionStudio.ownerActor || !connectionStudio.background
  form.append(save)
  form.onsubmit = event => { event.preventDefault(); if (save.disabled) return; void connectionSaveDefinition({ kind: 'openai-responses', label: connectionStudio.name.trim(), baseUrl: 'https://api.openai.com/v1', model: connectionStudio.model.trim(), subscription: { provider: 'chatgpt', account: connectionStudio.account,
    owner: { source: connectionStudio.ownerSource, actor: connectionStudio.ownerActor }, backgroundAuthorized: connectionStudio.background } }) }
  section.append(form)
  return section
}
function connectionDefinitionEditor() {
  const id = connectionStudio.editing, definition = S.draft.backends?.[id]
  if (!definition) { connectionStudio.editing = ''; return controlModels() }
  const path = 'backends.' + id, page = el('section', 'connection-editor')
  page.append(opButton(L('Model connections', '模型连接'), () => { connectionStudio.editing = ''; render() }, 'back-link', 'arrow'),
    opHeading(definition.label || L('Edit connection', '编辑连接'), null))
  const fields = el('div', 'team-fields')
  fields.append(inputField(path + '.label', L('Connection name', '连接名称'), { optional: true }), inputField(path + '.model', L('Default model', '默认模型'), { optional: ['codex', 'plugin'].includes(definition.kind) }))
  if (definition.kind === 'codex') fields.append(inputField(path + '.command', L('Executable', '可执行程序'), { optional: true }), teamJson(path + '.args', L('Arguments (JSON array)', '启动参数（JSON 数组）'), 'array'), teamJson(path + '.env', L('Environment references (JSON)', '环境变量引用（JSON）'), 'object'))
  else if (definition.kind === 'plugin') fields.append(el('p', 'team-help', L('Plugin: ', '插件：') + definition.plugin + L('. Package, credentials and filesystem changes require staging and a controlled restart.', '。插件包、凭据和文件权限变更需暂存配置并受控重启。')))
  else {
    fields.append(inputField(path + '.baseUrl', L('API base URL', 'API 基础地址')))
    if (!definition.subscription) fields.append(inputField(path + '.apiKeyEnv', L('API key environment variable', 'API 密钥环境变量'), { optional: true }))
  }
  fields.append(teamJson(path + '.defaults', L('Agent defaults (JSON)', 'Agent 默认参数（JSON）'), 'object'))
  if (!['codex', 'plugin'].includes(definition.kind)) fields.append(teamJson(path + '.parameters', L('Provider parameters (JSON)', '服务商参数（JSON）'), 'object'), teamJson(path + '.headerEnv', L('Header environment references (JSON)', '请求头环境变量引用（JSON）'), 'object'))
  const advanced = detail(L('Full connection configuration', '完整连接配置'), jsonField(path, L('Configuration (JSON)', '配置（JSON）'), { objectType: 'object' }))
  page.append(fields, advanced, el('p', 'team-help', L('Saved configuration does not verify a model call. Changes are revisioned with your other edits.', '保存配置不代表模型调用已验证。所有修改与其他配置一起进行版本检查。')))
  if (definition.subscription && connectionStudio.native) page.append(opButton(L('Sign out of this account', '退出此订阅账号'), () => confirmWorkspaceAction(
    L('Sign out of this subscription?', '退出此订阅账号？'),
    L('All connections using this account will need sign-in again. Connection configurations are retained.', '使用此账号的所有连接都需要重新登录，连接配置会保留。'), L('Sign out', '退出账号'), () => entryRun('subscription-logout', async () => {
      const result = await api('/subscription/logout', { account: definition.subscription.account })
      if (result.signedOut !== true) throw Error('Invalid sign-out receipt')
      connectionStudio.accounts = await api('/subscription/accounts'); connectionStudio.auth = null
      setNotice(result.revoked ? 'success' : 'warning', result.revoked ? 'Signed out and revoked.' : 'Signed out locally. Provider revocation was not confirmed.', result.revoked ? '已退出并撤销授权。' : '已在本地退出，服务商端撤销尚未确认。')
    })), 'button'))
  return [page]
}
