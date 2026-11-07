// The guide is a separate draft. Moving between it and the advanced editor never saves either one.
const guide = {
  step: 0,
  furthest: 0,
  touched: false,
  mode: 'codex',
  channel: 'local',
  folderMode: 'suggested',
  folder: '',
  provider: 'openai',
  endpoint: '',
  model: '',
  protocol: 'openai-responses',
  credential: '',
  existingId: '',
  context: null,
  contextError: false,
  busy: '',
  check: null,
  issue: null,
  plan: null,
  saved: null
}
const stepNames = () => [
  L('AI service', 'AI 服务'),
  L('Task inbox', '任务入口'),
  L('Work folder', '工作文件夹'),
  L('Review & try', '检查并试用')
]
const guideHasDraft = () => (guide.touched && !guide.saved) || !!inbox.text.trim()
function invalidateGuide() {
  guide.touched = true
  guide.furthest = Math.min(guide.furthest, guide.step)
  guide.plan = null
  guide.check = null
  guide.saved = null
  guide.issue = null
}
function selectGuide(key, value, redraw = true) {
  if (guide[key] === value) return
  invalidateGuide()
  if (['provider', 'endpoint', 'mode'].includes(key)) {
    guide.credential = ''
    const secret = document.getElementById('guide-credential')
    if (secret) secret.value = ''
  }
  guide[key] = value
  if (redraw) render()
  else {
    document.querySelectorAll('.step-link').forEach((button, i) => {
      button.disabled = i > guide.furthest
    })
    const input = document.getElementById('guide-' + key)
    if (input?.hasAttribute('aria-invalid')) {
      input.removeAttribute('aria-invalid')
      input.removeAttribute('aria-errormessage')
      document.getElementById('guide-issue')?.remove()
    }
  }
}
function switchSurface(surface) {
  if (guide.busy || S.busy || entryState.busy) return
  if (surface === 'advanced') {
    entryNavigate('advanced')
    return
  }
  if (surface === 'entries') {
    S.surface = 'entries'
    render(true)
    return
  }
  S.surface = 'guide'
  render(true)
}
function guideStep(n) {
  if (guide.busy) return
  guide.step = n
  guide.furthest = Math.max(n, guide.furthest)
  guide.issue = null
  render(true)
}
function guideBrand() {
  return add(
    el('div', 'guide-brand'),
    add(el('span', 'brand-mark'), icon('brand')),
    el('span', '', 'AgentHub')
  )
}
function guideHeader() {
  const advanced = action(
    L('Advanced settings', '高级设置'),
    () => switchSurface('advanced'),
    'text-action',
    'advanced'
  )
  advanced.disabled = !!guide.busy
  return add(
    el('header', 'guide-header'),
    guideBrand(),
    add(el('div', 'tools'), action(L('Connections & attention', '入口与待处理'), () => entryNavigate('home'), 'text-action'), themeToggle(), add(el('label', 'inline'), icon('lang'), languagePicker()), advanced)
  )
}
function stepList() {
  const nav = el('nav', 'guide-steps')
  nav.setAttribute('aria-label', L('Setup progress', '设置进度'))
  const list = el('ol')
  stepNames().forEach((label, i) => {
    const button = action(
      '',
      () => {
        if (i <= guide.furthest) guideStep(i)
      },
      'step-link'
    )
    button.disabled = !!guide.busy || i > guide.furthest
    if (i === guide.step) button.setAttribute('aria-current', 'step')
    const mark = el('span', 'step-number', i + 1)
    if (i < guide.step) {
      mark.replaceChildren(icon('check'))
      button.classList.add('past')
    }
    button.replaceChildren(mark, el('span', 'step-name', label))
    list.append(add(el('li'), button))
  })
  return add(nav, list)
}
function guideRadio(key, value, title, description) {
  const radio = el('input')
  radio.type = 'radio'
  radio.name = 'guide-' + key
  radio.id = 'guide-' + key + '-' + value
  radio.checked = guide[key] === value
  radio.onchange = () => {
    if (radio.checked) selectGuide(key, value)
  }
  return add(
    el('label', 'guide-choice'),
    radio,
    add(el('span'), el('strong', '', title), el('small', '', description))
  )
}
function guideOptions(legend, ...opts) {
  return add(el('fieldset', 'guide-options'), el('legend', 'sr-only', legend), ...opts)
}
function guideText(key, label, hint, { type = 'text', placeholder = '' } = {}) {
  const input = el('input')
  input.type = type
  input.id = 'guide-' + key
  input.value = guide[key]
  input.placeholder = placeholder
  input.autocomplete = 'off'
  input.spellcheck = false
  input.oninput = () => selectGuide(key, input.value, false)
  const caption = el('label', 'field-label', label)
  caption.htmlFor = input.id
  const help = el('small', 'hint', hint)
  help.id = input.id + '-help'
  input.setAttribute('aria-describedby', help.id)
  return add(el('div', 'guide-field'), caption, input, help)
}
function guideSelect(key, label, opts) {
  const select = el('select')
  select.id = 'guide-' + key
  for (const [value, text] of opts) select.add(new Option(text, value))
  select.value = guide[key]
  select.onchange = () => selectGuide(key, select.value)
  const caption = el('label', 'field-label', label)
  caption.htmlFor = select.id
  return add(el('div', 'guide-field'), caption, select)
}
function serviceFields() {
  const fields = [
    guideOptions(
      L('Choose an AI service', '选择 AI 服务'),
      guideRadio(
        'mode',
        'codex',
        L('Use my Codex sign-in', '使用已有的 Codex 登录'),
        L(
          'Choose this if you already use Codex on the computer running AgentHub.',
          '如果已在运行 AgentHub 的电脑上使用 Codex，请选这一项。'
        )
      ),
      guideRadio(
        'mode',
        'api',
        L('Connect an API service', '连接我的 API 服务'),
        L(
          'Choose this if your provider or team gave you a model name and an API key.',
          '如果服务商或团队给了你模型名称和 API 密钥，请选这一项。'
        )
      )
    )
  ]
  if (S.authed && guide.context?.connections?.length) {
    const options = fields[0]
    options.append(
      guideRadio(
        'mode',
        'existing',
        L('Use a saved connection', '使用已保存的连接'),
        L('Keep a service already set up on this AgentHub.', '使用当前 AgentHub 已配置的服务。')
      )
    )
  }
  if (guide.mode === 'existing' && guide.context?.connections?.length) {
    fields.push(
      guideSelect(
        'existingId',
        L('Saved connection', '已保存的连接'),
        guide.context.connections.map((c) => [c.id, guideConnectionLabel(c)])
      )
    )
  } else if (guide.mode === 'codex') {
    const install = el('a', '', L('Open the official Codex installation guide', '打开 Codex 官方安装指南'))
    install.href = 'https://developers.openai.com/codex/cli/'
    install.target = '_blank'
    install.rel = 'noopener noreferrer'
    fields.push(
      detail(
        L('Need to install or sign in to Codex?', '还没有安装或登录 Codex？'),
        add(
          el('div', 'guide-help'),
          el(
            'p',
            '',
            L(
              'On the computer running AgentHub, open a terminal and run the command below. Follow the sign-in instructions, then return here.',
              '在运行 AgentHub 的电脑上打开终端，运行下方命令，按提示登录后返回这里。'
            )
          ),
          raw('codex login'),
          install
        )
      )
    )
  } else fields.push(...apiServiceFields())
  if (!S.authed)
    fields.push(
      detail(L('Already have a connection on this host?', '已在此宿主配置过连接？'), accessPanel())
    )
  return fields
}
function channelFields() {
  const later = detail(
    L('Planning to use a team chat later?', '以后想从团队聊天交代任务？'),
    add(
      el('div', 'guide-options guide-help'),
      guideRadio(
        'channel',
        'feishu',
        L('Use Feishu later', '稍后接入飞书'),
        L('Connect a team bot after your browser setup works.', '浏览器试用成功后，再连接团队机器人。')
      ),
      guideRadio(
        'channel',
        'wecom',
        L('Use WeCom later', '稍后接入企业微信'),
        L('Set up the company bot with an administrator later.', '之后再与管理员一起配置企业微信机器人。')
      )
    )
  )
  later.open = guide.channel !== 'local'
  return [
    guideOptions(
      L('Choose where to send tasks', '选择任务入口'),
      guideRadio(
        'channel',
        'local',
        L('Start on this page', '先在这个页面试用'),
        L('Use the browser inbox. No chat account is needed.', '使用浏览器任务入口，无需聊天平台账号。')
      ),
      later
    )
  ]
}
function folderFields() {
  const suggestion = suggestedFolder()
  const fields = [
    guideOptions(
      L('Choose a dedicated folder', '选择专用文件夹'),
      guideRadio(
        'folderMode',
        'suggested',
        L('Use the suggested folder', '使用建议的专用文件夹'),
        suggestion ||
          L(
            'AgentHub supplies a path on its computer when connected.',
            '连接后将显示 AgentHub 所在电脑上的建议路径。'
          )
      ),
      guideRadio(
        'folderMode',
        'custom',
        L('Enter another folder', '指定其他文件夹'),
        L(
          'Use a dedicated folder on the computer running AgentHub.',
          '使用运行 AgentHub 的电脑上的专用文件夹。'
        )
      )
    )
  ]
  if (guide.folderMode === 'custom')
    fields.push(
      guideText(
        'folder',
        L('Full folder path', '文件夹完整路径'),
        L(
          'Copy its path from your file manager. Choose a folder for this assistant, separate from personal files.',
          '从文件管理器复制路径。请选择供助手专用的文件夹，与个人文件分开。'
        ),
        { placeholder: L('Example: /Users/me/AgentHub-work', '例如 /Users/me/AgentHub-work') }
      )
    )
  fields.push(
    el(
      'p',
      'hint',
      L(
        'The browser inbox will have read-only access to this folder.',
        '浏览器任务入口将以只读权限使用此文件夹。'
      )
    )
  )
  return fields
}
function guideProblem(en, zh, field = '') {
  guide.issue = { en, zh, field }
  render()
  const node = document.getElementById(field ? 'guide-' + field : 'guide-issue')
  node?.focus()
  node?.scrollIntoView({ block: 'nearest' })
}
function guideNext() {
  if (guide.step === 0 && guide.mode === 'api' && !validateService()) return
  if (guide.step === 2 && guide.folderMode === 'custom' && !guide.folder.trim()) {
    guideProblem(
      'Enter a folder path or choose the suggested folder.',
      '请输入文件夹路径，或选择建议的文件夹。',
      'folder'
    )
    return
  }
  guideStep(Math.min(guide.step + 1, 3))
}
function guideNotice() {
  if (!guide.issue) return null
  const n = add(el('div', 'alert error'), el('p', '', L(guide.issue.en, guide.issue.zh)))
  n.id = 'guide-issue'
  n.tabIndex = -1
  n.setAttribute('role', 'alert')
  if (guide.issue.detail) n.append(detail(L('Details', '详情'), raw(guide.issue.detail)))
  return n
}
function renderGuide() {
  const inInbox = guide.step === 3 && !!guide.saved
  const titles = [
    L('Which AI service will you use?', '你打算使用哪种 AI 服务？'),
    L('Where will you give it tasks?', '你想在哪里交代任务？'),
    L('Where should it work?', '助手应在哪个文件夹工作？'),
    L('Review your first setup', '确认你的首次设置')
  ]
  const subtitles = [
    L('Choose how AgentHub will answer your first request.', '选择 AgentHub 用来处理第一条请求的服务。'),
    L(
      'You can try one request here before connecting a team chat.',
      '可以先在这里试一条请求，再连接团队聊天。'
    ),
    L(
      'Give the assistant a folder of its own on the computer running AgentHub.',
      '在运行 AgentHub 的电脑上，为助手指定一个专用文件夹。'
    ),
    L(
      'Check your choices, save the setup, then try a small task.',
      '先检查选择并保存设置，再试一个小任务。'
    )
  ]
  const title = el(
    'h2',
    '',
    guide.step === 3 && guide.saved ? L('Your setup', '你的设置') : titles[guide.step]
  )
  title.id = 'page-title'
  title.tabIndex = -1
  const skip = el('a', 'skip', L('Skip to setup', '跳至当前步骤'))
  skip.href = '#main'
  document.documentElement.lang = lang
  document.title = (inInbox ? L('Task inbox', '任务收件箱') : L('Get started', '开始使用')) + ' · AgentHub'
  const intro = add(
    el('div', 'guide-intro'),
    el(
      'h1',
      '',
      inInbox ? L('Your task inbox', '你的任务收件箱') : L('Set up your first task', '准备你的第一条任务')
    ),
    el(
      'p',
      '',
      inInbox
        ? L('Give your assistant a request and follow its reply here.', '直接在这里交代任务并查看回复。')
        : isGuidePreview()
          ? L(
              'Try the four steps and save a preview setup. Live AI checks and test requests are available on a running host.',
              '可在这里体验四个步骤并保存预览设置。实际 AI 连接检查和测试请求请在运行中的正式宿主上进行。'
            )
          : L(
              'Connect an AI service and give it a read-only folder. Then ask it to reply “Ready” from this browser.',
              '连接 AI 服务，为它指定只读文件夹，然后从浏览器发条消息，请它回复“准备好了”。'
            )
    )
  )
  const stage = add(
    el('section', 'guide-stage'),
    add(
      el('div', 'guide-title'),
      title,
      guide.step === 3 && guide.saved ? null : el('p', '', subtitles[guide.step])
    )
  )
  const form = el('fieldset', 'guide-body')
  form.disabled = !!guide.busy || !!S.busy
  const content = [serviceFields, channelFields, folderFields, reviewFields][guide.step]()
  add(form, ...content)
  const controls = el('div', 'guide-actions')
  if (guide.step > 0 && !guide.saved)
    controls.append(action(L('Back', '上一步'), () => guideStep(guide.step - 1), 'text-action'))
  if (guide.step < 3) controls.append(action(L('Continue', '下一步'), guideNext, 'btn primary', 'arrow'))
  const notice = guideNotice()
  const offline =
    S.healthDone && !S.health?.ok
      ? add(
          el('div', 'alert warning'),
          el(
            'p',
            '',
            L(
              'AgentHub is unreachable. You can keep choosing options here and reconnect before saving.',
              '暂时连不上 AgentHub。可以继续选择，保存前再重新连接。'
            )
          ),
          action(
            L('Retry connection', '重试连接'),
            async () => {
              await health()
              render()
            },
            'text-action',
            'refresh'
          )
        )
      : null
  add(stage, offline, notice, S.notice || S.busy ? noticeView() : null, form)
  if (controls.children.length) {
    for (const b of controls.querySelectorAll('button')) b.disabled = !!guide.busy || !!S.busy
    stage.append(controls)
  }
  if (inInbox) {
    title.className = 'sr-only'
    stage.querySelector('.guide-title').style.marginBottom = '0'
  }
  const main = add(el('main', 'guide-main'), intro, inInbox ? null : stepList(), stage)
  main.tabIndex = -1
  main.id = 'main'
  if (
    guide.context?.completed &&
    guide.context.lastSetup &&
    !guide.saved &&
    (guide.step === 0 || (guide.step === 3 && guide.issue))
  ) {
    intro.append(
      action(L('View last saved setup', '查看上次已保存的设置'), resumeLastSetup, 'text-action', 'forward')
    )
  }
  if (isGuidePreview()) intro.append(badge(L('Preview workspace', '预览工作区'), 'preview'))
  app.replaceChildren(skip, add(el('div', 'guide-shell'), guideHeader(), main))
  if (guide.issue?.field) {
    const e = document.getElementById('guide-' + guide.issue.field)
    e?.setAttribute('aria-invalid', 'true')
    e?.setAttribute('aria-errormessage', 'guide-issue')
  }
}

const providerDefaults = {
  openai: { label: 'OpenAI', endpoint: 'https://api.openai.com/v1', protocol: 'openai-responses' },
  anthropic: { label: 'Anthropic', endpoint: 'https://api.anthropic.com/v1', protocol: 'anthropic' }
}
const guideApiFormats = {
  'openai-responses': 'OpenAI Responses',
  'openai-chat': 'OpenAI Chat Completions',
  anthropic: 'Anthropic Messages'
}
function guideConnectionLabel(connection) {
  if (connection?.label?.trim()) return connection.label.trim()
  if (connection?.model?.trim()) return connection.model.trim()
  if (connection?.kind === 'codex') return 'Codex'
  return guideApiFormats[connection?.kind] || L('AI service', 'AI 服务')
}
function guideServiceSummary() {
  if (guide.plan?.connection) return guideConnectionLabel(guide.plan.connection)
  if (guide.mode === 'existing')
    return guideConnectionLabel(guide.context?.connections?.find((c) => c.id === guide.existingId))
  if (guide.mode === 'codex') return L('Codex sign-in', 'Codex 登录')
  return selectedService().label + ' · ' + guide.model.trim()
}
function selectedService() {
  const preset = providerDefaults[guide.provider]
  return {
    label: preset?.label ?? L('Custom API service', '自定义 API 服务'),
    endpoint: preset?.endpoint ?? guide.endpoint.trim(),
    protocol: preset?.protocol ?? guide.protocol
  }
}
function apiServiceFields() {
  const fields = [
    guideSelect('provider', L('Who provides the service?', '你的服务由谁提供？'), [
      ['openai', 'OpenAI'],
      ['anthropic', 'Anthropic'],
      ['custom', L('Another provider or team service', '其他服务商或团队服务')]
    ])
  ]
  if (guide.provider === 'custom') {
    fields.push(
      guideText(
        'endpoint',
        L('Service address', '服务地址'),
        L(
          'Copy the base URL from your provider’s connection settings.',
          '从服务商的连接设置中复制基础地址（Base URL）。'
        ),
        { type: 'url', placeholder: 'https://api.example.com/v1' }
      )
    )
    fields.push(
      detail(
        L('Connection format', '连接格式'),
        add(
          el('div', 'guide-help'),
          guideSelect('protocol', L('API format', 'API 格式'), Object.entries(guideApiFormats)),
          el('p', 'hint', L('Match the format listed by your provider.', '请选择与服务商文档一致的格式。'))
        )
      )
    )
  }
  fields.push(
    guideText(
      'model',
      L('Model name', '模型名称'),
      L(
        'Copy the exact model ID from the provider’s model list or your team’s instructions.',
        '从服务商的模型列表或团队提供的说明中复制完整模型 ID。'
      ),
      { placeholder: L('Model ID from your provider', '服务商提供的模型 ID') }
    )
  )
  fields.push(
    guideText(
      'credential',
      L('API key', 'API 密钥'),
      isGuidePreview()
        ? L(
            'Leave this empty in the preview. No live service will be contacted.',
            '预览时可留空。不会联系实际服务。'
          )
        : L(
            'Create or copy a key from your provider’s API keys page. AgentHub saves it privately on its computer when you apply the setup.',
            '在服务商的 API 密钥页面创建或复制密钥。应用设置时，AgentHub 会在自己的电脑上私密保存。'
          ),
      { type: 'password' }
    )
  )
  return fields
}
function validateService() {
  if (guide.provider === 'custom') {
    let ok = false
    try {
      const u = new URL(guide.endpoint.trim())
      ok =
        !u.username &&
        !u.password &&
        !u.search &&
        !u.hash &&
        (u.protocol === 'https:' ||
          (u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)))
    } catch {}
    if (!ok) {
      guideProblem(
        'Enter an HTTPS base URL, or a local HTTP address, without a key or query string.',
        '请输入 HTTPS 基础地址或本机 HTTP 地址，地址中不要包含密钥或查询参数。',
        'endpoint'
      )
      return false
    }
  }
  if (!guide.model.trim()) {
    guideProblem('Enter the model ID from the service you chose.', '请输入所选服务提供的模型 ID。', 'model')
    return false
  }
  return true
}
function isGuidePreview() {
  return (
    S.snap?.preview === true ||
    S.connectInfo?.preview === true ||
    guide.context?.preview === true ||
    S.health?.preview === true
  )
}
function chosenChannel() {
  return {
    local: L('This page', '这个页面'),
    feishu: L('This page first · Feishu later', '先在此页面试用 · 稍后接飞书'),
    wecom: L('This page first · WeCom later', '先在此页面试用 · 稍后接企业微信')
  }[guide.channel]
}
function reviewLine(label, value, index) {
  const change = action(L('Change', '修改'), () => guideStep(index), 'text-action')
  change.setAttribute('aria-label', L('Change ', '修改') + label)
  return add(
    el('div', 'guide-review-line'),
    add(el('div'), el('dt', '', label), el('dd', '', value)),
    change
  )
}
function reviewFields() {
  if (guide.saved) return S.authed ? savedGuideFields() : [accessPanel()]
  const summary = add(
    el('dl', 'guide-summary'),
    reviewLine(L('AI service', 'AI 服务'), guideServiceSummary(), 0),
    reviewLine(L('Task inbox', '任务入口'), chosenChannel(), 1),
    reviewLine(
      L('Work folder', '工作文件夹'),
      guide.plan?.workspace ||
        (guide.folderMode === 'custom'
          ? guide.folder
          : suggestedFolder() || L('Suggested dedicated folder', '建议的专用文件夹')),
      2
    )
  )
  return [
    summary,
    guide.mode === 'api'
      ? el(
          'p',
          'hint',
          L('Connection check destination · ', '连接检查目标 · ') + selectedService().endpoint
        )
      : null,
    ...guideActions()
  ].filter(Boolean)
}
