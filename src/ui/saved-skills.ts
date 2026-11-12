/** Shares the proactive workbench's scope selector, table renderer and request helper. */
export const skillSection=`<section aria-labelledby="skill-heading"><h2 id="skill-heading">可复用技能</h2>
<label>已验收目标<select id="accepted-goal"></select></label><button type="button" id="draft-skill">从目标保存技能</button>
<div id="skills" class="table"></div><form id="skill-editor" hidden>
<div class="row"><label>名称<input name="title" required></label><label>目标与所需输入<textarea name="objective" required></textarea></label></div>
<div id="skill-steps"></div><label>验收条件（JSON）<textarea name="criteria" required></textarea></label>
<button>保存新版本</button> <button type="button" class="secondary" id="close-skill">收起</button></form>
<form id="skill-run" hidden><h3>运行选定版本</h3><label>本次授权对话<select name="anchor" required></select></label>
<label>本次请求原文<input name="quote" required></label><button>启动实际任务</button></form></section>`
export const skillScript=String.raw`
let editingSkill,runSkill,skillRequest=0
const skillKey=s=>JSON.stringify({id:s.id,version:s.version})
function clearSkills(){
  skillRequest++;editingSkill=runSkill=undefined
  $('#skill-editor').hidden=true;$('#skill-run').hidden=true
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
function renderSkills(){
  options($('#accepted-goal'),state.acceptedGoals.map(g=>[g.id,g.title]));$('#draft-skill').disabled=!state.acceptedGoals.length
  options($('#schedule-skill'),[['','自定义任务'],...state.skills.map(s=>[skillKey(s),s.title+' · v'+s.version])])
  const accepted=new Set(state.acceptedGoals.filter(g=>g.skill).map(g=>skillKey(g.skill)))
  table('#skills',['技能','项目入口','版本','此版运行验收','操作'],state.skills.map(s=>[s.title,scopeName(s.entryId),'v'+s.version,accepted.has(skillKey(s))?'已通过':'暂无通过记录',actions(
    button('编辑或恢复此版',()=>editSkill(s.goalId,s)),
    button('手动运行',()=>{runSkill={...s,operationId:crypto.randomUUID()};const form=$('#skill-run');options(form.elements.anchor,catalog.contexts.filter(c=>c.entryId===s.entryId).map(c=>[c.id,c.label]));form.hidden=false;form.elements.quote.focus()}),
    button('绑定事件',()=>{location.href='/webhook-workbench?'+new URLSearchParams({skill:s.id,version:s.version,scope:scope(),entry:s.entryId})})
  )]))
}
$('#draft-skill').onclick=()=>editSkill($('#accepted-goal').value).catch(e=>notice(e.message,true))
$('#close-skill').onclick=clearSkills
$('#skill-editor').onsubmit=async e=>{
  e.preventDefault();const s=editingSkill,f=new FormData(e.target)
  try{const instructions=f.getAll('instruction'),workers=f.getAll('worker')
    const template={...s.template,title:f.get('title'),objective:f.get('objective'),criteria:JSON.parse(f.get('criteria')),nodes:s.template.nodes.map((n,i)=>({...n,instruction:instructions[i],workerId:workers[i]}))}
    const saved=await api('/router-skills',{action:'save',goalId:s.goalId,expectedVersion:s.expectedVersion,template})
    clearSkills();await load();notice('已保存 v'+saved.version)
  }catch(error){notice(error.message,true)}
}
$('#skill-run').onsubmit=async e=>{
  e.preventDefault();const f=new FormData(e.target),submit=e.target.querySelector('button');submit.disabled=true
  try{const goal=await api('/router-skills',{action:'run',skill:{id:runSkill.id,version:runSkill.version},triggerId:f.get('anchor'),authorizationQuote:f.get('quote'),operationId:runSkill.operationId})
    clearSkills();await load();notice('已启动目标 '+goal.title)
  }catch(error){notice(error.message,true)}finally{submit.disabled=false}
}
`
