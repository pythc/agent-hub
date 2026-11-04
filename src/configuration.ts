import type {Runtime} from './runtime.ts'
import {patchSchema} from './settings.ts'
import type {BackendDefinition} from './backend-config.ts'

/** Local configuration inventory. This never queries a model or reads secret values. */
export function configurationSnapshot(runtime:Runtime){
 const config=runtime.config
 const definitions:Record<string,BackendDefinition>={codex:{kind:'codex'},...config.backends}
 return {
  current:runtime.settings.current(),history:runtime.settings.history(),
  editableKeys:Object.keys(patchSchema.shape),
  restartRequiredKeys:['backends','stateDir','port','codex','turnTimeoutMs','sources.deployment'],
  sourceEditableKeys:['allowedActors','allowedBots','enabled','admission','listenScopes','pollSeconds','memberSync'],
  backendCatalog:Object.entries(definitions).map(([id,definition])=>({
   id,kind:definition.kind,nativeTakeover:definition.kind==='codex',
   images:definition.kind==='codex'||definition.images,
   ...(definition.kind==='codex'?{}:{model:definition.model,endpoint:definition.baseUrl}),
   remoteVerified:false,
  })),
  sourceCapabilities:[...runtime.sources.values()].map(source=>({source:source.config.id,kind:source.config.kind,enabled:source.config.enabled,memberDirectory:!!source.members})),
  liveSources:runtime.store.list('source-live'),
 }
}
