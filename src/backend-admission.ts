import type {Config} from './config.ts'
import {isApiBackend,type AgentOptions,type BackendDefinition} from './backend-config.ts'
import {mergeOptions} from './agent-options.ts'
import {backendPackages} from './backends/plugin-package.ts'
import {BackendPluginError} from './backends/plugin-contract.ts'

export const managedRequirements=['managed','tools','resume','history','contextBudget'] as const
/** Resource ceilings, not currency estimates. Defaults are preferences; limits are host policy. */
export function boundedBackendOptions(id:string,d:BackendDefinition,requested:AgentOptions={},defaultTimeout=300000):AgentOptions{
 const options=mergeOptions(d.defaults,requested),limits=d.limits
 if(!limits)return options
 if(!isApiBackend(d)&&[limits.maxOutputTokens,limits.maxSteps,limits.maxToolCalls].some(v=>v!==undefined))throw new BackendPluginError('unsupported',id)
 for(const key of ['timeoutMs','maxOutputTokens','maxSteps','maxToolCalls'] as const){
  const cap=limits[key];if(cap===undefined)continue
  // Explicit over-budget selections are rejected, never silently changed to another model or backend.
  if(options[key]!==undefined&&options[key]!>cap)throw new BackendPluginError('quota_exhausted',id)
  const fallback=key==='timeoutMs'?defaultTimeout:isApiBackend(d)?d[key]:undefined
  options[key]=options[key]??Math.min(fallback??cap,cap)
 }
 return options
}
export function backendAdmission(config:Config,id:string){
 const d=config.backends[id]??(id==='codex'?{kind:'codex' as const}:undefined)
 if(!d)throw Error('Unknown execution backend')
 const caps=d.kind==='plugin'?backendPackages(config).get(d.plugin)?.manifest.capabilities:undefined
 const missing=d.kind==='plugin'?managedRequirements.filter(k=>caps?.[k]!==true):[]
 const unsupportedLimits=!isApiBackend(d)&&[d.limits?.maxSteps,d.limits?.maxToolCalls,d.limits?.maxOutputTokens].some(v=>v!==undefined)
 return {managedEligible:!missing.length&&!unsupportedLimits,managedMissing:missing,
  continuation:d.kind==='plugin'&&caps?.resume!==true?'new_task_only':'bound_session',
  limits:d.limits??{},unsupportedLimits,cost:'not_estimated' as const}
}
export function checkWorkerAdmission(config:Config,id:string,options:AgentOptions={}){
 const a=backendAdmission(config,id)
 if(!a.managedEligible)throw new BackendPluginError('unsupported',id)
 const d=config.backends[id]??{kind:'codex' as const}
 boundedBackendOptions(id,d,options,config.turnTimeoutMs)
 return a
}
