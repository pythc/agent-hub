const entryCheckCopy = {
  preview_not_connected: [
    'Live checks are unavailable in this preview.',
    '此预览无法执行实际连接检查。'
  ],
  client_configured: ['AgentHub is configured in this client.', '此客户端已配置 AgentHub。'],
  client_conflict: [
    'This client has a different AgentHub connection. Review it before proceeding.',
    '此客户端存在不同的 AgentHub 连接，请先核对现有设置。'
  ],
  client_install_required: [
    'Add the AgentHub connection to this client.',
    '为此客户端添加 AgentHub 连接。'
  ],
  client_not_detected: [
    'No client settings were found on the host. Confirm the client is installed here.',
    '宿主上未找到客户端设置，请确认客户端已安装在这台电脑上。'
  ],
  codex_unavailable: [
    'Codex could not be found or read on the host. Install or sign in there, then check again.',
    '宿主上未能找到或读取 Codex，请在宿主安装并登录后重新检查。'
  ],
  configuration_needs_review: [
    'The client settings need review before an automatic install.',
    '客户端现有配置需要核对，暂时无法自动安装。'
  ],
  choose_official_config: [
    'Use this client’s official setup instructions.',
    '请使用此客户端的官方配置说明。'
  ],
  manual_client: ['Add the configuration in your MCP client.', '请在 MCP 客户端中添加配置。'],
  send_request_in_client: [
    'Send a verification request from the client to confirm the complete path.',
    '请从客户端发送验证请求，确认整条链路可用。'
  ],
  feishu_bot_signed_in: ['A signed-in Feishu bot is available.', '已发现登录的飞书机器人。'],
  choose_visible_chat: ['Choose a chat the bot can access.', '选择机器人可访问的群聊。'],
  add_bot_to_chat: [
    'Add the bot to a chat, then check again.',
    '请先将机器人加入群聊，再重新检查。'
  ],
  feishu_bot_setup_required: [
    'Sign in a Feishu bot on the host, then check again.',
    '请先在宿主配置飞书机器人登录，再重新检查。'
  ],
  wecom_create_smart_bot: [
    'A WeCom administrator must create an API-mode smart bot with a long connection.',
    '需要企业微信管理员创建 API 模式、使用长连接的智能机器人。'
  ],
  wecom_authenticated: ['The WeCom bot authenticated successfully.', '企业微信机器人已通过认证。'],
  wecom_connection_pending: [
    'Waiting for the WeCom bot to connect.',
    '正在等待企业微信机器人建立连接。'
  ],
  wecom_credentials_required: [
    'Provide the Bot ID and Secret from your WeCom administrator.',
    '请填写企业微信管理员提供的 Bot ID 与 Secret。'
  ],
  github_signed_in: ['GitHub is signed in on the host.', '宿主已登录 GitHub。'],
  github_sign_in_required: [
    'Sign in to GitHub on the host, then check again.',
    '请在宿主登录 GitHub 后重新检查。'
  ],
  allow_observed_sender: [
    'Send a message from the target software, then allow the observed sender.',
    '先从目标软件发送一条消息，再允许已识别的发送者。'
  ]
}
function entryChecks(checks) {
  const list = el('ul', 'entry-check-list')
  for (const check of checks || []) {
    const copy = entryCheckCopy[check.code]
    const state =
      check.status === 'ok'
        ? L('Passed', '通过')
        : check.status === 'required'
          ? L('Action needed', '待处理')
          : L('Pending', '待验证')
    list.append(
      add(
        el('li'),
        badge(state, check.status === 'required' ? 'issue' : ''),
        el(
          'span',
          '',
          copy
            ? L(...copy)
            : entryText(check.label) || L('Review this prerequisite.', '请核对此项前提。')
        ),
        !copy && check.code ? detail(L('Details', '详情'), raw(check.code)) : null
      )
    )
  }
  return list
}
function entryInput(key, label, hint, type = 'text', required = false) {
  const control = el('input')
  control.type = type
  control.id = 'entry-' + key
  control.value = entryState.draft[key] || ''
  control.autocomplete = 'off'
  control.required = required
  control.spellcheck = false
  control.oninput = () => entryEdit(key, control.value)
  const text = el('label', '', label)
  text.htmlFor = control.id
  const help = el('small', 'hint', hint)
  help.id = control.id + '-help'
  control.setAttribute('aria-describedby', help.id)
  return add(el('div', 'entry-field'), text, control, help)
}
function entrySourcePicker(entry) {
  const sources = entry.sources || []
  if (!sources.length) return null
  const select = el('select')
  select.id = 'entry-source'
  select.setAttribute('aria-label', L('Connected conversation', '已接入的会话'))
  for (const source of sources) {
    const scope = (source.scopes || [])
      .map((scope) => {
        if (typeof scope !== 'string') return scope.label
        return (
          entryState.probe?.choices?.find((choice) => choice.id === scope)?.label ||
          (entry.id === 'github' ? scope : '')
        )
      })
      .join(' · ')
    select.add(
      new Option(scope || entryName(entry) + ' · ' + (sources.indexOf(source) + 1), source.id)
    )
  }
  if (!sources.some((s) => s.id === entryState.source))
    entryState.source = sources.find((s) => s.enabled)?.id || sources[0].id
  select.value = entryState.source
  select.onchange = () => {
    entryState.source = select.value
    entryState.verification = null
    clearTimeout(entryState.timer)
    render()
  }
  const label = el('label', '', L('Use this connection', '使用此连接'))
  label.htmlFor = select.id
  return add(el('div', 'entry-field'), label, select)
}
function entryOfficeForm(entry) {
  const form = el('form', 'entry-form')
  if (entry.id === 'feishu') {
    const choices = entryState.probe?.choices || []
    if (!choices.length)
      return el(
        'p',
        'hint',
        L(
          'Run the connection check to find the bot’s available chats.',
          '先检查连接，以读取机器人可访问的群聊。'
        )
      )
    const fields = el('fieldset', 'entry-choices')
    fields.append(el('legend', '', L('Choose chats', '选择群聊')))
    for (const choice of choices) {
      const checkbox = el('input')
      checkbox.type = 'checkbox'
      checkbox.value = choice.id
      checkbox.checked = entryState.draft.scopes?.includes(choice.id) || false
      checkbox.onchange = () => {
        const values = new Set(entryState.draft.scopes || [])
        if (checkbox.checked) values.add(choice.id)
        else values.delete(choice.id)
        entryEdit('scopes', [...values])
      }
      fields.append(add(el('label'), checkbox, el('span', '', choice.label)))
    }
    form.append(fields)
  }
  if (entry.id === 'wecom')
    form.append(
      el(
        'p',
        'alert warning',
        L(
          'If you cannot create a smart bot in your company, ask a WeCom administrator to open this entry. Setup remains incomplete until that step is done.',
          '如果你在企业中没有创建智能机器人的权限，请联系企业微信管理员开通。完成这一步后才能继续接入。'
        )
      ),
      entryInput(
        'botId',
        'Bot ID',
        L('From the smart bot’s API settings.', '从智能机器人的 API 设置中获取。'),
        'text',
        true
      ),
      entryInput(
        'secret',
        'Secret',
        L(
          'Provided by the bot administrator; sent only to this AgentHub host.',
          '由机器人管理员提供，仅提交给当前 AgentHub 宿主。'
        ),
        'password',
        true
      )
    )
  if (entry.id === 'github')
    form.append(
      entryInput(
        'repository',
        L('Repository', '仓库'),
        L(
          'Repository owner/name, for example your-team/project. The host uses its existing GitHub sign-in.',
          '填写“所有者/仓库名”，例如 your-team/project。宿主复用已有 GitHub 登录。'
        ),
        'text',
        true
      )
    )
  form.append(
    detail(
      L('Work folder & access', '工作文件夹与访问'),
      add(
        el('div', 'entry-form'),
        el(
          'p',
          'hint',
          L(
            'A dedicated read-only work folder is prepared by default. Send a verification message to identify and approve the person who will use this entry.',
            '默认准备专用只读工作文件夹。通过验证消息识别并允许实际使用这个入口的人。'
          )
        ),
        entryInput(
          'workspace',
          L('Custom host folder (optional)', '自定义宿主文件夹（可选）'),
          L(
            'An absolute path on the computer running AgentHub.',
            '运行 AgentHub 的电脑上的绝对路径。'
          )
        )
      )
    )
  )
  const submit = action(L('Review connection', '检查并核对接入'), null, 'btn primary')
  submit.type = 'submit'
  form.append(add(el('div', 'actions'), submit))
  form.onsubmit = (event) => {
    event.preventDefault()
    if (entry.id === 'feishu' && !entryState.draft.scopes?.length) {
      entryState.error = {
        text: ['Select at least one chat.', '请至少选择一个群聊。']
      }
      render()
      document.getElementById('entry-error')?.focus()
      return
    }
    void planEntry()
  }
  return form
}
function entryPlanReview() {
  const plan = entryState.plan
  if (!plan) return null
  const names = {
    add_entry: ['Add the selected connection', '添加所选入口'],
    reuse_current_backend: ['Reuse the current AI service', '复用当前 AI 服务'],
    read_only_workspace: ['Use a read-only work folder', '使用只读工作文件夹'],
    explicit_sender_access: ['Require approval for new senders', '新发送者需要明确授权']
  }
  const list = el('ul', 'entry-change-list')
  for (const change of plan.changes || [])
    list.append(
      el(
        'li',
        '',
        L(
          ...(names[change.code] || [
            'Review the host’s proposed change.',
            '核对宿主提出的配置变更。'
          ])
        )
      )
    )
  const block = entrySection(
    L('Review before applying', '应用前核对'),
    L(
      'AgentHub will save this connection and reload the host. Verify its use in the selected software afterward.',
      'AgentHub 将保存入口并重新加载宿主，随后在所选软件中验证使用。'
    ),
    list
  )
  if (plan.workspace)
    block.append(detail(L('Work folder on the host', '宿主工作文件夹'), raw(plan.workspace)))
  block.id = 'entry-plan-review'
  block.append(
    add(
      el('div', 'actions'),
      action(L('Apply connection', '应用入口配置'), applyEntry, 'btn primary', 'check'),
      action(
        L('Edit choices', '修改选择'),
        () => {
          entryState.plan = null
          render()
        },
        'text-action'
      )
    )
  )
  return block
}
function entryClientSetup(entry) {
  const client = entry.client || {}
  const block = entrySection(
    L('Connect your client', '接入你的客户端'),
    L('Choose the computer where you use this client.', '请选择你使用该客户端的电脑。')
  )
  if (client.installed) {
    const steps = {
      workbuddy: [
        'If WorkBuddy is already open, quit and reopen it. Enable this connection in its MCP manager and accept the trust prompt.',
        '如果 WorkBuddy 已经打开，请退出并重新打开。在 MCP 管理器中启用此连接，并按提示完成信任。'
      ],
      codex: [
        'Refresh the MCP connections or restart Codex, then start a new conversation. Approve this server’s tools when Codex prompts you.',
        '刷新 MCP 连接或重启 Codex，然后开启新会话。使用此服务器的工具时，按 Codex 的原生提示批准。'
      ],
      cursor: [
        'Refresh this connection in Cursor’s MCP settings. If it is still missing, restart Cursor. Enable it and accept the trust prompt.',
        '在 Cursor 的 MCP 设置中刷新此连接。如果仍未显示，请重启 Cursor，再启用连接并按提示信任。'
      ],
      vscode: [
        'Restart this connection from VS Code’s MCP server list and accept the trust prompt. If it is not listed, reload VS Code.',
        '在 VS Code 的 MCP 服务器列表中重新启动此连接，并按提示信任。如果尚未显示，请重新加载 VS Code。'
      ]
    }
    block.append(
      el('p', '', L('The client configuration is saved on the host.', '客户端配置已保存到宿主。')),
      el(
        'p',
        '',
        L(
          ...(steps[entry.id] || [
            'If the client is open, refresh its MCP connections or restart it. Accept the trust prompt before sending a verification request.',
            '如果客户端已打开，请刷新 MCP 连接或重启客户端。按提示完成信任后，再发送验证请求。'
          ])
        )
      )
    )
  } else if (client.canInstall && !client.conflict) {
    const install = action(
      L('Install on the host computer', '安装到宿主电脑'),
      installEntry,
      'btn primary'
    )
    install.disabled = entryState.data.preview === true
    block.append(
      el(
        'p',
        '',
        L(
          'This adds AgentHub to the client settings on the computer running this service. Existing settings are backed up.',
          '此操作会将 AgentHub 添加到运行此服务的电脑上的客户端设置，并备份现有配置。'
        )
      ),
      install
    )
  } else
    block.append(
      el(
        'p',
        'hint',
        L(
          ...(entryCheckCopy[client.reason] ||
            entryCheckCopy[client.conflict ? 'client_conflict' : 'manual_client'])
        )
      )
    )
  if (client.serverName)
    block.append(
      el('p', 'hint', L('Name in the client: ', '客户端中的连接名：') + client.serverName)
    )
  if (client.configPath)
    block.append(detail(L('Host installation location', '宿主安装位置'), raw(client.configPath)))
  block.append(
    detail(
      L('Use from another computer', '在另一台电脑使用'),
      add(
        el('div', 'entry-form'),
        el(
          'p',
          '',
          L(
            'Connect to the host through an SSH tunnel, then generate the client configuration on that computer. This personal client connection requires operator access.',
            '先通过 SSH 隧道连接宿主，再在该电脑生成客户端配置。这种个人客户端连接需要操作员权限。'
          )
        ),
        entryLink(L('Client setup instructions', '客户端配置说明'), entry.docs)
      )
    ),
    action(L('Show manual configuration', '查看手动配置'), loadEntryConfig, 'text-action')
  )
  if (entryState.clientConfig) {
    const config = entryState.clientConfig
    block.append(
      el('p', 'hint', entryText(config.remoteHelp)),
      entrySnippet(
        config.text || pretty(config),
        L('Configuration for the host computer', '用于宿主电脑的配置')
      )
    )
  }
  return block
}
function entryUsage(entry) {
  const usage = entryState.applied?.usage || entry.usage
  if (!usage) return null
  return entrySection(
    L('Continue in ', '回到 ') + entryName(entry),
    null,
    usage.location ? el('p', 'entry-location', entryText(usage.location)) : null,
    el('p', 'entry-instructions', entryText(usage.howToUse)),
    usage.openUrl ? entryLink(L('Open ', '打开 ') + entryName(entry), usage.openUrl, 'btn') : null
  )
}
function entryVerificationContents() {
  const verification = entryState.verification
  if (!verification) return []
  const done = verification.verified === true
  const title = el(
    'h2',
    '',
    done
      ? L('Reply verified in the selected software', '已在所选软件验证回复')
      : L('Verify in the original conversation', '在原会话验证')
  )
  const instructions = el(
    'p',
    'hint',
    L(
      'Send this request in the selected software. This page follows what the host receives and replies.',
      '请在所选软件中发送下面的请求，此页面将跟踪宿主实际接收和回复的情况。'
    )
  )
  const list = el('ol', 'entry-verification-stages')
  const labels = {
    received: ['Request received', '收到请求'],
    authorized: ['Sender allowed', '发送者已获准'],
    executed: ['Work completed', '任务已执行'],
    replied: ['Reply returned', '结果已回到原会话']
  }
  for (const stage of verification.stages || []) {
    const label = labels[stage.id] || ['Verification stage', '验证阶段']
    const line = add(
      el('li'),
      el('span', '', L(...label)),
      badge(
        stage.status === 'ok'
          ? L('Confirmed', '已确认')
          : stage.status === 'required'
            ? L('Action needed', '待处理')
            : L('Waiting', '等待中'),
        stage.status === 'required' ? 'issue' : ''
      )
    )
    list.append(line)
  }
  const result = [
    title,
    instructions,
    entrySnippet(
      entryText(verification.instructions || verification.instruction) || verification.code,
      L('Send in ', '发送到 ') + entryName(entryState.selected)
    ),
    list
  ]
  if (verification.expired)
    result.push(
      el(
        'p',
        'alert warning',
        L(
          'This verification has expired. Start a new verification.',
          '此次验证已过期，请重新开始验证。'
        )
      )
    )
  if (verification.observedSender) {
    const sender = verification.observedSender
    result.push(
      add(
        el('div', 'entry-authorization'),
        el(
          'p',
          '',
          L(
            'A request arrived from this person. Allow them to give work to this connection?',
            '已收到这个人的请求。确认允许其通过此入口交代任务？'
          )
        ),
        raw(sender.actor),
        action(
          L('Allow this sender', '允许此发送者'),
          () =>
            entryRun('allow', async () => {
              await api('/entry-setup/allow', {
                revision: entryState.data.revision,
                sourceId: sender.sourceId,
                actor: sender.actor
              })
              await readEntries()
              entryState.verification = await api(
                '/entry-setup/verification/' + encodeURIComponent(verification.id)
              )
            }),
          'btn'
        )
      )
    )
  }
  const refresh = action(
    L('Refresh verification', '刷新验证进度'),
    () => refreshEntryVerification(true),
    'text-action',
    'refresh'
  )
  refresh.id = 'entry-verification-refresh'
  result.push(
    add(
      el('div', 'actions'),
      refresh,
      done
        ? null
        : action(
            L('Start a new verification', '重新开始验证'),
            startEntryVerification,
            'text-action'
          )
    )
  )
  if (!entryState.polls && !done)
    result.push(
      el(
        'p',
        'hint',
        L(
          'Automatic checks paused. Refresh when you have sent the request.',
          '自动检查已暂停，发送请求后可点击刷新。'
        )
      )
    )
  return result
}
function entryDetail() {
  const entry = selectedEntry()
  if (!entry)
    return [
      entryHeading(
        L('Connection unavailable', '入口不可用'),
        L(
          'Refresh the connection list and choose an available entry.',
          '请刷新入口列表后重新选择。'
        )
      ),
      action(L('Refresh connections', '刷新入口'), refreshEntries)
    ]
  const isClient = entry.category === 'client'
  const sources = entry.sources || []
  const content = [
    action(L('All connections', '所有入口'), () => entryNavigate('catalog'), 'text-action'),
    entryHeading(entryName(entry), entryDescription(entry.id), entryStatusBadge(entry)),
    entryHostNote()
  ]
  if (entryState.data.preview)
    content.push(
      el(
        'p',
        'alert warning',
        L(
          'Preview workspace. Installation and external verification are unavailable.',
          '预览工作区。安装及外部验收不可用。'
        )
      )
    )
  content.push(
    entrySection(
      L('Check what is already available', '检查已有条件'),
      L(
        'Inspect sign-in, permissions and client settings. This check sends no task.',
        '检查已有登录、权限和客户端配置，此检查不会发送任务。'
      ),
      action(L('Check connection', '检查连接'), probeEntry, 'btn', 'refresh'),
      entryState.probe
        ? entryChecks(entryState.probe.checks)
        : el(
            'p',
            'hint',
            L(
              'Run a check to discover available settings and missing requirements.',
              '先检查已有配置和缺项。'
            )
          ),
      entryLink(L('Official setup guide', '官方接入说明'), entry.docs)
    )
  )
  if (
    entry.id === 'feishu' &&
    entryState.probe?.checks?.some((c) => c.code === 'feishu_bot_setup_required')
  ) {
    content.push(
      entrySection(
        L('Connect your Feishu bot', '连接你的飞书机器人'),
        L(
          'Use the credentials from the bot owner, or sign in with lark-cli on the host and check again.',
          '使用机器人负责人提供的凭据，或在宿主通过 lark-cli 登录后重新检查。'
        ),
        entryInput(
          'appId',
          'App ID',
          L('From the Feishu app’s credentials page.', '从飞书应用的凭据页面获取。')
        ),
        entryInput(
          'appSecret',
          'App Secret',
          L(
            'Submitted to this host to check the bot and list its available chats.',
            '提交给此宿主，用于检查机器人并读取可访问群聊。'
          ),
          'password'
        ),
        action(L('Check bot credentials', '检查机器人凭据'), probeEntry, 'btn')
      )
    )
  }
  content.push(entryModelSettings())
  if (isClient) content.push(entryClientSetup(entry))
  else {
    if (sources.length)
      content.push(
        entrySection(
          L('Existing connections', '已有连接'),
          null,
          entrySourcePicker(entry),
          el(
            'p',
            'hint',
            L(
              'Choose a connection to verify. You can add a separate connection below.',
              '选择需要验证的已有连接，也可以在下方添加独立连接。'
            )
          )
        )
      )
    if (!sources.length || entryState.creating)
      content.push(entrySection(L('Set up this entry', '设置此入口'), null, entryOfficeForm(entry)))
    else
      content.push(
        action(
          L('Add another connection', '再添加一个连接'),
          () => {
            entryState.creating = true
            entryState.source = ''
            render()
          },
          'text-action'
        )
      )
    if (entryState.plan) content.push(entryPlanReview())
  }
  if (entryState.applied)
    content.push(
      el(
        'p',
        'alert',
        L(
          'Settings saved. Send a request in the selected software to verify delivery.',
          '设置已保存。请在所选软件中发送请求验证结果回传。'
        )
      )
    )
  const usable = isClient ? entry.client?.installed : sources.some((s) => s.enabled)
  if (
    usable ||
    entry.verification ||
    entryState.verification ||
    (isClient && entryState.clientConfig)
  ) {
    content.push(entryUsage(entry))
    const verification = el('section', 'entry-section')
    verification.id = 'entry-verification'
    if (
      !entryState.verification &&
      entry.verification &&
      (!entryState.source || entry.verification.sourceId === entryState.source)
    )
      entryState.verification = entry.verification
    if (entryState.verification) verification.append(...entryVerificationContents())
    else
      verification.append(
        el('h2', '', L('Verify a real request', '验证一条真实请求')),
        el(
          'p',
          'hint',
          L(
            'Get a verification phrase, send it in the selected software, then follow the reply here.',
            '获取验证语句，在所选软件中发送，再回到这里跟踪回复。'
          )
        ),
        action(L('Start verification', '开始验证'), startEntryVerification, 'btn primary')
      )
    content.push(verification)
  }
  return content.filter(Boolean)
}
