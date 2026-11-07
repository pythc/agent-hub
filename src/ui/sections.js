function sourceSettings(sourceId) {
  const index = S.draft.sources.findIndex(source => source.id === sourceId)
  if (index < 0) return null
  const source = S.draft.sources[index]
  const path = 'sources.' + index + '.'
  const live = (operator.work?.liveSources || S.snap.liveSources)?.find(record => record.source === sourceId)
  const poll = (operator.work?.sources || S.status?.sources)?.find(record => record.source === sourceId)
  const identity = S.status?.setup?.checks?.find(check => check.id === 'identity:' + sourceId)
  const capability = S.snap.sourceCapabilities?.find(record => record.source === sourceId)
  return add(el('div', 'workspace-settings'),
    group(L('Access and listening', '访问权限与监听'), null,
      toggle(path + 'enabled', L('Enable connection', '启用连接')),
      listField(path + 'allowedActors', L('Allowed people', '允许的人员')),
      listField(path + 'allowedBots', L('Allowed bots', '允许的机器人')),
      listField(path + 'listenScopes', L('Listening scopes', '监听范围'), true)),
    detail(L('Admission, polling and member sync', '准入、轮询与成员同步'),
      add(el('div', 'stack'),
        num(path + 'pollSeconds', L('Poll interval (seconds)', '轮询间隔（秒）'), 1),
        jsonField(path + 'admission', L('Scope rules (JSON)', '作用域规则（JSON）'), { objectType: 'object' }),
        toggle(path + 'memberSync.enabled', L('Synchronize members', '同步成员')),
        inputField(path + 'memberSync.scope', L('Member sync scope', '成员同步范围'), { optional: true }))),
    detail(L('Connection evidence', '连接记录'),
      add(el('div', 'stack'),
        rows(
          datum(L('Bot identity', '机器人身份'), identity?.result?.id || notReported()),
          datum(L('Live connection', '实时连接'), live ? stateLabel(live.status) : notReported()),
          datum(L('Last poll', '最近轮询'), poll ? stateLabel(poll.status) + ' / ' + when(poll.at) : notReported()),
          datum(L('Member directory', '成员目录'), capability ? (capability.memberDirectory ? L('Available', '可用') : L('Unavailable', '不可用')) : notReported())),
        live ? inspectJson(L('Live record', '连接记录详情'), live) : null,
        identity ? inspectJson(L('Identity check', '身份检查详情'), identity) : null)),
    detail(L('Deployment settings (read only)', '部署配置（只读）'),
      raw(Object.fromEntries(Object.entries(source).filter(([key]) => !permittedSource().includes(key)))))
  )
}
function renderPolicy() {
  const rules = S.draft.rules || []
  const editRules = rules.map((rule, i) =>
    add(
      el('div', 'rule'),
      el('h3', '', rule.id || L('New rule', '新规则')),
      inputField('rules.' + i + '.id', L('Rule ID', '规则 ID')),
      inputField('rules.' + i + '.instruction', L('Instruction', '指令'), { type: 'area' }),
      add(
        el('div', 'rules-actions'),
        action(
          L('Remove rule', '移除规则'),
          () => {
            if (!confirm(L('Remove this rule from the draft?', '从草稿中移除此规则？'))) return
            clearRelated('rules')
            rules.splice(i, 1)
            render()
          },
          'text-action'
        )
      )
    )
  )
  return [
    group(
      L('Inferred requests', '推断请求'),
      L(
        'Off blocks inferred work. Observe records rule matches. Auto can start work that matches an enabled rule.',
        '关闭会阻止推断任务。观察模式记录规则匹配结果。自动模式可执行匹配规则的任务。'
      ),
      choose('acceptMode', L('Acceptance mode', '接收模式'), [
        ['off', L('Off', '关闭')],
        ['observe', L('Observe', '观察')],
        ['auto', L('Auto', '自动')]
      ])
    ),
    group(
      L('Acceptance rules', '接收规则'),
      null,
      ...editRules,
      rules.length ? null : el('p', 'aux', L('No acceptance rules configured.', '尚未配置接收规则。')),
      add(
        el('div', 'actions'),
        action(L('Add rule', '添加规则'), () => {
          clearRelated('rules')
          rules.push({ id: '', instruction: '' })
          S.draft.rules = rules
          render()
          document.getElementById('f-rules-' + (rules.length - 1) + '-id')?.focus()
        })
      )
    )
  ]
}
function renderWork() {
  return [add(el('div', 'settings-columns'),
    group(L('Task limits', '任务限制'), null,
      scaledNumber('work.backgroundTimeoutMs', L('Background task deadline (seconds)', '后台任务时限（秒）'), 1000, 100),
      num('work.maxAgents', L('Maximum agents', '最大代理数'), 1, 32),
      num('work.maxDepth', L('Subagent depth', '子代理嵌套深度'), 1, 8),
      scaledNumber('work.maxOutputBytes', L('Output limit (KiB)', '输出上限（KiB）'), 1024, 1024, 16000000),
      toggle('work.autoRecover', L('Automatic recovery', '自动恢复'))),
    add(el('div', 'settings-stack'),
      group(L('Isolation', '隔离'), null,
        choose('work.sandboxDriver', L('Sandbox driver', '沙箱驱动'), [
          'codex', 'seatbelt', 'bubblewrap', ['disabled', L('Disabled', '停用')]
        ]),
        toggle('work.network', L('Allow network access', '允许网络访问'))),
      group(L('Stall detection', '停滞监测'), null,
        scaledNumber('watchdog.staleMs', L('Stale threshold (seconds)', '停滞阈值（秒）'), 1000, 1000, undefined, false),
        scaledNumber('watchdog.intervalMs', L('Check interval (seconds)', '检查间隔（秒）'), 1000, 1000, undefined, false)))
  )]
}
function renderDelivery() {
  const permission = S.draft.delivery?.workerPublish
  const autoMerge = S.draft.delivery?.autoMerge
  const publish = group(L('Publishing permission', '发布权限'), null,
    toggle('delivery.workerPublish', L('Allow Worker publishing', '允许 Worker 发布')),
    choose('delivery.authorization', L('Authorization', '授权方式'), [
      ['per-head', L('Per commit', '逐提交授权')], ['policy', L('Policy-based', '按策略授权')]
    ], { disabled: !permission }),
    num('delivery.maxDraftLines', L('Maximum draft lines', '草稿行数上限'), 1))
  const merge = group(L('Merge conditions', '合并条件'), null,
    toggle('delivery.autoMerge', L('Automatic merge', '自动合并'),
      L('The conditions below apply when enabled.', '开启后下列条件生效。')),
    inputField('delivery.requiredReviewers', L('Required reviewers', '必需审核者'), {
      type: 'list', disabled: !autoMerge, help: L('One reviewer per line.', '每行一个审核者。')
    }),
    inputField('delivery.requireChecks', L('Require passing checks', '要求检查通过'), { type: 'bool', disabled: !autoMerge }),
    inputField('delivery.maxChangedLines', L('Maximum changed lines', '变更行数上限'), { type: 'num', min: 1, disabled: !autoMerge }),
    choose('delivery.method', L('Merge method', '合并方式'), ['squash', 'merge', 'rebase'], { disabled: !autoMerge }))
  for (const path of ['workerPublish', 'autoMerge'])
    (path === 'workerPublish' ? publish : merge).querySelector('#f-delivery-' + path).onchange = () => render()
  return [add(el('div', 'settings-columns'),
    add(el('div', 'settings-stack'), publish,
      group(L('Commit identity', '提交身份'), null,
        inputField('delivery.commitName', L('Author name', '作者名称')),
        inputField('delivery.commitEmail', L('Commit email', '提交邮箱')))),
    add(el('div', 'settings-stack'), merge,
      group(L('Automated review', '自动审核'), null,
        listField('delivery.automatedReviewers', L('Reviewers', '审核者')),
        num('delivery.maxReviewRounds', L('Maximum review rounds', '最大审核轮数'), 1, 10))))
  ]
}
function settingsGroupName(key) {
  return ({
    backends: L('Model connections', '模型连接'),
    execution: L('Execution', '执行配置'), models: L('Role models', '角色模型'),
    model: L('Default model', '默认模型'), effort: L('Reasoning effort', '推理强度'),
    concurrency: L('Worker count', 'Worker 数量'), acceptMode: L('Intake mode', '接收模式'),
    rules: L('Intake rules', '接收规则'), prompts: L('Prompts', '提示词'), sources: L('Connections', '软件接入'),
    watchdog: L('Stall detection', '停滞监测'), work: L('Runtime limits', '运行与隔离'),
    delivery: L('Publishing and merging', '发布与合并')
  })[key] || key
}
function renderSettingsJson() {
  const key = keys().includes(S.advancedKey) ? S.advancedKey : keys()[0]
  const readOnly = Object.fromEntries(Object.entries(S.base.config).filter(([name]) => !keys().includes(name)))
  return [add(el('div', 'settings-with-aside'),
    group(L('JSON editor', 'JSON 编辑'), null,
      selector('json-group', L('Configuration group', '配置组'), keys().map(name => [name, settingsGroupName(name) + ' / ' + name]), key, value => {
        S.advancedKey = value
        render()
      }),
      jsonField(key, L('Group contents', '配置组内容'), { sourceProjection: key === 'sources', advanced: true })),
    panel(L('Configuration boundaries', '配置边界'),
      el('p', 'hint', L('Edit one group at a time. Saving validates the draft against the host schema.',
        '每次编辑一个配置组。保存时由宿主校验草稿。')),
      detail(L('Startup settings (read only)', '启动配置（只读）'), raw(readOnly))
    )
  )]
}
function renderRevisions() {
  const current = S.latest?.current || S.base
  const history = (S.latest || S.snap).history.filter(item => item.revision !== current.revision)
    .sort((a, b) => b.revision - a.revision)
  const versions = [current, ...history]
  const grid = versions.map((version, index) => {
    const next = versions[index + 1]
    const groups = next ? keys().filter(key => !same(version.config[key], next.config[key])) : []
    const diff = detail(L('View changes', '查看差异'), el('div', 'stack'))
    diff.ontoggle = () => {
      const body = diff.querySelector('.stack')
      if (!diff.open || body.childNodes.length) return
      const target = restoredConfig(version)
      const value = (config, key) => key === 'sources' ? projectSources(config.sources) : config[key]
      const edits = keys().filter(key => !same(value(S.base.config, key), value(target, key)))
      if (!edits.length) body.append(el('p', 'hint', L('No editable differences from the current revision.', '与当前版本的可编辑值相同。')))
      for (const key of edits)
        body.append(add(el('section', 'revision-diff'),
          el('h3', '', settingsGroupName(key)),
          add(el('div', 'settings-columns'),
            add(el('div'), el('strong', '', L('Current', '当前值')), raw(value(S.base.config, key) ?? null)),
            add(el('div'), el('strong', '', L('Selected revision', '所选版本')), raw(value(target, key) ?? null)))))
    }
    const load = opButton(L('Load into draft', '载入草稿'), () => restore(version), 'button')
    load.disabled = !!S.latest
    return add(el('section', 'revision-item'),
      add(el('div', 'revision-line'),
        add(el('div', 'revision-name'), el('strong', '', 'r' + version.revision), index === 0 ? el('span', 'pill green', L('Current', '当前')) : null),
        el('time', '', when(version.at)), el('span', 'hint', groups.map(settingsGroupName).join(', ') || '—'),
        index > 0 ? load : null),
      index > 0 ? diff : null)
  })
  return [
    add(el('div', 'revision-list'), ...grid),
    el('p', 'hint', L('Loading a revision changes the draft. Review it and save to create a new revision.',
      '载入历史版本只更新草稿。核对后保存会创建一个新版本。'))
  ]
}
function workspaceTabs(label, items) {
  const nav = el('nav', 'workspace-tabs')
  nav.setAttribute('aria-label', label)
  for (const [title, active, select] of items) {
    const button = opButton(title, select, 'workspace-tab')
    if (active) button.setAttribute('aria-current', 'page')
    nav.append(button)
  }
  return nav
}
function renderWorkspaceSettings() {
  const page = entryState.advancedPage
  const tabs = [
    ['host', L('Host status', '宿主状态')],
    ['intake', L('Intake rules', '接收规则')],
    ['runtime', L('Runtime and isolation', '运行与隔离')],
    ['delivery', L('Publishing and merging', '发布与合并')],
    ['json', L('Configuration maintenance', '配置维护')]
  ]
  const maintenance = page === 'json' || page === 'revisions'
  const select = view => opNavigate('advanced', '', { view })
  const views = { host: renderHostStatus, intake: renderPolicy, runtime: renderWork,
    delivery: renderDelivery, json: renderSettingsJson, revisions: renderRevisions }
  return [opHeading(L('Advanced settings', '高级设置'), null),
    workspaceTabs(L('Settings sections', '高级设置分区'), tabs.map(([key, title]) => [
      title, key === page || key === 'json' && maintenance, () => select(key)
    ])),
    maintenance ? workspaceTabs(L('Configuration maintenance', '配置维护'), [
      [L('JSON editor', 'JSON 编辑'), page === 'json', () => select('json')],
      [L('Revisions', '版本记录'), page === 'revisions', () => select('revisions')]
    ]) : null,
    add(el('div', 'workspace-settings settings-stack'), ...views[page]())
  ]
}
function stateLabel(value) {
  const names = {
    ok: ['OK', '正常'],
    ready: ['Ready', '就绪'],
    connecting: ['Connecting', '连接中'],
    connected: ['Connected', '已连接'],
    disconnected: ['Disconnected', '已断开'],
    reconnecting: ['Reconnecting', '正在重连'],
    stopped: ['Stopped', '已停止'],
    overloaded: ['Overloaded', '消息处理过载'],
    'credentials-required': ['Credentials required', '缺少连接凭据'],
    'configuration-error': ['Configuration error', '连接器配置错误'],
    'connection-error': ['Connection error', '连接错误'],
    'message-error': ['Message processing failed', '消息处理失败'],
    warning: ['Warning', '警告'],
    error: ['Error', '错误'],
    pending: ['Pending', '待确认'],
    required: ['Action required', '需要处理'],
    retrying: ['Retrying', '重试中'],
    'setup-required': ['Action required', '需要处理'],
    'connection-pending': ['Connection pending', '连接待确认']
  }
  if (Object.hasOwn(names, value)) return L(...names[value])
  return value ? L('Unrecognized status', '未识别状态') + ' (' + value + ')' : notReported()
}
function accessPanel() {
  const file = el('input')
  file.type = 'file'
  file.accept = '.json,application/json'
  file.id = 'connection-file'
  file.className = 'connection-file'
  const pick = action(L('Choose connection file', '选择连接文件'), () => file.click(), 'btn primary', 'key')
  pick.id = 'choose-connection'
  file.onchange = async () => {
    const selected = file.files?.[0]
    file.value = ''
    if (!selected) return
    try {
      if (selected.size > 32768) throw Error()
      const data = JSON.parse(await selected.text())
      if (
        data.application !== 'agent-hub' ||
        data.version !== 1 ||
        typeof data.accessToken !== 'string' ||
        !data.accessToken.trim()
      )
        throw Error()
      if (data.url !== location.origin) {
        setNotice(
          'error',
          'This file belongs to another AgentHub address. Choose the file for this page.',
          '此文件属于其他 AgentHub 地址。请选择当前页面对应的连接文件。'
        )
        render()
        revealRecovery()
        return
      }
      await connectHost(data.accessToken)
    } catch {
      setNotice(
        'error',
        'Choose the connection.json created by AgentHub on this computer.',
        '请选择 AgentHub 在这台电脑上生成的 connection.json。'
      )
      render()
      revealRecovery()
    }
  }
  const path = S.connectInfo?.connectionFile
  const copyPath = action(
    L('Copy file path', '复制文件路径'),
    async () => {
      try {
        await navigator.clipboard.writeText(path)
        copyPath.textContent = L('Path copied', '已复制路径')
      } catch {
        const range = document.createRange()
        range.selectNodeContents(pathCode)
        const selection = window.getSelection()
        selection.removeAllRanges()
        selection.addRange(range)
        copyPath.textContent = L('Path selected · copy now', '已选中路径，请复制')
      }
    },
    'text-action'
  )
  const pathCode = el('code', '', path)
  const pickerHelp = detail(
    L('How to locate this file', '如何找到这个文件'),
    el(
      'p',
      'hint',
      L(
        'Copy the path and paste it into the file chooser. On macOS, press Shift–Command–G in the chooser first.',
        '复制完整路径并将它粘贴到文件选择器。在 macOS 上，先在选择窗口按 Shift–Command–G。'
      )
    )
  )

  const input = el('input')
  input.type = 'password'
  input.id = 'access-token'
  input.value = S.typed
  input.autocomplete = 'off'
  input.spellcheck = false
  input.required = true
  input.oninput = () => {
    S.typed = input.value
  }
  const label = el('label', '', L('Access token', '访问令牌'))
  label.htmlFor = input.id
  label.append(input)
  const submit = action(L('Connect', '连接'), null, 'btn')
  submit.type = 'submit'
  const form = add(el('form', 'authform'), label, submit)
  form.onsubmit = (e) => {
    e.preventDefault()
    connectHost()
  }
  const manual = detail(L('Use an access token instead', '改用访问令牌'), form)
  return add(
    el('section', 'panel access'),
    el('h2', '', L('Connect this browser to AgentHub', '让此浏览器连接 AgentHub')),
    el(
      'p',
      'hint',
      L(
        'Choose the connection file that AgentHub created at startup. It gives this tab permission to apply your setup.',
        '选择 AgentHub 启动时生成的连接文件，授权当前标签页应用设置。'
      )
    ),
    path
      ? add(
          el('div', 'guide-path'),
          el('span', 'hint', L('File location', '文件位置')),
          pathCode,
          pickerHelp
        )
      : el(
          'p',
          'hint',
          L(
            'Look for connection.json in the host’s state folder, or use its access token below.',
            '在宿主的状态目录查找 connection.json，或使用下方的访问令牌。'
          )
        ),
    add(el('div', 'actions'), pick, file, path ? copyPath : null),
    manual
  )
}
function renderHostStatus() {
  const setup = S.status?.setup
  const version = opButton('r' + S.base.revision,
    () => opNavigate('advanced', '', { view: 'revisions' }), 'text-button')
  const host = panel(L('Host status', '宿主状态'),
    rows(
      datum(L('Connection', '连接'), S.health?.ok ? L('Reachable', '可达') : L('Unavailable', '不可达')),
      datum(L('Task intake', '任务接收'), S.status ? S.status.paused ? L('Paused', '已暂停') : L('Open', '已开启') : notReported()),
      datum(L('Host address', '宿主地址'), location.host),
      datum(L('Configuration revision', '配置版本'), version)))
  const checks = panel(L('Environment checks', '环境检查'),
    ...(setup?.checks?.length
      ? setup.checks.map(check => detail(check.id + ' / ' + stateLabel(check.status), raw(check)))
      : [el('p', 'hint', L('No setup check has been reported.', '尚无环境检查记录。'))]))
  return [add(el('div', 'settings-with-aside'),
    add(el('div', 'settings-stack'), host, checks),
    panel(L('Check record', '检查记录'),
      rows(datum(L('Last checked', '最近检查'), setup ? when(setup.at) : notReported()),
        datum(L('Host version', '宿主版本'), S.health?.version ?? notReported())),
      add(el('div', 'actions'), opButton(L('Run checks', '运行环境检查'), runSetup, 'button primary'),
        opButton(L('Refresh status', '刷新状态'), refreshStatus, 'button')),
      detail(L('Management session', '管理会话'),
        add(el('div', 'actions'), opButton(L('Browser diagnostics', '浏览器调试'), () => switchSurface('guide'), 'button'),
          opButton(L('Disconnect', '断开连接'), disconnect, 'button')))))
  ]
}
