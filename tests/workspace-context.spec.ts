import {readFileSync} from 'node:fs'
import {createContext,runInContext} from 'node:vm'
import ts from 'typescript'
import {expect,it,vi} from 'vitest'
import {workspaceBlockMessage,type WorkspaceTransport,type WorkspaceTransportContext} from '../web/chat/workspace-transport.ts'

const initial:WorkspaceTransportContext={state:'ready',code:null,managed:false,activeId:'',epoch:1,accountId:null,sessionIsolation:'page-session'}
function bridge(snapshot:WorkspaceTransportContext=initial){
 let current=Object.freeze({...snapshot});const listeners=new Set<()=>void>(),fetch=vi.fn(async()=>({ok:true}))
 const same=(a:WorkspaceTransportContext,b:WorkspaceTransportContext)=>a.state==='ready'&&b.state==='ready'&&JSON.stringify([a.managed,a.activeId,a.epoch,a.accountId,a.sessionIsolation])===JSON.stringify([b.managed,b.activeId,b.epoch,b.accountId,b.sessionIsolation])
 const transport:WorkspaceTransport={context:()=>current,subscribe(fn){listeners.add(fn);return()=>{listeners.delete(fn)}},ready:async()=>current,request:async()=>{throw Error('unbound_request_forbidden')},bind:vi.fn(expected=>{if(!same(current,expected))throw Error('workspace_obsolete');return {context:expected,async request(){if(!same(current,expected))throw Error('workspace_obsolete');return await fetch() as any}}})}
 return {transport,fetch,commit(next:Partial<WorkspaceTransportContext>){current=Object.freeze({...current,...next});listeners.forEach(fn=>fn())},listeners}
}
/** Executes the real component's effect setup/cleanup in isolation, including StrictMode replay.
 * This hook lifecycle harness is not a browser or real multiworkspace-server claim. */
function componentHarness(){
 const slots:any[]=[],pending:number[]=[];let cursor=0
 const equal=(a:any[],b:any[])=>a.length===b.length&&a.every((v,i)=>Object.is(v,b[i]))
 const hooks:any={
  createContext:(value:any)=>({Provider:'Provider',value}),useContext:(ctx:any)=>ctx.value,
  useState:(init:any)=>{const i=cursor++;if(!slots[i])slots[i]={kind:'state',value:typeof init==='function'?init():init};return [slots[i].value,(value:any)=>{slots[i].value=typeof value==='function'?value(slots[i].value):value}]},
  useEffect:(setup:any,deps:any[])=>{const i=cursor++,old=slots[i];if(!old||!equal(old.deps,deps)){old?.cleanup?.();slots[i]={kind:'effect',setup,deps};pending.push(i)}},
  useCallback:(fn:any,deps:any[])=>{const i=cursor++,old=slots[i];if(!old||!equal(old.deps,deps))slots[i]={kind:'callback',value:fn,deps};return slots[i].value},
  useSyncExternalStore:(subscribe:any,get:any)=>{hooks.useEffect(()=>subscribe(()=>{}),[subscribe]);return get()},
 }
 const exports:any={},reload=vi.fn(),context=createContext({exports,AbortController,Promise,JSON,Object,location:{reload},require(id:string){if(id==='react')return hooks;if(id==='react/jsx-runtime')return {jsx:(type:any,props:any,key:any)=>({type,props,key}),jsxs:(type:any,props:any,key:any)=>({type,props,key})};if(id==='./workspace-transport.ts')return {workspaceBlockMessage};throw Error('Unexpected dependency '+id)}})
 const source=ts.transpileModule(readFileSync(new URL('../web/chat/workspace-context.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText
 runInContext(source+'\nexports.__parts={ReadyWorkspace,SubscribedWorkspace,WorkspaceStatus};',context)
 return {exports,reload,render(name:string,props:any){cursor=0;return (exports[name]??exports.__parts[name])(props)},flush(){for(const i of pending.splice(0))slots[i].cleanup=slots[i].setup()},replay(){for(const slot of slots)if(slot?.kind==='effect'){slot.cleanup?.();slot.cleanup=slot.setup()}},unmount(){for(const slot of slots)if(slot?.kind==='effect')slot.cleanup?.()}}
}
function bootstrapHarness(failFirst=false){
 const exported:any={},mount=vi.fn(()=>({transport:{fixture:true}})),createElement=vi.fn(()=>({}));let imports=0
 const context=createContext({exports:exported,Promise,document:{createElement},require(id:string){if(id==='virtual:configuration-content'){if(failFirst&&imports++===0)throw Error('bootstrap import failed');return {mount}}return {} }})
 const source=ts.transpileModule(readFileSync(new URL('../web/chat/configuration.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText
 runInContext(source,context);return {exported,mount,createElement}
}
const flush=()=>new Promise(resolve=>setImmediate(resolve))
it('prepares one existing controller for concurrent direct entry and legacy callers',async()=>{
 const b=bootstrapHarness(),[first,second,transport]=await Promise.all([b.exported.prepareConfiguration(),b.exported.prepareConfiguration(),b.exported.getConfigurationTransport()])
 expect(first).toBe(second);expect(transport).toBe(first.transport);expect(b.mount).toHaveBeenCalledTimes(1);expect(b.createElement).toHaveBeenCalledTimes(4)
 expect(b.mount.mock.calls[0]).toHaveLength(1)
})
it('retries a failed import without falling back to root fetch or inventing a controller',async()=>{
 const b=bootstrapHarness(true);await expect(b.exported.getConfigurationTransport()).rejects.toThrow('bootstrap import failed');expect(b.mount).not.toHaveBeenCalled();expect(await b.exported.getConfigurationTransport()).toEqual({fixture:true});expect(b.mount).toHaveBeenCalledTimes(1)
})
it('keeps the new owner unmounted from main until consumers migrate',()=>{
 const source=readFileSync(new URL('../web/chat/main.tsx',import.meta.url),'utf8');expect(source).not.toContain('WorkspaceTransportOwner');expect(source).not.toContain('workspace-context')
})
it('starts direct-entry bootstrap without exposing children before the transport loads',async()=>{
 const h=componentHarness(),b=bridge();let resolve!:(v:WorkspaceTransport)=>void;const load=vi.fn(()=>new Promise<WorkspaceTransport>(r=>resolve=r)),props={language:'en',children:'capability',loadTransport:load}
 expect(h.render('WorkspaceTransportOwner',props).props.state).toBe('pending');h.flush();await flush();expect(load).toHaveBeenCalledTimes(1);expect(h.render('WorkspaceTransportOwner',props).props.state).toBe('pending')
 resolve(b.transport);await flush();const ready=h.render('WorkspaceTransportOwner',props);expect(ready.type.name).toBe('SubscribedWorkspace');expect(ready.props.transport).toBe(b.transport)
})
it('does not publish a bootstrap result after unmount or reuse a previous loader context',async()=>{
 const h=componentHarness(),b=bridge();let resolve!:(v:WorkspaceTransport)=>void;const first=()=>new Promise<WorkspaceTransport>(r=>resolve=r),props={language:'en',children:'capability',loadTransport:first}
 h.render('WorkspaceTransportOwner',props);h.flush();await flush();h.unmount();resolve(b.transport);await flush();expect(h.render('WorkspaceTransportOwner',props).props.state).toBe('pending')
 const next=()=>Promise.resolve(b.transport);expect(h.render('WorkspaceTransportOwner',{...props,loadTransport:next}).props.state).toBe('pending')
})
it('StrictMode bootstrap replay ignores the cleaned-up first result',async()=>{
 const h=componentHarness(),old=bridge(),next=bridge({...initial,epoch:2}),complete:((v:WorkspaceTransport)=>void)[]=[],load=()=>new Promise<WorkspaceTransport>(r=>complete.push(r)),props={language:'en',children:'capability',loadTransport:load}
 h.render('WorkspaceTransportOwner',props);h.flush();await flush();h.replay();await flush();expect(complete).toHaveLength(2);complete[0]!(old.transport);await flush();expect(h.render('WorkspaceTransportOwner',props).props.state).toBe('pending');complete[1]!(next.transport);await flush();expect(h.render('WorkspaceTransportOwner',props).props.transport).toBe(next.transport)
})
it('sanitizes bootstrap failures and uses normal readable status text',async()=>{
 const h=componentHarness(),props={language:'zh-CN',children:'capability',loadTransport:async()=>{throw Error('SECRET_BOOTSTRAP')}};h.render('WorkspaceTransportOwner',props);h.flush();await flush();const state=h.render('WorkspaceTransportOwner',props);expect(state.props).toMatchObject({state:'blocked'});expect(state.props.message).not.toContain('SECRET');const status=h.render('WorkspaceStatus',state.props);expect(status.props.style.fontSize).toBeGreaterThanOrEqual(14);expect(status.props.role).toBe('alert')
})
it.each(['pending','blocked'] as const)('never mounts capability children for C1 %s state',state=>{
 const h=componentHarness(),b=bridge({...initial,state,code:state==='blocked'?'workspace_unsupported':null});const result=h.render('SubscribedWorkspace',{transport:b.transport,language:'en',children:'capability'});h.flush();expect(result.type.name).toBe('WorkspaceStatus');expect(result.props.state).toBe(state);expect(b.transport.bind).not.toHaveBeenCalled();expect(b.fetch).not.toHaveBeenCalled();h.unmount();expect(b.listeners.size).toBe(0)
})
it('creates unambiguous stable context keys without treating them as authority',()=>{
 const h=componentHarness(),key=h.exports.workspaceContextKey(initial);expect(key).toBe(h.exports.workspaceContextKey({...initial}));expect(key).not.toBe(h.exports.workspaceContextKey({...initial,epoch:2}));expect(h.exports.workspaceContextKey({...initial,activeId:'a,b',accountId:'c'})).not.toBe(h.exports.workspaceContextKey({...initial,activeId:'a',accountId:'b,c'}))
})
it('creates a fresh live read signal after StrictMode cleanup/setup and keeps it across same-context rerenders',()=>{
 const h=componentHarness(),b=bridge(),props={transport:b.transport,context:b.transport.context(),contextKey:h.exports.workspaceContextKey(b.transport.context()),language:'en',children:'capability'}
 expect(h.render('ReadyWorkspace',props).props.state).toBe('pending');h.flush();const first=h.render('ReadyWorkspace',props).props.value;expect(first.readSignal.aborted).toBe(false);expect(first.binding.context).toBe(props.context)
 h.replay();expect(first.readSignal.aborted).toBe(true);const next=h.render('ReadyWorkspace',props).props.value;expect(next.readSignal).not.toBe(first.readSignal);expect(next.readSignal.aborted).toBe(false);h.flush();expect(h.render('ReadyWorkspace',props).props.value).toBe(next);h.unmount();expect(next.readSignal.aborted).toBe(true)
})
it('keys identity changes to remount old pages, abort their reads, and keep stale actions bound',async()=>{
 const parent=componentHarness(),b=bridge({...initial,managed:true,activeId:'studio'}),props={transport:b.transport,language:'en',children:'capability'};const oldNode=parent.render('SubscribedWorkspace',props),old=componentHarness();old.render('ReadyWorkspace',oldNode.props);old.flush();const lease=old.render('ReadyWorkspace',oldNode.props).props.value
 b.commit({activeId:'other',epoch:2});const nextNode=parent.render('SubscribedWorkspace',props);expect(nextNode.key).not.toBe(oldNode.key);old.unmount();expect(lease.readSignal.aborted).toBe(true);await expect(lease.binding.request('/api/example',{id:'same',revision:1})).rejects.toThrow('workspace_obsolete');expect(b.fetch).not.toHaveBeenCalled()
 const fresh=componentHarness();fresh.render('ReadyWorkspace',nextNode.props);fresh.flush();expect(fresh.render('ReadyWorkspace',nextNode.props).props.value.context.activeId).toBe('other');fresh.unmount()
})
it('drops ready children on pending or blocked and rejects hook usage outside the owner',()=>{
 const parent=componentHarness(),b=bridge(),props={transport:b.transport,language:'en',children:'capability'};const oldNode=parent.render('SubscribedWorkspace',props),old=componentHarness();old.render('ReadyWorkspace',oldNode.props);old.flush();const lease=old.render('ReadyWorkspace',oldNode.props).props.value
 b.commit({state:'pending',epoch:2});expect(parent.render('SubscribedWorkspace',props).type.name).toBe('WorkspaceStatus');old.unmount();expect(lease.readSignal.aborted).toBe(true);b.commit({state:'blocked',code:'workspace_session_ended'});expect(parent.render('SubscribedWorkspace',props).props.message).toContain('session ended');expect(()=>parent.exports.useWorkspaceTransport()).toThrow('workspace_owner_required');expect(b.fetch).not.toHaveBeenCalled()
})
it('never publishes a ready page lease when its C1 binding preflight has already become obsolete',()=>{
 const h=componentHarness(),b=bridge(),context=b.transport.context(),props={transport:b.transport,context,contextKey:h.exports.workspaceContextKey(context),language:'en',children:'capability'};h.render('ReadyWorkspace',props);b.commit({epoch:2});h.flush();expect(h.render('ReadyWorkspace',props).props.state).toBe('blocked');expect(b.fetch).not.toHaveBeenCalled()
})
