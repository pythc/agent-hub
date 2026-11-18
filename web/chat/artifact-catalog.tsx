import {useEffect,useState} from 'react'
import type {ArtifactCatalog} from '../../src/artifact-catalog.ts'
import {useWorkspaceTransport} from './workspace-context.tsx'
import {parseArtifactCatalog} from './artifact-catalog-model.ts'
import {ArtifactReferenceDetails} from './artifact-reference-details.tsx'
import './worker-templates.css'
export function ArtifactCatalogPage({language='en'}:{language?:'en'|'zh-CN'}){
 const {binding,contextKey,readSignal}=useWorkspaceTransport()
 const L=(en:string,zh:string)=>language==='en'?en:zh
 const [result,setResult]=useState<{contextKey:string;value:ArtifactCatalog}|null>(null),[error,setError]=useState(false),[loading,setLoading]=useState(true),[revision,setRevision]=useState(0)
 useEffect(()=>{
  const controller=new AbortController(),signal=AbortSignal.any([controller.signal,readSignal])
  setResult(null);setError(false);setLoading(true)
  void binding.request<unknown>('/artifact-catalog',undefined,false,undefined,signal).then(data=>{
   if(signal.aborted)return
   const value=parseArtifactCatalog(data)
   if(!value)throw Error('catalog_unavailable')
   setResult({contextKey,value});setLoading(false)
  }).catch(()=>{if(!signal.aborted){setResult(null);setError(true);setLoading(false)}})
  return()=>controller.abort()
 },[binding,contextKey,revision,readSignal])
 const value=!readSignal.aborted&&result?.contextKey===contextKey?result.value:null
 return <section className="templates-page" aria-label={L('Artifacts','产物目录')}>
  <header className="templates-heading"><div><h1>{L('Artifacts','产物目录')}</h1><p>{L('Task file versions and verified, enabled view packages visible to the current workspace operator. Conversation attachments stay in their own conversations.','当前工作区操作者可见的任务文件版本，以及已校验、已启用的视图包。会话附件仍保留在各自会话中。')}</p></div><button type="button" disabled={loading} onClick={()=>{setResult(null);setRevision(n=>n+1)}}>{L('Refresh','刷新')}</button></header>
  <p>{L('Read-only metadata, not acceptance, sharing or publication. Opening an entry checks current access again. View packages are not historical runtime snapshots.','此目录仅展示元数据，不表示已验收、共享或发布。打开入口会重新检查当前权限。视图包不是历史运行快照。')}</p>
  {loading?<p role="status">{L('Loading artifacts…','正在读取产物…')}</p>:error?<p role="alert">{L('Artifacts could not load in this workspace. Refresh to retry.','无法读取当前工作区的产物，请刷新重试。')}</p>:null}
  {value?.truncated?<p role="status">{L('Showing the first 200 visible entries, ordered by kind and identity. This is not the complete catalog.','仅按类型和标识展示前 200 项可见条目，并非完整目录。')}</p>:null}
  {value&&!value.items.length?<p>{L('No visible artifacts yet.','暂无可见产物。')}</p>:null}
  {value?.items.map(({reference,label})=><article className="template-review" key={reference.kind+':'+reference.id}>
   <h2>{label[language]}</h2>
   <a href={reference.kind==='goal-artifact'?'#artifact/'+reference.id:'#plugin/'+reference.id} onClick={event=>{if(readSignal.aborted)event.preventDefault()}}>{reference.kind==='goal-artifact'?L('Open this file version','打开此文件版本'):L('Open current enabled view','打开当前启用的视图')}</a>
   <ArtifactReferenceDetails reference={reference} current={reference.kind==='goal-artifact'&&reference.availability==='unavailable'?'unavailable':'unchecked'} L={L}/>
  </article>)}
 </section>
}
