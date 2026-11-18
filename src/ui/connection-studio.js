const connectionStudio = { backendProbes: {}, kind: 'api', capabilities: null, error: '', loaded: false, provider: '', name: '', command: '', args: '', model: '', check: null, plan: null, auth: null, requestId: '', touched: false, native: false, accounts: [], editing: '', account: '', ownerSource: '', ownerActor: '', background: false, models: [], drafts: {}, generation: 0, modelError: '' }
function connectionStudioReset() {
  const generation = connectionStudio.generation + 1
  Object.assign(connectionStudio, { backendProbes: {}, kind: 'api', capabilities: null, error: '', loaded: false, provider: '', name: '', command: '', args: '', model: '', check: null, plan: null, auth: null, requestId: '', touched: false, native: false, accounts: [], editing: '', account: '', ownerSource: '', ownerActor: '', background: false, models: [], drafts: {}, generation, modelError: '' })
  connectionStudio.definitionId = ''
  if (typeof connectionLibraryState !== 'undefined') Object.assign(connectionLibraryState, { search: '', filter: 'all', selected: '' })
}
async function connectionDiscover() {
  if (connectionStudio.loaded) return
  const epoch = workspaceContext.epoch
  try {
    const accounts = await api('/subscription/accounts')
    if (!Array.isArray(accounts)) throw Error('Invalid subscription accounts')
    if (epoch !== workspaceContext.epoch) return
    connectionStudio.native = true; connectionStudio.accounts = accounts
  } catch (error) {
    if (epoch !== workspaceContext.epoch) return
    if (![404, 405].includes(error.status)) connectionStudio.error = L('Connection options could not be loaded. Refresh to retry.', '连接能力未能读取，请刷新后重试。')
  }
  if (epoch === workspaceContext.epoch) connectionStudio.loaded = true
}
function connectionEdit(key, value) {
  connectionStudio[key] = value; connectionStudio.check = null; connectionStudio.plan = null; connectionStudio.generation++
  if (key === 'account' || key === 'provider') {
    connectionStudio.background = false; connectionStudio.ownerSource = ''; connectionStudio.ownerActor = ''; connectionStudio.model = ''
  }
  if (!connectionStudio.native || connectionStudio.kind !== 'subscription' || key === 'provider' || key === 'account') {
    connectionStudio.auth = null; connectionStudio.models = []
  }
  connectionStudio.requestId = ''; connectionStudio.touched = true
  document.getElementById('connection-status')?.remove()
  const save = document.getElementById('connection-save'); if (save && connectionStudio.kind === 'cli') save.disabled = true
}
function connectionSelect(kind) {
  if (connectionStudio.kind === kind || entryState.busy || S.busy) return
  const keys = ['provider','name','command','args','model','check','plan','auth','touched','account','ownerSource','ownerActor','background','models','modelError']
  connectionStudio.drafts[connectionStudio.kind] = Object.fromEntries(keys.map(key => [key, connectionStudio[key]]))
  if (connectionStudio.kind === 'api') connectionStudio.drafts.api.entryModel = { ...entryModel }
  Object.assign(connectionStudio, { kind, provider: '', name: '', command: '', args: '', model: '', check: null, plan: null, auth: null, touched: false, account: '', ownerSource: '', ownerActor: '', background: false, models: [], modelError: '' }, connectionStudio.drafts[kind] || {})
  connectionStudio.kind = kind; connectionStudio.generation++
  if (kind === 'api' && connectionStudio.drafts.api?.entryModel) Object.assign(entryModel, connectionStudio.drafts.api.entryModel)
  render(); animateModelConfiguration('.connection-editor')
}
function connectionKindTabs() {
  const row = el('div', 'connection-kinds'); row.setAttribute('role', 'group'); row.setAttribute('aria-label', L('Connection type', '接入方式'))
  for (const [kind, title, glyph, description] of [
    ['api', 'API', 'sources', L('Connect with an API key', '使用密钥连接服务')],
    ['subscription', L('Subscription account', '订阅账号'), 'key', L('Sign in to your account', '登录已有订阅账号')],
    ['cli', 'CLI', 'terminal', L('Use a tool on the host', '使用主机上的工具')]
  ]) {
    const button = opButton('', () => connectionSelect(kind), 'connection-kind')
    button.setAttribute('aria-pressed', String(connectionStudio.kind === kind)); button.disabled = !!(entryState.busy || S.busy)
    button.replaceChildren(add(el('span', 'connection-kind-title'), icon(glyph), el('span', '', title)), el('span', 'connection-kind-description', description))
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
function connectionCreation() { return connectionCreatePage() }
