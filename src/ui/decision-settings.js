const decisionView = { busy: false, result: null, sample: 'Please pause the task I asked you to run.' }
function decisionWrite(path, value) {
  clearRelated('decision.' + path)
  set(S.draft, 'decision.' + path, value)
  decisionView.result = null
  document.getElementById('decision-test-result')?.replaceChildren()
  updateBar()
}
function decisionSettings() {
  const config = S.draft.decision || (S.draft.decision = { mode: 'off' })
  const provider = config.provider
  const root = el('section', 'connection-editor'); root.id = 'decision-settings'
  root.append(el('h2', '', L('Decision layer', '决策层')),
    el('p', '', L('Classifies intent for Router. Router still verifies context and controls work.', '为 Router 判断消息意图，任务仍由 Router 核实上下文后管控。')))
  const fields = el('div', 'team-fields')
  fields.append(teamField('decision-mode', L('Mode', '模式'), config.mode || 'off', value => { decisionWrite('mode', value); render() }, {
    values: [['off', L('Off', '关闭')], ['shadow', L('Record only', '仅记录')], ['advisory', L('Advise Router', '提供建议')]]
  }))
  const services = Object.entries(S.draft.backends || {}).filter(([, value]) => value.kind !== 'codex' && !value.subscription)
  const type = provider?.kind === 'backend' ? 'backend:' + provider.id : provider?.kind || ''
  const choices = [['', L('Choose a provider', '选择服务')], ...services.map(([id, value]) => ['backend:' + id, L('Reuse: ', '复用：') + (value.label || id)]),
    ['jev', 'Jev · TypeSafe'], ['openai-chat', L('OpenAI Chat / local model', 'OpenAI Chat / 本地模型')], ['openai-responses', 'OpenAI Responses'], ['anthropic', 'Anthropic Messages']]
  fields.append(teamField('decision-provider', L('Provider', '服务'), type, value => {
    clearRelated('decision')
    decisionWrite('provider', value.startsWith('backend:') ? { kind: 'backend', id: value.slice(8) } : !value ? undefined : value === 'jev'
      ? { kind: 'jev', baseUrl: 'https://api.typesafe.ai/v1', model: 'jev-latest', apiKeyEnv: 'TYPESAFE_API_KEY' }
      : { kind: value, baseUrl: value === 'anthropic' ? 'https://api.anthropic.com/v1' : 'http://127.0.0.1:8080/v1', model: '', parameters: {}, outputFormat: 'json-schema', chatTokenField: 'max_tokens' })
    if (value === 'jev') { decisionWrite('effort', undefined); decisionWrite('parameters', {}) }
    render()
  }, { values: choices }))
  if (provider && provider.kind !== 'backend') {
    for (const [key, label] of [['baseUrl', L('API base URL', 'API 地址')], ['model', L('Model', '模型')], ['apiKeyEnv', L('API key environment variable', 'API 密钥环境变量')]])
      fields.append(teamField('decision-' + key, label, provider[key] || '', value => decisionWrite('provider.' + key, value || undefined)))
  }
  root.append(fields)
  const advanced = el('details'); advanced.append(el('summary', '', L('Advanced', '高级设置')))
  const limits = el('div', 'team-fields')
  for (const [key, label, fallback, min, max] of [
    ['timeoutMs', L('Timeout (ms)', '超时（毫秒）'), 3000, 100, 10000], ['maxOutputTokens', L('Output token limit', '输出 token 上限'), 512, 64, 4096],
    ['maxInputChars', L('Input character limit', '输入字符上限'), 16000, 1000, 64000], ['maxConcurrent', L('Concurrent calls', '并发调用'), 2, 1, 8]
  ]) {
    const field = teamField('decision-' + key, label, config[key] ?? fallback, value => {
      const n = Number(value), path = 'decision.' + key
      if (!value || !Number.isInteger(n) || n < min || n > max) S.errors.set(path, ['Enter a valid whole number', '请输入范围内的整数'])
      else { S.errors.delete(path); set(S.draft, path, n) }
      field.querySelector('input').setAttribute('aria-invalid', String(S.errors.has(path))); updateBar()
    }, { number: true, min, max })
    limits.append(field)
  }
  advanced.append(limits, inputField('decision.instructions', L('Additional instructions', '补充指令'), { type: 'area' }))
  const kind = provider?.kind === 'backend' ? S.draft.backends[provider.id]?.kind : provider?.kind
  if (kind && kind !== 'jev') {
    if (kind !== 'anthropic') advanced.append(teamField('decision-effort', L('Reasoning effort', '思考强度'), config.effort || '', value => decisionWrite('effort', value || undefined), {
      values: [['', L('Provider default', '服务默认')], ['none', L('Off', '关闭思考')], ...['minimal', 'low', 'medium', 'high', 'xhigh'].map(v => [v, v])]
    }))
    advanced.append(jsonField('decision.parameters', L('Provider parameters (JSON)', '服务参数（JSON）'), { objectType: 'object' }))
  }
  if (provider) advanced.append(jsonField('decision.provider', L('Connection details (JSON)', '连接详情（JSON）'), { objectType: 'object' }))
  root.append(advanced)
  const test = el('div', 'stack'), result = el('div'); result.id = 'decision-test-result'; result.setAttribute('role', 'status')
  test.append(teamField('decision-sample', L('Test message', '测试消息'), decisionView.sample, value => { decisionView.sample = value }))
  const button = opButton(decisionView.busy ? L('Testing…', '正在测试…') : L('Test current draft', '测试当前草稿'), async () => {
    if (decisionView.busy || S.errors.size) return
    if (S.draft.decision?.provider?.kind === 'backend' && !same(S.base.config.backends, S.draft.backends)) {
      result.textContent = L('Save model connection changes before testing a shared connection.', '请先保存模型连接更改，再测试复用连接。'); return
    }
    decisionView.busy = true; button.disabled = true
    const epoch = workspaceContext.epoch, fingerprint = JSON.stringify(S.draft.decision)
    try {
      const response = await api('/decision/probe', { config: clone(S.draft.decision), text: decisionView.sample })
      if (epoch !== workspaceContext.epoch || fingerprint !== JSON.stringify(S.draft.decision)) return
      decisionView.result = response
      result.textContent = response.status === 'ok' ? response.decisions.map(d => d.action).join(', ') + ' · ' + response.latencyMs + ' ms' : L('Unavailable: ', '不可用：') + response.code
    } catch (error) { if (epoch === workspaceContext.epoch) result.textContent = error.message }
    finally { decisionView.busy = false; button.disabled = !S.draft.decision?.provider }
  }, 'button')
  button.disabled = decisionView.busy || !provider || S.errors.size > 0 || !!S.snap?.preview
  test.append(button, result); root.append(test)
  const records = S.snap?.decisionCalls || []
  if (records.length) root.append(detail(L('Recent calls', '最近调用'), workspaceTable([L('Time', '时间'), L('Mode', '模式'), L('Result', '结果'), L('Latency', '耗时'), 'Tokens (in / out)'], records.slice(0,10).map(r => [
    el('span','',when(r.at)), el('span','',r.mode), el('span','',r.code || r.decisions?.map(d=>d.action).join(', ') || r.status), el('span','',r.latencyMs+' ms'), el('span','',(r.usage?.inputTokens ?? '—')+' / '+(r.usage?.outputTokens ?? '—'))
  ]))))
  return root
}
