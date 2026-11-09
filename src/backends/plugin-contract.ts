import {z} from 'zod'
const id=z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/)
const jsonObject=z.record(z.string(),z.unknown())
export const backendPackageReferences=z.array(z.object({directory:z.string().min(1),digest:z.string().regex(/^[a-f0-9]{64}$/)}).strict()).default([])
export const backendCapabilitiesSchema=z.object({
 resume:z.boolean(),tools:z.boolean(),managed:z.boolean(),contextBudget:z.boolean(),
 steering:z.boolean(),promptRefresh:z.boolean(),images:z.boolean(),nativeTakeover:z.boolean(),
 history:z.boolean(),purge:z.boolean(),modelCatalog:z.boolean(),
}).strict()
export const backendManifestSchema=z.object({
 apiVersion:z.literal(1),type:z.literal('execution-backend'),id,label:z.string().min(1).max(100),
 version:z.string().regex(/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/),stateVersion:z.number().int().positive(),
 entry:z.literal('plugin.mjs'),codeSha256:z.string().regex(/^[a-f0-9]{64}$/),
 configSchema:jsonObject,parametersSchema:jsonObject,capabilities:backendCapabilitiesSchema,
 network:z.boolean(),environment:z.array(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/)).max(100),
}).strict()
export type BackendManifest=z.infer<typeof backendManifestSchema>
export type BackendCapabilities=z.infer<typeof backendCapabilitiesSchema>
export const backendErrorCodes=['auth_required','provider_rejected','quota_exhausted','rate_limited','transient','cancelled','invalid_output','unsupported','process_failed','outcome_unknown','configuration_invalid','context_budget_exceeded'] as const
export type BackendErrorCode=typeof backendErrorCodes[number]
// Only bounded protocol metadata crosses the sandbox. Never forward stderr,
// provider messages, tool arguments or credential-bearing exception text.
export const backendDiagnosticSchema=z.object({
 operation:z.enum(['initialize','probe','run','history','purge','expose','catalog','control','tool','transport']),
 reason:z.enum(['exception','timeout','process_exit','spawn_error','rpc_rejected','repository_push_unconfirmed']),
 nativeMethod:z.enum(['initialize','account/read','thread/start','thread/resume','thread/read','thread/archive','thread/unarchive','thread/delete','thread/inject_items','turn/start','turn/steer','turn/interrupt','config/read','model/list']).optional(),
 rpcCode:z.number().int().optional(),exitCode:z.number().int().nullable().optional(),
}).strict()
export type BackendDiagnostic=z.infer<typeof backendDiagnosticSchema>
// Goal recovery currently consumes durable error strings. Preserve the typed
// failure's meaning there: an unknown effect must never look like poor output
// and trigger a new plan/session that bypasses the original effect fence.
const recoveryMeaning:Partial<Record<BackendErrorCode,string>>={
 outcome_unknown:'uncertain execution outcome; reconciliation required',
 process_failed:'execution interrupted before a confirmed result',
 cancelled:'execution interrupted',
 auth_required:'credentials required',
 provider_rejected:'forbidden by provider',
 configuration_invalid:'invalid configuration or credentials',
 unsupported:'permission or capability unavailable',
}
export class BackendPluginError extends Error {
 constructor(readonly code:BackendErrorCode,readonly backendId:string,readonly diagnostic?:BackendDiagnostic){super('Execution backend '+backendId+': '+code+(recoveryMeaning[code]?' ('+recoveryMeaning[code]+')':'')+(diagnostic?' ['+diagnostic.operation+'/'+diagnostic.reason+(diagnostic.nativeMethod?'/'+diagnostic.nativeMethod:'')+']':''));this.name='BackendPluginError'}
}
export const backendEnvelope=z.discriminatedUnion('type',[
 z.object({type:z.literal('result'),id:z.number().int().positive(),result:z.unknown().optional(),error:z.object({code:z.enum(backendErrorCodes),diagnostic:backendDiagnosticSchema.optional()}).strict().optional()}).strict(),
 z.object({type:z.literal('event'),event:z.enum(['thread','turn','model','configuration','capabilities','progress','output','budget','contextReady','active','inputRead']),value:z.unknown().optional()}).strict(),
 z.object({type:z.literal('request'),id:z.number().int().positive(),method:z.enum(['tool','human','retain']),params:jsonObject}).strict(),
])
export const backendResult=z.object({threadId:z.string().min(1).max(1000),turnId:z.string().min(1).max(1000),text:z.string().min(1).max(8_000_000)}).strict()
