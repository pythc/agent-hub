import {useEffect,useState} from 'react'
import type {ArtifactCatalog} from '../../src/artifact-catalog.ts'
import {useWorkspaceTransport} from './workspace-context.tsx'
import {parseArtifactCatalog} from './artifact-catalog-model.ts'
import {ArtifactReferenceDetails} from './artifact-reference-details.tsx'
import './worker-templates.css'
export function ArtifactCatalogPage({language='en'}:{language?:'en'|'zh-CN'}){
 const {binding,contextKey,readSignal}=useWorkspaceTransport()
 const L=(en:string,zh:string)=>language==='en'?en:zh
 const [cursor,setCursor]=useState<string|null>(null),[history,setHistory]=useState<(string|null)[]>([])
 const [result,setResult]=useState<{contextKey:string;value:ArtifactCatalog}|null>(null),[error,setError]=useState(false),[loading,setLoading]=useState(true),[revision,setRevision]=useState(0)
 useEffect(()=>{
  const controller=new AbortController(),signal=AbortSignal.any([controller.signal,readSignal])
  setResult(null);setError(false);setLoading(true)
  void binding.request<unknown>('/artifact-catalog'+(cursor?'?cursor='+encodeURIComponent(cursor):''),undefined,false,undefined,signal).then(data=>{
   if(signal.aborted)return
   const value=parseArtifactCatalog(data)
   if(!value)throw Error('catalog_unavailable')
   setResult({contextKey,value});setLoading(false)
  }).catch(()=>{if(!signal.aborted){setResult(null);setError(true);setLoading(false)}})
  return()=>controller.abort()
 },[binding,contextKey,cursor,revision,readSignal])
 const value=!readSignal.aborted&&result?.contextKey===contextKey?result.value:null
 return <section className="templates-page" aria-label={L('Artifacts','产物目录')}>
  <header className="templates-heading"><div><h1>{L('Artifacts','产物目录')}</h1><p>{L('Task file versions and verified, enabled view packages visible to the current workspace operator. Conversation attachments stay in their own conversations.','当前工作区操作者可见的任务文件版本，以及已校验、已启用的视图包。会话附件仍保留在各自会话中。')}</p></div><button type="button" disabled={loading} onClick={()=>{setResult(null);setLoading(true);setHistory([]);setCursor(null);setRevision(n=>n+1)}}>{L('Refresh','刷新')}</button></header>
  <p>{L('Read-only metadata, not acceptance, sharing or publication. Opening an entry checks current access again. View packages are not historical runtime snapshots.','此目录仅展示元数据，不表示已验收、共享或发布。打开入口会重新检查当前权限。视图包不是历史运行快照。')}</p>
  {loading?<p role="status">{L('Loading artifact page…','正在读取产物页…')}</p>:error?<p role="alert">{L('Artifacts could not load in this workspace. Refresh to restart from the first page.','无法读取当前工作区的产物，请刷新并从第一页重新读取。')}</p>:null}
  {value?.truncated?<p role="status">{L('More entries may remain. Each page checks current access; this is not a snapshot.','可能还有后续条目。每页重新检查当前权限，此目录不是快照。')}</p>:null}
  {value&&!value.items.length?<p>{L('No visible artifacts on this page.','本页无可见产物。')}</p>:null}
  <nav aria-label={L('Artifact pages','产物分页')}><button type="button" disabled={loading||!history.length} onClick={()=>{setResult(null);setLoading(true);setCursor(history.at(-1)!);setHistory(history.slice(0,-1))}}>{L('Previous page','上一页')}</button><button type="button" disabled={loading||!value?.nextCursor} onClick={()=>{if(!value?.nextCursor)return;setResult(null);setLoading(true);setHistory([...history,cursor]);setCursor(value.nextCursor)}}>{L('Next page','下一页')}</button></nav>
  {value?.items.map(({reference,label,registrationState,previousVersions})=><article className="template-review" key={reference.kind+':'+reference.id}>
   <h2>{label[language]}</h2>
   <a href={reference.kind==='goal-artifact'?'#artifact/'+reference.id:'#artifact-view/'+reference.id} onClick={event=>{if(readSignal.aborted)event.preventDefault()}}>{reference.kind==='goal-artifact'?L('Open this file version','打开此文件版本'):L('Open current workspace view','打开当前工作区视图')}</a>
   {reference.kind==='workspace-view'?<p><a href={'#artifact-view-version/'+reference.id+'/'+reference.version} onClick={event=>{if(readSignal.aborted)event.preventDefault()}}>{L('Inspect this fixed version','查看此固定版本')}</a></p>:null}
   {reference.kind==='workspace-view'&&previousVersions?.length?<details><summary>{L('Previous version references','旧版本引用')}</summary><ul>{previousVersions.map(version=><li key={version.version}><a href={'#artifact-view-version/'+reference.id+'/'+version.version} onClick={event=>{if(readSignal.aborted)event.preventDefault()}}>{version.packageVersion} · {version.version.slice(0,12)}</a></li>)}</ul></details>:null}
   <ArtifactReferenceDetails reference={reference} registrationState={registrationState} current={reference.kind==='goal-artifact'&&reference.availability==='unavailable'?'unavailable':'unchecked'} L={L}/>
  </article>)}
 </section>
}
