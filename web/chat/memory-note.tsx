import {memoryProvenance} from './memory-provenance.ts';
import {useEffect,useRef,useState} from 'react';
import {ArrowLeft,ChevronRight,Pencil,Trash2} from 'lucide-react';
import type {MemoryProjection} from '../../src/router-memory.ts';
import {request,type Entry,type Labels} from './memory-api.ts';
export type Note={fact:MemoryProjection;entry:Entry};
type Impact={notes:number;candidates:number;caches:number;summaries:number;skills:number;reminders:number};
type Detail={impact?:Impact;evidence:{id:string;text:string;locator:string}[];versions:MemoryProjection[]};
export function memoryTitle(f:MemoryProjection,L:Labels){return /^(Explicit memory |interest:)|\.md$/.test(f.subject)?f.content.split(/[。！？\n]/)[0]!.slice(0,28)||L('Memory','记忆'):f.subject;}
export function NoteDetail({note:{fact:f,entry},L,changed,editingChanged,back}:{note:Note;L:Labels;changed:()=>void;editingChanged:(v:boolean)=>void;back:()=>void}){
 const editButton=useRef<HTMLButtonElement>(null),deleteButton=useRef<HTMLButtonElement>(null);
 const [edit,setEdit]=useState<{content:string;condition:string}|null>(null),[deleting,setDeleting]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(false);
 const [loaded,setLoaded]=useState<{key:string;value:Detail}|null>(null),[sourceError,setSourceError]=useState(false),[sourceOpen,setSourceOpen]=useState(false);
 const detailKey=entry.id+':'+f.id+':'+f.revision;
 const detail=loaded?.key===detailKey?loaded.value:null;
 const inspector=useRef<AbortController|null>(null);
 const inspect=()=>{inspector.current?.abort();const controller=new AbortController();inspector.current=controller;setSourceError(false);void request<{detail:Detail}>({entryId:entry.id,action:'inspect',id:f.id},controller.signal).then(r=>{if(!controller.signal.aborted)setLoaded({key:detailKey,value:r.detail});}).catch(()=>{if(!controller.signal.aborted)setSourceError(true);});};
 useEffect(()=>{inspect();return()=>inspector.current?.abort();},[detailKey]);
 useEffect(()=>{editingChanged(edit!==null||deleting);return()=>editingChanged(false);},[edit!==null,deleting]);
 const provenance=memoryProvenance(f,L);
 const cancel=()=>{setError(false);const wasDelete=deleting;setEdit(null);setDeleting(false);requestAnimationFrame(()=>(wasDelete?deleteButton:editButton).current?.focus());};
 const mutate=async(action:string,extra:Record<string,unknown>={})=>{setBusy(true);setError(false);try{await request({entryId:entry.id,id:f.id,revision:f.revision,action,...extra});setEdit(null);setDeleting(false);changed();}catch{setError(true);}finally{setBusy(false);}};
 return <article className="memory-detail" data-memory-id={f.id}>
  <button className="memory-back" onClick={back} disabled={edit!==null||deleting}><ArrowLeft size={16}/>{L('Back to memories','返回记忆列表')}</button>
  <header><h3>{memoryTitle(f,L)}</h3>{!edit&&!deleting&&<div className="memory-actions"><button className="button" ref={editButton} onClick={()=>setEdit({content:f.content,condition:f.learning?.condition??''})}><Pencil size={15}/>{L('Edit','编辑')}</button><button className="memory-icon" ref={deleteButton} aria-label={L('Delete memory','删除记忆')} title={L('Delete','删除')} onClick={()=>setDeleting(true)}><Trash2 size={17}/></button></div>}</header>
  {edit?<form className="memory-edit" onSubmit={e=>{e.preventDefault();void mutate('edit',edit);}}><label>{L('Memory content','记忆内容')}<textarea required autoFocus maxLength={16000} rows={6} value={edit.content} onChange={e=>setEdit({...edit,content:e.target.value})}/></label><label>{L('When to use','适用情况')}<input maxLength={300} value={edit.condition} onChange={e=>setEdit({...edit,condition:e.target.value})}/></label><div className="memory-actions"><button className="button primary" disabled={busy}>{L('Save','保存')}</button><button className="button" type="button" disabled={busy} onClick={cancel}>{L('Cancel','取消')}</button></div></form>:<><p className="memory-content">{f.content}</p>{provenance.length>0&&<p className="memory-provenance">{provenance.map(detail=>detail.value).join(' · ')}</p>}{f.learning?.discussion&&<p className="memory-context">{L('One conversation only','仅对应会话')}</p>}{f.learning?.condition&&<p className="memory-condition">{L('Applies to: ','适用情况：')}{f.learning.condition}</p>}</>}
  {(edit||deleting)&&<section className="memory-source-detail" aria-label={L('Impact of changing this memory','变更影响')}>
   <h4>{L('What changes with this note','变更影响')}</h4>
   {detail?.impact?<ul>
    <li>{L('Dependent notes / proposals','依赖记忆 / 待确认候选')}：{detail.impact.notes} / {detail.impact.candidates}</li>
    <li>{L('Retrieval caches / working summaries','检索缓存 / 协作摘要')}：{detail.impact.caches} / {detail.impact.summaries}</li>
    <li>{L('Pinned methods / linked reminders','绑定工作方法 / 关联提醒')}：{detail.impact.skills} / {detail.impact.reminders}</li>
   </ul>:<p>{L('Impact counts are not available yet.','暂无法显示影响数量。')}</p>}
   <p>{L('Only current links in this entry are counted. Review affected methods or update their dependencies before running again. Already approved contracts and delivered messages are not edited by this change. External copies are not managed.','只统计此项目中目前可查的依赖。再次运行受影响的方法或提醒前，请重新检查并更新关联。此操作不会改写已批准的任务契约，也不会撤回已送达的消息；不管理第三方副本。')}</p>
  </section>}
  {deleting&&<div className="memory-delete" role="group" aria-label={L('Delete memory','删除记忆')}><p>{L('Delete this memory?','删除这条记忆？')}</p><div className="memory-actions"><button className="button primary" disabled={busy} onClick={()=>void mutate('forget')}>{L('Delete','删除')}</button><button className="button" disabled={busy} onClick={cancel}>{L('Cancel','取消')}</button></div></div>}
  {error&&<p role="alert" className="memory-error">{L('Could not save. Your edits are kept; refresh and try again.','操作未完成，已保留编辑内容；请刷新后重试。')}</p>}
  {!edit&&!deleting&&<section className="memory-source-detail"><h4>{L('Source','来源')}</h4>
   {f.learning?.quote&&<blockquote>{f.learning.quote}</blockquote>}
   {sourceError?<button className="text-button" onClick={inspect}>{L('Retry loading source','重新读取来源')}</button>:!detail?<p role="status">{L('Loading source…','正在读取来源…')}</p>:<>
    <button className="text-button memory-source-link" onClick={()=>setSourceOpen(v=>!v)}>{sourceOpen?L('Hide original','收起原文'):L('View original','查看原文')}<ChevronRight size={15}/></button>
    {sourceOpen&&<div className="memory-evidence">{detail.evidence.length?detail.evidence.map(e=><p key={e.id}>{e.text}</p>):<p>{L('The original is no longer available.','原文已不可用。')}</p>}</div>}
    <details className="memory-history"><summary>{L('Change history','修改记录')}<ChevronRight size={16}/></summary>{detail.versions.length?detail.versions.toSorted((a,b)=>b.revision-a.revision).map(v=><div key={v.revision}><strong>{L('Revision','修订')} {v.revision}</strong><p>{v.content}</p></div>):<p>{L('No changes yet.','暂无修改记录。')}</p>}</details>
   </>}
  </section>}
 </article>;
}
