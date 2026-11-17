import {createContext,useCallback,useContext,useEffect,useState,useSyncExternalStore,type ReactNode} from 'react'
import {workspaceBlockMessage,type WorkspaceBinding,type WorkspaceTransport,type WorkspaceTransportContext} from './workspace-transport.ts'

export interface WorkspacePageContext {
 readonly context:WorkspaceTransportContext
 /** Forms and actions must keep this binding from the page that supplied their data. */
 readonly binding:WorkspaceBinding
 /** A React lifetime key only; never authority or authenticated session proof. */
 readonly contextKey:string
 /** Pass as the fifth binding.request argument for reads. It does not cancel server actions. */
 readonly readSignal:AbortSignal
}
const PageContext=createContext<WorkspacePageContext|null>(null)
export function useWorkspaceTransport():WorkspacePageContext{
 const value=useContext(PageContext)
 if(!value)throw Error('workspace_owner_required')
 return value
}
/** Unambiguous identity serialization, derived exclusively from the C1 observation. */
export function workspaceContextKey(value:WorkspaceTransportContext){return JSON.stringify([value.managed,value.activeId,value.epoch,value.accountId,value.sessionIsolation])}
const loadDefaultTransport=async()=>{
 const {getConfigurationTransport}=await import('./configuration.tsx')
 return getConfigurationTransport()
}
function WorkspaceStatus({language,state,message}:{language:'en'|'zh-CN';state:'pending'|'blocked';message:string}){
 return <section role={state==='pending'?'status':'alert'} aria-live="polite" style={{margin:'auto',padding:24,maxWidth:520,fontSize:16,lineHeight:1.5,color:'var(--c-text)'}}>
  <p>{message}</p>{state==='blocked'?<button type="button" style={{fontSize:'inherit'}} onClick={()=>location.reload()}>{language==='en'?'Reload':'重新加载'}</button>:null}
 </section>
}
function ReadyWorkspace({transport,context,contextKey,language,children}:{transport:WorkspaceTransport;context:WorkspaceTransportContext;contextKey:string;language:'en'|'zh-CN';children:ReactNode}){
 const [lease,setLease]=useState<WorkspacePageContext|null>(null),[failed,setFailed]=useState(false)
 useEffect(()=>{
  // Create inside setup: StrictMode cleanup/setup must receive a fresh, live signal.
  const reads=new AbortController()
  try{setLease({context,binding:transport.bind(context),contextKey,readSignal:reads.signal});setFailed(false)}catch{reads.abort();setLease(null);setFailed(true)}
  return()=>reads.abort()
 },[transport,contextKey])
 if(!lease||lease.contextKey!==contextKey||lease.readSignal.aborted)return <WorkspaceStatus language={language} state={failed?'blocked':'pending'} message={language==='en'?(failed?'This workspace changed. Reload to continue.':'Loading workspace…'):(failed?'工作区已变化，请重新加载。':'正在加载工作区…')}/>
 return <PageContext.Provider value={lease}>{children}</PageContext.Provider>
}
function SubscribedWorkspace({transport,language,children}:{transport:WorkspaceTransport;language:'en'|'zh-CN';children:ReactNode}){
 const subscribe=useCallback((listener:()=>void)=>transport.subscribe(listener),[transport]),snapshot=useCallback(()=>transport.context(),[transport])
 const context=useSyncExternalStore(subscribe,snapshot,snapshot)
 if(context.state!=='ready')return <WorkspaceStatus language={language} state={context.state} message={workspaceBlockMessage(context,language)}/>
 const contextKey=workspaceContextKey(context)
 return <ReadyWorkspace key={contextKey} transport={transport} context={context} contextKey={contextKey} language={language}>{children}</ReadyWorkspace>
}
/**
 * Shared capability-page owner. Capability pages mount only after the existing
 * controller establishes a usable context, and keep its original binding.
 */
export function WorkspaceTransportOwner({language,children,loadTransport=loadDefaultTransport}:{language:'en'|'zh-CN';children:ReactNode;loadTransport?:()=>Promise<WorkspaceTransport>}){
 const [loaded,setLoaded]=useState<{source:()=>Promise<WorkspaceTransport>;transport:WorkspaceTransport}|null>(null),[failed,setFailed]=useState(false)
 useEffect(()=>{
  let alive=true;setLoaded(null);setFailed(false)
  void Promise.resolve().then(loadTransport).then(value=>{if(alive)setLoaded({source:loadTransport,transport:value})},()=>{if(alive)setFailed(true)})
  return()=>{alive=false}
 },[loadTransport])
 if(!loaded||loaded.source!==loadTransport)return <WorkspaceStatus language={language} state={failed?'blocked':'pending'} message={language==='en'?(failed?'The workspace could not load. Reload to try again.':'Loading workspace…'):(failed?'无法加载工作区，请重新加载。':'正在加载工作区…')}/>
 return <SubscribedWorkspace transport={loaded.transport} language={language}>{children}</SubscribedWorkspace>
}
