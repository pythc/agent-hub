import {expect,it,vi} from 'vitest'
import {readFileSync} from 'node:fs'
import {createContext,runInContext} from 'node:vm'
import ts from 'typescript'
import {scopedViewDestination,parseViewCommand,viewDestination,viewDocument} from '../web/chat/workspace-view-bridge.ts'
import type {WorkspaceTransportContext} from '../web/chat/workspace-transport.ts'

const view={id:'board',label:{en:'Scoped board','zh-CN':'工作区看板'},version:'1.0',digest:'a'.repeat(64),available:true,capabilities:['workspace.runtime.read']}
function fixture(component:'ScopedWorkspaceView'|'WorkspaceView'|'useWorkspaceViews'='ScopedWorkspaceView'){
 const slots:any[]=[],effects:number[]=[],calls:any[]=[],pending:any[]=[],ports:any[]=[],timers:any[]=[];let index=0,id='board'
 const owner=new AbortController(),rootFetch=vi.fn(()=>{throw Error('root fetch forbidden')}),push=vi.fn(),frameMessages:any[]=[]
 const workspace={context:{state:'ready',managed:true,activeId:'studio',epoch:1,accountId:'owner',sessionIsolation:'test',code:null},contextKey:'studio:1',readSignal:owner.signal,binding:{request(path:string,_body:any,_public:any,_scope:any,signal:AbortSignal){calls.push({path,url:'/workspaces/studio'+path,signal});return new Promise((resolve,reject)=>pending.push({resolve,reject}))}}}
 const react={useRef(value:any){const i=index++;if(!slots[i])slots[i]={kind:'ref',current:value};return slots[i]},useState(value:any){const i=index++;if(!slots[i])slots[i]={kind:'state',value:typeof value==='function'?value():value};return [slots[i].value,(next:any)=>{slots[i].value=typeof next==='function'?next(slots[i].value):next}]},useEffect(setup:any,deps:any[]){const i=index++,old=slots[i];if(!old||deps.some((v,n)=>!Object.is(v,old.deps[n]))){old?.cleanup?.();slots[i]={kind:'effect',setup,deps};effects.push(i)}}}
 const exports:any={}
 const context=createContext({exports,AbortController,AbortSignal,URLSearchParams,Date,Object,Promise,Event,crypto,fetch:rootFetch,matchMedia:()=>({matches:false,addEventListener(){},removeEventListener(){}}),document:{hidden:false,addEventListener(){},removeEventListener(){}},window:{addEventListener(){},removeEventListener(){},dispatchEvent(){}},history:{pushState:push},MessageChannel:class{port1:any;port2={};constructor(){this.port1={onmessage:null,postMessage:vi.fn(),close:vi.fn()};ports.push(this.port1)}},setInterval(fn:any){timers.push(fn);return timers.length},clearInterval(){},setTimeout(fn:any){timers.push(fn);return timers.length},clearTimeout(){},require(name:string){if(name==='react')return react;if(name==='react/jsx-runtime')return {jsx:(type:any,props:any,key:any)=>({type,props,key}),jsxs:(type:any,props:any,key:any)=>({type,props,key})};if(name==='./workspace-context.tsx')return {useWorkspaceTransport:()=>workspace};if(name==='./workspace-view-bridge.ts')return {scopedViewDestination,parseViewCommand,viewDestination,viewDocument};return {}}})
 runInContext(ts.transpileModule(readFileSync(new URL('../web/chat/workspace-view.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,context)
 const render=()=>{index=0;return component==='useWorkspaceViews'?exports.useWorkspaceViews(false):exports[component]({id,view,dark:false,language:'en',workspace})}
 const nodes=(tree:any):any[]=>!tree||typeof tree!=='object'?[]:[tree,...Object.values(tree.props??{}).flatMap(v=>Array.isArray(v)?v.flatMap(nodes):nodes(v))]
 return {workspace,owner,calls,pending,ports,rootFetch,push,timers,render,nodes,select(next:string){id=next},flush(){for(const i of effects.splice(0))slots[i].cleanup=slots[i].setup()},unmount(){for(const s of slots)if(s?.kind==='effect')s.cleanup?.()},boot(){const iframe=nodes(render()).find(n=>n.type==='iframe');iframe.props.ref.current={contentWindow:{postMessage:(...args:any[])=>frameMessages.push(args)}};iframe.props.onLoad()},click(label:string){nodes(render()).find(n=>n.type==='button'&&n.props.children===label).props.onClick()}}
}
const tick=()=>new Promise(resolve=>setImmediate(resolve))
it('loads only captured-workspace metadata, clears stale reads and retries failure without root fallback',async()=>{
 const p=fixture();p.render();p.flush();expect(p.calls[0].url).toBe('/workspaces/studio/api/workspace-views');const first=p.pending.shift();p.select('other');p.render();p.flush();expect(p.calls[0].signal.aborted).toBe(true);first.resolve({views:[view]});await tick();expect(JSON.stringify(p.render())).not.toContain('Scoped board')
 p.pending.shift().reject({status:403});await tick();expect(JSON.stringify(p.render())).toContain('unavailable');p.click('Try again');p.render();p.flush();p.pending.shift().resolve({views:[{...view,id:'other'}]});await tick();expect(JSON.stringify(p.render())).toContain('Scoped board');expect(p.rootFetch).not.toHaveBeenCalled();p.unmount()
})
it('keeps bundle, runtime and navigation revalidation scoped and destroys the frame on invalidation',async()=>{
 const p=fixture('WorkspaceView');p.render();p.flush();expect(p.calls[0].url).toBe('/workspaces/studio/api/workspace-views/board/bundle?digest='+view.digest);p.pending.shift().resolve({code:'document.body.textContent="scoped"'});await tick();p.boot();expect(p.calls.at(-1).url).toContain('/workspaces/studio/api/workspace-views/board/runtime?');p.pending.shift().resolve({tasks:[]});await tick()
 p.ports[0].onmessage({data:{type:'navigate',destination:'team'}});expect(p.calls.at(-1).url).toContain('/workspaces/studio/api/workspace-views/board/bundle?');p.pending.shift().resolve({code:''});await tick();expect(p.push).toHaveBeenCalledWith(null,'','/configure?workspace=studio#execution/configuration')
 p.ports[0].onmessage({data:{type:'navigate',destination:'conversation'}});p.pending.shift().resolve({code:''});await tick();expect(p.push).toHaveBeenCalledTimes(1)
 p.owner.abort();expect(p.ports[0].close).toHaveBeenCalled();expect(p.nodes(p.render()).some(n=>n.type==='iframe')).toBe(false);expect(p.rootFetch).not.toHaveBeenCalled();p.unmount()
})
it('does not render a late bundle after workspace invalidation or unmount',async()=>{
 for(const invalidation of ['abort','unmount']){const p=fixture('WorkspaceView');p.render();p.flush();const pending=p.pending.shift();if(invalidation==='abort')p.owner.abort();else p.unmount();pending.resolve({code:'SECRET'});await tick();expect(JSON.stringify(p.render())).not.toContain('SECRET');expect(p.calls[0].signal.aborted).toBe(true)}
})
it('permits only explicit workspace configuration destinations for managed frame navigation',()=>{
 const ctx={state:'ready',managed:true,activeId:'space /&',epoch:1,accountId:'owner',sessionIsolation:'x',code:null} as WorkspaceTransportContext
 expect(scopedViewDestination('tasks',ctx)).toBe('/configure?workspace=space%20%2F%26#tasks/history')
 for(const target of ['conversation','browser','https://evil','constructor'])expect(scopedViewDestination(target,ctx)).toBeUndefined()
 expect(scopedViewDestination('conversation',{...ctx,managed:false})).toBe('/chat')
 expect(scopedViewDestination('team',{...ctx,state:'blocked'})).toBeUndefined()
})

it('disables the legacy root catalog hook on scoped entry routes',()=>{
 const p=fixture('useWorkspaceViews');expect(p.render()).toEqual([]);p.flush();expect(p.rootFetch).not.toHaveBeenCalled();expect(p.timers).toEqual([]);p.unmount()
})
it('closes an already-rendered frame when scoped runtime access is revoked',async()=>{
 const p=fixture('WorkspaceView');p.render();p.flush();p.pending.shift().resolve({code:'document.body.textContent="view"'});await tick();p.boot();p.pending.shift().reject({status:403});await tick();expect(p.ports[0].close).toHaveBeenCalled();expect(p.nodes(p.render()).some(n=>n.type==='iframe')).toBe(false);expect(JSON.stringify(p.render())).toContain('unavailable');p.unmount()
})
