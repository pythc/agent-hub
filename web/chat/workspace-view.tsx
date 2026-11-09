import {useEffect,useRef,useState} from 'react'
import type {HostViewMessage,ViewCatalogItem,ViewQuery,ViewSnapshot} from '../../src/workspace-view-contract.ts'
import {parseViewCommand,viewDestination,viewDocument} from './workspace-view-bridge.ts'
import './workspace-view.css'

export function useWorkspaceViews(){
  const [views,setViews]=useState<ViewCatalogItem[]>([])
  useEffect(()=>{
    let alive=true,busy=false;const abort=new AbortController()
    const read=async()=>{
      if(busy||document.hidden)return
      busy=true
      try{const r=await fetch('/api/workspace-views',{signal:AbortSignal.any([abort.signal,AbortSignal.timeout(8000)])});if(r.ok){const data=await r.json();if(alive)setViews(data.views)}else if(r.status===401&&alive)setViews([])}catch{}finally{busy=false}
    }
    void read();const timer=setInterval(()=>void read(),30000)
    document.addEventListener('visibilitychange',read);window.addEventListener('roppo:plugins-changed',read)
    return()=>{alive=false;abort.abort();clearInterval(timer);document.removeEventListener('visibilitychange',read);window.removeEventListener('roppo:plugins-changed',read)}
  },[])
  return views
}
export function WorkspaceView({id,view,dark,language}:{id:string;view?:ViewCatalogItem;dark:boolean;language:'en'|'zh-CN'}){
  const frame=useRef<HTMLIFrameElement>(null),port=useRef<MessagePort|null>(null),[documentText,setDocumentText]=useState(''),[error,setError]=useState(false),[attempt,setAttempt]=useState(0)
  const environment=useRef({dark,language});environment.current={dark,language}
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
      const response=await fetch(base+path,{signal:AbortSignal.any([signal,lifetime.signal,AbortSignal.timeout(10000)])})
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
        if(alive&&version===revision){post({type:'snapshot',data});post({type:'connection',state:'live'})}
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
            history.pushState(null,'',viewDestination(command.destination));window.dispatchEvent(new Event('roppo:navigation'))
          }).catch(()=>{}).finally(()=>{navigating=false})
        }else{
          if(command.type==='query'){query=command.query;revision++;pending?.abort();post({type:'connection',state:'loading'})}
          void poll()
        }
      }
      frame.current.contentWindow.postMessage({type:'roppo:view:init',version:1},'*',[channel.port2])
      post({type:'environment',...environment.current});post({type:'connection',state:view.capabilities.includes('workspace.runtime.read')?'loading':'live'});void poll()
    }
    if(view?.available)void request('/bundle?digest='+view.digest).then(bundle=>{if(alive)setDocumentText(viewDocument(bundle.code,crypto.randomUUID()))}).catch(()=>{if(alive)setError(true)})
    else if(view)setError(true)
    const visibility=()=>{if(document.hidden){pending?.abort();clearTimeout(timer);post({type:'connection',state:'hidden'})}else void poll()}
    document.addEventListener('visibilitychange',visibility)
    // Catalog may still be loading. A directly requested missing view must eventually show a recoverable error.
    const missing=setTimeout(()=>{if(!view&&alive)setError(true)},10000)
    return()=>{alive=false;lifetime.abort();pending?.abort();clearTimeout(timer);clearTimeout(missing);port.current?.close();port.current=null;boot.current=()=>{};document.removeEventListener('visibilitychange',visibility)}
  },[id,view?.digest,view?.available,attempt])
  useEffect(()=>{port.current?.postMessage({type:'environment',dark,language})},[dark,language])
  return <section className="workspace-view-outlet" aria-label={view?.label[language]??id}>
    {error?<div className="workspace-view-placeholder" role="alert"><p>{language==='en'?'This workspace view is unavailable. Check its installation and permissions.':'此看板暂不可用，请检查插件安装及权限。'}</p><button onClick={()=>setAttempt(n=>n+1)}>{language==='en'?'Try again':'重试'}</button></div>:documentText?<iframe ref={frame} title={view?.label[language]??id} sandbox="allow-scripts" referrerPolicy="no-referrer" srcDoc={documentText} onLoad={()=>boot.current()}/>:<div className="workspace-view-placeholder" role="status">{language==='en'?'Loading workspace view…':'正在加载看板…'}</div>}
  </section>
}
