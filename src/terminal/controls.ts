import {themeNames} from './themes.ts'
import { TerminalClient, CliError, type Conversation } from './client.ts'
import type { HostSettings } from './host-settings.ts'
import type { ModelCapabilities } from '../reasoning-effort.ts'
import type { Choice } from './suggestions.ts'
import { saveTerminalSetting, type TerminalSettings } from './settings.ts'
import { isApprovalPending } from '../chat-workflow.ts'

export interface ControlResult {
  text?: string
  menu?: { title: string; items: Choice[] }
  next?: Conversation
  preferences?: TerminalSettings
}
const shared = () => 'Shared with web · applies to future Router turns'
export async function controlCommand(client: TerminalClient, conversation: Conversation, input: string,
  cwd: string, preferences: TerminalSettings, sources: string[]): Promise<ControlResult | undefined> {
  const [name, ...args] = input.trim().split(/\s+/)
  if (name === '/animation') {
    const saved=saveTerminalSetting(cwd,'animation',String(preferences.animation===false))
    if(!sources.includes(saved.path))sources.push(saved.path)
    return {preferences:saved.patch,text:saved.patch.animation?'Companion animation on':'Companion animation off'}
  }
  if (name === '/config' || name === '/theme') {
    if (name === '/theme' && args[0]) args[0] = 'theme=' + args[0]
    if (args.length) {
      const [assignment, scope = 'user', ...extra] = args
      const match = /^([a-zA-Z]+)=(.+)$/.exec(assignment!)
      if (!match || extra.length || !['user', 'project', 'local'].includes(scope))
        throw new CliError('Use /config key=value [user|project|local].')
      const saved = saveTerminalSetting(cwd, match[1]!, match[2]!, scope as 'user' | 'project' | 'local')
      if (!sources.includes(saved.path)) sources.push(saved.path)
      return { preferences: saved.patch, text: 'Saved: ' + saved.path }
    }
    const title = name === '/theme' ? 'Theme' : 'Terminal settings · user defaults'
    const items: Choice[] = themeNames.map(value => ({ label: 'theme = ' + value,
      detail: preferences.theme === value ? '✓' : '', value: '/config theme=' + value }))
    if (name === '/config') items.push(
      { label: 'verbose = ' + !preferences.verbose, detail: 'Execution details', value: '/config verbose=' + !preferences.verbose },
      { label: 'motion = ' + (preferences.motion === 'reduced' ? 'full' : 'reduced'), detail: 'Activity animations', value: '/config motion=' + (preferences.motion === 'reduced' ? 'full' : 'reduced') },
      { label: '/model', detail: shared(), value: '/model' },
      { label: '/permissions', detail: 'Shared account permissions', value: '/permissions' }
    )
    return { menu: { title, items }, text: JSON.stringify(preferences, null, 2) + '\n' + sources.join('\n') }
  }
  if (name === '/status') {
    const [settings, view] = await Promise.all([client.request<HostSettings>('/api/terminal/settings'), client.view(conversation.id)])
    return { text: [
      'Roppo · ' + client.base,
      'Session: ' + conversation.id,
      ...(conversation.project ? ['Project: ' + conversation.project] : ['Personal conversation · shared with web']),
      'Router: ' + settings.backend + ' / ' + (settings.model ?? 'default'),
      'Permissions: ' + settings.approvalMode + ' (shared account)',
      'Readiness: ' + view.readiness.code,
      'Terminal settings: ' + (sources.join(', ') || 'defaults')
    ].join('\n') }
  }
  if (name === '/approvals' && args.length <= 1) {
    const view = await client.view(conversation.id)
    const pending = view.approvals.filter(a => isApprovalPending(a))
    if (!pending.length && !args.length) return { text: 'No pending requests.' }
    if (!args.length) return { menu: {
      title: 'Actions awaiting your permission',
      items: pending.map(a => ({
        label: a.facts.command ?? a.questions[0]?.question ?? a.facts.reason ?? 'Review permission',
        detail: a.facts.cwd ?? '', value: '/approvals ' + a.id
      }))
    } }
    const request = pending.find(a => a.id === args[0])
    if (!request) return undefined // Preserve explicit task-level diagnostic commands.
    if (request.method === 'item/tool/requestUserInput') return { text:
      request.questions.map(q => q.question).join('\n') + '\n' + 'Open the conversation to answer: ' + client.link(conversation.id) }
    return { text: Object.entries(request.facts).map(([key, value]) => key + ': ' + value).join('\n'),
      menu: { title: request.facts.command ?? request.facts.reason ?? 'Allow this action?', items: [
      { label: 'Allow', detail: request.facts.cwd ?? '', value: '/approve ' + request.ticketId + ' ' + request.id },
      { label: 'Decline', detail: '', value: '/decline ' + request.ticketId + ' ' + request.id }
    ] } }
  }
  if (name === '/compact') {
    const path='/api/chat/conversations/'+conversation.id+'/compact'
    if (!args.length || args[0]==='now') {
      const result=await client.request<{status:string}>(path,{action:'compact'},{timeoutMs:310_000})
      return {text:result.status==='unchanged'?'No older context to compact yet.':'Context compacted; original messages are retained.'}
    }
    const current=await client.request<{settings:{automatic:boolean;threshold:number}}>(path)
    const settings={...current.settings}
    if(args.length===2&&args[0]==='auto'&&['on','off'].includes(args[1]!))settings.automatic=args[1]==='on'
    else if(args.length===2&&args[0]==='threshold'&&Number(args[1])>=50&&Number(args[1])<=95)settings.threshold=Number(args[1])/100
    else throw Error('/compact [now | auto on/off | threshold 50–95]')
    await client.request(path,{action:'settings',settings})
    return {text:'Auto: '+(settings.automatic?'on':'off')+' · '+Math.round(settings.threshold*100)+'%'}
  }
  if (name === '/context') {
    const context = await client.request<{ inputTokens: number | null; capacity: number | null; model: string | null; previous: boolean; budget: {bytes: number; maxBytes: number} | null }>('/api/chat/conversations/' + conversation.id + '/context')
    return { text: [context.model ?? 'Router',
      context.inputTokens === null ? 'No token measurement yet.' : 'Input tokens: ' + context.inputTokens + (context.capacity ? ' / ' + context.capacity : ''),
      context.budget ? 'Context bytes: ' + context.budget.bytes + ' / ' + context.budget.maxBytes : '',
      context.previous ? 'Showing the previous measured turn.' : ''
    ].filter(Boolean).join('\n') }
  }
  if (name === '/model' || name === '/effort' || name === '/permissions') {
    const settings = await client.request<HostSettings>('/api/terminal/settings')
    if (name === '/permissions') {
      if (!args.length) return { menu: { title: 'Permissions · shared with web and all account sessions', items: [
        { label: 'Ask before restricted actions', detail: settings.approvalMode === 'ask' ? '✓' : '', value: '/permissions ask' },
        { label: 'Full access', detail: 'Automatically allow host-managed actions; source sandbox still applies', value: '/permissions full' }
      ] } }
      if (args.length !== 1 || !['ask', 'full'].includes(args[0]!)) throw new CliError('Use /permissions ask|full')
      await client.request('/api/terminal/settings', { action: 'permissions', mode: args[0] })
      return { text: 'Account permissions: ' + args[0] + ' · ' + shared() }
    }
    if (name === '/effort') {
      if (args.length) {
        if (args.length !== 1) throw new CliError('Use /effort LEVEL|default')
        await client.request('/api/terminal/settings', { action: 'effort', revision: settings.revision, effort: args[0] === 'default' ? null : args[0] })
        return { text: 'Reasoning effort: ' + args[0] + ' · ' + shared() }
      }
      const query = new URLSearchParams({ backend: settings.backend, ...(settings.model ? { model: settings.model } : {}) })
      const catalog = await client.request<ModelCapabilities>('/api/terminal/models?' + query)
      return { menu: { title: 'Reasoning effort · ' + shared(), items: [
        { label: 'default', detail: 'Let the model choose', value: '/effort default' },
        ...catalog.reasoning.efforts.map(level => ({ label: level, detail: settings.effort === level ? '✓' : '', value: '/effort ' + level }))
      ] } }
    }
    if (!args.length) return { menu: { title: 'Model connection · ' + shared(), items: settings.connections.map(c => ({
      label: c.label, detail: [c.id === settings.backend ? '✓' : '', c.kind, c.model].filter(Boolean).join(' · '), value: '/model ' + c.id
    })) } }
    const [backend, model, ...extra] = args
    if (!settings.connections.some(c => c.id === backend) || extra.length) throw new CliError('Use /model CONNECTION [MODEL|--default]')
    if (!model) {
      const catalog = await client.request<ModelCapabilities>('/api/terminal/models?' + new URLSearchParams({ backend: backend! }))
      return { menu: { title: backend + ' · ' + shared(), items: [
        { label: 'Connection default', detail: '', value: '/model ' + backend + ' --default' },
        ...catalog.models.map(id => ({ label: id, detail: backend === settings.backend && id === settings.model ? '✓' : '', value: '/model ' + backend + ' ' + id }))
      ] }, text: catalog.catalogUnavailable ? 'Model catalog unavailable. You can enter /model CONNECTION MODEL directly.' : undefined }
    }
    await client.request('/api/terminal/settings', { action: 'model', revision: settings.revision, backend, ...(model === '--default' ? {} : { model }) })
    return { text: backend + ' / ' + model + ' · ' + shared() }
  }
  if (['/clear', '/rename', '/diff', '/plan'].includes(name!))
    return { text: 'Open the interactive terminal to choose and confirm this operation.' }
  if (name === '/resume' || name === '/new')
    return { text: 'Roppo uses one personal conversation. Use /history to search it.' }
}
