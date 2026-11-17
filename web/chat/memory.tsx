import {useEffect,useId,useRef,useState} from 'react';
import {ArrowLeft,ChevronDown,ChevronRight,Download,FileText,MessageSquare,MoreHorizontal,Pencil,RefreshCw,Trash2,Upload,Users,UserRound} from 'lucide-react';
import type {MemoryProjection} from '../../src/router-memory.ts';
import {download,request,type Entry,type Labels} from './memory-api.ts';
import {MemoryFile,personaRequest,type PersonaFile,type PersonaFiles} from './memory-files.tsx';
import {Methods} from './memory-methods.tsx';
import {memoryProvenance} from './memory-provenance.ts';
import './memory.css';

type FileTab='MEMORY.md'|'USER.md'|PersonaFile;
const files:FileTab[]=['MEMORY.md','USER.md','SOUL.md','IDENTITY.md','AGENTS.md'];
type Note={fact:MemoryProjection;entry:Entry};
type Detail={evidence:{id:string;text:string;locator:string}[];versions:MemoryProjection[]};
function title(f:MemoryProjection,L:Labels){return /^(Explicit memory |interest:)|\.md$/.test(f.subject)?f.content.split(/[。！？\n]/)[0]!.slice(0,28)||L('Memory','记忆'):f.subject;}
function NoteDetail({note:{fact:f,entry},L,changed,editingChanged,back}:{note:Note;L:Labels;changed:()=>void;editingChanged:(v:boolean)=>void;back:()=>void}){
 const editButton=useRef<HTMLButtonElement>(null),deleteButton=useRef<HTMLButtonElement>(null);
 const [edit,setEdit]=useState<{content:string;condition:string}|null>(null),[deleting,setDeleting]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(false);
 const [detail,setDetail]=useState<Detail|null>(null),[sourceError,setSourceError]=useState(false),[sourceOpen,setSourceOpen]=useState(false);
 const inspect=()=>{setSourceError(false);void request<{detail:Detail}>({entryId:entry.id,action:'inspect',id:f.id}).then(r=>setDetail(r.detail)).catch(()=>setSourceError(true));};
 useEffect(()=>{inspect();},[f.id,f.revision,entry.id]);
 useEffect(()=>{editingChanged(edit!==null||deleting);return()=>editingChanged(false);},[edit!==null,deleting]);
 const provenance=memoryProvenance(f,L);
 const cancel=()=>{setError(false);const wasDelete=deleting;setEdit(null);setDeleting(false);requestAnimationFrame(()=>(wasDelete?deleteButton:editButton).current?.focus());};
 const mutate=async(action:string,extra:Record<string,unknown>={})=>{setBusy(true);setError(false);try{await request({entryId:entry.id,id:f.id,revision:f.revision,action,...extra});setEdit(null);setDeleting(false);changed();}catch{setError(true);}finally{setBusy(false);}};
 return <article className="memory-detail" data-memory-id={f.id}>
  <button className="memory-back" onClick={back} disabled={edit!==null||deleting}><ArrowLeft size={16}/>{L('Back to memories','返回记忆列表')}</button>
  <header><h3>{title(f,L)}</h3>{!edit&&!deleting&&<div className="memory-actions"><button className="button" ref={editButton} onClick={()=>setEdit({content:f.content,condition:f.learning?.condition??''})}><Pencil size={15}/>{L('Edit','编辑')}</button><button className="memory-icon" ref={deleteButton} aria-label={L('Delete memory','删除记忆')} title={L('Delete','删除')} onClick={()=>setDeleting(true)}><Trash2 size={17}/></button></div>}</header>
  {edit?<form className="memory-edit" onSubmit={e=>{e.preventDefault();void mutate('edit',edit);}}><label>{L('Memory content','记忆内容')}<textarea required autoFocus maxLength={16000} rows={6} value={edit.content} onChange={e=>setEdit({...edit,content:e.target.value})}/></label><label>{L('When to use','适用情况')}<input maxLength={300} value={edit.condition} onChange={e=>setEdit({...edit,condition:e.target.value})}/></label><div className="memory-actions"><button className="button primary" disabled={busy}>{L('Save','保存')}</button><button className="button" type="button" disabled={busy} onClick={cancel}>{L('Cancel','取消')}</button></div></form>:<><p className="memory-content">{f.content}</p>{provenance.length>0&&<p className="memory-provenance">{provenance.map(detail=>detail.value).join(' · ')}</p>}{f.learning?.discussion&&<p className="memory-context">{L('One conversation only','仅对应会话')}</p>}{f.learning?.condition&&<p className="memory-condition">{L('Applies to: ','适用情况：')}{f.learning.condition}</p>}</>}
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
export function MemorySettings({L}:{L:Labels}){
 const id=useId(),[file,setFile]=useState<FileTab>('MEMORY.md'),[scope,setScope]=useState('personal'),[entries,setEntries]=useState<Entry[]|null>(null),[persona,setPersona]=useState<PersonaFiles|null>(null);
 const [selected,setSelected]=useState(''),[mobileDetail,setMobileDetail]=useState(false),[editing,setEditing]=useState(false),[revision,refresh]=useState(0),[error,setError]=useState(''),[busy,setBusy]=useState(false),[pendingLearning,setPendingLearning]=useState<boolean|null>(null),[methods,setMethods]=useState(false),[methodEntry,setMethodEntry]=useState('');
 const menu=useRef<HTMLDetailsElement>(null),importInput=useRef<HTMLInputElement>(null),methodsDialog=useRef<HTMLDialogElement>(null),menuButton=useRef<HTMLElement|null>(null);
 const personal=file==='MEMORY.md'||file==='USER.md',groups=entries?.filter(e=>!e.conversationId)??[],all=entries??[];
 const actualScope=scope!=='personal'&&!groups.some(e=>e.id===scope)?'personal':scope;
 const visible=all.filter(e=>actualScope==='personal'?!!e.conversationId:e.id===actualScope);
 const notes:Note[]=[...new Map(visible.flatMap(entry=>entry.items.filter(f=>['active','candidate'].includes(f.state)&&f.proposalAction!=='forget'&&(file!=='USER.md'||['profile','preference','interest'].includes(f.kind??''))).map(fact=>[fact.id,{fact,entry}] as const))).values()].sort((a,b)=>b.fact.createdAt-a.fact.createdAt);
 const current=notes.find(n=>n.fact.id===selected)??notes[0];
 const learning=visible.length>0&&visible.every(e=>e.policy.writeMode!=='explicit_only');
 useEffect(()=>{let disposed=false;setError('');void Promise.all([request<{contexts:Entry[]}>({action:'refresh'}),personaRequest()]).then(([m,p])=>{if(!disposed){setEntries(m.contexts);setPersona(p);}}).catch(()=>{if(!disposed)setError(L('Could not load. Try refreshing.','读取失败，请刷新重试。'));});return()=>{disposed=true;};},[revision]);
 useEffect(()=>{if(methods)methodsDialog.current?.showModal();else methodsDialog.current?.close();},[methods]);
 useEffect(()=>{const close=(event:PointerEvent)=>{if(menu.current&&!menu.current.contains(event.target as Node))menu.current.open=false;};document.addEventListener('pointerdown',close);return()=>document.removeEventListener('pointerdown',close);},[]);
 const closeMenu=()=>{if(menu.current)menu.current.open=false;};
 const run=async(work:()=>Promise<unknown>,reload=true)=>{setBusy(true);setError('');closeMenu();try{await work();if(reload)refresh(v=>v+1);}catch{setError(L('Could not complete the operation. Please try again.','操作未完成，请重试。'));}finally{setBusy(false);}};
 const changeLearning=async()=>{const enabled=!learning;setBusy(true);setPendingLearning(enabled);setError('');try{const scopes=[...new Map(visible.map(e=>[e.scopeId,e])).values()];for(const e of scopes)await request({entryId:e.id,action:'learning',enabled,revision:e.revision});setEntries((await request<{contexts:Entry[]}>({action:'refresh'})).contexts);}catch{setError(L('Could not change learning. Try refreshing.','学习设置未能保存，请刷新重试。'));}finally{setPendingLearning(null);setBusy(false);}};
 const exportFile=()=>void run(async()=>{if(!personal){if(persona)download(file,persona.files[file]);return;}const text=await Promise.all(visible.map(e=>request<{text:string}>({entryId:e.id,action:'export',file})));download(file,text.map(t=>t.text).join('\n\n'));},false);
 const chooseFile=(next:FileTab)=>{setFile(next);setMobileDetail(false);setSelected('');};
 const activeMethod=visible.find(e=>e.id===methodEntry)??visible[0];
 const noteHint=personal?L('These files shape Roppo’s memory. Usually, you won’t need to change them.','这些文件影响 Roppo 的记忆，通常无需修改。'):L('These are Router personality and behavior settings. Usually, you won’t need to change them.','这些是 Router 的人格与行为设置，通常无需修改。');
 return <section className="memory-settings" aria-label={L('Memory','记忆')}>
  <div className="memory-heading"><h2>{L('Memory','记忆')}</h2><details ref={menu} className="memory-menu" onKeyDown={e=>{if(e.key==='Escape'){closeMenu();menu.current?.querySelector('summary')?.focus();}}}><summary aria-label={L('More memory actions','更多记忆操作')}><MoreHorizontal size={17}/>{L('More','更多')}<ChevronDown size={14}/></summary><div className="memory-menu-items">
   <button disabled={editing||busy} onClick={()=>{closeMenu();refresh(v=>v+1);}}><RefreshCw size={16}/>{L('Refresh','刷新')}</button>
   <button disabled={busy||!persona||personal&&!visible.length} onClick={exportFile}><Download size={16}/>{L('Export current file','导出当前文件')}</button>
   <button disabled={busy||editing||personal&&!visible.length} onClick={()=>{closeMenu();importInput.current?.click();}}><Upload size={16}/>{L('Import file','导入文件')}</button>
   {personal&&<><button disabled={busy||editing||!visible.length} onClick={()=>void run(async()=>{for(const e of visible)await request({entryId:e.id,action:'consolidate'});})}><FileText size={16}/>{L('Organize memories','整理记忆')}</button><button disabled={!visible.length} onClick={e=>{menuButton.current=e.currentTarget;closeMenu();setMethods(true);}}><FileText size={16}/>{L('Working methods','工作方法')}</button></>}
  </div></details></div>
  <div className="memory-toolbar">
   {personal?<><div className="memory-scope"><UserRound size={17}/>{groups.length?<select aria-label={L('Memory scope','记忆范围')} disabled={editing||busy} value={actualScope} onChange={e=>{setScope(e.target.value);setSelected('');setMobileDetail(false);}}><option value="personal">{L('My memories','我的记忆')}</option><optgroup label={L('Group memories','群聊记忆')}>{groups.map(e=><option key={e.id} value={e.id}>{e.label}</option>)}</optgroup></select>:<span>{L('My memories','我的记忆')}</span>}</div><label className="memory-toggle"><span>{L('Learn from interactions','从交流中学习')}</span><input role="switch" type="checkbox" checked={pendingLearning??learning} disabled={busy||!visible.length||visible.some(e=>!e.enabled)} onChange={()=>void changeLearning()}/></label></>:<div className="memory-scope"><Users size={17}/><span>Router</span></div>}
  </div>
  <div className="memory-file-tabs" role="tablist" aria-label={L('Memory and personality files','记忆与人格文件')} onKeyDown={e=>{if(!['ArrowRight','ArrowLeft','Home','End'].includes(e.key)||editing)return;e.preventDefault();const i=files.indexOf(file),next=e.key==='Home'?0:e.key==='End'?files.length-1:(i+(e.key==='ArrowRight'?1:-1)+files.length)%files.length;chooseFile(files[next]!);document.getElementById(id+'-'+files[next])?.focus();}}>{files.map(name=><button id={id+'-'+name} key={name} role="tab" aria-selected={file===name} aria-controls={id+'-panel'} tabIndex={file===name?0:-1} disabled={editing} onClick={()=>chooseFile(name)}>{name}</button>)}</div>
  <p className="memory-file-hint">{noteHint}</p>
  {error&&<p className="memory-error" role="alert">{error}<button className="text-button" onClick={()=>refresh(v=>v+1)}>{L('Refresh','刷新')}</button></p>}
  <div id={id+'-panel'} role="tabpanel" aria-labelledby={id+'-'+file}>
   {entries===null||!persona?<p className="memory-empty" role="status">{error?L('Memory is unavailable.','记忆暂不可用。'):L('Loading…','加载中…')}</p>:personal?notes.length&&current?<div className="memory-reader" data-detail={mobileDetail}>
    <nav className="memory-list" aria-label={L('Memories','记忆列表')}>{notes.map(note=><button key={note.fact.id} aria-current={note.fact.id===current.fact.id?'true':undefined} disabled={editing} onClick={()=>{setSelected(note.fact.id);setMobileDetail(true);}}><MessageSquare size={19}/><span><strong>{title(note.fact,L)}</strong><span>{note.fact.content}</span></span></button>)}</nav>
    <NoteDetail key={current.fact.id+':'+current.fact.revision} note={current} L={L} changed={()=>refresh(v=>v+1)} editingChanged={setEditing} back={()=>setMobileDetail(false)}/>
   </div>:<div className="memory-empty"><MessageSquare size={24}/><h3>{L('No memories yet','还没有记忆')}</h3><p>{file==='USER.md'?L('Preferences and information about you appear here.','关于你的偏好与习惯会显示在这里。'):L('What Roppo learns from your conversations appears here.','交流中记住的内容会显示在这里。')}</p></div>:<MemoryFile key={file} file={file} data={persona} L={L} saved={setPersona} editingChanged={setEditing}/>}
  </div>
  <input ref={importInput} type="file" accept=".md" hidden onChange={e=>{const upload=e.target.files?.[0];e.target.value='';if(!upload)return;if(upload.size>64000||!files.includes(upload.name as FileTab)){setError(L('Choose one of the Markdown files shown above.','请选择上方页签对应的 Markdown 文件。'));return;}void run(async()=>{const text=await upload.text();if(upload.name==='MEMORY.md'||upload.name==='USER.md'){const entry=visible[0];if(!entry)throw Error('No memory context');await request({entryId:entry.id,action:'import',file:upload.name,text,operationId:crypto.randomUUID()});}else{if(!persona)throw Error('No settings');setPersona(await personaRequest({agentId:'router',file:upload.name,text,revision:persona.revision}));}});}}/>
  <dialog ref={methodsDialog} className="memory-method-dialog" onCancel={()=>setMethods(false)} onClose={()=>{setMethods(false);menu.current?.querySelector('summary')?.focus();}}><header><h3>{L('Working methods','工作方法')}</h3><button className="button" onClick={()=>setMethods(false)}>{L('Close','关闭')}</button></header>{visible.length>1&&<label>{L('Conversation','对话')}<select value={activeMethod?.id} onChange={e=>setMethodEntry(e.target.value)}>{visible.map(e=><option key={e.id} value={e.id}>{e.label}</option>)}</select></label>}{activeMethod&&<Methods key={activeMethod.id} entry={activeMethod} L={L} changed={()=>refresh(v=>v+1)}/>}</dialog>
 </section>;
}
