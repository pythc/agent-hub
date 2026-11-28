import {themeNames} from './themes.ts'
import { openLocalBrowser } from '../personal-launch.ts'
import { byName } from './list-order.ts'
import { attachmentPath } from './attachments.ts'
import { pickNativeFiles } from './file-picker.ts'
import {configureConnection,SetupCancelled} from './setup.ts'
import { randomUUID } from 'node:crypto'
import { readdir, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { TerminalClient, type Conversation, type Snapshot } from './client.ts'
import type { TuiScreen, TuiItem } from './tui-screen.ts'
import { controlCommand } from './controls.ts'
import { command } from './commands.ts'
import { publicMessage } from './conversation.ts'
import { isApprovalPending } from '../chat-workflow.ts'
import { saveTerminalSetting, type TerminalSettings } from './settings.ts'
import type { HostSettings } from './host-settings.ts'
import { reasoningEfforts, type ModelCapabilities } from '../reasoning-effort.ts'
import type { memoryWorkspace } from '../memory-workspace.ts'

export const personalCommands = () => byName([
  { name: '/input', label: 'Input mode', detail: 'Choose Queue or Steer for messages sent while Router is working' },
  { name: '/queue', label: 'Queued messages', detail: 'Edit, remove, reorder or steer pending input' },
  { name: '/attach', label: 'Attach files', detail: 'Choose local files to send · ctrl+o' },
  { name: '/connect', label: 'Model connections', detail: 'Add a provider or model connection and test it' },
  { name: '/workers', label: 'Workers', detail: 'Create, copy, pause, resume or remove' },
  { name: '/plugins', label: 'Plugins', detail: 'Installed plugins' },
  { name: '/skills', label: 'Skills', detail: 'Available skills' },
  { name: '/mcp', label: 'MCP', detail: 'Configured MCP servers' },
  { name: '/model', label: 'Models', detail: 'Choose Router or Worker model · F2' },
  { name: '/effort', label: 'Reasoning effort', detail: 'Model reasoning level' },
  { name: '/plan', label: 'Plan mode', detail: 'Clarify requirements, then make a detailed plan' },
  { name: '/compact', label: 'Compact context', detail: 'Summarize now or configure automatic compaction' },
  { name: '/clear', label: 'Clear conversation', detail: 'Confirm first; keep memory and schedules' },
  { name: '/rename', label: 'Rename a Worker', detail: 'Choose a Worker and edit its name' },
  { name: '/diff', label: 'Worker changes', detail: 'Choose a Worker and inspect its task changes' },
  { name: '/files', label: 'Files', detail: 'View and save conversation files' },
  { name: '/memory', label: 'Memory', detail: 'Review and edit personal memory' },
  { name: '/schedules', label: 'Scheduled actions', detail: 'Reminders and routines' },
  { name: '/approvals', label: 'Pending requests', detail: 'Permissions and questions · ctrl+y' },
  { name: '/permissions', label: 'Permissions', detail: 'Shared account access' },
  { name: '/animation', label: 'Companion animation', detail: 'Toggle the web-style companion on or off' },
  { name: '/settings', label: 'Settings', detail: 'Appearance and interaction' },
  { name: '/history', label: 'Search conversation', detail: 'Find a message · ctrl+k' },
  { name: '/tools', label: 'Capabilities', detail: 'Tools, skills and MCP servers' },
  { name: '/open', label: 'Open in browser', detail: 'Continue the same conversation' },
  { name: '/status', label: 'Connection status', detail: 'Local service and model' },
  { name: '/context', label: 'Context usage', detail: 'Measured usage' },
  { name: '/tasks', label: 'Execution details', detail: 'Inspect internal collaboration' },
  { name: '/help', label: 'Help', detail: 'Keys and commands' },
  { name: '/exit', label: 'Exit', detail: 'Keep the local service running' }
], command => command.name)

export class TuiCommands {
  private attachmentDirectory?: string
  private choosingFiles = false
  constructor(private client: TerminalClient, private conversation: Conversation, private screen: TuiScreen,
    private options: { cwd: string; preferences: TerminalSettings; settingsSources: string[] },
    private view: () => Snapshot, private refresh: () => Promise<void>,
    private quit: (next?: Conversation) => void, private older: () => Promise<void>,
    private pickFiles = pickNativeFiles) {}
  private path(suffix: string) { return '/api/chat/conversations/' + this.conversation.id + '/' + suffix }
  private async change(path: string, body: unknown, patch = false) {
    await this.client.request(path, body, patch ? { method: 'PATCH' } : {}); await this.refresh()
  }
  async complete(text: string): Promise<TuiItem[]> {
    if (/^\/[\w-]*$/.test(text)) {
      const prefix = text.toLowerCase()
      return personalCommands().filter(c => c.name.startsWith(prefix))
        .map(c => ({ label: c.name, detail: c.detail, run: () => { this.screen.setDraft(''); return this.execute(c.name) } }))
    }
    const mention = /(?:^|\s)@(?:"([^"\n]*)|([^\s"@]*))$/.exec(text)
    if (!mention) return []
    const fragment = mention[1] ?? mention[2] ?? '', expanded = fragment.startsWith('~/') ? join(homedir(), fragment.slice(2)) : resolve(this.options.cwd, fragment)
    const directory = fragment.endsWith('/') || !fragment ? expanded : dirname(expanded)
    const term = fragment.endsWith('/') ? '' : basename(fragment).toLowerCase()
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => [])
    return byName(entries.filter(e => !e.name.startsWith('.') && e.name.toLowerCase().includes(term) && (e.isFile() || e.isDirectory())), entry => entry.name).map(entry => {
        const path = join(directory, entry.name), prefix = text.slice(0, text.lastIndexOf('@'))
        return { label: entry.name + (entry.isDirectory() ? '/' : ''), detail: directory,
          run: async () => {
            if (entry.isDirectory()) this.screen.setDraft(prefix + '@"' + path + '/')
            else { await this.screen.addAttachment(path); this.screen.setDraft(prefix) }
          } }
      })
  }
  async execute(input: string): Promise<void> {
    if(input==='/queue'){this.screen.openQueue();return}
    if(input==='/input'){
      this.screen.menu({title:'Input mode',items: ['queue','steer'].map(mode=>({label:mode==='queue'?'Queue':'Steer',detail:mode==='queue'?'Wait for Router to finish':'Send an update to the current conversation',run:()=>{
        saveTerminalSetting(this.options.cwd,'inputMode',mode,'user');this.options.preferences={...this.options.preferences,inputMode:mode as 'queue'|'steer'};this.screen.preferences(this.options.preferences)
      }}))});return
    }
    this.screen.setLoading(true)
    try { await this.dispatch(input) } finally { this.screen.setLoading(false) }
  }
  private async dispatch(input: string): Promise<void> {
    const name = input.split(/\s/)[0]
    if (name === '/exit' || name === '/quit') { this.quit(); return }
    if (name === '/attach') {
      const path = input.slice(name.length).trim()
      if (path === '--browse') await this.attachFiles(this.attachmentDirectory ?? this.options.cwd)
      else if (path) await this.screen.addAttachment(attachmentPath(path, this.options.cwd))
      else await this.chooseFiles()
      return
    }
    if (name === '/commands' || name === '/') {
      this.screen.menu({ title: 'Commands', items: personalCommands().map(c => ({ label: c.label, detail: c.name + ' · ' + c.detail, run: () => this.execute(c.name) })) }); return
    }
    if (name === '/settings' || input === '/config') { this.settings(); return }
    if (name === '/model' || name === '/effort') { await this.agentSetting(name === '/model' ? 'model' : 'effort'); return }
    if (input === '/compact') { await this.compact(); return }
    if (name === '/connect') { await this.connect(); return }
    if (name === '/workers') { await this.workers(); return }
    if (['/plugins', '/skills', '/mcp'].includes(name!)) { await this.capabilities(name as '/plugins' | '/skills' | '/mcp'); return }
    if (name === '/rename') { await this.renameWorker(); return }
    if (name === '/diff') { this.workerDiff(); return }
    if (name === '/clear') { this.clearConversation(); return }
    if (name === '/plan') { this.planMode(); return }
    if (['/new', '/resume'].includes(name!)) { this.screen.notice('Roppo uses one personal conversation. Use /history to search it.'); return }
    if (input === '/open') {
      const url = this.client.link(this.conversation.id)
      const result = await openLocalBrowser(url)
      if (result.opened) this.screen.notice('Opened this conversation in your browser.')
      else this.screen.document('Open web', url)
      return
    }
    if (input === '/history') { this.history(); return }
    if (input === '/files') { this.files(); return }
    if (input === '/memory') { await this.memory(); return }
    if (input === '/schedules') { this.schedules(); return }
    if (input === '/approvals' || input === '/choose') { await this.review(); return }
    if (input === '/permissions full') {
      this.screen.menu({ title: 'Allow host-managed actions automatically?', detail: 'Applies to your shared account in web and CLI. Source sandbox limits still apply.', items: [
        { label: 'Keep asking', run: () => {} },
        { label: 'Enable full access', run: async () => {
          await this.client.request('/api/terminal/settings', { action: 'permissions', mode: 'full' }); await this.refresh()
        } }
      ] }); return
    }
    if (input === '/help') {
      this.screen.document('Keyboard shortcuts', [
        'Enter                 Send', 'Shift+Enter / Alt+Enter / Ctrl+J   New line',
        'Ctrl+O                Attach files',
        '/                     Commands', '@                     Attach local files',
        'Ctrl+P                Search commands', 'F2                    Models', 'Ctrl+K                Search conversation',
        'Ctrl+Y                Review pending requests', 'PageUp / PageDown     Read history', 'Ctrl+End              Back to latest',
        'Esc                   Close menu / interrupt request', 'Ctrl+D                Exit from an empty prompt',
        'Ctrl+Shift+C          Copy selected text', '', 'The local service continues working after you exit.'
      ].join('\n')); return
    }
    const control = await controlCommand(this.client, this.conversation, input, this.options.cwd, this.options.preferences, this.options.settingsSources)
    if (control) {
      if (control.next) { this.quit(control.next); return }
      if (control.preferences) {
        Object.assign(this.options.preferences, control.preferences)
        this.screen.preferences(this.options.preferences)
      }
      if (name === '/animation') { this.screen.notice(control.text!); return }
      if (control.menu) this.screen.menu({ title: control.menu.title, detail: control.text, items: control.menu.items.map(item => ({ label: item.label, detail: item.detail,
        run: () => this.execute(item.value) })) })
      else if (control.text) this.screen.document(name ?? 'Roppo', control.text)
      await this.refresh(); return
    }
    if (input === '/tools') {
      const library = await this.client.request<import('../capability-types.ts').CapabilitySnapshot>('/api/capability-library')
      this.screen.menu({ title: 'Capabilities', items: library.items.map(item => ({ label: item.name,
        detail: (item.sourceGroup ?? item.source) + ' · ' + item.kind,
        run: () => this.execute('/tools --inspect ' + encodeURIComponent(item.id)) })) }); return
    }
    const result = await command(this.client, this.conversation.id, input)
    if (result) this.screen.document(name ?? 'Roppo', result)
    await this.refresh()
  }
  private async chooseFiles() {
    if (this.choosingFiles) return
    this.choosingFiles = true
    const directory = this.attachmentDirectory ?? this.options.cwd
    try {
      const files = await this.pickFiles(directory)
      if (files === null) { await this.attachFiles(directory); return }
      for (const file of files) await this.screen.addAttachment(file)
      if (files[0]) this.attachmentDirectory = dirname(files[0])
    } catch (error) {
      this.screen.notice('Could not attach files: ' + (error as Error).message, true)
      await this.attachFiles(directory)
    } finally { this.choosingFiles = false }
  }
  private async attachFiles(directory: string) {
    const entries = await readdir(directory, { withFileTypes: true })
    this.attachmentDirectory = directory
    const attached = this.screen.attachmentFiles()
    const items: TuiItem[] = [
      { label: '../', detail: 'Parent folder', run: () => this.attachFiles(dirname(directory)) },
      { label: 'File path…', run: () => this.screen.prompt('Attach file', directory + '/', async value => {
        await this.screen.addAttachment(attachmentPath(value, this.options.cwd))
      }) },
      { label: 'Home folder/', detail: homedir(), run: () => this.attachFiles(homedir()) }
    ]
    if (attached.length) items.push({ label: 'Remove attachment…', run: () => this.screen.menu({
      title: 'Remove attachment', items: attached.map(file => ({
        label: file.name, detail: file.path, run: () => this.screen.removeAttachment(file.path)
      }))
    }) })
    for (const entry of entries.filter(e => !e.name.startsWith('.') && (e.isFile() || e.isDirectory()))) {
      const path = join(directory, entry.name)
      items.push({ label: entry.name + (entry.isDirectory() ? '/' : ''),
        detail: entry.isDirectory() ? 'Folder' : attached.some(file => file.path === path) ? 'Already attached' : undefined,
        run: () => entry.isDirectory() ? this.attachFiles(path) : this.screen.addAttachment(path) })
    }
    this.screen.menu({ title: 'Attach files', items,
      detail: directory + '\n' + 'Choose a file · /attach to add more · click × to remove' })
  }
  private async compact() {
    const state = await this.client.request<{settings:{automatic:boolean;threshold:number};last:{at:number;beforeBytes:number;afterBytes:number}|null;running:boolean}>(this.path('compact'))
    const settings = async (value: typeof state.settings) => { await this.client.request(this.path('compact'), {action:'settings',settings:value}); await this.compact() }
    this.screen.menu({title:'Context compaction', detail:'Keeps the transcript, memory and tasks. Summarizes older context; recent turns remain intact.', items:[
      {label:'Compact now', detail:state.running?'In progress':state.last?'Last compacted: '+new Date(state.last.at).toLocaleString():'',run:async()=>{
        this.screen.setLoading(true);this.screen.notice('Summarizing context…')
        try{const result=await this.client.request<{status:string;last:{beforeBytes:number;afterBytes:number}|null}>(this.path('compact'),{action:'compact'},{timeoutMs:310_000});await this.refresh();this.screen.notice(result.status==='unchanged'?'Not enough older context to compact yet.':'Context compacted. Original messages are still available.')}finally{this.screen.setLoading(false)}
      }},
      {label:'Automatic compaction'+' · '+(state.settings.automatic?'on':'off'),run:()=>settings({...state.settings,automatic:!state.settings.automatic})},
      {label:'Trigger threshold'+' · '+Math.round(state.settings.threshold*100)+'%',run:()=>this.screen.menu({title:'Compact before the next turn when usage reaches…',items:[0.6,0.7,0.8,0.9].map(threshold=>({label:Math.round(threshold*100)+'%'+(threshold===0.8?' · default':''),run:()=>settings({...state.settings,threshold})}))})}
    ]})
  }
  private async connect() {
    let detail = ''
    try {
      await configureConnection(this.client, {
        note: text => { detail = text; this.screen.notice(text) },
        choose: (title, choices) => new Promise((resolve, reject) => {
          this.screen.menu({ title, detail, cancel: () => reject(new SetupCancelled()), items: choices.map((label, i) => ({ label, run: () => resolve(i) })) }); detail = ''
        }),
        text: (title, options = {}) => new Promise((resolve, reject) => this.screen.prompt(title, options.initial ?? '', async value => { resolve(value) }, false, options.secret, { allowEmpty: true, cancel: () => reject(new SetupCancelled()) }))
      })
      await this.refresh()
    } catch (error) { if (!(error instanceof SetupCancelled)) throw error; this.screen.notice(error.message) }
  }
  private async workers() {
    const data = await this.client.request<Pick<ReturnType<import('../worker-manager.ts').WorkerManager['list']>, 'revision' | 'workers' | 'canCreate' | 'connections'>>('/api/terminal/workers')
    const change = async (body: object) => { await this.client.request('/api/terminal/workers', { ...body, revision: data.revision, requestId: randomUUID() }); await this.refresh(); await this.workers() }
    this.screen.menu({ title: 'Workers', detail: 'Shared with the web. Router can also manage Workers when authorized.', items: [
      ...(data.canCreate ? [{ label: 'Add a Worker', run: () => this.screen.prompt('Worker name', '', async label => {
        this.screen.menu({ title: 'Model connection', items: data.connections.map(connection => ({ label: connection.label ?? connection.id, run: () => change({ action: 'create', profile: { id: 'worker-' + randomUUID().slice(0, 8), label, backend: connection.id } }) })) })
      }) }] : []),
      ...data.workers.map(worker => ({ label: worker.label ?? worker.id, detail: worker.status + ' · ' + (worker.model ?? worker.backend), run: () => this.screen.menu({ title: worker.label ?? worker.id, items: [
        { label: 'Rename', run: () => this.screen.prompt('Worker name', worker.label ?? worker.id, async label => { await this.client.request('/api/terminal/settings', { action: 'rename', worker: worker.id, label, revision: data.revision }); await this.refresh(); await this.workers() }) },
        ...(data.canCreate ? [{ label: 'Duplicate', run: () => this.screen.prompt('Copy name', (worker.label ?? worker.id) + ' copy', label => change({ action: 'clone', from: worker.id, id: 'worker-' + randomUUID().slice(0, 8), patch: { label } })) }] : []),
        { label: worker.state === 'paused' ? 'Enable' : 'Pause new assignments', run: () => change({ action: worker.state === 'paused' ? 'resume' : 'pause', id: worker.id }) },
        { label: 'Remove Worker…', run: () => this.screen.menu({ title: 'Remove this Worker?', detail: 'History is retained. Finish or cancel its active tasks first.', items: [
          { label: 'Cancel', run: () => {} }, { label: 'Remove', run: () => change({ action: 'destroy', id: worker.id, cancelRunning: false }) }
        ] }) }
      ] }) }))
    ] })
  }
  private async capabilities(name: '/plugins' | '/skills' | '/mcp') {
    const kind = name === '/plugins' ? 'plugin' : name === '/skills' ? 'skill' : 'mcp'
    const library = await this.client.request<import('../capability-types.ts').CapabilitySnapshot>('/api/capability-library')
    const items = library.items.filter(item => item.kind === kind && item.status !== 'candidate')
    this.screen.menu({ title: name, detail: 'Installed/configured items. Ask Router to install, update or remove capabilities.', items: [
      { label: 'Ask Router to manage…', run: () => this.screen.setDraft('Help me manage ' + name.slice(1) + ': ') },
      ...items.map(item => ({ label: item.name, detail: [item.status, item.version, item.sourceGroup ?? item.source].filter(Boolean).join(' · '), run: () => this.screen.document(item.name, [item.description, ...(item.facts ?? []), ...byName(item.tools ?? [], tool => tool.name).map(tool => tool.name + (tool.description ? ' · ' + tool.description : ''))].filter(Boolean).join('\n'), [
        { label: 'Ask Router about this item', run: () => this.screen.setDraft('Help me manage ' + kind + ' “' + item.name + '” (' + item.source + '): ') }
      ]) }))
    ] })
  }
  private async agentSetting(action: 'model' | 'effort') {
    const settings = await this.client.request<HostSettings>('/api/terminal/settings')
    const choose = async (worker?: HostSettings['workers'][number]) => {
      const selected = worker ?? settings, label = worker?.label ?? 'Router'
      const save = async (value: object) => {
        await this.client.request('/api/terminal/settings', { action, revision: settings.revision, ...(worker ? { worker: worker.id } : {}), ...value })
        await this.refresh(); this.screen.notice('Updated: ' + label)
      }
      if (action === 'effort') {
        const catalog = await this.client.request<ModelCapabilities>('/api/terminal/models?' + new URLSearchParams({ backend: selected.backend, ...(selected.model ? { model: selected.model } : {}) }))
        this.screen.effortSlider(label + ' · ' + 'Reasoning effort',
          reasoningEfforts.filter(effort=>catalog.reasoning.efforts.includes(effort)),selected.effort??null,
          effort=>save({effort}),catalog.reasoning.defaultEffort); return
      }
      this.screen.menu({ title: label + ' · ' + 'Model connection', items: settings.connections.map(connection => ({
        label: connection.label, detail: connection.id === selected.backend ? '✓' : connection.kind, run: async () => {
          const catalog = await this.client.request<ModelCapabilities>('/api/terminal/models?' + new URLSearchParams({ backend: connection.id }))
          this.screen.menu({ title: label + ' · ' + connection.label, items: [
            { label: 'Connection default', run: () => save({ backend: connection.id }) },
            ...catalog.models.map(model => ({ label: model, detail: model === selected.model && selected.backend === connection.id ? '✓' : '', run: () => save({ backend: connection.id, model }) })),
            { label: 'Enter model ID…', run: () => this.screen.prompt('Model ID', '', model => save({ backend: connection.id, model })) }
          ] })
        }
      })) })
    }
    this.screen.menu({ title: 'Configure which agent?', items: [
      { label: 'Router', detail: settings.model ?? settings.backend, run: () => choose() },
      { label: 'Worker', detail: 'Choose a specific Worker', run: () => this.screen.menu({ title: 'Choose a Worker', items: settings.workers.map(w => ({ label: w.label, detail: (w.model ?? w.backend) + ' · ' + w.state, run: () => choose(w) })) }) }
    ] })
  }
  private async renameWorker() {
    const settings = await this.client.request<HostSettings>('/api/terminal/settings')
    this.screen.menu({ title: 'Rename which Worker?', items: settings.workers.map(w => ({
      label: w.label, detail: w.model ?? w.backend, run: () => this.screen.prompt('Worker name', w.label, async label => {
        await this.client.request('/api/terminal/settings', { action: 'rename', worker: w.id, revision: settings.revision, label })
        await this.refresh(); this.screen.notice('Renamed: ' + label)
      })
    })) })
  }
  private workerDiff() {
    const view = this.view()
    this.screen.menu({ title: 'Choose a Worker', items: view.workers.map(w => ({
      label: w.label, run: () => {
        const tasks = view.tasks.filter(t => t.workerId === w.id).sort((a, b) => b.updatedAt - a.updatedAt)
        this.screen.menu({ title: w.label + ' · ' + 'Changes', detail: tasks.length ? undefined : 'This Worker has no tasks in this conversation.', items: tasks.map(t => ({
          label: t.title, detail: t.state, run: async () => {
            const diff = await command(this.client, this.conversation.id, '/diff ' + t.id)
            this.screen.document(w.label + ' · ' + t.title, diff)
          }
        })) })
      }
    })) })
  }
  private clearConversation() {
    const expectedSequence = this.view().conversation.sequence
    this.screen.menu({ title: 'Clear this conversation?', detail: 'Clears messages and working context, after the current request has finished. Long-term memory and scheduled actions are kept. This cannot be undone.', items: [
      { label: 'Cancel', run: () => {} },
      { label: 'Confirm clear', run: async () => {
        await this.client.request('/api/terminal/clear', { conversation: this.conversation.id, expectedSequence, operationId: randomUUID() })
        await this.refresh(); this.screen.setDraft(''); this.screen.notice('Conversation cleared. Memory and schedules kept.')
      } }
    ] })
  }
  private planMode() {
    const active = this.view().conversation.mode === 'plan'
    this.screen.menu({ title: 'Conversation mode', detail: 'Plan: clarify requirements first, then produce a detailed plan. No Worker execution. Switching back does not start work automatically.', items: [
      { label: 'Plan · clarify and design', detail: active ? '✓' : '', run: () => this.change('/api/terminal/mode', { conversation: this.conversation.id, mode: 'plan' }) },
      { label: 'Act · normal conversation', detail: active ? '' : '✓', run: () => this.change('/api/terminal/mode', { conversation: this.conversation.id, mode: 'act' }) }
    ] })
  }
  private settings() {
    const save = (key: string, value: string) => {
      const { patch } = saveTerminalSetting(this.options.cwd, key, value)
      Object.assign(this.options.preferences, patch)
      this.screen.preferences(this.options.preferences); this.settings()
    }
    this.screen.menu({ title: 'Settings', detail: 'Appearance is local. Agent settings are shared with the web.', items: [
      { label: 'Color mode', detail: this.options.preferences.theme ?? 'system', run: () => this.screen.menu({ title: 'Color mode', items: themeNames.map(theme => ({ label: theme, run: () => save('theme', theme) })) }) },
      { label: 'Top companion', detail: this.options.preferences.animation === false ? 'off' : 'on', run: () => this.execute('/animation') },
      { label: 'Animations', detail: this.options.preferences.motion === 'reduced' ? 'off' : 'on', run: () => save('motion', this.options.preferences.motion === 'reduced' ? 'full' : 'reduced') },
      { label: 'Model connections', run: () => this.execute('/connect') },
      { label: 'Workers', run: () => this.execute('/workers') },
      { label: 'Models', detail: 'Router / Worker', run: () => this.execute('/model') },
      { label: 'Reasoning effort', detail: 'Router / Worker', run: () => this.execute('/effort') },
      { label: 'Rename a Worker', run: () => this.execute('/rename') },
      { label: 'Permissions', run: () => this.execute('/permissions') },
      { label: 'Context compaction', run: () => this.execute('/compact') },
      { label: 'Connection details', run: () => this.execute('/status') }
    ] })
  }
  private history() {
    this.screen.menu({ title: 'Search this conversation', order: 'source', items: [
      { label: 'Load earlier messages', run: async () => { await this.older(); this.history() } },
      ...this.view().messages.filter(publicMessage).map(m => ({ label: m.text.replace(/\s+/g, ' ').slice(0, 160),
        search: m.text, detail: m.role === 'user' ? 'You' : 'Roppo', run: () => this.screen.transcript.scrollChildIntoView('message-' + m.id, { align: 'start' }) }))
    ] })
  }
  private files() {
    const items = this.view().deliveries.map(file => ({ label: file.name, detail: file.mime + ' · ' + Math.ceil(file.size / 1024) + ' KB', run: () => this.file(file) }))
    this.screen.menu({ title: 'Conversation files', items, detail: items.length ? 'Choose a file to preview or save.' : 'No files yet. Attach with @ or ask Roppo to create one.' })
  }
  private async file(file: Snapshot['deliveries'][number]) {
    const path = this.path('deliveries/' + file.id)
    const bytes = await this.client.request<Uint8Array>(path, undefined, { bytes: true })
    const content = file.preview === 'text' ? new TextDecoder().decode(bytes.slice(0, 32000)) + (bytes.length > 32000 ? '\n… [preview truncated]' : '')
      : file.mime + ' · ' + file.size + ' bytes. Save to open with your preferred app.'
    this.screen.document(file.name, content, [{ label: 'Save file…', run: () => {
      this.screen.prompt('Save to path (existing files are kept)', join(homedir(), 'Downloads', basename(file.name)), async value => {
        const destination = value.startsWith('~/') ? join(homedir(), value.slice(2)) : resolve(this.options.cwd, value)
        await writeFile(destination, bytes, { flag: 'wx', mode: 0o600 })
        this.screen.notice('Saved: ' + destination)
      })
    } }])
  }
  private schedules() {
    this.screen.menu({ title: 'Scheduled actions', items: [
      { label: 'Create a reminder in chat', run: () => this.screen.setDraft('Remind me to ') },
      ...this.view().schedules.map(plan => ({ label: plan.name, detail: (plan.active ? 'on' : 'paused') + (plan.nextAt ? ' · ' + new Date(plan.nextAt).toLocaleString() : ''), run: () => {
        this.screen.document(plan.name, plan.prompt + '\n\n' + JSON.stringify(plan.timing, null, 2) + (plan.lastResult ? '\n\n' + plan.lastResult.text : ''), [{
          label: plan.active ? 'Pause this schedule' : 'Resume this schedule',
          run: async () => { await this.change(this.path('schedules'), { id: plan.id, expectedRevision: plan.revision, operationId: randomUUID(), active: !plan.active }, true); this.schedules() }
        }, { label: 'Change instructions in chat', run: () => this.screen.setDraft('Update my scheduled action ' + '“' + plan.name + '” ' ) }])
      } }))
    ], detail: 'The local service runs these even when the terminal is closed.' })
  }
  private async memory() {
    const workspace = await this.client.request<ReturnType<typeof memoryWorkspace>>('/api/chat/memory')
    const contexts = workspace.contexts.filter(c => c.conversationId)
    const items: TuiItem[] = contexts.flatMap(context => context.items.filter(f => !f.archived).map(fact => ({ label: fact.content,
      detail: fact.kind + ' · ' + fact.state, run: () => this.screen.document('Memory', fact.content, [
        { label: 'Edit memory', run: () => this.screen.prompt('Edit memory', fact.content, async content => {
          await this.client.request('/api/chat/memory', { entryId: context.id, action: 'edit', id: fact.id, revision: fact.revision, content }); await this.memory()
        }, true) },
        { label: 'Forget this memory…', run: () => this.screen.menu({ title: 'Forget this memory?', detail: fact.content, items: [
          { label: 'Keep it', run: () => this.memory() },
          { label: 'Forget', run: async () => { await this.client.request('/api/chat/memory', { entryId: context.id, action: 'forget', id: fact.id, revision: fact.revision }); await this.memory() } }
        ] }) }
      ]) })))
    this.screen.menu({ title: 'Personal memory · shared with web', items,
      detail: items.length ? 'Choose a memory to review, edit or forget.' : 'No personal memories yet. Tell Roppo what you want it to remember.' })
  }
  async review() {
    const view = this.view()
    const items: TuiItem[] = view.approvals.filter(a => isApprovalPending(a)).map(a => ({ label: a.questions[0]?.question ?? a.facts.command ?? a.facts.reason ?? 'Review action',
      run: () => this.approval(a) }))
    const cards = [...view.messages, ...(view.earlierCards ?? []).filter(c => !view.messages.some(m => m.id === c.id))]
    for (const m of cards.filter(m => m.decision && !m.decision.closed && !m.decision.replyRunId)) items.push({ label: m.decision!.question, run: () => {
      this.screen.menu({ title: m.decision!.question, items: [
        ...m.decision!.options.map(o => ({ label: o.label, detail: o.detail, run: () => this.change(this.path('decisions'), { messageId: m.id, answer: o.label }) })),
        { label: 'Write my own reply…', run: () => this.screen.prompt(m.decision!.question, '', answer => this.change(this.path('decisions'), { messageId: m.id, answer })) }
      ] })
    } })
    for (const decision of view.decisions ?? []) if (decision.status === 'pending') items.push({ label: decision.question, detail: decision.target.label, run: () => {
      const terms = [decision.summary, decision.question, decision.target.label,
        decision.target.recipient?.label, decision.target.amount ? decision.target.amount.value + ' ' + decision.target.amount.currency : ''].filter(Boolean).join('\n\n')
      this.screen.document('Your decision', terms, [{ label: 'Write a reply…', run: () => this.screen.prompt(decision.question, '', text =>
        this.change(this.path('decisions'), { action: 'answer', id: decision.id, version: decision.version, requestId: randomUUID(), text })) }])
    } })
    for (const m of cards.filter(m => m.fileReview?.state === 'pending')) items.push({ label: 'Review file: ' + ('text' in m ? m.text : 'Pending delivery'), run: async () => {
      const file = await this.client.request<{ text: string }>(this.path('file-reviews') + '?message=' + encodeURIComponent(m.id))
      this.screen.document('File delivery', file.text, ['approved', 'denied'].map(state => ({ label: state === 'approved' ? 'Approve delivery' : 'Decline delivery',
        run: () => this.change(this.path('file-reviews'), { messageId: m.id, state }) })))
    } })
    if (items.length === 1) await items[0]!.run()
    else this.screen.menu({ title: 'Pending requests', items, detail: items.length ? undefined : 'Nothing needs your reply.' })
  }
  private approval(a: Snapshot['approvals'][number]) {
    if (a.questions.length) {
      const answers: Record<string, { answers: string[] }> = {}
      const next = (index: number) => {
        const question = a.questions[index]
        if (!question) { this.screen.run(this.change(this.path('approvals'), { id: a.id, value: answers })); return }
        const answer = async (text: string) => { answers[question.id] = { answers: [text] }; next(index + 1) }
        this.screen.menu({ title: question.question, items: [
          ...question.options.map(o => ({ label: o.label, detail: o.detail, run: () => answer(o.label) })),
          ...(question.custom ? [{ label: 'Write a reply…', run: () => this.screen.prompt(question.question, '', answer, false, question.secret) }] : [])
        ] })
      }
      next(0); return
    }
    this.screen.document('Permission needed', Object.entries(a.facts).map(([key, value]) => key + ': ' + value).join('\n\n'), [
      { label: 'Allow once', run: () => this.change(this.path('approvals'), { id: a.id, value: 'accept' }) },
      { label: 'Decline', run: () => this.change(this.path('approvals'), { id: a.id, value: 'decline' }) }
    ])
  }
}
