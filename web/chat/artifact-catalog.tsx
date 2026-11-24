import {useEffect,useState} from 'react'
import type {ArtifactCatalog} from '../../src/artifact-catalog.ts'
import type {GoalArtifacts} from '../../src/goal-artifacts.ts'
import type {ArtifactReference} from '../../src/artifact-reference.ts'
import {useWorkspaceTransport} from './workspace-context.tsx'
import {parseArtifactCatalog} from './artifact-catalog-model.ts'
import {ArtifactReferenceDetails} from './artifact-reference-details.tsx'
import './worker-templates.css'
type CleanupImpact=ReturnType<GoalArtifacts['cleanupImpact']>
type Localize=(en:string,zh:string)=>string

function parseCleanupImpact(value:unknown,ref:ArtifactReference):CleanupImpact|null{
 const p=value as CleanupImpact
 if(!p||p.schema!==1||p.artifactId!==ref.id||p.version!==ref.version||typeof p.retained!=='boolean'||
   p.card!=='not_supported'||p.linkRevocation!=='not_tracked'||p.recovery!=='not_supported'||
   p.thirdPartyCopies!=='outside_management'||p.mutationAvailable!==false||!p.series||
   typeof p.series.truncated!=='boolean'||!Number.isInteger(p.series.versions)||
   p.series.versions<0||p.series.versions>200||!Number.isInteger(p.series.retainedVersions)||
   p.series.retainedVersions<0||p.series.retainedVersions>p.series.versions)return null
 return p
}

function CleanupImpactPanel({reference,L}:{reference:ArtifactReference;L:Localize}){
 const {binding,contextKey,readSignal}=useWorkspaceTransport()
 const [open,setOpen]=useState(false),[result,setResult]=useState<CleanupImpact|null>(null),[error,setError]=useState(false)
 const {id,version}=reference
 useEffect(()=>{
  if(!open)return
  const controller=new AbortController(),signal=AbortSignal.any([controller.signal,readSignal])
  setError(false);setResult(null)
  void binding.request<unknown>('/goal-artifact-versions/'+encodeURIComponent(id)+'/cleanup-impact',undefined,false,undefined,signal).then(data=>{
   if(signal.aborted)return
   const impact=parseCleanupImpact(data,reference)
   if(!impact)throw Error('cleanup_impact_unavailable')
   setResult(impact)
  }).catch(()=>{if(!signal.aborted)setError(true)})
  return()=>controller.abort()
 },[binding,contextKey,id,version,open,readSignal])
 return <div>
  <button type="button" aria-expanded={open} disabled={readSignal.aborted} onClick={()=>{setResult(null);setError(false);setOpen(v=>!v)}}>{open?L('Hide cleanup impact','收起清理影响'):L('Preview cleanup impact','预览清理影响')}</button>
  {open&&!readSignal.aborted?<section aria-label={L('Cleanup impact','清理影响')}>
   <p>{L('Read-only preview. This does not delete anything or revoke any link.','仅预览，不会删除内容或撤回链接。')}</p>
   {error?<p role="status">{L('Preview unavailable for this version. Refresh to try again.','此版本暂不能预览，请刷新重试。')}</p>:result?<>
    <dl>
     <dt>{L('Clear local contents of this version','清理此版本的本地内容')}</dt>
     <dd>{result.retained?L('One local file version has contents that could be affected.','这一个版本仍有本地文件内容，清理可能影响它。'):L('This version has no retained local contents to clear.','此版本没有保留可清理的本地内容。')}{' '}{L('Other versions are outside this scope.','范围不包含其他版本。')}</dd>
     <dt>{L('Clear all retained local versions of this output','清理此产物保留的全部本地版本')}</dt>
     <dd>{result.series.truncated?L(`Partial scan: ${result.series.retainedVersions} of ${result.series.versions} visible sampled versions have local contents. The full count is unknown.`,`仅扫描部分记录：抽查到的 ${result.series.versions} 个可见版本中，${result.series.retainedVersions} 个保留本地内容；总数未知。`):L(`${result.series.retainedVersions} of ${result.series.versions} visible versions have local contents at the time of this preview.`,`预览时可见的 ${result.series.versions} 个版本中，${result.series.retainedVersions} 个保留本地内容。`)}</dd>
     <dt>{L('Remove the card','移除卡片')}</dt>
     <dd>{L('Card removal is not available as a separate action here. It is not the same as clearing local file versions.','这里不支持单独移除卡片。移除卡片和清理本地文件版本是不同的操作。')}</dd>
     <dt>{L('Revoke an external link','撤回外部链接')}</dt>
     <dd>{L('This preview does not track external links, so their existence and revocation status are unknown. Clearing local versions does not verify revocation.','此预览不跟踪外部链接，因此无法确认链接是否存在或已撤回；清理本地版本不等于确认链接已撤回。')}</dd>
    </dl>
    <p>{L('Downloaded copies, caches and third-party copies are outside this preview’s control. It cannot verify whether any of them are still available. No per-artifact recovery window is available.','已下载的文件、缓存和第三方副本不受此预览控制，也无法确认它们是否仍可访问。这里未提供单个产物的恢复期限。')}</p>
   </>:<p role="status">{L('Reading cleanup impact…','正在读取清理影响…')}</p>}
  </section>:null}
 </div>
}

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
  {value?.items.map(({reference,label})=><article className="template-review" key={reference.kind+':'+reference.id}>
   <h2>{label[language]}</h2>
   <a href={reference.kind==='goal-artifact'?'#artifact/'+reference.id:'#artifact-view/'+reference.id} onClick={event=>{if(readSignal.aborted)event.preventDefault()}}>{reference.kind==='goal-artifact'?L('Open this file version','打开此文件版本'):L('Open current workspace view','打开当前工作区视图')}</a>
   {reference.kind==='workspace-view'?<p><a href={'#artifact-view-version/'+reference.id+'/'+reference.version} onClick={event=>{if(readSignal.aborted)event.preventDefault()}}>{L('Inspect this fixed version','查看此固定版本')}</a></p>:null}
   {reference.kind==='goal-artifact'?<CleanupImpactPanel key={contextKey+':'+reference.id+':'+reference.version} reference={reference} L={L}/>:null}
   <ArtifactReferenceDetails reference={reference} current={reference.kind==='goal-artifact'&&reference.availability==='unavailable'?'unavailable':'unchecked'} L={L}/>
  </article>)}
 </section>
}
