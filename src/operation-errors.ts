import {backendErrorCodes,type BackendErrorCode} from './backends/plugin-contract.ts'

export type Operation='backend_stream'|'tool_initialize'|'tool_catalog'
export type OperationErrorCode=BackendErrorCode|'operation_failed'
const codes:ReadonlySet<string>=new Set(backendErrorCodes)
const labels:Record<Operation,string>={backend_stream:'Backend stream failed',tool_initialize:'Tool connection initialization failed',tool_catalog:'Tool catalog failed'}
// Preserve existing goal-recovery meaning without accepting provider prose or
// introducing a TransientModelError (which would add automatic runtime retries).
const meaning:Partial<Record<BackendErrorCode,string>>={
 outcome_unknown:'uncertain execution outcome; reconciliation required',
 process_failed:'execution interrupted before a confirmed result',
 cancelled:'execution interrupted',auth_required:'credentials required',
 provider_rejected:'forbidden by provider',configuration_invalid:'invalid configuration or credentials',
 unsupported:'permission or capability unavailable',
}
export function operationErrorCode(value:unknown):OperationErrorCode {
 return typeof value==='string'&&codes.has(value)?value as BackendErrorCode:'operation_failed'
}
/** A fresh host-owned error; never retain an original message, stack, cause or body. */
export class OperationError extends Error {
 readonly code:OperationErrorCode
 constructor(readonly operation:Operation,code:unknown){
  const safe=operationErrorCode(code),detail=safe==='operation_failed'?(operation==='backend_stream'?'provider_error':'operation_failed'):safe
  super(labels[operation]+': '+detail+(safe!=='operation_failed'&&meaning[safe]?' ('+meaning[safe]+')':''))
  this.name='OperationError';this.code=safe
 }
}
