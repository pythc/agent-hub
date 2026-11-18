import {z} from 'zod'

export const RECOVERY_PACKAGE_MAX_BYTES=16384
export const recoveryPayloadSchema=z.object({
 format:z.literal('agent-hub-recovery-diagnostic'),schema:z.literal(1),application:z.literal('0.10.0'),
 taskAlias:z.string().uuid(),execution:z.enum(['active','stopped','unknown']),unknownEffects:z.boolean(),
 session:z.enum(['original_inspectable','unavailable']),
 nextSafeAction:z.enum(['reconcile_effects','wait_for_current_work','answer_approval','review_context','repair_blocker','review_result','inspect_original_session','inspect_state']),
 checkpoints:z.array(z.object({stage:z.enum(['tool','acceptance','delivery']),origin:z.enum(['transition','baseline'])}).strict()).max(3),
 scope:z.literal('retained_local_observation'),excluded:z.literal('content_credentials_paths_sessions_and_remote_verification'),replayAllowed:z.literal(false),
}).strict().superRefine((value,ctx)=>{
 if(new Set(value.checkpoints.map(c=>c.stage)).size!==value.checkpoints.length)ctx.addIssue({code:'custom',message:'Duplicate checkpoint'})
 if(value.unknownEffects&&value.nextSafeAction!=='reconcile_effects')ctx.addIssue({code:'custom',message:'Uncertain effects require reconciliation'})
 if(value.nextSafeAction==='inspect_original_session'&&value.session!=='original_inspectable')ctx.addIssue({code:'custom',message:'Session unavailable'})
})
export const recoveryPackageSchema=z.object({payload:recoveryPayloadSchema,sha256:z.string().regex(/^[a-f0-9]{64}$/)}).strict()
export type RecoveryPackage=z.infer<typeof recoveryPackageSchema>
