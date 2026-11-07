// Each local request has its own discussion. Retries reuse its original event to avoid duplicate work.
let inbox = { source: '', text: '', requests: [], timer: 0, reading: false, readError: false, remaining: 0 }
function resetInbox(source = '') {
  clearTimeout(inbox.timer)
  inbox = { source, text: '', requests: [], timer: 0, reading: false, readError: false, remaining: 0 }
}
function sampleText() {
  return L(
    'Reply with “Ready”. Do not use tools, read files or change anything.',
    '请只回复“准备好了”。请勿使用工具、读取文件或更改任何内容。'
  )
}
function savedGuideFields() {
  const saved = guide.saved,
    preview = isGuidePreview() || saved.preview === true,
    ready = saved.ready === true && !!saved.sourceId
  if (inbox.source !== saved.sourceId) resetInbox(saved.sourceId)
  const title = preview
    ? L('Saved to the preview workspace', '已保存到预览工作区')
    : saved.paused
      ? L('Setup saved · host paused', '设置已保存 · 宿主已暂停')
      : ready
        ? L('Your browser inbox is ready', '浏览器任务入口已就绪')
        : L('Setup saved · verification needed', '设置已保存 · 尚需验证')
  const summary = add(
    el('div', 'inbox-saved'),
    add(el('p', 'inline'), icon('check'), el('strong', '', title)),
    detail(
      L('Setup details', '查看设置'),
      rows(
        datum(L('Work folder', '工作文件夹'), saved.workspace ?? notReported(), true),
        datum(L('AI service', 'AI 服务'), guideConnectionLabel(saved.connection)),
        Number.isInteger(saved.revision) ? datum(L('Saved revision', '保存版本'), saved.revision) : null
      )
    )
  )
  summary.id = 'guide-result'
  summary.tabIndex = -1
  const controls = [summary]
  if (preview)
    controls.push(
      el(
        'p',
        'alert warning',
        L(
          'Sending is disabled in this preview. Open a running AgentHub to send a request.',
          '预览环境不发送任务。请打开实际运行的 AgentHub 来交代任务。'
        )
      )
    )
  else if (saved.paused)
    controls.push(
      el(
        'p',
        'alert warning',
        L(
          'AgentHub is paused. Resume new work in the operations console to send requests.',
          'AgentHub 已暂停接收任务。请先在操作台恢复接收任务。'
        )
      ),
      action(
        L('Refresh host state', '刷新宿主状态'),
        () =>
          guideRun('load', async () => {
            await runtimeStatus()
            if (typeof S.status?.paused === 'boolean') saved.paused = S.status.paused
          }),
        'text-action',
        'refresh'
      )
    )
  else if (!ready)
    controls.push(
      el(
        'p',
        'alert warning',
        L(
          'This saved setup needs a working AI connection. Run setup again to check the service before sending.',
          '此设置尚需可用的 AI 连接。请重新运行设置并检查服务，再发送任务。'
        )
      )
    )
  const clientRouter = S.base?.config.execution?.router?.mode === 'client'
  if (clientRouter) controls.push(el('p', 'alert warning', L('Continue in your connected CLI Router. Ask it to delegate using worker_manage.', '请在已接入的 CLI Router 中继续对话，让它通过 worker_manage 委派任务。')))
  controls.push(requestComposer(!ready || preview || saved.paused || clientRouter))
  const history = el('section', 'inbox-history')
  history.id = 'inbox-history'
  drawHistory(history)
  controls.push(history)
  if (saved.channel === 'feishu' || saved.channel === 'wecom') {
    const feishu = saved.channel === 'feishu',
      name = feishu ? L('Feishu', '飞书') : L('WeCom', '企业微信')
    controls.push(
      detail(
        L('Connect ' + name + ' later', '稍后接入' + name),
        el(
          'p',
          'hint',
          feishu
            ? L(
                'Ask the Feishu app owner for a published bot with message access and the chat ID. Its connection is a separate setup step.',
                '请向飞书应用负责人获取已发布且具有消息权限的机器人及会话 ID。机器人连接需要另行配置。'
              )
            : L(
                'Ask a WeCom administrator for a smart bot in API mode, its Bot ID and secret. Its connection is a separate setup step.',
                '请向企业微信管理员获取 API 模式的智能机器人、Bot ID 与 Secret。机器人连接需要另行配置。'
              )
        )
      )
    )
  }
  const consoleLink = el('a', 'text-action', L('Operations console', '操作台'))
  consoleLink.href = '/'
  controls.push(
    add(
      el('div', 'actions'),
      action(
        L('Set up another connection', '配置其他连接'),
        () => {
          if (
            inbox.text.trim() &&
            !confirm(
              L('Leave this unsent request and start a new setup?', '放弃未发送的内容，开始新的设置？')
            )
          )
            return
          resetGuideSession()
          guideStep(0)
          if (S.authed) guideRun('load', loadGuideContext)
        },
        'text-action'
      ),
      consoleLink
    )
  )
  return controls
}
function requestComposer(disabled) {
  const form = el('form', 'inbox-compose'),
    label = el('label', 'field-label', L('What would you like your assistant to do?', '你想让助手做什么？'))
  const input = el('textarea')
  input.id = 'task-message'
  input.rows = 3
  input.maxLength = 100000
  input.placeholder = L(
    'For example, list the files in my work folder.',
    '例如，列出我的工作文件夹中的文件。'
  )
  input.value = inbox.text
  input.disabled = disabled
  label.htmlFor = input.id
  const send = action(L('Send request', '发送任务'), null, 'btn primary', 'arrow')
  send.type = 'submit'
  send.disabled = disabled || !inbox.text.trim()
  input.oninput = () => {
    inbox.text = input.value
    send.disabled = disabled || !inbox.text.trim()
  }
  form.onsubmit = (e) => {
    e.preventDefault()
    if (!disabled && inbox.text.trim()) sendRequest(inbox.text.trim(), true)
  }
  const hints = el('div', 'inbox-examples')
  for (const [name, text] of [
    [
      L('List files', '查看文件列表'),
      L(
        'List the files in my work folder. Do not change any files.',
        '请列出工作文件夹中的文件，不要修改任何文件。'
      )
    ],
    [
      L('Explore capabilities', '了解能做什么'),
      L(
        'What can you help me do in this work folder? Give two examples.',
        '在这个工作文件夹中，你能帮我做什么？请举两个例子。'
      )
    ]
  ]) {
    const example = action(
      name,
      () => {
        inbox.text = text
        input.value = text
        send.disabled = false
        input.focus()
      },
      'text-action'
    )
    example.disabled = disabled
    hints.append(example)
  }
  const note = el(
    'small',
    'hint',
    L(
      'Each request starts a new task using your selected AI service. API providers may charge for use.',
      '每次发送都会用所选 AI 服务创建一条独立任务。API 服务商可能按用量计费。'
    )
  )
  add(form, label, input, hints, note, add(el('div', 'actions'), send))
  if (!disabled) {
    form.append(
      detail(
        L('Optional connection test', '可选的连接测试'),
        add(
          el('div', 'guide-help'),
          el('p', 'hint', sampleText()),
          action(L('Send test request', '发送测试请求'), () => sendRequest(sampleText(), false), 'btn')
        )
      )
    )
  }
  return form
}
const inboxStages = {
  sending: ['Sending…', '正在发送…'],
  uncertain: ['Delivery unconfirmed', '发送结果未确认'],
  rejected: ['Request rejected', '请求被拒绝'],
  received: ['Understanding your request…', '正在理解你的请求…'],
  queued: ['Waiting to start…', '已排队，等待处理…'],
  working: ['In progress', '处理中'],
  person: ['Needs your attention', '需要你处理'],
  blocked: ['Blocked', '任务受阻'],
  failed: ['Failed', '任务失败'],
  idle: ['Waiting for the next step', '等待下一步'],
  completed: ['Completed', '已完成'],
  ended: ['Ended', '已结束'],
  stopped: ['Stopped', '已停止'],
  dropped: ['Dropped', '已终止'],
  filtered: ['Filtered by intake rules', '被准入规则过滤'],
  ignore: ['Not accepted as a task', '未被接收为任务'],
  unavailable: ['Could not evaluate the request', '未能判断此请求'],
  paused: ['Host paused', '宿主已暂停']
}
function drawHistory(node = document.getElementById('inbox-history')) {
  if (!node) return
  node.replaceChildren()
  if (!inbox.requests.length && !inbox.readError) return
  node.append(
    add(
      el('div', 'inbox-history-head'),
      el('h3', '', L('Recent requests', '最近任务')),
      action(L('Refresh', '刷新'), () => monitorInbox(true, true), 'text-action', 'refresh')
    )
  )
  if (inbox.readError)
    node.append(
      el(
        'p',
        'alert warning',
        L('Progress is unavailable. Refresh to read it again.', '暂时无法读取进度，请点击刷新。')
      )
    )
  for (const item of inbox.requests) {
    const stage = L(...inboxStages[item.stage]),
      row = el('article', 'inbox-request')
    row.append(
      add(
        el('div', 'inbox-request-head'),
        el('strong', '', item.text),
        badge(stage, ['failed', 'blocked', 'rejected', 'unavailable'].includes(item.stage) ? 'issue' : '')
      )
    )
    if (item.reply) row.append(el('pre', 'inbox-reply', item.reply))
    if (item.stage === 'uncertain' || item.stage === 'rejected')
      row.append(
        add(
          el('div', 'actions'),
          action(L('Retry the same request', '重试同一任务'), () => deliverRequest(item), 'btn')
        )
      )
    node.append(row)
  }
}
function inboxCanSend() {
  return S.base?.config.execution?.router?.mode !== 'client' && S.authed && guide.saved?.ready && !guide.saved.paused && !guide.saved.preview && !isGuidePreview()
}
async function sendRequest(text, fromComposer) {
  if (!inboxCanSend() || guide.busy) return
  const id = crypto.randomUUID(),
    item = {
      event: { id, thread: 'setup-' + id, text, addressed: true },
      text,
      stage: 'sending',
      done: false
    }
  inbox.requests.unshift(item)
  // Keep unconfirmed and running records even when a burst of requests arrives.
  inbox.requests = inbox.requests.filter((r, i) => i < 12 || !r.done)
  if (fromComposer) inbox.text = ''
  await deliverRequest(item)
}
async function deliverRequest(item) {
  if (!inboxCanSend() || guide.busy || item.receipt) return
  const session = inbox
  await guideRun('send', async () => {
    item.stage = 'sending'
    try {
      const receipt = await api('/send', { source: session.source, event: item.event })
      if (!receipt.triggerId) throw Error('Missing request receipt')
      item.receipt = receipt
      item.stage = ['ignored', 'filtered'].includes(receipt.disposition) ? 'filtered' : 'received'
      item.done = item.stage === 'filtered'
    } catch (e) {
      item.stage = e.status >= 400 && e.status < 500 ? 'rejected' : 'uncertain'
      throw e
    }
  })
  if (inbox === session && item.receipt) {
    announce(L(...inboxStages[item.stage]))
    await monitorInbox(true)
  }
}
function updateRequest(item, status) {
  const id = item.receipt?.triggerId
  if (!id) return
  const decision = status.decisions?.find((d) => d.triggerIds?.includes(id)),
    task = status.tickets?.find(
      (t) => t.origin?.triggerId === id || t.origin?.triggerIds?.includes(id) || t.id === decision?.ticketId
    )
  if (task) {
    const delivery = status.deliveries
      ?.filter((d) => d.ticketId === task.id && d.kind === 'reply' && d.status === 'sent')
      .at(-1)
    const report = task.assignments?.at(-1)?.report,
      stage = task.stage?.stage,
      outcome = task.ended?.outcome
    item.reply = delivery?.text || task.attention?.question || report?.summary || task.ended?.reason || ''
    if (outcome === 'completed') item.stage = 'completed'
    else if (['failed', 'blocked'].includes(report?.state)) item.stage = report.state
    else if (outcome) item.stage = ['stopped', 'dropped'].includes(outcome) ? outcome : 'ended'
    else if (stage === 'person') item.stage = 'person'
    else if (task.stage?.action === 'queued') item.stage = 'queued'
    else item.stage = stage === 'idle' ? 'idle' : 'working'
    item.done = !!outcome || ['failed', 'blocked'].includes(item.stage)
  } else if (['ignore', 'unavailable', 'stop'].includes(decision?.kind)) {
    item.stage = decision.kind === 'stop' ? 'ended' : decision.kind
    item.done = true
  } else if (!item.done) item.stage = status.paused ? 'paused' : 'received'
}
async function monitorInbox(restart = false, restore = false) {
  const session = inbox
  if (!session.source || !S.authed) return
  if (restart) session.remaining = 60
  if (session.reading) return
  let redraw = session.readError
  clearTimeout(session.timer)
  session.reading = true
  try {
    const status = await api('/status')
    if (session !== inbox) return
    if (restore) {
      redraw = true
      const events = (status.events || [])
        .filter((e) => e.source === session.source && e.threads?.some((t) => t.id?.startsWith('setup-')))
        .sort((a, b) => String(b.at).localeCompare(String(a.at)))
        .slice(0, 12)
      for (const e of events) {
        if (!session.requests.some((i) => i.receipt?.triggerId === e.id))
          session.requests.push({
            text: e.text,
            receipt: { triggerId: e.id },
            stage: 'received',
            done: false
          })
      }
    }
    for (const item of session.requests) {
      const previousStage = item.stage,
        previousReply = item.reply
      updateRequest(item, status)
      if (previousStage !== item.stage || previousReply !== item.reply) redraw = true
      if (!restore && previousStage !== item.stage && item.done)
        announce(L(...inboxStages[item.stage]) + ' · ' + item.text.slice(0, 45))
    }
    session.readError = false
  } catch (e) {
    if (session !== inbox) return
    redraw = !session.readError
    session.readError = true
    if (e.status === 401) {
      errorMessage(e)
      render()
    }
  } finally {
    session.reading = false
  }
  if (session === inbox && S.surface === 'guide' && guide.step === 3) {
    if (redraw) drawHistory()
    if (session.remaining-- > 0 && !session.readError && session.requests.some((i) => i.receipt && !i.done))
      session.timer = setTimeout(() => monitorInbox(), 2000)
  }
}
