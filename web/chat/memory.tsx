import {useEffect, useState} from 'react';
import {ArrowLeft, BookOpen, Check, Pencil, RefreshCw, Search, Trash2} from 'lucide-react';
import type {MemoryEvidence, MemoryFact, MemoryProjection} from '../../src/router-memory.ts';
import type {MemoryPolicy} from '../../src/memory-policy.ts';
import './memory.css';

type Labels = (en:string,zh:string)=>string;
type Target = {conversationId:string} | {triggerId:string};
type Inventory = {unavailable?:boolean;enabled:boolean;canConfigure:boolean;learningAvailable:boolean;scopeName:string;revision:number;policy:MemoryPolicy;
  items:MemoryProjection[];uses:{at:number;items:{id:string;revision:number}[]}[]};
type Detail = {fact:MemoryFact;evidence:MemoryEvidence[];versions:MemoryFact[]};
async function request<T>(path:string,body?:unknown,signal?:AbortSignal):Promise<T>{
  const response=await fetch(path,{signal,...(body?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{})});
  if(!response.ok)throw Error('memory_request_failed');
  return response.json();
}
function command<T>(target:Target,kind:'manage'|'memory',value:unknown){
  return 'conversationId' in target
    ?request<T>('/api/chat/conversations/'+target.conversationId+'/memory',{kind,command:value})
    :request<T>(kind==='manage'?'/agent-memory':'/router-memory',{triggerId:target.triggerId,command:value});
}
function Empty({L}:{L:Labels}){
  return <div className="panel-empty memory-empty"><BookOpen size={26}/><h2>{L('Nothing remembered here yet','这里还没有记忆')}</h2>
    <p>{L('Keep working in the conversation. Available preferences and experience will appear here.','直接在对话中继续任务。可用的偏好和经验会显示在这里。')}</p></div>;
}
function MemoryRow({fact:f,items,target,L,changed}:{fact:MemoryProjection;items:MemoryProjection[];target:Target;L:Labels;changed:()=>void}){
  const [edit,setEdit]=useState<{content:string;condition:string;revision:number}|null>(null),[forget,setForget]=useState(false);
  const [detail,setDetail]=useState<Detail|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(false);
  const mutate=async(value:Record<string,unknown>)=>{
    setBusy(true);setError(false);
    try{await command(target,'memory',{operationId:crypto.randomUUID(),id:f.id,expectedRevision:f.revision,...value});setEdit(null);setForget(false);setDetail(null);changed();}
    catch{setError(true);}finally{setBusy(false);}
  };
  const inspect=async()=>{
    setBusy(true);setError(false);
    try{const result=await command<{detail:Detail}>(target,'manage',{action:'inspect',id:f.id});setDetail(result.detail);}
    catch{setError(true);}finally{setBusy(false);}
  };
  const changes=(f.replaces??[]).flatMap(ref=>items.filter(item=>item.id===ref.id&&item.revision===ref.revision));
  const deletion=f.proposalAction==='forget',editable=f.access.mode==='origin';
  const provenance=!editable?L('Shared from another entry','来自其他入口的共享'):f.state==='candidate'?L('Needs confirmation','待确认'):f.protected?L('Confirmed by you','你已确认'):f.origin==='experience'?L('From completed work','来自已验收任务'):f.learning?.inferred?L('Tentative preference','暂定偏好'):L('You mentioned this','你明确提过');
  return <article className="memory-note" data-memory-id={f.id}>
    {edit?<form className="memory-edit" onSubmit={e=>{e.preventDefault();void mutate({action:'remember',expectedRevision:edit.revision,subject:f.subject,content:edit.content,kind:f.kind,importance:f.importance,sourceIds:f.sources.map(s=>s.id),derivedFrom:f.dependencies?.map(d=>d.id),relation:f.relation,candidate:false,visibility:f.visibility,ticketId:f.ticketId,expiresAt:f.expiresAt,origin:'manual',topicAliases:f.topicAliases,learning:{inferred:false,condition:edit.condition,...(f.learning?.discussion?{discussion:f.learning.discussion}:{})}});}}>
      <label>{L('What to remember','记住什么')}<textarea autoFocus value={edit.content} required maxLength={16000} onChange={e=>setEdit({...edit,content:e.target.value})}/></label>
      <label>{L('When it applies','适用时机')}<input value={edit.condition} maxLength={300} onChange={e=>setEdit({...edit,condition:e.target.value})}/></label>
      <div className="memory-actions"><button type="submit" className="memory-primary" disabled={busy}>{L('Save','保存')}</button><button type="button" onClick={()=>setEdit(null)} disabled={busy}>{L('Cancel','取消')}</button></div>
    </form>:<>
      <p className="memory-content">{deletion?L('Suggested removal: ','建议忘记：'):null}{f.content}</p>
      {changes.length?<div className="memory-replacement"><span>{deletion?L('This would forget:','将忘记：'):L('This would replace:','将替换：')}</span>{changes.map(item=><p key={item.id}>{item.content}</p>)}</div>:null}
      <div className="memory-caption"><span>{provenance}</span>{f.learning?.condition?<span>{f.learning.condition}</span>:null}{f.learning?.discussion?<span>{L('One conversation only','仅对应会话')}</span>:null}</div>
      {editable?<div className="memory-actions">
        {f.state==='candidate'?<button disabled={busy} onClick={()=>void mutate({action:'confirm'})}><Check size={14}/>{deletion?L('Confirm forgetting','确认忘记'):changes.length?L('Use this change','采用修改'):L('Keep this','保留')}</button>:
          <button disabled={busy} onClick={()=>{setEdit({content:f.content,condition:f.learning?.condition??'',revision:f.revision});setError(false);}}><Pencil size={14}/>{L('Correct','纠正')}</button>}
        <button disabled={busy} onClick={()=>f.state==='candidate'?void mutate({action:'forget'}):setForget(!forget)}><Trash2 size={14}/>{f.state==='candidate'?L('Dismiss','不采用'):L('Forget','忘记')}</button>
      </div>:null}
      {forget?<div className="memory-forget"><span>{L('Forget this note?','忘记这条内容？')}</span><button disabled={busy} onClick={()=>void mutate({action:'forget'})}>{L('Confirm','确认忘记')}</button><button disabled={busy} onClick={()=>setForget(false)}>{L('Cancel','取消')}</button></div>:null}
      {editable?<details className="memory-detail" onToggle={e=>{if(e.currentTarget.open&&!detail&&!busy)void inspect();}}>
        <summary>{L('Source and changes','来源与修改记录')}</summary>
        {detail?<div>{detail.evidence.map(e=><blockquote key={e.id}>{e.text}</blockquote>)}{detail.versions.map(v=><p key={v.revision}>{L('Earlier: ','之前：')}{v.content}</p>)}</div>:<p>{L('Loading source…','正在读取来源…')}</p>}
      </details>:null}
    </>}
    {error?<p role="alert" className="memory-error">{L('Couldn’t complete this change. Refresh the notes and try again.','操作未完成，请刷新记忆后重试。')}</p>:null}
  </article>;
}
function MemoryContent({target,L,refreshKey}:{target:Target;L:Labels;refreshKey?:string}){
  const [data,setData]=useState<Inventory|null>(null),[error,setError]=useState(false),[revision,refresh]=useState(0);
  const [query,setQuery]=useState(''),[busy,setBusy]=useState(false);
  const key='conversationId' in target?target.conversationId:target.triggerId;
  useEffect(()=>{
    const controller=new AbortController();setError(false);
    const work='conversationId' in target?request<Inventory>('/api/chat/conversations/'+target.conversationId+'/memory',undefined,controller.signal):
      request<Inventory>('/agent-memory',{triggerId:target.triggerId,command:{action:'inspect'}},controller.signal);
    void work.then(setData).catch(()=>{if(!controller.signal.aborted){setData(null);setError(true);}});
    return()=>controller.abort();
  },[key,revision,refreshKey]);
  const reload=()=>refresh(v=>v+1);
  const learn=async(enabled:boolean)=>{
    setBusy(true);setError(false);
    try{await command(target,'manage',{action:'configure',expectedRevision:data!.revision,policy:{...data!.policy,...(enabled?{enabled:true}:{}),writeMode:enabled?'adaptive':'explicit_only'}});reload();}
    catch{setError(true);}finally{setBusy(false);}
  };
  if(!data)return <div className="panel-empty">{error?<><p role="alert">{L('Couldn’t load memories.','记忆读取失败。')}</p><button onClick={reload}>{L('Retry','重试')}</button></>:<p role="status">{L('Loading memories…','正在读取记忆…')}</p>}</div>;
  if(data.unavailable)return <Empty L={L}/>;
  const matches=(f:MemoryFact)=>!query||[f.content,f.subject,f.learning?.condition].join(' ').toLocaleLowerCase().includes(query.toLocaleLowerCase());
  const preferences=data.items.filter(f=>f.state==='active'&&['preference','profile'].includes(f.kind??'fact')&&matches(f)),notes=data.items.filter(f=>f.state==='active'&&!['preference','profile'].includes(f.kind??'fact')&&matches(f)),pending=data.items.filter(f=>f.state==='candidate'&&matches(f));
  const groups:[string,MemoryProjection[]][]=[[L('How we work together','协作偏好'),preferences],[L('Working knowledge','工作经验与事实'),notes],[L('Review when convenient','待你确认'),pending]];
  return <div className="memory-content-view">
    <div className="memory-toolbar"><label className="memory-search"><Search size={16}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder={L('Find a memory','查找记忆')} aria-label={L('Find a memory','查找记忆')}/></label><button className="icon-button" onClick={reload} aria-label={L('Refresh memories','刷新记忆')} title={L('Refresh memories','刷新记忆')}><RefreshCw size={16}/></button></div>
    {error?<p className="memory-error" role="alert">{L('The change wasn’t saved. Refresh and try again.','更改未保存，请刷新后重试。')}</p>:null}
    <div className="memory-scroll">
      <div className="memory-learning"><label><span>{L('Learn from our work','在协作中学习')}</span><input type="checkbox" role="switch" checked={data.enabled&&data.policy.writeMode!=='explicit_only'} disabled={busy||!data.canConfigure||!data.learningAvailable} onChange={e=>void learn(e.target.checked)}/></label><p>{!data.learningAvailable?L('Memory use is paused for this entry.','这个入口已暂停使用记忆。'):L('Applies to every entry in ', '适用于“')+data.scopeName+L('. Turning it off keeps saved memories available.', '”的所有入口；关闭后仍可使用已有记忆。')}</p></div>
      {groups.map(([title,items])=>items.length?<section className="memory-group" key={title}><h2>{title}</h2>{items.map(f=><MemoryRow key={f.id} fact={f} items={data.items} target={target} L={L} changed={reload}/>)}</section>:null)}
      {!preferences.length&&!notes.length&&!pending.length?<p className="memory-no-results">{query?L('No matching memories.','没有匹配的记忆。'):L('No notes yet. Keep working in the conversation.','还没有记忆，直接在对话中继续任务即可。')}</p>:null}
      {data.uses.length?<details className="memory-uses"><summary>{L('Supplied and retrieved notes','提供与检索记录')}</summary><p>{L('These notes were supplied to or retrieved by the model.','以下内容曾提供给模型，或由模型检索。')}</p>{data.uses.slice(-3).reverse().map((use,index)=><ul key={index}>{use.items.map(ref=>{const f=data.items.find(f=>f.id===ref.id&&f.revision===ref.revision);return <li key={ref.id}>{f?f.content:L('This note has changed or was removed.','这条记忆已修改或移除。')}</li>;})}</ul>)}</details>:null}
    </div>
  </div>;
}
export function ConversationMemory({conversationId,L,refreshKey}:{conversationId:string|null;L:Labels;refreshKey?:string}){
  return <section className="memory-panel" aria-label={L('Conversation memory','会话记忆')}>
    {conversationId?<MemoryContent key={conversationId} target={{conversationId}} L={L} refreshKey={refreshKey}/>:<Empty L={L}/>}
    <a className="memory-all" href={'/configure'+(conversationId?'?conversation='+conversationId:'')+'#prompts/memory'}>{L('View collaboration preferences','查看协作偏好')}</a>
  </section>;
}
type EntryContext={id:string;entryId:string;label:string;title?:string;sourceId?:string;conversationId?:string};
export function MemoryPreferences({L,conversationId}:{L:Labels;conversationId:string|null}){
  const [contexts,setContexts]=useState<EntryContext[]|null>(null),[selected,setSelected]=useState(''),[error,setError]=useState(false),[retry,setRetry]=useState(0);
  useEffect(()=>{
    const controller=new AbortController();setError(false);
    void request<{contexts:EntryContext[]}>('/router-management/catalog',undefined,controller.signal).then(c=>{
      const seen=new Set<string>();const entries=[...c.contexts].reverse().filter(item=>{if(seen.has(item.entryId))return false;seen.add(item.entryId);return true;});setContexts(entries);setSelected(entries.find(c=>c.conversationId===conversationId)?.id??entries[0]?.id??'');
    }).catch(()=>{if(!controller.signal.aborted)setError(true);});
    return()=>controller.abort();
  },[retry,conversationId]);
  return <section className="memory-preferences" aria-label={L('Collaboration preferences','协作偏好')}>
    <header className="memory-page-heading"><a href="/configure#prompts"><ArrowLeft size={17}/>{L('Shared instructions','共享指令')}</a><h1>{L('Collaboration preferences','协作偏好')}</h1></header>
    {contexts&&contexts.length>1?<label className="memory-entry">{L('Conversation entry','会话入口')}<select value={selected} onChange={e=>setSelected(e.target.value)}>{contexts.map((c,index)=><option key={c.id} value={c.id}>{c.title||L('Conversation ','会话 ')+(index+1)}</option>)}</select></label>:null}
    {error?<div className="panel-empty"><p role="alert">{L('Couldn’t load conversation entries.','会话入口读取失败。')}</p><button onClick={()=>setRetry(v=>v+1)}>{L('Retry','重试')}</button></div>:
      contexts===null?<p role="status">{L('Loading…','加载中…')}</p>:selected?<MemoryContent key={selected} target={{triggerId:selected}} L={L}/>:<Empty L={L}/>}
  </section>;
}
