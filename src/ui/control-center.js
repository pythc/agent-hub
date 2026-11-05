const controlState={execution:null,prompts:null,promptTab:'shared',preview:null}
const controlHasDraft=()=>!!(controlState.execution?.dirty||controlState.prompts?.dirty)
function controlConnections(){return Object.entries({codex:{kind:'codex'},...(S.base?.config.backends||{})}).map(([id,b])=>({id,kind:b.kind,model:b.kind==='codex'?S.base?.config.model:b.model,label:b.label||(b.kind==='codex'?'Codex':new URL(b.baseUrl).hostname+' · '+b.model)}))}
function controlField(id,label,value,onChange,options=null,placeholder=''){
 const input=el(options?'select':'input');input.id=id
 if(options)for(const [v,name]of options)input.add(new Option(name,v))
 input.value=value??'';if(!options){input.type='text';input.autocomplete='off';input.placeholder=placeholder}
 input[options?'onchange':'oninput']=()=>onChange(input.value)
 const title=el('label','',label);title.htmlFor=id
 return add(el('div','control-field'),title,input)
}
function controlDraft(kind){
 const config=S.base.config,current=kind==='execution'?{execution:config.execution,models:config.models}:config.prompts
 let draft=controlState[kind]
 if(draft&&!draft.dirty&&!same(draft.base,current)){controlState[kind]=null;return controlDraft(kind)}
 if(!draft){draft=kind==='execution'?{revision:S.base.revision,base:clone(current),router:config.execution.roles.router??config.execution.backend,routerModel:config.models.router||'',workers:clone(config.execution.workers||Array.from({length:config.concurrency},(_,i)=>({id:'worker-'+(i+1),backend:config.execution.roles.worker??config.execution.backend,...(config.models.worker?{model:config.models.worker}:{})})))}:{revision:S.base.revision,base:clone(current),values:clone(current)};draft.dirty=false;controlState[kind]=draft}
 if(same(draft.base,current))draft.revision=S.base.revision
 return draft
}
function controlEdit(kind){const draft=controlDraft(kind);draft.dirty=true;const save=document.getElementById('control-save-'+kind);if(save)save.disabled=false}
async function controlSave(kind){
 await run('save',async()=>{
  if(dirty())throw Error(L('Save or discard the advanced-settings draft first.','请先保存或放弃高级设置中的草稿。'))
  const draft=controlDraft(kind),config=S.base.config
  const patch=kind==='execution'?{execution:{...config.execution,roles:{...config.execution.roles,router:draft.router},workers:draft.workers.map(w=>({id:w.id,backend:w.backend,...(w.label?{label:w.label}:{}),...(w.model?.trim()?{model:w.model.trim()}:{})}))},models:{...config.models,...(draft.routerModel.trim()?{router:draft.routerModel.trim()}:{router:undefined})},concurrency:draft.workers.length}:{prompts:draft.values}
  await api('/settings',{revision:draft.revision,patch});controlState[kind]=null;controlState.preview=null;adopt(await snapshot());await readEntries();announce(L('Saved.','已保存。'))
 })
}
function controlActions(kind){
 const save=opButton(L('Save','保存'),()=>controlSave(kind),'button primary');save.id='control-save-'+kind;save.disabled=!controlDraft(kind).dirty
 const cancel=opButton(L('Reload saved settings','重新载入已保存设置'),()=>{if(controlDraft(kind).dirty&&!confirm(L('Discard these unsaved changes?','放弃这些未保存的修改？')))return;void run('refresh',async()=>{if(dirty())throw Error(L('Save or discard the advanced-settings draft first.','请先保存或放弃高级设置中的草稿。'));const latest=await snapshot();controlState[kind]=null;controlState.preview=null;adopt(latest);await readEntries()})},'text-button')
 return add(el('div','control-actions'),save,cancel)
}
function controlPrompts(){
 if(!S.base)return [accessPanel()]
 const draft=controlDraft('prompts'),tabs=[['shared',L('Shared','共同要求')],['router','Router'],['worker','Worker'],['delivery',L('Reply format','回复格式')]],tab=controlState.promptTab
 const labels={shared:L('Applies to Router and every Worker','作用于 Router 和所有 Worker'),router:L('When to accept work and how to define its scope','何时接任务，如何确定处理范围'),worker:L('How work is carried out and checked','如何执行任务和验证结果'),delivery:L('How replies are formatted','结果如何组织和回复')}
 const nav=el('div','prompt-tabs');nav.setAttribute('role','group');nav.setAttribute('aria-label',L('Instruction target','提示词用途'))
 for(const [key,label]of tabs){const b=opButton(label,()=>{controlState.promptTab=key;controlState.preview=null;render()},'tab');b.setAttribute('aria-pressed',String(tab===key));nav.append(b)}
 const input=el('textarea','prompt-editor');input.id='control-prompt-editor';input.value=draft.values[tab]||'';input.placeholder=L('Leave empty to use built-in instructions.','留空使用系统默认指令。');input.oninput=()=>{draft.values[tab]=input.value;controlEdit('prompts');controlState.preview=null;document.getElementById('control-prompt-preview')?.remove()}
 const label=el('label','prompt-purpose',labels[tab]);label.htmlFor=input.id
 const preview=opButton(L('Preview actual instructions','预览实际指令'),()=>run('preview',async()=>{controlState.preview=await api('/prompt-preview',{role:tab==='router'?'router':'worker',prompts:draft.values})}),'button')
 const editor=add(el('section','prompt-config'),nav,label,input,el('p','control-hint',L('These requirements supplement the system instructions.','此处填写补充要求，系统指令仍保留。')),add(el('div','control-actions'),controlActions('prompts'),preview))
 if(controlState.preview){const output=detail(L('Actual instructions','实际发送的指令'),raw(controlState.preview.text));output.id='control-prompt-preview';output.open=true;editor.append(output)}
 const more=detail(L('Advanced prompt parts','高级提示词片段'),add(el('div'),el('p','control-hint',L('System templates and team skills. Changes preserve required placeholders.','系统模板和团队技能，修改时需保留必要变量。')),opButton(L('Open prompt parts','编辑片段'),()=>{switchSurface('advanced');S.page='prompts';S.promptParts=true;render()},'button')))
 return [editor,more]
}
function controlNewConnection(id){
 opNavigate('detail',id);entryState.creating=true;entryState.source='';entryState.draft={botMode:'existing'};entryState.probe=null;entryState.verification=null;render(true)
}
function controlConnectionsPage(){
 const result=[opHeading(L('Software connections','软件接入'),null,opButton(L('New connection','新建接入'),()=>{operator.addingConnection=true;operator.search='';render()},'button primary','plus'))],table=el('div','connection-instance-list')
 let count=0
 for(const entry of entryState.data.entries){
  const sources=entry.category==='client'?(entry.status!=='not-configured'?[null]:[]):entry.sources||[]
  for(const source of sources){count++;const label=source?.label||entryName(entry),scopes=source?.scopes?.map(s=>typeof s==='object'?s.label:'').filter(Boolean).join(', ')||entry.usage?.location||'',state=source?(source.enabled===false?L('Disabled','已停用'):source.verification?.verified?L('Verified','已验证'):L('Awaiting verification','待验证')):entryStateLabel(entry.status)
   const open=opButton(L('Configure','配置'),()=>{opNavigate('detail',entry.id);entryState.source=source?.id||'';entryState.creating=false;entryState.verification=null;render(true)},'button')
   table.append(add(el('div','connection-instance'),opMark(entry.id),add(el('div'),el('strong','',label),el('span','connection-detail',scopes)),el('span','connection-platform',entryName(entry)),el('span','connection-state',state),open))
  }
 }
 if(!count)table.append(opEmpty(L('No connections.','尚未添加接入。')))
 result.push(table);return result
}
function controlNewModel(){
 if(entryModel.touched&&!confirm(L('Discard the unsaved service draft?','放弃未保存的模型服务草稿？')))return
 Object.assign(entryModel,{creating:true,name:'',mode:'api',existingId:'',provider:'openai',endpoint:'',protocol:'openai-responses',model:'',credential:'',open:true,touched:false,plan:null,check:null,saved:false});render(true)
}
function controlModels(){
 const result=[opHeading(L('Model services','模型服务'),null,opButton(L('New service','新建模型服务'),controlNewModel,'button primary','plus'))],list=el('div','model-service-list')
 for(const service of controlConnections()){
  const row=add(el('div','model-service-row'),add(el('div'),el('strong','',service.label),el('span','model-service-kind',service.kind)),el('span','',service.model||L('Codex default','Codex 默认模型')),opButton(L('Check','检查连接'),()=>{Object.assign(entryModel,{creating:false,name:'',mode:'existing',existingId:service.id,open:true,plan:null,check:null,saved:false,touched:false});render();void checkEntryModel()},'button'))
  list.append(row)
 }
 result.push(list)
 if(entryModel.creating||entryModel.check||entryModel.saved){const settings=entryModel.creating?entryModelSettings():entryModelResult();if(entryModel.creating)settings.open=true;settings.classList.add('operator-model-form');result.push(add(el('section','new-model-service'),add(el('div','section-heading'),entryModel.creating?el('h2','',L('New service','新建模型服务')):null,opButton(L('Close','关闭'),()=>{if(entryModel.touched&&!confirm(L('Discard unsaved changes?','放弃未保存的修改？')))return;entryModel.creating=false;entryModel.credential='';entryModel.touched=false;entryModel.check=null;entryModel.saved=false;render()},'text-button')),settings))}
 return result
}

async function controlTaskAction(action,id){
 if(action==='retry'&&!confirm(L('Have you checked the original conversation and files for uncertain effects?','是否已核对原会话和文件，确认没有不确定的副作用？')))return
 await entryRun('task-action',async()=>{await api('/action',{action,id});operator.drawer=await api('/entry-workspace/task/'+encodeURIComponent(id));await readOperatorWork()})
}
