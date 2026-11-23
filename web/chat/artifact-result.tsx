import {ArtifactReferenceDetails} from './artifact-reference-details.tsx'
import {useEffect,useState} from 'react'
import type {ArtifactReference} from '../../src/artifact-reference.ts'
import {useWorkspaceTransport} from './workspace-context.tsx'
import {artifactReference,artifactIdValid,artifactDownload} from './artifact-result-model.ts'
import './worker-templates.css'

/** A fixed reference, not a sharing link or a claim that the result was accepted. */
export function ArtifactResult({id,language='en'}:{id:string;language?:'en'|'zh-CN'}){
 const {binding,context,contextKey,readSignal}=useWorkspaceTransport()
 const L=(en:string,zh:string)=>language==='en'?en:zh
 const [result,setResult]=useState<{id:string;contextKey:string;value:ArtifactReference}|null>(null),[error,setError]=useState(false),[loading,setLoading]=useState(true),[revision,setRevision]=useState(0)
 useEffect(()=>{
  const controller=new AbortController(),signal=AbortSignal.any([controller.signal,readSignal])
  setResult(null);setError(false);setLoading(true)
  if(!artifactIdValid(id)){setError(true);setLoading(false);return()=>controller.abort()}
  void binding.request<unknown>('/goal-artifact-versions/'+id,undefined,false,undefined,signal).then(data=>{
   if(signal.aborted)return
   const value=artifactReference(data,id)
   if(!value)throw Error('artifact_unavailable')
   setResult({id,contextKey,value});setLoading(false)
  }).catch(()=>{if(!signal.aborted){setResult(null);setError(true);setLoading(false)}})
  return()=>controller.abort()
 },[binding,contextKey,id,revision,readSignal])
 const value=!readSignal.aborted&&result?.id===id&&result.contextKey===contextKey?result.value:null
 const download=value?.availability==='retained'?artifactDownload(id,context):null
 return <section className="templates-page" aria-label={L('File version','文件版本')}>
  <header className="templates-heading"><div><h1>{L('File version','文件版本')}</h1><p>{L('This reference selects retained bytes, independently of the task title or progress card. Access is checked again when you download.','此引用指向保留的文件版本，不依赖任务标题或进度卡。下载时会再次检查当前访问权限。')}</p></div><button type="button" disabled={loading} onClick={()=>{setResult(null);setRevision(n=>n+1)}}>{L('Refresh','刷新')}</button></header>
  {loading?<p role="status">{L('Loading version…','正在读取版本…')}</p>:error?<p role="alert">{L('This version is unavailable in the current workspace. It may have been removed or access may have changed.','当前工作区无法读取此版本。它可能已被清理，或访问权限已变化。')}</p>:null}
  {value?<article className="template-review"><h2>{value.name}</h2><dl className="template-meta">
   <div><dt>{L('Version','版本')}</dt><dd>{value.version}</dd></div>
   <div><dt>{L('Type','类型')}</dt><dd>{value.mediaType}</dd></div>
   <div><dt>{L('Size','大小')}</dt><dd>{value.bytes.toLocaleString()} {L('bytes','字节')}</dd></div>
   <div><dt>ID</dt><dd>{value.id}</dd></div><div><dt>SHA-256</dt><dd>{value.sha256}</dd></div>
  </dl><p>{L('Only available to authorized operators of this workspace. History cleanup may remove retained bytes. This record does not establish content acceptance, sending or publication.','仅当前工作区获授权的操作者可访问。历史清理可能删除保留的文件；此记录不表示内容已验收、发送或发布。')}</p>
  {download?<a href={download} onClick={event=>{if(readSignal.aborted)event.preventDefault()}}>{L('Download this exact version','下载此固定版本')}</a>:<p role="status">{L('The retained file is no longer available.','保留的文件已不可用。')}</p>}
  <ArtifactReferenceDetails reference={value} registrationState={value.registrationState} current={download?'available':'unavailable'} L={L}/>
  </article>:null}
 </section>
}
