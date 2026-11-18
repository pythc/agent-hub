import type {RecoveryManifest} from '../../src/recovery-manifest.ts'
import type {TraceTask} from '../../src/execution-trace.ts'
const actions=['reconcile_effects','wait_for_current_work','answer_approval','review_context','repair_blocker','review_result','inspect_original_session','inspect_state']
/** Read-only presentation contract; never use this projection to enable an action. */
export function readRecoveryManifest(value:unknown,task:Pick<TraceTask,'id'|'revision'|'observed'|'unknownEffects'|'status'|'actions'>):RecoveryManifest|null{
 const m=value as RecoveryManifest
 if(!Array.isArray(task.actions))return null
 if(!m||m.schema!==1||m.ticketId!==task.id||!Number.isSafeInteger(m.settingsRevision)||m.settingsRevision<0||m.settingsRevision!==task.revision||typeof m.observation!=='string'||!/^[a-f0-9]{64}$/.test(m.observation)||m.observation!==task.observed||m.replayAllowed!==false||m.checkpointScope!=='retained_ticket_history'||!['original_inspectable','unavailable'].includes(m.session)||!actions.includes(m.nextSafeAction)||!Array.isArray(m.checkpoints)||m.checkpoints.length>3)return null
 if((m.session==='original_inspectable')!==task.actions.includes('read_history')||(m.nextSafeAction==='inspect_original_session'&&m.session!=='original_inspectable'))return null
 if((task.unknownEffects||task.status?.effects?.state==='unknown'||task.status?.delivery?.state==='uncertain')&&m.nextSafeAction!=='reconcile_effects')return null
 const seen=new Set<string>(),checkpoints:RecoveryManifest['checkpoints']=[]
 for(const point of m.checkpoints){
  if(!point||!['tool','acceptance','delivery'].includes(point.stage)||seen.has(point.stage)||!Number.isSafeInteger(point.cursor)||point.cursor<1||!['baseline','transition'].includes(point.origin))return null
  seen.add(point.stage);checkpoints.push({stage:point.stage,cursor:point.cursor,origin:point.origin})
 }
 // Copy only safe typed fields. Opaque identity/observation values are not rendered.
 return {schema:1,ticketId:m.ticketId,settingsRevision:m.settingsRevision,observation:m.observation,session:m.session,nextSafeAction:m.nextSafeAction,replayAllowed:false,checkpointScope:'retained_ticket_history',checkpoints}
}
