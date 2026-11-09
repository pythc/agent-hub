const deploymentState={data:null,loading:false,error:'',timer:null,ticket:'',imported:'',label:'',selected:'',evidence:null,exportWorkers:null,exportScope:'',verificationOpen:new Set()}
function scheduleDeploymentRefresh(){
 clearTimeout(deploymentState.timer)
 deploymentState.timer=setTimeout(()=>{
  if(S.authed&&entryState.page==='deployments'&&!document.hidden)void loadDeployments(false)
  else scheduleDeploymentRefresh()
 },3000)
}
async function loadDeployments(force=true){
 if(deploymentState.loading||!S.authed)return
 clearTimeout(deploymentState.timer);deploymentState.loading=true
 try{deploymentState.data=await api('/deployments');deploymentState.error=''}
 catch(error){deploymentState.error=entrySafeDetail(error?.message||error)}
 finally{
  deploymentState.loading=false
  if(entryState.page==='deployments'){
   const editing=document.activeElement?.closest('form.deployment-card,.delegation-evidence')
   if(force!==false||!editing&&!window.getSelection()?.toString())render()
  }
  scheduleDeploymentRefresh()
 }
}
async function deploymentAction(name,callback){
 await entryRun(name,async()=>{await callback();deploymentState.data=await api('/deployments')})
}
function deploymentStateLabel(task){
 if(task.desired==='cancelled'&&task.controlConfirmed&&task.remoteState==='ready')return L('Remote completed · stop request reconciled','远端已完成 · 停止请求已核对')
 if(task.desired==='cancelled'&&!task.controlConfirmed)return L('Cancellation requested · awaiting remote confirmation','已请求停止 · 等待远端确认')
 if(task.stale)return L('Last observation is outdated','最近观察已过期')
 if(task.remoteState==='ready'&&task.acceptanceMode==='goal-verification'){
  if(task.goalState==='completed')return L('Independently verified · goal completed','独立验收通过 · 目标已完成')
  if(task.goalState==='paused')return L('Goal paused · candidate retained','目标已暂停 · 候选交付已保留')
  if(task.goalState==='held'||['failed','insufficient','errored','stale','unavailable'].includes(task.verification?.state))return L('Independent acceptance needs review','独立验收需要处理')
  return task.acceptance==='passed'?L('Independent checks passed · goal is settling','独立检查通过 · 等待目标完成'):L('Candidate ready · independent acceptance pending','候选交付就绪 · 等待独立验收')
 }
 return ({unknown:L('Awaiting confirmation','等待确认'),accepted:L('Accepted','已受理'),running:L('Running','执行中'),ready:task.acceptance==='passed'?L('Parent reviewed','父级已核对'):L('Candidate result · awaiting review','候选结果 · 待核对'),blocked:L('Needs attention','需要处理'),cancelled:L('Stopped','已停止')})[task.remoteState]||task.remoteState
}
function deploymentGoalState(state){return ({active:L('In progress','进行中'),waiting:L('Waiting','等待中'),needs_input:L('Needs input','需要补充信息'),paused:L('Paused','已暂停'),held:L('Needs review','需要处理'),completed:L('Completed','已完成'),cancelled:L('Stopped','已停止'),pending:L('Pending','待调度'),running:L('Running','执行中'),verifying:L('Independent acceptance','独立验收中'),passed:L('Passed','已通过'),waiting_dependency:L('Waiting for prerequisites','等待前置结果')})[state]||state}
function deploymentGoalGraph(goal,data){
 const card=el('article','deployment-card delegation-goal');card.dataset.goalId=goal.id
 card.append(el('h3','',goal.title),el('p','deployment-status',deploymentGoalState(goal.state)))
 if(goal.reason)card.append(el('p','alert warning',goal.reason))
 const list=el('ol','delegation-nodes');list.setAttribute('aria-label',L('Execution nodes','执行节点'))
 for(const node of goal.nodes){
  const item=el('li','delegation-node');item.dataset.nodeId=node.id;item.dataset.state=node.state
  const target=node.kind==='team'?data.targets.find(t=>t.id===node.targetId)?.label:executionDraft().workers.find(w=>w.id===node.targetId)?.label
  item.append(el('strong','',node.title),el('span','deployment-node-kind',node.kind==='team'?L('Child team','子团队'):L('Local Worker','本地 Worker')),
   el('p','',deploymentGoalState(node.state)),el('p','hint',(target||node.targetId||'')))
  if(node.dependsOn.length)item.append(el('p','hint',L('Requires: ','依赖：')+node.dependsOn.map(id=>goal.nodes.find(n=>n.id===id)?.title||id).join(' · ')))
  if(node.reason)item.append(el('p','hint',node.reason))
  list.append(item)
 }
 card.append(list)
 return card
}
function deploymentVerification(task){
 const details=el('details','delegation-verification')
 details.open=deploymentState.verificationOpen.has(task.id)
 details.ontoggle=()=>{if(details.open)deploymentState.verificationOpen.add(task.id);else deploymentState.verificationOpen.delete(task.id)}
 details.append(el('summary','',L('Independent acceptance checks','独立验收检查')))
 const stages=[[L('Node acceptance','节点验收'),task.verification?.checks],[L('Overall goal acceptance','整体目标验收'),task.verification?.overallChecks]]
 for(const [label,checks] of stages){
  details.append(el('h4','',label))
  for(const check of checks||[])details.append(add(el('div',''),el('strong','',check.criterionId+' · '+({passed:L('Passed','通过'),failed:L('Failed','未通过'),insufficient:L('Insufficient evidence','证据不足')})[check.verdict]),el('p','hint',check.explanation)))
  if(!checks?.length)details.append(el('p','hint',L('No decision recorded yet.','尚无验收结论。')))
 }
 if(task.verification?.reason)details.append(el('p','alert warning',task.verification.reason))
 return details
}
function deploymentInput(label,value,onChange,options={}){
 const input=el(options.area?'textarea':'input')
 input.value=value;input.autocomplete='off'
 if(options.password)input.type='password'
 if(options.required)input.required=true
 input.oninput=()=>onChange(input.value)
 return add(el('label','deployment-field'),el('span','',label),input)
}
function deploymentConnect(data){
 const form=el('form','deployment-card')
 form.append(el('h2','',L('Connect an instance','连接实例')),
  deploymentInput(L('Team name','团队名称'),deploymentState.label,v=>deploymentState.label=v,{required:true}),
  deploymentInput(L('Pairing code from the other instance','另一实例提供的配对码'),deploymentState.imported,v=>deploymentState.imported=v,{required:true,password:true}))
 const submit=opButton(L('Verify and connect','核验并连接'),null,'button primary');submit.type='submit';form.append(submit)
 form.onsubmit=event=>{event.preventDefault();void deploymentAction('connect-team',async()=>{
  let ticket
  try{ticket=JSON.parse(atob(deploymentState.imported.trim()))}catch{throw Error(L('The pairing code is invalid.','配对码格式无效。'))}
  await api('/deployments/connect',{ticket,label:deploymentState.label,expectedRevision:data.revision})
  deploymentState.imported='';adopt(await snapshot())
 })}
 return form
}
function deploymentExport(data){
 const form=el('form','deployment-card'),workers=executionDraft().workers
 if(deploymentState.exportWorkers===null)deploymentState.exportWorkers=workers.map(w=>w.id)
 const selected=new Set(deploymentState.exportWorkers)
 form.append(el('h2','',L('Allow another instance to delegate','允许另一实例委派任务')))
 let scope
 if(data.exportScopes!==null){
  if(!data.exportScopes.some(s=>s.id===deploymentState.exportScope))deploymentState.exportScope=data.exportScopes[0]?.id||''
  scope=data.exportScopes.find(s=>s.id===deploymentState.exportScope)
  const select=el('select');select.setAttribute('aria-label',L('Exported management scope','导出的管理范围'))
  for(const item of data.exportScopes){const option=el('option','',item.name);option.value=item.id;select.append(option)}
  select.value=deploymentState.exportScope;select.onchange=()=>{deploymentState.exportScope=select.value;render()}
  form.append(add(el('label','deployment-field'),el('span','',L('Exported management scope','导出的管理范围')),select))
  if(!scope)form.append(el('p','hint',L('Bind the dedicated delegation source to a management scope before pairing.','配对前，请将委派专用来源加入一个管理范围。')))
 }
 const fields=el('div','deployment-checks')
 for(const worker of workers){
  const check=el('input');check.type='checkbox';check.disabled=data.exportScopes!==null&&!scope?.workerIds.includes(worker.id);check.checked=!check.disabled&&selected.has(worker.id)
  check.onchange=()=>{if(check.checked)selected.add(worker.id);else selected.delete(worker.id);deploymentState.exportWorkers=[...selected];submit.disabled=![...selected].some(id=>data.exportScopes===null||scope?.workerIds.includes(id))}
  fields.append(add(el('label',''),check,el('span','',worker.label||worker.id)))
 }
 form.append(fields,el('p','hint',L('This pairing grants bounded read-only tasks to the selected Workers. It does not share accounts or browser sign-ins.','此次配对仅允许所选 Worker 执行受限只读任务，不共享账号或浏览器登录。')))
 const submit=opButton(L('Create pairing code','生成配对码'),null,'button');submit.type='submit';submit.disabled=![...selected].some(id=>data.exportScopes===null||scope?.workerIds.includes(id));form.append(submit)
 form.onsubmit=event=>{event.preventDefault();void deploymentAction('export-team',async()=>{
  const ticket=await api('/deployments/pairing',{expectedRevision:data.revision,policy:{workerIds:[...selected].filter(id=>data.exportScopes===null||scope?.workerIds.includes(id)),...(scope?{scopeId:scope.id}:{})}})
  const encoded=btoa(JSON.stringify(ticket));deploymentState.ticket=encoded
  setTimeout(()=>{if(deploymentState.ticket!==encoded)return;deploymentState.ticket='';if(entryState.page==='deployments')render()},Math.max(0,ticket.expiresAt-Date.now()))
 })}
 if(deploymentState.ticket){
  const output=el('textarea');output.readOnly=true;output.value=deploymentState.ticket;output.setAttribute('aria-label',L('Private pairing code','私有配对码'))
  form.append(output,opButton(L('Copy code','复制配对码'),async()=>{await navigator.clipboard.writeText(deploymentState.ticket)},'button'),
   opButton(L('Hide code','隐藏配对码'),()=>{deploymentState.ticket='';render()},'text-button'),
   el('p','hint',L('Expires in five minutes. Share only with an instance you manage.','五分钟后过期，仅交给你管理的另一实例。')))
 }
 return form
}
async function deploymentIntake(id,state){
 if(dirty())throw Error(L('Save or discard the current draft first.','请先保存或放弃当前草稿。'))
 const current=(await api('/settings')).current
 await api('/settings',{revision:current.revision,patch:{execution:{...current.config.execution,teamTargets:(current.config.execution.teamTargets||[]).map(t=>t.id===id?{...t,state}:t)}}})
 adopt(await snapshot())
}
function deploymentTask(task,data){
 const card=el('article','deployment-card delegation-task')
 card.append(el('h3','',task.title),el('p','deployment-status',deploymentStateLabel(task)),
  el('p','hint',L('Child team','子团队')+' · '+(data.targets.find(t=>t.id===task.targetId)?.label||task.targetId)),
  el('p','hint',L('Last checked: ','最近检查：')+(task.lastCheckedAt?when(task.lastCheckedAt):L('Not yet confirmed','尚未确认'))))
 if(task.activations!==null)card.append(el('p','hint',L('Remote model activations: ','远端模型激活次数：')+task.activations))
 if(task.reply)card.append(el('p','',task.reply))
 if(task.error)card.append(el('p','alert warning',task.error))
 if(task.acceptanceMode==='goal-verification')card.append(deploymentVerification(task))
 const actions=el('div','actions')
 actions.append(opButton(L('Inspect evidence','查看证据'),()=>deploymentAction('inspect-team',async()=>{
  deploymentState.evidence=await api('/deployments/command',{action:'inspect',id:task.id})
  deploymentState.selected=task.id
 }),'button'))
 if(task.desired!=='cancelled')actions.append(opButton(L('Stop this delegation','停止这项委派'),()=>deploymentAction('stop-team',async()=>{
  await api('/deployments/command',{action:'cancel',id:task.id,operationId:crypto.randomUUID(),expectedRevision:data.revision})
 }),'button'))
 card.append(actions)
 if(deploymentState.selected===task.id&&deploymentState.evidence){
  const evidence=deploymentState.evidence.evidence||[]
  const body=el('div','delegation-evidence')
  body.append(el('h4','',L('Evidence from the child instance','来自子实例的证据')))
  for(const item of evidence)body.append(add(el('div','message'),el('strong','',item.name||(item.kind==='remote-worker-report'?L('Worker report','Worker 报告'):L('Remote report','远端报告'))),
   item.sha256?el('p','deployment-identity','SHA-256: '+item.sha256+' · '+item.size+L(' bytes · ',' 字节 · ')+item.encoding):null,
   el('pre','',item.content??item.text??'')))
  if(!evidence.length)body.append(el('p','hint',L('No candidate evidence is available.','尚无候选交付证据。')))
  if(task.acceptanceMode!=='goal-verification'&&task.remoteState==='ready'&&task.acceptance!=='passed'&&task.desired==='running')body.append(opButton(L('Mark reviewed after checking','核对后标记通过'),()=>deploymentAction('review-team',async()=>{
   await api('/deployments/command',{action:'accept',id:task.id,operationId:crypto.randomUUID(),expectedRevision:data.revision,evidence:evidence.map(e=>e.id)})
  }),'button primary'))
  card.append(body)
 }
 return card
}
function renderDeployments(){
 if(!deploymentState.data&&!deploymentState.loading&&S.authed)void loadDeployments()
 const data=deploymentState.data
 const result=[opHeading(L('Deployments','部署'),L('Instances, team connections and delegated work','实例、团队连接与委派任务'),
  opButton(L('Refresh','刷新'),loadDeployments,'button','refresh'))]
 if(deploymentState.error)result.push(el('p','alert warning',L('Status could not be refreshed. ','状态未能刷新。')+deploymentState.error))
 if(!data)return [...result,el('p','hint',L('Reading instance status…','正在读取实例状态…'))]
 result.push(add(el('section','deployment-card'),el('h2','',L('This instance','本实例')),
  el('p','',L('Host version: ','宿主版本：')+(S.health?.version||'—')),
  el('p','hint',data.enabled?L('Team delegation is enabled.','已开启团队委派。'):L('Team delegation is disabled. Existing local work is unaffected.','尚未开启团队委派，本地任务可继续使用。')),
  data.identity?el('p','deployment-identity',L('Instance identity: ','实例身份：')+data.identity.id):null,
  data.enabled?el('p','hint',L('Signed local connections · one remote hop · independent child team coordination','本机签名连接 · 最多一跳远端委派 · 子团队独立统筹')):null))
 if(data.recoveryRequired){
  const check=el('input');check.type='checkbox'
  const label=add(el('label','deployment-field'),check,el('span','',L('The original instance is stopped and I have reviewed external effects. Old connections will be revoked.','原实例已停止，且我已核对外部执行结果；旧连接将全部撤销。')))
  const recover=opButton(L('Confirm recovery isolation','确认恢复隔离状态'),()=>deploymentAction('recover-instance',async()=>{
   if(!check.checked)throw Error(L('Confirm the original instance has stopped.','请先确认原实例已停止。'))
   await api('/deployments/recover',{fingerprint:data.recoveryFingerprint,expectedRevision:data.revision,originalStopped:true})
  }),'button')
  result.push(add(el('section','deployment-card'),el('h2','',L('Restored instance needs reconciliation','恢复后的实例需要核对')),el('p','',L('Delegation is held. Recovery revokes old grants and requires fresh pairing; external effects are retained.','跨实例执行已暂停。恢复确认将撤销旧授权并要求重新配对，已发生的外部效果会保留。')),label,recover))
  return result
 }
 if(!data.enabled){
  result.push(el('p','hint',L('Enable delegation in the deployment configuration, with a dedicated delegated-work source, then restart using the same private state. The deployment guide describes this setup.','请按部署指南启用委派和专用工作来源，再沿用原私有状态启动实例。')))
  if(!data.outbound.length&&!data.inbound.length&&!data.goals?.length)return result
 }
 if(data.enabled)result.push(add(el('div','deployment-grid'),deploymentConnect(data),deploymentExport(data)))
 const teams=el('section','deployment-list')
 teams.append(el('h2','',L('Connected teams','已连接团队')))
 for(const target of data.targets){
  const connection=data.connections.find(c=>c.id===target.connectionId)
  const card=add(el('article','deployment-card'),el('h3','',target.label),
   el('p','',connection?.active?L('Connection verified · task acceptance is separate','连接已验证 · 任务需单独验收'):L('Connection revoked','连接已撤销')),
   el('p','hint',L('Independent team coordination','由子团队独立统筹')),
   el('p','hint',L('Limits: ','限额：')+target.limits.maxActivations+L(' model activations · concurrency ',' 次模型激活 · 并发 ')+target.limits.maxConcurrent),
   el('p','hint',L('Permissions: ','权限：')+(Object.entries(target.permissions).filter(([,allowed])=>allowed).map(([key])=>({write:L('write','写入'),shell:L('shell','命令'),network:L('network','网络'),subagents:L('subagents','子代理')})[key]).join(' · ')||L('read-only','只读'))),
   connection?el('p','deployment-identity',L('Peer fingerprint: ','对端指纹：')+connection.fingerprint):null)
  if(connection?.active)card.append(add(el('div','actions'),
   opButton(target.state==='paused'?L('Resume intake','恢复接单'):L('Pause new intake','暂停新接单'),()=>deploymentAction('intake-team',()=>deploymentIntake(target.id,target.state==='paused'?'enabled':'paused')),'button'),
   opButton(L('Revoke connection','撤销连接'),()=>deploymentAction('revoke-team',()=>api('/deployments/revoke',{id:connection.id})),'button')))
  teams.append(card)
 }
 if(!data.targets.length)teams.append(opEmpty(L('No connected teams.','尚未连接子团队。')))
 result.push(teams)
 for(const peer of data.peers.filter(p=>p.active))result.push(add(el('section','deployment-card'),
  el('h3','',L('Authorized upstream instance','已授权的上级实例')),
  el('p','hint',peer.id),
  opButton(L('Revoke upstream access','撤销上级访问'),()=>deploymentAction('revoke-upstream',()=>api('/deployments/revoke',{id:peer.id})),'button')))
 if(data.goals?.length){const goals=el('section','deployment-list delegation-goals');goals.append(el('h2','',L('Goal execution','目标执行')));for(const goal of data.goals)goals.append(deploymentGoalGraph(goal,data));result.push(goals)}
 const tasks=el('section','deployment-list');tasks.append(el('h2','',L('Delegated work','委派任务')),el('p','hint',L('Recent ','显示最近 ')+data.historyLimit+L(' tasks in each direction. Structured goals require independent node and overall acceptance; ordinary parent review remains a separate check.',' 项各方向任务。结构化目标须通过节点和整体验收；普通父级核对单独记录。')))
 for(const task of data.outbound)tasks.append(deploymentTask(task,data))
 for(const task of data.inbound)tasks.append(add(el('article','deployment-card'),el('h3','',task.title),
  el('p','',L('Received delegation','收到的委派')+' · '+(({accepted:L('Accepted','已受理'),running:L('Running','执行中'),ready:L('Candidate ready','候选交付就绪'),blocked:L('Needs attention','需要处理'),cancelled:L('Stopped','已停止')})[task.state]||task.state)),
  el('p','hint',L('Activations: ','模型激活次数：')+task.activations)))
 if(!data.outbound.length&&!data.inbound.length)tasks.append(opEmpty(L('No delegated work yet. Ask your Router to use an available child team.','尚无委派任务，可在对话中让 Router 使用已连接的子团队。')))
 result.push(tasks)
 return result
}
