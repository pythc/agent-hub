function entryLink(label, url, className = 'text-action') {
  try {
    const parsed = new URL(url, location.origin)
    if (
      !['http:', 'https:', 'vscode:', 'cursor:', 'lark:', 'feishu:', 'wxwork:'].includes(
        parsed.protocol
      )
    )
      return null
    const link = el('a', className, label)
    link.href = parsed.href
    link.target = '_blank'
    link.rel = 'noopener noreferrer'
    return link
  } catch {
    return null
  }
}
function entryCopy(text, label = L('Copy', '复制')) {
  const button = action(
    label,
    async () => {
      try {
        await navigator.clipboard.writeText(text)
        button.textContent = L('Copied', '已复制')
        announce(L('Copied to clipboard.', '已复制到剪贴板。'))
      } catch {
        const selectable = button.parentElement.querySelector('pre, code, input')
        if (selectable?.select) selectable.select()
        else if (selectable) {
          const range = document.createRange()
          range.selectNodeContents(selectable)
          window.getSelection().removeAllRanges()
          window.getSelection().addRange(range)
        }
        announce(L('Select and copy the text below.', '请选中下方文本进行复制。'))
      }
    },
    'btn'
  )
  return button
}
function entrySnippet(text, label, copyLabel) {
  const block = el('div', 'entry-snippet')
  return add(
    block,
    add(el('div', 'entry-snippet-head'), el('strong', '', label), entryCopy(text, copyLabel)),
    raw(text)
  )
}
function entryStateLabel(state) {
  const names = {
    'not-configured': ['Not set up', '尚未接入'],
    configured: ['Set up · verify a request', '已配置 · 待验证'],
    attention: ['Needs attention', '需要处理'],
    verified: ['Reply verified', '已验证回复'],
    ready: ['Available · verify a request', '可用 · 待验证'],
    error: ['Needs attention', '需要处理']
  }
  return L(...(names[state] || ['Status unavailable', '状态待确认']))
}
function entryStatusBadge(entry) {
  return badge(
    entryStateLabel(entry.status),
    ['attention', 'error'].includes(entry.status)
      ? 'issue'
      : entry.status === 'verified'
        ? 'success'
        : ''
  )
}
function entryHeading(title, description, trailing) {
  const heading = el('h1', '', title)
  heading.id = 'page-title'
  heading.tabIndex = -1
  return add(
    el('div', 'entry-heading'),
    add(el('div'), heading),
    trailing
  )
}
function entrySection(title, description, ...content) {
  return add(
    el('section', 'entry-section'),
    add(
      el('div', 'entry-section-heading'),
      el('h2', '', title),
      description ? el('p', 'hint', description) : null
    ),
    ...content
  )
}
function entryRoleHome() {
  const use = action('', () => chooseEntryRole('user'), 'entry-role-row')
  use.replaceChildren(
    icon('prompts'),
    add(
      el('span'),
      el('strong', '', L('Use an existing assistant', '我要使用已有助手')),
      el(
        'small',
        '',
        L(
          'Find your team’s assistant and send it work from the software you use.',
          '找到团队已开通的助手，在你常用的软件中交代任务。'
        )
      )
    ),
    icon('forward')
  )
  const manage = action('', () => chooseEntryRole('operator'), 'entry-role-row')
  manage.replaceChildren(
    icon('sources'),
    add(
      el('span'),
      el('strong', '', L('Deploy or manage an assistant', '我要部署或管理助手')),
      el(
        'small',
        '',
        L(
          'Connect work channels, manage access and follow items that need a person.',
          '接入工作软件，管理使用权限，处理需要人工参与的事项。'
        )
      )
    ),
    icon('forward')
  )
  return [
    entryHeading(
      L('Your assistant, where you work.', '在你工作的地方，使用助手。'),
      L(
        'AgentHub takes work from your existing tools and brings results back to the same conversation.',
        'AgentHub 从现有工具接收任务，将结果带回原会话。'
      )
    ),
    add(el('div', 'entry-role-list'), use, manage)
  ]
}
function entryUserHome() {
  const guideData = entryState.sharedGuide
  const result = [
    entryHeading(
      L('Use your assistant', '使用你的助手'),
      L(
        'Choose an entry your administrator has shared, then continue in that software.',
        '选择管理员分享的入口，然后回到对应软件中使用。'
      )
    )
  ]
  if (!guideData) {
    const input = el('input')
    input.id = 'entry-invite'
    input.value = entryState.invite
    input.autocomplete = 'off'
    input.placeholder = L('Paste your invitation link', '粘贴管理员发来的邀请链接')
    const label = el('label', '', L('Invitation from your administrator', '管理员提供的邀请'))
    label.htmlFor = input.id
    input.oninput = () => {
      entryState.invite = input.value
    }
    const form = el('form', 'entry-invite-form')
    const open = action(L('Show my connections', '查看可用入口'), null, 'btn primary')
    open.type = 'submit'
    input.required = true
    if (entryState.error?.code === 'invite_invalid') {
      input.setAttribute('aria-invalid', 'true')
      input.setAttribute('aria-describedby', 'entry-error')
    }
    form.onsubmit = (event) => {
      event.preventDefault()
      const value = input.value.trim()
      try {
        const url = new URL(value)
        entryState.invite = new URLSearchParams(url.hash.slice(1)).get('invite') || value
      } catch {
        entryState.invite = value
      }
      void acceptEntryInvite()
    }
    result.push(
      entrySection(
        L('Start in your usual software', '从常用的软件开始'),
        L(
          'Use the instructions your administrator shared in your team chat. Find the named bot or connected client and give it your request there.',
          '按管理员在团队会话中分享的说明，找到指定机器人或已连接的客户端，直接在那里交代任务。'
        ),
        detail(
          L('Open a local usage guide', '打开本地使用指引'),
          add(
            el('div', 'entry-form'),
            el(
              'p',
              'hint',
              L(
                'If your administrator also gave you a local guide link, open it on the same computer or through your existing tunnel.',
                '如果管理员还提供了本地指引链接，可在同一电脑或通过已有隧道打开。'
              )
            ),
            add(form, label, add(el('div', 'entry-invite-controls'), input, open))
          )
        )
      )
    )
    if (entryState.invite) result.at(-1).querySelector('details').open = true
    const entries = entryState.publicGuide?.entries || []
    if (entries.length)
      result.push(
        entrySection(
          L('Where AgentHub can be used', '可以在哪里使用'),
          L(
            'Your administrator chooses which of these are available to your team.',
            '由管理员决定为团队开通哪些入口。'
          ),
          el('p', 'entry-platform-names', entries.map(entryName).join(' · '))
        )
      )
    return result
  }
  if (!guideData.entries.length)
    result.push(
      entrySection(
        L('No entries in this invitation', '此邀请尚未包含入口'),
        L('Ask your administrator to share an enabled connection.', '请管理员分享已开通的入口。')
      )
    )
  for (const entry of guideData.entries) {
    const instruction = entryText(entry.howToUse)
    result.push(
      entrySection(
        entryName(entry),
        null,
        entry.location ? el('p', 'entry-location', entryText(entry.location)) : null,
        el(
          'p',
          'entry-instructions',
          instruction ||
            L('Ask your administrator where to find this assistant.', '请向管理员确认助手的位置。')
        ),
        entry.openUrl
          ? entryLink(L('Open ', '打开 ') + entryName(entry), entry.openUrl, 'btn primary')
          : null,
        entry.status ? entryStatusBadge(entry) : null
      )
    )
  }
  return result
}
function entryHostNote() {
  return add(
    el('div', 'entry-host-note'),
    icon('overview'),
    add(
      el('div'),
      el('strong', '', L('Management host', '管理宿主') + ' · ' + location.host),
      el(
        'p',
        'hint',
        L(
          'Changes apply on the computer running AgentHub. A tunnel may connect this page to a remote host.',
          '设置作用于运行 AgentHub 的电脑。通过隧道访问时，它可能是一台远程电脑。'
        )
      )
    )
  )
}
function entryOperatorAccess() {
  return [
    entryHeading(
      L('Manage your assistant', '管理你的助手'),
      L(
        'Open the management link from the computer running AgentHub to continue.',
        '使用运行 AgentHub 的电脑提供的管理链接继续。'
      )
    ),
    entryHostNote(),
    entrySection(
      L('Connect to this deployment', '连接到这个部署'),
      L(
        'The startup message includes a temporary management link. It signs you in on this browser.',
        '启动信息中提供临时管理链接，打开后会在当前浏览器建立管理会话。'
      ),
      el(
        'p',
        '',
        L(
          'First deployment: run ./start.sh setup from the AgentHub folder, then open the link shown in the terminal. Existing deployments are reused.',
          '首次部署：在 AgentHub 文件夹运行 ./start.sh setup，再打开终端提供的链接。已有部署会继续复用。'
        )
      ),
      el(
        'p',
        'hint',
        L(
          'For a remote host, open its management link through your existing secure connection.',
          '远程部署请通过现有安全连接打开其管理链接。'
        )
      ),
      detail(L('Use a connection file or token', '使用连接文件或令牌'), accessPanel())
    )
  ]
}
function entryAttention() {
  const items = entryState.data.attention
  const section = entrySection(
    L('Needs your attention', '需要我处理'),
    L(
      'Follow up on requests that need a person before work can continue.',
      '查看需要人工参与后才能继续的事项。'
    )
  )
  if (!Array.isArray(items)) {
    section.append(
      el(
        'p',
        'alert warning',
        L(
          'Attention items could not be read. Refresh to try again.',
          '待处理事项未能读取，请刷新重试。'
        )
      )
    )
    return section
  }
  const active = items.filter((item) => item.count > 0 || item.question)
  if (!active.length)
    section.append(
      add(
        el('p', 'entry-empty inline'),
        icon('check'),
        el('span', '', L('No items need your attention right now.', '目前没有需要你处理的事项。'))
      )
    )
  for (const item of active) {
    const types = {
      work: L('Work needing your input', '需要你补充的任务'),
      person: L('Requests needing your input', '需要你补充的任务'),
      approval: L('Waiting for approval', '等待批准'),
      blocked: L('Blocked tasks', '受阻任务'),
      delivery: L('Delivery needs attention', '交付需要处理')
    }
    const row = add(
      el('div', 'entry-attention-row'),
      add(
        el('div'),
        el('strong', '', types[item.kind] || entryText(item.label)),
        item.question || (item.kind === 'work' && item.label)
          ? el('p', '', entryText(item.question || item.label))
          : null
      ),
      item.count != null ? badge(String(item.count)) : null
    )
    const link = entryLink(L('Review', '查看'), item.openUrl || '/', 'btn')
    if (link) row.append(link)
    section.append(row)
  }
  return section
}
function entryOverview() {
  const entries = entryState.data.entries
  const configured = entries.filter((entry) => entry.status !== 'not-configured')
  const content = [
    entryHeading(
      L('Your assistant at work', '助手工作台'),
      L(
        'Keep connections available and act on requests that need you.',
        '查看入口是否可用，处理需要你参与的请求。'
      ),
      action(L('Refresh', '刷新'), refreshEntries, 'text-action', 'refresh')
    ),
    entryHostNote(),
    entryAttention()
  ]
  const section = entrySection(L('Connected software', '已接入的软件'), null)
  const heading = section.querySelector('.entry-section-heading')
  heading.append(
    action(
      L('Add a connection', '添加入口'),
      () => entryNavigate('catalog'),
      'btn primary',
      'sources'
    )
  )
  if (!configured.length)
    section.append(
      el(
        'p',
        'entry-empty',
        L(
          'Choose where people will give the assistant work. Existing AI connections will be reused.',
          '选择大家从哪里向助手交代任务，已有 AI 连接会自动复用。'
        )
      )
    )
  for (const entry of configured) section.append(entryRow(entry))
  content.push(section)
  if (configured.length)
    content.push(
      entrySection(
        L('Share with your team', '分享给使用者'),
        L(
          'Copy the usage instructions into your team chat so people can find the assistant in the software they already use.',
          '把使用说明发到团队会话，让大家在现有软件里找到助手。'
        ),
        action(
          L('Prepare usage instructions', '生成使用说明'),
          () => shareEntries(configured.map((entry) => entry.id)),
          'btn'
        ),
        entryState.share ? entryShareResult() : null
      )
    )
  content.push(
    detail(
      L('Diagnostics & advanced settings', '诊断与高级设置'),
      add(
        el('div', 'entry-secondary-actions'),
        action(L('Full settings', '完整设置'), () => switchSurface('advanced'), 'btn', 'advanced'),
        action(L('Browser diagnostics', '浏览器调试'), () => switchSurface('guide'), 'text-action')
      )
    )
  )
  return content
}
function entryShareResult() {
  const share = entryState.share,
    text = entryText(share.text)
  return add(
    el('div'),
    text
      ? entrySnippet(
          text,
          L('Instructions for your team', '给使用者的说明'),
          L('Copy usage instructions', '复制使用说明')
        )
      : el(
          'p',
          'hint',
          L(
            'The host did not return usage instructions. Refresh and try again.',
            '宿主尚未返回使用说明，请刷新后重试。'
          )
        ),
    detail(
      L('Preview the guide on this computer', '在当前电脑预览指引'),
      add(
        el('div', 'entry-form'),
        el(
          'p',
          'hint',
          L(
            'This local link opens only on this computer or through an existing secure tunnel.',
            '此本地链接仅能在当前电脑或通过已有安全隧道打开。'
          )
        ),
        entryLink(L('Open local guide', '打开本地指引'), share.url, 'btn')
      )
    )
  )
}
function entryRow(entry) {
  const button = action('', () => entryNavigate('detail', entry.id), 'entry-list-row')
  button.replaceChildren(
    add(
      el('span'),
      el('strong', '', entryName(entry)),
      el('small', '', entryDescription(entry.id))
    ),
    entryStatusBadge(entry),
    icon('forward')
  )
  return button
}
function entryDescription(id) {
  const copy = {
    feishu: [
      'Receive work in Feishu chats and reply in the same conversation.',
      '在飞书会话接收任务，回复原会话。'
    ],
    wecom: [
      'Connect an API-mode smart bot for chats and direct messages.',
      '通过 API 模式智能机器人接入群聊和私聊。'
    ],
    codex: ['Give AgentHub work from your Codex client.', '从 Codex 客户端把任务交给 AgentHub。'],
    cursor: ['Use AgentHub from Cursor’s agent.', '从 Cursor 的 Agent 使用 AgentHub。'],
    vscode: [
      'Make AgentHub available to your editor assistant.',
      '在编辑器的助手中使用 AgentHub。'
    ],
    workbuddy: [
      'Connect your WorkBuddy assistant through MCP.',
      '通过 MCP 连接你的 WorkBuddy 助手。'
    ],
    github: [
      'Follow repository conversations and return results to GitHub.',
      '跟进仓库会话，将结果带回 GitHub。'
    ],
    generic: ['Connect another compatible MCP client.', '连接其他支持 MCP 的客户端。']
  }
  return L(...(copy[id] || ['Connect this software to AgentHub.', '将此软件接入 AgentHub。']))
}
function entryCatalogue() {
  const result = [
    entryHeading(
      L('Where will you use AgentHub?', '从哪里使用 AgentHub？'),
      L(
        'Connect one entry at a time. Add more whenever your team needs them.',
        '一次接入一个入口，可以按团队需要继续添加。'
      )
    )
  ]
  const entries = entryState.data.entries
  const groups = [
    ['office', L('Team conversations', '团队会话')],
    ['client', L('Coding tools & assistants', '开发工具与助手')],
    ['source', L('Repositories & other sources', '仓库与其他来源')]
  ]
  for (const [category, title] of groups) {
    const members = entries.filter((entry) => entry.category === category)
    const primary = members.filter((entry) =>
      ['feishu', 'wecom', 'codex', 'cursor', 'vscode', 'workbuddy', 'github', 'generic'].includes(
        entry.id
      )
    )
    const extra = members.filter((entry) => !primary.includes(entry))
    if (members.length)
      result.push(
        entrySection(
          title,
          null,
          ...primary.map(entryRow),
          extra.length
            ? detail(L('More clients', '更多客户端'), add(el('div'), ...extra.map(entryRow)))
            : null
        )
      )
  }
  return result
}
function renderEntrySurface() {
  if(typeof configurationHost !== 'undefined' && configurationHost && !(entryState.role === 'operator' && (entryState.operator || S.authed))) {
    const main=el('div','workspace-bootstrap')
    const status=el('p',entryState.error?'workspace-load-error':'workspace-loading',entryState.error?L('Couldn’t load this page.','页面加载失败。'):L('Loading…','加载中…'))
    status.setAttribute('role',entryState.error?'alert':'status');main.append(status)
    if(entryState.error)main.append(action(L('Retry','重试'),startEntrySession,'button'))
    app.replaceChildren(main);return
  }
  if (!entryState.sessionChecked) {
    document.documentElement.lang = lang
    document.title = 'Roppo'
    const main = el('main', 'workspace-bootstrap')
    main.id = 'main'
    main.append(add(el('div', 'brand'), el('span', 'roppo-brand-mark'), el('strong', '', 'Roppo')))
    if (entryState.error) {
      const message = el('p', 'workspace-load-error', L('Couldn’t load the workspace.', '工作区加载失败。'))
      message.setAttribute('role', 'alert')
      main.append(message, action(L('Retry', '重试'), startEntrySession, 'button'))
    } else {
      const status = el('p', 'workspace-loading', L('Loading…', '加载中…'))
      status.setAttribute('role', 'status');main.append(status)
    }
    app.replaceChildren(main)
    return
  }
  if (entryState.role === 'operator' && (entryState.operator || S.authed)) {
    renderOperatorWorkspace()
    return
  }
  document.documentElement.lang = lang
  document.title = L('Connections & attention', '入口与待处理') + ' · AgentHub'
  const skip = el('a', 'skip', L('Skip to content', '跳至主要内容'))
  skip.href = '#main'
  const logo = action(
    '',
    () => {
      if (entryState.busy || S.busy) return
      entryState.role = ''
      entryNavigate('home')
    },
    'entry-brand'
  )
  logo.replaceChildren(add(el('span', 'brand-mark'), icon('brand')), el('strong', '', 'AgentHub'))
  const header = add(
    el('header', 'entry-header'),
    logo,
    add(
      el('div', 'tools'),
      themeToggle(),
      languagePicker(),
      entryState.role
        ? action(
            entryState.role === 'operator'
              ? L('Use an assistant', '使用助手')
              : L('Manage', '部署与管理'),
            () => chooseEntryRole(entryState.role === 'operator' ? 'user' : 'operator'),
            'text-action'
          )
        : null
    )
  )
  const main = el('main', 'entry-main')
  main.id = 'main'
  main.tabIndex = -1
  if (entryState.role === 'operator' && S.authed) {
    const nav = el('nav', 'entry-nav')
    nav.setAttribute('aria-label', L('Management navigation', '管理导航'))
    for (const [page, label] of [
      ['home', L('Overview', '工作概览')],
      ['catalog', L('Connections', '入口配置')]
    ]) {
      const button = action(label, () => entryNavigate(page), 'text-action')
      if (entryState.page === page) button.setAttribute('aria-current', 'page')
      nav.append(button)
    }
    main.append(nav)
  }
  if (entryState.data?.preview || entryState.publicGuide?.preview)
    main.append(badge(L('Preview workspace', '预览工作区'), 'preview'))
  if (entryState.error) {
    const error = add(
      el('div', 'alert error'),
      el('p', '', L(...entryState.error.text)),
      entryState.error.detail
        ? detail(L('Details', '详情'), raw(cleanDetail(entryState.error.detail)))
        : null
    )
    error.append(
      action(
        L('Refresh status', '刷新状态'),
        () => (entryState.role === 'operator' && S.authed ? refreshEntries() : startEntrySession()),
        'text-action',
        'refresh'
      )
    )
    error.id = 'entry-error'
    error.tabIndex = -1
    error.setAttribute('role', 'alert')
    main.append(error)
  }
  if (S.notice || S.busy) main.append(noticeView())
  if (entryState.loading) {
    const waiting = el('p', 'entry-loading', L('Reading this deployment…', '正在读取此部署…'))
    waiting.setAttribute('role', 'status')
    main.append(waiting)
  }
  const body = el('fieldset', 'entry-body')
  body.disabled = !!entryState.busy || !!S.busy
  if (!entryState.role) body.append(...entryRoleHome())
  else if (entryState.role === 'user') body.append(...entryUserHome())
  else if (!S.authed) body.append(...entryOperatorAccess())
  else if (!entryState.data)
    body.append(
      entryHeading(
        L('Connect to your deployment', '连接你的部署'),
        L('Read its existing connections and current work.', '读取已有入口与当前工作状态。')
      ),
      action(L('Read deployment', '读取部署'), refreshEntries, 'btn primary')
    )
  else if (entryState.page === 'catalog') body.append(...entryCatalogue())
  else if (entryState.page === 'detail') body.append(...entryDetail())
  else body.append(...entryOverview())
  main.append(body)
  if (entryState.busy) {
    const status = el('p', 'entry-progress', L('Working on this connection…', '正在处理此入口…'))
    status.setAttribute('role', 'status')
    main.append(status)
  }
  app.replaceChildren(skip, add(el('div', 'entry-shell'), header, main))
}
