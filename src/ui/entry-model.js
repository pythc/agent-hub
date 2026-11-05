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
  document.getElementById('entry-model-result')?.remove()
  if (redraw) render()
}
function entryModelField(key, label, hint, options = null, type = 'text', required = false) {
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
  input[options ? 'onchange' : 'oninput'] = () => entryModelEdit(key, input.value, !!options)
  const title = el('label', '', label)
  title.htmlFor = input.id
  const help = el('small', 'hint', hint)
  help.id = input.id + '-help'
  input.setAttribute('aria-describedby', help.id)
  return add(el('div', 'entry-field'), title, input, help)
}
function entryModelCanApply() {
  const check = entryModel.check
  return !!(
    entryModel.plan &&
    check &&
    !check.checks.some((c) => c.status === 'required') &&
    (check.ok === true || (entryState.data.preview === true && check.preview === true))
  )
}
function entryModelResult() {
  if (!entryModel.check && !entryModel.saved) return null
  const result = el('section', 'entry-form')
  result.id = 'entry-model-result'
  result.tabIndex = -1
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
  result.append(el('h3', '', L('AI connection check', 'AI 连接检查')))
  const list = el('ul', 'entry-check-list')
  for (const check of entryModel.check.checks) {
    const [label, hint] = checkCopy(check)
    list.append(
      add(
        el('li'),
        badge(stateLabel(check.status), check.status === 'required' ? 'issue' : ''),
        add(
          el('div'),
          el('strong', '', label),
          hint ? el('p', 'hint', hint) : null,
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
      el(
        'p',
        'hint',
        entryState.data.preview
          ? L(
              'Save to this isolated preview. Live AI requests remain unavailable.',
              '保存到此隔离预览，实际 AI 请求仍不可用。'
            )
          : L(
              'Assign this service to Router or Workers in Execution.',
              '保存后可在执行页分配给 Router 或 Worker。'
            )
      ),
      action(
        entryState.data.preview
          ? L('Save preview AI connection', '保存预览 AI 连接')
          : L('Create service', '创建模型服务'),
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
    entryModel.mode =
      backend.configured && connections.some((c) => c.id === backend.id) ? 'existing' : 'codex'
    entryModel.existingId =
      connections.find((c) => c.id === backend.id)?.id || connections[0]?.id || ''
  }
  const usesCodex =
    entryModel.mode === 'codex' ||
    (entryModel.mode === 'existing' &&
      connections.find((c) => c.id === entryModel.existingId)?.kind === 'codex')
  const form = el('form', 'entry-form')
  const modes = [
    ['codex', L('Use my Codex sign-in', '使用已有 Codex 登录')],
    ['api', L('Connect an API service', '连接 API 服务')]
  ]
  if (connections.length && !entryModel.creating)
    modes.unshift(['existing', L('Use a saved connection', '使用已保存的连接')])
  if (entryModel.creating) form.append(entryModelField('name', L('Service name', '服务名称'), '', null, 'text', true))
  form.append(
    entryModelField(
      'mode',
      L('AI service', 'AI 服务'),
      '',
      modes
    )
  )
  if (entryModel.mode === 'existing')
    form.append(
      entryModelField(
        'existingId',
        L('Saved connection', '已保存的连接'),
        '',
        connections.map((c) => [c.id, guideConnectionLabel(c)])
      )
    )
  else if (entryModel.mode === 'codex')
    form.append(
      el(
        'p',
        'hint',
        L(
          'Use Codex installed and signed in on the computer running AgentHub. If needed, run codex login there and check again.',
          '复用运行 AgentHub 的电脑上已安装、已登录的 Codex。如需登录，在该电脑运行 codex login 后重新检查。'
        )
      ),
      entryLink(
        L('Codex installation guide', 'Codex 安装指南'),
        'https://developers.openai.com/codex/cli/'
      )
    )
  else {
    form.append(
      entryModelField('provider', L('Provider', '服务商'), '', [
        ['openai', 'OpenAI'],
        ['anthropic', 'Anthropic'],
        ['custom', L('Another provider or team service', '其他服务商或团队服务')]
      ])
    )
    if (entryModel.provider === 'custom')
      form.append(
        entryModelField(
          'endpoint',
          L('Service address', '服务地址'),
          L(
            'Copy the HTTPS base URL, or a local HTTP address. Do not include a key or query string.',
            '填写 HTTPS 基础地址或本机 HTTP 地址，不要在地址中放密钥或查询参数。'
          ),
          null,
          'url',
          true
        )
      )
    if (entryModel.provider !== 'anthropic')
      form.append(
        entryModelField(
          'protocol',
          L('API format', 'API 格式'),
          L('Match your provider’s connection format.', '选择服务商支持的连接格式。'),
          Object.entries(guideApiFormats).filter(([id]) => entryModel.provider === 'custom' || id !== 'anthropic')
        )
      )
    form.append(
      entryModelField(
        'model',
        L('Model name', '模型名称'),
        L(
          'Copy the exact model ID supplied by your provider or team.',
          '复制服务商或团队提供的完整模型 ID。'
        ),
        null,
        'text',
        true
      ),
      entryModelField(
        'credential',
        L('API key', 'API 密钥'),
        entryState.data.preview
          ? L(
              'Leave this empty in the preview. No provider is contacted.',
              '预览中可留空，不会联系实际服务。'
            )
          : L(
              'Saved privately on the AgentHub host only after you apply. Leave empty if this service needs no key.',
              '应用后私密保存到 AgentHub 宿主；无需密钥的服务可留空。'
            ),
        null,
        'password'
      )
    )
  }
  form.append(
    el(
      'p',
      'hint',
      entryState.data.preview
        ? L('Preview checks do not contact live services.', '预览检查不会访问实际服务。')
        : usesCodex
          ? L('Checks whether this host can use Codex.', '检查此宿主能否使用 Codex。')
          : L(
              'Checking sends a short text request to the chosen service and may use API credit. No workspace files are sent.',
              '检查会向所选服务发送简短文本请求，可能消耗 API 额度，不会发送工作文件。'
            )
    )
  )
  const check = action(
    entryModel.check ? L('Check again', '重新检查') : L('Check AI connection', '检查 AI 连接'),
    null,
    entryModelCanApply() ? 'btn' : 'btn primary'
  )
  check.type = 'submit'
  form.append(check)
  form.onsubmit = (event) => {
    event.preventDefault()
    void checkEntryModel()
  }
  const box = detail(
    L('AI service used by this host', '此宿主使用的 AI 服务'),
    add(el('div', 'entry-form'), form, entryModelResult())
  )
  box.open = !backend.configured || entryModel.open
  box.ontoggle = () => {
    entryModel.open = box.open
  }
  return box
}
function entryModelConnection() {
  if (entryModel.mode === 'codex') return { kind: 'codex' }
  if (entryModel.mode === 'existing') return { kind: 'existing', id: entryModel.existingId }
  const preset = providerDefaults[entryModel.provider]
  const baseUrl = preset?.endpoint || entryModel.endpoint.trim()
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
    if (dirty()) throw new ApiError(409, { code: 'advanced_draft' })
    entryModel.plan = null
    entryModel.check = null
    entryModel.saved = false
    const connection = entryModelConnection()
    const plan = await api('/entry-setup/model/plan', {
      revision: entryState.data.revision,
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
    if (dirty()) throw new ApiError(409, { code: 'advanced_draft' })
    const receipt = await api('/entry-setup/model/apply', { id: entryModel.plan.id })
    if (receipt.applied !== true || !Number.isInteger(receipt.revision))
      throw Error('Invalid AI connection receipt')
    entryModel.credential = ''
    entryModel.touched = false
    entryModel.plan = null
    entryModel.check = null
    entryModel.saved = true
    entryState.plan = null
    await readEntries()
    entryModel.creating = false
    entryModel.mode = 'existing'
    entryModel.existingId = receipt.connection.id
    await loadGuideContext()
    announce(L('AI connection saved.', 'AI 连接已保存。'))
  })
}
