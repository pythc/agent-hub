import {memoryProvenance} from './memory-provenance.ts';
import {useEffect,useRef,useState} from 'react';
import {ArrowLeft,ChevronRight,Pencil,Trash2} from 'lucide-react';
import type {MemoryProjection} from '../../src/router-memory.ts';
import {request,type Entry,type Labels} from './memory-api.ts';
export type Note={fact:MemoryProjection;entry:Entry};
type Detail={evidence:{id:string;text:string;locator:string}[];versions:MemoryProjection[]};
export function memoryTitle(f:MemoryProjection,L:Labels){return /^(Explicit memory |interest:)|\.md$/.test(f.subject)?f.content.split(/[。！？\n]/)[0]!.slice(0,28)||L('Memory','记忆'):f.subject;}
export function NoteDetail({note:{fact:f,entry},L,changed,editingChanged,back}:{note:Note;L:Labels;changed:()=>void;editingChanged:(v:boolean)=>void;back:()=>void}){
 const editButton=useRef<HTMLButtonElement>(null),deleteButton=useRef<HTMLButtonElement>(null);
 const [edit,setEdit]=useState<{content:string;condition:string}|null>(null),[deleting,setDeleting]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(false);
 const revokeButton=useRef<HTMLButtonElement>(null),addButton=useRef<HTMLButtonElement>(null);
 const [exception,setException]=useState<{content:string;until:string;phrase:string;operationId:string}|null>(null),[revoking,setRevoking]=useState(false);
 const isException=f.kind==='preference'&&(f.expiresAt!==undefined||!!f.learning?.discussion||!!f.learning?.condition?.trim());
 const canManagePreference=!!entry.canManageExceptions&&f.kind==='preference'&&f.state==='active';
 const decision=entry.preferenceDecisions?.[f.id];
 const decisionLabel=decision&&{
  applied:L('Applies in the latest request','适用于最近一条请求'),
  condition_unmatched:L('Conditions not confirmed for the latest request','最近一条请求未满足适用条件'),
  explicit_preferred:L('A stated preference takes precedence','明确表达的偏好优先'),
  equivalent:L('An identical matching preference is already applied','已应用另一条内容相同的偏好'),
  narrower_preferred:L('A more specific matching preference takes precedence','更具体且适用的偏好优先'),
  ambiguous:L('Conflicting preferences have equal priority; neither is applied','同优先级偏好冲突，均不自动使用'),
 }[decision];
 const [detail,setDetail]=useState<Detail|null>(null),[sourceError,setSourceError]=useState(false),[sourceOpen,setSourceOpen]=useState(false);
 const inspect=()=>{setSourceError(false);void request<{detail:Detail}>({entryId:entry.id,action:'inspect',id:f.id}).then(r=>setDetail(r.detail)).catch(()=>setSourceError(true));};
 useEffect(()=>{inspect();},[f.id,f.revision,entry.id]);
 useEffect(()=>{editingChanged(edit!==null||deleting||exception!==null||revoking);return()=>editingChanged(false);},[edit!==null,deleting,exception!==null,revoking]);
 const provenance=memoryProvenance(f,L);
 const cancel=()=>{setError(false);const trigger=revoking?revokeButton:exception?addButton:deleting?deleteButton:editButton;setEdit(null);setDeleting(false);setException(null);setRevoking(false);requestAnimationFrame(()=>trigger.current?.focus());};
 const mutate=async(action:string,extra:Record<string,unknown>={})=>{setBusy(true);setError(false);try{await request({entryId:entry.id,id:f.id,revision:f.revision,action,...extra});setEdit(null);setDeleting(false);setException(null);setRevoking(false);changed();}catch{setError(true);}finally{setBusy(false);}};
 return <article className="memory-detail" data-memory-id={f.id}>
  <button className="memory-back" onClick={back} disabled={edit!==null||deleting||exception!==null||revoking}><ArrowLeft size={16}/>{L('Back to memories','返回记忆列表')}</button>
  <header><h3>{memoryTitle(f,L)}</h3>{!edit&&!deleting&&!exception&&!revoking&&<div className="memory-actions">{canManagePreference&&(isException?<button className="button" ref={revokeButton} onClick={()=>setRevoking(true)}>{L('Revoke exception','撤销例外')}</button>:<button className="button" ref={addButton} onClick={()=>setException({content:f.content,until:'',phrase:'',operationId:crypto.randomUUID()})}>{L('Add temporary exception','添加临时例外')}</button>)}<button className="button" ref={editButton} onClick={()=>setEdit({content:f.content,condition:f.learning?.condition??''})}><Pencil size={15}/>{L('Edit','编辑')}</button><button className="memory-icon" ref={deleteButton} aria-label={L('Delete memory','删除记忆')} title={L('Delete','删除')} onClick={()=>setDeleting(true)}><Trash2 size={17}/></button></div>}</header>
  {edit?<form className="memory-edit" onSubmit={e=>{e.preventDefault();void mutate('edit',edit);}}><label>{L('Memory content','记忆内容')}<textarea required autoFocus maxLength={16000} rows={6} value={edit.content} onChange={e=>setEdit({...edit,content:e.target.value})}/></label><label>{L('When to use','适用情况')}<input maxLength={300} value={edit.condition} onChange={e=>setEdit({...edit,condition:e.target.value})}/></label><div className="memory-actions"><button className="button primary" disabled={busy}>{L('Save','保存')}</button><button className="button" type="button" disabled={busy} onClick={cancel}>{L('Cancel','取消')}</button></div></form>:<><p className="memory-content">{f.content}</p>{provenance.length>0&&<p className="memory-provenance">{provenance.map(detail=>detail.value).join(' · ')}</p>}{f.learning?.discussion&&<p className="memory-context">{L('One conversation only','仅对应会话')}</p>}{f.learning?.condition&&<p className="memory-condition">{L('Applies to: ','适用情况：')}{f.learning.condition}</p>}</>}
  {!edit&&decisionLabel&&<p className="memory-context">{decisionLabel}</p>}
  {!edit&&f.expiresAt!==undefined&&<p className="memory-context">{L('Expires: ','到期时间：')}{new Date(f.expiresAt).toLocaleString()}</p>}
  {exception&&<form className="memory-edit" onSubmit={e=>{
   e.preventDefault();const expiresAt=new Date(exception.until).getTime();
   if(!Number.isFinite(expiresAt)||expiresAt<=Date.now()){setError(true);return;}
   void mutate('exception.add',{content:exception.content,expiresAt,operationId:exception.operationId,...(exception.phrase.trim()?{matchPhrase:exception.phrase}: {})});
  }}>
   <label>{L('Temporary preference','临时偏好')}<textarea autoFocus required maxLength={16000} rows={4} value={exception.content} onChange={e=>setException({...exception,content:e.target.value})}/></label>
   <label>{L('Expires at (local time)','到期时间（本地时间）')}<input type="datetime-local" required value={exception.until} onChange={e=>setException({...exception,until:e.target.value})}/></label>
   <label>{L('Only when the request contains this exact phrase (optional)','仅当请求含此固定短语时适用（可选）')}<input maxLength={200} value={exception.phrase} onChange={e=>setException({...exception,phrase:e.target.value})}/></label>
   <div className="memory-actions"><button className="button primary" disabled={busy}>{L('Save exception','保存例外')}</button><button className="button" type="button" disabled={busy} onClick={cancel}>{L('Cancel','取消')}</button></div>
  </form>}
  {revoking&&<div className="memory-delete" role="group" aria-label={L('Revoke exception','撤销例外')}><p>{L('Stop using this exception? The standing preference is kept.','停止使用这条例外？长期偏好会保留。')}</p><div className="memory-actions"><button className="button primary" disabled={busy} autoFocus onClick={()=>void mutate('exception.revoke')}>{L('Revoke','撤销')}</button><button className="button" disabled={busy} onClick={cancel}>{L('Cancel','取消')}</button></div></div>}
  {deleting&&<div className="memory-delete" role="group" aria-label={L('Delete memory','删除记忆')}><p>{L('Delete this memory?','删除这条记忆？')}</p><div className="memory-actions"><button className="button primary" disabled={busy} onClick={()=>void mutate('forget')}>{L('Delete','删除')}</button><button className="button" disabled={busy} onClick={cancel}>{L('Cancel','取消')}</button></div></div>}
  {error&&<p role="alert" className="memory-error">{L('Could not save. Your edits are kept; refresh and try again.','操作未完成，已保留编辑内容；请刷新后重试。')}</p>}
  {!edit&&!deleting&&!exception&&!revoking&&<section className="memory-source-detail"><h4>{L('Source','来源')}</h4>
   {f.learning?.quote&&<blockquote>{f.learning.quote}</blockquote>}
   {sourceError?<button className="text-button" onClick={inspect}>{L('Retry loading source','重新读取来源')}</button>:!detail?<p role="status">{L('Loading source…','正在读取来源…')}</p>:<>
    <button className="text-button memory-source-link" onClick={()=>setSourceOpen(v=>!v)}>{sourceOpen?L('Hide original','收起原文'):L('View original','查看原文')}<ChevronRight size={15}/></button>
    {sourceOpen&&<div className="memory-evidence">{detail.evidence.length?detail.evidence.map(e=><p key={e.id}>{e.text}</p>):<p>{L('The original is no longer available.','原文已不可用。')}</p>}</div>}
    <details className="memory-history"><summary>{L('Change history','修改记录')}<ChevronRight size={16}/></summary>{detail.versions.length?detail.versions.toSorted((a,b)=>b.revision-a.revision).map(v=><div key={v.revision}><strong>{L('Revision','修订')} {v.revision}</strong><p>{v.content}</p></div>):<p>{L('No changes yet.','暂无修改记录。')}</p>}</details>
   </>}
  </section>}
 </article>;
}
