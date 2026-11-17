const entryModel = {
  creating: false,
  name: '',
  mode: '',
  existingId: '',
  provider: 'openai',
  endpoint: '',
  protocol: 'openai-responses',
  model: '',
  credential: '',
  open: false,
  touched: false,
  plan: null,
  check: null,
  saved: false
}
function entryModelEdit(key, value, redraw = false) {
  entryModel[key] = value
  if (key === 'provider') entryModel.protocol = providerDefaults[value]?.protocol || 'openai-responses'
  entryModel.open = true
  entryModel.touched = true
  entryModel.plan = null
  entryModel.check = null
  entryModel.saved = false
  if (typeof connectionStudio !== 'undefined') { connectionStudio.check = null; connectionStudio.plan = null; if (['provider', 'endpoint', 'protocol', 'credential'].includes(key)) connectionStudio.models = [] }
  document.getElementById('entry-model-result')?.remove()
  document.getElementById('connection-status')?.remove()
  const checkButton = document.querySelector('.model-connection-form button[type="submit"]')
  if (checkButton) { checkButton.textContent = L('Check connection', '检查连接'); checkButton.classList.add('primary') }
  if (redraw) { render(); animateModelConfiguration('.connection-editor') }
}
function animateModelConfiguration(selector) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return
  const node = document.querySelector(selector)
  if (!node) return
  for (const animation of node.getAnimations()) animation.cancel()
  node.animate([{ opacity: 0.45, transform: 'translateY(4px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 180, easing: 'cubic-bezier(.16,1,.3,1)' })
}
function entryModelField(key, label, options = null, type = 'text', required = false) {
  const input = el(options ? 'select' : 'input')
  input.id = 'entry-model-' + key
  if (options) for (const [value, text] of options) input.add(new Option(text, value))
  else {
    input.type = type
    input.autocomplete = 'off'
    input.spellcheck = false
  }
  input.value = entryModel[key]
  input.required = required
  input.disabled = !!(entryState.busy || S.busy)
  if (!options) input.placeholder = { endpoint: 'https://api.example.com/v1', credential: 'sk-…' }[key] || ''
  input[options ? 'onchange' : 'oninput'] = () => entryModelEdit(key, input.value, !!options)
  const title = el('label', '', label)
  title.htmlFor = input.id
  return add(el('div', 'entry-field entry-field-' + key), title, input)
}
function entryModelCanApply() {
  const check = entryModel.check
  return !!(
    entryModel.plan &&
    check &&
    !check.checks.some((c) => c.status === 'required') &&
    (check.ok === true || (S.snap?.preview === true && check.preview === true))
  )
}
function entryModelResult() {
  const pending = entryState.busy === 'model-check'
  if (!entryModel.check && !entryModel.saved && !pending) return null
  const result = el('section', 'model-check-result')
  result.id = 'entry-model-result'
  result.tabIndex = -1
  result.setAttribute('role', 'status')
  result.setAttribute('aria-live', 'polite')
  if (pending) {
    result.dataset.state = 'pending'
    return add(result, add(el('div', 'model-check-line'), icon('refresh'), el('span', '', L('Checking connection…', '正在检查连接…'))))
  }
  if (entryModel.saved) {
    const note = el(
      'p',
      'alert',
      L(
        'Model service saved.',
        '模型服务已保存。'
      )
    )
    note.setAttribute('role', 'status')
    return add(result, note, action(L('Configure Router / Workers', '配置 Router / Workers'), () => opNavigate('execution'), 'btn'))
  }
  result.dataset.state = entryModel.check.ok ? 'ready' : 'error'
  const list = el('ul', 'entry-check-list')
  for (const check of entryModel.check.checks) {
    const [label, hint] = checkCopy(check)
    list.append(
      add(
        el('li'),
        icon(check.status === 'ok' ? 'check' : 'info'),
        add(
          el('div'),
          el('strong', '', label),
          hint && check.status === 'required' ? el('p', 'model-check-hint', hint) : null,
          check.detail
            ? detail(L('Technical detail', '技术详情'), raw(entrySafeDetail(check.detail)))
            : null
        )
      )
    )
  }
  result.append(list)
  if (entryModelCanApply() && entryModel.creating)
    result.append(
      action(
        entryState.data.preview
          ? L('Save preview AI connection', '保存预览 AI 连接')
          : L('Save connection', '保存连接'),
        applyEntryModel,
        'btn primary'
      )
    )
  return result
}
function entryModelSettings() {
  const backend = entryState.data.backend
  if (!backend) return null
  const connections = entryState.data.connections || []
  if (!entryModel.mode) {
    entryModel.mode = backend.configured && connections.some((c) => c.id === backend.id) ? 'existing' : 'codex'
    entryModel.existingId = connections.find((c) => c.id === backend.id)?.id || connections[0]?.id || ''
  }
  const form = el('form', 'entry-form model-connection-form')
  const modes = [['codex', L('Use my Codex sign-in', '使用已有 Codex 登录')], ['api', L('Connect an API service', '连接 API 服务')]]
  if (connections.length && !entryModel.creating) modes.unshift(['existing', L('Use a saved connection', '使用已保存的连接')])
  if (entryModel.creating) form.append(entryModelField('name', L('Service name', '服务名称'), null, 'text', true))
  form.append(entryModelField('mode', L('AI service', 'AI 服务'), modes))
  if (entryModel.mode === 'existing') {
    form.append(entryModelField('existingId', L('Saved connection', '已保存的连接'), connections.map((c) => [c.id, guideConnectionLabel(c)])))
  } else if (entryModel.mode === 'codex') {
    form.append(entryLink(L('Codex installation and sign-in', '安装并登录 Codex'), 'https://developers.openai.com/codex/cli/'))
  } else {
    form.append(entryModelField('provider', L('Provider', '服务商'), [['openai', 'OpenAI'], ['anthropic', 'Anthropic'], ['custom', L('Another provider or team service', '其他服务商或团队服务')]]))
    if (entryModel.provider === 'custom') form.append(entryModelField('endpoint', L('Service address', '服务地址'), null, 'url', true))
    if (entryModel.provider !== 'anthropic') form.append(entryModelField('protocol', L('API format', 'API 格式'), Object.entries(guideApiFormats).filter(([id]) => entryModel.provider === 'custom' || id !== 'anthropic')))
    form.append(entryModelField('model', L('Model name', '模型名称'), null, 'text', true), entryModelField('credential', L('API key', 'API 密钥'), null, 'password'))
  }
  const check = action(entryState.busy === 'model-check' ? L('Checking…', '正在检查…') : entryModel.check ? L('Check again', '重新检查') : L('Check connection', '检查连接'), null, entryModelCanApply() ? 'btn' : 'btn primary')
  check.type = 'submit'
  check.disabled = !!(entryState.busy || S.busy)
  form.append(add(el('div', 'model-connection-actions'), check))
  form.onsubmit = (event) => { event.preventDefault(); void checkEntryModel() }
  const box = detail(L('AI service used by this host', '此宿主使用的 AI 服务'), add(el('div', 'entry-form'), form, entryModelResult()))
  box.open = !backend.configured || entryModel.open
  box.ontoggle = () => { entryModel.open = box.open }
  return box
}
function entryModelConnection() {
  if (entryModel.mode === 'codex') return { kind: 'codex' }
  if (entryModel.mode === 'existing') return { kind: 'existing', id: entryModel.existingId }
  const preset = providerDefaults[entryModel.provider]
  const baseUrl = entryModel.endpoint.trim() || preset?.endpoint
  let valid = false
  try {
    const u = new URL(baseUrl)
    valid =
      !u.username &&
      !u.password &&
      !u.search &&
      !u.hash &&
      (u.protocol === 'https:' ||
        (u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)))
  } catch {}
  if (!valid) throw new ApiError(400, { code: 'model_url_invalid' })
  return {
    kind: 'api',
    protocol: entryModel.provider === 'anthropic' ? 'anthropic' : entryModel.protocol,
    baseUrl,
    model: entryModel.model.trim(),
    ...(entryModel.credential.trim() ? { apiKey: entryModel.credential.trim() } : {})
  }
}
async function checkEntryModel() {
  await entryRun('model-check', async () => {
    entryModel.plan = null
    entryModel.check = null
    entryModel.saved = false
    const connection = entryModelConnection()
    const plan = await api('/entry-setup/model/plan', {
      revision: S.base.revision,
      connection,
      select: false,
      ...(entryModel.creating && entryModel.name.trim() ? { name: entryModel.name.trim() } : {})
    })
    if (!plan.id) throw Error('Invalid AI connection plan')
    entryModel.plan = plan
    const check = await api('/entry-setup/model/check', { id: plan.id })
    if (!Array.isArray(check.checks) || typeof check.ok !== 'boolean')
      throw Error('Invalid AI connection check')
    entryModel.check = check
  })
}
async function applyEntryModel() {
  if (!entryModelCanApply()) return
  await entryRun('model-apply', async () => {
    const receipt = await api('/entry-setup/model/apply', { id: entryModel.plan.id })
    if (receipt.applied !== true || !Number.isInteger(receipt.revision))
      throw Error('Invalid AI connection receipt')
    entryModel.credential = ''
    entryModel.touched = false
    entryModel.plan = null
    entryModel.check = null
    entryModel.saved = true
    entryState.plan = null
    await readEntries(true)
    entryModel.creating = false
    entryState.page = 'models'
    updateWorkspaceLocation(true)
    entryModel.mode = 'existing'
    entryModel.existingId = receipt.connection.id
    await loadGuideContext()
    announce(L('AI connection saved.', 'AI 连接已保存。'))
  })
}
