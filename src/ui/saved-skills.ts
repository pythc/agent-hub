/** Shares the proactive workbench's scope selector, table renderer and request helper. */
export const skillSection=`<section aria-labelledby="skill-heading"><h2 id="skill-heading">可复用技能</h2>
<p>工具执行原子动作；Worker 模板定义角色和后端要求；技能保存固定版本的方法。查看、保存或选择都不会安装连接或授予权限。</p>
<label>搜索方法<input id="skill-search" type="search" placeholder="名称或目标"></label><label>状态<select id="skill-state"><option value="">全部</option><option value="active">可用</option><option value="candidate">待试用</option><option value="retired">已停用</option></select></label>
<section id="skill-preview" hidden aria-labelledby="skill-preview-title"><h3 id="skill-preview-title">固定版本方法</h3><p id="skill-preview-status" role="status"></p><pre id="skill-preview-content" style="white-space:pre-wrap;overflow-wrap:anywhere"></pre><button type="button" id="close-skill-preview">关闭预览</button></section>
<label>已验收目标<select id="accepted-goal"></select></label><button type="button" id="draft-skill">从目标保存技能</button>
<div id="skills" class="table"></div><form id="skill-editor" hidden>
<div class="row"><label>名称<input name="title" required></label><label>目标与所需输入<textarea name="objective" required></textarea></label></div>
<div id="skill-steps"></div><label>验收条件（JSON）<textarea name="criteria" required></textarea></label>
<label>输入参数（每行 name = 名称）<textarea name="parameters" placeholder="file = 文件路径"></textarea></label><button>保存新版本</button> <button type="button" class="secondary" id="close-skill">收起</button></form>
<form id="skill-run" hidden><h3>运行选定版本</h3><label>本次授权对话<select name="anchor" required></select></label>
<label>本次请求原文<input name="quote" required></label><div id="skill-inputs"></div><button>启动实际任务</button></form></section>`
export const skillScript=String.raw`
let editingSkill,runSkill,skillRequest=0
const skillKey=s=>JSON.stringify({id:s.id,version:s.version})
function clearSkillPreview(){skillRequest++;$('#skill-preview').hidden=true;$('#skill-preview-content').textContent=''}
function clearSkills(){
  skillRequest++;editingSkill=runSkill=undefined
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
    const reasons={worker_unavailable:'所需 Worker 不在当前项目权限内或已移除，请由管理员选择可用 Worker 并另存新版本。',worker_paused:'所需 Worker 已暂停；请检查角色状态，预览不会启用它。',backend_not_allowed:'当前项目不允许该后端，请检查项目后端权限。',backend_unavailable:'所需后端配置不存在，请检查连接设置。',backend_not_managed:'后端缺少受管执行必需能力，不可用普通 ACP 冒充。'}
    const checks=version.inspection.dependencies.map(d=>d.nodeId+'：'+(d.reason?reasons[d.reason]:'配置存在，实际权限和连接仍在执行时核验。')+(d.connections||[]).map(c=>'\n  '+c.id+'：'+(c.state==='blocked'?'连接未启用或已移除，请在连接设置中检查；此处不会启用。':'已配置，未验证真实调用或账号权限。')).join('')).join('\n')
    $('#skill-preview-content').textContent='依赖检查（不授予权限；仅检查已声明的 Worker 和所选连接，不推断正文中的隐含要求）\n'+checks+'\n\n完整固定版本内容\n'+JSON.stringify(version,null,2)
  }catch(error){if(generation===skillRequest)$('#skill-preview-status').textContent=error.message}
}
function renderSkills(){
  options($('#accepted-goal'),state.acceptedGoals.map(g=>[g.id,g.title]));$('#draft-skill').disabled=!state.acceptedGoals.length
  options($('#schedule-skill'),[['','自定义任务'],...state.skills.filter(s=>(!s.state||s.state==='active')&&!s.parameters?.length).map(s=>[skillKey(s),s.title+' · v'+s.version])])
  renderSkillTable()
}
function renderSkillTable(){
  const accepted=new Set(state.acceptedGoals.filter(g=>g.skill).map(g=>skillKey(g.skill)))
  table('#skills',['技能','项目入口','版本','此版运行验收','操作'],state.skills.filter(s=>(!$('#skill-state').value||s.state===$('#skill-state').value)&&((s.title+' '+(s.objective||'')).toLowerCase().includes($('#skill-search').value.trim().toLowerCase()))).map(s=>[s.title,scopeName(s.entryId),'v'+s.version,s.state==='retired'?'已停用':s.state==='candidate'?'待试用':accepted.has(skillKey(s))?'已通过':s.validation==='source'?'源任务已验收':'暂无通过记录',actions(
    button('查看此版和依赖',()=>previewSkill(s)),
    button('编辑或恢复此版',()=>editSkill(s.goalId,s)),
    ...(s.state==='retired'?[]:[button('手动运行',()=>{runSkill={...s,operationId:crypto.randomUUID()};const form=$('#skill-run');options(form.elements.anchor,catalog.contexts.filter(c=>c.entryId===s.entryId).map(c=>[c.id,c.label]));const fields=$('#skill-inputs');fields.replaceChildren();for(const p of s.parameters||[]){const label=document.createElement('label');label.textContent=p.label;const input=document.createElement('input');input.name='input:'+p.name;input.required=true;input.maxLength=2000;label.append(input);fields.append(label)}form.hidden=false;form.elements.quote.focus()}),
    button('停用此版',async()=>{await api('/router-skills',{action:'retire',skill:{id:s.id,version:s.version},scopeId:scope(),entryId:s.entryId,expectedRevision:s.revision||0});await load()})]),
    ...((!s.state||s.state==='active')&&!s.parameters?.length?[button('绑定事件',()=>{location.href='/webhook-workbench?'+new URLSearchParams({skill:s.id,version:s.version,scope:scope(),entry:s.entryId})})]:[])
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
$('#skill-run').onsubmit=async e=>{
  e.preventDefault();const f=new FormData(e.target),submit=e.target.querySelector('button');submit.disabled=true
  try{const goal=await api('/router-skills',{action:'run',skill:{id:runSkill.id,version:runSkill.version},triggerId:f.get('anchor'),authorizationQuote:f.get('quote'),operationId:runSkill.operationId,inputs:Object.fromEntries((runSkill.parameters||[]).map(p=>[p.name,f.get('input:'+p.name)]))})
    clearSkills();await load();notice('已启动目标 '+goal.title)
  }catch(error){notice(error.message,true)}finally{submit.disabled=false}
}
`
