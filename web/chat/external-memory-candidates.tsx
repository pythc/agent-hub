import {useEffect,useRef,useState} from 'react';
import {request,type Entry,type Labels} from './memory-api.ts';

type Candidate={id:string;at:number;text:string;provenance:string;state:'unreviewed'};
export function ExternalMemoryCandidates({entries,L}:{entries:Entry[];L:Labels}){
 const [id,setId]=useState(''),[open,setOpen]=useState(false);
 const entry=entries.find(e=>e.id===id);
 return <details className="memory-file-hint" onToggle={e=>{setOpen(e.currentTarget.open);if(!e.currentTarget.open)setId('');}}>
  <summary>{L('Unreviewed outside notes','待审的外部笔记')}</summary>
  <p>{L('Pasted text stays here for you to review. Roppo cannot use it as memory, an instruction or a working method.','粘贴的文字仅供你在这里查看。Roppo 不会把它用作记忆、指令或工作方法。')}</p>
  <label>{L('Private conversation','私聊')} <select value={entry?.id??''} onChange={e=>setId(e.target.value)}>
   <option value="">{L('Choose a conversation','选择私聊')}</option>
   {entries.map(e=><option key={e.id} value={e.id}>{e.label}</option>)}
  </select></label>
  {open&&entry&&<CandidateList key={entry.id+':'+entry.conversationId} entry={entry} L={L}/>}
 </details>;
}
function CandidateList({entry,L}:{entry:Entry;L:Labels}){
 const [items,setItems]=useState<Candidate[]|null>(null),[source,setSource]=useState(''),[text,setText]=useState('');
 const [busy,setBusy]=useState(false),[error,setError]=useState(false),[notice,setNotice]=useState('');
 const flight=useRef<AbortController|null>(null),operation=useRef<string|null>(null);
 useEffect(()=>()=>{flight.current?.abort();flight.current=null;},[]);
 async function perform(body:Record<string,unknown>){
  if(flight.current)return;
  const controller=new AbortController();
  flight.current=controller;setBusy(true);setError(false);setNotice('');setItems(null);
  try{
   const result=await request<{items:Candidate[]}>({...body,entryId:entry.id},controller.signal);
   if(controller.signal.aborted)return;
   setItems(result.items);
   if(body.action==='external-stage'){
    operation.current=null;setSource('');setText('');
    setNotice(L('Staged for review.','已放入待审区。'));
   }
   if(body.action==='external-discard')setNotice(L('Discarded.','已丢弃。'));
  }catch{if(!controller.signal.aborted)setError(true);}
  finally{if(flight.current===controller){flight.current=null;setBusy(false);}}
 }
 return <div aria-busy={busy}>
  <p><button className="button" disabled={busy} onClick={()=>void perform({action:'external-list'})}>{L('Load unreviewed notes','查看待审笔记')}</button></p>
  {error&&<p className="memory-error" role="alert">{L('Could not complete this operation. Reload the list to check the current state.','操作未完成，请重新查看列表确认当前状态。')}</p>}
  {notice&&<p role="status">{notice}</p>}
  <form onSubmit={e=>{
   e.preventDefault();
   if(!entry.enabled||!source.trim()||!text.trim()||flight.current)return;
   operation.current??=crypto.randomUUID();
   void perform({action:'external-stage',provenance:source,text,operationId:operation.current});
  }}>
   <p><label>{L('Where it came from (label only)','来源说明（仅作标签）')} <input required maxLength={200} value={source} disabled={busy||!entry.enabled} onChange={e=>{operation.current=null;setSource(e.target.value);}}/></label></p>
   <p><label>{L('Paste plain text, up to 4,000 characters','粘贴纯文本，不超过 4000 字符')} <textarea required maxLength={4000} rows={5} value={text} disabled={busy||!entry.enabled} onChange={e=>{operation.current=null;setText(e.target.value);}}/></label></p>
   <button className="button" type="submit" disabled={busy||!entry.enabled||!source.trim()||!text.trim()}>{L('Stage for review','放入待审区')}</button>
  </form>
  {items?.length===0&&<p>{L('No unreviewed outside notes.','没有待审的外部笔记。')}</p>}
  {items?.length?<ul>{items.map(item=><li key={item.id}>
   <p>{L('Source (unverified):','来源（未核验）：')} <bdi>{item.provenance}</bdi> <time dateTime={new Date(item.at).toISOString()}>{new Date(item.at).toLocaleString()}</time></p>
   <p dir="auto" style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{item.text}</p>
   <button className="button" disabled={busy} onClick={()=>void perform({action:'external-discard',id:item.id})}>{L('Discard note','丢弃笔记')}</button>
  </li>)}</ul>:null}
 </div>;
}
