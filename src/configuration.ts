import {backendAdmission} from './backend-admission.ts'
import {backendPackages} from './backends/plugin-package.ts'
import {isApiBackend} from './backend-config.ts'
import type {Runtime} from './runtime.ts'
import {patchSchema} from './settings.ts'
import type {BackendDefinition} from './backend-config.ts'
import {connectionChecks,subscriptionOwners} from './connection-library.ts'

/** Local configuration inventory. Never queries a model or exposes secret values. */
export function configurationSnapshot(runtime:Runtime){
 const config=runtime.config,packages=backendPackages(config)
 const definitions:Record<string,BackendDefinition>={codex:{kind:'codex'},...config.backends}
 return {
  decisionCalls:runtime.decision.records(),
  connectionChecks:connectionChecks(runtime),subscriptionOwners:subscriptionOwners(runtime),
  current:runtime.settings.current(),history:runtime.settings.history(),
  editableKeys:Object.keys(patchSchema.shape),
  retiredWorkerIds:runtime.store.list<{profile:{id:string}}>('retired-worker').map(w=>w.profile.id),
  restartRequiredKeys:['stateDir','port','codex','turnTimeoutMs','sources.deployment','sourcePlugins','backendPlugins','backends.pluginDeployment','toolConnections'],
  adapterCatalog:runtime.sourceRegistry.catalog(),toolConnections:runtime.toolConnections.configured(),
  sourceEditableKeys:['allowedActors','allowedBots','enabled','admission','listenScopes','pollSeconds','memberSync'],
  backendCatalog:Object.entries(definitions).map(([id,definition])=>{const admission=backendAdmission(config,id);return {
   id,kind:definition.kind,nativeTakeover:definition.kind==='codex'||definition.kind==='plugin'&&!!packages.get(definition.plugin)?.manifest.capabilities.nativeTakeover,
   images:definition.kind==='codex'||(definition.kind==='plugin'?!!packages.get(definition.plugin)?.manifest.capabilities.images:definition.images),
   ...(isApiBackend(definition)?{model:definition.model,endpoint:definition.baseUrl}:definition.kind==='plugin'?{model:definition.model,plugin:definition.plugin,capabilities:packages.get(definition.plugin)?.manifest.capabilities,managedEligible:['managed','tools','resume','history','contextBudget'].every(key=>packages.get(definition.plugin)?.manifest.capabilities[key as keyof import('./backends/plugin-contract.ts').BackendCapabilities]===true),managedMissing:['managed','tools','resume','history','contextBudget'].filter(key=>packages.get(definition.plugin)?.manifest.capabilities[key as keyof import('./backends/plugin-contract.ts').BackendCapabilities]!==true)}:{}),
   admission,managedEligible:admission.managedEligible,managedMissing:admission.managedMissing,remoteVerified:false,
  }}),
  sourceCapabilities:[...runtime.sources.values()].map(source=>({source:source.config.id,kind:source.config.kind,enabled:source.config.enabled,...source.config.capabilities,memberDirectory:!!source.members})),
  liveSources:runtime.store.list('source-live'),
 }
}
