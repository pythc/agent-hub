// Public use instructions and operator setup have distinct sessions.
const entryState = {
  role: '',
  page: 'home',
  advancedPage: 'host',
  promptView: 'roles',
  selected: '',
  source: '',
  publicGuide: null,
  sharedGuide: null,
  data: null,
  loading: false,
  sessionChecked: false,
  inventoryLoading: false,
  inventoryError: false,
  inventoryRequest: 0,
  busy: '',
  error: null,
  probe: null,
  plan: null,
  applied: null,
  verification: null,
  creating: false,
  invite: '',
  share: null,
  clientConfig: null,
  draft: {},
  touched: false,
  timer: 0,
  polls: 0
}
try {
  entryState.role = localStorage.getItem('agenthub.entry.role') || ''
} catch {}
let entryPairCode = ''
function consumeEntryFragment() {
  const fragment = new URLSearchParams(location.hash.slice(1))
  const code = fragment.get('pair'),
    invite = fragment.get('invite')
  if (!code && !invite) return false
  history.replaceState(null, '', location.pathname + location.search)
  entryPairCode = code || ''
  entryState.invite = invite || ''
  entryState.sharedGuide = null
  entryState.role = code ? 'operator' : 'user'
  try {
    localStorage.setItem('agenthub.entry.role', entryState.role)
  } catch {}
  S.surface = 'entries'
  return true
}
consumeEntryFragment()
window.addEventListener('hashchange', () => {
  if (consumeEntryFragment()) void startEntrySession()
  else applyWorkspaceLocation()
})
const entryNames = () => ({
  local: L('Local assistant', '本机助手'),
  feishu: L('Feishu', '飞书'),
  wecom: L('WeCom', '企业微信'),
  codex: 'Codex',
  cursor: 'Cursor',
  vscode: 'VS Code',
  workbuddy: 'WorkBuddy',
  github: 'GitHub',
  generic: L('Other MCP clients', '通用 MCP 客户端')
})
const entryName = (entry) =>
  entryNames()[typeof entry === 'string' ? entry : entry?.id] ||
  entry?.label ||
  L('Connection', '入口')
const entryText = (value) =>
  typeof value === 'object' && value
    ? (lang === 'en' ? value.en : value.zh || value['zh-CN']) || value.en || ''
    : String(value ?? '')
const selectedEntry = () => entryState.data?.entries?.find((e) => e.id === entryState.selected)
const entryHasDraft = () => entryState.touched || entryModel.touched || connectionStudio.touched || !!integrations.draft
function entrySafeDetail(value) {
  let text = String(value ?? '')
  for (const secret of [
    S.token,
    S.typed,
    entryState.draft.appSecret,
    entryState.draft.secret,
    entryModel.credential
  ])
    if (secret) text = text.split(secret).join('[…]')
  return text.slice(0, 1200)
}
const workspacePages = {
  tasks: 'home', 'tasks/history': 'activity', attention: 'attention', connections: 'catalog',
  'connections/new': 'catalogue', models: 'models', 'models/new': 'model-new',
  deployments: 'deployments', integrations: 'integrations', execution: 'execution', prompts: 'prompts', usage: 'usage'
}
const advancedPages = ['host', 'chat', 'memory', 'intake', 'runtime', 'delivery', 'json', 'revisions']
function workspaceHash() {
  const { page, selected, source, creating, advancedPage, promptView } = entryState
  if (page === 'advanced') return 'advanced/' + advancedPage
  if (page === 'execution' && executionView.mode === 'configuration') return 'execution/configuration'
  if (page === 'prompts' && promptView === 'templates') return 'prompts/templates'
  if (page === 'detail') {
    const prefix = creating ? 'connections/new/' : 'connections/'
    return prefix + encodeURIComponent(selected) + (source ? '/' + encodeURIComponent(source) : '')
  }
  return Object.keys(workspacePages).find(key => workspacePages[key] === page) || 'tasks'
}
function updateWorkspaceLocation(replace = false) {
  const url = new URL(location.href)
  if(typeof configurationHost !== 'undefined' && configurationHost){url.pathname='/configure';url.search=''}
  url.hash = workspaceHash()
  if (url.href !== location.href) {
    history[replace ? 'replaceState' : 'pushState'](null, '', url)
    if(typeof configurationHost !== 'undefined' && configurationHost) window.dispatchEvent(new Event('roppo:navigation'))
  }
}
function applyWorkspaceLocation() {
  if(typeof configurationHost !== 'undefined' && configurationHost && !configurationHost.active())return
  const hash = location.hash === '#integrations/tools' ? 'integrations' : location.hash.slice(1)
  const page = Object.hasOwn(workspacePages, hash) ? workspacePages[hash] : null
  let matched
  if (page) return entryNavigate(page, '', { fromLocation: true, view: page === 'execution' ? 'calls' : 'roles' })
  if (hash === 'execution/configuration')
    return entryNavigate('execution', '', { fromLocation: true, view: 'configuration' })
  if (hash === 'prompts/templates')
    return entryNavigate('prompts', '', { fromLocation: true, view: 'templates' })
  if (hash === 'advanced' || (hash.startsWith('advanced/') && advancedPages.includes(hash.slice(9))))
    return entryNavigate('advanced', '', { fromLocation: true, view: hash.slice(9) || 'host' })
  if ((matched = /^connections\/(new\/)?([a-z][a-z0-9_-]*)(?:\/([a-z][a-z0-9_-]*))?$/.exec(hash)))
    return entryNavigate('detail', matched[2], { fromLocation: true, creating: !!matched[1], source: matched[3] || '' })
  if (!hash && S.authed && entryState.role === 'operator') return entryNavigate('home', '', { fromLocation: true })
}
function entryNavigate(page, id = '', options = {}) {
  if (entryState.busy || S.busy) {
    if (options.fromLocation) updateWorkspaceLocation(true)
    return false
  }
  const source = options.source ?? (id === entryState.selected ? entryState.source : '')
  const creating = options.creating === true
  const changeConnection = id && (id !== entryState.selected || source !== entryState.source || creating !== entryState.creating)
  if (changeConnection && entryState.touched && !confirm(
    L('Discard the unsaved changes for this connection?', '放弃当前入口尚未保存的修改？')
  )) {
    if (options.fromLocation) updateWorkspaceLocation(true)
    return false
  }
  clearTimeout(entryState.timer)
  if (changeConnection) {
    Object.assign(entryState, {
      selected: id, source, creating, probe: null, plan: null, applied: null,
      verification: null, clientConfig: null, draft: creating ? { botMode: 'existing' } : {}, touched: false
    })
  }
  if (page === 'advanced') entryState.advancedPage = options.view || 'host'
  if (page === 'execution' && options.view) executionView.mode = options.view
  if (page === 'prompts' && options.view) entryState.promptView = options.view
  if (page === 'model-new' && !entryModel.creating) resetNewModel()
  const enteringHistory = page === 'activity' && entryState.page !== 'activity'
  if (enteringHistory) operator.offset = 0
  entryState.page = page
  entryState.error = null
  if (S.notice?.level === 'success') S.notice = null
  entryState.role = 'operator'
  S.surface = 'entries'
  operator.drawer = null
  if (page !== 'execution') {
    executionView.inspect = null
    executionView.instructions = null
  }
  if (!options.fromLocation) updateWorkspaceLocation()
  render(true)
  if (page === 'advanced' && !S.authed) void loadConnectInfo()
  if (enteringHistory && S.authed)
    void entryRun('work-page', readOperatorWork)
  if (S.authed) void ensureEntryInventory()
  return true
}
function chooseEntryRole(role) {
  if (entryState.busy || S.busy) return
  clearTimeout(entryState.timer)
  entryState.role = role
  entryState.page = 'home'
  if (role === 'user') history.replaceState(null, '', location.pathname + location.search)
  entryState.error = null
  entryState.share = null
  S.surface = 'entries'
  try {
    localStorage.setItem('agenthub.entry.role', role)
  } catch {}
  render(true)
  if (role === 'operator') {
    void loadConnectInfo()
    if (S.authed) void refreshEntries()
    else if (entryState.operator) void connectHost('', true)
  }
  if (role === 'user' && !entryState.publicGuide) void entryRun('load', loadEntryGuide)
}
function entryError(error) {
  if (error.payload?.code === 'workspace_obsolete') return
  if (error.status === 401) {
    S.authed = false
    S.token = ''
  }
  const code = error.payload?.code || ''
  const messages = {
    model_url_invalid: [
      'Enter an HTTPS base URL or local HTTP address without credentials or query parameters.',
      '请输入 HTTPS 基础地址或本机 HTTP 地址，不要包含凭据或查询参数。'
    ],
    advanced_draft: [
      'Save or discard configuration changes before applying setup.',
      '请先保存或放弃配置更改，再应用首次设置。'
    ],
    connection_missing: [
      'This saved AI connection is no longer available. Refresh and select another.',
      '已保存的 AI 连接已不可用，请刷新并重新选择。'
    ],
    credentials_incomplete: [
      'Enter both the App ID and App Secret to check this bot.',
      '请同时填写 App ID 与 App Secret，再检查此机器人。'
    ],
    probe_required: [
      'Check the connection again to refresh its available choices.',
      '请重新检查连接，刷新可选项。'
    ],
    chat_unavailable: [
      'Choose a chat returned by the latest bot check.',
      '请选择最近一次机器人检查返回的群聊。'
    ],
    source_missing: [
      'Set up and enable this entry before starting verification.',
      '请先配置并启用此入口，再开始验证。'
    ],
    sender_not_observed: [
      'Send a request from the target software first, then refresh verification.',
      '请先从目标软件发送请求，再刷新验证进度。'
    ],
    plan_expired: [
      'This setup review expired. Check your choices again.',
      '这次配置预览已过期，请重新检查选择。'
    ],
    configuration_busy: [
      'Another change is being applied. Wait briefly, then retry.',
      '其他配置正在应用，请稍后重试。'
    ],
    pair_expired: [
      'This management link has expired or was already used. Open a new link from the host.',
      '此管理链接已过期或已使用，请打开宿主提供的新链接。'
    ],
    client_conflict: [
      'This client already has an AgentHub connection. Review its configuration before replacing it.',
      '此客户端已有 AgentHub 连接，请先核对现有配置。'
    ],
    runtime_busy: [
      'Work is still running. Wait for it to finish, then apply again.',
      '当前有任务正在运行。请等任务结束后再应用。'
    ],
    settings_conflict: [
      'Settings changed in another session. Your inputs are kept. Refresh and check them again.',
      '设置已在其他会话中更新。输入已保留，请刷新后重新检查。'
    ],
    invite_invalid: [
      'This invitation is invalid or expired. Ask the administrator for a new link.',
      '邀请无效或已过期，请向管理员获取新的链接。'
    ],
    preview_restricted: [
      'This preview cannot install clients or send requests to external services.',
      '此预览无法安装客户端或向外部服务发送请求。'
    ]
  }
  const text =
    messages[code] ||
    (error.status === 401
      ? [
          'Operator access is needed. Open a fresh management link from the host.',
          '需要管理权限，请打开宿主提供的新管理链接。'
        ]
      : error.status === 404
        ? [
            'This host does not provide the entry setup API. Update the host and try again.',
            '此宿主尚未提供入口配置接口，请更新宿主后重试。'
          ]
        : [
            'The action could not finish. Review the details and try again.',
            '操作未完成，请查看详情后重试。'
          ])
  entryState.error = { text, detail: entrySafeDetail(error.message), code }
  if (error.status === 409 || ['plan_expired', 'plan_missing'].includes(code)) {
    entryState.plan = null
    entryModel.plan = null
    entryModel.check = null
  }
}
async function entryRun(label, operation, focus = false) {
  if (entryState.busy || S.busy) return
  entryState.busy = label
  entryState.error = null
  render()
  try {
    await operation()
  } catch (error) {
    entryError(error)
  } finally {
    entryState.busy = ''
    render(focus)
    const next = document.getElementById(
      label.startsWith('model-')
        ? 'entry-model-result'
        : label === 'plan'
          ? 'entry-plan-review'
          : ['apply', 'verify', 'install'].includes(label)
            ? 'entry-verification'
            : ''
    )
    if (next) {
      next.tabIndex = -1
      next.focus({ preventScroll: true })
      next.scrollIntoView({ block: 'nearest' })
    }
    const alert = document.getElementById('entry-error')
    if (alert) {
      alert.focus({ preventScroll: true })
      alert.scrollIntoView({ block: 'nearest' })
    }
  }
}
async function loadEntryGuide() {
  const data = await api('/entry-guide', undefined, true)
  if (!Array.isArray(data.entries)) throw Error('Invalid entry guide response')
  entryState.publicGuide = data
}
function needsEntryInventory() {
  return ['catalog', 'catalogue', 'detail', 'usage', 'model-new'].includes(entryState.page) ||
    entryState.page === 'models' && entryModel.creating
}
async function readEntryInventory(rebaseOwnChange = false) {
  const request = ++entryState.inventoryRequest, epoch = workspaceContext.epoch
  entryState.inventoryLoading = true
  entryState.inventoryError = false
  try {
    const data = await api('/entry-setup')
    if (request !== entryState.inventoryRequest || epoch !== workspaceContext.epoch) return
    if (!Array.isArray(data.entries) || !Number.isInteger(data.revision)) throw Error('Invalid entry setup response')
    if (S.base && data.revision !== S.base.revision) {
      const latest = await snapshot()
      if (request !== entryState.inventoryRequest || epoch !== workspaceContext.epoch) return
      adopt(latest, rebaseOwnChange)
    }
    if (request !== entryState.inventoryRequest || epoch !== workspaceContext.epoch) return
    entryState.data = data
  } catch (error) {
    if (request !== entryState.inventoryRequest || epoch !== workspaceContext.epoch) return
    entryState.inventoryError = true
    throw error
  } finally {
    if (request === entryState.inventoryRequest) entryState.inventoryLoading = false
  }
}
async function ensureEntryInventory() {
  if (!S.authed || !needsEntryInventory() || entryState.data || entryState.inventoryLoading || entryState.inventoryError) return
  const epoch = workspaceContext.epoch
  try { await readEntryInventory() }
  catch (error) { entryError(error) }
  finally { if (epoch === workspaceContext.epoch && needsEntryInventory()) render() }
}
async function readEntries(rebaseOwnChange = false) {
  await Promise.all([readEntryInventory(rebaseOwnChange), readOperatorWork(), connectionDiscover(), integrationsDiscover()])
}
async function refreshEntries() {
  await entryRun('refresh', async () => {
    await readEntries()
  })
}
async function acceptEntryInvite() {
  await entryRun(
    'invite',
    async () => {
      const data = await api('/entry-guide', { invite: entryState.invite }, true)
      if (!Array.isArray(data.entries) || data.operator !== false)
        throw Error('Invalid usage invitation')
      entryState.sharedGuide = data
      try {
        sessionStorage.setItem('agenthub.entry.guide', JSON.stringify(data))
      } catch {}
      entryState.invite = ''
    },
    true
  )
}
async function startEntrySession() {
  if (entryState.loading) return
  entryState.loading = true
  entryState.sessionChecked = false
  entryState.error = null
  if (!entryState.sharedGuide && !entryState.invite && entryState.role === 'user') {
    try {
      const cached = JSON.parse(sessionStorage.getItem('agenthub.entry.guide') || 'null')
      if (cached?.operator === false && Array.isArray(cached.entries))
        entryState.sharedGuide = cached
    } catch {}
  }
  render()
  try {
    if (entryPairCode) {
      const code = entryPairCode
      entryPairCode = ''
      await api('/pair', { code }, true)
    }
    const session = await api('/session', undefined, true)
    entryState.sessionChecked = true
    entryState.operator = session.operator === true
    entryState.account = session.account || null
    if (session.account?.authenticated && !entryState.invite && location.pathname !== "/usage") entryState.role = "operator"
    render()
    if (entryState.operator && entryState.role !== 'user') {
      await loadConnectInfo()
      await connectHost('', true)
      if (!entryState.role) entryState.role = 'operator'
    }
    await loadEntryGuide()
    if (entryState.invite) await acceptEntryInvite()
  } catch (error) {
    entryError(error)
  } finally {
    entryState.loading = false
    render()
  }
}
function entryEdit(key, value) {
  entryState.draft[key] = value
  entryState.touched = true
  entryState.plan = null
  entryState.applied = null
  document.getElementById('entry-plan-review')?.remove()
}
async function probeEntry() {
  await entryRun('probe', async () => {
    const d = entryState.draft
    if (
      entryState.selected === 'feishu' &&
      (d.appId || d.appSecret) &&
      !(d.appId?.trim() && d.appSecret?.trim())
    )
      throw new ApiError(400, { code: 'credentials_incomplete' })
    const credentials =
      entryState.selected === 'feishu' && d.appId?.trim() && d.appSecret?.trim()
        ? { appId: d.appId.trim(), appSecret: d.appSecret.trim() }
        : undefined
    entryState.probe = await api('/entry-setup/probe', {
      entryId: entryState.selected,
      ...(credentials ? { credentials } : {})
    })
    await readEntries()
  })
}
function entryPlanInput() {
  const d = entryState.draft
  const credentials = Object.fromEntries(
    ['appId', 'appSecret', 'botId', 'secret']
      .filter((key) => d[key]?.trim())
      .map((key) => [key, d[key].trim()])
  )
  return {
    revision: entryState.data.revision,
    entryId: entryState.selected,
    ...(d.name?.trim() ? { name: d.name.trim() } : {}),
    ...(d.scopes ? { scopeIds: d.scopes } : {}),
    ...(d.actors?.trim()
      ? {
          actors: d.actors
            .split(/[,\n]/)
            .map((s) => s.trim())
            .filter(Boolean)
        }
      : {}),
    ...(Object.keys(credentials).length ? { credentials } : {}),
    ...(d.repository?.trim() ? { repository: d.repository.trim() } : {}),
    ...(d.workspace?.trim() ? { workspace: d.workspace.trim() } : {})
  }
}
async function planEntry() {
  await entryRun('plan', async () => {
    entryState.plan = await api('/entry-setup/plan', entryPlanInput())
    if (!entryState.plan.id) throw Error('Invalid connection plan')
  })
}
async function applyEntry() {
  if (!entryState.plan) return
  await entryRun('apply', async () => {
    entryState.applied = await api('/entry-setup/apply', {
      id: entryState.plan.id
    })
    entryState.source = entryState.applied.sourceId || ''
    entryState.creating = false
    entryState.touched = false
    entryState.plan = null
    entryState.draft = {}
    await readEntries(true)
    updateWorkspaceLocation(true)
    announce(
      L(
        'Connection settings saved. Verify a request in the selected software.',
        '入口设置已保存。请在所选软件中验证一条请求。'
      )
    )
  })
}
async function installEntry() {
  await entryRun('install', async () => {
    const result = await api('/entry-setup/install', {
      entryId: entryState.selected
    })
    entryState.applied = result
    await readEntries()
  })
}
async function loadEntryConfig() {
  await entryRun('config', async () => {
    entryState.clientConfig = await api(
      '/entry-setup/client-config?entryId=' + encodeURIComponent(entryState.selected)
    )
  })
}
async function startEntryVerification() {
  await entryRun('verify', async () => {
    const result = await api('/entry-setup/verification', {
      entryId: entryState.selected,
      language: lang === 'en' ? 'en' : 'zh',
      ...(entryState.source ? { sourceId: entryState.source } : {})
    })
    if (!result.id || !Array.isArray(result.stages)) throw Error('Invalid verification response')
    entryState.verification = result
    entryState.polls = 60
  })
  scheduleEntryVerification()
}
function scheduleEntryVerification() {
  clearTimeout(entryState.timer)
  const v = entryState.verification
  if (
    !v ||
    entryState.page !== 'detail' ||
    S.surface !== 'entries' ||
    v.stages?.every((s) => s.status === 'ok') ||
    entryState.polls <= 0 ||
    document.hidden
  )
    return
  entryState.timer = setTimeout(() => refreshEntryVerification(false), 2500)
}
async function refreshEntryVerification(manual = true) {
  const id = entryState.verification?.id
  if (!id) return
  const read = async () => {
    const result = await api('/entry-setup/verification/' + encodeURIComponent(id))
    if (entryState.verification?.id !== id) return
    const changed = !same(entryState.verification, result)
    entryState.verification = result
    entryState.polls--
    return changed
  }
  if (manual) {
    entryState.polls = 60
    await entryRun('verify', read)
  } else {
    try {
      const changed = await read()
      const region = document.getElementById('entry-verification')
      if (region && !entryState.busy && (changed || entryState.polls === 0)) {
        const focused = region.contains(document.activeElement) ? document.activeElement.id : ''
        region.replaceChildren(...entryVerificationContents())
        if (focused) document.getElementById(focused)?.focus({ preventScroll: true })
      }
    } catch (error) {
      entryError(error)
      render()
      return
    }
  }
  scheduleEntryVerification()
}
async function shareEntries(ids) {
  await entryRun('share', async () => {
    const result = await api('/entry-setup/share', { entryIds: ids })
    if (!result.url) throw Error('Missing usage link')
    entryState.share = result
  })
}
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && S.surface === 'entries') scheduleEntryVerification()
})
