import {useEffect,useRef,useState} from 'react';
import type {ChatSessions} from '../../src/chat.ts';
import './chat-settings.css';
export type ChatSpace=ReturnType<ChatSessions['space']>;
export function clearChatDrafts(){for(const key of Object.keys(localStorage))if(key.startsWith('roppo.chat.draft.')||key.startsWith('roppo.chat.pending.')||key.startsWith('roppo.resources.')||key.startsWith('roppo.chat.panel.'))localStorage.removeItem(key);for(const key of Object.keys(sessionStorage))if(key.startsWith('roppo.website.'))sessionStorage.removeItem(key)}
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
  <section><h2>{L('Memory and context','记忆与上下文')}</h2><p>{L('Reset this account’s Chat conversations, memories, learned methods and learning settings.','清空当前账号的对话、记忆、复盘经验和工作方法，恢复个人学习设置。')}</p>
   {confirm?<div className="reset-confirm" role="group" aria-label={L('Confirm clearing','确认清空')}><p>{L('Related tasks will stop. Login, model connections, plugins, group settings and manually configured personality are kept. This cannot be undone.','相关任务将停止。保留登录、模型连接、插件、群聊配置和手动设置的人格，此操作无法撤销。')}</p><div><button disabled={busy} onClick={()=>setConfirm(false)}>{L('Cancel','取消')}</button><button className="danger-action" disabled={busy} onClick={()=>void change({operationId:operation},'POST','reset')}>{busy?L('Clearing…','正在清空…'):L('Confirm clear','确认清空')}</button></div></div>:<button className="danger-action" disabled={busy||clearing} onClick={()=>setConfirm(true)}>{L('Clear all memory and context','清空所有记忆和上下文')}</button>}
   {space?.cleanup?<p role="status">{clearing?L('Context is no longer used. Local history cleanup is in progress.','已停止使用旧上下文，正在清理本地历史。'):L('Personal memory reset completed.','个人记忆已恢复到初始状态。')}{space.cleanup.error?' '+space.cleanup.error:''}</p>:null}
  </section>{error?<p role="alert">{error}</p>:null}
 </div>
}
