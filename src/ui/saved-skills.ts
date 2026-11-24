/** Shares the proactive workbench's scope selector, table renderer and request helper. */
export const skillSection=`<section aria-labelledby="skill-heading"><h2 id="skill-heading">可复用技能</h2>
<p>工具执行原子动作；Worker 模板定义角色和后端要求；技能保存固定版本的方法。查看、保存或选择都不会安装连接或授予权限。</p>
<label>搜索方法<input id="skill-search" type="search" placeholder="名称或目标"></label><label>状态<select id="skill-state"><option value="">全部</option><option value="active">可用</option><option value="candidate">候选／待试用</option><option value="validated">静态校验完成</option><option value="review_required">待复核</option><option value="retired">已停用</option></select></label>
<section id="skill-preview" hidden aria-labelledby="skill-preview-title"><h3 id="skill-preview-title">固定版本方法</h3><p id="skill-preview-status" role="status"></p><pre id="skill-preview-content" style="white-space:pre-wrap;overflow-wrap:anywhere"></pre><button type="button" id="close-skill-preview">关闭预览</button></section>
<label>已验收目标<select id="accepted-goal"></select></label><button type="button" id="draft-skill">从目标保存技能</button>
<div id="skills" class="table"></div><form id="skill-editor" hidden>
<div class="row"><label>名称<input name="title" required></label><label>目标与所需输入<textarea name="objective" required></textarea></label></div>
<div id="skill-steps"></div><label>验收条件（JSON）<textarea name="criteria" required></textarea></label>
<label>输入参数（每行 name = 名称）<textarea name="parameters" placeholder="file = 文件路径"></textarea></label><button>保存新版本</button> <button type="button" class="secondary" id="close-skill">收起</button></form>
<form id="skill-overlay" hidden><h3>基于固定版本创建私有覆盖层</h3><p>仅覆盖名称、目标和步骤说明。Worker、连接和原执行权限不会被更改。留空表示继承基础版本。</p>
<div id="skill-overlay-fields"></div><button>保存候选版本</button> <button type="button" id="close-skill-overlay">取消</button></form>
<form id="skill-overlay-upgrade" hidden><h3>升级覆盖层的基础版本</h3><p role="status" id="skill-overlay-conflicts"></p><div id="skill-overlay-conflict-details"></div>
<label>新版基础版本<select name="base" required></select></label><button>尝试升级为新候选</button> <button type="button" id="close-skill-overlay-upgrade">取消</button></form>
<form id="skill-run" hidden><h3>运行选定版本</h3><label>本次授权对话<select name="anchor" required></select></label>
<label>本次请求原文<input name="quote" required></label><div id="skill-inputs"></div><button>启动实际任务</button></form></section>`
export const skillScript=String.raw`
let editingSkill,runSkill,overlayBase,upgradingOverlay,skillRequest=0
const skillRef=s=>({id:s.id,version:s.version})
const skillKey=s=>JSON.stringify(skillRef(s))
const latestOverlayVersion=base=>Math.max(0,...state.skills.filter(s=>s.overlay?.base.id===base.id&&s.entryId===base.entryId).map(s=>s.version))
const skillLocation=s=>({scopeId:scope(),entryId:s.entryId})
const overlayLabel={candidate:'候选：尚未校验',validated:'已静态校验，尚未启用',active:'已启用：仅手动运行',review_required:'待复核，暂停新执行',retired:'已退役：仅保留历史'}
function newerBases(s){
  return state.skills.filter(b=>!b.overlay&&b.state==='active'&&b.entryId===s.entryId&&b.id===s.overlay.base.id&&b.version>s.overlay.base.version)
}
async function openOverlay(s){
  clearSkills()
  const generation=skillRequest
  const base=await readVersion(s)
  if(generation!==skillRequest)return
  overlayBase={base,location:skillLocation(s),expectedVersion:latestOverlayVersion(s)}
  const fields=$('#skill-overlay-fields');fields.replaceChildren()
  for(const [field,name,text,nodeId] of [['title','名称',base.template.title],['objective','目标',base.template.objective],...base.template.nodes.map(n=>['instruction',n.title,n.instruction,n.id])]){
    const label=document.createElement('label'),input=document.createElement('textarea')
    label.textContent=name;input.dataset.field=field;if(nodeId)input.dataset.nodeId=nodeId
    input.placeholder=text;input.maxLength=16000;label.append(input);fields.append(label)
  }
  $('#skill-overlay').hidden=false;fields.querySelector('textarea').focus()
}
function openOverlayUpgrade(s){
  clearSkills();upgradingOverlay={skill:skillRef(s),location:skillLocation(s),expectedVersion:latestOverlayVersion({...s.overlay.base,entryId:s.entryId})}
  const form=$('#skill-overlay-upgrade');options(form.elements.base,newerBases(s).map(b=>[skillKey(b),b.title+' · v'+b.version]))
  form.hidden=false;form.elements.base.focus()
}
async function changeOverlayState(s,transition){
  if(transition==='enable'&&!window.confirm('只启用这个固定覆盖版本。它不会授予任何外部动作权限，手动运行仍须提供本次授权。是否启用？'))return
  await api('/router-skills',{action:'overlay_lifecycle',...skillLocation(s),skill:skillRef(s),transition,resolvedVersion:s.overlay.resolvedVersion,expectedRevision:s.revision})
  await load()
}
function clearOverlayConflicts(){
  $('#skill-overlay-conflicts').textContent=''
  $('#skill-overlay-conflict-details').replaceChildren()
}
function showOverlayConflicts(saved){
  $('#skill-overlay-conflicts').textContent='这些字段不能自动迁移：'+saved.conflicts.join('、')+'。旧版保持不变。可对照文本后，在新版基础上手动创建覆盖层。'
  const list=$('#skill-overlay-conflict-details')
  for(const conflict of saved.conflictDetails??[]){
    const group=document.createElement('details'),heading=document.createElement('summary')
    const field=conflict.field
    heading.textContent=field==='title'?'名称':field==='objective'?'目标':'步骤说明 · '+field.slice('instruction:'.length)
    group.append(heading)
    for(const [label,value] of [['原基础版本',conflict.oldBase],['当前覆盖层',conflict.overlay],['新基础版本',conflict.newBase]]){
      const name=document.createElement('h4'),content=document.createElement('pre')
      name.textContent=label
      content.textContent=value===null?'该步骤在新基础版本中已移除。':value
      content.style.whiteSpace='pre-wrap';content.style.overflowWrap='anywhere'
      group.append(name,content)
    }
    list.append(group)
  }
}
function clearSkillPreview(){skillRequest++;$('#skill-preview').hidden=true;$('#skill-preview-content').textContent=''}
function clearSkills(){
  skillRequest++;editingSkill=runSkill=overlayBase=upgradingOverlay=undefined
  $('#skill-overlay').hidden=true;$('#skill-overlay-upgrade').hidden=true;clearOverlayConflicts()
  $('#skill-editor').hidden=true;$('#skill-run').hidden=true;$('#skill-preview').hidden=true;$('#skill-preview-content').textContent=''
}
function readVersion(s){
  return api('/router-skills/read',{id:s.id,version:s.version,scopeId:scope(),entryId:s.entryId})
}
async function editSkill(goalId,version){
  const generation=++skillRequest
  const latest=await api('/router-skills',{action:'draft',goalId})
  const source=version?await readVersion(version):latest
  if(generation!==skillRequest)return
  editingSkill={...source,expectedVersion:latest.version}
  const form=$('#skill-editor'),template=source.template
  form.elements.title.value=template.title;form.elements.objective.value=template.objective
  form.elements.criteria.value=JSON.stringify(template.criteria,null,2)
  form.elements.parameters.value=(source.parameters||[]).map(p=>p.name+' = '+p.label).join('\n')
  const steps=$('#skill-steps');steps.replaceChildren()
  for(const node of template.nodes){
    const row=document.createElement('div');row.className='row'
    const step=document.createElement('label');step.textContent=node.title
    const input=document.createElement('textarea');input.required=true;input.name='instruction';input.value=node.instruction;step.append(input)
    const label=document.createElement('label');label.textContent='执行 Worker'
    const worker=document.createElement('select');worker.name='worker';worker.required=true
    const allowed=scopes.scopes.find(s=>s.id===scope()).workerIds
    options(worker,catalog.workers.filter(w=>allowed.includes(w.id)).map(w=>[w.id,w.label||w.id]))
    worker.value=node.workerId;label.append(worker);row.append(step,label);steps.append(row)
  }
  form.hidden=false;form.elements.title.focus()
}
async function previewSkill(s){
  const generation=++skillRequest
  $('#skill-preview').hidden=false;$('#skill-preview-content').textContent='';$('#skill-preview-status').textContent='正在读取固定版本…'
  try{
    const version=await readVersion(s)
    if(generation!==skillRequest)return
    $('#skill-preview-status').textContent='v'+version.version+' · 只读检查，不授予权限；实际执行会重新检查。'
    const reasons={worker_unavailable:'所需 Worker 不在当前项目权限内或已移除，请由管理员选择可用 Worker 并另存新版本。',worker_paused:'所需 Worker 已暂停；请检查角色状态，预览不会启用它。',backend_not_allowed:'当前项目不允许该后端，请检查项目后端权限。',backend_unavailable:'所需后端配置不存在，请检查连接设置。',backend_not_managed:'后端缺少受管执行必需能力，不可用普通 ACP 冒充。',backend_resource_limit:'当前 Worker 设置超过后端资源上限，请调整配置后重新检查。',backend_policy_unsupported:'当前后端无法执行所配置的资源限制，请检查后端能力和限制配置。'}
    const checks=version.inspection.dependencies.map(d=>d.nodeId+'：'+(d.reason?reasons[d.reason]:'配置存在，实际权限和连接仍在执行时核验。')+(d.connections||[]).map(c=>'\n  '+c.id+'：'+(c.state==='blocked'?'连接未启用或已移除，请在连接设置中检查；此处不会启用。':'已配置，未验证真实调用或账号权限。')).join('')).join('\n')
    $('#skill-preview-content').textContent='依赖检查（不授予权限；仅检查已声明的 Worker 和所选连接，不推断正文中的隐含要求）\n'+checks+'\n\n完整固定版本内容\n'+JSON.stringify(version,null,2)
  }catch(error){if(generation===skillRequest)$('#skill-preview-status').textContent=error.message}
}
function renderSkills(){
  options($('#accepted-goal'),state.acceptedGoals.map(g=>[g.id,g.title]));$('#draft-skill').disabled=!state.acceptedGoals.length
  options($('#schedule-skill'),[['','自定义任务'],...state.skills.filter(s=>!s.overlay&&(!s.state||s.state==='active')&&!s.parameters?.length).map(s=>[skillKey(s),s.title+' · v'+s.version])])
  renderSkillTable()
}
function renderSkillTable(){
  const accepted=new Set(state.acceptedGoals.filter(g=>g.skill).map(g=>skillKey(g.skill)))
  table('#skills',['技能','项目入口','版本','此版运行验收','操作'],state.skills.filter(s=>(!$('#skill-state').value||s.state===$('#skill-state').value)&&((s.title+' '+(s.objective||'')).toLowerCase().includes($('#skill-search').value.trim().toLowerCase()))).map(s=>[s.title,scopeName(s.entryId),s.overlay?'v'+s.version+' · 基础 v'+s.overlay.base.version:'v'+s.version,s.overlay?overlayLabel[s.state]:s.state==='retired'?'已停用':s.state==='candidate'?'待试用':accepted.has(skillKey(s))?'已通过':s.validation==='source'?'源任务已验收':'暂无通过记录',actions(
    button('查看此版和依赖',()=>previewSkill(s)),
    ...(!s.overlay?[button('编辑或恢复此版',()=>editSkill(s.goalId,s))]:[]),
    ...(!s.overlay&&s.state==='active'?[button('创建覆盖层',()=>openOverlay(s))]:[]),
    ...(s.overlay&&s.state!=='retired'&&newerBases(s).length?[button('选择新版基础',()=>openOverlayUpgrade(s))]:[]),
    ...(s.overlay&&['candidate','review_required'].includes(s.state)?[button('校验此版',()=>changeOverlayState(s,'validate'))]:[]),
    ...(s.overlay&&s.state==='validated'?[button('启用此版',()=>changeOverlayState(s,'enable'))]:[]),
    ...(s.overlay&&['active','validated'].includes(s.state)?[button('标记为待复核',()=>changeOverlayState(s,'request_review'))]:[]),
    ...(s.state!=='retired'&&(!s.overlay||s.state==='active')?[button('手动运行',()=>{runSkill={...s,operationId:crypto.randomUUID()};const form=$('#skill-run');options(form.elements.anchor,catalog.contexts.filter(c=>c.entryId===s.entryId).map(c=>[c.id,c.label]));const fields=$('#skill-inputs');fields.replaceChildren();for(const p of s.parameters||[]){const label=document.createElement('label');label.textContent=p.label;const input=document.createElement('input');input.name='input:'+p.name;input.required=true;input.maxLength=2000;label.append(input);fields.append(label)}form.hidden=false;form.elements.quote.focus()})]:[]),
    ...(s.state!=='retired'?[button(s.overlay?'退役此版':'停用此版',async()=>{await api('/router-skills',{action:'retire',skill:skillRef(s),...skillLocation(s),expectedRevision:s.revision||0});await load()})]:[]),
    ...(!s.overlay&&(!s.state||s.state==='active')&&!s.parameters?.length?[button('绑定事件',()=>{location.href='/webhook-workbench?'+new URLSearchParams({skill:s.id,version:s.version,scope:scope(),entry:s.entryId})})]:[])
  )]))
}
$('#skill-search').oninput=renderSkillTable
$('#skill-state').onchange=renderSkillTable
$('#close-skill-preview').onclick=clearSkillPreview
$('#draft-skill').onclick=()=>editSkill($('#accepted-goal').value).catch(e=>notice(e.message,true))
$('#close-skill').onclick=clearSkills
$('#skill-editor').onsubmit=async e=>{
  e.preventDefault();const s=editingSkill,f=new FormData(e.target)
  try{const instructions=f.getAll('instruction'),workers=f.getAll('worker')
    const template={...s.template,title:f.get('title'),objective:f.get('objective'),criteria:JSON.parse(f.get('criteria')),nodes:s.template.nodes.map((n,i)=>({...n,instruction:instructions[i],workerId:workers[i]}))}
    const saved=await api('/router-skills',{action:'save',goalId:s.goalId,expectedVersion:s.expectedVersion,template,parameters:String(f.get('parameters')||'').split('\n').filter(s=>s.trim()).map(line=>{const [name,...label]=line.split('=');return {name:name.trim(),label:label.join('=').trim()||name.trim()}})})
    clearSkills();await load();notice('已保存 v'+saved.version)
  }catch(error){notice(error.message,true)}
}
$('#close-skill-overlay').onclick=clearSkills
$('#close-skill-overlay-upgrade').onclick=clearSkills
$('#skill-overlay').onsubmit=async e=>{
  e.preventDefault();const selection=overlayBase,generation=skillRequest,submit=e.target.querySelector('button')
  if(!selection||submit.disabled)return
  const edits=Array.from($('#skill-overlay-fields').querySelectorAll('textarea')).filter(input=>input.value.trim()).map(input=>({field:input.dataset.field,value:input.value,...(input.dataset.nodeId?{nodeId:input.dataset.nodeId}:{})}))
  submit.disabled=true
  try{
    if(!edits.length)throw Error('请至少填写一项覆盖内容')
    const saved=await api('/router-skills',{action:'overlay',base:skillRef(selection.base),edits,...selection.location,expectedVersion:selection.expectedVersion})
    if(generation!==skillRequest)return
    clearSkills();await load();notice('已保存覆盖候选 v'+saved.version)
  }catch(error){if(generation===skillRequest)notice(error.message,true)}finally{submit.disabled=false}
}
$('#skill-overlay-upgrade').elements.base.onchange=clearOverlayConflicts
$('#skill-overlay-upgrade').onsubmit=async e=>{
  e.preventDefault();const selection=upgradingOverlay,generation=skillRequest,submit=e.target.querySelector('button'),picker=e.target.elements.base
  if(!selection||submit.disabled)return
  clearOverlayConflicts()
  submit.disabled=true;picker.disabled=true
  try{
    const base=JSON.parse(picker.value)
    const saved=await api('/router-skills',{action:'upgrade_overlay',skill:selection.skill,base,...selection.location,expectedVersion:selection.expectedVersion})
    if(generation!==skillRequest)return
    if(saved.conflicts){showOverlayConflicts(saved);return}
    clearSkills();await load();notice('已保存升级候选 v'+saved.version+'，需要重新校验和启用')
  }catch(error){if(generation===skillRequest)notice(error.message,true)}finally{submit.disabled=false;picker.disabled=false}
}
$('#skill-run').onsubmit=async e=>{
  e.preventDefault();const f=new FormData(e.target),submit=e.target.querySelector('button');submit.disabled=true
  try{const goal=await api('/router-skills',{action:'run',skill:{id:runSkill.id,version:runSkill.version},triggerId:f.get('anchor'),authorizationQuote:f.get('quote'),operationId:runSkill.operationId,inputs:Object.fromEntries((runSkill.parameters||[]).map(p=>[p.name,f.get('input:'+p.name)]))})
    clearSkills();await load();notice('已启动目标 '+goal.title)
  }catch(error){notice(error.message,true)}finally{submit.disabled=false}
}
`
