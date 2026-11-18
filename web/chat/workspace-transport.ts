/** Internal UI bridge over the existing configuration controller, not a workspace authority. */
export interface WorkspaceTransportContext {
 readonly state:'pending'|'ready'|'blocked'
 readonly code:string|null
 readonly managed:boolean
 readonly activeId:string
 readonly epoch:number
 readonly accountId:string|null
 /** Opaque page-session isolation only. This is not an authenticated session ID. */
 readonly sessionIsolation:string
}
export interface WorkspaceBinding {
 readonly context:WorkspaceTransportContext
 request<T>(path:string,body?:unknown,publicRead?:boolean,scope?:string,readSignal?:AbortSignal):Promise<T>
}
export interface WorkspaceTransport {
 /** Bind forms and actions to the context that supplied their data, before any send. */
 bind(expected:WorkspaceTransportContext):WorkspaceBinding
 context():WorkspaceTransportContext
 subscribe(listener:()=>void):()=>void
 ready():Promise<WorkspaceTransportContext>
 /** The legacy api's first four parameters remain unchanged. Signal applies to reads only. */
 request<T>(path:string,body?:unknown,publicRead?:boolean,scope?:string,readSignal?:AbortSignal):Promise<T>
}
export function workspaceBlockMessage(context:WorkspaceTransportContext,language:'en'|'zh-CN'){
 const messages:Record<string,[string,string]>={workspace_invalid:['This workspace link is invalid. Open a valid link.','此工作区链接无效，请打开有效链接。'],workspace_unsupported:['The current environment does not support the workspace in this link.','当前环境不支持链接指定的工作区。'],workspace_unavailable:['This workspace is unavailable for the current account.','当前账号无法访问此工作区。'],workspace_session_required:['Sign in before opening this workspace.','请先登录，再打开此工作区。'],workspace_session_ended:['Your session ended. Sign in again.','登录已结束，请重新登录。'],workspace_disconnected:['The workspace is disconnected. Connect again to continue.','工作区已断开，请重新连接。'],workspace_initialization_failed:['The workspace could not load. Try connecting again.','无法加载工作区，请重新连接。']}
 if(context.state==='pending')return language==='en'?'Loading workspace…':'正在加载工作区…'
 const message=messages[context.code??'']??messages.workspace_unavailable!
 return message[language==='en'?0:1]
}

/** Keep explicit selection semantics when navigating within configuration pages. */
export function preserveWorkspaceLink(target:URL,current:URL){
 const next=new URL(target.href)
 if(next.origin===current.origin&&['/configure','/configure/'].includes(next.pathname)&&!next.searchParams.has('workspace'))for(const value of current.searchParams.getAll('workspace'))next.searchParams.append('workspace',value)
 return next
}
