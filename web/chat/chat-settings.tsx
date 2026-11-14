import {useEffect,useRef,useState} from 'react';
import type {ChatSessions} from '../../src/chat.ts';
import './chat-settings.css';
export type ChatSpace=ReturnType<ChatSessions['space']>;
export function clearChatDrafts(){for(const key of Object.keys(localStorage))if(key.startsWith('roppo.chat.draft.')||key.startsWith('roppo.chat.pending.'))localStorage.removeItem(key)}
export async function spaceRequest(body?:unknown,method='GET',path='space'):Promise<ChatSpace>{
 const response=await fetch('/api/chat/'+path,{method,headers:{'content-type':'application/json'},...(body!==undefined?{body:JSON.stringify(body)}:{})});
 const data=await response.json();if(!response.ok)throw Error(data.error??data.message??data.code??'Request failed');return data;
}
export function ChatSettings({L}:{L:(en:string,zh:string)=>string}){
 const version=useRef(0),mutating=useRef(false);
 const [space,setSpace]=useState<ChatSpace|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[confirm,setConfirm]=useState(false),[operation,setOperation]=useState(()=>crypto.randomUUID());
 useEffect(()=>{let active=true;const refresh=()=>{if(mutating.current)return Promise.resolve();const current=version.current;return spaceRequest().then(s=>{if(active&&current===version.current)setSpace(s)}).catch(e=>{if(active)setError(String(e.message))})};void refresh();const timer=setInterval(()=>void refresh(),2000);return()=>{active=false;clearInterval(timer)}},[]);
 const change=async(body:unknown,method:string,path='space')=>{const previous=space;version.current++;mutating.current=true;setBusy(true);setError('');try{const next=await spaceRequest(body,method,path);setSpace(next);window.dispatchEvent(new Event('roppo:chat-space'));if(path==='reset'){clearChatDrafts();setConfirm(false);setOperation(crypto.randomUUID())}}catch(e){setError((e as Error).message);setSpace(previous)}finally{mutating.current=false;version.current++;setBusy(false)}};
 const clearing=space?.cleanup?.status==='processing';
 return <div className="chat-settings">
  <section><h2>{L('Chat display','聊天显示')}</h2><fieldset disabled={!space||busy}><legend className="sr-only">{L('Chat display','聊天显示')}</legend>
   <label><input type="radio" name="chat-display" checked={space?.display==='group'} onChange={()=>{setSpace(s=>s?{...s,display:'group'}:s);void change({display:'group'},'PATCH')}}/><span><strong>{L('Group chat','群聊')}</strong><small>{L('Router and Workers in one conversation.','Router 和 Worker 在同一个窗口中发言。')}</small></span></label>
   <label><input type="radio" name="chat-display" checked={space?.display==='agents'} onChange={()=>{setSpace(s=>s?{...s,display:'agents'}:s);void change({display:'agents'},'PATCH')}}/><span><strong>{L('Agents','Agents 列表')}</strong><small>{L('Talk to Router. Read each Worker’s conversation.','与 Router 对话，查看各 Worker 的协作记录。')}</small></span></label>
  </fieldset></section>
  <section><h2>{L('Memory and context','记忆与上下文')}</h2><p>{L('Clear all memories and conversation context associated with built-in Chat. External entries are managed in their own plugins.','清空内置 Chat 关联的所有记忆和对话上下文。外部入口的数据在对应插件中管理。')}</p>
   {confirm?<div className="reset-confirm" role="group" aria-label={L('Confirm clearing','确认清空')}><p>{L('Tasks using this Chat context will stop. This cannot be undone. Connections and project configuration are kept.','使用这些聊天上下文的任务将停止。此操作无法撤销，保留连接和项目配置。')}</p><div><button disabled={busy} onClick={()=>setConfirm(false)}>{L('Cancel','取消')}</button><button className="danger-action" disabled={busy} onClick={()=>void change({operationId:operation},'POST','reset')}>{busy?L('Clearing…','正在清空…'):L('Confirm clear','确认清空')}</button></div></div>:<button className="danger-action" disabled={busy||clearing} onClick={()=>setConfirm(true)}>{L('Clear all memory and context','清空所有记忆和上下文')}</button>}
   {space?.cleanup?<p role="status">{clearing?L('Context is no longer used. Local history cleanup is in progress.','已停止使用旧上下文，正在清理本地历史。'):L('Last cleanup completed.','上次清空已完成。')}{space.cleanup.error?' '+space.cleanup.error:''}</p>:null}
  </section>{error?<p role="alert">{error}</p>:null}
 </div>
}
