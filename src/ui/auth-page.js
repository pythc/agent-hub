const app = document.getElementById('account-app')
let language = 'en'
try {
  language = localStorage.getItem('agenthub.configuration.language') === 'zh' ? 'zh' : 'en'
} catch {}
const T = (en, zh) => (language === 'zh' ? zh : en)
const state = {
  view: 'loading',
  status: null,
  busy: false,
  error: '',
  success: '',
  recoveryCode: '',
  draft: { remember: true },
  saved: false,
  formStep: 0,
  diagramPaused: false
}
const paths = {
  arrow: 'M5 12h14m-6-6 6 6-6 6',
  back: 'M19 12H5m6-6-6 6 6 6',
  sun: 'M12 3v2m0 14v2M3 12h2m14 0h2M5.6 5.6 1.4 1.4m10 10 1.4 1.4M5.6 18.4 1.4-1.4m10-10 1.4-1.4M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
  moon: 'M20.7 13.3A9 9 0 0 1 10.7 3.3a9 9 0 1 0 10 10Z',
  eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Zm13 0a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
  hide: 'm3 3 18 18M10 5.2A12 12 0 0 1 12 5c6.4 0 10 7 10 7a18 18 0 0 1-3.3 4.2M6.5 6.5A20 20 0 0 0 2 12s3.6 7 10 7c1.6 0 3.1-.4 4.4-1.1M10 10a3 3 0 0 0 4 4',
  lock: 'M6 10h12v11H6V10Zm2 0V7a4 4 0 0 1 8 0v3m-4 5v2',
  user: 'M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM5 21v-2a7 7 0 0 1 14 0v2',
  worker: 'M7 7h10v10H7V7Zm3-4v4m4-4v4M3 10h4m-4 4h4m3 3v4m4-4v4m3-11h4m-4 4h4',
  copy: 'M9 9h12v12H9V9ZM5 15H3V3h12v2',
  download: 'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5',
  check: 'm5 12 4 4L19 6',
  pause: 'M9 5v14M15 5v14',
  play: 'm8 5 11 7-11 7V5Z'
}
function node(tag, cls = '', text = '') {
  const n = document.createElement(tag)
  if (cls) n.className = cls
  if (text) n.textContent = text
  return n
}
function icon(name) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  s.setAttribute('viewBox', '0 0 24 24')
  s.setAttribute('fill', 'none')
  s.setAttribute('stroke', 'currentColor')
  s.setAttribute('stroke-width', '1.5')
  s.setAttribute('stroke-linecap', 'round')
  s.setAttribute('stroke-linejoin', 'round')
  s.setAttribute('aria-hidden', 'true')
  const p = document.createElementNS(s.namespaceURI, 'path')
  p.setAttribute('d', paths[name] || paths.lock)
  s.append(p)
  return s
}
function button(label, fn, cls = 'text-button', glyph) {
  const b = node('button', cls, label)
  b.type = 'button'
  if (glyph) b.append(icon(glyph))
  b.addEventListener('click', fn)
  return b
}
function brand() {
  const b = node('div', 'brand')
  const mark = node('span', 'roppo-mark')
  mark.setAttribute('aria-hidden', 'true')
  b.append(mark, node('span', '', 'Roppo'))
  return b
}
function store(key, value) {
  try {
    localStorage.setItem(key, value)
  } catch {}
}
function themeControl() {
  const dark = document.documentElement.dataset.theme === 'dark',
    label = T(
      dark ? 'Switch to light mode' : 'Switch to dark mode',
      dark ? '切换白色模式' : '切换黑暗模式'
    )
  const b = button(
    '',
    () => {
      document.documentElement.dataset.theme = dark ? 'light' : 'dark'
      store('agenthub.configuration.theme', dark ? 'light' : 'dark')
      b.replaceWith(themeControl())
    },
    'icon-button',
    dark ? 'sun' : 'moon'
  )
  b.setAttribute('aria-label', label)
  b.title = label
  return b
}
function tools() {
  const t = node('div', 'auth-tools')
  t.append(
    themeControl(),
    button(
      T('中文', 'EN'),
      () => {
        language = language === 'en' ? 'zh' : 'en'
        store('agenthub.configuration.language', language)
        render()
      },
      'language-button'
    )
  )
  return t
}
window.addEventListener('storage', (event) => {
  if (event.key === 'agenthub.configuration.theme') {
    document.documentElement.dataset.theme = event.newValue === 'dark' ? 'dark' : 'light'
    document.querySelector('.auth-tools .icon-button')?.replaceWith(themeControl())
  }
})
const errors = () => ({
  account_credentials_invalid: T(
    'The username or password is incorrect. Try again.',
    '用户名或密码不正确，请重试。'
  ),
  account_recovery_invalid: T(
    'The username or recovery code is incorrect.',
    '用户名或恢复码不正确。'
  ),
  account_rate_limited: T(
    'Too many attempts. Wait 15 minutes before trying again.',
    '尝试次数过多，请等待 15 分钟后重试。'
  ),
  account_busy: T(
    'Another sign-in is being checked. Try again shortly.',
    '正在处理其他登录请求，请稍后重试。'
  ),
  account_exists: T(
    'This workspace already has an owner. Sign in to continue.',
    '这个工作区已经有账号，请登录。'
  ),
  account_setup_link_required: T(
    'Run your Roppo launch command again to continue creating your account.',
    '请重新运行 Roppo 启动命令，继续创建账号。'
  ),
  account_setup_required: T(
    'Launch Roppo to create your account first.',
    '请先启动 Roppo 并创建账号。'
  ),
  account_login_required: T('Your session has ended. Sign in again.', '登录已过期，请重新登录。'),
  account_changed: T(
    'The account changed in another session. Sign in again.',
    '账号已在其他会话中变更，请重新登录。'
  ),
  pair_expired: T(
    'This setup session expired. Run your Roppo launch command again.',
    '本次设置已过期，请重新运行 Roppo 启动命令。'
  ),
  same_origin_required: T(
    'Open this page directly from the local Roppo address.',
    '请直接通过 Roppo 的本机地址打开此页面。'
  ),
  validation_error: T(
    'Check the fields. Passwords need 12–128 characters.',
    '请检查填写内容，密码需要 12–128 个字符。'
  )
})
async function api(path, body) {
  const response = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
    cache: 'no-store',
    redirect: 'error',
    signal: AbortSignal.timeout(30000)
  })
  const data = await response.json()
  if (!response.ok) {
    const usernameIssue =
      data.code === 'validation_error' &&
      data.issues?.some((issue) => issue.path?.[0] === 'username')
    throw Object.assign(
      new Error(
        usernameIssue
          ? usernameGuidance()
          : errors()[data.code] ||
            T('The action could not finish. Try again.', '操作未完成，请重试。')
      ),
      { code: data.code, status: response.status }
    )
  }
  return data
}
function showNotice(text, success = false) {
  state.error = success ? '' : text
  state.success = success ? text : ''
  const n = document.getElementById('form-notice')
  if (n) {
    n.textContent = text
    n.classList.toggle('success', success)
    n.setAttribute('role', success ? 'status' : 'alert')
    if (text) {
      n.focus({ preventScroll: true })
      n.scrollIntoView({ block: 'nearest', behavior: 'instant' })
    }
  }
}
function notice() {
  const n = node('div', 'notice' + (state.success ? ' success' : ''), state.error || state.success)
  n.id = 'form-notice'
  n.tabIndex = -1
  n.setAttribute('role', state.success ? 'status' : 'alert')
  return n
}
function go(view) {
  if (state.busy) return
  state.view = view
  state.formStep = 0
  state.error = ''
  state.success = ''
  state.draft = { remember: true, username: state.draft.username || '' }
  render(true)
}
function workspace() {
  state.recoveryCode = ''
  if (location.pathname === '/chat') { location.reload(); return }
  try {
    localStorage.setItem('agenthub.entry.role', 'operator')
  } catch {}
  let hash = ''
  try {
    hash = sessionStorage.getItem('roppo.return.hash') || ''
    sessionStorage.removeItem('roppo.return.hash')
  } catch {}
  const configurationPath = /^\/configure\/?$/.test(location.pathname)
  const destination = '/configure' + (configurationPath ? location.search : '') +
    (hash.startsWith('#') && !/^#(pair|invite)=/.test(hash) ? hash : '')
  // A hash-only navigation keeps the sign-in document alive even after the cookie is valid.
  if (configurationPath) {
    history.replaceState(null, '', destination)
    location.reload()
  } else location.replace(destination)
}
async function action(form, fn) {
  if (state.busy) return
  state.busy = true
  showNotice('')
  const submits = [...form.querySelectorAll('button[type=submit]')],
    labels = submits.map((b) => b.textContent)
  const controls = [
    ...form.querySelectorAll('input,button'),
    ...document.querySelectorAll('.language-button')
  ].filter((c) => !c.disabled)
  controls.forEach((c) => (c.disabled = true))
  form.setAttribute('aria-busy', 'true')
  submits.forEach((b) => {
    b.disabled = true
    b.textContent = T('Working…', '正在处理…')
  })
  try {
    await fn()
  } catch (error) {
    showNotice(
      error.code
        ? error.message
        : T(
            'Could not reach Roppo. Check that it is running, then retry.',
            '无法连接 Roppo。请确认它正在运行后重试。'
          )
    )
    if (['account_login_required', 'account_changed'].includes(error.code)) {
      state.view = 'login'
      state.draft = { remember: true }
      render(true)
    } else if (error.code === 'account_exists') {
      state.view = 'login'
      state.draft = { remember: true }
      render(true)
    }
  } finally {
    state.busy = false
    controls.forEach((c) => (c.disabled = false))
    form.removeAttribute('aria-busy')
    submits.forEach((b, i) => {
      b.disabled = false
      b.textContent = labels[i]
    })
    syncAuthViewport()
  }
}
function heading(title, description) {
  const f = node('div')
  const h = node('h1', 'form-title', title)
  h.tabIndex = -1
  f.append(h)
  if (description) f.append(node('p', 'form-description', description))
  return f
}
function usernameGuidance() {
  return T(
    'Use 3–40 letters, numbers, periods, underscores or hyphens. Start with a letter or number.',
    '用户名需为 3–40 位字母、数字、点、下划线或连字符，并以字母或数字开头。'
  )
}
function field(form, name, label, options = {}) {
  const group = node('div', 'auth-field'),
    l = node('label', 'auth-label', label),
    wrap = node('div', 'input-wrap'),
    input = node('input', 'auth-input' + (options.password ? ' password-input' : ''))
  input.id = 'field-' + name
  input.name = name
  input.type = options.password ? 'password' : 'text'
  input.required = true
  input.maxLength = options.max || 128
  if (name === 'username' || name === 'recoveryCode') {
    input.autocapitalize = 'none'
    input.spellcheck = false
  }
  if (options.min) input.minLength = options.min
  if (options.pattern) input.pattern = options.pattern
  if (options.pattern)
    input.addEventListener('invalid', () => {
      if (input.validity.patternMismatch) input.setCustomValidity(usernameGuidance())
    })
  input.autocomplete = options.autocomplete || 'off'
  if (options.placeholder) input.placeholder = options.placeholder
  input.value = state.draft[name] ?? options.value ?? ''
  if (options.readOnly) {
    input.readOnly = true
    input.required = false
  }
  l.htmlFor = input.id
  wrap.append(input)
  if (options.password) {
    const reveal = button(
      '',
      () => {
        const visible = input.type === 'password'
        input.type = visible ? 'text' : 'password'
        reveal.replaceChildren(icon(visible ? 'hide' : 'eye'))
        reveal.setAttribute(
          'aria-label',
          T(visible ? 'Hide password' : 'Show password', visible ? '隐藏密码' : '显示密码')
        )
        reveal.setAttribute('aria-pressed', String(visible))
      },
      'reveal-password',
      'eye'
    )
    reveal.setAttribute('aria-label', T('Show password', '显示密码'))
    reveal.setAttribute('aria-pressed', 'false')
    wrap.append(reveal)
  }
  group.append(l, wrap)
  if (options.hint) {
    const hint = node('p', 'field-hint', options.hint)
    hint.id = input.id + '-hint'
    input.setAttribute('aria-describedby', hint.id)
    group.append(hint)
  }
  input.addEventListener('input', () => {
    state.draft[name] = input.value
    input.removeAttribute('aria-invalid')
    input.setCustomValidity('')
  })
  form.append(group)
  return input
}
function passwordFields(form) {
  field(form, 'password', T('Password', '密码'), {
    password: true,
    min: 12,
    max: 128,
    autocomplete: 'new-password',
    placeholder: T('12–128 characters', '12–128 个字符')
  })
  field(form, 'confirmPassword', T('Confirm password', '确认密码'), {
    password: true,
    min: 12,
    max: 128,
    autocomplete: 'new-password'
  })
}
function capture(form) {
  for (const input of form.querySelectorAll('input[name]'))
    state.draft[input.name] = input.type === 'checkbox' ? input.checked : input.value
}
function confirmPassword(form) {
  capture(form)
  if (state.draft.password !== state.draft.confirmPassword) {
    const input = form.elements.namedItem('confirmPassword')
    input.setAttribute('aria-invalid', 'true')
    showNotice(
      T(
        'The passwords do not match. Enter the same password twice.',
        '两次密码不一致，请重新确认。'
      )
    )
    input.focus()
    return false
  }
  return true
}
function remember() {
  const l = node('label', 'check-label'),
    c = node('input')
  c.type = 'checkbox'
  c.name = 'remember'
  c.checked = state.draft.remember !== false
  c.addEventListener('change', () => (state.draft.remember = c.checked))
  l.append(c, document.createTextNode(T('Remember me for 30 days', '记住登录 30 天')))
  return l
}
function submit(form, label) {
  const b = button(label, () => {}, 'primary-button')
  b.type = 'submit'
  form.append(b)
  return b
}
function credentials() {
  return {
    username: state.draft.username.trim(),
    password: state.draft.password,
    remember: state.draft.remember !== false
  }
}
function recoveryResult(result) {
  state.recoveryUsername = state.draft.username || state.status?.user?.username || ''
  state.recoveryCode = result.recoveryCode
  state.draft = { remember: true }
  state.saved = false
  state.view = 'recovery-code'
  state.error = ''
  state.success = ''
  render(true)
}
function renderAuth(content) {
  if (state.view === 'loading') {
    content.append(heading(T('Opening your workspace…', '正在打开工作区…')))
    return
  }
  if (state.view === 'unavailable') {
    content.append(
      heading(
        T('Roppo is unavailable', '无法连接 Roppo'),
        T(
          'Check that your local host is running, then try again.',
          '请确认本机宿主正在运行，然后重试。'
        )
      ),
      notice(),
      button(T('Try again', '重试'), () => void initialize(), 'primary-button')
    )
    return
  }
  if (state.view === 'setup-link') {
    content.append(
      heading(
        T('Open Roppo to get started.', '启动 Roppo，开始设置。'),
        T(
          'Run your Roppo launch command. Account setup opens automatically.',
          '运行本机的 Roppo 启动命令，账号创建页会自动打开。'
        )
      ),
      notice()
    )
    content.append(
      button(T('Check again', '重新检查'), () => void initialize(), 'secondary-button')
    )
    return
  }
  if (state.view === 'recovery-code') {
    content.append(
      heading(
        T('Keep a way back in.', '保存你的恢复码。'),
        T(
          'This code can reset your password. Store it somewhere private; it is only shown now.',
          '恢复码可以重置密码。请妥善保存，它只会在此刻显示。'
        )
      ),
      notice()
    )
    const code = node('div', 'recovery-code', state.recoveryCode)
    code.setAttribute('aria-label', T('Recovery code', '恢复码'))
    content.append(code)
    const actions = node('div', 'recovery-actions')
    actions.append(
      button(
        T('Copy', '复制'),
        async () => {
          try {
            await navigator.clipboard.writeText(state.recoveryCode)
            showNotice(T('Recovery code copied.', '恢复码已复制。'), true)
          } catch {
            showNotice(
              T(
                'Copy is unavailable. Select the code and copy it manually.',
                '无法自动复制，请选中恢复码手动复制。'
              )
            )
          }
        },
        'secondary-button',
        'copy'
      ),
      button(
        T('Download', '下载'),
        () => {
          const blob = new Blob(
              [
                'Roppo recovery code\n' +
                  location.origin +
                  '\nUsername: ' +
                  state.recoveryUsername +
                  '\n\n' +
                  state.recoveryCode +
                  '\n\nKeep this private. It can reset your local account password.\n'
              ],
              { type: 'text/plain;charset=utf-8' }
            ),
            url = URL.createObjectURL(blob),
            a = node('a')
          a.href = url
          a.download = 'roppo-recovery-code.txt'
          a.click()
          setTimeout(() => URL.revokeObjectURL(url), 1000)
        },
        'secondary-button',
        'download'
      )
    )
    content.append(actions)
    const l = node('label', 'check-label recovery-check'),
      c = node('input')
    c.type = 'checkbox'
    c.checked = state.saved
    const next = button(
      T('Enter workspace', '进入工作区'),
      workspace,
      'primary-button recovery-continue',
      'arrow'
    )
    next.disabled = !state.saved
    c.addEventListener('change', () => {
      state.saved = c.checked
      next.disabled = !c.checked
    })
    l.append(c, document.createTextNode(T('I saved my recovery code', '我已妥善保存恢复码')))
    content.append(l, next)
    return
  }
  const setup = state.view === 'setup',
    recover = state.view === 'recover'
  content.append(
    heading(
      setup
        ? T('Create your account.', '创建你的账号。')
        : recover
          ? T('Recover your account.', '找回你的账号。')
          : T('Welcome back.', '欢迎回来。')
    ),
    notice()
  )
  const f = node('form', 'auth-form')
  f.method = 'post'
  if (setup || recover) {
    f.dataset.stepped = 'true'
    f.noValidate = true
  }
  f.action = '/account/' + (setup ? 'setup' : recover ? 'recover' : 'login')
  if (setup)
    field(f, 'displayName', T('Your name', '你的称呼'), { max: 60, autocomplete: 'nickname' })
  field(f, 'username', T('Username', '用户名'), {
    max: 40,
    min: setup ? 3 : 1,
    autocomplete: 'username',
    ...(setup
      ? {
          pattern: /[a-zA-Z0-9][a-zA-Z0-9._\-]*/.source,
          placeholder: T('3–40 letters, numbers, . _ -', '3–40 位字母、数字、. _ -')
        }
      : {})
  })
  if (recover)
    field(f, 'recoveryCode', T('Recovery code', '恢复码'), { max: 100, autocomplete: 'off' })
  if (setup || recover) passwordFields(f)
  else
    field(f, 'password', T('Password', '密码'), {
      password: true,
      autocomplete: 'current-password'
    })
  const row = node('div', 'form-row')
  row.append(remember())
  if (!setup && !recover)
    row.append(button(T('Forgot password?', '忘记密码？'), () => go('recover')))
  f.append(row)
  const submitButton = submit(
    f,
    setup
      ? T('Create account', '创建账号')
      : recover
        ? T('Reset password', '重置密码')
        : T('Sign in', '登录')
  )
  if (setup || recover) {
    for (const group of f.querySelectorAll('.auth-field'))
      group.dataset.step = ['password', 'confirmPassword'].includes(
        group.querySelector('input').name
      )
        ? '1'
        : '0'
    row.dataset.step = '1'
    submitButton.dataset.finalLabel = submitButton.textContent
    const actions = node('div', 'auth-actions')
    const back = button(
      T('Back', '上一步'),
      () => {
        capture(f)
        setFormStep(f, 0, true)
      },
      'secondary-button back-step'
    )
    actions.append(back, submitButton)
    f.append(actions)
  }
  f.addEventListener('submit', (event) => {
    event.preventDefault()
    capture(f)
    if (setup || recover) {
      const compact = f.classList.contains('compact-form')
      const inputs = [...f.querySelectorAll('input[required]')].filter(
        (input) =>
          !compact || state.formStep === 1 || input.closest('[data-step]').dataset.step === '0'
      )
      const invalid = inputs.find((input) => !input.checkValidity())
      if (invalid) {
        if (compact) setFormStep(f, Number(invalid.closest('[data-step]').dataset.step))
        invalid.reportValidity()
        return
      }
      if (compact && state.formStep === 0) {
        setFormStep(f, 1, true)
        return
      }
    }
    if ((setup || recover) && !confirmPassword(f)) return
    void action(f, async () => {
      const result = await api(f.getAttribute('action'), {
        ...credentials(),
        ...(setup ? { displayName: state.draft.displayName.trim() } : {}),
        ...(recover ? { recoveryCode: state.draft.recoveryCode.trim() } : {})
      })
      if (setup || recover) recoveryResult(result)
      else {
        state.draft = { remember: true }
        workspace()
      }
    })
  })
  content.append(f)
  if (recover)
    content.append(
      node(
        'p',
        'recovery-warning',
        T(
          'Resetting your password signs out all other sessions and replaces your recovery code.',
          '重置密码会退出其他所有会话，并生成新的恢复码。'
        )
      ),
      button(T('Back to sign in', '返回登录'), () => go('login'), 'text-button back-button')
    )
}
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)')
let renderedView = '',
  enteredAuth = false
function animateForm(target) {
  if (reducedMotion.matches || !target?.animate) return
  target.getAnimations().forEach((animation) => animation.cancel())
  target.animate(
    [
      { opacity: 0.45, transform: 'translateY(8px)' },
      { opacity: 1, transform: 'translateY(0)' }
    ],
    { duration: 300, easing: 'cubic-bezier(.16,1,.3,1)' }
  )
}
function setFormStep(form, step, focus = false) {
  state.formStep = step
  syncAuthViewport()
  if (focus) {
    form.querySelector('.auth-field:not([hidden]) input')?.focus({ preventScroll: true })
    animateForm(form)
  }
}
function syncAuthViewport() {
  const root = document.documentElement
  const viewport = window.visualViewport
  const height = viewport && viewport.scale === 1 ? viewport.height : innerHeight
  root.style.setProperty('--auth-height', height + 'px')
  const form = document.querySelector('.auth-shell form[data-stepped]')
  if (!form) return
  const compact = form.closest('.auth-stage').clientHeight < 760
  if (compact && !form.classList.contains('compact-form')) {
    const active = document.activeElement?.closest('.auth-field[data-step]')
    if (active && form.contains(active)) state.formStep = Number(active.dataset.step)
  }
  form.classList.toggle('compact-form', compact)
  for (const group of form.querySelectorAll('[data-step]'))
    group.hidden = compact && Number(group.dataset.step) !== state.formStep
  const next = form.querySelector('button[type=submit]'),
    back = form.querySelector('.back-step')
  if (!state.busy)
    next.textContent =
      compact && state.formStep === 0 ? T('Continue', '下一步') : next.dataset.finalLabel
  back.hidden = !compact || state.formStep === 0
  const content = form.closest('.auth-content')
  const warning = content.querySelector('.recovery-warning'),
    signIn = content.querySelector('.back-button')
  if (warning) warning.hidden = compact && state.formStep === 0
  if (signIn) signIn.hidden = compact && state.formStep === 1
}
window.addEventListener('resize', syncAuthViewport)
window.visualViewport?.addEventListener('resize', syncAuthViewport)
reducedMotion.addEventListener('change', () => {
  if (reducedMotion.matches)
    app.getAnimations({ subtree: true }).forEach((animation) => animation.cancel())
})
function syncDiagramMotion() {
  const diagram = document.querySelector('.coordination')
  if (diagram) diagram.dataset.paused = String(state.diagramPaused || document.hidden)
}
document.addEventListener('visibilitychange', syncDiagramMotion)
function diagram() {
  const d = node('div', 'coordination')
  d.setAttribute('role', 'group')
  d.dataset.paused = String(state.diagramPaused || document.hidden)
  d.setAttribute(
    'aria-label',
    T(
      'You talk to the Router. The Router coordinates the Workers. Architecture illustration, not live activity.',
      '你与 Router 对话，Router 协调 Worker。这是架构示意，不是运行状态。'
    )
  )
  const scene = node('div', 'diagram-scene')
  scene.setAttribute('aria-hidden', 'true')
  // These four routes are an illustration only; there is no user-to-Worker edge.
  const routes = [
    { path: 'M35 118H245', send: 0, reply: 6.2 },
    { path: 'M245 118H330Q356 118 356 92V80Q356 54 382 54H455', send: 1.6, reply: 4 },
    { path: 'M245 118H455', send: 1.8, reply: 4.2 },
    { path: 'M245 118H330Q356 118 356 144V156Q356 182 382 182H455', send: 2, reply: 4.4 }
  ]
  scene.innerHTML =
    '<svg class="diagram-lines" viewBox="0 0 490 236" aria-hidden="true">' +
    '<g class="diagram-rails">' +
    routes.map(({ path }) => `<path d="${path}"/>`).join('') +
    '</g>' +
    routes
      .map(({ path, send, reply }, index) =>
        [
          ['outbound', send],
          ['return', reply]
        ]
          .map(
            ([direction, delay]) =>
              `<g class="diagram-flow ${direction}" data-route="${index}" style="--flow-delay:${delay}s">` +
              ['halo', 'trail', 'core']
                .map((layer) => `<path class="beam-${layer}" pathLength="1" d="${path}"/>`)
                .join('') +
              '</g>'
          )
          .join('')
      )
      .join('') +
    '</svg>'
  const you = node('div', 'diagram-person'),
    n = node('span', 'node-icon')
  n.append(icon('user'))
  you.append(n, node('span', '', T('You', '你')))
  const router = node('div', 'diagram-router')
  const hub = node('span', 'router-hub')
  hub.append(node('span', 'roppo-mark'))
  router.append(hub, node('span', '', 'Router'))
  const workers = node('div', 'diagram-workers')
  for (let i = 0; i < 3; i++) {
    const w = node('div', 'diagram-worker')
    w.style.setProperty('--node-delay', 3.2 + i * 0.2 + 's')
    w.append(icon('worker'))
    workers.append(w)
  }
  workers.append(node('span', 'field-hint', 'Workers'))
  scene.append(you, router, workers)
  const toggle = button(
    '',
    () => {
      state.diagramPaused = !state.diagramPaused
      updateToggle()
      syncDiagramMotion()
    },
    'diagram-toggle'
  )
  function updateToggle() {
    const label = state.diagramPaused
      ? T('Play architecture animation', '播放架构动效')
      : T('Pause architecture animation', '暂停架构动效')
    toggle.setAttribute('aria-label', label)
    toggle.title = label
    toggle.replaceChildren(icon(state.diagramPaused ? 'play' : 'pause'))
  }
  updateToggle()
  d.append(scene, toggle)
  return d
}
function accountSection(title, description) {
  const s = node('section', 'account-section'),
    intro = node('div')
  intro.append(node('h2', '', title))
  if (description) intro.append(node('p', 'section-note', description))
  s.append(intro)
  return s
}
function accountUI() {
  const root = node('div', 'account-layout'),
    header = node('header', 'account-header'),
    link = node('a', 'workspace-link', T('Back to workspace', '返回工作区'))
  link.href = '/configure'
  link.prepend(icon('back'))
  header.append(brand(), link, tools())
  const main = node('main', 'account-body'),
    identity = node('div', 'account-heading'),
    person = state.status.user,
    labels = node('div', 'account-identity')
  labels.append(node('h1', '', T('Your account', '你的账号')), node('p', '', person.username))
  identity.append(
    node('div', 'account-avatar', Array.from(person.displayName)[0].toUpperCase()),
    labels
  )
  main.append(identity, notice())
  const profile = accountSection(T('Profile', '个人资料'), ''),
    pf = node('form', 'auth-form')
  field(pf, 'displayName', T('Display name', '称呼'), {
    max: 60,
    autocomplete: 'nickname',
    value: person.displayName
  })
  submit(pf, T('Save changes', '保存修改'))
  pf.addEventListener('submit', (e) => {
    e.preventDefault()
    void action(pf, async () => {
      const displayName = pf.elements.namedItem('displayName').value.trim()
      await api('/account/profile', { displayName })
      state.status.user.displayName = displayName
      root.querySelector('.account-avatar').textContent = Array.from(displayName)[0].toUpperCase()
      showNotice(T('Profile saved.', '资料已保存。'), true)
    })
  })
  profile.append(pf)
  main.append(profile)
  const password = accountSection(
      T('Password', '密码'),
      T(
        'Changing your password signs out all other sessions.',
        '修改密码后，其他所有会话都会退出。'
      )
    ),
    pw = node('form', 'auth-form')
  const user = node('input')
  user.type = 'hidden'
  user.name = 'username'
  user.autocomplete = 'username'
  user.value = person.username
  pw.append(user)
  field(pw, 'currentPassword', T('Current password', '当前密码'), {
    password: true,
    autocomplete: 'current-password'
  })
  passwordFields(pw)
  submit(pw, T('Update password', '更新密码'))
  pw.addEventListener('submit', (e) => {
    e.preventDefault()
    if (!confirmPassword(pw)) return
    void action(pw, async () => {
      await api('/account/password', {
        currentPassword: state.draft.currentPassword,
        password: state.draft.password
      })
      for (const key of ['currentPassword', 'password', 'confirmPassword']) {
        state.draft[key] = ''
        pw.elements.namedItem(key).value = ''
      }
      showNotice(
        T('Password updated. Other sessions have been signed out.', '密码已更新，其他会话已退出。'),
        true
      )
    })
  })
  password.append(pw)
  main.append(password)
  const recovery = accountSection(
      T('Recovery code', '恢复码'),
      T('A new code replaces your previous recovery code.', '生成新恢复码后，旧码立即失效。')
    ),
    rf = node('form', 'auth-form')
  field(rf, 'recoveryPassword', T('Current password', '当前密码'), {
    password: true,
    autocomplete: 'current-password'
  })
  submit(rf, T('Generate new code', '生成新恢复码'))
  rf.addEventListener('submit', (e) => {
    e.preventDefault()
    capture(rf)
    void action(rf, async () =>
      recoveryResult(
        await api('/account/recovery-code', { currentPassword: state.draft.recoveryPassword })
      )
    )
  })
  recovery.append(rf)
  main.append(recovery)
  const sessions = accountSection(T('Sessions', '登录会话'), ''),
    sessionBody = node('div')
  sessionBody.append(
    node(
      'p',
      'session-info',
      state.status.session.remember
        ? T('Remembered on this browser until ', '当前浏览器的登录有效期至 ') +
            new Intl.DateTimeFormat(language === 'zh' ? 'zh-CN' : 'en', {
              dateStyle: 'medium'
            }).format(state.status.session.expiresAt)
        : T(
            'This is a browser session, valid for up to 12 hours.',
            '当前为浏览器会话，最长有效期 12 小时。'
          )
    )
  )
  const actions = node('div', 'account-session')
  for (const all of [false, true]) {
    const label = all ? T('Sign out everywhere', '退出所有会话') : T('Sign out', '退出登录')
    actions.append(
      button(
        label,
        () => {
          if (
            all &&
            !confirm(
              T('Sign out all browsers, including this one?', '退出包括当前浏览器在内的所有会话？')
            )
          )
            return
          void action(actions, async () => {
            await api(all ? '/account/logout-all' : '/account/logout', {})
            state.draft = { remember: true }
            location.replace('/auth')
          })
        },
        'secondary-button'
      )
    )
  }
  sessionBody.append(actions)
  sessions.append(sessionBody)
  main.append(sessions)
  root.append(header, main)
  return root
}
function render(focus = false) {
  document.documentElement.classList.toggle('auth-viewport', state.view !== 'account')
  document.documentElement.lang = language
  document.title =
    (state.view === 'account'
      ? T('Your account', '你的账号')
      : state.view === 'setup'
        ? T('Create account', '创建账号')
        : state.view === 'recovery-code'
          ? T('Recovery code', '恢复码')
          : state.view === 'recover'
            ? T('Recover account', '找回账号')
            : T('Sign in', '登录')) + ' · Roppo'
  if (state.view === 'account') {
    app.replaceChildren(accountUI())
    return
  }
  const shell = node('div', 'auth-shell'),
    panel = node('aside', 'brand-panel'),
    story = node('div', 'brand-story'),
    title = node('h2', '', T('A team of agents.', '一支智能体团队。'))
  title.append(node('span', '', T('Yours to direct.', '为你协同。')))
  story.append(title, diagram())
  panel.append(brand(), story)
  const main = node('main', 'auth-main'),
    content = node('div', 'auth-content')
  const entering = state.view !== 'loading' && (state.view !== renderedView || focus)
  if (entering) content.dataset.enter = 'true'
  if (!enteredAuth && state.view !== 'loading') {
    shell.dataset.intro = 'true'
    enteredAuth = true
  }
  renderAuth(content)
  const stage = node('div', 'auth-stage')
  stage.append(content)
  main.append(tools(), stage)
  shell.append(panel, main)
  app.replaceChildren(shell)
  renderedView = state.view
  syncAuthViewport()
  if (focus) content.querySelector('h1')?.focus({ preventScroll: true })
}
async function initialize() {
  state.view = 'loading'
  render()
  try {
    const fragment = new URLSearchParams(location.hash.slice(1)),
      pair = fragment.get('pair'),
      invite = fragment.get('invite')
    if (invite) {
      location.replace('/usage#invite=' + encodeURIComponent(invite))
      return
    }
    if (pair) {
      history.replaceState(null, '', location.pathname + location.search)
      try {
        await api('/pair', { code: pair })
      } catch (error) {
        state.error = error.message
      }
    } else if (location.pathname.startsWith('/configure') && location.hash) {
      try {
        sessionStorage.setItem('roppo.return.hash', location.hash)
      } catch {}
    }
    state.status = await api('/account/status')
    if (state.status.authenticated) {
      if (location.pathname === '/account') {
        state.view = 'account'
        state.draft = { remember: true }
      } else {
        workspace()
        return
      }
    } else {
      state.view = state.status.configured
        ? 'login'
        : state.status.setupAllowed
          ? 'setup'
          : 'setup-link'
      if (state.status.configured) state.error = ''
    }
    render()
  } catch {
    state.view = 'unavailable'
    render()
  }
}
window.addEventListener('beforeunload', (event) => {
  if (state.recoveryCode && !state.saved) {
    event.preventDefault()
    event.returnValue = ''
  }
})
window.addEventListener('hashchange', () => {
  const hash = new URLSearchParams(location.hash.slice(1))
  if (!state.busy && (hash.has('pair') || hash.has('invite'))) void initialize()
})
void initialize()
