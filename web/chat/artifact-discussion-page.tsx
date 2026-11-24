import {useEffect,useRef,useState,type FormEvent} from 'react'
import type {ArtifactDiscussionAppend} from '../../src/artifact-discussion.ts'
import {useWorkspaceTransport} from './workspace-context.tsx'
import './worker-templates.css'

type Selection=NonNullable<ArtifactDiscussionAppend['selection']>
type Entry=Omit<ArtifactDiscussionAppend,'sourceSnapshot'|'operationId'>&{id:string;at:number}
type Discussion={source:{kind:string;id:string;version:number|string;digest:string};sourceSnapshot:string;entries:Entry[];limit:number}
const safeDigest=/^[a-f0-9]{64}$/
const pathSyntax=/^(?:file\/[a-f0-9]{64}\/[1-9][0-9]{0,14}\/[a-f0-9]{64}|view\/[a-z][a-z0-9_-]{0,63}\/[a-f0-9]{64}|attachment\/(?:[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\/){2}[a-f0-9]{64})$/
const validPosition=(n:unknown):n is number=>typeof n==='number'&&Number.isInteger(n)&&n>=1&&n<=1_000_000
function validSelection(s:Selection|undefined){
 return s===undefined||!!s&&(s.kind==='page'?validPosition(s.page):s.kind==='lines'&&validPosition(s.start)&&validPosition(s.end)&&s.start<=s.end)
}
function parse(value:unknown,path:string){
 const d=value as Discussion,source=d?.source,parts=path.split('/')
 if(!source||!safeDigest.test(d.sourceSnapshot)||!safeDigest.test(source.digest)||!Array.isArray(d.entries)||d.limit!==100||d.entries.length>d.limit)throw Error('invalid_discussion')
 const pinned=parts[0]==='file'?source.kind==='goal-artifact'&&source.id===parts[1]&&source.version===Number(parts[2])&&source.digest===parts[3]:
  parts[0]==='view'?source.kind==='workspace-view'&&source.id===parts[1]&&source.version===parts[2]:
  source.kind==='chat-attachment'&&safeDigest.test(source.id)&&source.version===1&&source.digest===parts[3]
 if(!pinned||d.entries.some(e=>!e||typeof e.id!=='string'||typeof e.at!=='number'||!Number.isSafeInteger(e.at)||e.at<0||e.at>8.64e15||typeof e.text!=='string'||e.text.length>4000||!['comment','proposed-change'].includes(e.kind)||
   !validSelection(e.selection)))throw Error('invalid_discussion')
 return d
}
const discussionLabels={'comment':['Comment','评论'],'proposed-change':['Proposed change','修改建议']} as const
type Localize=(en:string,zh:string)=>string

function VersionNotes({entries,language,L}:{entries:Entry[];language:'en'|'zh-CN';L:Localize}){
 const [filter,setFilter]=useState<'all'|Entry['kind']>('all')
 const [location,setLocation]=useState<'all'|'whole'|Selection['kind']>('all')
 const shown=entries.filter(entry=>(filter==='all'||entry.kind===filter)&&(location==='all'||(entry.selection?.kind??'whole')===location))
 const selectionLabel=(s:Selection|undefined)=>!s?L('Whole version','整个版本'):s.kind==='page'?L('Page ','第 ')+s.page+(language==='en'?'':' 页'):L('Lines ','行 ')+s.start+'–'+s.end
 if(!entries.length)return <p>{L('No notes yet.','还没有备注。')}</p>
 return <>
  <fieldset>
   <legend>{L('Filter notes on this version','筛选当前版本的备注')}</legend>
   <label>{L('Note type','备注类型')} <select value={filter} onChange={event=>setFilter(event.target.value as typeof filter)}>
    <option value="all">{L('All types','全部类型')}</option><option value="comment">{L('Comments','评论')}</option><option value="proposed-change">{L('Proposed changes','修改建议')}</option>
   </select></label>{' '}
   <label>{L('Note location','备注位置')} <select value={location} onChange={event=>setLocation(event.target.value as typeof location)}>
    <option value="all">{L('All locations','全部位置')}</option><option value="whole">{L('Whole version','整个版本')}</option><option value="page">{L('Page','页')}</option><option value="lines">{L('Line range','行范围')}</option>
   </select></label>
  </fieldset>
  {!shown.length?<p role="status">{L('No notes match these filters.','没有符合筛选条件的备注。')}</p>:<ol>{shown.map(e=><li key={e.id}>
   <strong>{L(discussionLabels[e.kind][0],discussionLabels[e.kind][1])}</strong>{' · '}{selectionLabel(e.selection)}
   <time dateTime={new Date(e.at).toISOString()}> · {new Date(e.at).toLocaleString(language)}</time>
   <p style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{e.text}</p>
  </li>)}</ol>}
 </>
}

export function ArtifactDiscussionPage({path,language='en'}:{path:string;language?:'en'|'zh-CN'}){
 const {binding,contextKey,readSignal}=useWorkspaceTransport()
 const L=(en:string,zh:string)=>language==='en'?en:zh
 const [result,setResult]=useState<{key:string;signal:AbortSignal;value:Discussion}|null>(null),[status,setStatus]=useState<'loading'|'ready'|'unavailable'|'uncertain'>('loading')
 const [revision,setRevision]=useState(0),[busy,setBusy]=useState(false),[invalid,setInvalid]=useState(false)
 const [text,setText]=useState(''),[kind,setKind]=useState<Entry['kind']>('comment')
 const [location,setLocation]=useState<'whole'|'page'|'lines'>('whole'),[start,setStart]=useState(''),[end,setEnd]=useState('')
 const operation=useRef<{bodyKey:string;id:string}|null>(null),inFlight=useRef(false),live=useRef(false),requestEpoch=useRef(0)
 const key=JSON.stringify([contextKey,path]),url='/api/artifact-discussions/'+path
 useEffect(()=>{live.current=true;return()=>{live.current=false}},[])
 useEffect(()=>{
  const refresh=()=>{if(!inFlight.current)setRevision(n=>n+1)}
  window.addEventListener('focus',refresh)
  return()=>window.removeEventListener('focus',refresh)
 },[])
 useEffect(()=>{
  const controller=new AbortController(),signal=AbortSignal.any([readSignal,controller.signal]),epoch=++requestEpoch.current
  setResult(null);setStatus('loading')
  if(!pathSyntax.test(path)){setStatus('unavailable');return()=>controller.abort()}
  void binding.request<unknown>(url,undefined,false,undefined,signal).then(data=>{
   if(signal.aborted||epoch!==requestEpoch.current)return
   const value=parse(data,path);setResult({key,signal:readSignal,value});setStatus('ready')
  }).catch(()=>{if(!signal.aborted&&epoch===requestEpoch.current){setResult(null);setStatus('unavailable')}})
  return()=>controller.abort()
 },[binding,key,path,readSignal,revision,url])
 const discussion=!readSignal.aborted&&result?.key===key&&result.signal===readSignal?result.value:null
 const pathParts=path.split('/')
 const back=pathSyntax.test(path)?pathParts[0]==='file'?'#artifact/'+pathParts[1]:pathParts[0]==='view'?'#artifact-view-version/'+pathParts.slice(1).join('/'):'/chat':'#artifacts'
 const pathLabel=pathParts[0]==='attachment'?L('Back to conversations','返回会话'):L('Back to version','返回版本')
 function selection():Selection|undefined|null {
  if(location==='whole')return undefined
  const a=Number(start),b=Number(end)
  if(!validPosition(a)||location==='lines'&&(!validPosition(b)||a>b))return null
  return location==='page'?{kind:'page',page:a}:{kind:'lines',start:a,end:b}
 }
 async function append(event:FormEvent<HTMLFormElement>){
  event.preventDefault()
  if(!discussion||inFlight.current||readSignal.aborted||!text.trim())return
  const cursor=selection()
  if(cursor===null){setInvalid(true);return}
  const request={sourceSnapshot:discussion.sourceSnapshot,kind,text:text.trim(),...(cursor?{selection:cursor}:{})}
  const bodyKey=JSON.stringify(request)
  const previous=operation.current,op=previous?.bodyKey===bodyKey?previous:{bodyKey,id:crypto.randomUUID()}
  operation.current=op
  inFlight.current=true;requestEpoch.current++;setBusy(true);setInvalid(false)
  try{
   const value=parse(await binding.request<unknown>(url,{...request,operationId:op.id}),path)
   if(live.current&&!readSignal.aborted){setResult({key,signal:readSignal,value});setStatus('ready');setText('');operation.current=null}
  }catch{
   // Drop all earlier results; neither a cached source nor an ambiguous write is proof of access.
   if(live.current&&!readSignal.aborted){setResult(null);setStatus('uncertain')}
  }finally{inFlight.current=false;if(live.current&&!readSignal.aborted)setBusy(false)}
 }
 return <section className="templates-page" aria-label={L('Version discussion','版本讨论')}>
  <header className="templates-heading"><h1>{L('Version discussion','版本讨论')}</h1><button type="button" disabled={busy||status==='loading'} onClick={()=>setRevision(n=>n+1)}>{L('Refresh','刷新')}</button></header>
  <a href={back}>{pathLabel}</a>
  <p>{L('Notes stay on this fixed version and are visible only to this account. Posting does not edit, publish or send the artifact.','备注只关联这个固定版本，且仅当前账号可见。提交不会修改、发布或发送产物。')}</p>
  {status==='loading'?<p role="status">{L('Loading discussion…','正在读取讨论…')}</p>:status==='uncertain'?<p role="alert">{L('Could not confirm the save. Refresh to check. If you retry without editing, the same request is reused.','无法确认是否保存。请刷新后核对，不修改内容直接重试会沿用同一请求。')}</p>:status==='unavailable'?<p role="alert">{L('This version or discussion is unavailable in this workspace.','此版本或讨论在当前工作区不可用。')}</p>:null}
  {discussion&&<article className="template-review">
   <p>{L('Source version','来源版本')}: <code style={{overflowWrap:'anywhere'}}>{discussion.source.version}</code></p>
   <VersionNotes key={JSON.stringify([key,discussion.sourceSnapshot])} entries={discussion.entries} language={language} L={L}/>
   {discussion.entries.length===discussion.limit?<p role="status">{L('This version has reached its note limit.','此版本已达到备注上限。')}</p>:
    <form onSubmit={event=>void append(event)}>
     <fieldset disabled={busy}>
      <legend>{L('Add a note','添加备注')}</legend>
      <label>{L('Type','类型')} <select value={kind} onChange={event=>setKind(event.target.value as Entry['kind'])}><option value="comment">{L('Comment','评论')}</option><option value="proposed-change">{L('Proposed change','修改建议')}</option></select></label>{' '}
      <label>{L('Selection','位置')} <select value={location} onChange={event=>{setLocation(event.target.value as typeof location);setInvalid(false)}}><option value="whole">{L('Whole version','整个版本')}</option><option value="page">{L('Page','页')}</option><option value="lines">{L('Line range','行范围')}</option></select></label>
      {location!=='whole'&&<p><label>{location==='page'?L('Page number','页码'):L('First line','起始行')} <input required type="number" min={1} max={1_000_000} value={start} onChange={e=>{setStart(e.target.value);setInvalid(false)}}/></label>{' '}
       {location==='lines'&&<label>{L('Last line','结束行')} <input required type="number" min={1} max={1_000_000} value={end} onChange={e=>{setEnd(e.target.value);setInvalid(false)}}/></label>}</p>}
      {invalid&&<p role="alert">{L('Use a valid page or line range.','请输入有效的页码或行范围。')}</p>}
      <p><label>{L('Note','备注')} <textarea required rows={3} maxLength={4000} value={text} onChange={e=>setText(e.target.value)} style={{display:'block',width:'100%',boxSizing:'border-box'}}/></label></p>
      <button type="submit" disabled={!text.trim()}>{busy?L('Saving…','正在保存…'):L('Save note','保存备注')}</button>
     </fieldset>
    </form>}
  </article>}
 </section>
}
