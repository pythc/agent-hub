import {backendPackages} from './backends/plugin-package.ts'
import {isApiBackend} from './backend-config.ts'
import type {Runtime} from './runtime.ts'
import {patchSchema} from './settings.ts'
import type {BackendDefinition} from './backend-config.ts'

/** Local configuration inventory. This never queries a model or reads secret values. */
export function configurationSnapshot(runtime:Runtime){
 const config=runtime.config,packages=backendPackages(config)
 const definitions:Record<string,BackendDefinition>={codex:{kind:'codex'},...config.backends}
 return {
  decisionCalls:runtime.decision.records(),
  current:runtime.settings.current(),history:runtime.settings.history(),
  editableKeys:Object.keys(patchSchema.shape),
  restartRequiredKeys:['stateDir','port','codex','turnTimeoutMs','sources.deployment','sourcePlugins','backendPlugins','backends.pluginDeployment','toolConnections'],
  adapterCatalog:runtime.sourceRegistry.catalog(),toolConnections:runtime.toolConnections.configured(),
  sourceEditableKeys:['allowedActors','allowedBots','enabled','admission','listenScopes','pollSeconds','memberSync'],
  backendCatalog:Object.entries(definitions).map(([id,definition])=>({
   id,kind:definition.kind,nativeTakeover:definition.kind==='codex'||definition.kind==='plugin'&&!!packages.get(definition.plugin)?.manifest.capabilities.nativeTakeover,
   images:definition.kind==='codex'||(definition.kind==='plugin'?!!packages.get(definition.plugin)?.manifest.capabilities.images:definition.images),
   ...(isApiBackend(definition)?{model:definition.model,endpoint:definition.baseUrl}:definition.kind==='plugin'?{model:definition.model,plugin:definition.plugin,capabilities:packages.get(definition.plugin)?.manifest.capabilities}:{}),
   remoteVerified:false,
  })),
  sourceCapabilities:[...runtime.sources.values()].map(source=>({source:source.config.id,kind:source.config.kind,enabled:source.config.enabled,...source.config.capabilities,memberDirectory:!!source.members})),
  liveSources:runtime.store.list('source-live'),
 }
}
