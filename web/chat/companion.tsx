import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import body from '../../src/ui/assets/agents/roppo-body.webp';
import type {CompanionPhase,CompanionStatus} from './companion-state.ts';
import './companion.css';

const spiralEye=Array.from({length:65},(_,i)=>{
 const angle=i/64*Math.PI*3.5,radius=.4+i/64*9;
 return `${i?'L':'M'}${(12+radius*Math.cos(angle)).toFixed(2)} ${(12+radius*Math.sin(angle)).toFixed(2)}`;
}).join(' ');

export function RoppoCharacter({phase,paused=false}:{phase:CompanionPhase;paused?:boolean}){
 const [visualPhase,setVisualPhase]=useState(phase);
 const bodyRef=useRef<HTMLSpanElement>(null);
 const previousPose=useRef<string|null>(null);
 const bridge=useRef<Animation|null>(null);
 // Read the displayed pose before changing the CSS animation, including any
 // unfinished transition. Rapid status changes then continue from this pose.
 useLayoutEffect(()=>{
  if(phase===visualPhase)return;
  previousPose.current=bodyRef.current&&!paused&&!matchMedia('(prefers-reduced-motion: reduce)').matches
   ?getComputedStyle(bodyRef.current).transform:null;
  bridge.current?.cancel();bridge.current=null;
  setVisualPhase(phase);
 },[phase,visualPhase,paused]);
 useLayoutEffect(()=>{
  const element=bodyRef.current,from=previousPose.current;
  previousPose.current=null;
  if(!element||!from)return;
  const next=new DOMMatrix(getComputedStyle(element).transform);
  const offset=next.inverse().multiply(new DOMMatrix(from));
  // Add a decaying offset to the new CSS motion instead of replacing it.
  const animation=element.animate([{transform:offset.toString()},{transform:'matrix(1,0,0,1,0,0)'}],{
   duration:260,easing:'cubic-bezier(.2,.7,.3,1)',composite:'add',
  });
  bridge.current=animation;
  animation.onfinish=()=>{if(bridge.current===animation)bridge.current=null};
 },[visualPhase]);
 useLayoutEffect(()=>{
  if(paused)bridge.current?.pause();
  else if(bridge.current?.playState==='paused')bridge.current.play();
 },[paused]);
 useEffect(()=>{
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  const stop=()=>{if(reduced.matches){bridge.current?.cancel();bridge.current=null}};
  reduced.addEventListener('change',stop);
  return ()=>{reduced.removeEventListener('change',stop);bridge.current?.cancel()};
 },[]);
 return <span className="roppo-character" data-phase={visualPhase} data-paused={paused||undefined} aria-hidden="true">
  <span className="roppo-pose"><span className="roppo-body" ref={bodyRef}>
   <img src={body} width="512" height="512" alt="" draggable={false}/>
   <span className="roppo-eyes">
    <span className="roppo-eye-layer roppo-eyes-open"><i/><i/></span>
    <span className="roppo-eye-layer roppo-eyes-happy">{[0,1].map(eye=><svg key={eye} viewBox="0 0 24 24"><path d="M3 14 Q12 2 21 14"/></svg>)}</span>
    <span className="roppo-eye-layer roppo-eyes-spiral">{[0,1].map(eye=><svg key={eye} className="roppo-spiral" viewBox="0 0 24 24"><path d={spiralEye}/></svg>)}</span>
   </span>
   <span className="roppo-arm roppo-arm-left"/><span className="roppo-arm roppo-arm-right"/>
  </span></span>
  <span className="roppo-laptop"><span className="roppo-laptop-screen"><i/></span><span className="roppo-laptop-base"/></span>
  <span className="roppo-review"><span/><span/><span/><i/></span>
  <span className="roppo-signal"><i/><i/><i/></span>
 </span>;
}

export function ChatCompanion({status:current,onOpen,L}:{status:CompanionStatus;onOpen:()=>void;L:(en:string,zh:string)=>string}){
 const [displayed,setDisplayed]=useState(current);
 const changedAt=useRef(0);
 const critical=!['thinking','working','reviewing'].includes(current.phase);
 const status=current.runId!==displayed.runId||critical?current:displayed;
 useEffect(()=>{
   const publish=()=>{changedAt.current=Date.now();setDisplayed(current)};
   if(current.runId!==displayed.runId||critical||!changedAt.current){publish();return}
   const timer=setTimeout(publish,Math.max(0,1400-(Date.now()-changedAt.current)));
   return ()=>clearTimeout(timer);
 },[current.phase,current.label,current.runId]);
 const [hidden,setHidden]=useState(()=>document.hidden);
 const [celebrate,setCelebrate]=useState(false);
 const previous=useRef(status);
 useEffect(()=>{
   const update=()=>setHidden(document.hidden);
   document.addEventListener('visibilitychange',update);
   return ()=>document.removeEventListener('visibilitychange',update);
 },[]);
 useEffect(()=>{
   const wasActive=['thinking','working','reviewing','waiting'].includes(previous.current.phase);
   const justCompleted=status.phase==='completed'&&previous.current.runId===status.runId&&wasActive;
   previous.current=status;
   setCelebrate(justCompleted);
   if(justCompleted){const timer=setTimeout(()=>setCelebrate(false),2400);return ()=>clearTimeout(timer)}
 },[status.phase,status.runId]);
 const phase=status.phase==='completed'&&!celebrate?'idle':status.phase;
 return <button type="button" className="chat-companion" onClick={onOpen}
   data-phase={status.phase} title={status.label} aria-label={L('View current activity','查看当前任务进展')}>
   <RoppoCharacter phase={phase} paused={hidden}/>
   <span className="companion-copy"><strong>Roppo</strong><span className="companion-label" role="status" aria-live="polite" aria-atomic="true">{status.label}</span></span>
 </button>;
}
