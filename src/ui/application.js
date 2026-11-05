function noticeView() {
  const box = el('div')
  box.id = 'notice'
  if (!S.notice && !S.busy) {
    box.hidden = true
    return box
  }
  if (S.busy) {
    const labels = {
      connect: ['Connecting to host…', '正在连接宿主…'],
      save: ['Saving changes…', '正在保存…'],
      refresh: ['Refreshing host status…', '正在刷新宿主状态…'],
      setup: ['Running setup checks…', '正在检查环境…'],
      prompts: ['Loading prompt catalog…', '正在读取提示词目录…'],
      preview: ['Generating prompt preview…', '正在生成提示词预览…']
    }
    const status = el('p', 'alert', L(...labels[S.busy]))
    status.setAttribute('role', 'status')
    return add(box, status)
  }
  const n = S.notice,
    row = add(el('div', 'alert ' + n.level), el('p', '', L(n.en, n.zh)))
  row.setAttribute('role', n.level === 'error' ? 'alert' : 'status')
  if (n.details) row.append(detail(L('Technical details', '技术详情'), raw(n.details)))
  return add(box, row)
}
function led(ok, done = true) {
  return el('span', 'led ' + (done ? (ok ? 'ok' : 'bad') : 'wait'))
}
function updateBar() {
  const bar = document.getElementById('savebar')
  if (!bar) return
  const count = changed().length,
    show = S.authed && dirty(),
    was = bar.hidden
  bar.hidden = !show
  if (!show) return
  const msg = S.errors.size
    ? L('Check field · ', '请修正字段 · ') + S.errors.keys().next().value
    : S.latest
      ? L('Revision conflict', '版本冲突')
      : L('Unsaved changes', '有未保存的更改')
  const discard = action(L('Discard', '放弃更改'), discardDraft),
    saveButton = action(
      S.latest
        ? L('Review conflict', '核对冲突')
        : S.busy === 'save'
          ? L('Saving…', '保存中…')
          : L('Save changes', '保存更改'),
      S.latest ? revealRecovery : save,
      'btn primary',
      'check'
    )
  discard.disabled = !!S.busy
  saveButton.disabled = !!S.busy || (!S.latest && (!count || S.errors.size > 0))
  bar.replaceChildren(
    add(
      el('div', 'bar-inner'),
      add(el('span', 'status-label'), el('span', 'led wait'), el('strong', '', msg)),
      add(el('div', 'feedback'), discard, saveButton)
    )
  )
  if (was) {
    bar.classList.remove('reveal')
    bar.classList.add('reveal')
    announce(msg)
  }
}
function languagePicker() {
  const language = el('select', 'lang')
  language.id = 'language'
  language.setAttribute('aria-label', L('Language', '界面语言'))
  language.add(new Option('English', 'en'))
  language.add(new Option('简体中文', 'zh-CN'))
  language.value = lang
  language.onchange = () => {
    lang = language.value
    try {
      localStorage.setItem('agenthub.configuration.language', lang)
    } catch {}
    render()
  }
  return language
}
function render(focusTitle = false) {
  const focused = document.activeElement,
    focusId = focused?.id,
    start = focused?.selectionStart,
    end = focused?.selectionEnd
  if (S.surface === 'guide') {
    renderGuide()
    restorePageFocus(focusTitle, focusId, start, end)
    return
  }
  if (S.surface === 'entries') {
    renderEntrySurface()
    restorePageFocus(focusTitle, focusId, start, end)
    return
  }
  const section = sections.find((s) => s[0] === S.page) || sections[0],
    name = L(section[1], section[2])
  document.documentElement.lang = lang
  document.title = name + ' · AgentHub'
  const skip = el('a', 'skip', L('Skip to content', '跳至主要内容'))
  skip.href = '#main'
  const brand = add(
    el('div', 'brand'),
    add(el('span', 'brand-mark'), icon('brand')),
    el('span', '', 'AgentHub')
  )
  const nav = el('nav')
  nav.setAttribute('aria-label', L('Configuration sections', '配置分区'))
  for (const s of sections) {
    if (['overview', 'execution', 'advanced'].includes(s[0]))
      nav.append(
        el(
          'p',
          'nav-label',
          s[0] === 'overview'
            ? L('Workspace', '工作区')
            : s[0] === 'execution'
              ? L('Configuration', '配置')
              : L('Maintenance', '维护')
        )
      )
    const b = action('', () => go(s[0]), 'nav-item')
    b.id = 'nav-' + s[0]
    b.replaceChildren(icon(s[0]), el('span', '', L(s[1], s[2])))
    if (s[0] === S.page) b.setAttribute('aria-current', 'page')
    nav.append(b)
  }
  const foot = add(
    el('div', 'rail-bottom'),
    led(S.health?.ok, S.healthDone),
    el(
      'span',
      '',
      !S.healthDone
        ? L('Checking host…', '检查宿主中…')
        : S.health?.ok
          ? L('Host reachable', '宿主可达')
          : L('Host unavailable', '宿主不可达')
    ),
    S.health?.version ? el('span', 'mono', 'v' + S.health.version) : null
  )
  const rail = add(el('aside', 'rail'), brand, nav, foot)
  const language = languagePicker()
  const home = add(el('a', 'text-action'), el('span', '', L('Tasks', '任务')), icon('out'))
  home.href = '/configure'
  const head = add(
    el('header', 'topbar'),
    add(
      el('div', 'crumb'),
      el('span', '', 'AgentHub'),
      icon('forward'),
      el('strong', '', L('Advanced settings', '高级设置'))
    ),
    add(
      el('div', 'tools'),
      action(L('Connections & attention', '入口与待处理'), () => entryNavigate('home'), 'text-action'),
      add(el('label', 'inline'), icon('lang'), language),
      home
    )
  )
  const mobile = el('select')
  mobile.id = 'section-nav'
  mobile.setAttribute('aria-label', L('Configuration sections', '配置分区'))
  for (const s of sections) mobile.add(new Option(L(s[1], s[2]), s[0]))
  mobile.value = S.page
  mobile.onchange = () => go(mobile.value)
  const title = el('h1', '', name)
  title.id = 'page-title'
  title.tabIndex = -1
  const preview =
    S.snap?.metadata?.preview === true ||
    S.snap?.preview === true ||
    S.health?.metadata?.preview === true ||
    S.health?.preview === true
  const heading = add(
    el('div', 'heading'),
    add(el('div'), title),
    preview ? badge(L('Preview workspace', '预览工作区'), 'preview') : null
  )
  const editor = el('fieldset', 'editor')
  editor.disabled = !!S.busy || !!(S.latest && !S.errors.size && S.authed)
  const sectionFns = {
    overview,
    execution: renderExecution,
    sources: renderSources,
    policy: renderPolicy,
    work: renderWork,
    delivery: renderDelivery,
    prompts: renderPrompts,
    advanced: renderAdvanced
  }
  if (!S.authed && S.page !== 'overview') editor.append(accessPanel())
  else editor.append(...sectionFns[S.page]())
  const content = add(
    el('div', 'page-body'),
    noticeView(),
    S.authed && S.latest ? conflictPanel() : null,
    S.statusError && S.authed
      ? el(
          'div',
          'alert warning',
          L(
            'Runtime status could not be loaded. Refresh status in Overview to retry.',
            '运行状态读取失败，请到概览刷新状态。'
          )
        )
      : null,
    editor
  )
  const main = add(el('main'), heading, content)
  main.id = 'main'
  main.tabIndex = -1
  const bar = el('div', 'savebar')
  bar.id = 'savebar'
  bar.hidden = document.getElementById('savebar')?.hidden ?? true
  const body = add(
    el('div', 'workspace'),
    head,
    add(el('div', 'section-nav'), icon(S.page), mobile),
    main,
    bar
  )
  const layout = add(el('div'), rail, body)
  layout.id = 'layout'
  app.replaceChildren(skip, layout)
  updateBar()
  restorePageFocus(focusTitle, focusId, start, end)
}
function restorePageFocus(focusTitle, focusId, start, end) {
  if (focusTitle) {
    document.getElementById('page-title')?.focus({ preventScroll: true })
    window.scrollTo(0, 0)
  } else if (focusId) {
    const input = document.getElementById(focusId)
    if (input) {
      input.focus({ preventScroll: true })
      if (input.setSelectionRange && start != null)
        try {
          input.setSelectionRange(start, end)
        } catch {}
    }
  }
}
function go(k) {
  if (S.page === k) return
  S.page = k
  render(true)
}
class ApiError extends Error {
  constructor(status, payload) {
    super(typeof payload?.error === 'string' ? payload.error : 'HTTP ' + status)
    this.status = status
    this.payload = payload
  }
}
async function api(path, body, publicRead = false) {
  const headers = {}
  if (!publicRead && S.token) headers.authorization = 'Bearer ' + S.token
  if (body !== undefined) headers['content-type'] = 'application/json'
  const res = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    body: body === undefined ? undefined : JSON.stringify(body),
    headers,
    cache: 'no-store',
    redirect: 'error',
    credentials: 'same-origin',
    signal: AbortSignal.timeout(
      ['/setup-check', '/onboarding/check', '/onboarding/apply', '/entry-setup/probe', '/entry-setup/apply', '/entry-setup/install', '/entry-setup/model/check', '/entry-setup/model/apply'].includes(path) ? 120000 : 30000
    )
  })
  const payload = await res.json().catch(() => null)
  if (!res.ok || !payload) throw new ApiError(res.status, payload)
  return payload
}
async function health() {
  try {
    S.health = await api('/health', undefined, true)
  } catch {
    S.health = null
  }
  S.healthDone = true
}
async function snapshot() {
  let data
  try {
    data = await api('/configuration')
  } catch (e) {
    if (e.status !== 404) throw e
    data = await api('/settings')
  }
  if (!Number.isInteger(data.current?.revision) || !data.current?.config || !Array.isArray(data.history))
    throw Error('Invalid settings response')
  return data
}
async function runtimeStatus() {
  try {
    const { paused, sources, setup } = await api('/status')
    S.status = { paused, sources, setup }
    S.statusError = false
  } catch (e) {
    if (e.status === 401) throw e
    S.status = null
    S.statusError = true
  }
}
function adopt(snap) {
  if (S.base && dirty() && snap.current.revision !== S.base.revision) {
    S.latest = snap
    return
  }
  S.snap = snap
  if (!S.base || !dirty()) {
    S.base = snap.current
    S.draft = clone(S.base.config)
    S.buffers.clear()
    S.errors.clear()
  }
  S.latest = null
}
function errorMessage(e) {
  if (e.status === 401) {
    S.token = ''
    S.typed = ''
    S.authed = false
    setNotice(
      'error',
      'Access denied. Enter a valid host token to continue.',
      '访问被拒绝。请输入有效的宿主令牌。'
    )
    return
  }
  if (e.payload?.code === 'restart_required') {
    setNotice(
      'error',
      'This change requires editing the startup configuration and restarting the host.',
      '此修改需要编辑启动配置并重启宿主。',
      e.message
    )
    return
  }
  if (e.status === 400) {
    const issues = e.payload?.issues
    setNotice(
      'error',
      'The host rejected these settings. Review the details, then edit your draft.',
      '宿主拒绝了这些设置。请查看详情并修正草稿。',
      Array.isArray(issues)
        ? issues
            .map((i) =>
              [Array.isArray(i.path) ? i.path.join('.') : i.path, i.message].filter(Boolean).join(' — ')
            )
            .join('\n')
        : e.message
    )
    return
  }
  setNotice(
    'error',
    'Request failed. Check the host connection and retry.',
    '请求失败。请检查宿主连接后重试。',
    e.message
  )
}
function revealRecovery() {
  const target = document.querySelector('.conflict h2') || document.querySelector('#notice [role="alert"]')
  if (!target) return
  target.tabIndex = -1
  target.focus({ preventScroll: true })
  target.scrollIntoView({ block: 'start' })
}
async function run(label, fn) {
  if (S.busy) return
  S.busy = label
  S.notice = null
  render()
  try {
    await fn()
  } catch (e) {
    errorMessage(e)
  } finally {
    S.busy = ''
    render()
    if (S.latest || (label === 'save' && S.notice?.level === 'error')) revealRecovery()
  }
}
async function connectHost(credential = S.typed, cookieSession = false) {
  if (!credential.trim() && !cookieSession) return
  await run('connect', async () => {
    S.token = credential.trim()
    S.typed = ''
    if (S.token && !cookieSession) {
      const link = new URL((await api('/operator-link', {})).url)
      if (link.origin !== location.origin || link.pathname !== '/configure')
        throw Error('Invalid local operator session link')
      const code = new URLSearchParams(link.hash.slice(1)).get('pair')
      if (!code) throw Error('Missing local operator pairing code')
      await api('/pair', { code }, true)
      S.token = ''
    }
    const [snap] = await Promise.all([snapshot(), runtimeStatus(), loadGuideContext(), health()])
    adopt(snap)
    S.authed = true
    await readEntries()
    if (!S.latest) announce(L('Connected to the host.', '已连接到宿主。'))
  })
}
async function refreshStatus() {
  await run('refresh', async () => {
    await health()
    if (S.authed) {
      adopt(await snapshot())
      await runtimeStatus()
    }
    if (!S.health?.ok) throw Error('Health endpoint unavailable')
    setNotice('success', 'Host status refreshed.', '宿主状态已刷新。')
  })
}
function resetDraft(base) {
  S.base = base
  S.draft = clone(base.config)
  S.latest = null
  S.errors.clear()
  S.buffers.clear()
  S.preview = null
}
function discardDraft() {
  if (!confirm(L('Discard all unsaved changes?', '放弃所有未保存的更改？'))) return
  if (S.latest) S.snap = S.latest
  resetDraft(S.snap.current)
  setNotice('success', 'Draft discarded.', '已放弃草稿。')
  render()
}
function disconnect() {
  if (dirty() && !confirm(L('Disconnect and discard this draft?', '断开连接并放弃当前草稿？'))) return
  Object.assign(S, {
    authed: false,
    token: '',
    typed: '',
    base: null,
    draft: null,
    snap: null,
    latest: null,
    status: null,
    statusError: false,
    preview: null,
    promptIndex: null,
    promptError: false,
    notice: null,
    page: 'overview'
  })
  S.buffers.clear()
  S.errors.clear()
  resetGuideSession()
  render(true)
}
async function save() {
  if (!S.authed || S.errors.size || S.latest) return
  await run('save', async () => {
    const patch = Object.fromEntries(changed().map((k) => [k, S.draft[k]]))
    if (!Object.keys(patch).length) return
    let version
    try {
      version = await api('/settings', { revision: S.base.revision, patch })
    } catch (e) {
      if (
        e.status === 409 ||
        e.payload?.code === 'settings_conflict' ||
        (e.status === 400 && /conflict/i.test(e.message))
      ) {
        S.latest = await snapshot()
        setNotice(
          'warning',
          'A newer revision exists. Your draft is still here.',
          '已有较新的版本。你的草稿仍然保留。'
        )
        return
      }
      throw e
    }
    if (!Number.isInteger(version.revision) || !version.config) throw Error('Invalid save receipt')
    const history = [...S.snap.history.filter((v) => v.revision !== version.revision), version]
    S.snap = { ...S.snap, current: version, history }
    resetDraft(version)
    setNotice(
      'success',
      'Saved revision ' + version.revision + '.',
      '已保存版本 ' + version.revision + '。'
    )
  })
}
function plain(x) {
  return x !== null && typeof x === 'object' && !Array.isArray(x)
}
function mergeValue(base, mine, theirs, path, collisions, preferMine) {
  if (same(mine, base)) return clone(theirs)
  if (same(theirs, base) || same(mine, theirs)) return clone(mine)
  if (plain(base) && plain(mine) && plain(theirs))
    return Object.fromEntries(
      [...new Set([...Object.keys(base), ...Object.keys(mine), ...Object.keys(theirs)])]
        .map((k) => [k, mergeValue(base[k], mine[k], theirs[k], path + '.' + k, collisions, preferMine)])
        .filter(([, v]) => v !== undefined)
    )
  collisions.push({ path, mine, theirs })
  return clone(preferMine ? mine : theirs)
}
function mergeDraft(preferMine) {
  const remote = S.latest.current.config,
    merged = clone(remote),
    conflicts = []
  for (const k of changed()) {
    if (k === 'sources') {
      merged.sources = remote.sources.map((src) => {
        const old = S.base.config.sources.find((s) => s.id === src.id),
          mine = S.draft.sources.find((s) => s.id === src.id),
          result = clone(src)
        if (old && mine)
          for (const key of permittedSource()) {
            const value = mergeValue(
              old[key],
              mine[key],
              src[key],
              'sources.' + src.id + '.' + key,
              conflicts,
              preferMine
            )
            if (value === undefined) delete result[key]
            else result[key] = value
          }
        return result
      })
    } else merged[k] = mergeValue(S.base.config[k], S.draft[k], remote[k], k, conflicts, preferMine)
  }
  return { merged, conflicts }
}
function conflictPanel() {
  const { conflicts } = mergeDraft(false),
    box = add(
      el('section', 'panel conflict'),
      el('h2', '', L('Review newer revision', '核对较新版本')),
      el('p', '', revision(S.base.revision) + ' → ' + revision(S.latest.current.revision))
    )
  const apply = (preferMine) => {
    const { merged } = mergeDraft(preferMine)
    const latest = S.latest
    S.snap = latest
    resetDraft(latest.current)
    S.draft = merged
    setNotice(
      'success',
      'Draft updated to the latest revision. Review it before saving.',
      '草稿已基于最新版本更新。请核对后保存。'
    )
    render()
  }
  if (conflicts.length) {
    box.append(
      el(
        'p',
        'hint',
        L(
          'Both sessions edited these values. Choose which conflicting values to keep. Independent edits are merged.',
          '两个会话修改了以下值。请选择保留哪一方的冲突值；独立修改会自动合并。'
        )
      )
    )
    for (const c of conflicts)
      box.append(
        detail(
          c.path,
          add(
            el('div', 'stack'),
            el('h3', '', L('Your draft', '你的草稿')),
            raw(c.mine ?? null),
            el('h3', '', L('Host revision', '宿主版本')),
            raw(c.theirs ?? null)
          )
        )
      )
  } else
    box.append(
      el(
        'p',
        'hint',
        L(
          'The changes do not overlap. Rebase the draft before saving.',
          '修改没有重叠。请先更新草稿基准，再保存。'
        )
      )
    )
  if (S.errors.size) {
    box.append(
      el('p', 'alert warning', L('Fix invalid fields before rebasing.', '请先修正无效字段，再合并草稿。'))
    )
    return box
  }
  box.append(
    add(
      el('div', 'actions'),
      action(
        conflicts.length
          ? L('Keep my conflicting values', '保留我的冲突值')
          : L('Rebase draft', '更新草稿基准'),
        () => apply(true),
        'btn primary'
      ),
      conflicts.length ? action(L('Use host values', '使用宿主冲突值'), () => apply(false)) : null
    )
  )
  return box
}
function restore(version) {
  if (
    !confirm(
      L(
        'Load editable settings from revision ' +
          version.revision +
          ' into the draft? This replaces current edits.',
        '将版本 ' + version.revision + ' 的可编辑设置载入草稿？当前草稿会被替换。'
      )
    )
  )
    return
  const restored = clone(S.base.config)
  for (const k of keys()) {
    if (k === 'sources')
      restored.sources = withSourceValues(
        restored.sources,
        projectSources(version.config.sources || []),
        false
      )
    else if (Object.hasOwn(version.config, k)) restored[k] = clone(version.config[k])
    else if (k === 'model' && Object.hasOwn(restored, k)) restored.model = ''
  }
  S.draft = restored
  S.buffers.clear()
  S.errors.clear()
  S.preview = null
  setNotice(
    'success',
    'Revision ' + version.revision + ' loaded into the draft.',
    '版本 ' + version.revision + ' 已载入草稿。'
  )
  render()
}
async function runSetup() {
  await run('setup', async () => {
    const result = await api('/setup-check', {})
    S.status = { ...S.status, setup: result }
    setNotice('success', 'Setup check completed.', '环境检查已完成。')
  })
}
async function loadPrompts() {
  await run('prompts', async () => {
    try {
      S.promptIndex = await api('/prompts')
      S.promptError = false
    } catch (e) {
      S.promptError = true
      throw e
    }
  })
}
async function previewPrompt() {
  if ([...S.errors.keys()].some((p) => p === 'prompts' || p.startsWith('prompts.'))) {
    setNotice('error', 'Correct the prompt JSON before previewing.', '请在生成预览前修正提示词 JSON。')
    render()
    return
  }
  await run('preview', async () => {
    S.preview = await api('/prompt-preview', { role: S.previewRole, prompts: S.draft.prompts })
    setNotice('success', 'Prompt preview generated from this draft.', '已基于当前草稿生成提示词预览。')
  })
}
window.addEventListener('beforeunload', (e) => {
  if (dirty() || guideHasDraft() || entryHasDraft() || controlHasDraft()) {
    e.preventDefault()
    e.returnValue = ''
  }
})
render()
health().then(() => render())
void startEntrySession()
