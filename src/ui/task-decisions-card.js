// Pure retained-record display. These records grant no permission or execution status.
function taskDecisionsCardData(value,expectedTaskId){
 const record=(v,keys)=>{
  if(!v||typeof v!=='object'||Array.isArray(v))return null
  const actual=Reflect.ownKeys(v);if(actual.length!==keys.length||actual.some(k=>typeof k!=='string'||!keys.includes(k)))return null
  const result=Object.create(null)
  for(const key of keys){const field=Object.getOwnPropertyDescriptor(v,key);if(!field||!Object.hasOwn(field,'value'))return null;result[key]=field.value}
  return result
 }
 const list=(v,max)=>{
  if(!Array.isArray(v))return null
  const length=Object.getOwnPropertyDescriptor(v,'length')?.value
  if(!Number.isSafeInteger(length)||length<0||length>max)return null
  const keys=Reflect.ownKeys(v);if(keys.length!==length+1)return null
  const out=[];for(let i=0;i<length;i++){const field=Object.getOwnPropertyDescriptor(v,String(i));if(!field||!Object.hasOwn(field,'value'))return null;out.push(field.value)}return out
 }
 const time=v=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0&&v<=8640000000000000
 const words=v=>typeof v==='string'&&v.length>0&&v.length<=16000
 const content=v=>{
  const c=record(v,['kind','text','recordedAt','sources']);if(!c||!['requirement','decision','commitment'].includes(c.kind)||!words(c.text)||!time(c.recordedAt))return null
  const refs=list(c.sources,5);if(!refs||!refs.length)return null
  const sources=[];for(const raw of refs){const source=record(raw,['speaker','text','recordedAt']);if(!source||!['user','assistant'].includes(source.speaker)||!words(source.text)||!time(source.recordedAt))return null;sources.push(source)}return{...c,sources}
 }
 try{
  if(typeof expectedTaskId!=='string'||!expectedTaskId)return null
  const v=record(value,['schema','readOnly','taskState','operations','subject','observedAt','items','more']);if(!v||v.schema!==3||!['active','ended'].includes(v.taskState)||v.readOnly!==true||!time(v.observedAt)||typeof v.more!=='boolean')return null
  const subject=record(v.subject,['kind','id']);if(!subject||subject.kind!=='task'||subject.id!==expectedTaskId)return null
  const operations=record(v.operations,['items','more']);if(!operations||typeof operations.more!=='boolean')return null
  const rawOperations=list(operations.items,20);if(!rawOperations)return null
  const operationItems=[];for(const raw of rawOperations){
   if(!raw||typeof raw!=='object')return null
   const op=record(raw,['kind','label','from','to','proposedAt','confirmation','execution',...(Object.hasOwn(raw,'confirmationAt')?['confirmationAt']:[]),...(Object.hasOwn(raw,'finishedAt')?['finishedAt']:[])])
   if(!op||op.kind!=='workflow_status'||![op.label,op.from,op.to].every(words)||!time(op.proposedAt)||!['not_recorded','approved','declined'].includes(op.confirmation)||!['not_recorded','in_progress','applied_readback','observed_only','unknown','not_applied'].includes(op.execution)||op.confirmationAt!==undefined&&(!time(op.confirmationAt)||op.confirmationAt<op.proposedAt||op.finishedAt!==undefined&&op.finishedAt<op.confirmationAt)||op.finishedAt!==undefined&&(!time(op.finishedAt)||op.finishedAt<op.proposedAt)||op.confirmation==='not_recorded'&&op.confirmationAt!==undefined||op.confirmation!=='not_recorded'&&op.confirmationAt===undefined||op.execution==='applied_readback'&&(op.confirmation!=='approved'||op.finishedAt===undefined)||op.execution==='observed_only'&&op.finishedAt===undefined)return null
   operationItems.push(op)
  }
  const entries=list(v.items,5);if(!entries||!entries.length&&!operationItems.length)return null
  const items=[];for(const raw of entries){
   if(!raw||typeof raw!=='object')return null
   const hasPrevious=Object.hasOwn(raw,'previous'),entry=record(raw,['kind','text','recordedAt','sources','confirmation','execution','history','historyMore',...(hasPrevious?['previous']:[])]);if(!entry||entry.confirmation!=='not_recorded'||entry.execution!=='not_recorded'||typeof entry.historyMore!=='boolean')return null
   const current=content({kind:entry.kind,text:entry.text,recordedAt:entry.recordedAt,sources:entry.sources}),previous=hasPrevious?content(entry.previous):null
   const old=list(entry.history,20);if(!old)return null;const history=old.map(content);if(!current||history.some(v=>!v)||hasPrevious&&!previous||!!history.length!==hasPrevious||hasPrevious&&JSON.stringify(previous)!==JSON.stringify(history[0]))return null;items.push({...current,history,historyMore:entry.historyMore,...(previous?{previous}:{})})
  }
  return{items,more:v.more,taskState:v.taskState,operations:{items:operationItems,more:operations.more}}
 }catch{return null}
}
function taskDecisionsCard(value,expectedTaskId){
 const data=taskDecisionsCardData(value,expectedTaskId);if(!data)return null
 const card=el('section','task-decisions-card'),title=L('Related records and sources','相关记录与来源');card.setAttribute('aria-label',title);card.append(el('h3','',title),el('p','',L('These are sourced records, not approval or proof of execution. Confirmation: not recorded. Execution: not recorded. A replacement changes this record, not task permissions or completed effects.','以下是有来源的记录，不是授权或执行证明。确认：未记录。执行：未记录。替代只改变记录，不改变任务权限或已发生的操作。')))
 if(data.taskState==='ended')card.append(el('p','',L('Task ended. Retained history remains read-only under current source permissions.','任务已结束。保留历史仍按当前来源权限只读展示。')))
 const label=kind=>kind==='requirement'?L('Requirement · quoted words','需求 · 原话摘录'):kind==='decision'?L('Decision · assistant record','决定 · 助手记录'):L('Commitment · assistant record','承诺 · 助手记录')
 const sources=(parent,refs)=>{for(const source of refs){const who=L(source.speaker==='user'?'Original message':'Assistant record',source.speaker==='user'?'用户原话':'助手记录'),quote=el('blockquote','',source.text);parent.append(el('p','task-decisions-label',who),quote)}}
 for(const item of data.items){
  const entry=el('div','task-decision'),detail=el('details','task-decision-sources');entry.append(el('p','task-decisions-label',label(item.kind)),el('p','task-decision-text',item.text),el('p','task-decisions-label',L('Recorded: ','记录时间：')+new Date(item.recordedAt).toISOString()));detail.append(el('summary','',item.previous?L('Sources and previous version','原话与上一版'):L('View original words','查看原话')));sources(detail,item.sources)
  for(const old of item.history){detail.append(el('p','task-decisions-label',L('Replaced record','已被替代的记录')),el('p','task-decision-text',old.text),el('p','task-decisions-label',L('Recorded: ','记录时间：')+new Date(old.recordedAt).toISOString()));sources(detail,old.sources)}
  if(item.historyMore)detail.append(el('p','',L('Earlier history is incomplete or exceeds this view’s limit.','更早的历史不完整或超出本视图上限。')))
  if(item.previous)entry.append(el('p','',L('Impact: this record replaces the previous wording. No permission or completed effect is changed.','影响：此记录取代此前表述；不改变权限或已发生的操作。')))
  entry.append(detail);card.append(entry)
 }
 if(data.more)card.append(el('p','',L('Showing the five latest related records.','这里只显示最近五条相关记录。')))
 if(data.operations.items.length){
  card.append(el('h3','',L('Concrete operation history','具体操作历史')),el('p','',L('These are separate workflow proposals with their own confirmation and readback receipts. They do not prove a journal record was approved or carried out.','以下是独立的工作流提案及其确认、回读回执；不据此认定上面的文字记录已获批准或已执行。')))
  const confirmations={not_recorded:L('Not recorded','未记录'),approved:L('Approved','已批准'),declined:L('Declined','已拒绝')},executions={not_recorded:L('No execution receipt','无执行回执'),in_progress:L('Submitting; not confirmed','提交中，尚未证实'),applied_readback:L('Written and read back','已写入并回读'),observed_only:L('Target state observed; writer unconfirmed','已回读目标状态，写入方未确认'),unknown:L('Outcome unknown; do not replay','结果未知，不得重放'),not_applied:L('Not applied by this proposal','此提案未写入')}
  for(const op of data.operations.items){const entry=el('div','task-decision');entry.append(el('p','task-decision-text',op.label+' · '+op.from+' → '+op.to),el('p','',L('Proposed: ','提议时间：')+new Date(op.proposedAt).toISOString()),el('p','',L('Confirmation: ','确认：')+confirmations[op.confirmation]+(op.confirmationAt!==undefined?' · '+new Date(op.confirmationAt).toISOString():'')),el('p','',L('Execution: ','执行：')+executions[op.execution]+(op.finishedAt!==undefined?' · '+new Date(op.finishedAt).toISOString():'')));card.append(entry)}
  if(data.operations.more)card.append(el('p','',L('Showing the twenty latest visible operation proposals.','这里只显示最近二十条可见操作提案。')))
 }
 return card
}
