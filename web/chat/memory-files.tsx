import {useEffect,useRef,useState} from 'react';
import {FileText,Pencil,ArrowLeft} from 'lucide-react';
import type {Labels} from './memory-api.ts';
import {NoteDetail,memoryTitle,type Note} from './memory-note.tsx';
export type PersonaFile='SOUL.md'|'IDENTITY.md'|'AGENTS.md';
export type PersonaFiles={revision:number;files:Record<PersonaFile,string>};
export async function personaRequest(body?:unknown):Promise<PersonaFiles>{
 const r=await fetch('/agent-persona',{...(body?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{})});
 if(!r.ok)throw Error(r.status===409?'conflict':'failed');return r.json();
}
function sections(text:string,fallback:string){
 const body=text.replace(/^# [^\n]*\n/,'').trim();
 const parts=body.split(/\n(?=## )/).filter(Boolean);
 return (parts.length?parts:['']).map((part,i)=>{const match=part.match(/^## ([^\n]+)\n?/);return {id:String(i),title:match?.[1]??fallback,content:match?part.slice(match[0].length).trim():part};});
}
export function MemoryFile({file,data,L,saved,editingChanged,learned=[],notesChanged}:{file:PersonaFile;data:PersonaFiles;L:Labels;saved:(data:PersonaFiles)=>void;editingChanged:(v:boolean)=>void;learned?:Note[];notesChanged:()=>void}){
 const title=file==='SOUL.md'?L('Personality','性格与表达'):file==='IDENTITY.md'?L('Identity','身份'):L('Working conventions','工作约定');
 const items=sections(data.files[file],title),[selected,setSelected]=useState('0'),[mobileDetail,setMobileDetail]=useState(false);
 const [draft,setDraft]=useState<string|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [noteEditing,setNoteEditing]=useState(false);
 const note=learned.find(n=>'note:'+n.fact.id===selected);
 const edit=useRef<HTMLButtonElement>(null),item=items.find(s=>s.id===selected)??items[0]!;
 useEffect(()=>{setSelected('0');setDraft(null);setError('');},[file]);
 useEffect(()=>{editingChanged(draft!==null||noteEditing);return()=>editingChanged(false);},[draft!==null,noteEditing]);
 const cancel=()=>{setDraft(null);setError('');requestAnimationFrame(()=>edit.current?.focus());};
 return <div className="memory-reader" data-detail={mobileDetail||draft!==null}>
  <nav className="memory-list" aria-label={L('File sections','文件段落')}>
   {items.map(part=><button key={part.id} aria-current={!note&&part.id===item.id?'true':undefined} disabled={draft!==null||noteEditing} onClick={()=>{setSelected(part.id);setMobileDetail(true);}}><FileText size={19}/><span><strong>{part.title}</strong><span>{part.content.slice(0,70)||L('No custom instructions','尚未设置自定义内容')}</span></span></button>)}
   {learned.length>0&&<h4 className="memory-learned-heading">{L('Learned conventions','学到的工作约定')}</h4>}
   {learned.map(n=><button key={n.fact.id} aria-current={note?.fact.id===n.fact.id?'true':undefined} disabled={draft!==null||noteEditing} onClick={()=>{setSelected('note:'+n.fact.id);setMobileDetail(true);}}><FileText size={19}/><span><strong>{memoryTitle(n.fact,L)}</strong><span>{n.fact.content}</span></span></button>)}
  </nav>
  {note?<NoteDetail key={note.fact.id+':'+note.fact.revision} note={note} L={L} changed={notesChanged} editingChanged={setNoteEditing} back={()=>setMobileDetail(false)}/>:<article className="memory-detail">
   <button className="memory-back" onClick={()=>setMobileDetail(false)} disabled={draft!==null}><ArrowLeft size={16}/>{L('Back','返回')}</button>
   <header><h3>{item.title}</h3>{draft===null&&<button ref={edit} className="button" onClick={()=>setDraft(data.files[file])}><Pencil size={15}/>{L('Edit','编辑')}</button>}</header>
   {draft===null?<div className="memory-file-text">{item.content||L('No custom instructions yet.','尚未设置自定义内容。')}</div>:<form className="memory-edit" onSubmit={e=>{e.preventDefault();setBusy(true);setError('');void personaRequest({agentId:'router',file,text:draft,revision:data.revision}).then(next=>{saved(next);setDraft(null);}).catch(e=>setError(e.message==='conflict'?L('Settings changed elsewhere. Keep your edits and reload before saving.','设置已在别处更新。请保留当前内容，刷新后再保存。'):L('Could not save. Your edits are kept.','未能保存，已保留当前编辑内容。'))).finally(()=>setBusy(false));}}>
    <label>{file}<textarea autoFocus rows={14} maxLength={file==='SOUL.md'?4200:file==='IDENTITY.md'?2200:64000} value={draft} onChange={e=>setDraft(e.target.value)}/></label>
    <div className="memory-actions"><button className="button primary" disabled={busy}>{busy?L('Saving…','保存中…'):L('Save','保存')}</button><button type="button" className="button" disabled={busy} onClick={cancel}>{L('Cancel','取消')}</button></div>
   </form>}
   {error&&<p role="alert" className="memory-error">{error}</p>}
  </article>}
 </div>;
}
