import type {TraceTask} from '../../src/execution-trace.ts'
import {readRecoveryManifest} from './recovery-summary-model.ts'
export function RecoverySummary({task,language='en'}:{task:TraceTask;language?:'en'|'zh-CN'}){
 const L=(en:string,zh:string)=>language==='en'?en:zh
 if(task.recovery===undefined)return null
 const manifest=readRecoveryManifest(task.recovery,task)
 const guidance={
  reconcile_effects:L('Verify the existing external outcome before any continuation. Do not repeat uncertain actions.','继续前先核实已有外部结果，不要重复效果未知的操作。'),
  wait_for_current_work:L('Wait for current execution or delivery; do not start duplicate work.','等待当前执行或投递，不要启动重复工作。'),
  answer_approval:L('Resolve the pending approval through the original task controls.','通过原任务操作处理待决授权。'),
  review_context:L('Review current context and permissions before continuing.','继续前核对当前上下文与权限。'),
  repair_blocker:L('Check or repair the recorded blocker before considering continuation.','考虑继续之前，先核查或修复已记录的阻塞。'),
  review_result:L('Review the retained result. Completion or cancellation does not undo earlier effects.','查看保留的结果；完成或取消不会撤销先前效果。'),
  inspect_original_session:L('Inspect the original session history before deciding what to do next.','先核查原会话历史，再决定下一步。'),
  inspect_state:L('Inspect current task state before choosing a recovery action.','选择恢复操作之前，先核对当前任务状态。'),
 }
 return <details className="trace-records"><summary>{L('Recovery guidance and checkpoints','恢复指引与检查点')}</summary><div className="trace-records-body">
  {!manifest?<p role="status">{L('Recovery information does not match the current task. Refresh to check again.','恢复信息与当前任务不匹配，请刷新后重新核对。')}</p>:<>
   <p className="trace-guidance">{guidance[manifest.nextSafeAction]}</p>
   <p>{manifest.session==='original_inspectable'?L('Original session history can currently be checked using the existing task controls.','目前可通过原有任务操作核查原会话历史。'):L('Original session history is not currently available for inspection.','目前无法核查原会话历史。')}</p>
   <p>{L('Retained local checkpoints are references to recorded transitions, not a backup, proof of remote success, or permission to replay.','保留的本地检查点仅指向已记录的变化，不是备份、远端成功证明或重放许可。')}</p>
   {manifest.checkpoints.length?<ul>{manifest.checkpoints.map(point=><li key={point.stage}>{({tool:L('Tool activity','工具动态'),acceptance:L('Acceptance','验收'),delivery:L('Delivery','投递')})[point.stage]} · {L('Record','记录')} {point.cursor} · {point.origin==='baseline'?L('Imported baseline, not a newly observed transition','导入基线，并非新观察到的变化'):L('Recorded transition','已记录的变化')}</li>)}</ul>:<p>{L('No retained checkpoints are available. Missing records do not prove that no external action occurred.','暂无保留的检查点；缺少记录不代表外部操作没有发生。')}</p>}
  </>}
 </div></details>
}
