import {useEffect,useRef,useState} from 'react';
import type {MemoryProjection} from '../../src/router-memory.ts';
import type {SkillVersion} from '../../src/saved-skills.ts';
import './memory.css';
import {memoryProvenance} from './memory-provenance.ts';

type Labels=(en:string,zh:string)=>string;
type Method={id:string;version:number;goalId:string;title:string;state:string;revision:number;passed:number;failed:number;parameters:{name:string;label:string}[]};
type Entry={conversationId?:string;request:{id:string;text:string};id:string;label:string;scopeId:string;revision:number;enabled:boolean;policy:{writeMode:string};items:MemoryProjection[];skills:Method[];goals:{id:string;title:string}[];cooperation:{id:string;content:string;condition:string}[]};
async function request<T>(body?:unknown,signal?:AbortSignal):Promise<T>{
 const response=await fetch('/api/chat/memory',{signal,...(body?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{})});
 if(!response.ok)throw Error('memory_request_failed');return response.json();
}
function download(file:string,text:string){const url=URL.createObjectURL(new Blob([text],{type:'text/markdown;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download=file;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function MemoryRow({fact:f,entry,L,changed}:{fact:MemoryProjection;entry:Entry;L:Labels;changed:()=>void}){
 const editButton=useRef<HTMLButtonElement>(null),deleteButton=useRef<HTMLButtonElement>(null);
 const cancel=(mode:'edit'|'delete')=>{setEdit(null);setDeleting(false);setError(false);requestAnimationFrame(()=>{(mode==='edit'?editButton:deleteButton).current?.focus();});};
 const [edit,setEdit]=useState<{content:string;condition:string}|null>(null),[deleting,setDeleting]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(false);
 const [detail,setDetail]=useState<{evidence:{id:string;text:string;locator:string}[];versions:MemoryProjection[]}|null>(null);
 const mutate=async(action:string,extra:Record<string,unknown>={})=>{setBusy(true);setError(false);try{await request({entryId:entry.id,id:f.id,revision:f.revision,action,...extra});setEdit(null);setDeleting(false);setDetail(null);changed();}catch{setError(true);}finally{setBusy(false);}};
 const inspect=async()=>{setBusy(true);setError(false);try{const result=await request<{detail:NonNullable<typeof detail>}>({entryId:entry.id,action:'inspect',id:f.id});setDetail(result.detail);}catch{setError(true);}finally{setBusy(false);}};
 const provenance=memoryProvenance(f,L);
 const context=[f.learning?.condition,f.learning?.discussion?L('One conversation only','仅对应会话'):undefined].filter(Boolean).join(' · ');
 return <article className="memory-note" data-memory-id={f.id}>
  {edit?<form className="memory-edit" onSubmit={e=>{e.preventDefault();void mutate('edit',edit);}}>
   <label>{L('Memory content','记忆内容')}<textarea autoFocus value={edit.content} required maxLength={16000} onChange={e=>setEdit({...edit,content:e.target.value})}/></label>
   <label>{L('When to use','适用情况')}<input value={edit.condition} maxLength={300} onChange={e=>setEdit({...edit,condition:e.target.value})}/></label>
   <div className="memory-actions"><button className="button primary" disabled={busy}>{L('Save','保存')}</button><button type="button" className="text-button" disabled={busy} onClick={()=>cancel('edit')}>{L('Cancel','取消')}</button></div>
  </form>:<>
   <p className="memory-content">{f.content}</p>
   {context&&<p className="memory-context">{context}</p>}
   {provenance.length>0&&<p className="memory-provenance">{provenance.map(detail=>detail.value).join(' · ')}</p>}
   {f.state==='candidate'&&(f.proposalAction==='forget'||!!f.replaces?.length)&&<p>{f.proposalAction==='forget'?L('Proposes forgetting this memory','建议删除这条记忆'):L('Proposes replacing an earlier memory','建议替换原有记忆')}</p>}
   <div className="memory-actions">
    {f.state==='candidate'?<><button className="text-button" disabled={busy} onClick={()=>void mutate('confirm')}>{L('Accept','采纳')}</button><button className="text-button" disabled={busy} onClick={()=>void mutate('dismiss')}>{L('Dismiss','忽略')}</button></>:
     <><button className="text-button" disabled={busy} ref={editButton} onClick={()=>setEdit({content:f.content,condition:f.learning?.condition??''})}>{L('Edit','修改')}</button><button className="text-button" disabled={busy} ref={deleteButton} onClick={()=>setDeleting(true)}>{L('Delete','删除')}</button></>}
    <button className="text-button" disabled={busy} onClick={()=>detail?setDetail(null):void inspect()}>{detail?L('Hide source','收起来源'):L('Source & history','来源与历史')}</button>
   </div>
   {deleting&&<div className="memory-delete"><span>{L('Delete this memory?','删除这条记忆？')}</span><button className="text-button" disabled={busy} onClick={()=>void mutate('forget')}>{L('Delete','删除')}</button><button className="text-button" onClick={()=>cancel('delete')}>{L('Cancel','取消')}</button></div>}
  </>}
  {detail&&<div className="memory-evidence">{f.learning?.quote&&<blockquote>{f.learning.quote}</blockquote>}{detail.evidence.map(e=><details key={e.id}><summary>{e.locator}</summary><pre>{e.text}</pre></details>)}<p>{L('Current revision','当前修订')} {f.revision}</p>{detail.versions.map(v=><p key={v.revision}>{v.revision} · {v.content}</p>)}</div>}
  {error&&<p role="alert" className="memory-error">{L('Change not saved. Refresh and try again.','操作未完成，请刷新后重试。')}</p>}
 </article>;
}
function Methods({entry,L,changed}:{entry:Entry;L:Labels;changed:()=>void}){
 const [runOperation,setRunOperation]=useState('');
 const [running,setRunning]=useState<Method|null>(null),[inputs,setInputs]=useState<Record<string,string>>({}),[quote,setQuote]=useState(''),[receipt,setReceipt]=useState(false);
 const [draft,setDraft]=useState<SkillVersion|null>(null),[parameters,setParameters]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(false);
 const act=async(value:unknown)=>{setBusy(true);setError(false);try{return await request<SkillVersion>({entryId:entry.id,action:'skill',skill:value});}catch{setError(true);return null;}finally{setBusy(false);}};
 const open=async(goalId:string,method?:Method)=>{const latest=await act({action:'draft',goalId});if(!latest)return;try{const source=method?await request<SkillVersion>({entryId:entry.id,action:'skill-read',id:method.id,revision:method.version}):latest;setDraft({...source,version:latest.version});setParameters((source.parameters??[]).map(p=>p.name+' = '+p.label).join('\n'));}catch{setError(true);}};
 const unsaved=entry.goals.filter(g=>!entry.skills.some(s=>s.goalId===g.id));
 return <details className="memory-section"><summary>{L('Working methods','工作方法')} · {entry.skills.length}</summary>
  {unsaved.slice(0,10).map(g=><div className="memory-method" key={g.id}><span>{g.title}</span><button className="text-button" disabled={busy} onClick={()=>void open(g.id)}>{L('Save as method','保存为方法')}</button></div>)}
  {entry.skills.map(s=><div className="memory-method" key={s.id+':'+s.version}><div>{s.title} · v{s.version}<p>{s.state==='retired'?L('Retired','已停用'):s.state==='candidate'?L('Awaiting trial','待试用'):L('Available','可用')} · {L('Passed','验收通过')} {s.passed} · {L('Failed attempts','未通过')} {s.failed}</p></div><div className="memory-actions"><button className="text-button" disabled={busy} onClick={()=>void open(s.goalId,s)}>{L('Edit or restore','编辑或恢复此版')}</button><button className="text-button" disabled={busy} onClick={()=>void request<{file:string;text:string}>({entryId:entry.id,action:'skill-export',id:s.id,revision:s.version}).then(r=>download(r.file,r.text)).catch(()=>setError(true))}>{L('Export','导出')}</button>{s.state!=='retired'&&<button className="text-button" disabled={busy} onClick={()=>{setRunning(s);setRunOperation(crypto.randomUUID());setInputs({});setQuote(entry.request.text);setReceipt(false);}}>{L('Run / trial','运行 / 试用')}</button>}{s.state!=='retired'&&<button className="text-button" disabled={busy} onClick={()=>void act({action:'retire',skill:{id:s.id,version:s.version},scopeId:entry.scopeId,entryId:entry.id,expectedRevision:s.revision}).then(r=>{if(r)changed();})}>{L('Retire','停用')}</button>}</div></div>)}
  {running&&<form className="memory-edit" onSubmit={e=>{e.preventDefault();void act({action:'run',skill:{id:running.id,version:running.version},triggerId:entry.request.id,authorizationQuote:quote,inputs,operationId:runOperation}).then(r=>{if(r){setRunning(null);setReceipt(true);changed();}});}}><h3>{running.title}</h3><label>{L('Request from this conversation','本次任务的对话原文')}<textarea required value={quote} onChange={e=>setQuote(e.target.value)}/></label>{running.parameters.map(p=><label key={p.name}>{p.label}<input required maxLength={2000} value={inputs[p.name]??''} onChange={e=>setInputs({...inputs,[p.name]:e.target.value})}/></label>)}<div className="memory-actions"><button className="button primary" disabled={busy}>{L('Start actual task','启动实际任务')}</button><button className="text-button" type="button" onClick={()=>setRunning(null)}>{L('Cancel','取消')}</button></div></form>}
  {receipt&&<p role="status">{L('Task started. Follow its progress in Tasks.','任务已启动，可在任务页查看进展。')}</p>}
  {!entry.skills.length&&!unsaved.length&&<p>{L('Methods appear after a task passes acceptance.','任务通过验收后，可在这里保存工作方法。')}</p>}
  {draft&&<form className="memory-edit" onSubmit={e=>{e.preventDefault();const inputs=parameters.split('\n').filter(s=>s.trim()).map(s=>{const [name,...label]=s.split('=');return {name:name!.trim(),label:label.join('=').trim()||name!.trim()};});void act({action:'save',goalId:draft.goalId,expectedVersion:draft.version,template:draft.template,parameters:inputs}).then(r=>{if(r){setDraft(null);changed();}});}}>
   <label>{L('Method name','方法名称')}<input required value={draft.template.title} onChange={e=>setDraft({...draft,template:{...draft.template,title:e.target.value}})}/></label>
   <label>{L('Objective','目标')}<textarea required value={draft.template.objective} onChange={e=>setDraft({...draft,template:{...draft.template,objective:e.target.value}})}/></label>
   {draft.template.nodes.map((n,i)=><label key={n.id}>{n.title}<textarea required value={n.instruction} onChange={e=>setDraft({...draft,template:{...draft.template,nodes:draft.template.nodes.map((row,j)=>i===j?{...row,instruction:e.target.value}:row)}})}/></label>)}
   <details><summary>{L('Acceptance requirements','验收要求')}</summary>{draft.template.criteria.map((c,i)=><div className="memory-edit" key={c.id}>
    <label>{L('Acceptance criterion','验收条件')}<textarea required value={c.description} onChange={e=>setDraft({...draft,template:{...draft.template,criteria:draft.template.criteria.map((row,j)=>i===j?{...row,description:e.target.value}:row)}})}/></label>
    <label>{L('Evidence files, one per line','验收文件，每行一个')}<textarea value={c.files.join('\n')} onChange={e=>setDraft({...draft,template:{...draft.template,criteria:draft.template.criteria.map((row,j)=>i===j?{...row,files:e.target.value.split('\n').filter(Boolean)}:row)}})}/></label>
    {c.check&&<label>{L('Checked file path','检查的文件路径')}<input required value={c.check.path} onChange={e=>setDraft({...draft,template:{...draft.template,criteria:draft.template.criteria.map((row,j)=>i===j?{...row,check:row.check?{...row.check,path:e.target.value}:undefined}:row)}})}/></label>}
   </div>)}</details>
   <label>{L('Inputs: name = label, one per line','输入参数：每行填写 name = 名称')}<textarea value={parameters} placeholder="file = 文件路径" onChange={e=>setParameters(e.target.value)}/></label><p>{L('Use {{name}} in the objective or steps. Changed methods become available after a successful trial.','在目标或步骤中使用 {{name}}。修改后需通过一次实际任务验收。')}</p>
   <div className="memory-actions"><button className="button primary" disabled={busy}>{L('Save method','保存方法')}</button><button type="button" className="text-button" onClick={()=>setDraft(null)}>{L('Cancel','取消')}</button></div>
  </form>}
  {error&&<p className="memory-error" role="alert">{L('Method update failed. Check inputs or refresh.','方法操作未完成，请检查参数或刷新后重试。')}</p>}
 </details>;
}
function MemoryEntry({entry,L,changed}:{entry:Entry;L:Labels;changed:()=>void}){
 const [busy,setBusy]=useState(false),[error,setError]=useState(false);
 const [learning,setLearning]=useState(entry.policy.writeMode!=='explicit_only');
 useEffect(()=>setLearning(entry.policy.writeMode!=='explicit_only'),[entry.policy.writeMode]);
 const candidates=entry.items.filter(f=>f.state==='candidate'),active=entry.items.filter(f=>f.state==='active');
 const action=async(body:Record<string,unknown>)=>{setBusy(true);setError(false);try{const result=await request<{file:string;text:string}>({entryId:entry.id,...body});if(body.action==='export')download(result.file,result.text);else changed();return true;}catch{setError(true);return false;}finally{setBusy(false);}};
 return <section className="memory-entry" aria-label={entry.label}>
  <div className="memory-heading"><label className="memory-toggle"><input type="checkbox" checked={learning} disabled={busy||!entry.enabled} onChange={e=>{const enabled=e.target.checked;setLearning(enabled);void action({action:'learning',enabled,revision:entry.revision}).then(ok=>{if(!ok)setLearning(!enabled);});}}/>{L('Learn from interactions','从交流中学习')}</label></div>
  {active.length?active.map(f=><MemoryRow key={f.id+':'+f.revision} fact={f} entry={entry} L={L} changed={changed}/>):<p className="memory-empty">{L('No saved memories yet.','暂无已保存的记忆。')}</p>}
  <details className="memory-section"><summary>{L('Pending suggestions','待确认的记忆')} · {candidates.length}</summary>{candidates.map(f=><MemoryRow key={f.id+':'+f.revision} fact={f} entry={entry} L={L} changed={changed}/>)}</details>
  <details className="memory-section"><summary>{L('How we work together','我们的协作方式')}</summary>{entry.cooperation.length?entry.cooperation.map(f=><p key={f.id}>{f.content}{f.condition?' · '+f.condition:''}</p>):<p>{L('No established preferences or methods yet.','还没有形成稳定的偏好和工作方法。')}</p>}</details>
  <Methods entry={entry} L={L} changed={changed}/>
  <details className="memory-section"><summary>{L('Organize & export','整理与导出')}</summary><div className="memory-actions"><button className="text-button" disabled={busy} onClick={()=>void action({action:'consolidate'})}>{L('Organize memories','整理记忆')}</button>{['USER.md','MEMORY.md','AGENTS.md','ALIGNMENT_SYNTHESIS.md'].map(file=><button className="text-button" key={file} disabled={busy} onClick={()=>void action({action:'export',file})}>{file}</button>)}</div><label className="memory-import">{L('Import memory file','导入记忆文件')}<input type="file" accept=".md" disabled={busy} onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(!file)return;if(!['USER.md','MEMORY.md','AGENTS.md','ALIGNMENT_SYNTHESIS.md'].includes(file.name)||file.size>32000){setError(true);return;}void file.text().then(text=>action({action:'import',file:file.name,text,operationId:crypto.randomUUID()})).catch(()=>setError(true));}}/></label></details>
  {error&&<p role="alert" className="memory-error">{L('Operation failed. Refresh and try again.','操作未完成，请刷新后重试。')}</p>}
 </section>;
}
export function MemorySettings({L}:{L:Labels}){
 const [selected,setSelected]=useState('');
 const [entries,setEntries]=useState<Entry[]|null>(null),[error,setError]=useState(false),[revision,refresh]=useState(0);
 useEffect(()=>{const controller=new AbortController();setError(false);void request<{contexts:Entry[]}>(undefined,controller.signal).then(result=>setEntries(result.contexts)).catch(()=>{if(!controller.signal.aborted)setError(true);});return()=>controller.abort();},[revision]);
 const entry=entries?.find(e=>e.id===selected)??entries?.find(e=>e.conversationId&&e.items.length)??entries?.find(e=>e.items.length)??entries?.[0];
 return <section className="memory-settings" aria-label={L('Memory','记忆')}><div className="memory-heading"><h2>{L('Saved memories','已保存的记忆')}</h2><button className="text-button" onClick={()=>refresh(v=>v+1)}>{L('Refresh','刷新')}</button></div>
  {error?<p role="alert" className="memory-error">{L('Couldn’t load memories. Refresh to retry.','记忆读取失败，请刷新后重试。')}</p>:entries===null?<p role="status">{L('Loading…','加载中…')}</p>:entry?<><label className="memory-source">{L('Memory source','记忆来源')}<select aria-label={L('Memory source','记忆来源')} value={entry.id} onChange={e=>setSelected(e.target.value)}>{entries.map(e=><option key={e.id} value={e.id}>{(e.conversationId?L('Chat · ','对话 · '):L('Group · ','群聊 · '))+e.label.slice(0,60)}</option>)}</select></label><MemoryEntry key={entry.id} entry={entry} L={L} changed={()=>refresh(v=>v+1)}/></>:<p className="memory-empty">{L('No manageable memories yet.','暂无可管理的记忆。')}</p>}
 </section>;
}
