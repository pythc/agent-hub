function suggestedFolder() {
  return guide.context?.defaultWorkspace || ''
}
async function loadConnectInfo() {
  try {
    const info = await api('/connect-info', undefined, true)
    S.connectInfo = {
      preview: info.preview === true,
      connectionFile: typeof info.connectionFile === 'string' ? info.connectionFile : ''
    }
  } catch {
    S.connectInfo = null
  }
}
async function loadGuideContext() {
  try {
    const data = await api('/onboarding')
    if (!Array.isArray(data.connections) || typeof data.defaultWorkspace !== 'string')
      throw Error('Unrecognized setup response')
    guide.context = data
    guide.contextError = false
    if (!data.connections.some((c) => c.id === guide.existingId))
      guide.existingId = data.connections[0]?.id || ''
  } catch (e) {
    guide.context = null
    guide.contextError = true
    if (e.status === 401) throw e
  }
}
function resetGuideSession() {
  resetInbox()
  Object.assign(guide, {
    step: 0,
    furthest: 0,
    touched: false,
    context: null,
    contextError: false,
    existingId: '',
    mode: 'codex',
    channel: 'local',
    folder: '',
    folderMode: 'suggested',
    provider: 'openai',
    endpoint: '',
    model: '',
    protocol: 'openai-responses',
    credential: '',
    plan: null,
    check: null,
    saved: null,
    issue: null
  })
}
function guideStatus(text) {
  const n = el('p', 'alert', text)
  n.setAttribute('role', 'status')
  return n
}
function guideActions() {
  if (!S.authed) return [accessPanel()]
  if (!guide.context)
    return [
      el(
        'p',
        'alert warning',
        L(
          'The setup service is unavailable. Reconnect to the host or retry. Your choices are still here.',
          '暂时无法读取首次设置服务。请重新连接宿主或重试，当前选择仍然保留。'
        )
      ),
      action(L('Retry loading setup', '重新读取设置'), () => guideRun('load', loadGuideContext), 'btn')
    ]
  if (dirty())
    return [
      el(
        'p',
        'alert warning',
        L(
          'Advanced settings has unsaved edits. Save or discard them there before applying this setup.',
          '高级设置中有未保存的更改。请先在那里保存或放弃更改。'
        )
      ),
      action(L('Review advanced settings', '检查高级设置'), () => switchSurface('advanced'))
    ]
  const result = []
  if (guide.plan && guide.check) result.push(checkResults(guide.check))
  if (guide.busy) return [...result, guideStatus(busyText())]
  if (!guide.check || !canApply()) {
    result.push(
      el(
        'p',
        'hint',
        guide.mode === 'api' ||
          (guide.mode === 'existing' &&
            guide.context.connections.find((c) => c.id === guide.existingId)?.kind !== 'codex')
          ? isGuidePreview()
            ? L(
                'In this preview, connection checks do not contact the provider.',
                '预览环境中的连接检查不会联系服务商。'
              )
            : L(
                'Checking sends a short text request to the selected service and may use API credit. No workspace files are sent.',
                '检查会向所选服务发送一条简短的文本请求，可能消耗 API 额度。不会发送工作文件。'
              )
          : L(
              'AgentHub will check whether it can use Codex on this computer.',
              'AgentHub 会检查能否在这台电脑上使用 Codex。'
            )
      )
    )
    result.push(
      add(
        el('div', 'actions'),
        action(
          guide.check ? L('Check again', '重新检查') : L('Check my setup', '检查我的设置'),
          checkGuideSetup,
          'btn primary',
          'check'
        )
      )
    )
  } else {
    result.push(
      el(
        'p',
        'hint',
        isGuidePreview()
          ? L(
              'Save these settings to this preview only. Live tasks stay disabled.',
              '设置只会保存到这个预览环境。实际任务仍然停用。'
            )
          : L(
              'Applying creates the browser task inbox and reloads AgentHub with the selected connection. New tasks will use this service across all roles. Other connections remain available.',
              '应用后会创建浏览器任务入口，并重新加载 AgentHub。今后新任务的各个角色都将使用所选服务，已有连接仍可选用。'
            )
      )
    )
    result.push(
      add(
        el('div', 'actions'),
        action(
          isGuidePreview() ? L('Save preview setup', '保存预览设置') : L('Save and apply', '保存并应用'),
          applyGuideSetup,
          'btn primary',
          'check'
        ),
        action(L('Check again', '重新检查'), checkGuideSetup, 'text-action')
      )
    )
  }
  return result
}
function canApply() {
  const r = guide.check
  return !!(r && !r.checks.some((c) => c.status === 'required') && (r.ok === true || r.preview === true))
}
function busyText() {
  const names = {
    load: ['Reading saved setup…', '正在读取已保存的设置…'],
    check: ['Checking your choices…', '正在检查你的选择…'],
    apply: ['Saving and reloading AgentHub…', '正在保存并重新加载 AgentHub…'],
    send: ['Sending your request…', '正在发送任务…']
  }
  return L(...(names[guide.busy] || names.load))
}
function cleanDetail(value) {
  let s = typeof value === 'string' ? value : JSON.stringify(value ?? '')
  for (const secret of [guide.credential, S.token, S.typed]) if (secret) s = s.split(secret).join('[…]')
  return s.slice(0, 1200)
}
function failGuide(en, zh, detail = '') {
  guide.issue = { en, zh, detail: cleanDetail(detail) }
}
async function guideRun(name, fn) {
  if (guide.busy || S.busy) return
  guide.busy = name
  guide.issue = null
  S.notice = null
  render()
  try {
    await fn()
  } catch (e) {
    const code = e.payload?.code || ''
    if (e.status === 401) {
      S.token = ''
      S.authed = false
      guide.context = null
      guide.plan = null
      guide.check = null
      failGuide(
        'Reconnect with the file for this host. Your choices are still here.',
        '请使用当前宿主的连接文件重新连接。当前选择仍然保留。'
      )
    } else if (/busy|active_work/i.test(code)) {
      failGuide(
        'AgentHub is still working. Wait for the current work to finish, then retry.',
        'AgentHub 仍在处理任务。请等待当前任务结束后重试。'
      )
    } else if (
      /conflict|revision|expir|unknown_plan|stale|plan_not_found/i.test(code + ' ' + e.message) ||
      e.status === 409
    ) {
      guide.plan = null
      guide.check = null
      try {
        adopt(await snapshot())
        await loadGuideContext()
      } catch {}
      failGuide(
        'The host changed or the check expired. Review the choices and check them again.',
        '宿主设置已变化或检查已过期。请核对选择后重新检查。'
      )
    } else if (e.status === 403 && /preview/i.test(code + ' ' + e.message)) {
      failGuide(
        'This preview cannot send live requests. Open a running AgentHub to try one.',
        '预览环境无法发送实际请求。请在实际运行的 AgentHub 中试用。'
      )
    } else if (
      [
        'workspace_private',
        'workspace_invalid',
        'connection_missing',
        'setup_apply_failed',
        'setup_recovery_required',
        'too_many_plans'
      ].includes(code)
    ) {
      const messages = {
        workspace_private: [
          'Return to Work folder and choose a dedicated folder outside AgentHub’s private settings.',
          '请返回工作文件夹步骤，选择独立文件夹，避开 AgentHub 的私有设置目录。'
        ],
        workspace_invalid: [
          'Return to Work folder and enter the full path to a folder.',
          '请返回工作文件夹步骤，填写文件夹的完整路径。'
        ],
        connection_missing: [
          'The saved connection has been removed. Select another AI service.',
          '原连接已被移除。请返回并选择其他 AI 服务。'
        ],
        setup_apply_failed: [
          'Setup failed. The host restored its previous settings.',
          '应用失败，宿主已恢复之前的设置。'
        ],
        setup_recovery_required: [
          'Settings were restored, but AgentHub could not restart. Restart the host before continuing.',
          '设置已恢复，但 AgentHub 未能重新启动。请重启宿主后再继续。'
        ],
        too_many_plans: [
          'Too many recent checks. Wait for an earlier draft to expire, then retry.',
          '近期检查过多。请等待较早的草稿过期后重试。'
        ]
      }
      failGuide(...messages[code])
    } else if (name === 'apply' && !e.status) {
      guide.plan = null
      guide.check = null
      try {
        await loadGuideContext()
      } catch {}
      failGuide(
        'The save receipt did not arrive. Review the last saved setup before trying again.',
        '未收到保存回执。请先查看上次已保存的设置，再决定是否重试。'
      )
    } else {
      failGuide(
        'AgentHub could not finish this step. Your choices are still here.',
        'AgentHub 未能完成此步骤。当前选择仍然保留。',
        e.message
      )
    }
  } finally {
    guide.busy = ''
    render()
    const n =
      document.getElementById('guide-issue') ||
      document.getElementById(name === 'send' ? 'inbox-history' : 'guide-result')
    if (n && S.surface === 'guide') {
      n.tabIndex = -1
      n.focus({ preventScroll: true })
      n.scrollIntoView({ block: 'nearest' })
    }
  }
}
function makeGuidePlan() {
  let connection
  if (guide.mode === 'existing') connection = { kind: 'existing', id: guide.existingId }
  else if (guide.mode === 'codex') connection = { kind: 'codex' }
  else {
    const s = selectedService()
    connection = {
      kind: 'api',
      protocol: s.protocol,
      baseUrl: s.endpoint,
      model: guide.model.trim(),
      ...(guide.credential.trim() ? { apiKey: guide.credential.trim() } : {})
    }
  }
  return {
    revision: S.base.revision,
    connection,
    channel: guide.channel === 'local' ? 'browser' : guide.channel,
    ...(guide.folderMode === 'custom' ? { workspace: guide.folder.trim() } : {})
  }
}
async function checkGuideSetup() {
  if (guide.mode === 'api' && !validateService()) return
  await guideRun('check', async () => {
    guide.plan = null
    guide.check = null
    const plan = await api('/onboarding/plan', makeGuidePlan())
    if (!plan.id || !plan.workspace) throw Error('Invalid setup plan')
    guide.plan = plan
    const checks = await api('/onboarding/check', { id: plan.id })
    if (!Array.isArray(checks.checks) || typeof checks.ok !== 'boolean')
      throw Error('Invalid check receipt')
    guide.check = checks
    announce(
      checks.ok
        ? L('Setup check complete.', '设置检查已完成。')
        : L('Review the check results.', '请查看检查结果。')
    )
  })
}
async function applyGuideSetup() {
  if (!guide.plan || !canApply()) return
  await guideRun('apply', async () => {
    const receipt = await api('/onboarding/apply', { id: guide.plan.id })
    if (receipt.applied !== true || !Number.isInteger(receipt.revision) || !receipt.sourceId)
      throw Error('Invalid save receipt')
    guide.saved = { ...receipt, channel: guide.plan.channel }
    guide.credential = ''
    guide.touched = false
    resetInbox(receipt.sourceId)
    guide.plan = null
    guide.check = null
    try {
      adopt(await snapshot())
      await loadGuideContext()
    } catch {}
    announce(L('Setup saved.', '设置已保存。'))
  })
}
function resumeLastSetup() {
  const last = guide.context?.lastSetup
  if (!last) return
  const source = S.base?.config.sources?.find((s) => s.id === last.sourceId)
  const current =
    source?.enabled === true &&
    source.cwd === last.workspace &&
    S.base.config.execution?.backend === last.connection?.id
  guide.saved = {
    ...last,
    preview: isGuidePreview(),
    ready: current && last.checked === true && !isGuidePreview(),
    restored: true,
    paused: S.status?.paused === true
  }
  if (inbox.source !== last.sourceId) resetInbox(last.sourceId)
  guide.step = 3
  guide.furthest = 3
  render(true)
  void monitorInbox(true, true)
}
function checkResults(r) {
  const box = add(el('section', 'guide-result'), el('h3', '', L('Check results', '检查结果')))
  box.id = 'guide-result'
  box.tabIndex = -1
  const list = el('ul', 'guide-checks')
  for (const c of r.checks || []) {
    const label = checkCopy(c)
    list.append(
      add(
        el('li'),
        add(
          el('div', 'inline'),
          badge(
            stateLabel(c.status),
            c.status === 'required' ? 'issue' : c.status === 'pending' ? 'preview' : ''
          ),
          el('strong', '', label[0])
        ),
        label[1] ? el('p', 'hint', label[1]) : null,
        c.detail ? detail(L('Technical detail', '技术详情'), raw(cleanDetail(c.detail))) : null
      )
    )
  }
  const remote = guide.plan?.connection?.kind !== 'codex'
  if (remote && !r.checks.some((c) => ['model_replied', 'preview_not_connected'].includes(c.code)))
    box.append(
      el(
        'p',
        'hint',
        r.remoteVerified === true
          ? L('The model service answered the connection check.', '模型服务已回应连接检查。')
          : L('A reply from the model service has not been verified.', '尚未验证模型服务能否回应。')
      )
    )
  return add(box, list)
}
function checkCopy(c) {
  const known = {
    codex_installed: [['Codex is installed', 'Codex 已安装']],
    codex_not_installed: [
      ['Install Codex on this computer', '请在这台电脑上安装 Codex'],
      [
        'Install the Codex CLI on the host, or go back and select an API service.',
        '请在宿主电脑上安装 Codex CLI，或返回选择 API 服务。'
      ]
    ],
    codex_signed_in: [['Codex is signed in', 'Codex 已登录']],
    codex_sign_in_required: [
      ['Sign in to Codex', '请先登录 Codex'],
      ['Run codex login on the host, then check again.', '请在宿主电脑运行 codex login，再重新检查。']
    ],
    model_replied: [['The AI service replied', 'AI 服务已回应']],
    api_key_rejected: [
      ['The service rejected the key', '服务拒绝了此密钥'],
      [
        'Go back to AI service and enter a key authorized for this model.',
        '请返回 AI 服务步骤，输入有权使用此模型的密钥。'
      ]
    ],
    api_key_required: [
      ['An API key is needed', '需要 API 密钥'],
      ['Enter a key from the provider’s API keys page.', '请输入来自服务商 API 密钥页面的密钥。']
    ],
    model_reply_invalid: [
      ['The model returned an unsupported reply', '模型返回的内容不符合要求'],
      [
        'Check the model ID and connection format with your provider.',
        '请核对服务商提供的模型 ID 和连接格式。'
      ]
    ],
    connection_failed: [
      ['The selected AI service could not be used', '未能使用所选 AI 服务'],
      ['Check the service address, model and key, then try again.', '请核对地址、模型和密钥，再重试。']
    ],
    preview_not_connected: [
      ['Live connection skipped in preview', '预览中跳过实际连接检查'],
      ['You can save these choices to the preview workspace.', '可以将当前选择保存到预览工作区。']
    ]
  }
  if (Object.hasOwn(known, c.code)) {
    const [title, hint] = known[c.code]
    return [L(...title), hint ? L(...hint) : '']
  }
  return [
    L('Host check', '宿主检查') + ' · ' + (c.id || c.code),
    c.status === 'required' ? L('Review the detail before retrying.', '请查看详情后重试。') : ''
  ]
}
