import {readFileSync} from 'node:fs'
import {createContext,runInContext} from 'node:vm'
import {createRequire} from 'node:module'
import {transformSync} from 'esbuild'
import {expect,it,vi} from 'vitest'
import * as statusView from '../web/chat/connector-status-view.ts'
import * as informationView from '../web/chat/credential-reference-view.ts'
import type {WorkspaceBinding,WorkspaceTransportContext} from '../web/chat/workspace-transport.ts'
const code=transformSync(readFileSync(new URL('../web/chat/connector-management.tsx',import.meta.url),'utf8'),{loader:'tsx',format:'cjs',jsx:'automatic'}).code,require=createRequire(import.meta.url)
const deferred=()=>{let resolve!:(value:any)=>void,reject!:(error:any)=>void;const promise=new Promise<any>((r,j)=>{resolve=r;reject=j});return {promise,resolve,reject}}
interface Call {path:string;apiPath:string;body:unknown;signal?:AbortSignal;context:WorkspaceTransportContext}
const information=(state='present',revision=7)=>({schema:1,scope:'host',observedAt:1000,settingsRevision:revision,connections:[{kind:'source',id:'same',state,verification:'not_checked',references:state==='not_declared'?[]:[{slot:0,purpose:'authentication',state:state==='unknown'?'unknown':state}]},{kind:'tool',id:'same',state:'missing',verification:'not_checked',references:[{slot:0,purpose:'process_environment',state:'missing'}]},{kind:'backend',id:'hidden',state:'unknown',verification:'not_checked',references:[]}]})
function fixture(language:'en'|'zh-CN'='en'){
 const slots:any[]=[],initialized=new Set<number>(),deps:any[][]=[],effects:(()=>void)[]=[],cleanups:(()=>void)[]=[],calls:Call[]=[],listeners=new Map<string,Set<()=>void>>(),navigate=vi.fn()
 let cursor=0,tree:any,epoch=1,workspace='studio',revision=7,account='account',session='session-1'
 const inventory=()=>({revision,definitions:[{kind:'fixture',label:'Synthetic app'}],instances:[{id:'same',kind:'fixture',label:workspace+' saved connection',enabled:false,scopeCount:1,layers:{},credentialReferences:[{field:'SECRET_OLD_FIELD',available:true}]}],tools:[{id:'same',label:'Saved tool',enabled:true}],diagnostics:[]})
 let handler:(call:Call)=>Promise<any>=async call=>call.apiPath==='/api/credential-references'?information():inventory()
 const lease=()=>{
  const context:WorkspaceTransportContext=Object.freeze({state:'ready',code:null,managed:true,activeId:workspace,epoch,accountId:account,sessionIsolation:session}),reads=new AbortController()
  const binding:WorkspaceBinding={context,async request<T>(path:string,body?:unknown,publicRead=false,scope?:string,signal?:AbortSignal):Promise<T>{
   if(context.activeId!==workspace||context.epoch!==epoch||context.accountId!==account||context.sessionIsolation!==session||reads.signal.aborted)throw {status:409,payload:{code:'workspace_obsolete'}}
   if(publicRead||scope!==undefined)throw Error('Scope bypass')
   const call={path:'/workspaces/'+context.activeId+path,apiPath:path,body,signal,context};calls.push(call);return handler(call)
  }}
  return {context,binding,contextKey:JSON.stringify(context),readSignal:reads.signal,reads}
 }
 let owner=lease()
 const hooks={useState:(initial:any)=>{const i=cursor++;if(!initialized.has(i)){initialized.add(i);slots[i]=initial}return [slots[i],(value:any)=>{slots[i]=typeof value==='function'?value(slots[i]):value}]},useRef:(initial:any)=>{const i=cursor++;if(!initialized.has(i)){initialized.add(i);slots[i]={current:initial}}return slots[i]},useEffect:(setup:()=>any,next:any[])=>{const i=cursor++;if(!deps[i]||next.some((value,j)=>!Object.is(value,deps[i]![j]))){deps[i]=next;effects.push(()=>{cleanups[i]?.();cleanups[i]=setup()})}}}
 const environment:any={module:{exports:{}},exports:{},AbortController,Date,crypto,document:{},window:{addEventListener(name:string,fn:()=>void){if(!listeners.has(name))listeners.set(name,new Set());listeners.get(name)!.add(fn)},removeEventListener(name:string,fn:()=>void){listeners.get(name)?.delete(fn)}},location:{assign:navigate,replace:navigate},fetch(){throw Error('Unbound root fetch')},require:(name:string)=>name==='react'?hooks:name==='react/jsx-runtime'?require(name):name==='lucide-react'?new Proxy({},{get:()=>()=>null}):name==='./workspace-context.tsx'?{useWorkspaceTransport:()=>owner}:name==='./connector-status-view.ts'?statusView:name==='./credential-reference-view.ts'?informationView:name.endsWith('.css')?{}:(()=>{throw Error('Unexpected import '+name)})()}
 environment.exports=environment.module.exports;runInContext(code,createContext(environment))
 function render(){cursor=0;tree=environment.module.exports.ConnectorManagement({language});while(effects.length)effects.shift()!()}
 const walk=(value:any):any[]=>!value||typeof value!=='object'?[]:Array.isArray(value)?value.flatMap(walk):[value,...walk(value.props?.children)]
 const nodes=()=>walk(tree),text=()=>textOf(tree),row=(kind:string)=>nodes().find(node=>node.props?.['data-information-kind']===kind)
 const flush=async()=>{await new Promise(resolve=>setImmediate(resolve));render()}
 const refresh=async()=>{nodes().find(node=>node.type==='button'&&textOf(node)===(language==='en'?'Refresh':'刷新'))!.props.onClick();await flush()}
 function change(values:{workspace?:string;account?:string;session?:string;epoch?:number}={}){const old=owner;old.reads.abort();workspace=values.workspace??workspace;account=values.account??account;session=values.session??session;epoch=values.epoch??epoch+1;owner=lease();render();render();return old}
 render()
 return {calls,nodes,text,row,flush,refresh,change,owner:()=>owner,navigate,render,setHandler:(fn:typeof handler)=>{handler=fn},inventory,revision:(value:number)=>{revision=value},emit:()=>listeners.get('roppo:plugins-changed')?.forEach(fn=>fn()),unmount(){owner.reads.abort();for(const cleanup of cleanups)cleanup?.()}}
}
function textOf(value:any):string{if(value==null||typeof value==='boolean')return '';if(typeof value==='string'||typeof value==='number')return String(value);return Array.isArray(value)?value.map(textOf).join(''):textOf(value.props?.children)}
it('uses only captured same-workspace GETs and joins source/tool IDs separately without showing old fields or a backend registry',async()=>{
 const f=fixture();await f.flush()
 expect(f.calls.map(call=>call.path)).toEqual(['/workspaces/studio/api/connectors','/workspaces/studio/api/credential-references'])
 expect(f.calls.every(call=>call.body===undefined&&call.signal===f.owner().readSignal)).toBe(true)
 expect(textOf(f.row('source'))).toContain('Found in this environment');expect(textOf(f.row('tool'))).toContain('Some information is missing')
 expect(f.text()).not.toMatch(/SECRET|hidden|slot|process_environment|Local references|Not declared/)
 expect(f.text().split('Service access is not verified by this check.')).toHaveLength(2);expect(f.navigate).not.toHaveBeenCalled()
})
it.each(['present','missing','unknown','not_declared'])('renders the short frozen state %s without claiming a service or login test',async state=>{
 const f=fixture('zh-CN');f.setHandler(async call=>call.apiPath==='/api/credential-references'?information(state):f.inventory());await f.flush()
 expect(textOf(f.row('source'))).toContain(informationView.credentialInformationLabel(state as informationView.InformationState)[1]);expect(f.text()).toContain('此项检查不代表服务可用。');expect(f.text()).not.toMatch(/未声明|本地引用|凭据已验证|已登录/)
})
it.each([403,404,405,503])('isolates current credential GET failure %s from connector inventory and operations',async status=>{
 const f=fixture();f.setHandler(async call=>{if(call.apiPath==='/api/credential-references')throw {status,payload:{code:'workspace_unavailable',error:'SECRET_RAW'}};return f.inventory()});await f.flush()
 expect(f.text()).toContain('studio saved connection');expect(textOf(f.row('source'))).toContain('Information check unavailable');expect(f.text()).not.toMatch(/SECRET|Connections are unavailable/)
 expect(f.nodes().find(node=>node.type==='button'&&textOf(node)==='Add connection')?.props.disabled).toBe(false)
 expect(f.calls).toHaveLength(2);expect(f.calls.every(call=>call.path.startsWith('/workspaces/studio/'))).toBe(true);expect(f.navigate).not.toHaveBeenCalled()
})
it('keeps a failed refresh explicitly earlier with its real time, then reflects changed information at the same settings revision',async()=>{
 const f=fixture();await f.flush();f.setHandler(async call=>{if(call.apiPath==='/api/credential-references')throw {status:503,payload:{error:'SECRET'}};return f.inventory()});await f.refresh()
 expect(textOf(f.row('source'))).toBe('Connection informationEarlier record · Found in this environment');expect(f.row('source').props['data-information-state']).toBe('stale')
 expect(f.nodes().some(node=>node.type==='time'&&node.props.dateTime===new Date(1000).toISOString())).toBe(true)
 f.setHandler(async call=>call.apiPath==='/api/credential-references'?information('missing'):f.inventory());await f.refresh();expect(textOf(f.row('source'))).toContain('Some information is missing');expect(f.row('source').props['data-information-state']).toBe('missing')
})
it.each([401,403])('clears earlier private information after current authorization failure %s without another navigation',async status=>{
 const f=fixture();await f.flush();f.setHandler(async call=>{if(call.apiPath==='/api/credential-references')throw {status,payload:{error:'SECRET'}};return f.inventory()});await f.refresh()
 expect(textOf(f.row('source'))).toContain('Information check unavailable');expect(f.text()).not.toMatch(/Found in this environment|Earlier record|SECRET/);expect(f.nodes().some(node=>node.type==='time')).toBe(false);expect(f.navigate).not.toHaveBeenCalled()
})
it('rejects malformed or wrong-revision snapshots instead of using old source booleans',async()=>{
 const f=fixture();f.setHandler(async call=>call.apiPath==='/api/credential-references'?{...information(),schema:2,token:'SECRET'}:f.inventory());await f.flush();expect(textOf(f.row('source'))).toContain('Information check unavailable')
 f.setHandler(async call=>call.apiPath==='/api/credential-references'?information('present',8):f.inventory());await f.refresh();expect(textOf(f.row('source'))).toContain('Settings changed. Refresh to check.');expect(f.text()).not.toMatch(/Found in this environment|SECRET/)
})
it.each(['result','error'])('drops delayed information %s after A to B to A with the same IDs and revisions',async outcome=>{
 const f=fixture(),held=deferred();f.setHandler(call=>call.apiPath==='/api/credential-references'&&call.context.epoch===1?held.promise:Promise.resolve(call.apiPath==='/api/credential-references'?information('unknown'):f.inventory()));await f.flush()
 const old=f.owner();f.change({workspace:'other'});await f.flush();f.change({workspace:'studio'});await f.flush()
 if(outcome==='result')held.resolve(information('present'));else held.reject({status:503,payload:{error:'SECRET_OLD'}});await f.flush()
 expect(old.readSignal.aborted).toBe(true);expect(textOf(f.row('source'))).toContain('Cannot check here');expect(f.text()).not.toMatch(/Found in this environment|SECRET/)
})
it.each(['account','session'])('clears old observation ownership on %s change even with identical workspace and epoch',async dimension=>{
 const f=fixture();await f.flush();const epoch=f.owner().context.epoch
 f.setHandler(async call=>call.apiPath==='/api/credential-references'?information('unknown'):f.inventory());f.change({epoch,...(dimension==='account'?{account:'new-account'}:{session:'new-session'})});await f.flush()
 expect(textOf(f.row('source'))).toContain('Cannot check here');expect(f.text()).not.toContain('Found in this environment')
})
it('keeps one credential GET in flight and rechecks a changed saved revision without publishing the old result',async()=>{
 const f=fixture(),held=deferred();f.setHandler(call=>call.apiPath==='/api/credential-references'?held.promise:Promise.resolve(f.inventory()));await f.flush();await f.refresh();await f.refresh()
 expect(f.calls.filter(call=>call.apiPath==='/api/credential-references')).toHaveLength(1)
 f.revision(8);await f.refresh();f.setHandler(async call=>call.apiPath==='/api/credential-references'?information('missing',8):f.inventory());held.resolve(information('present',7));await f.flush();await f.flush()
 expect(f.calls.filter(call=>call.apiPath==='/api/credential-references')).toHaveLength(2);expect(textOf(f.row('source'))).toContain('Some information is missing');expect(f.text()).not.toContain('Found in this environment')
})
it('does not publish after owner cleanup even when a read ignores abort',async()=>{
 const f=fixture(),held=deferred();f.setHandler(call=>call.apiPath==='/api/credential-references'?held.promise:Promise.resolve(f.inventory()));await f.flush();const owner=f.owner();f.unmount();held.resolve(information());await f.flush();expect(owner.readSignal.aborted).toBe(true);expect(f.text()).not.toContain('Found in this environment');expect(f.calls).toHaveLength(2)
})
it('keeps the source/tool summary at normal size and under the existing reduced-motion rule',()=>{
 const css=readFileSync(new URL('../web/chat/connector-management.css',import.meta.url),'utf8')
 expect(css).toMatch(/\.connector-information\{[^}]*font-size:14px/);expect(css).toContain('@media(prefers-reduced-motion:reduce)');expect(css).not.toMatch(/connector-information[^}]*animation:/)
})
