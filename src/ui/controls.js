let lang = 'en'
try {
  if (localStorage.getItem('agenthub.configuration.language') === 'zh-CN') lang = 'zh-CN'
} catch {}
const L = (en, zh) => (lang === 'en' ? en : zh)
const el = (tag, className, text) => {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text != null) node.textContent = String(text)
  return node
}
const add = (node, ...children) => {
  node.append(...children.filter((v) => v != null))
  return node
}
const icons = {
  sun: 'M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5',
  moon: 'M20.5 13A8.5 8.5 0 0 1 11 3.5 8.5 8.5 0 1 0 20.5 13Z',
  brand: 'M4 6h5v5H4zM15 13h5v5h-5zM9 8.5h4a3 3 0 0 1 3 3V13M6.5 11v3a2 2 0 0 0 2 2H15',
  overview: 'M3.5 4h7v7h-7zM14 4h6.5v7H14zM3.5 14h7v6h-7zM14 14h6.5v6H14z',
  execution: 'M4 5h6v5H4zM14 14h6v5h-6zM7 10v5a2 2 0 0 0 2 2h5M10 7h7v4',
  sources: 'M8 5v5m7-5v5M5 10h13v2a6 6 0 0 1-6 6v3m-1-3a6 6 0 0 1-6-6z',
  policy: 'M12 3l8 3v6c0 4-4 7-8 9-4-2-8-5-8-9V6zM8.5 11.5l2.5 2.5 4.5-5',
  work: 'M12 4v3m6-1-2 2M4 14a8 8 0 1 0 8-8M12 10v4l3 2M2 9h6m-6 4h4',
  delivery: 'M3 9l9-5 9 5-9 5zM4 10v7l8 4 8-4v-7m-8 4v7',
  prompts: 'M4 5h16v12H9l-5 4zM8 9h8m-8 4h5',
  advanced: 'M8 5h12M4 5h1m-1 7h9m4 0h3M4 19h3m4 0h9M8 3v4m6 3v4m-6 3v4',
  forward: 'M9 5l7 7-7 7',
  out: 'M7 6h11v11m0-11L6 18',
  lang: 'M3 6h10M8 3v3m3 0c0 6-4 10-8 12m2-9c1 3 4 6 7 8m2 3 4-11 4 11m-6.5-4h5',
  key: 'M14 5a5 5 0 1 1-1 8l-3 3H7v3H3v-4l7-7a5 5 0 0 1 4-3zM16 8h.1',
  check: 'M4 12l5 5L20 6',
  branch: 'M5 4v11a3 3 0 0 0 3 3h11m-5-5 5 5-5 5',
  refresh: 'M20 5v6h-6m6 0a8 8 0 1 0-1 6',
  arrow: 'M4 12h15m-6-6 6 6-6 6'
}
function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('class', 'icon')
  svg.setAttribute('aria-hidden', 'true')
  const path = document.createElementNS(svg.namespaceURI, 'path')
  path.setAttribute('d', icons[name])
  svg.append(path)
  return svg
}
const editable = [
  'decision',
  'backends',
  'execution',
  'models',
  'model',
  'effort',
  'concurrency',
  'acceptMode',
  'rules',
  'prompts',
  'sources',
  'watchdog',
  'work',
  'delivery'
]
const sourceKeys = [
  'allowedActors',
  'allowedBots',
  'enabled',
  'admission',
  'listenScopes',
  'pollSeconds',
  'memberSync'
]
let S = {
  surface: 'entries',
  health: null,
  healthDone: false,
  token: '',
  typed: '',
  authed: false,
  busy: '',
  snap: null,
  base: null,
  draft: null,
  status: null,
  statusError: false,
  notice: null,
  latest: null,
  buffers: new Map(),
  errors: new Map(),
  sourceId: '',
  advancedKey: 'execution',
  previewRole: 'router',
  previewMode: '',
  previewSourceId: '',
  previewWorkerId: '',
  preview: null,
  promptIndex: null
}
const app = typeof configurationHost !== 'undefined' && configurationHost ? configurationHost.element : document.getElementById('app')
const clone = (v) => (v === undefined ? undefined : structuredClone(v))
function normalized(v) {
  if (Array.isArray(v)) return v.map(normalized)
  if (v && typeof v === 'object')
    return Object.fromEntries(
      Object.keys(v)
        .sort()
        .map((k) => [k, normalized(v[k])])
    )
  return v
}
const same = (a, b) => JSON.stringify(normalized(a)) === JSON.stringify(normalized(b))
const keys = () => (S.snap?.editableKeys || editable).filter((k) => editable.includes(k))
const permittedSource = () =>
  (S.snap?.sourceEditableKeys || sourceKeys).filter((k) => sourceKeys.includes(k))
const get = (object, path) => path.split('.').reduce((a, k) => a?.[k], object)
function set(object, path, value) {
  const parts = path.split('.'),
    key = parts.pop()
  let target = object
  for (const p of parts) {
    if (target[p] == null) target[p] = {}
    target = target[p]
  }
  if (value === undefined) delete target[key]
  else target[key] = value
}
function changed() {
  return S.base ? keys().filter((k) => !same(S.base.config[k], S.draft[k])) : []
}
const dirty = () => changed().length > 0 || S.errors.size > 0
const pretty = (v) => JSON.stringify(v, null, 2)
const when = (v) => {
  const date = new Date(v)
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat(lang, { dateStyle: 'medium', timeStyle: 'short' }).format(date)
    : String(v ?? '—')
}
const revision = (n) => L('Revision ', '版本 ') + n
const action = (text, cb, kind = 'btn', glyph) => {
  const b = el('button', kind)
  b.type = 'button'
  add(b, glyph ? icon(glyph) : null, el('span', '', text))
  b.onclick = cb
  return b
}
const detail = (title, child) => add(el('details'), el('summary', '', title), child)
const raw = (v) => el('pre', '', typeof v === 'string' ? v : pretty(v))
const panel = (title, ...children) => add(el('section', 'panel'), el('h2', '', title), ...children)
const group = (title, desc, ...fields) =>
  add(
    el('section', 'form-section'),
    add(el('div', 'section-head'), el('h2', '', title), desc ? el('p', '', desc) : null),
    ...fields
  )
function datum(title, value, mono = false) {
  return add(
    el('div', 'datum'),
    el('dt', '', title),
    typeof value === 'object' && value ? add(el('dd'), value) : el('dd', mono ? 'mono' : '', value ?? '—')
  )
}
const rows = (...items) => add(el('dl', 'rows'), ...items)
const badge = (label, kind = '') => el('span', 'badge ' + kind, label)
const notReported = () => L('Not reported', '未报告')
function setNotice(level, en, zh, details = '') {
  S.notice = { level, en, zh, details }
  announce(L(en, zh))
}
function announce(message) {
  document.getElementById('announcer').textContent = message
}
function projectSources(sources) {
  return sources.map((s) =>
    Object.fromEntries(
      ['id', ...permittedSource()].filter((k) => Object.hasOwn(s, k)).map((k) => [k, clone(s[k])])
    )
  )
}
function withSourceValues(current, rows, strict = true) {
  if (!Array.isArray(rows)) throw Error(L('Expected a source list.', '需要来源数组。'))
  if (
    strict &&
    (rows.length !== current.length ||
      rows.some(
        (s, i) =>
          !s ||
          s.id !== current[i].id ||
          Object.keys(s).some((k) => k !== 'id' && !permittedSource().includes(k))
      ))
  )
    throw Error(
      L(
        'Keep source IDs and order. Deployment fields are read-only.',
        '请保持来源 ID 和顺序。部署字段为只读。'
      )
    )
  return current.map((s) => {
    const row = rows.find((x) => x?.id === s.id)
    if (!row) return clone(s)
    const result = clone(s)
    for (const k of permittedSource()) {
      if (Object.hasOwn(row, k)) result[k] = clone(row[k])
      else delete result[k]
    }
    return result
  })
}
function clearRelated(path) {
  for (const key of S.buffers.keys())
    if (key === path || key.startsWith(path + '.') || path.startsWith(key + '.')) {
      S.buffers.delete(key)
      S.errors.delete(key)
    }
}
function matchesShape(value, kind) {
  return kind === 'array'
    ? Array.isArray(value)
    : kind === 'object'
      ? value !== null && typeof value === 'object' && !Array.isArray(value)
      : typeof value === kind
}
// Keep malformed JSON in its editor without letting it break another section's native controls.
function validateShape(key, value) {
  const kind = {
    decision: 'object',
    execution: 'object',
    models: 'object',
    model: 'string',
    effort: 'string',
    concurrency: 'number',
    acceptMode: 'string',
    rules: 'array',
    prompts: 'object',
    sources: 'array',
    watchdog: 'object',
    work: 'object',
    delivery: 'object'
  }[key]
  if (!matchesShape(value, kind)) throw Error()
  function check(template, candidate) {
    if (template == null || candidate === undefined) return
    if (Array.isArray(template)) {
      if (!Array.isArray(candidate)) throw Error()
      if (template.length) for (const item of candidate) check(template[0], item)
      return
    }
    if (typeof template === 'object') {
      if (!matchesShape(candidate, 'object')) throw Error()
      for (const name of Object.keys(template))
        if (Object.hasOwn(candidate, name)) check(template[name], candidate[name])
      return
    }
    if (typeof candidate !== typeof template) throw Error()
  }
  if (key === 'execution' && value.workers !== undefined &&
    (!Array.isArray(value.workers) || value.workers.length < 1 || value.workers.length > 10 ||
      value.workers.some(worker => !worker || typeof worker.id !== 'string' ||
        typeof worker.backend !== 'string' || (worker.model !== undefined && typeof worker.model !== 'string'))))
    throw Error()
  if (key === 'models' && Object.values(value).some(model => typeof model !== 'string')) throw Error()
  if (key === 'sources') {
    for (const source of value) {
      const original = S.base.config.sources.find((s) => s.id === source.id)
      check(original, source)
      for (const k of ['allowedActors', 'allowedBots', 'listenScopes'])
        if (
          source[k] !== undefined &&
          (!Array.isArray(source[k]) || source[k].some((x) => typeof x !== 'string'))
        )
          throw Error()
    }
  } else check(S.base.config[key], value)
  if (
    key === 'rules' &&
    value.some((r) => !r || typeof r.id !== 'string' || typeof r.instruction !== 'string')
  )
    throw Error()
}
function inputField(path, title, spec = {}) {
  const wrap = el('div', 'field'),
    label = el('label', 'field-label', title),
    holder = el('div', 'control'),
    type = spec.type || 'text'
  const form = el(
    type === 'select' ? 'select' : ['area', 'list', 'json'].includes(type) ? 'textarea' : 'input',
    type === 'json' ? 'json' : type === 'bool' ? 'switch' : ''
  )
  const id = 'f-' + path.replaceAll('.', '-')
  label.htmlFor = form.id = id
  if (spec.help) {
    const hint = el('small', '', spec.help)
    hint.id = id + '-hint'
    label.append(hint)
    form.setAttribute('aria-describedby', hint.id)
  }
  form.disabled = !!spec.disabled
  let value = get(S.draft, path)
  if (spec.sourceProjection) value = projectSources(value)
  if (spec.scale && value != null) value /= spec.scale
  const buffer = S.buffers.get(path)
  if (type === 'select') {
    for (const option of spec.options) {
      const [v, name] = Array.isArray(option) ? option : [option, option]
      form.add(new Option(name, v))
    }
  }
  if (type === 'bool') {
    form.type = 'checkbox'
    form.checked = Boolean(value)
  } else {
    if (type === 'num') {
      form.type = 'number'
      if (spec.min !== undefined) form.min = spec.min
      if (spec.max !== undefined) form.max = spec.max
      form.step = spec.step || '1'
    }
    if (spec.placeholder) form.placeholder = spec.placeholder
    if (type === 'json') form.spellcheck = false
    form.value =
      buffer?.type === type
        ? buffer.text
        : type === 'json'
          ? (pretty(value) ?? '')
          : type === 'list'
            ? (value || []).join('\n')
            : (value ?? '')
  }
  const error = el('small', 'field-error')
  error.id = id + '-error'
  form.setAttribute('aria-errormessage', error.id)
  const showError = () => {
    const msg = S.errors.get(path)
    error.textContent = msg ? L(...msg) : ''
    error.hidden = !msg
    form.classList.toggle('invalid', !!msg)
    form.setAttribute('aria-invalid', String(!!msg))
  }
  showError()
  form.oninput = () => {
    clearRelated(path)
    let next = form.value,
      problem
    if (type === 'bool') next = form.checked
    else if (type === 'num') {
      if (!next.trim() || !form.validity.valid || !Number.isFinite(form.valueAsNumber))
        problem = ['Enter a number within the indicated limits.', '请输入范围内的有效数字。']
      else {
        next = form.valueAsNumber * (spec.scale || 1)
        if (spec.scaledInteger) {
          const rounded = Math.round(next)
          if (Math.abs(next - rounded) > 1e-6)
            problem = ['Enter a value that converts to a whole number.', '请输入可换算为整数的值。']
          else next = rounded
        }
      }
    } else if (type === 'json') {
      try {
        next = JSON.parse(next)
        if (spec.sourceProjection) next = withSourceValues(S.draft.sources, next)
        if (spec.objectType && !matchesShape(next, spec.objectType)) throw Error()
        if (spec.advanced) validateShape(path, next)
      } catch (e) {
        problem = ['Check the JSON structure and allowed fields.', '请检查 JSON 结构和允许编辑的字段。']
      }
    } else if (type === 'list') {
      next = next
        .split(/\r?\n/)
        .map((x) => x.trim())
        .filter(Boolean)
      if (spec.optional && !next.length) next = undefined
    } else if (spec.optional && !next) next = undefined
    if (problem || ['area', 'list', 'json', 'num'].includes(type))
      S.buffers.set(path, { type, text: form.value })
    if (problem) S.errors.set(path, problem)
    else set(S.draft, path, next)
    if (['prompts', 'execution', 'backends', 'sources'].some(key => path === key || path.startsWith(key + '.'))) {
      S.preview = null
      document.getElementById('control-prompt-preview')?.remove()
    }
    if (S.notice?.level === 'success') {
      S.notice = null
      document.getElementById('notice')?.replaceChildren()
    }
    showError()
    if (S.latest && !S.errors.size) render()
    else updateBar()
  }
  return add(wrap, label, add(holder, form, error))
}
const listField = (path, name, optional = false) =>
  inputField(path, name, { type: 'list', optional, help: L('One ID per line.', '每行输入一个 ID。') })
const num = (p, name, min, max) =>
  inputField(p, name, {
    type: 'num',
    min,
    max,
    help: max === undefined ? L('Minimum ', '最小值 ') + min : min + ' – ' + max
  })
const scaledNumber = (path, label, scale, min, max, integer = true) =>
  inputField(path, label, { type: 'num', scale, scaledInteger: integer,
    min: min / scale, max: max === undefined ? undefined : max / scale, step: 'any' })
const choose = (p, name, options, more = {}) => inputField(p, name, { type: 'select', options, ...more })
const toggle = (p, name, help) => inputField(p, name, { type: 'bool', help })
const jsonField = (p, title, extra = {}) => inputField(p, title, { type: 'json', ...extra })
function selector(id, title, options, value, onchange) {
  const label = el('label', 'field-label', title),
    select = el('select')
  label.htmlFor = select.id = id
  for (const [v, name] of options) select.add(new Option(name, v))
  select.value = value
  select.onchange = () => onchange(select.value)
  return add(el('div', 'field'), label, select)
}
function inspectJson(title, value) {
  return detail(title, raw(value))
}
