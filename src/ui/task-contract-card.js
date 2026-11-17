// Stateless display only. The drawer owner supplies its current-context DTO and task ID.
// No fetch, authority, mutation, cache, or recovery behavior belongs in this card.
function taskContractCardData(value,expectedTaskId){
 const object=v=>!!v&&typeof v==='object'&&!Array.isArray(v)
 const own=(v,key)=>{if(!object(v))return undefined;const field=Object.getOwnPropertyDescriptor(v,key);return field&&Object.hasOwn(field,'value')?field.value:undefined}
 const text=(v,max)=>typeof v==='string'&&v.length>0&&v.length<=max
 const revision=v=>v===null||typeof v==='number'&&Number.isSafeInteger(v)&&v>=0
 const list=(v,max,convert)=>{
  if(!Array.isArray(v))return null
  const length=Object.getOwnPropertyDescriptor(v,'length')?.value
  if(!Number.isSafeInteger(length)||length<0||length>max)return null
  const result=[]
  for(let i=0;i<length;i++){const field=Object.getOwnPropertyDescriptor(v,String(i));if(!field||!Object.hasOwn(field,'value'))return null;const item=convert(field.value);if(item===undefined)return null;result.push(item)}
  return result
 }
 try{
  const subject=own(value,'subject'),state=own(value,'availability'),at=own(value,'observedAt')
  if(!text(expectedTaskId,1000)||own(value,'schema')!==1||own(value,'readOnly')!==true||own(subject,'kind')!=='task'||own(subject,'id')!==expectedTaskId||typeof at!=='number'||!Number.isSafeInteger(at)||at<0||at>8640000000000000)return {state:'unavailable'}
  if(state==='not_captured')return {state:'not_captured'}
  if(state!=='available'||own(value,'contentSource')!=='router_saved_goal'||own(value,'scope')!==null)return {state:'unavailable'}
  const basis=own(value,'basis'),contract=own(basis,'contract'),digest=own(contract,'digest'),objective=own(value,'objective'),criteria=list(own(value,'criteria'),50,c=>text(own(c,'id'),200)&&text(own(c,'description'),4000)?{id:own(c,'id'),description:own(c,'description')}:undefined),deliverables=own(value,'deliverables'),budget=own(value,'budget')
  if(!object(basis)||own(contract,'kind')!=='goal_contract'||!text(digest,64)||!/^([a-f0-9]{64})$/.test(digest)||!text(own(basis,'goalId'),1000)||!text(objective,16000)||!criteria||criteria.length===0)return {state:'unavailable'}
  if(!['goalRevision','planRevision','ownerEpoch','dataRevision','bindingRevision'].every(key=>revision(own(basis,key)))||!(own(basis,'assignmentId')===null||text(own(basis,'assignmentId'),1000)))return {state:'unavailable'}
  const path=v=>text(v,1000)&&!/^([\\/]|[a-z]:)/i.test(v)&&!v.split(/[\\/]/).includes('..')&&v!=='.'?v:undefined
  const files=list(own(deliverables,'files'),1000,path),documents=list(own(deliverables,'documents'),1000,v=>text(v,200)?v:undefined)
  if(!files||!documents||new Set(criteria.map(c=>c.id)).size!==criteria.length||new Set(files).size!==files.length||new Set(documents).size!==documents.length)return {state:'unavailable'}
  let limits=null
  if(budget!==null){
   const minutes=own(budget,'maxMinutes'),usd=own(budget,'maxUsd'),limit=v=>v===null||typeof v==='number'&&Number.isFinite(v)&&v>0
   if(own(budget,'scope')!=='code_project'||own(budget,'basis')!=='configured_estimate'||!limit(minutes)||!limit(usd)||minutes===null&&usd===null)return {state:'unavailable'}
   limits={minutes,usd}
  }
  return {state:'available',objective,criteria:criteria.map(c=>c.description),files:[...files],documentCount:documents.length,limits}
 }catch{return {state:'unavailable'}}
}
function taskContractCard(value,expectedTaskId){
 const data=taskContractCardData(value,expectedTaskId),card=el('section','task-contract-card')
 card.dataset.state=data.state
 card.setAttribute('aria-label',L('Saved task agreement','已保存的任务约定'))
 if(data.state!=='available'){
  card.append(el('p','task-contract-state',data.state==='not_captured'?L('No acceptance criteria are available to show.','暂无可显示的验收条件。'):L('The saved task agreement is unavailable.','任务约定暂不可用。')))
  return card
 }
 card.append(el('h3','',L('Saved goal','已保存目标')),el('p','task-contract-objective',data.objective),el('h4','',L('Acceptance criteria','验收条件')))
 const criteria=el('ul','task-contract-criteria');for(const item of data.criteria)criteria.append(el('li','',item));card.append(criteria)
 if(data.files.length||data.documentCount||data.limits){
  const details=el('details','task-contract-details');details.append(el('summary','',L('View agreement details','查看约定详情')))
  if(data.files.length){const files=el('ul','task-contract-files');for(const path of data.files)files.append(el('li','',path));details.append(el('h4','',L('Files for review','验收涉及文件')),files)}
  if(data.documentCount)details.append(el('p','',L('Related documents: '+data.documentCount,'关联文档：'+data.documentCount+' 份')))
  if(data.files.length||data.documentCount)details.append(el('p','task-contract-note',L('These are review requirements, not proof of completed or accepted work.','这些是验收要求，不代表文件已生成或验收已通过。')))
  if(data.limits){
   const number=n=>n.toLocaleString(lang,{maximumSignificantDigits:8})
   details.append(el('h4','',L('Configured project budget','项目配置预算')))
   if(data.limits.minutes!==null)details.append(el('p','',L('Time budget: '+number(data.limits.minutes)+' minutes','时间预算：'+number(data.limits.minutes)+' 分钟')))
   if(data.limits.usd!==null)details.append(el('p','',L('Estimated cost ceiling: US$'+number(data.limits.usd),'费用上限（估算）：US$'+number(data.limits.usd))))
   details.append(el('p','task-contract-note',L('Configured estimates, not an account balance or a guaranteed final cost.','这是配置中的估算，不代表账户余额或最终费用。')))
  }
  card.append(details)
 }
 return card
}
