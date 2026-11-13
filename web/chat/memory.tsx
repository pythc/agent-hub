import {useEffect, useRef, useState} from 'react';
import {Pencil, Trash2} from 'lucide-react';
import type {MemoryProjection} from '../../src/router-memory.ts';
import './memory.css';

type Labels = (en:string,zh:string)=>string;
type Entry = {id:string;entryId:string};
type SavedMemory = {fact:MemoryProjection;entry:Entry};
async function request<T>(path:string,body?:unknown,signal?:AbortSignal):Promise<T>{
  const response=await fetch(path,{signal,...(body?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{})});
  if(!response.ok)throw Error('memory_request_failed');
  return response.json();
}
function MemoryRow({fact:f,entry,L,changed}:{fact:MemoryProjection;entry:Entry;L:Labels;changed:()=>void}){
  const [edit,setEdit]=useState<{content:string;revision:number}|null>(null),[deleting,setDeleting]=useState(false);
  const [busy,setBusy]=useState(false),[error,setError]=useState(false);
  const editButton=useRef<HTMLButtonElement>(null),deleteButton=useRef<HTMLButtonElement>(null);
  const cancel=(mode:'edit'|'delete')=>{
    setEdit(null);setDeleting(false);setError(false);
    requestAnimationFrame(()=>{(mode==='edit'?editButton:deleteButton).current?.focus();});
  };
  const mutate=async(value:Record<string,unknown>)=>{
    setBusy(true);setError(false);
    try{
      await request('/router-memory',{triggerId:entry.id,command:{operationId:crypto.randomUUID(),id:f.id,expectedRevision:f.revision,...value}});
      setEdit(null);setDeleting(false);changed();
    }catch{setError(true);}finally{setBusy(false);}
  };
  const context=[f.learning?.condition,f.learning?.inferred?L('Tentative','暂定'):undefined,f.learning?.discussion?L('One conversation only','仅对应会话'):undefined].filter(Boolean).join(' · ');
  return <article className="memory-note" data-memory-id={f.id}>
    {edit?<form className="memory-edit" onSubmit={e=>{e.preventDefault();void mutate({action:'remember',expectedRevision:edit.revision,subject:f.subject,content:edit.content,kind:f.kind,importance:f.importance,sourceIds:f.sources.map(s=>s.id),derivedFrom:f.dependencies?.map(d=>d.id),relation:f.relation,candidate:false,visibility:f.visibility,ticketId:f.ticketId,expiresAt:f.expiresAt,origin:'manual',topicAliases:f.topicAliases,learning:{inferred:false,condition:f.learning?.condition??'',...(f.learning?.discussion?{discussion:f.learning.discussion}:{})}});}}>
      <label>{L('Memory content','记忆内容')}<textarea autoFocus value={edit.content} required maxLength={16000} onChange={e=>setEdit({...edit,content:e.target.value})}/></label>
      <div className="memory-actions"><button type="submit" className="button primary" disabled={busy}>{L('Save','保存')}</button><button type="button" className="text-button" onClick={()=>cancel('edit')} disabled={busy}>{L('Cancel','取消')}</button></div>
    </form>:<>
      <p className="memory-content">{f.content}</p>
      {context?<p className="memory-context">{context}</p>:null}
      {deleting?<div className="memory-delete"><span>{L('Delete this memory?','删除这条记忆？')}</span><div className="memory-actions"><button className="text-button" disabled={busy} onClick={()=>void mutate({action:'forget'})}>{L('Delete','删除')}</button><button className="text-button" disabled={busy} onClick={()=>cancel('delete')}>{L('Cancel','取消')}</button></div></div>:
        <div className="memory-actions"><button className="text-button" ref={editButton} disabled={busy} onClick={()=>{setEdit({content:f.content,revision:f.revision});setError(false);}}><Pencil size={14}/>{L('Edit','修改')}</button><button className="text-button" ref={deleteButton} disabled={busy} onClick={()=>{setDeleting(true);setError(false);}}><Trash2 size={14}/>{L('Delete','删除')}</button></div>}
    </>}
    {error?<p role="alert" className="memory-error">{L('Couldn’t save this change. Reopen Memory in Settings and try again.','操作未完成，请重新进入设置中的记忆后重试。')}</p>:null}
  </article>;
}
export function MemorySettings({L}:{L:Labels}){
  const [items,setItems]=useState<SavedMemory[]|null>(null),[error,setError]=useState(false),[revision,refresh]=useState(0);
  useEffect(()=>{
    const controller=new AbortController();setError(false);
    const load=async()=>{
      const catalog=await request<{contexts:Entry[]}>('/router-management/catalog',undefined,controller.signal);
      const seen=new Set<string>();
      const entries=[...catalog.contexts].reverse().filter(entry=>{if(seen.has(entry.entryId))return false;seen.add(entry.entryId);return true;});
      const groups=await Promise.all(entries.map(async entry=>{
        const inventory=await request<{items:MemoryProjection[]}>('/agent-memory',{triggerId:entry.id,command:{action:'inspect'}},controller.signal);
        return inventory.items.filter(f=>f.state==='active'&&f.access.mode==='origin').map(fact=>({fact,entry}));
      }));
      setItems(groups.flat());
    };
    void load().catch(()=>{if(!controller.signal.aborted){setItems(null);setError(true);}});
    return()=>controller.abort();
  },[revision]);
  return <section className="memory-settings" aria-label={L('Memory','记忆')}>
    <h2>{L('Saved memories','已保存的记忆')}</h2>
    {error?<p role="alert" className="memory-error">{L('Couldn’t load memories. Reopen this settings section to try again.','记忆读取失败，请重新进入此设置分区重试。')}</p>:
      items===null?<p role="status">{L('Loading…','加载中…')}</p>:
      items.length?<div className="memory-list">{items.map(({fact,entry})=><MemoryRow key={fact.id} fact={fact} entry={entry} L={L} changed={()=>refresh(v=>v+1)}/>)}</div>:
      <p className="memory-empty">{L('No saved memories yet.','暂无已保存的记忆。')}</p>}
  </section>;
}
