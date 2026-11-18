import type {Store} from './store.ts'
import type {TraceTask} from './execution-trace.ts'

export const checkpointQuery = "SELECT seq, json_extract(body,'$.baseline') AS baseline FROM audit WHERE json_valid(body) AND json_extract(body,'$.type')='execution.trace' AND json_extract(body,'$.schema')=1 AND json_extract(body,'$.ticketId')=? AND json_extract(body,'$.stage')=? AND (json_extract(body,'$.stage')!='tool' OR COALESCE(json_extract(body,'$.callKind'),'tool')='tool') ORDER BY seq DESC LIMIT 1"

export interface RecoveryManifest {
 schema:1
 ticketId:string
 settingsRevision:number
 observation:string
 session:'original_inspectable'|'unavailable'
 nextSafeAction:'reconcile_effects'|'wait_for_current_work'|'answer_approval'|'review_context'|'repair_blocker'|'review_result'|'inspect_original_session'|'inspect_state'
 replayAllowed:false
 checkpoints:{stage:'tool'|'acceptance'|'delivery';cursor:number;origin:'transition'|'baseline'}[]
 checkpointScope:'retained_ticket_history'
}
/** A redacted recovery index, not an executable restore file or a grant.
 * Checkpoints refer to existing transactional audit records. They attest only
 * to local recorded transitions, never remote success or complete history. */
export function recoveryManifest(store:Store,task:TraceTask):RecoveryManifest {
 const nextSafeAction:RecoveryManifest['nextSafeAction']=task.unknownEffects||task.status.effects.state==='unknown'||task.status.delivery.state==='uncertain'?'reconcile_effects'
  :task.pendingApprovals?'answer_approval'
  :task.next==='review_context'?'review_context'
  :task.next==='reconnect'||task.blocker?.retryPolicy.mode==='after_repair'?'repair_blocker'
  :['held','partial','dropped'].includes(task.status.delivery.state)?'inspect_state'
  :['ended','cancelled'].includes(task.state)?'review_result'
  :['running','queued'].includes(task.status.execution.state)||['pending','retry_wait','sending'].includes(task.status.delivery.state)?'wait_for_current_work'
  :task.actions.includes('read_history')?'inspect_original_session':'inspect_state'
 const checkpoints:RecoveryManifest['checkpoints']=[]
 for(const stage of ['tool','acceptance','delivery'] as const){
  const row=store.db.prepare(checkpointQuery).get(task.id,stage)
  if(row)checkpoints.push({stage,cursor:Number(row.seq),origin:row.baseline===1?'baseline':'transition'})
 }
 return {schema:1,ticketId:task.id,settingsRevision:task.revision,observation:task.observed,session:task.actions.includes('read_history')?'original_inspectable':'unavailable',nextSafeAction,replayAllowed:false,checkpoints,checkpointScope:'retained_ticket_history'}
}
