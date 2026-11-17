import {useEffect,useId,useRef,useState} from 'react';
import {ChevronDown,Download,FileText,MessageSquare,MoreHorizontal,RefreshCw,Upload,Users,UserRound} from 'lucide-react';
import {NoteDetail,memoryTitle,type Note} from './memory-note.tsx';
import {download,request,type Entry,type Labels} from './memory-api.ts';
import {MemoryFile,personaRequest,type PersonaFile,type PersonaFiles} from './memory-files.tsx';
import {Methods} from './memory-methods.tsx';
import './memory.css';

type FileTab='MEMORY.md'|'USER.md'|PersonaFile;
const files:FileTab[]=['MEMORY.md','USER.md','SOUL.md','IDENTITY.md','AGENTS.md'];
export function MemorySettings({L}:{L:Labels}){
 const id=useId(),[file,setFile]=useState<FileTab>('MEMORY.md'),[scope,setScope]=useState('personal'),[entries,setEntries]=useState<Entry[]|null>(null),[persona,setPersona]=useState<PersonaFiles|null>(null);
 const [selected,setSelected]=useState(''),[mobileDetail,setMobileDetail]=useState(false),[editing,setEditing]=useState(false),[revision,refresh]=useState(0),[error,setError]=useState(''),[busy,setBusy]=useState(false),[pendingLearning,setPendingLearning]=useState<boolean|null>(null),[methods,setMethods]=useState(false),[methodEntry,setMethodEntry]=useState('');
 const menu=useRef<HTMLDetailsElement>(null),importInput=useRef<HTMLInputElement>(null),methodsDialog=useRef<HTMLDialogElement>(null),menuButton=useRef<HTMLElement|null>(null);
 const personal=file==='MEMORY.md'||file==='USER.md',scopedFile=personal||file==='AGENTS.md',groups=entries?.filter(e=>!e.conversationId)??[],all=entries??[];
 const actualScope=scope!=='personal'&&!groups.some(e=>e.id===scope)?'personal':scope;
 const visible=all.filter(e=>actualScope==='personal'?!!e.conversationId:e.id===actualScope);
 const notes:Note[]=[...new Map(visible.flatMap(entry=>entry.items.filter(f=>['active','candidate'].includes(f.state)&&f.proposalAction!=='forget'&&(file!=='USER.md'||['profile','preference','interest'].includes(f.kind??''))).map(fact=>[fact.id,{fact,entry}] as const))).values()].sort((a,b)=>b.fact.createdAt-a.fact.createdAt);
 const learned:Note[]=visible.flatMap(entry=>entry.items.filter(f=>f.state==='active'&&f.origin==='experience').map(fact=>({fact,entry})));
 const current=notes.find(n=>n.fact.id===selected)??notes[0];
 const learning=visible.length>0&&visible.every(e=>e.policy.writeMode!=='explicit_only');
 useEffect(()=>{let disposed=false;setError('');void Promise.all([request<{contexts:Entry[]}>({action:'refresh'}),personaRequest()]).then(([m,p])=>{if(!disposed){setEntries(m.contexts);setPersona(p);}}).catch(()=>{if(!disposed)setError(L('Could not load. Try refreshing.','读取失败，请刷新重试。'));});return()=>{disposed=true;};},[revision]);
 useEffect(()=>{if(methods)methodsDialog.current?.showModal();else methodsDialog.current?.close();},[methods]);
 useEffect(()=>{const close=(event:PointerEvent)=>{if(menu.current&&!menu.current.contains(event.target as Node))menu.current.open=false;};document.addEventListener('pointerdown',close);return()=>document.removeEventListener('pointerdown',close);},[]);
 const closeMenu=()=>{if(menu.current)menu.current.open=false;};
 const run=async(work:()=>Promise<unknown>,reload=true)=>{setBusy(true);setError('');closeMenu();try{await work();if(reload)refresh(v=>v+1);}catch{setError(L('Could not complete the operation. Please try again.','操作未完成，请重试。'));}finally{setBusy(false);}};
 const changeLearning=async()=>{const enabled=!learning;setBusy(true);setPendingLearning(enabled);setError('');try{const scopes=[...new Map(visible.map(e=>[e.scopeId,e])).values()];for(const e of scopes)await request({entryId:e.id,action:'learning',enabled,revision:e.revision});setEntries((await request<{contexts:Entry[]}>({action:'refresh'})).contexts);}catch{setError(L('Could not change learning. Try refreshing.','学习设置未能保存，请刷新重试。'));}finally{setPendingLearning(null);setBusy(false);}};
 const exportFile=()=>void run(async()=>{if(!personal){if(persona){const learnedText=file==='AGENTS.md'?(await Promise.all(visible.map(e=>request<{text:string}>({entryId:e.id,action:'export',file})))).map(t=>t.text.replace(/^# AGENTS\.md\s*/, '')).filter(Boolean).join('\n\n'):'';download(file,persona.files[file]+(learnedText?'\n\n<!-- roppo:learned-conventions -->\n## Learned working conventions\n\n'+learnedText+'\n<!-- /roppo:learned-conventions -->':''));}return;}const text=await Promise.all(visible.map(e=>request<{text:string}>({entryId:e.id,action:'export',file})));download(file,text.map(t=>t.text).join('\n\n'));},false);
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
   {scopedFile?<><div className="memory-scope"><UserRound size={17}/>{groups.length?<select aria-label={L('Memory scope','记忆范围')} disabled={editing||busy} value={actualScope} onChange={e=>{setScope(e.target.value);setSelected('');setMobileDetail(false);}}><option value="personal">{L('My memories','我的记忆')}</option><optgroup label={L('Group memories','群聊记忆')}>{groups.map(e=><option key={e.id} value={e.id}>{e.label}</option>)}</optgroup></select>:<span>{L('My memories','我的记忆')}</span>}</div>{personal&&<label className="memory-toggle"><span>{L('Learn from interactions','从交流中学习')}</span><input role="switch" type="checkbox" checked={pendingLearning??learning} disabled={busy||!visible.length||visible.some(e=>!e.enabled)} onChange={()=>void changeLearning()}/></label>}</>:<div className="memory-scope"><Users size={17}/><span>Router</span></div>}
  </div>
  <div className="memory-file-tabs" role="tablist" aria-label={L('Memory and personality files','记忆与人格文件')} onKeyDown={e=>{if(!['ArrowRight','ArrowLeft','Home','End'].includes(e.key)||editing)return;e.preventDefault();const i=files.indexOf(file),next=e.key==='Home'?0:e.key==='End'?files.length-1:(i+(e.key==='ArrowRight'?1:-1)+files.length)%files.length;chooseFile(files[next]!);document.getElementById(id+'-'+files[next])?.focus();}}>{files.map(name=><button id={id+'-'+name} key={name} role="tab" aria-selected={file===name} aria-controls={id+'-panel'} tabIndex={file===name?0:-1} disabled={editing} onClick={()=>chooseFile(name)}>{name}</button>)}</div>
  <p className="memory-file-hint">{noteHint}</p>
  {error&&<p className="memory-error" role="alert">{error}<button className="text-button" onClick={()=>refresh(v=>v+1)}>{L('Refresh','刷新')}</button></p>}
  <div id={id+'-panel'} role="tabpanel" aria-labelledby={id+'-'+file}>
   {entries===null||!persona?<p className="memory-empty" role="status">{error?L('Memory is unavailable.','记忆暂不可用。'):L('Loading…','加载中…')}</p>:personal?notes.length&&current?<div className="memory-reader" data-detail={mobileDetail}>
    <nav className="memory-list" aria-label={L('Memories','记忆列表')}>{notes.map(note=><button key={note.fact.id} aria-current={note.fact.id===current.fact.id?'true':undefined} disabled={editing} onClick={()=>{setSelected(note.fact.id);setMobileDetail(true);}}><MessageSquare size={19}/><span><strong>{memoryTitle(note.fact,L)}</strong><span>{note.fact.content}</span></span></button>)}</nav>
    <NoteDetail key={current.fact.id+':'+current.fact.revision} note={current} L={L} changed={()=>refresh(v=>v+1)} editingChanged={setEditing} back={()=>setMobileDetail(false)}/>
   </div>:<div className="memory-empty"><MessageSquare size={24}/><h3>{L('No memories yet','还没有记忆')}</h3><p>{file==='USER.md'?L('Preferences and information about you appear here.','关于你的偏好与习惯会显示在这里。'):L('What Roppo learns from your conversations appears here.','交流中记住的内容会显示在这里。')}</p></div>:<MemoryFile key={file+actualScope} file={file} data={persona} L={L} saved={setPersona} editingChanged={setEditing} learned={file==='AGENTS.md'?learned:[]} notesChanged={()=>refresh(v=>v+1)}/>}
  </div>
  <input ref={importInput} type="file" accept=".md" hidden onChange={e=>{const upload=e.target.files?.[0];e.target.value='';if(!upload)return;if(upload.size>64000||!files.includes(upload.name as FileTab)){setError(L('Choose one of the Markdown files shown above.','请选择上方页签对应的 Markdown 文件。'));return;}void run(async()=>{const text=await upload.text();if(upload.name==='MEMORY.md'||upload.name==='USER.md'){const entry=visible[0];if(!entry)throw Error('No memory context');await request({entryId:entry.id,action:'import',file:upload.name,text,operationId:crypto.randomUUID()});}else{if(!persona)throw Error('No settings');setPersona(await personaRequest({agentId:'router',file:upload.name,text,revision:persona.revision}));}});}}/>
  <dialog ref={methodsDialog} className="memory-method-dialog" onCancel={()=>setMethods(false)} onClose={()=>{setMethods(false);menu.current?.querySelector('summary')?.focus();}}><header><h3>{L('Working methods','工作方法')}</h3><button className="button" onClick={()=>setMethods(false)}>{L('Close','关闭')}</button></header>{visible.length>1&&<label>{L('Conversation','对话')}<select value={activeMethod?.id} onChange={e=>setMethodEntry(e.target.value)}>{visible.map(e=><option key={e.id} value={e.id}>{e.label}</option>)}</select></label>}{activeMethod&&<Methods key={activeMethod.id} entry={activeMethod} L={L} changed={()=>refresh(v=>v+1)}/>}</dialog>
 </section>;
}
