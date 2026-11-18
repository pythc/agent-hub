import {useEffect,useRef,useState} from 'react'
import type {TraceTask} from '../../src/execution-trace.ts'
import {recoveryPackageSchema} from '../../src/recovery-package-contract.ts'
import {useWorkspaceTransport} from './workspace-context.tsx'
export function RecoveryPackageExport({task,language='en'}:{task:TraceTask;language?:'en'|'zh-CN'}){
 const workspace=useWorkspaceTransport(),L=(en:string,zh:string)=>language==='en'?en:zh
 const key=JSON.stringify([workspace.contextKey,task.id,task.revision,task.observed])
 const latest=useRef({key,binding:workspace.binding,readSignal:workspace.readSignal});latest.current={key,binding:workspace.binding,readSignal:workspace.readSignal}
 const lifetime=useRef<{key:string;binding:typeof workspace.binding;signal:AbortSignal;ownerReadSignal:AbortSignal}|null>(null),flight=useRef(false)
 const [status,setStatus]=useState<{key:string;state:'idle'|'busy'|'failed'|'started'}>({key,state:'idle'})
 useEffect(()=>{
  const controller=new AbortController(),token={key,binding:workspace.binding,ownerReadSignal:workspace.readSignal,signal:AbortSignal.any([controller.signal,workspace.readSignal])}
  lifetime.current=token;flight.current=false;setStatus({key,state:'idle'})
  return()=>{controller.abort();if(lifetime.current===token)lifetime.current=null}
 },[key,workspace.binding,workspace.readSignal])
 const download=async()=>{
  const token=lifetime.current
  const current=()=>!!token&&lifetime.current===token&&!token.signal.aborted&&latest.current.key===token.key&&latest.current.binding===token.binding&&latest.current.readSignal===token.ownerReadSignal&&!latest.current.readSignal.aborted
  if(!token||!current()||flight.current)return
  flight.current=true;setStatus({key,state:'busy'})
  try{
   const raw=await token.binding.request<unknown>('/api/execution-trace/recovery-package',{ticketId:task.id,revision:task.revision,observed:task.observed})
   if(!current())return
   const value=recoveryPackageSchema.parse(raw)
   const blob=new Blob([JSON.stringify(value,null,2)+'\n'],{type:'application/json'}),url=URL.createObjectURL(blob)
   try{
    if(!current())return
    const link=document.createElement('a');link.href=url;link.download='recovery-diagnostic.json'
    if(!current())return
    link.click();if(current())setStatus({key,state:'started'})
   }finally{setTimeout(()=>URL.revokeObjectURL(url),1000)}
  }catch{if(current())setStatus({key,state:'failed'})}
  finally{if(current())flight.current=false}
 }
 const state=status.key===key&&!workspace.readSignal.aborted?status.state:'idle'
 return <div className="trace-guidance">
  <p>{L('Exports retained local records only, without original content or credentials. This package cannot restore a task or grant permission. Its checksum is not proof of authenticity.','仅导出保留的本地记录，不含原文或凭据。此包不能恢复任务或授予权限，校验和不是真实性证明。')}</p>
  <button type="button" disabled={state==='busy'||workspace.readSignal.aborted} onClick={()=>void download()}>{state==='busy'?L('Preparing diagnostic package…','正在准备诊断包……'):L('Export recovery diagnostic package','导出恢复诊断交接包')}</button>
  {state==='failed'?<p role="alert">{L('The package could not be verified or downloaded. Refresh the task and try again.','无法验证或下载诊断包，请刷新任务后重试。')}</p>:state==='started'?<p role="status">{L('Diagnostic download started. Keep it as local evidence, not a recovery authorization.','已开始下载诊断包，请仅作为本地证据保留，不作为恢复授权。')}</p>:null}
 </div>
}
