function connectionDefinitionEditor() {
  const id = connectionStudio.editing, definition = S.draft.backends?.[id]
  if (!definition) { connectionStudio.editing = ''; return controlModels() }
  const path = 'backends.' + id, page = el('section', 'connection-editor')
  page.append(opButton(L('Model connections', '模型连接'), () => { connectionStudio.editing = ''; render() }, 'back-link', 'arrow'),
    opHeading(definition.label || L('Edit connection', '编辑连接'), null))
  const fields = el('div', 'team-fields'), advancedFields = el('div', 'team-fields')
  fields.append(inputField(path + '.label', L('Connection name', '连接名称'), { optional: true }), inputField(path + '.model', L('Default model', '默认模型'), { optional: ['codex', 'plugin'].includes(definition.kind) }))
  if (definition.kind === 'codex') advancedFields.append(inputField(path + '.command', L('Executable', '可执行程序'), { optional: true }), teamJson(path + '.args', L('Arguments (JSON array)', '启动参数（JSON 数组）'), 'array'), teamJson(path + '.env', L('Environment references (JSON)', '环境变量引用（JSON）'), 'object'))
  else if (definition.kind === 'plugin') fields.append(el('p', 'team-help', L('Plugin: ', '插件：') + definition.plugin + L('. Package, credentials and filesystem changes require staging and a controlled restart.', '。插件包、凭据和文件权限变更需暂存配置并受控重启。')))
  else {
    fields.append(inputField(path + '.baseUrl', L('API base URL', 'API 基础地址')))
    if (!definition.subscription) advancedFields.append(inputField(path + '.apiKeyEnv', L('API key environment variable', 'API 密钥环境变量'), { optional: true }))
  }
  advancedFields.append(teamJson(path + '.defaults', L('Agent defaults (JSON)', 'Agent 默认参数（JSON）'), 'object'))
  if (!['codex', 'plugin'].includes(definition.kind)) advancedFields.append(teamJson(path + '.parameters', L('Provider parameters (JSON)', '服务商参数（JSON）'), 'object'), teamJson(path + '.headerEnv', L('Header environment references (JSON)', '请求头环境变量引用（JSON）'), 'object'))
  advancedFields.append(detail(L('Full configuration', '完整配置'), jsonField(path, L('Configuration (JSON)', '配置（JSON）'), { objectType: 'object' })))
  const advanced = detail(L('Advanced settings', '高级设置'), advancedFields)
  page.append(fields, advanced, el('p', 'team-help', L('Saved configuration does not verify a model call. Changes are revisioned with your other edits.', '保存配置不代表模型调用已验证。所有修改与其他配置一起进行版本检查。')))
  page.append(opButton(L('Save changes', '保存更改'), async () => { if (await save(['backends'])) { connectionStudio.editing = ''; render() } }, 'button primary'))
  if (!['codex', 'plugin'].includes(definition.kind) && !definition.subscription) {
    const field = el('input'); field.type = 'password'; field.autocomplete = 'off'; field.id = 'connection-replacement-key'; field.placeholder = L('New API Key', '新的 API Key')
    const replace = opButton(L('Test and replace key', '测试并更换密钥'), () => {
      if (dirty()) { announce(L('Save configuration changes before replacing the key.', '请先保存配置修改，再更换密钥。')); return }
      if (!field.value.trim()) { field.focus(); return }
      const key = field.value.trim(); field.value = ''
      void entryRun('connection-replace-key', async () => { await connectionPlanAndCheck({ kind: 'existing', id, apiKey: key }, undefined, true); if (entryState.page === 'models' && !connectionStudio.check) connectionStudio.editing = '' })
    }, 'button')
    replace.disabled = dirty() || !!entryState.busy || !!S.busy
    const label = el('label', '', L('Replace API Key', '更换 API Key')); label.htmlFor = field.id
    page.append(detail(L('Replace credentials', '更换凭据'), add(el('div', 'connection-simple-form'), label, field, el('p', 'team-help', L('Save configuration edits first. Testing may use credits.', '请先保存配置修改；测试可能消耗额度。')), replace, connectionCheckView(connectionStudio.check))))
  }
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
