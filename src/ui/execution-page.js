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
function controlExecution() {
  if (!S.base) return [accessPanel()]
  if (executionView.mode === 'calls') return executionCallsPage(el('section', 'execution-page'))
  return teamConfiguration()
}
