import {paletteFor} from './themes.ts'
import { entryPixels, paintStartupTide, tideDuration, startupDuration } from './startup.ts'
import {TerminalCompanion,brailleCells,companionWidth,companionRows} from './companion.ts'
import {
  BoxRenderable, TextRenderable, TextareaRenderable, InputRenderable, ScrollBoxRenderable,
  MarkdownRenderable, SyntaxStyle, StyledText, RGBA, type CliRenderer, type KeyEvent
} from '@opentui/core'
import type { Snapshot } from './client.ts'
import { clean } from './client.ts'
import { publicMessage } from './conversation.ts'
import { isApprovalPending } from '../chat-workflow.ts'
import type { HostSettings } from './host-settings.ts'
import type { TerminalSettings } from './settings.ts'
import stringWidth from 'string-width'
import { byName } from './list-order.ts'
import { readAttachment, attachmentSize, type DraftAttachment } from './attachments.ts'
import { chatUploadLimits } from '../execution-limits.ts'
import { effortTideColors, effortTideFrame } from './effort-tide.ts'
import { routerProcessing, type InputMode, type QueuedInput } from './input-queue.ts'

export interface TuiItem { label: string; detail?: string; search?: string; run: () => void | Promise<void> }
export interface TuiMenu { order?: 'name' | 'source'; cancel?: () => void; title: string; items: TuiItem[]; detail?: string }
export interface TuiActions {
  send(text: string, files?: string[], mode?: InputMode): Promise<void>
  inputMode?(mode:InputMode): void
  queue?(action:'steer'|'edit'|'delete'|'up'|'down'|'pause'|'hold'|'release',id?:string,text?:string): Promise<void>
  command(text: string): Promise<void>
  complete(text: string): Promise<TuiItem[]>
  interrupt(): Promise<void>
  older(): Promise<void>
  review(): Promise<void>
  copy?(text: string): Promise<void>
  quit(): void
}

/** Stable native nodes keep the draft, selection and scroll position independent of host events. */
export class TuiScreen {
  readonly frame: BoxRenderable
  readonly transcript: ScrollBoxRenderable
  readonly draft: TextareaRenderable
  private companion = new TerminalCompanion()
  private companionBox: BoxRenderable
  private companionArt: TextRenderable
  private companionLabel: TextRenderable
  private companionPulse?: ReturnType<typeof setInterval>
  private startupAt?: number
  private startupFinished = false
  private startupLayer?: BoxRenderable
  private startupPulse?: ReturnType<typeof setInterval>
  private header: TextRenderable
  private topArea: BoxRenderable
  private home: BoxRenderable
  private compose: BoxRenderable
  private attachmentList: ScrollBoxRenderable
  private attachButton: TextRenderable
  private attachments: DraftAttachment[] = []
  private sending = false
  private queueBox: ScrollBoxRenderable
  private inputModeLabel: TextRenderable
  private queuedInputs: QueuedInput[] = []
  private queuePaused = false
  private queueSending?: string
  private model: TextRenderable
  private effort: TextRenderable
  private permissions: TextRenderable
  private footer: TextRenderable
  private commandShortcut: TextRenderable
  private activity: TextRenderable
  private jump: TextRenderable
  private pending: TextRenderable
  private requestCards = new Map<string, { box: BoxRenderable; value: string }>()
  private completions: ScrollBoxRenderable
  private overlay?: BoxRenderable
  private modalPanel?: BoxRenderable
  private modalSearch?: InputRenderable
  private modalRows?: ScrollBoxRenderable
  private modalCancel?: () => void
  private modalRedraw?: () => void
  private modalPulse?: ReturnType<typeof setInterval>
  private modalMenu?: TuiMenu
  private modalItems: TuiItem[] = []
  private modalIndex = 0
  private completionItems: TuiItem[] = []
  private completionIndex = 0
  private completionRevision = 0
  private completionTimer?: ReturnType<typeof setTimeout>
  private messageNodes = new Map<string, { box: BoxRenderable; body: MarkdownRenderable | TextRenderable; value: string }>()
  private style: SyntaxStyle
  private palette = paletteFor()
  private view?: Snapshot
  private host?: HostSettings
  private prefs: TerminalSettings
  private busy = false
  private loading = false
  private connected = true
  private started = 0
  private pulse?: ReturnType<typeof setInterval>
  private noticeTimer?: ReturnType<typeof setTimeout>
  private closed = false
  private history: string[] = []
  private historyIndex = 0
  private scratch = ''

  constructor(readonly renderer: CliRenderer, preferences: TerminalSettings, private actions: TuiActions) {
    this.prefs = preferences
    this.palette = this.colors()
    const p = this.palette
    this.style = SyntaxStyle.fromStyles({
      keyword: { fg: p.accent }, string: { fg: p.warm }, function: { fg: p.accent }, default: { fg: p.fg }, 'markup.heading': { fg: p.warm, bold: true },
      'markup.strong': { fg: p.warm, bold: true }, 'markup.link': { fg: p.accent },
      'markup.raw': { fg: p.warm }, comment: { fg: p.muted }
    }, renderer.nativeScene)
    this.frame = new BoxRenderable(renderer, { width: '100%', height: '100%', flexDirection: 'column', paddingX: 2, paddingY: 1, backgroundColor: p.bg })
    renderer.root.add(this.frame)
    this.topArea = new BoxRenderable(renderer, {width:'100%',height:companionRows+1,flexShrink:0})
    this.frame.add(this.topArea)
    this.header = this.text('', { id:'header-notice',position:'absolute',left:0,top:0,width:19,height:2,flexShrink:0,fg:p.fg })
    this.topArea.add(this.header)
    this.companionBox = new BoxRenderable(renderer, {height:companionRows+1,flexShrink:0,width:'100%',alignItems:'center',flexDirection:'column'})
    this.companionArt = this.text('', {id:'header-companion',width:companionWidth,height:companionRows,selectable:false})
    this.companionLabel = this.text('', {width:32,height:1,fg:p.muted,selectable:false})
    this.companionBox.add(this.companionArt);this.companionBox.add(this.companionLabel);this.topArea.add(this.companionBox)
    this.home = new BoxRenderable(renderer, { flexGrow: 1, minHeight: 0, justifyContent: 'flex-end', alignItems: 'center', gap: 1, paddingBottom: 2 })
    this.home.add(this.text('█▀▀▄ █▀▀█ █▀▀█ █▀▀█ █▀▀█\n█▄▄▀ █  █ █▄▄█ █▄▄█ █  █\n█  █ ▀▀▀▀ █    █    ▀▀▀▀'))
    this.home.add(this.text('A little more room for your life.', { fg: p.muted }))
    this.frame.add(this.home)
    this.transcript = new ScrollBoxRenderable(renderer, {
      flexGrow: 1, flexBasis: 0, minHeight: 0, width: '100%', visible: false,
      stickyScroll: true, stickyStart: 'bottom', scrollX: false,
      verticalScrollbarOptions: { visible: false }, horizontalScrollbarOptions: { visible: false },
      contentOptions: { gap: 1, paddingBottom: 1 }
    })
    this.frame.add(this.transcript)
    this.jump = this.text('↓ Back to latest · ctrl+end', { visible: false, height: 1, fg: p.accent,
      onMouseDown: () => this.latest() })
    this.frame.add(this.jump)
    this.pending = this.text('', { height: 1, visible: false, fg: p.warm, onMouseDown: () => this.run(this.actions.review()) })
    this.frame.add(this.pending)
    this.activity = this.text('', { height: 1, visible: false, fg: p.accent, marginTop: 1, flexShrink: 0 })
    this.frame.add(this.activity)
    this.completions = new ScrollBoxRenderable(renderer, { id: 'command-completions', visible: false, flexShrink: 0, width: '100%', scrollX: false, backgroundColor: p.panel, verticalScrollbarOptions: { showArrows: false } })
    this.frame.add(this.completions)
    this.queueBox=new ScrollBoxRenderable(renderer,{id:'input-queue',width:'100%',height:0,visible:false,flexShrink:0,scrollX:false,verticalScrollbarOptions:{showArrows:false}})
    this.frame.add(this.queueBox)
    this.compose = new BoxRenderable(renderer, { width: '100%', border: ['left'], borderColor: p.accent,
      backgroundColor: p.panel, paddingX: 1, paddingY: 1, flexShrink: 0, marginTop: 1 })
    this.draft = new TextareaRenderable(renderer, {
      width: '100%', height: 2, textColor: p.fg, focusedTextColor: p.fg,
      backgroundColor: p.panel, focusedBackgroundColor: p.panel, cursorColor: p.accent,
      placeholder: 'Ask Roppo anything…', placeholderColor: p.muted,
      keyBindings: [{ name: 'return', action: 'submit' }, { name: 'return', shift: true, action: 'newline' },
        { name: 'return', meta: true, action: 'newline' }, { name: 'j', ctrl: true, action: 'newline' }],
      onSubmit: () => this.submit(), onContentChange: () => this.changed()
    })
    this.attachmentList = new ScrollBoxRenderable(renderer, { id: 'draft-attachments', width: '100%', visible: false,
      flexShrink: 0, scrollX: false, marginBottom: 1, verticalScrollbarOptions: { showArrows: false } })
    this.compose.add(this.attachmentList); this.compose.add(this.draft)
    this.inputModeLabel=this.text('',{id:'input-mode',height:1,visible:false,selectable:false,fg:p.accent,onMouseDown:event=>{if(event.button===0)this.toggleInputMode()}})
    const meta = new BoxRenderable(renderer, { flexDirection: 'row', justifyContent: 'space-between', marginTop: 1, flexShrink: 0 })
    const modelControls = new BoxRenderable(renderer, { flexDirection:'row',flexGrow:1,flexShrink:1,minWidth:0,marginRight:2 })
    this.model = this.text('Router', { id:'composer-model',fg:p.accent,height:1,flexShrink:1,minWidth:0,selectable:false,
      onMouseDown: event => { if (event.button === 0) this.run(this.actions.command('/model')) } })
    this.effort = this.text('', { id:'composer-effort',fg:p.accent,height:1,selectable:false,
      onMouseDown: event => { if (event.button === 0) this.run(this.actions.command('/effort')) } })
    modelControls.add(this.model); modelControls.add(this.effort)
    this.permissions = this.text('ask', { fg: p.muted, height: 1, onMouseDown: () => this.run(this.actions.command('/permissions')) })
    this.attachButton = this.text('+ Attach', { id: 'attach-files', fg: p.muted, height: 1, marginRight: 2,
      selectable: false, onMouseDown: event => { if (event.button === 0) this.run(this.actions.command('/attach')) } })
    const inputModeSlot=new BoxRenderable(renderer,{flexDirection:'row',justifyContent:'center',flexGrow:1,flexShrink:1,minWidth:0,marginRight:2})
    inputModeSlot.add(this.inputModeLabel)
    meta.add(modelControls); meta.add(inputModeSlot); meta.add(this.attachButton); meta.add(this.permissions); this.compose.add(meta); this.frame.add(this.compose)
    const footerRow = new BoxRenderable(renderer, { width: '100%', height: 1, marginTop: 1, flexShrink: 0, flexDirection: 'row', justifyContent: 'space-between', gap: 2 })
    this.footer = this.text('', { id: 'sync-status', height: 1, fg: p.muted, flexShrink: 1, minWidth: 0, selectable: false,
      onMouseDown: event => { if (event.button === 0) this.run(this.actions.command('/open')) } })
    this.commandShortcut = this.text('', { id: 'command-shortcut', height: 1, fg: p.muted, selectable: false,
      onMouseDown: event => { if (event.button === 0) this.run(this.actions.command('/commands')) } })
    footerRow.add(this.footer); footerRow.add(this.commandShortcut); this.frame.add(footerRow)
    renderer.keyInput.on('keypress', this.key)
    renderer.on('resize', this.resize)
    renderer.on('theme_mode', this.themeChanged)
    this.transcript.verticalScrollBar.on('change', () => {
      this.jump.visible = this.transcript.scrollTop + this.transcript.viewport.height < this.transcript.scrollHeight - 1
    })
    this.resize(); this.draft.focus()
  }

  private colors() {
    return paletteFor(this.prefs.theme, this.renderer.themeMode === 'light')
  }
  private text(content: string, options: ConstructorParameters<typeof TextRenderable>[1] = {}) {
    return new TextRenderable(this.renderer, { content: clean(content), fg: this.palette.fg, flexShrink: 0, ...options })
  }
  run(promise: Promise<unknown>) { promise.catch(error => { if (!this.closed) this.notice((error as Error).message, true) }) }
  private themeChanged = () => { if (this.prefs.theme === 'system') this.preferences(this.prefs) }
  private resize = () => {
    const narrow = this.renderer.width < 65
    this.queueBox.height=this.queuedInputs.length?Math.min(this.queuedInputs.length+1,Math.max(2,Math.min(5,Math.floor(this.renderer.height/5)))):0
    this.frame.paddingX = narrow ? 1 : 3
    const branded = !this.home.visible && !this.noticeTimer
    this.header.visible = branded || !!this.noticeTimer
    this.header.height = branded && !narrow ? 2 : 1
    if (branded) {
      this.header.content = narrow ? 'ROPPO' : '█▀█ █▀█ █▀█ █▀█ █▀█\n█▀▄ █▄█ █▀▀ █▀▀ █▄█'
      this.header.fg = this.palette.fg
    }
    this.header.width = '100%'
    const companionOffset = this.noticeTimer || (branded && narrow) ? 1 : 0
    this.companionBox.visible = this.prefs.animation !== false && this.renderer.height >= 14+companionOffset+companionRows+(this.queuedInputs.length?this.queueBox.height+1:0)
    const topHeight = Math.max(this.header.visible ? this.header.height : 0,(this.companionBox.visible ? companionRows+1 : 0) + companionOffset)
    this.companionBox.marginTop = companionOffset
    this.topArea.height = topHeight
    this.companionLabel.width = Math.min(32,this.renderer.width-4)
    this.compose.width = this.home.visible ? Math.min(78, this.renderer.width - (narrow ? 2 : 6)) : '100%'
    this.compose.alignSelf = 'center'
    this.compose.marginBottom = this.home.visible ? Math.max(0, Math.floor((this.renderer.height - 17 - topHeight) / 2)) : 0
    this.draft.height = Math.min(Math.max(2, this.draft.plainText.split('\n').length), Math.max(2, Math.min(6, this.renderer.height - 14)))
    this.attachmentList.height = Math.min(this.attachments.length, Math.max(1, Math.min(3, Math.floor(this.renderer.height / 6))))
    this.footer.content = this.connected
      ? 'Open web ↗'
      : 'Open web ↗ · reconnecting'
    this.footer.visible = this.renderer.width >= 46
    this.commandShortcut.content = 'Commands · ctrl+p'
    this.effort.visible = !narrow && !!this.host
    if (this.host) {
      this.model.content = (this.view?.conversation.mode === 'plan' ? 'Plan · Router · ' : 'Router · ') + (this.host.model ?? this.host.backend)
      this.effort.content = ' · ' + (this.host.effort ?? 'default')
    }
    this.syncCompanion()
    this.drawInputMode()
    this.sizeCompletions()
    if (this.modalPanel) { this.modalPanel.width = Math.min(78, this.renderer.width - 4); this.modalPanel.maxHeight = this.renderer.height - 2; this.drawMenu(false); this.modalRedraw?.() }
  }

  preferences(prefs: TerminalSettings) {
    this.prefs = prefs; this.palette = this.colors(); const p = this.palette
    this.renderer.setBackgroundColor(p.bg); this.frame.backgroundColor = p.bg
    this.compose.backgroundColor = p.panel; this.compose.borderColor = p.accent
    this.draft.backgroundColor = p.panel; this.draft.focusedBackgroundColor = p.panel
    this.draft.textColor = p.fg; this.draft.focusedTextColor = p.fg; this.draft.placeholderColor = p.muted
    this.draft.placeholder = 'Ask Roppo anything…'
    this.attachButton.content = '+ Attach'; this.attachButton.fg = p.muted; this.drawAttachments()
    this.model.fg = p.accent; this.effort.fg = p.accent; this.footer.fg = p.muted; this.commandShortcut.fg = p.muted; this.header.fg = p.fg; this.permissions.fg = p.muted
    this.activity.fg = p.accent; this.pending.fg = p.warm; this.jump.fg = p.accent
    this.completions.backgroundColor = p.panel
    for (const scope of ['keyword','function','string','markup.raw','markup.link']) this.style.registerStyle(scope, { fg: p.accent })
    this.style.registerStyle('default', { fg: p.fg })
    this.style.registerStyle('markup.heading', { fg: p.warm, bold: true })
    this.style.registerStyle('markup.strong', { fg: p.warm, bold: true })
    for (const [id, node] of this.messageNodes) {
      const user = this.view?.messages.find(m => m.id === id)?.role === 'user'
      node.box.backgroundColor = user ? p.panel : p.bg
      if (user) node.box.borderColor = p.accent
      node.body.fg = p.fg
    }
    this.home.getChildren().forEach((child, index) => {
      if (child instanceof TextRenderable) {
        child.fg = index ? p.muted : p.fg
        if (index) child.content = 'A little more room for your life.'
      }
    })
    for (const card of this.requestCards.values()) card.box.destroyRecursively()
    this.requestCards.clear()
    if (this.view) this.update(this.view)
    this.syncActivity(); this.resize()
  }
  settings(host: HostSettings) { this.host = host; this.permissions.content = host.approvalMode + ' · ' + 'permissions'; this.resize() }
  connection(connected: boolean) { this.connected = connected; this.resize() }
  setLoading(value: boolean) { if (!this.closed) { this.loading = value; this.syncActivity() } }
  attachmentFiles(): readonly DraftAttachment[] { return this.attachments }
  async addAttachment(path: string) {
    const file = await readAttachment(path)
    if (this.closed) return
    if (this.sending) throw Error('Wait for the current message to finish sending.')
    if (this.attachments.some(item => item.path === file.path)) return
    if (this.attachments.length >= chatUploadLimits.maxFiles) throw Error('Attach up to 32 files.')
    this.attachments = byName([...this.attachments, file], item => item.name)
    this.drawAttachments()
  }
  removeAttachment(path: string) {
    if (this.sending) return
    this.attachments = this.attachments.filter(file => file.path !== path); this.drawAttachments()
  }
  private drawAttachments() {
    for (const child of this.attachmentList.getChildren()) child.destroyRecursively()
    this.attachmentList.visible = this.attachments.length > 0
    for (const file of this.attachments) this.attachmentList.add(this.text(
      (this.sending ? '↑ ' : '× ') + file.name + ' · ' + attachmentSize(file.bytes), {
        height: 1, fg: this.palette.accent, selectable: false,
        onMouseDown: event => { if (event.button === 0) this.removeAttachment(file.path) }
      }))
    this.resize()
  }
  notice(message: string, error = false) {
    clearTimeout(this.noticeTimer)
    this.header.content = clean(message); this.header.fg = error ? this.palette.warm : this.palette.accent
    this.noticeTimer = setTimeout(() => { this.noticeTimer = undefined; if (!this.closed) this.resize() }, error ? 8000 : 3500)
    this.resize()
  }
  setDraft(value: string) { this.draft.setText(value); this.draft.gotoBufferEnd(); this.draft.focus() }
  latest() { this.transcript.scrollTo(Infinity); this.jump.visible = false; this.draft.focus() }

  update(view: Snapshot, prepend = false) {
    const first = this.transcript.getChildren()[0]
    const release = prepend && first ? this.transcript.anchor(first) : undefined
    this.view = view
    const visible = view.messages.filter(publicMessage)
    this.home.visible = visible.length === 0 && !routerProcessing(view) && !this.queuedInputs.length; this.transcript.visible = !this.home.visible
    const ids = new Set(visible.map(m => m.id))
    for (const [id, node] of this.messageNodes) if (!ids.has(id)) { node.box.destroyRecursively(); this.messageNodes.delete(id) }
    visible.forEach((message, index) => {
      const user = message.role === 'user', p = this.palette
      const attachments = message.attachments?.map(f => '@ ' + f.name).join('\n') ?? ''
      const delivered = message.deliveries?.map(f => '▤ ' + f.name + '  ·  /files').join('\n') ?? ''
      const value = clean([message.text, attachments, delivered].filter(Boolean).join('\n\n'))
      let node = this.messageNodes.get(message.id)
      if (!node) {
        const box = new BoxRenderable(this.renderer, { id: 'message-' + message.id, width: '100%', flexShrink: 0,
          backgroundColor: user ? p.panel : p.bg, ...(user ? { border: ['left'] as const, borderColor: p.accent } : {}),
          paddingX: user ? 1 : 2, paddingY: user ? 1 : 0 })
        const body = user ? this.text(value, { width: '100%', wrapMode: 'word', selectable: true })
          : new MarkdownRenderable(this.renderer, { width: '100%', content: value, fg: p.fg, syntaxStyle: this.style, streaming: message.status !== 'complete' })
        box.add(body); this.transcript.add(box, index)
        node = { box, body, value }; this.messageNodes.set(message.id, node)
      } else if (node.value !== value) { node.body.content = value; node.value = value }
      if (node.body instanceof MarkdownRenderable) node.body.streaming = message.status === 'streaming'
    })
    if (release) this.transcript.afterLayout(release)
    this.history = visible.filter(m => m.role === 'user').map(m => m.text)
    this.historyIndex = this.history.length
    const messageCards = [...view.messages, ...(view.earlierCards ?? []).filter(c => !view.messages.some(m => m.id === c.id))]
    const requests = view.approvals.filter(a => isApprovalPending(a)).length + messageCards.filter(m => m.fileReview?.state === 'pending' || m.decision && !m.decision.replyRunId && !m.decision.closed).length + (view.decisions ?? []).filter(d => d.status === 'pending').length
    this.pending.visible = requests > 0
    this.pending.content = (`${requests} awaiting your reply · ctrl+y review`)
    const cards = view.approvals.filter(a => isApprovalPending(a)).map(a => ({ id: a.id,
      text: ['Permission or reply needed', a.questions.map(q => q.question).join('\n'), ...Object.values(a.facts)].filter(Boolean).join('\n') }))
    for (const m of messageCards) {
      if (m.fileReview?.state === 'pending') cards.push({ id: m.id, text: 'Review file delivery' + ('text' in m ? ': ' + m.text : '') })
      else if (m.decision && !m.decision.replyRunId && !m.decision.closed) cards.push({ id: m.id, text: m.decision.question + '\n' + m.decision.options.map(o => '· ' + o.label).join('\n') })
    }
    for (const d of view.decisions ?? []) if (d.status === 'pending') cards.push({ id: d.id, text: d.question })
    for (const [id, card] of this.requestCards) if (!cards.some(c => c.id === id)) { card.box.destroyRecursively(); this.requestCards.delete(id) }
    for (const card of cards) {
      const previous = this.requestCards.get(card.id)
      if (previous?.value === card.text) continue
      previous?.box.destroyRecursively()
      const box = new BoxRenderable(this.renderer, { border: ['left'], borderColor: this.palette.warm,
        padding: 1, width: '100%', backgroundColor: this.palette.panel, flexShrink: 0 })
      box.add(this.text(card.text, { wrapMode: 'word', width: '100%' }))
      box.add(this.text('› Review and respond · ctrl+y', { fg: this.palette.accent, marginTop: 1,
        onMouseDown: () => this.run(this.actions.review()) }))
      this.transcript.add(box); this.requestCards.set(card.id, { box, value: card.text })
    }
    this.busy = !!(view.run && ['queued', 'running', 'cancel_requested'].includes(view.run.state)) || view.tasks.some(t => ['running', 'queued'].includes(t.state))
    if (view.run?.state === 'waiting' || requests) this.busy = false
    this.syncActivity(); this.resize()
    if (this.startupAt === undefined && !this.startupFinished) this.startStartup()
  }

  private syncActivity() {
    this.syncCompanion()
    const working = this.busy || this.loading
    this.activity.visible = working
    if (working && !this.started) this.started = Date.now()
    if (!working) this.started = 0
    if (working && this.prefs.motion !== 'reduced' && !this.pulse) this.pulse = setInterval(() => this.paintActivity(), 125)
    if ((!working || this.prefs.motion === 'reduced') && this.pulse) { clearInterval(this.pulse); this.pulse = undefined }
    if (working) this.paintActivity()
  }
  private syncCompanion() {
    if (this.startupAt !== undefined && (!this.companionBox.visible || this.prefs.motion === 'reduced' || !this.connected)) this.finishStartup()
    this.companion.update(this.view,this.connected,this.loading,this.companionBox.visible)
    const moving=this.companionBox.visible && this.prefs.motion !== 'reduced' && this.connected
    if(moving&&!this.companionPulse)this.companionPulse=setInterval(()=>this.paintCompanion(),100)
    if(!moving&&this.companionPulse){clearInterval(this.companionPulse);this.companionPulse=undefined}
    if(this.companionBox.visible)this.paintCompanion()
  }
  private paintCompanion() {
    const elapsed = this.startupAt === undefined ? undefined : Date.now() - this.startupAt
    const frame = elapsed !== undefined && elapsed < startupDuration
      ? { pixels: elapsed < tideDuration ? Array.from({length:companionRows*4},()=>Array<number>(companionWidth*2).fill(0)) : entryPixels(elapsed-tideDuration,true), label: elapsed < tideDuration ? '' : 'Hello again.' }
      : this.companion.frame(Date.now(),this.prefs.motion==='reduced')
    const colors=[this.palette.bg,this.palette.fg,this.palette.muted,this.palette.warm,this.palette.accent].map(c=>RGBA.fromHex(c))
    this.companionArt.content=new StyledText(brailleCells(frame.pixels).flatMap((row,index)=>[
      ...row.map(cell=>({__isChunk:true as const,text:cell.text,fg:colors[cell.color]})),
      ...(index<companionRows-1?[{__isChunk:true as const,text:'\n'}]:[])
    ]))
    let label=clean(frame.label),width=Math.min(32,this.renderer.width-4)
    while(stringWidth(label)>width-1)label=label.slice(0,-1)
    this.companionLabel.content=' '.repeat(Math.max(0,Math.floor((width-stringWidth(label))/2)))+label
    this.companionLabel.fg=this.palette.muted
  }
  private startStartup() {
    if (this.prefs.animation === false || this.prefs.motion === 'reduced' || !this.companionBox.visible || this.overlay || this.draft.plainText) {
      this.startupFinished = true; return
    }
    this.startupAt = Date.now()
    this.startupLayer = new BoxRenderable(this.renderer, { id: 'startup-tide', position: 'absolute', left: 0, top: 0,
      width: '100%', height: '100%', zIndex: 10,
      renderAfter: buffer => paintStartupTide(buffer, this.renderer.width, this.renderer.height, Date.now() - this.startupAt!, this.palette),
      onMouseDown: () => this.finishStartup(), onMouseScroll: () => this.finishStartup() })
    this.renderer.root.add(this.startupLayer)
    this.paintCompanion()
    this.startupPulse = setInterval(() => {
      const elapsed = Date.now() - this.startupAt!
      if (elapsed >= startupDuration) { this.finishStartup(); return }
      if (elapsed >= tideDuration) { this.startupLayer?.destroyRecursively(); this.startupLayer = undefined }
      else this.startupLayer?.requestRender()
      this.paintCompanion()
    }, 80)
  }
  private finishStartup() {
    this.startupFinished = true; this.startupAt = undefined
    clearInterval(this.startupPulse); this.startupPulse = undefined
    this.startupLayer?.destroyRecursively(); this.startupLayer = undefined
    if (this.companionBox.visible) this.paintCompanion()
  }
  private paintActivity() {
    const seconds = Math.floor((Date.now() - this.started) / 1000), head = Math.floor((Date.now() - this.started) / 125) % 12
    const bar = this.prefs.motion === 'reduced' ? '········' : Array.from({ length: 8 }, (_, i) => i <= head && i > head - 3 ? '■' : '⬝').join('')
    const label = this.loading ? 'Connecting' : this.view?.run?.state === 'cancel_requested' ? 'Stopping'
      : this.view?.reply ? 'Writing reply' : 'Working'
    this.activity.content = `${bar}  ${label}  ${seconds}s  · esc ${'interrupt'}`
  }
  private changed() {
    if (this.draft?.plainText && !this.startupFinished) this.finishStartup()
    this.resize()
    clearTimeout(this.completionTimer)
    const revision = ++this.completionRevision
    this.completionTimer = setTimeout(() => this.run((async () => {
      const items = await this.actions.complete(this.draft.plainText)
      if (this.closed || revision !== this.completionRevision || this.overlay) return
      this.completionItems = byName(items, item => item.label); this.completionIndex = 0; this.drawCompletions()
    })()), 80)
  }
  private drawCompletions() {
    for (const child of this.completions.getChildren()) child.destroyRecursively()
    this.completions.visible = this.completionItems.length > 0
    this.sizeCompletions()
    this.completionItems.forEach((item, index) => {
      this.completions.add(this.text((index === this.completionIndex ? '▎ ' : '  ') + item.label + '  ' + (item.detail ?? ''), {
        height: 1, paddingX: 1, bg: index === this.completionIndex ? this.palette.selected : this.palette.panel,
        selectable: false, onMouseDown: event => { if (event.button === 0) this.chooseCompletion(index) }
      }))
    })
    const selected = this.completions.getChildren()[this.completionIndex]
    if (selected) this.completions.scrollChildIntoView(selected)
  }
  private sizeCompletions() {
    this.completions.height = Math.min(this.completionItems.length, Math.max(2, Math.min(7, this.renderer.height - 14)))
  }
  private chooseCompletion(index: number) {
    const item = this.completionItems[index]; this.dismissCompletions()
    if (item) this.run(Promise.resolve(item.run()))
  }
  private dismissCompletions() { ++this.completionRevision; clearTimeout(this.completionTimer); this.completionItems = []; this.completions.visible = false }
  private submit() {
    const text = this.draft.plainText.trim(); if (this.sending || !text && !this.attachments.length) return
    if (this.completionItems.length) { this.chooseCompletion(this.completionIndex); return }
    this.draft.setText(''); this.dismissCompletions()
    const command = text.startsWith('/') && !text.includes('\n')
    if (!command) { this.sending = true; this.drawAttachments() }
    this.run((command ? this.actions.command(text) : this.actions.send(text, this.attachments.map(file => file.path),this.prefs.inputMode??'queue')).then(() => {
      if (!command) this.attachments = []
    }).catch(error => {
      if (!this.closed && !this.draft.plainText) this.setDraft(text)
      throw error
    }).finally(() => {
      if (!command) { this.sending = false; if (!this.closed) this.drawAttachments() }
    }))
  }

  private toggleInputMode() {
    const mode=this.prefs.inputMode==='steer'?'queue':'steer'
    this.actions.inputMode?.(mode);this.prefs={...this.prefs,inputMode:mode};this.drawInputMode()
  }
  private drawInputMode() {
    this.inputModeLabel.visible=routerProcessing(this.view)||this.queuedInputs.length>0
    this.inputModeLabel.content=(this.prefs.inputMode==='steer'?'Steer':'Queue')+(this.renderer.width>=110?' · enter submit · tab switch':this.renderer.width>=80?' · tab switch':' · tab')
    this.inputModeLabel.fg=this.palette.accent
  }
  inputQueue(items:QueuedInput[],paused:boolean,sending?:string) {
    this.queuedInputs=items.map(item=>({...item}));this.queuePaused=paused;this.queueSending=sending
    for(const child of this.queueBox.getChildren())child.destroyRecursively()
    this.queueBox.visible=items.length>0;this.queueBox.height=Math.min(items.length+1,Math.max(2,Math.min(5,Math.floor(this.renderer.height/5))))
    this.queueBox.add(this.text(`Queued · ${items.length}${paused?' · paused':''} · click to manage`,{height:1,fg:this.palette.muted,selectable:false,onMouseDown:()=>this.openQueue()}))
    items.forEach((item,i)=>this.queueBox.add(this.text(`${i+1}. ${item.error?'! ':''}${item.id===sending?'Sending… ':''}${item.text.replace(/\s+/g,' ')||'[attachments]'}${item.files.length?' · '+item.files.length+' files':''}`,{id:'queued-'+item.id,height:1,width:'100%',wrapMode:'none',selectable:false,fg:item.error?this.palette.warm:this.palette.fg,onMouseDown:event=>{if(event.button===0)this.queueItem(item.id)}})))
    if(this.view){this.home.visible=!this.view.messages.length&&!routerProcessing(this.view)&&!items.length;this.transcript.visible=!this.home.visible}
    this.resize()
  }
  openQueue() {
    this.menu({title:'Queued messages · '+(this.queuePaused?'paused':'automatic'),order:'source',items:[
      {label:this.queuePaused?'Resume queue':'Pause queue',run:()=>this.actions.queue?.('pause')},
      ...this.queuedInputs.map((item,i)=>({label:`${i+1}. ${item.text.replace(/\s+/g,' ')||'[attachments]'}`,detail:item.error??(item.files.length?item.files.length+' attached files':undefined),run:()=>this.queueItem(item.id)}))
    ],detail:'Local drafts · sent in this order after Router finishes'})
  }
  private queueItem(id:string) {
    const item=this.queuedInputs.find(item=>item.id===id)
    if(!item)return
    if(this.queueSending===id){this.notice('This message is being sent.');return}
    this.closeModal()
    this.run(this.actions.queue?.('hold',id)??Promise.resolve())
    const release=()=>{this.run(this.actions.queue?.('release',id)??Promise.resolve())}
    const act=async(action:'steer'|'delete'|'up'|'down')=>{try{await this.actions.queue?.(action,id)}finally{release()}}
    this.menu({title:'Queued message',cancel:release,items:[
      {label:'Steer now',run:()=>act('steer')},
      {label:'Edit',run:async()=>{
        await this.actions.queue?.('hold',id)
        this.prompt('Edit queued message',item.text,async text=>{try{await this.actions.queue?.('edit',id,text)}finally{await this.actions.queue?.('release',id)}},true,false,{submitOnEnter:true})
        this.modalCancel=()=>{this.run(this.actions.queue?.('release',id)??Promise.resolve())}
      }},
      {label:'Delete',run:()=>act('delete')},
      {label:'Move up',run:()=>act('up')},
      {label:'Move down',run:()=>act('down')}
    ],detail:item.error??item.text})
  }

  menu(menu: TuiMenu) {
    const panel = this.modal(menu.title)
    this.modalMenu = { ...menu, items: menu.order === 'source' ? menu.items : byName(menu.items, item => item.label) }; this.modalCancel = menu.cancel; this.modalIndex = 0
    this.modalSearch = new InputRenderable(this.renderer, { width: '100%', placeholder: 'Search…',
      backgroundColor: this.palette.panel, focusedBackgroundColor: this.palette.panel, textColor: this.palette.fg, focusedTextColor: this.palette.fg })
    this.modalSearch.on('input', () => { this.modalIndex = 0; this.filterMenu() })
    panel.add(this.modalSearch)
    this.modalRows = new ScrollBoxRenderable(this.renderer, { id: 'menu-items', width: '100%', marginTop: 1, minHeight: 1, flexShrink: 1, scrollX: false, verticalScrollbarOptions: { showArrows: false } })
    panel.add(this.modalRows)
    panel.add(this.text(menu.detail ?? 'scroll to browse · click to choose · ↑↓ enter · esc back', { fg: this.palette.muted, marginTop: 1, wrapMode: 'word' }))
    this.filterMenu(); this.modalSearch.focus()
  }
  effortSlider(title:string, levels:string[], current:string|null, save:(value:string|null)=>Promise<void>, defaultEffort?:string) {
    if (!levels.length) {
      this.document(title,'This model has no adjustable reasoning levels.',[
        {label:'Use model default',run:()=>save(null)}
      ]); return
    }
    const panel=this.modal(title)
    let selected=levels.includes(current??'')?current:null
    let index=Math.max(0,levels.indexOf(selected??defaultEffort??''))
    let columns=1, rows=5
    const started=Date.now()
    let tones:RGBA[]=[]
    const value=this.text('',{id:'effort-value',height:1,fg:this.palette.accent})
    const choose=(next:number)=>{index=Math.max(0,Math.min(levels.length-1,next));selected=levels[index]!;draw()}
    const submit=()=>{this.closeModal(false);this.run(save(selected))}
    const track=this.text('',{id:'effort-slider',height:5,marginTop:1,selectable:false,
      onMouseDown:event=>{if(event.button===0){event.preventDefault();choose(Math.round((event.x-track.x)/(columns-1)*(levels.length-1)));track.focus()}},
      onMouseDrag:event=>{event.preventDefault();choose(Math.round((event.x-track.x)/(columns-1)*(levels.length-1)))},
      onKeyDown:key=>{
        if(!['left','right','up','down','home','end','d','return'].includes(key.name)||key.ctrl||key.meta)return
        key.preventDefault();key.stopPropagation()
        if(key.name==='return')submit()
        else if(key.name==='d'){selected=null;index=Math.max(0,levels.indexOf(defaultEffort??''));draw()}
        else choose(key.name==='home'?0:key.name==='end'?levels.length-1:index+(['right','up'].includes(key.name)?1:-1))
      }
    })
    const range=this.text('',{id:'effort-levels',height:1,fg:this.palette.muted,selectable:false,
      onMouseDown:event=>{if(event.button===0){choose(Math.round((event.x-range.x)/(columns-1)*(levels.length-1)));track.focus()}}
    })
    const paint=()=>{
      const frame=effortTideFrame(columns,rows,levels.length,index,Date.now()-started,this.prefs.motion!=='reduced')
      track.content=new StyledText(frame.flatMap((row,y)=>[
        ...row.map(cell=>({__isChunk:true as const,text:cell.text,fg:cell.tone<0?RGBA.fromHex(this.palette.muted):tones[cell.tone]!})),
        ...(y<rows-1?[{__isChunk:true as const,text:'\n'}]:[])
      ]))
    }
    const draw=()=>{
      columns=Math.max(2,Math.min(74,this.renderer.width-8))
      rows=this.renderer.height>=20?5:this.renderer.height>=16?3:1
      track.width=columns;track.height=rows;range.width=columns
      tones=effortTideColors(levels[index]!,this.prefs.theme==='mono'?'mono':this.palette.bg===paletteFor('light').bg?'light':'dark').map(color=>RGBA.fromHex(color))
      value.fg=tones[0]!;confirm.fg=tones[0]!
      value.content=selected??'Model default'+(defaultEffort?' · '+defaultEffort:'')
      const labels=Array<string>(columns).fill(' ')
      let end=-1
      levels.forEach((level,i)=>{
        const x=Math.max(0,Math.min(columns-level.length,Math.round(i/Math.max(1,levels.length-1)*(columns-1)-level.length/2)))
        if(x<=end||i<levels.length-1&&x+level.length>=columns-levels.at(-1)!.length-1)return
        for(let j=0;j<level.length;j++)labels[x+j]=level[j]!
        end=x+level.length
      })
      range.content=labels.join('');help.visible=this.renderer.height>=16
      if(this.prefs.motion==='reduced'){clearInterval(this.modalPulse);this.modalPulse=undefined}
      else if(!this.modalPulse)this.modalPulse=setInterval(paint,50)
      paint()
    }
    panel.add(value);panel.add(track);panel.add(range)
    const actions=new BoxRenderable(this.renderer,{flexDirection:'row',gap:3,marginTop:1})
    actions.add(this.text('Default (D)',{id:'effort-default',height:1,selectable:false,onMouseDown:event=>{
      if(event.button===0){selected=null;index=Math.max(0,levels.indexOf(defaultEffort??''));draw();track.focus()}
    }}))
    const confirm=this.text('Confirm ↵',{id:'effort-confirm',fg:this.palette.accent,height:1,selectable:false,onMouseDown:event=>{if(event.button===0)submit()}})
    actions.add(confirm)
    panel.add(actions)
    const help=this.text('drag / ← → adjust · enter save · esc cancel',{fg:this.palette.muted,marginTop:1,wrapMode:'word'})
    panel.add(help)
    this.modalRedraw=draw;track.focusable=true;draw();track.focus()
  }
  private filterMenu() {
    const query = this.modalSearch?.value.toLowerCase() ?? ''
    this.modalItems = this.modalMenu?.items.filter(i => (i.label + ' ' + (i.detail ?? '') + ' ' + (i.search ?? '')).toLowerCase().includes(query)) ?? []
    this.drawMenu()
  }
  private drawMenu(revealSelection = true) {
    if (!this.modalRows) return
    for (const child of this.modalRows.getChildren()) child.destroyRecursively()
    const lines = this.modalItems.reduce((total, item) => total + (item.detail ? 2 : 1), 0)
    this.modalRows.height = Math.max(1, Math.min(lines, 20, this.renderer.height - 11))
    if (!this.modalItems.length) this.modalRows.add(this.text('No matching items', { fg: this.palette.muted }))
    this.modalItems.forEach((item, index) => {
      const row = new BoxRenderable(this.renderer, { width: '100%', height: item.detail ? 2 : 1, flexShrink: 0,
        backgroundColor: index === this.modalIndex ? this.palette.selected : this.palette.panel,
        paddingLeft: 1, onMouseDown: event => { if (event.button === 0) this.chooseMenu(index) } })
      row.add(this.text((index === this.modalIndex ? '▎ ' : '  ') + item.label, { height: 1, selectable: false }))
      if (item.detail) row.add(this.text('  ' + item.detail, { fg: this.palette.muted, height: 1, selectable: false }))
      this.modalRows!.add(row)
    })
    const selected = this.modalRows.getChildren()[this.modalIndex]
    if (selected && revealSelection) this.modalRows.scrollChildIntoView(selected)
  }
  private chooseMenu(index: number) {
    const item = this.modalItems[index]; if (!item) return
    this.closeModal(false); this.run(Promise.resolve(item.run()))
  }
  private modal(title: string) {
    if (!this.startupFinished) this.finishStartup()
    this.closeModal(); this.dismissCompletions(); this.draft.blur()
    const p = this.palette
    this.overlay = new BoxRenderable(this.renderer, { position: 'absolute', left: 0, top: 0, width: '100%', height: '100%',
      zIndex: 20, backgroundColor: '#00000099', justifyContent: 'center', alignItems: 'center' })
    const panel = new BoxRenderable(this.renderer, { width: Math.min(78, this.renderer.width - 4), maxHeight: this.renderer.height - 2,
      backgroundColor: p.panel, padding: 1, flexDirection: 'column' })
    this.modalPanel = panel
    const heading = new BoxRenderable(this.renderer, { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 1, flexShrink: 0 })
    heading.add(this.text(title, { fg: p.accent, flexShrink: 1 }))
    heading.add(this.text('esc', { fg: p.muted, onMouseDown: () => this.closeModal() }))
    panel.add(heading); this.overlay.add(panel); this.renderer.root.add(this.overlay)
    return panel
  }
  document(title: string, content: string, actions: TuiItem[] = []) {
    const panel = this.modal(title)
    const columns = Math.max(1, Math.min(78, this.renderer.width - 4) - 4)
    const lines = content.split('\n').reduce((count, line) => count + Math.max(1, Math.ceil(stringWidth(line) / columns)), 0)
    const scroll = new ScrollBoxRenderable(this.renderer, { height: Math.max(3, Math.min(lines, this.renderer.height - 10, 18)), minHeight: 1, flexShrink: 1, width: '100%', scrollX: false })
    scroll.add(this.text(content, { width: '100%', wrapMode: 'word', selectable: true })); panel.add(scroll)
    if (actions.length) {
      this.modalItems = byName(actions, item => item.label); this.modalMenu = { title, items: this.modalItems }; this.modalIndex = 0
      this.modalRows = new ScrollBoxRenderable(this.renderer, { id: 'menu-items', marginTop: 1, width: '100%', minHeight: 1, flexShrink: 1, scrollX: false, verticalScrollbarOptions: { showArrows: false } })
      panel.add(this.modalRows); this.drawMenu()
      panel.add(this.text('tab actions · enter choose', { fg: this.palette.muted }))
    }
    scroll.focus()
  }
  prompt(title: string, initial: string, submit: (value: string) => Promise<void>, multiline = false, secret = false, options: { allowEmpty?: boolean; cancel?: () => void; submitOnEnter?: boolean } = {}) {
    const panel = this.modal(title)
    this.modalCancel = options.cancel
    if (secret) {
      let value = initial
      const input = this.text('•'.repeat(value.length), { width: '100%', height: 1, bg: this.palette.selected, selectable: false,
        onKeyDown: key => {
          key.preventDefault(); key.stopPropagation()
          if (key.name === 'return') { if (value || options.allowEmpty) { const answer = value; value = ''; this.closeModal(false); this.run(submit(answer)) }; return }
          if (key.name === 'backspace') value = Array.from(value).slice(0, -1).join('')
          else if (key.ctrl && key.name === 'u') value = ''
          else if (!key.ctrl && !key.meta && !key.sequence.includes('\x1b') && key.sequence >= ' ') value += key.sequence
          input.content = '•'.repeat(Array.from(value).length)
        },
        onPaste: event => { event.preventDefault(); event.stopPropagation(); value += new TextDecoder().decode(event.bytes).replace(/[\r\n]/g, ''); input.content = '•'.repeat(Array.from(value).length) }
      })
      input.focusable = true; panel.add(input)
      panel.add(this.text('enter confirm · ctrl+u clear · esc cancel', { fg: this.palette.muted, marginTop: 1 }))
      input.focus(); return
    }
    const input = new TextareaRenderable(this.renderer, { width: '100%', height: multiline ? Math.max(3, Math.min(8, this.renderer.height - 10)) : 1,
      initialValue: initial, backgroundColor: this.palette.selected, focusedBackgroundColor: this.palette.selected,
      textColor: this.palette.fg, focusedTextColor: this.palette.fg,
      keyBindings: [{ name: 'return', ctrl: multiline && !options.submitOnEnter, action: 'submit' }, ...(options.submitOnEnter ? [{ name: 'return', shift: true, action: 'newline' as const }, { name: 'return', meta: true, action: 'newline' as const }, { name: 'j', ctrl: true, action: 'newline' as const }] : [])],
      onSubmit: () => { const value = input.plainText.trim(); if (!value && !options.allowEmpty) return; this.closeModal(false); this.run(submit(value)) }
    })
    panel.add(input)
    const newlineKey = process.env.TERM_PROGRAM === 'Apple_Terminal' ? 'ctrl+j' : 'shift+enter'
    panel.add(this.text(options.submitOnEnter ? `enter save · ${newlineKey} newline · esc cancel` : multiline ? 'ctrl+enter save · esc cancel' : 'enter confirm · esc cancel', { fg: this.palette.muted, marginTop: 1 }))
    if (options.submitOnEnter) panel.add(this.text('Insert newline', { fg: this.palette.accent, selectable: false, height: 1,
      onMouseDown: event => { if (event.button === 0) { event.preventDefault(); input.newLine(); input.focus() } }
    }))
    input.focus(); input.gotoBufferEnd()
  }
  closeModal(cancelled = true) {
    const cancel = this.modalCancel; this.modalCancel = undefined
    this.modalRedraw = undefined
    clearInterval(this.modalPulse);this.modalPulse=undefined
    this.overlay?.destroyRecursively(); this.overlay = undefined; this.modalSearch = undefined
    this.modalPanel = undefined; this.modalRows = undefined; this.modalMenu = undefined; this.modalItems = []; this.draft?.focus()
    if (cancelled) cancel?.()
  }
  private key = (key: KeyEvent) => {
    if (!this.startupFinished) this.finishStartup()
    const consume = () => { key.preventDefault(); key.stopPropagation() }
    if (key.ctrl && key.shift && key.name === 'c') {
      consume(); const text = this.renderer.getSelection()?.getSelectedText()
      if (text) {
        if (this.actions.copy) this.run(this.actions.copy(text))
        else this.renderer.copyToClipboardOSC52(text)
      }
      return
    }
    if (key.ctrl && key.name === 'c') { consume(); if (this.overlay) this.closeModal(); else if (this.busy) this.run(this.actions.interrupt()); else if (this.draft.plainText || this.attachments.length) { this.setDraft(''); if (!this.sending) { this.attachments = []; this.drawAttachments() } } else this.actions.quit(); return }
    if (key.name === 'escape') { consume(); if (this.overlay) this.closeModal(); else if (this.completionItems.length) this.dismissCompletions(); else this.run(this.actions.interrupt()); return }
    if (this.overlay) {
      if (this.modalItems.length && ['up', 'down', 'tab', 'return'].includes(key.name) && !key.ctrl && !key.meta) {
        consume()
        if (key.name === 'return') this.chooseMenu(this.modalIndex)
        else { this.modalIndex = (this.modalIndex + (key.name === 'up' || key.shift ? -1 : 1) + this.modalItems.length) % this.modalItems.length; this.drawMenu() }
      }
      return
    }
    if (key.ctrl && ['p', 'k', 'y', 'd', 'o'].includes(key.name)) {
      consume()
      if (key.name === 'd') { if (!this.draft.plainText && !this.attachments.length) this.actions.quit() }
      else this.run(key.name === 'y' ? this.actions.review() : this.actions.command(key.name === 'o' ? '/attach' : key.name === 'p' ? '/commands' : '/history'))
      return
    }
    if(key.name==='tab'&&!this.completionItems.length&&(routerProcessing(this.view)||this.queuedInputs.length)){consume();this.toggleInputMode();return}
    if (key.name === 'f2') { consume(); this.run(this.actions.command('/model')); return }
    if (key.ctrl && key.name === 'end') { consume(); this.latest(); return }
    if (['pageup', 'pagedown'].includes(key.name)) {
      consume(); this.transcript.scrollBy(key.name === 'pageup' ? -1 : 1, 'viewport')
      if (key.name === 'pageup' && this.transcript.scrollTop === 0) this.run(this.actions.older())
      return
    }
    if (this.completionItems.length && ['up', 'down', 'tab', 'return'].includes(key.name) && !key.shift) {
      consume(); if (['tab', 'return'].includes(key.name)) this.chooseCompletion(this.completionIndex)
      else { this.completionIndex = Math.max(0, Math.min(this.completionItems.length - 1, this.completionIndex + (key.name === 'up' ? -1 : 1))); this.drawCompletions() }
      return
    }
    if ((key.name === 'up' || key.name === 'down') && !this.draft.plainText.includes('\n') && (key.ctrl || !this.draft.plainText || this.historyIndex < this.history.length)) {
      consume(); if (this.historyIndex === this.history.length) this.scratch = this.draft.plainText
      this.historyIndex = Math.max(0, Math.min(this.history.length, this.historyIndex + (key.name === 'up' ? -1 : 1)))
      this.setDraft(this.history[this.historyIndex] ?? this.scratch)
    }
  }
  close() {
    clearInterval(this.modalPulse);this.modalPulse=undefined
    this.closed = true; clearInterval(this.startupPulse); this.startupLayer?.destroyRecursively(); clearInterval(this.companionPulse); clearInterval(this.pulse); clearTimeout(this.noticeTimer); clearTimeout(this.completionTimer)
    this.renderer.keyInput.off('keypress', this.key); this.renderer.off('resize', this.resize); this.renderer.off('theme_mode', this.themeChanged)
    this.overlay?.destroyRecursively(); this.frame.destroyRecursively(); this.style.destroy()
  }
}
