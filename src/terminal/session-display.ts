import type { TerminalEditor } from './editor.ts'
import { TerminalLayout } from './presentation.ts'
import type { Theme } from './settings.ts'
import type { Snapshot } from './client.ts'
import { publicMessage } from './conversation.ts'

type Draw = (layout: TerminalLayout) => string[]
interface Entry {
  at: number
  sequence?: number
  draw: Draw
  lines?: string[]
  detail?: boolean
}
const position = (row: number, col: number) => '\x1b[' + (row + 1) + ';' + (col + 1) + 'H'

// Messages reflow independently of the fixed composer. Only changed screen rows are written.
export class SessionDisplay {
  private entries = new Map<string, Entry>()
  private messages = new Map<string, Snapshot['messages'][number]>()
  private rows?: string[]
  private screen: string[] = []
  private active = false
  private caret = ''
  private visibleHistory: string[] = []
  private top?: number
  private scrollRevision = 0
  private capacity = 1
  private end = 0
  private noticeId = 0
  private view?: Snapshot
  private cachedLayout?: { columns: number; layout: TerminalLayout }
  continuation = false
  sending = false
  loading = false
  motion: 'full' | 'reduced' = 'full'
  private expanded = false

  constructor(
    private out: NodeJS.WriteStream,
    private editor: { line: string; cursor: number } & Partial<
      Pick<TerminalEditor, 'menu' | 'expanded' | 'picking'>
    >,
    readonly plain: boolean,
    private picker = false,
    private theme: Theme = 'dark'
  ) {}
  get layout() {
    const columns = this.out.columns || 80
    if (columns !== this.cachedLayout?.columns) {
      this.cachedLayout = {
        columns,
        layout: new TerminalLayout(columns, !this.plain && !process.env.NO_COLOR && this.theme !== 'mono', this.theme)
      }
      for (const entry of this.entries.values()) entry.lines = undefined
      this.rows = undefined
      this.screen = []
    }
    return this.cachedLayout.layout
  }
  setTheme(theme: Theme) {
    this.theme = theme
    this.cachedLayout = undefined
    this.paint()
  }
  redraw() { this.screen = []; this.paint() }
  private history(layout: TerminalLayout) {
    return (this.rows ??= [...this.entries.values()]
      .filter(e => !e.detail || this.editor.expanded)
      .sort(
        (a, b) =>
          a.at - b.at ||
          (a.sequence ?? Number.MAX_SAFE_INTEGER) - (b.sequence ?? Number.MAX_SAFE_INTEGER)
      )
      .flatMap((e) => (e.lines ??= e.draw(layout))))
  }
  private record(key: string, at: number, draw: Draw, sequence?: number, detail = false) {
    this.entries.set(key, { at, draw, sequence, detail })
    this.rows = undefined
    if (this.plain && (!detail || this.editor.expanded)) this.out.write(draw(this.layout).join('\n') + '\n')
  }
  notice(draw: Draw) {
    this.record('notice/' + ++this.noticeId, Date.now(), draw)
    this.follow()
  }
  private addMessages(messages: Snapshot['messages']) {
    for (const m of messages) {
      if (!publicMessage(m)) continue
      const old = this.messages.get(m.id)
      if (
        old &&
        old.text === m.text &&
        old.status === m.status &&
        old.speaker?.label === m.speaker?.label &&
        JSON.stringify(old.attachments) === JSON.stringify(m.attachments)
      )
        continue
      if (this.plain && m.status === 'streaming') continue
      this.messages.set(m.id, m)
      const body = [m.text, ...(m.attachments ?? []).map((file) => '@' + file.name)]
        .filter(Boolean)
        .join('\n')
      if (!body) {
        this.entries.delete(m.id)
        this.rows = undefined
        continue
      }
      this.record(
        m.id,
        m.createdAt,
        (l) => l.message(m.speaker?.label ?? 'Roppo', body, m.role === 'user'),
        m.sequence
      )
    }
  }
  get scrollPositionRevision() {
    return this.scrollRevision
  }
  prepend(page: Snapshot['messages'], revision: number) {
    const previous = this.history(this.layout).length
    this.addMessages(page.filter((m) => !this.messages.has(m.id)))
    if (this.top !== undefined) this.top += this.history(this.layout).length - previous
    if (this.scrollRevision === revision) this.scroll(-1)
    else this.paint()
  }
  follow() {
    this.scrollRevision++
    this.top = undefined
    this.paint()
  }
  // Returns true when the user tries to scroll past the oldest loaded page.
  scroll(direction: number, lines = Math.max(1, this.capacity - 1)) {
    this.scrollRevision++
    const start = this.top ?? this.end
    const next = Math.max(0, Math.min(this.end, start + direction * lines))
    this.top = this.end > 0 && (direction < 0 || next < this.end) ? next : undefined
    this.paint()
    return direction < 0 && start === 0
  }
  update(view: Snapshot) {
    if (!this.view && this.plain) this.out.write(this.layout.header(view).join('\n') + '\n')
    // Keep newly finished tasks and tool actions in the transcript. The initial view
    // focuses on messages; historical tasks and calls remain available via /tasks and Ctrl+O.
    if (this.view) {
      for (const task of view.tasks) {
        if (
          ['queued', 'running', 'waiting'].includes(task.state) ||
          this.view.tasks.some((t) => t.id === task.id && t.state === task.state)
        )
          continue
        this.record('task/' + task.id, task.updatedAt, (l) => ['', l.task(task, view)], undefined, true)
      }
      for (const call of view.calls) {
        if (
          call.kind !== 'tool' ||
          call.state === 'running' ||
          call.name === 'superagent_status' ||
          this.view.calls.some((c) => c.id === call.id && c.state === call.state)
        )
          continue
        if (
          call.name === 'worker_manage' &&
          call.action === 'assign' &&
          call.state === 'completed' &&
          view.tasks.some((t) => t.workerId === call.target)
        )
          continue
        this.record('tool/' + call.id, call.endedAt ?? call.startedAt, (l) => [l.activity(call)], undefined, true)
      }
    }
    this.addMessages(view.messages)
    for (const file of view.deliveries ?? []) {
      const key = 'file/' + file.id
      if (!this.entries.has(key)) this.record(key, file.createdAt, l => l.result(
        '📎 ' + file.name + '  ·  /files'
      ))
    }
    if (this.plain && view.run && view.run.state !== this.view?.run?.state)
      this.out.write(this.layout.workStatus(view) + '\n')
    this.view = view
    this.paint()
  }
  paint() {
    if (this.plain) return
    if (this.expanded !== !!this.editor.expanded) {
      this.expanded = !!this.editor.expanded
      this.rows = undefined
      this.top = undefined
    }
    const layout = this.layout,
      height = Math.max(1, this.out.rows || 24)
    const history = this.history(layout)
    const header =
      this.view && !this.picker
        ? !history.length && !this.view.run && height >= 15
          ? layout.welcome(this.view, height)
          : layout.header(this.view)
        : []
    const footer = layout.composer(
      this.view,
      this.editor.line,
      this.editor.cursor,
      this.continuation,
      height,
      {
        picker: this.picker || this.editor.picking,
        menu: this.editor.menu,
        expanded: this.editor.expanded,
        motion: this.motion,
        sending: this.sending,
        loading: this.loading,
        history: !!history.length
      }
    )
    // Even a very short pane keeps its edit cursor on screen.
    const skip = Math.max(0, Math.min(footer.row, footer.lines.length - height))
    const bottom = footer.lines.slice(skip, skip + height)
    const room = height - bottom.length
    const heading = header.slice(0, Math.min(header.length, Math.max(0, room - 1)))
    this.capacity = room - heading.length
    this.end = Math.max(0, history.length - this.capacity)
    const start = Math.min(this.top ?? this.end, this.end)
    this.visibleHistory = history.slice(start, start + this.capacity)
    const lines = [...heading, ...this.visibleHistory]
    while (lines.length < room) lines.push('')
    lines.push(...bottom)
    const redraw = this.screen.length !== height
    let output = this.active ? '' : '\x1b[?1049h'
    this.active = true
    if (redraw) output += '\x1b[2J'
    for (const [i, line] of lines.entries()) {
      if (redraw ? !!line : line !== this.screen[i]) output += position(i, 0) + '\x1b[2K' + line
    }
    const caret = position(
      room + footer.row - skip,
      Math.min((this.out.columns || 80) - 1, footer.col)
    )
    if (output || caret !== this.caret) this.out.write(output + caret)
    this.caret = caret
    this.screen = lines
  }
  close() {
    if (this.active) {
      this.active = false
      // Leave a readable transcript in normal terminal scrollback on explicit exit.
      const lines = this.picker ? [] : this.visibleHistory
      this.out.write('\x1b[?1049l\x1b[2J\x1b[H' + (lines.length ? lines.join('\r\n') + '\r\n' : ''))
    }
  }
}
