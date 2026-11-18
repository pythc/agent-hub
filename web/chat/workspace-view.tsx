import {useWorkspaceTransport,type WorkspacePageContext} from './workspace-context.tsx'
import {ArtifactReferenceDetails} from './artifact-reference-details.tsx'
import {useEffect,useRef,useState} from 'react'
import type {HostViewMessage,ViewCatalogItem,ViewQuery,ViewSnapshot} from '../../src/workspace-view-contract.ts'
import {parseViewCommand,viewDestination,scopedViewDestination,viewDocument} from './workspace-view-bridge.ts'
import './workspace-view.css'

export function useWorkspaceViews(enabled=true){
  const [views,setViews]=useState<ViewCatalogItem[]>([])
  useEffect(()=>{
    if(!enabled){setViews([]);return}
    let alive=true,busy=false;const abort=new AbortController()
    const read=async()=>{
      if(busy||document.hidden)return
      busy=true
      try{const r=await fetch('/api/workspace-views',{signal:AbortSignal.any([abort.signal,AbortSignal.timeout(8000)])});if(r.ok){const data=await r.json();if(alive)setViews(data.views)}else if(r.status===401&&alive)setViews([])}catch{}finally{busy=false}
    }
    void read();const timer=setInterval(()=>void read(),30000)
    document.addEventListener('visibilitychange',read);window.addEventListener('roppo:plugins-changed',read)
    return()=>{alive=false;abort.abort();clearInterval(timer);document.removeEventListener('visibilitychange',read);window.removeEventListener('roppo:plugins-changed',read)}
  },[enabled])
  return enabled?views:[]
}
export function WorkspaceView({id,view,dark,language,workspace}:{id:string;view?:ViewCatalogItem;dark:boolean;workspace?:WorkspacePageContext;language:'en'|'zh-CN'}){
  const frame=useRef<HTMLIFrameElement>(null),port=useRef<MessagePort|null>(null),[documentText,setDocumentText]=useState(''),[error,setError]=useState(false),[attempt,setAttempt]=useState(0)
  const [compactTypography,setCompactTypography]=useState(()=>matchMedia('(max-width: 800px)').matches)
  const environment=useRef({dark,language,compactTypography});environment.current={dark,language,compactTypography}
  useEffect(()=>{
    const media=matchMedia('(max-width: 800px)'),change=()=>setCompactTypography(media.matches)
    change();media.addEventListener('change',change)
    return()=>media.removeEventListener('change',change)
  },[])
  const boot=useRef<()=>void>(()=>{})
  useEffect(()=>{
    let alive=true,busy=false,queued=false,navigating=false,revision=0,lastRefresh=0
    let query:ViewQuery={},pending:AbortController|undefined,timer:ReturnType<typeof setTimeout>|undefined
    const lifetime=new AbortController()
    setDocumentText('');setError(false)
    const post=(message:HostViewMessage)=>port.current?.postMessage(message)
    const fatal=()=>{if(!alive)return;setError(true);setDocumentText('');port.current?.close();port.current=null;clearTimeout(timer);lifetime.abort()}
    const base='/api/workspace-views/'+encodeURIComponent(id)
    const request=async(path:string,signal=lifetime.signal)=>{
      const combined=AbortSignal.any([signal,lifetime.signal,...(workspace?[workspace.readSignal]:[]),AbortSignal.timeout(10000)])
      if(combined.aborted)throw Error('Unavailable')
      if(workspace){
        try{return await workspace.binding.request(base+path,undefined,false,undefined,combined)}
        catch(error){if([401,403,404,409].includes((error as {status?:number}).status??0))fatal();throw error}
      }
      const response=await fetch(base+path,{signal:combined})
      if([401,403,404].includes(response.status)){fatal();throw Error('Unavailable')}
      if(!response.ok)throw Error('Request failed')
      return response.json()
    }
    const poll=async()=>{
      clearTimeout(timer)
      if(!alive||lifetime.signal.aborted||document.hidden||!port.current||!view?.capabilities.includes('workspace.runtime.read'))return
      if(busy){queued=true;return}
      busy=true;queued=false;const version=revision;pending=new AbortController()
      try{
        const params=new URLSearchParams({digest:view!.digest,...Object.fromEntries(Object.entries(query).filter(([,v])=>v!==undefined).map(([k,v])=>[k,String(v)]))})
        const data=await request('/runtime?'+params,pending.signal) as ViewSnapshot
        if(alive&&!lifetime.signal.aborted&&version===revision){post({type:'snapshot',data});post({type:'connection',state:'live'})}
      }catch{if(alive&&!lifetime.signal.aborted&&version===revision&&!document.hidden)post({type:'connection',state:'stale'})}
      finally{busy=false;if(alive&&!lifetime.signal.aborted)timer=setTimeout(()=>void poll(),queued?0:5000)}
    }
    boot.current=()=>{
      if(!alive||lifetime.signal.aborted||!view||!frame.current?.contentWindow)return
      port.current?.close();const channel=new MessageChannel();port.current=channel.port1
      channel.port1.onmessage=event=>{
        if(!alive||lifetime.signal.aborted||document.hidden)return
        const command=parseViewCommand(event.data);if(!command)return
        if(command.type==='refresh'){const now=Date.now();if(now-lastRefresh<300)return;lastRefresh=now}
        if(command.type==='navigate'){
          if(navigating)return
          navigating=true
          // Revalidate a still-enabled pinned package before any frame-requested host navigation.
          void request('/bundle?digest='+view.digest).then(()=>{
            if(!alive||lifetime.signal.aborted)return
            const target=workspace?scopedViewDestination(command.destination,workspace.context):viewDestination(command.destination)
            if(!target)return
            history.pushState(null,'',target);window.dispatchEvent(new Event('roppo:navigation'))
          }).catch(()=>{}).finally(()=>{navigating=false})
        }else{
          if(command.type==='query'){query=command.query;revision++;pending?.abort();post({type:'connection',state:'loading'})}
          void poll()
        }
      }
      frame.current.contentWindow.postMessage({type:'roppo:view:init',version:1},'*',[channel.port2])
      post({type:'environment',...environment.current});post({type:'connection',state:view.capabilities.includes('workspace.runtime.read')?'loading':'live'});void poll()
    }
    const invalidated=()=>fatal()
    workspace?.readSignal.addEventListener('abort',invalidated,{once:true})
    if(workspace?.readSignal.aborted)fatal()
    if(!lifetime.signal.aborted&&view?.available)void request('/bundle?digest='+view.digest).then(bundle=>{if(alive&&!lifetime.signal.aborted)setDocumentText(viewDocument(bundle.code,crypto.randomUUID()))}).catch(()=>{if(alive&&!lifetime.signal.aborted)setError(true)})
    else if(view)setError(true)
    const visibility=()=>{if(document.hidden){pending?.abort();clearTimeout(timer);post({type:'connection',state:'hidden'})}else void poll()}
    document.addEventListener('visibilitychange',visibility)
    // Catalog may still be loading. A directly requested missing view must eventually show a recoverable error.
    const missing=setTimeout(()=>{if(!view&&alive)setError(true)},10000)
    return()=>{alive=false;lifetime.abort();pending?.abort();clearTimeout(timer);clearTimeout(missing);port.current?.close();port.current=null;boot.current=()=>{};document.removeEventListener('visibilitychange',visibility);workspace?.readSignal.removeEventListener('abort',invalidated)}
  },[id,view?.digest,view?.available,attempt,workspace?.binding,workspace?.contextKey,workspace?.readSignal])
  useEffect(()=>{port.current?.postMessage({type:'environment',dark,language,compactTypography})},[dark,language,compactTypography])
  return <section className="workspace-view-outlet" aria-label={view?.label[language]??id}>
    <ArtifactReferenceDetails reference={view?.reference} current={error?'unavailable':documentText?'available':'unchecked'} L={(en,zh)=>language==='en'?en:zh}/>
    {error?<div className="workspace-view-placeholder" role="alert"><p>{language==='en'?'This workspace view is unavailable. Check its installation and permissions.':'此看板暂不可用，请检查插件安装及权限。'}</p><button onClick={()=>setAttempt(n=>n+1)}>{language==='en'?'Try again':'重试'}</button></div>:documentText?<iframe ref={frame} title={view?.label[language]??id} sandbox="allow-scripts" referrerPolicy="no-referrer" srcDoc={documentText} onLoad={()=>boot.current()}/>:<div className="workspace-view-placeholder" role="status">{language==='en'?'Loading workspace view…':'正在加载看板…'}</div>}
  </section>
}


/** Catalog-only entry: all reads remain under the original workspace lease, with no root fallback. */
export function ScopedWorkspaceView({id,dark,language}:{id:string;dark:boolean;language:'en'|'zh-CN'}){
 const workspace=useWorkspaceTransport(),{binding,contextKey,readSignal}=workspace
 const [result,setResult]=useState<{id:string;contextKey:string;view:ViewCatalogItem}|null>(null),[failed,setFailed]=useState(false),[revision,setRevision]=useState(0)
 useEffect(()=>{
  const controller=new AbortController(),signal=AbortSignal.any([controller.signal,readSignal]);let busy=false
  setResult(null);setFailed(false)
  const read=async()=>{
   if(busy||signal.aborted)return
   if(!/^[a-z][a-z0-9_-]{0,63}$/.test(id)){setFailed(true);return}
   busy=true
   try{
    const data=await binding.request<{views:ViewCatalogItem[]}>('/api/workspace-views',undefined,false,undefined,signal)
    if(signal.aborted)return
    const view=Array.isArray(data?.views)?data.views.find(v=>v.id===id):undefined
    if(!view||typeof view.available!=='boolean'||!/^[a-f0-9]{64}$/.test(view.digest)||!Array.isArray(view.capabilities)||view.capabilities.some(c=>c!=='workspace.runtime.read')||typeof view.label?.en!=='string'||typeof view.label?.['zh-CN']!=='string')throw Error('view_unavailable')
    setResult({id,contextKey,view});setFailed(false)
   }catch{if(!signal.aborted){setResult(null);setFailed(true)}}finally{busy=false}
  }
  void read();const timer=setInterval(()=>void read(),30000)
  window.addEventListener('roppo:plugins-changed',read)
  return()=>{controller.abort();clearInterval(timer);window.removeEventListener('roppo:plugins-changed',read)}
 },[binding,contextKey,readSignal,id,revision])
 const view=!readSignal.aborted&&result?.id===id&&result.contextKey===contextKey?result.view:null
 return <section className="scoped-workspace-view" aria-label={language==='en'?'Workspace view':'工作区视图'}>
  <p>{language==='en'?'This opens the currently enabled package in the selected workspace, not a historical snapshot.':'此入口打开所选工作区当前启用的视图包，并非历史快照。'}</p>
  {workspace.context.managed?<p>{language==='en'?'View navigation is limited to this workspace’s configuration pages; conversation/browser destinations are unavailable here.':'视图导航仅限此工作区的配置页，此处不支持跳转至对话或浏览器。'}</p>:null}
  {failed?<div role="alert"><p>{language==='en'?'This view is unavailable in this workspace.':'当前工作区无法打开此视图。'}</p><button type="button" onClick={()=>{setResult(null);setFailed(false);setRevision(n=>n+1)}}>{language==='en'?'Try again':'重试'}</button></div>:view?<WorkspaceView key={contextKey+':'+id} id={id} view={view} dark={dark} language={language} workspace={workspace}/>:<p role="status">{language==='en'?'Loading workspace view…':'正在读取工作区视图…'}</p>}
 </section>
}
