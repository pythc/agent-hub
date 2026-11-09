icons.play = 'm8 5 11 7-11 7V5z'
// Configuration stays in the revisioned workspace draft; probes never save it.
const decisionView = { busy: false, pending: null, result: null, advanced: false, sample: 'Please pause the task I asked you to run.' }
const decisionModes = () => [['off', L('Off', '关闭')], ['shadow', L('Record only', '仅记录')], ['advisory', L('Advise Router', '提供建议')]]
function decisionWrite(path, value) {
  clearRelated('decision.' + path)
  set(S.draft, 'decision.' + path, value)
  decisionView.result = null
  updateBar()
  decisionRefreshProbe()
}
function decisionMatches(value) {
  return value?.epoch === workspaceContext.epoch && value.fingerprint === JSON.stringify(S.draft.decision) && value.sample === decisionView.sample
}
function decisionRefreshProbe() {
  const button = document.getElementById('decision-test')
  if (button) {
    button.disabled = decisionView.busy || !S.draft.decision?.provider || S.errors.size > 0 || !decisionView.sample.trim() || !!S.snap?.preview
    button.replaceChildren(icon(decisionView.busy ? 'activity' : 'play'), document.createTextNode(decisionView.busy ? L('Testing…', '正在测试…') : L('Run test', '运行测试')))
  }
  const result = document.getElementById('decision-test-result')
  if (!result) return
  result.replaceChildren()
  result.classList.remove('has-result', 'has-error')
  const pending = decisionView.busy && decisionMatches(decisionView.pending)
  result.setAttribute('aria-busy', String(pending))
  if (pending) { result.append(el('p', 'decision-result-empty', L('Waiting for the model…', '等待模型返回…'))); return }
  const value = decisionMatches(decisionView.result) ? decisionView.result : null
  if (!value) { result.append(el('p', 'decision-result-empty', L('The model’s decision will appear here.', '模型的判断结果会显示在这里。'))); return }
  const response = value.response
  if (!response || response.status !== 'ok') {
    const reasons = {
      timeout: L('The model timed out. Try again or increase the timeout in Advanced settings.', '模型响应超时，请重试或在高级设置中增加超时时间。'),
      request_failed: L('Could not reach the model. Check the API address and credentials, then retry.', '无法连接模型，请检查 API 地址和凭据后重试。'),
      capacity: L('All decision calls are busy. Try again shortly.', '决策调用已满，请稍后重试。')
    }
    result.classList.add('has-error')
    result.append(el('strong', '', L('Test unavailable', '测试不可用')), el('p', '', value.error || reasons[response.code] || response.code))
    return
  }
  const labels = { STOP: L('Stop', '停止'), CONTINUE: L('Continue', '续接'), IGNORE: L('Ignore', '忽略'), INTERVENE: L('Intervene', '介入'), REVIEW: L('Review', '复核') }
  result.classList.add('has-result')
  const outcomes = add(el('div', 'decision-outcomes'), ...response.decisions.map(d => add(el('div', 'decision-outcome'),
    el('strong', '', labels[d.action] || d.action), el('span', '', d.action))))
  const metrics = el('dl', 'decision-metrics')
  for (const [label, value] of [[L('Latency', '耗时'), response.latencyMs + ' ms'], [L('Input tokens', '输入 tokens'), response.usage?.inputTokens ?? '—'], [L('Output tokens', '输出 tokens'), response.usage?.outputTokens ?? '—']])
    metrics.append(add(el('div'), el('dt', '', label), el('dd', '', value)))
  result.append(outcomes, metrics)
}
async function decisionProbe() {
  if (decisionView.busy || S.errors.size || !decisionView.sample.trim() || !S.draft.decision?.provider || S.snap?.preview) return
  const context = { epoch: workspaceContext.epoch, fingerprint: JSON.stringify(S.draft.decision), sample: decisionView.sample }
  const show = data => {
    if (!decisionMatches(context) || S.errors.size) return
    decisionView.result = { ...context, ...data }
  }
  if (S.draft.decision.provider.kind === 'backend' && !same(S.base.config.backends, S.draft.backends)) {
    show({ error: L('Save model connection changes before testing a shared connection.', '请先保存模型连接更改，再测试复用连接。') })
    decisionRefreshProbe(); return
  }
  decisionView.busy = true; decisionView.pending = context; decisionView.result = null; decisionRefreshProbe()
  try { show({ response: await api('/decision/probe', { config: clone(S.draft.decision), text: context.sample }) }) }
  catch (error) { show({ error: error.message }) }
  finally { decisionView.busy = false; decisionView.pending = null; decisionRefreshProbe() }
}
function decisionSettings() {
  const config = S.draft.decision || (S.draft.decision = { mode: 'off' }), provider = config.provider
  const root = el('section', 'decision-settings'); root.id = 'decision-settings'; root.setAttribute('aria-labelledby', 'decision-title')
  const heading = el('h2', '', L('Decision layer', '决策层')); heading.id = 'decision-title'
  const saved = decisionModes().find(([mode]) => mode === (S.base.config.decision?.mode || 'off'))?.[1]
  root.append(add(el('div', 'decision-heading'), add(el('div'), heading, el('p', '', L('A lightweight model to help Router read intent.', '用轻量模型辅助 Router 判断消息意图。'))), el('span', 'decision-saved-mode', L('Saved: ', '已保存：') + saved)))
  const body = el('div', 'decision-body'), settings = el('div', 'decision-config')
  const fields = el('div', 'team-fields')
  const services = Object.entries(S.draft.backends || {}).filter(([, value]) => !['codex', 'plugin'].includes(value.kind) && !value.subscription)
  const type = provider?.kind === 'backend' ? 'backend:' + provider.id : provider?.kind || ''
  const choices = [['', L('Choose a connection', '选择模型连接')], ...services.map(([id, value]) => ['backend:' + id, L('Use ', '使用 ') + (value.label || id)]),
    ['jev', 'Jev · TypeSafe'], ['openai-chat', L('OpenAI Chat / local model', 'OpenAI Chat / 本地模型')], ['openai-responses', 'OpenAI Responses'], ['anthropic', 'Anthropic Messages']]
  fields.append(teamField('decision-provider', L('Connection', '模型连接'), type, value => {
    clearRelated('decision.provider')
    decisionWrite('provider', value.startsWith('backend:') ? { kind: 'backend', id: value.slice(8) } : !value ? undefined : value === 'jev'
      ? { kind: 'jev', baseUrl: 'https://api.typesafe.ai/v1', model: 'jev-latest', apiKeyEnv: 'TYPESAFE_API_KEY' }
      : { kind: value, baseUrl: value === 'anthropic' ? 'https://api.anthropic.com/v1' : 'http://127.0.0.1:8080/v1', model: '', parameters: {}, outputFormat: 'json-schema', chatTokenField: 'max_tokens' })
    const nextKind = value.startsWith('backend:') ? S.draft.backends[value.slice(8)]?.kind : value
    if (['jev', 'anthropic'].includes(nextKind)) decisionWrite('effort', undefined)
    if (nextKind === 'jev') decisionWrite('parameters', {})
    render(); document.getElementById('decision-provider')?.focus({ preventScroll: true })
  }, { values: choices }))
  if (provider && provider.kind !== 'backend') {
    for (const [key, label] of [['baseUrl', L('API base URL', 'API 地址')], ['model', L('Model', '模型')], ['apiKeyEnv', L('API key environment variable', 'API 密钥环境变量')]])
      fields.append(teamField('decision-' + key, label, provider[key] || '', value => decisionWrite('provider.' + key, value || undefined)))
  }
  settings.append(fields)
  const mode = el('fieldset', 'decision-mode'), legend = el('legend', '', L('Behavior', '工作方式'))
  mode.id = 'decision-mode'; const modes = el('div', 'decision-mode-options'), hint = el('p', 'decision-mode-hint')
  const describe = () => { hint.textContent = ({ off: L('Router handles messages directly.', '由 Router 直接处理消息。'), shadow: L('Record decisions without advising Router.', '记录判断结果，不影响 Router。'), advisory: L('Offer intent signals. Router decides what to do.', '提供意图建议，最终操作由 Router 决定。') })[S.draft.decision.mode || 'off'] }
  describe()
  for (const [value, label] of decisionModes()) {
    const input = el('input'); input.type = 'radio'; input.name = 'decision-mode'; input.value = value; input.id = 'decision-mode-' + value; input.checked = (config.mode || 'off') === value
    input.onchange = () => { decisionWrite('mode', value); describe() }
    modes.append(add(el('label'), input, el('span', '', label)))
  }
  mode.append(legend, modes, hint); settings.append(mode)
  const advanced = el('details', 'decision-advanced'); advanced.open = decisionView.advanced
  advanced.ontoggle = () => { if (advanced.isConnected) decisionView.advanced = advanced.open }
  const advancedSummary = el('summary', '', L('Advanced settings', '高级设置'))
  advancedSummary.onclick = () => { decisionView.advanced = !advanced.open }
  advanced.append(advancedSummary)
  const limits = el('div', 'decision-limits team-fields')
  for (const [key, label, fallback, min, max] of [
    ['timeoutMs', L('Timeout (ms)', '超时（毫秒）'), 3000, 100, 10000], ['maxOutputTokens', L('Output token limit', '输出 token 上限'), 512, 64, 4096],
    ['maxInputChars', L('Input character limit', '输入字符上限'), 16000, 1000, 64000], ['maxConcurrent', L('Concurrent calls', '并发调用'), 2, 1, 8]
  ]) {
    // Defaults are placeholders until edited; rendering must not change a saved draft.
    const field = inputField('decision.' + key, label, { type: 'num', min, max, placeholder: String(fallback) })
    limits.append(field)
  }
  const extra = el('div', 'team-fields')
  extra.append(limits, inputField('decision.instructions', L('Additional instructions', '补充指令'), { type: 'area' }))
  const kind = provider?.kind === 'backend' ? S.draft.backends[provider.id]?.kind : provider?.kind
  if (kind && kind !== 'jev') {
    if (kind !== 'anthropic') extra.append(teamField('decision-effort', L('Reasoning effort', '思考强度'), config.effort || '', value => decisionWrite('effort', value || undefined), {
      values: [['', L('Provider default', '服务默认')], ['none', L('Off', '关闭思考')], ...['minimal', 'low', 'medium', 'high', 'xhigh'].map(v => [v, v])]
    }))
    extra.append(jsonField('decision.parameters', L('Provider parameters (JSON)', '服务参数（JSON）'), { objectType: 'object' }))
  }
  if (provider) extra.append(jsonField('decision.provider', L('Connection details (JSON)', '连接详情（JSON）'), { objectType: 'object' }))
  advanced.append(extra); settings.append(advanced)
  const test = el('div', 'decision-test-pane'), testHeading = el('h3', '', L('Try a message', '试一条消息'))
  const sample = el('textarea'); sample.id = 'decision-sample'; sample.rows = 4; sample.maxLength = 4000; sample.value = decisionView.sample
  sample.setAttribute('aria-label', L('Test message', '测试消息')); sample.oninput = () => { decisionView.sample = sample.value }
  const examples = el('div', 'decision-examples'); examples.setAttribute('aria-label', L('Example messages', '示例消息'))
  for (const [en, zh, enText, zhText] of [
    ['Stop', '停止', 'Please pause the task I asked you to run.', '请暂停我刚才让你执行的任务。'],
    ['Continue', '续接', 'Please continue the previous task.', '请继续刚才的任务。'],
    ['Negation', '否定', 'Do not stop. Keep working on the task.', '不要停，继续执行这个任务。'],
    ['Quotation', '引用', 'The document says “stop the task”. I am quoting it, not asking you to stop.', '文档里写着“停止任务”。我是在引用内容，不是让你停止。']
  ]) examples.append(opButton(L(en, zh), () => { decisionView.sample = sample.value = L(enText, zhText); decisionView.result = null; decisionRefreshProbe() }, 'button'))
  const button = opButton(L('Run test', '运行测试'), decisionProbe, 'button primary', 'play'); button.id = 'decision-test'
  const result = el('div', 'decision-result'); result.id = 'decision-test-result'; result.setAttribute('role', 'status'); result.setAttribute('aria-live', 'polite')
  test.append(testHeading, sample, examples, add(el('div', 'decision-test-actions'), el('span', '', L('Uses the current draft', '使用当前草稿')), button), result)
  body.append(settings, test); root.append(body)
  const records = S.snap?.decisionCalls || []
  if (records.length) {
    const recent = detail(L('Recent calls', '最近调用'), workspaceTable([L('Time', '时间'), L('Mode', '模式'), L('Result', '结果'), L('Latency', '耗时'), 'Tokens (in / out)'], records.slice(0, 10).map(r => [
      el('span', '', when(r.at)), el('span', '', decisionModes().find(([mode]) => mode === r.mode)?.[1] || r.mode), el('span', '', r.code || r.decisions?.map(d => d.action).join(', ') || r.status), el('span', '', r.latencyMs + ' ms'), el('span', '', (r.usage?.inputTokens ?? '—') + ' / ' + (r.usage?.outputTokens ?? '—'))
    ])))
    recent.classList.add('decision-history'); root.append(recent)
  }
  const invalidate = () => { decisionView.result = null; decisionRefreshProbe() }
  root.addEventListener('input', invalidate); root.addEventListener('change', invalidate)
  // The configuration adapter attaches this tree synchronously after construction.
  queueMicrotask(decisionRefreshProbe)
  return root
}
