/** Bundle this contract with the adapter. No host store or task-control API is passed to plugins. */
export type {ModelRequest,ModelResult,Model,NativeControl,ToolSpec,ToolContent} from '../src/model.ts'
export type {ModelUsage} from '../src/model-usage.ts'
export type {BackendCapabilities,BackendManifest,BackendErrorCode} from '../src/backends/plugin-contract.ts'
import type {Model} from '../src/model.ts'
export interface BackendPlugin {
 create(config:Record<string,unknown>,context:{dataDirectory:string}):Model & {
  probe?():Promise<{available:boolean;authenticated:boolean|'unknown';remoteVerified:false;version?:string;accountIdentity?:string}>
 }
}
export class BackendAdapterError extends Error {
 constructor(readonly code:import('../src/backends/plugin-contract.ts').BackendErrorCode,readonly diagnostic?:import('../src/backends/plugin-contract.ts').BackendDiagnostic){super(code)}
}
