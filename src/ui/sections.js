function catalog() {
  return (
    S.snap?.backendCatalog ||
    Object.entries({ codex: { kind: 'codex' }, ...S.base.config.backends }).map(([id, b]) => ({
      id,
      ...b,
      endpoint: b.baseUrl
    }))
  )
}
function renderExecution() {
  const options = catalog().map((b) => [b.id, b.id]),
    inherit = [['', L('Use default backend', '使用默认后端')], ...options]
  const sections = [
    group(
      L('Execution defaults', '默认执行设置'),
      null,
      choose('execution.backend', L('Default backend', '默认后端'), options),
      inputField('model', L('Default Codex model', '默认 Codex 模型'), {
        placeholder: L('CLI default', 'CLI 默认值')
      }),
      choose('effort', L('Reasoning effort', '推理强度'), [
        ['low', L('Low', '低')],
        ['medium', L('Medium', '中')],
        ['high', L('High', '高')],
        ['xhigh', L('Extra high', '极高')]
      ]),
      num('concurrency', L('Concurrent tasks', '并行任务数'), 1, 8)
    )
  ]
  sections.push(
    group(
      L('Role assignments', '角色分配'),
      L(
        'Existing conversations keep their original backend. Empty model fields use runtime defaults.',
        '现有对话保留原来的后端。模型留空时使用运行时默认值。'
      ),
      ...roles.flatMap((r) => [
        choose('execution.roles.' + r, roleName(r) + ' · ' + L('Backend', '后端'), inherit, {
          optional: true
        }),
        inputField('models.' + r, roleName(r) + ' · ' + L('Model', '模型'), {
          optional: true,
          placeholder: L('Inherit', '继承')
        })
      ])
    )
  )
  sections.push(
    group(
      L('Backend catalog', '后端目录'),
      L(
        'Configured endpoints. Change definitions in the startup configuration and restart the host.',
        '以下为已配置的端点。如需修改，请编辑启动配置并重启宿主。'
      ),
      ...catalog().map((b) =>
        detail(
          b.id + ' · ' + b.kind,
          rows(
            datum(L('Endpoint', '端点'), b.endpoint ?? L('Native CLI', '原生 CLI'), true),
            datum(L('Model', '模型'), b.model ?? L('CLI default', 'CLI 默认值')),
            datum(
              L('Remote verification', '远端验证'),
              b.remoteVerified === true ? L('Verified', '已验证') : L('Not verified', '未验证')
            )
          )
        )
      )
    )
  )
  return sections
}
const enabled = (v) => (v ? L('Enabled', '已启用') : L('Disabled', '已停用'))
function renderSources() {
  const sources = S.draft.sources || [],
    idx = Math.max(
      0,
      sources.findIndex((s) => s.id === S.sourceId)
    ),
    src = sources[idx]
  if (!src) return [el('p', '', L('No sources configured.', '尚未配置来源。'))]
  const p = 'sources.' + idx + '.',
    live = (S.snap.liveSources || []).find((s) => s.source === src.id),
    poll = (S.status?.sources || []).find((s) => s.source === src.id)
  const identity = S.status?.setup?.checks?.find((c) => c.id === 'identity:' + src.id)
  const cap = S.snap.sourceCapabilities?.find((c) => c.source === src.id)
  const identityValue = identity?.result?.id
    ? identity.result.id + ' · ' + stateLabel(identity.status)
    : identity
      ? stateLabel(identity.status)
      : notReported()
  return [
    selector(
      'source-picker',
      L('Source', '来源'),
      sources.map((s) => [s.id, s.id + ' · ' + s.kind]),
      src.id,
      (v) => {
        S.sourceId = v
        render()
      }
    ),
    group(
      L('Source access', '来源访问'),
      null,
      toggle(p + 'enabled', L('Enable source', '启用来源')),
      listField(p + 'allowedActors', L('Allowed people', '允许的人员')),
      listField(p + 'allowedBots', L('Allowed bots', '允许的机器人')),
      inputField(p + 'pollSeconds', L('Poll interval (seconds)', '轮询间隔（秒）'), {
        type: 'num',
        min: 1,
        step: 'any'
      })
    ),
    group(
      L('Admission', '准入'),
      L(
        'Rules map source scopes to admission behavior. Use Advanced to edit listening scopes or member synchronization.',
        '为不同作用域设置准入规则。监听范围与成员同步可在「高级与历史」中编辑。'
      ),
      jsonField(p + 'admission', L('Scope rules (JSON)', '作用域规则（JSON）'), { objectType: 'object' })
    ),
    group(
      L('Connection evidence', '连接记录'),
      L(
        'Identity comes from setup checks. Live connection and polling are separate reports.',
        '身份来自环境检查。实时连接与轮询分别显示各自的记录。'
      ),
      rows(
        datum(L('Bot identity', '机器人身份'), identityValue),
        datum(L('Live connection', '实时连接'), live ? stateLabel(live.status) : notReported()),
        datum(
          L('Last poll', '最近轮询'),
          poll ? stateLabel(poll.status) + ' · ' + when(poll.at) : notReported()
        ),
        datum(L('Member directory', '成员目录'), cap ? enabled(cap.memberDirectory) : notReported())
      ),
      live ? inspectJson(L('Live record', '连接记录详情'), live) : null,
      identity ? inspectJson(L('Identity check', '身份检查详情'), identity) : null
    ),
    detail(
      L('Source deployment · restart required', '来源部署 · 修改需重启'),
      raw(Object.fromEntries(Object.entries(src).filter(([k]) => !permittedSource().includes(k))))
    )
  ]
}
function renderPolicy() {
  const rules = S.draft.rules || []
  const editRules = rules.map((rule, i) =>
    add(
      el('div', 'rule'),
      el('h3', '', L('Rule ', '规则 ') + (i + 1)),
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
      L(
        'Give each rule a unique ID and an instruction for the router.',
        '为每条规则设置唯一 ID，并编写路由指令。'
      ),
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
  return [
    group(
      L('Task limits', '任务限制'),
      null,
      num('work.backgroundTimeoutMs', L('Task deadline (ms)', '任务时限（毫秒）'), 100),
      num('work.maxAgents', L('Maximum agents', '最大代理数'), 1, 32),
      num('work.maxDepth', L('Subagent depth', '子代理嵌套深度'), 1, 8),
      num('work.maxOutputBytes', L('Maximum output (bytes)', '输出上限（字节）'), 1024, 16000000),
      toggle('work.autoRecover', L('Automatic recovery', '自动恢复'))
    ),
    group(
      L('Isolation', '隔离'),
      null,
      choose('work.sandboxDriver', L('Sandbox driver', '沙箱驱动'), [
        'codex',
        'seatbelt',
        'bubblewrap',
        ['disabled', L('Disabled', '停用')]
      ]),
      toggle('work.network', L('Allow network access', '允许网络访问'))
    ),
    group(
      L('Watchdog', '运行监测'),
      null,
      num('watchdog.staleMs', L('Stale threshold (ms)', '停滞阈值（毫秒）'), 1000),
      num('watchdog.intervalMs', L('Check interval (ms)', '检查间隔（毫秒）'), 1000)
    )
  ]
}
function renderDelivery() {
  return [
    group(
      L('Publishing', '发布'),
      null,
      toggle('delivery.workerPublish', L('Allow worker publishing', '允许执行器发布')),
      choose('delivery.authorization', L('Authorization', '授权方式'), [
        ['per-head', L('Per commit', '逐提交授权')],
        ['policy', L('Policy-based', '按策略授权')]
      ]),
      num('delivery.maxDraftLines', L('Maximum draft lines', '草稿行数上限'), 1),
      inputField('delivery.commitName', L('Commit author', '提交作者')),
      inputField('delivery.commitEmail', L('Commit email', '提交邮箱'))
    ),
    group(
      L('Review & merge', '审核与合并'),
      null,
      listField('delivery.automatedReviewers', L('Automated reviewers', '自动审核者')),
      num('delivery.maxReviewRounds', L('Maximum review rounds', '最大审核轮数'), 1, 10),
      toggle('delivery.autoMerge', L('Automatic merge', '自动合并')),
      listField('delivery.requiredReviewers', L('Required reviewers', '必需审核者')),
      toggle('delivery.requireChecks', L('Require passing checks', '要求检查通过')),
      num('delivery.maxChangedLines', L('Maximum changed lines', '变更行数上限'), 1),
      choose('delivery.method', L('Merge method', '合并方式'), ['squash', 'merge', 'rebase'])
    )
  ]
}
function renderPrompts() {
  const field = (p, n) => inputField('prompts.' + p, n, { type: 'area' })
  const output = el('div', 'stack')
  output.id = 'preview-output'
  if (S.preview) output.append(raw(S.preview.text))
  return [
    group(
      L('Role instructions', '角色指令'),
      L(
        'These instructions extend the built-in prompt. Preview uses your current draft.',
        '这些指令追加到内置提示词中。预览使用当前草稿。'
      ),
      field('shared', L('Shared', '共享')),
      field('router', roleName('router')),
      field('worker', roleName('worker')),
      field('delivery', L('Delivery', '交付'))
    ),
    group(
      L('Team instructions', '团队指令'),
      null,
      field('team.communication', L('Communication', '沟通')),
      field('team.scope', L('Scope', '范围')),
      field('team.delivery', L('Delivery expectations', '交付要求'))
    ),
    group(
      L('Prompt preview', '提示词预览'),
      null,
      selector(
        'preview-role',
        L('Preview role', '预览角色'),
        ['router', 'worker'].map((r) => [r, roleName(r)]),
        S.previewRole,
        (v) => {
          S.previewRole = v
          S.preview = null
          render()
        }
      ),
      add(el('div', 'actions'), action(L('Generate preview', '生成预览'), previewPrompt, 'btn', 'prompts')),
      output
    ),
    group(
      L('Built-in prompt parts', '内置提示词片段'),
      null,
      ...(S.promptIndex?.parts || []).map((p) => detail(p.id, raw(p.override?.text ?? p.default))),
      !S.promptIndex
        ? el(
            'p',
            'aux',
            S.promptError
              ? L('Prompt catalog unavailable.', '提示词目录不可用。')
              : L('Load the host’s current prompt parts on demand.', '按需读取宿主当前的提示词片段。')
          )
        : null,
      action(L('Load prompt catalog', '读取提示词目录'), loadPrompts, 'text-action', 'refresh')
    )
  ]
}
function renderAdvanced() {
  const k = keys().includes(S.advancedKey) ? S.advancedKey : keys()[0]
  S.advancedKey = k
  const schemaType = {
    execution: 'object',
    models: 'object',
    rules: 'array',
    sources: 'array',
    work: 'object',
    watchdog: 'object',
    delivery: 'object',
    prompts: 'object'
  }
  const history = (S.snap.history || [])
    .filter((v) => v.revision !== S.base.revision)
    .sort((a, b) => b.revision - a.revision)
  const readOnly = Object.fromEntries(
    Object.entries(S.base.config).filter(([key]) => !keys().includes(key))
  )
  return [
    group(
      L('JSON editor', 'JSON 编辑器'),
      L(
        'Edit one configuration group at a time. Source deployment properties are excluded from this editor.',
        '每次编辑一个配置组。来源部署属性从可编辑 JSON 中排除。'
      ),
      selector(
        'json-group',
        L('Configuration group', '配置组'),
        keys().map((x) => [x, x]),
        k,
        (v) => {
          S.advancedKey = v
          render()
        }
      ),
      jsonField(k, L('Group value', '配置组内容'), {
        sourceProjection: k === 'sources',
        objectType: schemaType[k],
        advanced: true
      })
    ),
    detail(L('Startup configuration · restart required', '启动配置 · 修改需重启'), raw(readOnly)),
    group(
      L('Revision history', '版本历史'),
      L(
        'Restoring loads editable values into your draft. Saving creates a new revision and preserves the previous one.',
        '恢复会将可编辑值载入草稿。保存会创建新版本，历史版本仍可查阅。'
      ),
      add(
        el('div', 'history-row'),
        add(el('div'), el('strong', '', revision(S.base.revision)), badge(L('Current', '当前'))),
        el('p', '', when(S.base.at))
      ),
      ...history.map((v) =>
        add(
          el('div', 'history-row'),
          add(el('div'), el('strong', '', revision(v.revision)), el('p', '', when(v.at))),
          action(L('Restore to draft', '恢复至草稿'), () => restore(v))
        )
      ),
      history.length
        ? null
        : el(
            'p',
            'aux',
            L('Previous revisions appear here after the first save.', '首次保存后，可在此查看历史版本。')
          )
    )
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
  const form = el('form', 'authform'),
    label = el('label', '', L('Access token', '访问令牌')),
    input = el('input')
  input.id = 'access-token'
  input.name = 'access-token'
  input.type = 'password'
  input.autocomplete = 'off'
  input.spellcheck = false
  input.required = true
  input.value = S.typed
  input.oninput = () => {
    S.typed = input.value
  }
  label.htmlFor = input.id
  label.append(input)
  const connect = action(
    S.busy === 'connect' ? L('Connecting…', '连接中…') : L('Connect', '连接'),
    undefined,
    'btn primary',
    'arrow'
  )
  connect.type = 'submit'
  connect.disabled = !!S.busy
  form.onsubmit = (e) => {
    e.preventDefault()
    connectHost()
  }
  add(form, label, connect)
  return add(
    el('section', 'panel access'),
    add(el('div', 'access-head'), icon('key'), el('h2', '', L('Connect to this host', '连接到当前宿主'))),
    el(
      'p',
      'hint',
      L(
        'Enter the host access token to load its configuration and revision history.',
        '输入宿主访问令牌以读取配置和版本历史。'
      )
    ),
    form,
    el('p', 'aux', L('The token stays in memory for this tab.', '令牌仅保存在当前标签页内存中。'))
  )
}
function hostPanel() {
  return panel(
    L('Runtime', '运行环境'),
    rows(
      datum(L('Host', '宿主'), location.host, true),
      datum(L('API version', 'API 版本'), S.health?.version ?? '—', true),
      datum(
        L('Health endpoint', '健康接口'),
        !S.healthDone
          ? L('Checking…', '检查中…')
          : S.health?.ok
            ? L('Reachable', '可达')
            : L('Unavailable', '不可达')
      ),
      ...(S.authed
        ? [
            datum(
              L('Intake', '任务接收'),
              typeof S.status?.paused === 'boolean'
                ? S.status.paused
                  ? L('Paused', '已暂停')
                  : L('Open', '已开启')
                : notReported()
            ),
            datum(L('Revision', '版本'), String(S.base.revision), true)
          ]
        : [])
    ),
    add(
      el('div', 'actions'),
      action(L('Refresh status', '刷新状态'), refreshStatus, 'text-action', 'refresh')
    )
  )
}
function goRow(key) {
  const s = sections.find((x) => x[0] === key),
    b = action('', () => go(key), 'link-row')
  b.replaceChildren(
    icon(key),
    add(el('div', 'link-copy'), el('strong', '', L(s[1], s[2])), el('small', '', L(s[3], s[4]))),
    icon('forward')
  )
  return b
}
function overview() {
  if (!S.authed)
    return [
      add(el('div', 'split'), accessPanel(), hostPanel()),
      group(L('Configuration areas', '配置区域'), null, ...['execution', 'sources', 'policy'].map(goRow))
    ]
  const c = S.base.config,
    setup = S.status?.setup
  const route = panel(
    L('Execution routing', '执行路由'),
    el('p', 'hint', L('Saved backend assignments for new conversations.', '新对话当前生效的后端分配。')),
    rows(
      ...roles.map((r) =>
        datum(
          roleName(r),
          add(
            el('span', 'route-role mono'),
            icon('branch'),
            el('span', '', c.execution.roles[r] ?? c.execution.backend)
          )
        )
      )
    ),
    add(
      el('div', 'actions'),
      action(L('Edit execution', '编辑执行设置'), () => go('execution'), 'text-action', 'arrow')
    )
  )
  const setupArea = group(
    L('Setup checks', '环境检查'),
    L(
      'Check the configured executables, sandbox and source identities.',
      '检查已配置的程序、沙箱和来源身份。'
    ),
    setup
      ? rows(
          datum(L('Last result', '最近结果'), stateLabel(setup.status)),
          datum(L('Checked at', '检查时间'), when(setup.at))
        )
      : el('p', 'aux', L('No setup check has been reported.', '尚无环境检查记录。')),
    setup?.checks?.length
      ? detail(
          L('Check results', '检查明细'),
          add(
            el('div', 'setup-list'),
            ...setup.checks.map((c) => detail(c.id + ' · ' + stateLabel(c.status), raw(c)))
          )
        )
      : null,
    add(el('div', 'actions'), action(L('Run setup check', '运行环境检查'), runSetup, 'btn', 'check'))
  )
  return [
    add(el('div', 'split'), route, hostPanel()),
    setupArea,
    group(
      L('Configuration record', '配置记录'),
      null,
      rows(
        datum(L('Last saved', '上次保存'), when(S.base.at)),
        datum(L('Access', '访问状态'), L('Authenticated', '已认证'))
      ),
      add(
        el('div', 'actions'),
        action(L('View history', '查看历史'), () => go('advanced'), 'text-action', 'arrow'),
        action(L('Disconnect', '断开连接'), disconnect, 'text-action')
      )
    )
  ]
}
