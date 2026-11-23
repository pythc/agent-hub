import {useEffect,useState} from 'react'
import type {WorkspaceViewArtifactReference} from '../../src/artifact-reference.ts'
import {useWorkspaceTransport} from './workspace-context.tsx'
import {ArtifactReferenceDetails} from './artifact-reference-details.tsx'
import './worker-templates.css'
interface ViewVersion {reference:WorkspaceViewArtifactReference;label:{en:string;'zh-CN':string};packageVersion:string;current:boolean}
export function parseViewVersion(value:unknown,id:string,digest:string):ViewVersion|null{
 const data=value as ViewVersion,ref=data?.reference
 if(!/^[a-z][a-z0-9_-]{0,63}$/.test(id)||!/^[a-f0-9]{64}$/.test(digest)||!ref||ref.schema!==1||ref.kind!=='workspace-view'||ref.id!==id||ref.version!==digest||typeof ref.sha256!=='string'||!/^[a-f0-9]{64}$/.test(ref.sha256)||ref.visibility!=='operator_workspace'||ref.retention!=='subject_to_plugin_removal'||ref.publication!=='not_tracked'||typeof data.current!=='boolean'||typeof data.packageVersion!=='string'||typeof data.label?.en!=='string'||typeof data.label?.['zh-CN']!=='string')return null
 return data
}
/** Fixed metadata only. Never mounts an iframe or requests executable bundle/runtime data. */
export function ViewVersionPage({selection,language='en'}:{selection:string;language?:'en'|'zh-CN'}){
 const {binding,contextKey,readSignal}=useWorkspaceTransport(),L=(en:string,zh:string)=>language==='en'?en:zh
 const [result,setResult]=useState<{selection:string;contextKey:string;value:ViewVersion}|null>(null),[failed,setFailed]=useState(false),[revision,setRevision]=useState(0)
 useEffect(()=>{
  const controller=new AbortController(),signal=AbortSignal.any([controller.signal,readSignal])
  setResult(null);setFailed(false)
  const match=selection.match(/^([a-z][a-z0-9_-]{0,63})\/([a-f0-9]{64})$/)
  if(!match){setFailed(true);return()=>controller.abort()}
  const [,id,digest]=match
  void binding.request<unknown>('/api/workspace-views/'+id+'/versions/'+digest,undefined,false,undefined,signal).then(data=>{
   if(signal.aborted)return
   const value=parseViewVersion(data,id!,digest!)
   if(!value)throw Error('view_version_unavailable')
   setResult({selection,contextKey,value})
  }).catch(()=>{if(!signal.aborted){setResult(null);setFailed(true)}})
  return()=>controller.abort()
 },[binding,contextKey,readSignal,selection,revision])
 const value=!readSignal.aborted&&result?.contextKey===contextKey&&result.selection===selection?result.value:null
 return <section className="templates-page" aria-label={L('View version metadata','视图版本元数据')}>
  <header className="templates-heading"><h1>{L('View version metadata','视图版本元数据')}</h1><button type="button" onClick={()=>{setResult(null);setFailed(false);setRevision(n=>n+1)}}>{failed?L('Try again','重试'):L('Refresh','刷新')}</button></header>
  <a href="#artifacts">{L('Back to artifacts','返回产物目录')}</a>
  <p>{L('Read-only retained package metadata, not a runtime snapshot. No historical code is executed. Availability is checked on each refresh; removal or cleanup can make this reference unavailable.','仅展示保留包的只读元数据，不是运行时快照，不执行历史代码。每次刷新重新检查可用性；移除或清理可能使此引用不可用。')}</p>
  {failed?<p role="alert">{L('This version is unavailable in this workspace.','此版本在当前工作区不可用。')}</p>:value?<article className="template-review"><h2>{value.label[language]}</h2><p>{L('Package version','包版本')}: {value.packageVersion}</p><p>{value.current?L('Currently enabled package at last check.','最近检查时，此包为当前启用版本。'):L('Retained package; not currently enabled.','保留包，当前未启用。')}</p><p><a href={'#artifact-discussion/view/'+selection}>{L('Discuss this version','讨论此版本')}</a></p><ArtifactReferenceDetails reference={value.reference} L={L}/></article>:<p role="status">{L('Loading version metadata…','正在读取版本元数据…')}</p>}
 </section>
}
