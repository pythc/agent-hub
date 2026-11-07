// Execution content only. The existing application header and sidebar own navigation.
const executionView={root:null,motion:null,mode:'calls',instructions:null,instructionFocus:'',selected:null,inspect:null,callId:null,dialogVersion:0,stale:false}
function executionSetCount(count){
 if(!Number.isInteger(count)||count<1||count>10)return
 const draft=executionDraft(),next=draft.workers.slice(0,count)
 while(next.length<count){let index=next.length+1;while(next.some(w=>w.id==='worker-'+index))index++;next.push({id:'worker-'+index,backend:draft.workers[0]?.backend??draft.router})}
 draft.workers=next;editExecution(draft);render();queueMicrotask(()=>document.getElementById('worker-count')?.focus())
}
function executionModel(id,value,backend,onChange){
 const services=controlConnections(),draft=executionDraft(),service=services.find(s=>s.id===backend),field=controlField(id,L('Model','模型'),value,onChange,null,service?.model||L('Service default','服务默认模型'))
 const input=field.querySelector('input'),list=el('datalist');list.id=id+'-options';input.setAttribute('list',list.id)
 const values=[service?.model,...draft.workers.filter(w=>w.backend===backend).map(w=>w.model),...(draft.router===backend?[draft.routerModel]:[])].filter(Boolean)
 for(const model of new Set(values)){const option=el('option');option.value=model;list.append(option)}
 field.append(list);return field
}
function executionEditInstructions(role,index){
 const button=affectButton(L('Edit instructions','编辑指令'),()=>{executionView.instructions=role;executionView.instructionFocus=button.id;render()},{variant:'ghost',glyph:'prompts'})
 button.id='execution-instructions-'+role+(index==null?'':'-'+index);button.classList.add('execution-edit-instructions')
 button.setAttribute('aria-label',role==='worker'?L('Edit shared Worker instructions','编辑所有 Worker 的共同指令'):L('Edit Router instructions','编辑 Router 指令'))
 if(role==='worker')button.title=L('Applies to all Workers','作用于全部 Worker')
 return button
}
function executionCloseInstructions(){
 executionView.instructions=null;document.getElementById('execution-instructions')?.close();render();document.getElementById(executionView.instructionFocus)?.focus({preventScroll:true})
}
function executionInstructions(){
 if(!executionView.instructions)return null
 const role=executionView.instructions,dialog=el('dialog','execution-instructions');dialog.id='execution-instructions';dialog.setAttribute('aria-labelledby','execution-instructions-title')
 const title=el('h2','',L('Instructions','指令'));title.id='execution-instructions-title'
 const close=affectButton(L('Close','关闭'),executionCloseInstructions,{variant:'ghost'})
 const tabs=affectSegmented({id:'execution-instruction-tab',label:L('Instruction target','指令用途'),value:role,options:[{value:'router',label:'Router',controls:'execution-instruction-panel'},{value:'worker',label:'Workers',controls:'execution-instruction-panel'}],onChange:value=>{executionView.instructions=value;render()}})
 const panel=el('div','execution-instruction-panel');panel.id='execution-instruction-panel';panel.setAttribute('role','tabpanel');panel.setAttribute('aria-labelledby','execution-instruction-tab-'+role)
 const label=el('label','',role==='worker'?L('Shared by all Workers','作用于全部 Worker'):L('How Router accepts and scopes work','Router 如何接收任务和确定范围'));label.htmlFor='execution-instruction-text'
 const input=el('textarea');input.id=label.htmlFor;input.value=S.draft.prompts?.[role]||'';input.placeholder=L('Leave empty to keep the built-in instructions.','留空保留系统默认指令。');input.disabled=!!S.busy
 input.oninput = () => {
  editPrompt(role, input.value)
  saveButton.disabled = !!S.latest || !!S.errors.size || !changed().includes('prompts')
 }
 panel.append(label,input)
 const saveButton = affectButton(L('Save instructions','保存指令'), async () => {
  if (await save(['prompts'])) executionCloseInstructions()
  else if (S.latest) { executionCloseInstructions(); revealRecovery() }
 }, { variant:'primary', loading:S.busy==='save', disabled:!!S.latest || !!S.errors.size || !changed().includes('prompts') })
 const feedback=S.notice?.level==='error'?noticeView():null
 add(dialog,add(el('div','execution-dialog-heading'),title,close),tabs,panel,el('p','control-hint',L('These requirements supplement the system instructions.','补充要求会与系统指令一起使用。')),feedback,add(el('div','execution-dialog-actions'),saveButton))
 dialog.oncancel=event=>{event.preventDefault();if(!S.busy)executionCloseInstructions()}
 return dialog
}
function controlExecution(){
 if(!S.base)return [accessPanel()]
 const draft=executionDraft(),options=controlConnections().map(service=>[service.id,service.label]),active=operator.work?.architecture?.workers||[],page=el('section','execution-page')
 if(executionView.mode==='calls')return executionCallsPage(page)
 page.append(opHeading(L('Execution','执行'),null),executionModeTabs())
 const form=el('fieldset','execution-form');form.disabled=!!S.busy||!!entryState.busy
 form.id='execution-mode-panel';form.setAttribute('role','tabpanel');form.setAttribute('aria-labelledby','execution-mode-tab-configuration')
 const graph=el('div','execution-graph tam-surface');graph.dataset.dense=String(draft.workers.length>4)
 const canvas=document.createElementNS('http://www.w3.org/2000/svg','svg');canvas.classList.add('execution-wires');graph.append(canvas)
 const inputs=el('section','execution-sources');inputs.setAttribute('aria-label',L('Connected software','已接入的软件'));const entries=entryState.data?.entries?.filter(entry=>entry.category==='client'?entry.client?.installed||entry.status==='verified':entry.sources?.some(source=>source.enabled))||[]
 const sourceList=el('div','execution-source-list')
 for(const entry of entries){
  const button=opButton('',()=>opNavigate('detail',entry.id),'execution-source');button.dataset.entryId=entry.id;button.classList.add('tam-node')
  let mark=opMark(entry.id)
  if(executionAssets[entry.id]){mark=el('img','execution-source-logo');mark.src=executionAssets[entry.id];mark.alt='';mark.width=28;mark.height=28}
  button.replaceChildren(mark,el('span','',entryName(entry)));sourceList.append(add(el('div','execution-source-group'),button,executionHistoryButton('app',entry.id)))
 }
 if(!entries.length)sourceList.append(el('p','execution-no-sources',L('No connections','尚未接入软件')))
 inputs.append(sourceList,affectButton(L('New connection','新建接入'),()=>opNavigate('catalogue'),{glyph:'plus'}))
 const router=add(el('section','execution-router tam-node'),executionNodeHeading('Router','router'),controlField('router-backend',L('Service','模型服务'),draft.router,value=>{draft.router=value;draft.routerModel='';editExecution(draft);render()},options),executionModel('router-model',draft.routerModel,draft.router,value=>{draft.routerModel=value;editExecution(draft)}),executionEditInstructions('router'),agentOptionsEditor('router',draft.routerOptions,()=>editExecution(draft)))
 const queue=el('div','execution-queue tam-node',L('Queue','队列'));queue.setAttribute('aria-label',L('Task queue','任务队列'))
 const pool=el('section','execution-workers'),count=controlField('worker-count',L('Count','数量'),String(draft.workers.length),value=>executionSetCount(Number(value)),Array.from({length:10},(_,i)=>[String(i+1),String(i+1)])),select=count.querySelector('select')
 const less=affectButton('−',()=>executionSetCount(draft.workers.length-1),{disabled:draft.workers.length<=1}),more=affectButton('+',()=>executionSetCount(draft.workers.length+1),{disabled:draft.workers.length>=10});less.setAttribute('aria-label',L('Remove a Worker','减少一个 Worker'));more.setAttribute('aria-label',L('Add a Worker','增加一个 Worker'))
 const stepper=add(el('div','execution-stepper'),less,select,more);count.append(stepper,el('span','execution-count-range','1–10'))
 pool.append(add(el('div','execution-pool-heading'),el('h2','','Workers'),count))
 draft.workers.forEach((worker,index)=>{
  const live=active.find(item=>item.id===worker.id),heading=executionNodeHeading('Worker '+(index+1),'worker',worker.id,index)
  const fields=add(el('div','execution-worker-fields'),controlField('worker-'+index+'-backend',L('Service','模型服务'),worker.backend,value=>{worker.backend=value;delete worker.model;editExecution(draft);render()},options),executionModel('worker-'+index+'-model',worker.model,worker.backend,value=>{worker.model=value;editExecution(draft)}))
  const row=add(el('section','execution-worker tam-node'),heading,fields,agentOptionsEditor(worker.id,worker,()=>editExecution(draft)));row.dataset.workerId=worker.id
  if(live?.active?.length)row.append(el('p','execution-worker-task',live.active.map(task=>task.title).join(' · ')))
  pool.append(row)
 })
 if(!executionView.selected||executionView.selected.kind==='worker'&&!draft.workers.some(w=>w.id===executionView.selected.id))executionView.selected={kind:'worker',id:draft.workers[0].id};graph.append(inputs,router,queue,pool,executionTools())
 form.append(el('p','execution-live-status'),graph,add(el('div','execution-bottom'),el('p','control-hint',L('Changes apply to new conversations.','参数与指令用于后续轮次；已有任务更换后端需显式迁移。')),affectButton(L('New service','新建模型服务'),controlNewModel,{glyph:'plus'})))
 const inherited = L('Inherit from Worker', '继承发起的 Worker')
 const subagent = detail(L('Subagent model override', '子代理模型覆盖'),
  add(el('div','execution-worker-fields'),
   controlField('subagent-backend',L('Service','模型服务'),S.draft.execution.roles?.subagent || '',value=>{
    clearRelated('execution')
    set(S.draft,'execution.roles.subagent',value || undefined)
    updateBar()
   },[['',inherited],...options]),
   controlField('subagent-model',L('Model','模型'),S.draft.models?.subagent || '',value=>{
    clearRelated('models')
    set(S.draft,'models.subagent',value.trim() || undefined)
    updateBar()
   },null,inherited)))
 form.append(subagent)
 const policy=detail(L('Router coordination','Router 协调'),add(el('div','settings-stack'),
 controlField('router-mode',L('Router location','Router 所在位置'),S.draft.execution.router?.mode??'assessment',value=>{clearRelated('execution');set(S.draft,'execution.router.mode',value);updateBar()},[['assessment',L('Legacy assessment','兼容：临时受理')],['client',L('Current CLI conversation','当前 CLI 会话')],['host',L('Persistent host Router','宿主持久 Router')]]),
 controlField('router-management',L('Manage Workers','管理 Workers'),String(S.draft.execution.management?.enabled??false),value=>{clearRelated('execution');set(S.draft,'execution.management',{...S.draft.execution.management,enabled:value==='true',maxWorkers:S.draft.execution.management?.maxWorkers??10});updateBar()},[['false',L('Disabled','关闭')],['true',L('Enabled within configured limits','按配置范围开启')]])))
 form.append(policy)
 page.append(form);const dialog=executionInstructions();if(dialog)page.append(dialog);const calls=executionCallDialog();if(calls)page.append(calls)
 queueMicrotask(()=>executionMount(page));return [page]
}
