import React from 'react';
import {createRoot} from 'react-dom/client';
import {BusinessDecisions} from '../../web/chat/business-decisions.tsx';
import '../../src/ui/theme.css';
import '../../web/chat/style.css';
const root=createRoot(document.getElementById('root')!);
let conversation='one',version='digest-one',disabled=false,status:'pending'|'stale'='pending';
const calls:{path:string;body:unknown}[]=[],pending:{resolve:(value:unknown)=>void;reject:(error:unknown)=>void}[]=[];
let refreshes=0;
function render(){root.render(<BusinessDecisions key={conversation} conversationId={conversation} language="zh-CN" disabled={disabled} items={[{id:'question',ticketId:'task',question:'请选择方案',summary:'等待业务决定',version,createdAt:Date.now()-1000,expiresAt:Date.now()+600000,status,reason:null,target:{label:'交付方案',version,amount:{value:'20.00',currency:'USD'},recipient:{id:'alice',label:'Alice'}},answer:null}]} request={(path,body)=>{calls.push({path,body});return new Promise((resolve,reject)=>pending.push({resolve,reject}))}} refresh={async()=>{refreshes++}}/>)}
Object.assign(window,{fixture:{calls,pending,get refreshes(){return refreshes},set(next:{conversation?:string;version?:string;disabled?:boolean;status?:'pending'|'stale'}){conversation=next.conversation??conversation;version=next.version??version;disabled=next.disabled??disabled;status=next.status??status;render()},resolve(i:number){pending[i]!.resolve({})},reject(i:number){pending[i]!.reject(Error('controlled lost receipt'))}}});render();
