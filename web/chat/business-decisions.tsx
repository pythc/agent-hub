import {useEffect,useRef,useState} from 'react';
import type {BusinessDecisionView} from '../../src/business-decisions.ts';
import {decisionStatus,DecisionSubmission} from './decision-state.ts';
import './business-decisions.css';
type Props={conversationId:string;items:BusinessDecisionView[];disabled:boolean;language:'en'|'zh-CN';request:(path:string,body:unknown)=>Promise<unknown>;refresh:()=>Promise<void>};
export function BusinessDecisions(p:Props){
 const L=(en:string,zh:string)=>p.language==='zh-CN'?zh:en;
 if(!p.items.length)return null;
 return <section className="business-decisions" aria-label={L('Your decisions','需要你决定')}><h2>{L('Your decisions','需要你决定')}</h2><p>{L('Your answer records a business choice, not permission to execute.','答复只记录业务选择，不授予执行权限。')}</p>{p.items.map(d=><DecisionCard key={p.conversationId+':'+d.id+':'+d.version} {...p} decision={d}/>)}</section>;
}
function DecisionCard(p:Props&{decision:BusinessDecisionView}){
 const d=p.decision,L=(en:string,zh:string)=>p.language==='zh-CN'?zh:en;
 const [text,setText]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[uncertain,setUncertain]=useState(false),[ack,setAck]=useState(false),[now,setNow]=useState(Date.now);
 const submission=useRef(new DecisionSubmission()),alive=useRef(true),lock=useRef(false),current=useRef(p);current.current=p;
 useEffect(()=>{alive.current=true;submission.current=new DecisionSubmission();const timer=setInterval(()=>setNow(Date.now()),1000);return()=>{alive.current=false;submission.current.dispose();clearInterval(timer)}},[]);
 const state=decisionStatus(d,now),disabled=p.disabled||busy||ack;
 useEffect(()=>{if(d.status==='answered'||d.status==='withdrawn'){setUncertain(false);setError('')}},[d.status]);
 async function submit(action:'answer'|'renew'){
  if(lock.current||current.current.disabled||ack)return;
  const latest=current.current.decision,status=decisionStatus(latest,Date.now());
  if(!uncertain&&(action==='answer'?status!=='pending':!['expired','stale'].includes(status)))return;
  lock.current=true;setBusy(true);setError('');
  try{
   const outcome=await submission.current.run(latest,action,text,body=>p.request('/conversations/'+encodeURIComponent(p.conversationId)+'/decisions',body));
   if(outcome==='ignored')return;
   if(!alive.current)return;
   setAck(true);setUncertain(false);
   try{await p.refresh()}catch{if(alive.current)setError(L('Saved. Refresh to see the latest question.','已保存，请刷新查看最新问题。'))}
  }catch(e){
   if(!alive.current)return;
   const code=e&&typeof e==='object'&&'code'in e?String(e.code):'';
   const rejected=['decision_stale','decision_expired','decision_answered','decision_conflict','decision_unavailable','decision_identity','conversation_busy','conversation_archived'].includes(code);
   setUncertain(!rejected);
   if(rejected)submission.current.clearRejected();
   setError(rejected?L('This question cannot be answered right now. Refresh for its current state.','当前无法提交，请刷新查看问题的最新状态。'):L('Receipt not confirmed. Refresh first or retry the same answer.','尚未确认是否收到。可刷新核实，或重试同一答复。'));
   try{await p.refresh()}catch{}
  }finally{lock.current=false;if(alive.current)setBusy(false)}
 }
 return <article className="business-decision"><h3>{d.question}</h3>{d.summary&&d.summary!==d.question?<p>{d.summary}</p>:null}<dl><div><dt>{L('Proposal','方案')}</dt><dd>{d.target.label}</dd></div><div><dt>{L('Version','版本')}</dt><dd>{d.target.version===d.version?L('Current saved proposal','当前已保存方案'):d.target.version}</dd></div>{d.target.amount?<div><dt>{L('Amount','金额')}</dt><dd>{d.target.amount.value} {d.target.amount.currency}</dd></div>:null}{d.target.recipient?<div><dt>{L('Recipient','接收者')}</dt><dd>{d.target.recipient.label} ({d.target.recipient.id})</dd></div>:null}</dl><p>{Number.isFinite(d.expiresAt)?L('Valid until ','有效期至 ')+new Date(d.expiresAt).toLocaleString(p.language):null}</p><p>{state==='pending'?L('Awaiting your answer','等待答复'):state==='answered'?L('Answered','已答复'):state==='expired'?L('Expired. Request a current question before answering.','已过期，请更新问题后再回答。'):state==='stale'?L('The proposal changed. Review a new question.','方案已变化，请更新问题后重新核对。'):state==='withdrawn'?L('Question withdrawn or task closed','问题已撤回或任务已结束'):L('Question unavailable','问题暂不可用')}</p>{d.answer?<p>{d.answer.text}</p>:null}{state==='pending'?<label>{L('Your answer','你的答复')}<textarea value={text} maxLength={10000} disabled={disabled||uncertain} onChange={e=>setText(e.target.value)}/></label>:null}<div className="decision-actions">{uncertain?<button disabled={disabled} onClick={()=>void submit(submission.current.pending?.action??'answer')}>{L('Retry same answer','重试原答复')}</button>:state==='pending'?<button disabled={disabled||!text.trim()} onClick={()=>void submit('answer')}>{busy?L('Submitting…','正在提交…'):ack?L('Saved','已保存'):L('Submit answer','提交答复')}</button>:['expired','stale'].includes(state)?<button disabled={disabled} onClick={()=>void submit('renew')}>{L('Update question','更新问题')}</button>:null}{error?<button disabled={busy} onClick={()=>void p.refresh().catch(()=>{})}>{L('Refresh','刷新')}</button>:null}</div>{error?<p role="alert">{error}</p>:null}</article>;
}
