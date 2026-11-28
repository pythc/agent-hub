import { z } from 'zod'
import { configuredReasoningEffort, reasoningOverride } from '../agent-options.ts'
import { reasoningEfforts } from '../reasoning-effort.ts'
import type { BackendDefinition } from '../backend-config.ts'
import type { Runtime } from '../runtime.ts'
import { ChatError } from '../chat-errors.ts'
import { SettingsError } from '../settings.ts'
import { workerProfiles } from '../worker-pool.ts'

const worker = z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/)
const revision = z.number().int().nonnegative()
export const terminalHostChange = z.discriminatedUnion('action', [
  z.object({ action: z.literal('model'), revision, worker: worker.optional(), backend: worker, model: z.string().trim().min(1).max(300).optional() }).strict(),
  z.object({ action: z.literal('effort'), revision, worker: worker.optional(), effort: z.enum(reasoningEfforts).nullable() }).strict(),
  z.object({ action: z.literal('rename'), revision, worker, label: z.string().trim().min(1).max(100) }).strict(),
  z.object({ action: z.literal('permissions'), mode: z.enum(['ask', 'full']) }).strict()
])
export function terminalHostSettings(runtime: Runtime, owner: string) {
  const { config, revision } = runtime.settings.current()
  const backend = config.execution.router?.backend ?? config.execution.roles.router ?? config.execution.backend
  const definition = config.backends[backend]
  const definitions: Record<string, BackendDefinition> = { codex: { kind: 'codex' }, ...config.backends }
  return {
    revision, backend,
    model: config.execution.router?.model ?? config.models.router ?? definition?.model ?? (backend === 'codex' ? config.model : undefined),
    effort: configuredReasoningEffort(definition?.kind ?? 'codex', config.execution.router, definition?.defaults, definition && 'parameters' in definition ? definition.parameters : undefined, config.effort),
    approvalMode: runtime.chat.space(owner).approvalMode,
    workers: workerProfiles(config).map(w => {
      const d = definitions[w.backend]
      return { id: w.id, label: w.label ?? w.id, backend: w.backend, state: w.state ?? 'enabled',
        model: w.model ?? d?.model ?? (w.backend === 'codex' ? config.model : undefined),
        effort: configuredReasoningEffort(d?.kind ?? 'codex', w, d?.defaults, d && 'parameters' in d ? d.parameters : undefined, config.effort) }
    }),
    connections: Object.entries(definitions).map(([id, d]) => ({ id, label: d.label ?? id, kind: d.kind, model: d.model }))
  }
}
export type HostSettings = ReturnType<typeof terminalHostSettings>
export function changeTerminalHostSettings(runtime: Runtime, owner: string, change: z.infer<typeof terminalHostChange>) {
  if (change.action === 'permissions') {
    runtime.chat.setApprovalMode(owner, change.mode)
    return terminalHostSettings(runtime, owner)
  }
  const { config, revision } = runtime.settings.current()
  if (change.revision !== revision) throw new SettingsError('settings_conflict', 'Settings changed. Open the picker again.', 409)
  const workers = workerProfiles(config).map(w => ({ ...w }))
  const selected = change.worker ? workers.find(w => w.id === change.worker) : undefined
  if (change.worker && !selected) throw new ChatError('worker_missing', 'Worker no longer exists. Open the picker again.', 404)
  if (change.action === 'rename') {
    selected!.label = change.label
    runtime.updateSettings(revision, { execution: { ...config.execution, workers } })
    return terminalHostSettings(runtime, owner)
  }
  const current = selected?.backend ?? config.execution.router?.backend ?? config.execution.roles.router ?? config.execution.backend
  const backend = change.action === 'model' ? change.backend : current
  if (backend !== 'codex' && !Object.hasOwn(config.backends, backend)) throw Error('Unknown model connection: ' + backend)
  const profile = selected ?? { ...config.execution.router, backend }
  if (change.action === 'model') {
    if (backend !== current) { delete profile.parameters; delete profile.nativeTool }
    profile.backend = backend; profile.model = change.model
  }
  Object.assign(profile, reasoningOverride(config.backends[backend]?.kind ?? 'codex', profile.parameters, change.action === 'effort' ? change.effort : null))
  runtime.updateSettings(revision, selected ? { execution: { ...config.execution, workers } } : {
    execution: { ...config.execution, router: profile },
    ...(change.action === 'model' ? { models: Object.fromEntries(Object.entries(config.models).filter(([key]) => key !== 'router')) } : {})
  })
  return terminalHostSettings(runtime, owner)
}
