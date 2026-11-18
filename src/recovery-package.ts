import {createHash,randomUUID} from 'node:crypto'
import type {TraceTask} from './execution-trace.ts'
import {RECOVERY_PACKAGE_MAX_BYTES,recoveryPayloadSchema,recoveryPackageSchema,type RecoveryPackage} from './recovery-package-contract.ts'

/** Canonical key order, independent of JSON input property order. Array order is significant. */
function canonical(value:unknown):string {
 if(Array.isArray(value))return '['+value.map(canonical).join(',')+']'
 if(value!==null&&typeof value==='object')return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical((value as Record<string,unknown>)[key])).join(',')+'}'
 return JSON.stringify(value)
}
const checksum=(value:unknown)=>createHash('sha256').update(canonical(value)).digest('hex')
/** Explicit allowlist only. Never spread a task, manifest, evidence or error into this package. */
export function createRecoveryPackage(task:TraceTask):RecoveryPackage {
 const recovery=task.recovery
 if(!recovery)throw Error('Recovery diagnostic unavailable')
 const unknownEffects=task.unknownEffects||task.status.effects.state==='unknown'||task.status.delivery.state==='uncertain'
 const payload=recoveryPayloadSchema.parse({
  format:'agent-hub-recovery-diagnostic',schema:1,application:'0.10.0',taskAlias:randomUUID(),
  execution:['ended','cancelled'].includes(task.state)?'stopped':['running','starting','background','queued'].includes(task.state)?'active':'unknown',
  unknownEffects,session:recovery.session,nextSafeAction:unknownEffects?'reconcile_effects':recovery.nextSafeAction,
  checkpoints:recovery.checkpoints.map(c=>({stage:c.stage,origin:c.origin})),
  scope:'retained_local_observation',excluded:'content_credentials_paths_sessions_and_remote_verification',replayAllowed:false,
 })
 return {payload,sha256:checksum(payload)}
}
/** Validates data only. Integrity is not authenticity, authority or current remote state. */
export function verifyRecoveryPackage(text:string){
 try{
  if(Buffer.byteLength(text,'utf8')>RECOVERY_PACKAGE_MAX_BYTES)throw Error()
  const value=recoveryPackageSchema.parse(JSON.parse(text))
  if(checksum(value.payload)!==value.sha256)throw Error()
  return {valid:true as const,integrity:'checksum_matches' as const,authenticity:'not_verified' as const,
   scope:value.payload.scope,unknownEffects:value.payload.unknownEffects,nextSafeAction:value.payload.nextSafeAction,
   checkpointStages:value.payload.checkpoints.map(c=>c.stage),
   gaps:['task_content_excluded','credentials_and_configuration_excluded','session_and_file_references_excluded','history_may_be_incomplete','remote_outcomes_not_verified','observation_may_be_stale'] as const,
   steps:value.payload.unknownEffects?['reconcile_remote_outcomes','inspect_current_authorized_host','obtain_fresh_authorization_before_action']:['inspect_current_authorized_host','check_missing_evidence','obtain_fresh_authorization_before_action'],
   replayAllowed:false as const,restorationSupported:false as const}
 }catch{throw Error('Invalid recovery diagnostic package')}
}
