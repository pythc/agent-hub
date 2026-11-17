// An observation of follow-up admission, never a grant, capability token or action control.
function taskPermissionsCard(view,id){
 const values={
  management_disabled:['Worker management is disabled. Ask the operator to review the management setting.','Worker 管理已停用。请操作员核对管理设置。'],
  source_disabled:['Connection events are disabled. Ask the connection owner to review event access.','连接事件已停用。请连接负责人核对事件接入权限。'],
  scope_not_listened:['This conversation is outside the listening scope. Ask the connection owner to review that scope.','当前会话不在监听范围内。请连接负责人核对监听范围。'],
  member_not_admitted:['The sender is not currently admitted. Ask the entry owner to review membership and admission rules.','发送者当前未获准接入。请入口负责人核对成员资格和准入规则。'],
  entry_unavailable:['The entry is unavailable or unassigned. Ask its owner to review the entry binding.','入口不可用或尚未分配。请负责人核对入口绑定。'],
  input_changed:['The original input changed. Send a fresh authorized request after reviewing the change.','原始输入已变化。核对变化后，请发送新的已授权请求。'],
  authority_unavailable:['Current input authority could not be verified. Send a fresh request from an admitted conversation.','无法核实当前输入权限。请从获准会话发送新的请求。'],
  task_unavailable:['The task or its context needs review. Recheck current task access and retained context before continuing.','任务或上下文需要核对。继续前请检查当前任务访问权限和保留的上下文。'],
  request_scope_missing:['This entry cannot send task requests. Ask the task manager to review request sharing, separately from reading results.','此入口不能提交任务请求。请任务管理员核对请求共享权限，不要将读取结果等同于可操作任务。'],
  requester_or_manager_required:['Task changes require the requester or a current manager. Ask one of them to send the request.','更改任务需要请求者或当前管理员身份。请由其中一方提交请求。'],
  current:['The observed task follow-up checks pass. This is not permission to execute a tool or change a resource.','观察时的任务后续请求检查通过。这不代表已获准执行工具或修改资源。']
 }
 if(!view||typeof view!=='object'||Array.isArray(view))return null
 const fields=Object.getOwnPropertyDescriptors(view),keys=['schema','readOnly','authorization','observedAt','subject','reason','action','execution']
 if(Object.keys(fields).length!==keys.length||keys.some(k=>!fields[k]||!Object.hasOwn(fields[k],'value')))return null
 const v=Object.fromEntries(keys.map(k=>[k,fields[k].value])),subject=v.subject&&Object.getOwnPropertyDescriptors(v.subject)
 if(v.schema!==1||v.readOnly!==true||v.authorization!==false||!Number.isSafeInteger(v.observedAt)||v.observedAt<0||v.action!=='task_followup'||v.execution!=='not_assessed'||!subject||Object.keys(subject).length!==2||subject.kind?.value!=='task'||subject.id?.value!==id||typeof v.reason!=='string'||!Object.hasOwn(values,v.reason))return null
 const card=el('details','message'),summary=el('summary','',L('Why access is blocked or available','权限与修复说明'))
 card.append(summary,el('p','',L(...values[v.reason])),el('p','hint',L('Read-only observation. No permission was changed. Each action rechecks current permissions; tool, browser and file access remain separate checks.','这里只读观察，未修改任何权限。每次操作仍会重新检查；工具、浏览器和文件权限另行核验。')))
 return card
}
