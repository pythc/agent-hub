import {readFileSync} from 'node:fs'
import {createContext,runInContext} from 'node:vm'
import {createRequire} from 'node:module'
import {transformSync} from 'esbuild'
import {expect,it,vi} from 'vitest'
import * as statusView from '../web/chat/connector-status-view.ts'
import * as informationView from '../web/chat/credential-reference-view.ts'
import type {WorkspaceBinding,WorkspaceTransportContext} from '../web/chat/workspace-transport.ts'
interface WorkspacePageContext {context:WorkspaceTransportContext;binding:WorkspaceBinding;contextKey:string;readSignal:AbortSignal}

// Run the actual TSX and its asynchronous callbacks. The simulated optional
// workspace host is deliberately not a claim of real server multiworkspace support.
const code=transformSync(readFileSync(new URL('../web/chat/connector-management.tsx',import.meta.url),'utf8'),{loader:'tsx',format:'cjs',jsx:'automatic'}).code+'\nmodule.exports.__Setup=Setup;'
const require=createRequire(import.meta.url)
const definitions=[{kind:'fixture-im',label:'Fixture IM',setupAvailable:true,setup:{description:'Fixture'},fields:[{name:'rooms',label:'Rooms',required:true,input:'tags',credential:false,help:'Internal source adapter onboarding instructions'},{name:'token',label:'Token',required:true,credential:true,help:'Credential instructions'}]}]
const deferred=()=>{let resolve!:(value:any)=>void,reject!:(reason:any)=>void;const promise=new Promise<any>((r,j)=>{resolve=r;reject=j});return {promise,resolve,reject}}
interface Call {path:string;apiPath:string;workspace:string;body:any;signal?:AbortSignal}
function fixture(component:'page'|'setup'='setup',initial?:(call:Call)=>Promise<any>){
 const slots:any[]=[],initialized=new Set<number>(),effects:(()=>void)[]=[],cleanups:(()=>void)[]=[],deps:any[][]=[],calls:Call[]=[],created:boolean[]=[],listeners=new Map<string,Set<()=>void>>(),navigate=vi.fn()
 let cursor=0,tree:any,epoch=1,liveId='studio',lease:WorkspacePageContext
 const enabled=new Map<string,boolean>()
 function snapshot(workspace:string){return {revision:7,definitions,instances:[{id:'same-source',kind:'fixture-im',label:workspace+' connection',enabled:enabled.get(workspace)??true,scopeCount:1,layers:{},credentialReferences:[]}],tools:[],diagnostics:[]}}
 let handler:(call:Call)=>Promise<any>=initial??(async call=>{
  if(call.apiPath==='/api/credential-references')return {schema:1,scope:'host',settingsRevision:7,observedAt:Date.now(),connections:[]}
  if(call.apiPath.endsWith('/validate'))return {valid:true,credentialAvailability:[{field:'token',available:true}]}
  if(call.apiPath.endsWith('/plan'))return {id:'plan-'+call.workspace,expiresAt:Date.now()+60000}
  if(call.apiPath.endsWith('/apply'))return {applied:true}
  if(call.apiPath.endsWith('/control')){enabled.set(call.workspace,call.body.enabled);return {enabled:call.body.enabled}}
  return call.body===undefined?snapshot(call.workspace):{}
 })
 function newLease(){
  const context=Object.freeze({state:'ready' as const,code:null,managed:true,activeId:liveId,epoch,accountId:'account',sessionIsolation:'session-'+epoch}),reads=new AbortController(),key=JSON.stringify(context)
  const binding={context,async request<T>(path:string,body?:unknown,publicRead=false,scope?:string,signal?:AbortSignal):Promise<T>{
   if(context.epoch!==epoch||context.activeId!==liveId||reads.signal.aborted)throw {status:409,payload:{code:'workspace_obsolete'}}
   if(publicRead||scope!==undefined)throw Error('Unexpected scope override')
   const call={path:'/workspaces/'+context.activeId+path,apiPath:path,workspace:context.activeId,body:body===undefined?undefined:structuredClone(body),signal};calls.push(call)
   // Delayed results may ignore cancellation; the page must still fence callbacks.
   return handler(call)
  }}
  return {value:{context,binding,contextKey:key,readSignal:reads.signal},reads}
 }
 let active=newLease();lease=active.value
 const hooks={useState:(initial:any)=>{const at=cursor++;if(!initialized.has(at)){initialized.add(at);slots[at]=typeof initial==='function'?initial():initial}return [slots[at],(value:any)=>{slots[at]=typeof value==='function'?value(slots[at]):value}]},useRef:(initial:any)=>{const at=cursor++;if(!initialized.has(at)){initialized.add(at);slots[at]={current:initial}}return slots[at]},useEffect:(setup:()=>any,next:any[])=>{const at=cursor++,before=deps[at];if(!before||next.length!==before.length||next.some((v,i)=>!Object.is(v,before[i]))){deps[at]=next;effects.push(()=>{cleanups[at]?.();cleanups[at]=setup()})}}}
 const environment:any={module:{exports:{}},exports:{},AbortController,Date,crypto,document:{activeElement:{focus(){}}},location:{assign:navigate,replace:navigate},window:{addEventListener(name:string,callback:()=>void){if(!listeners.has(name))listeners.set(name,new Set());listeners.get(name)!.add(callback)},removeEventListener(name:string,callback:()=>void){listeners.get(name)?.delete(callback)}},fetch:()=>{throw Error('A root fetch bypassed the workspace binding')},require:(name:string)=>name==='react'?hooks:name==='react/jsx-runtime'?require(name):name==='lucide-react'?new Proxy({},{get:()=>()=>null}):name==='./workspace-context.tsx'?{useWorkspaceTransport:()=>lease}:name==='./connector-status-view.ts'?statusView:name==='./credential-reference-view.ts'?informationView:name.endsWith('.css')?{}:(()=>{throw Error('Unexpected import '+name)})()}
 environment.exports=environment.module.exports;runInContext(code,createContext(environment));const exports=environment.module.exports
 const walk=(value:any):any[]=>value==null||typeof value!=='object'?[]:Array.isArray(value)?value.flatMap(walk):[value,...walk(value.props?.children)]
 const nodes=()=>walk(tree),text=()=>textOf(tree)
 function render(){cursor=0;tree=component==='setup'?exports.__Setup({definitions,revision:7,L:(en:string)=>en,close(){},created:(people:boolean)=>created.push(people),message:(code:string)=>code}):exports.ConnectorManagement({language:'en'});for(const node of nodes()){const ref=node.props?.ref;if(ref){const element=node.type==='dialog'?{showModal(){},addEventListener(){},removeEventListener(){},close(){}}:{focus(){}};if(typeof ref==='function')ref(element);else ref.current=element}}while(effects.length)effects.shift()!();return tree}
 const flush=async()=>{await new Promise(resolve=>setImmediate(resolve));render()}
 const submitCallback=()=>nodes().find(node=>node.type==='form')?.props.onSubmit
 const submit=async()=>{submitCallback()?.({preventDefault(){}});await flush()}
 const input=(id:string)=>nodes().find(node=>node.type==='input'&&node.props.id==='connector-field-'+id)
 const change=(id:string,value:string)=>{input(id).props.onChange({target:{value}});render()}
 const button=(label:string)=>nodes().find(node=>node.type==='button'&&textOf(node)===label)
 function switchTo(id:string){const old=lease;active.reads.abort();liveId=id;epoch++;active=newLease();lease=active.value;render();render();return old}
 render()
 return {calls,created,navigate,snapshot,nodes,text,render,flush,submit,submitCallback,input,change,button,switchTo,lease:()=>lease,setHandler:(next:typeof handler)=>{handler=next},emit:(name:string)=>listeners.get(name)?.forEach(callback=>callback()),unmount:()=>cleanups.forEach(cleanup=>cleanup?.())}
}
function textOf(value:any):string{if(value==null||typeof value==='boolean')return '';if(typeof value==='string'||typeof value==='number')return String(value);return Array.isArray(value)?value.map(textOf).join(''):textOf(value.props?.children)}
async function filled(){const f=fixture();await f.submit();f.change('rooms','ROOM');f.change('token','SECRET_DRAFT');return f}

it('routes inventory, probes and controls through the data workspace while retaining payload and read semantics',async()=>{
 const f=fixture('page');await f.flush();const first=f.calls[0]!;expect(first.path).toBe('/workspaces/studio/api/connectors');expect(first.signal).toBe(f.lease().readSignal)
 f.nodes().find(node=>node.type==='button'&&node.props['aria-label']?.startsWith('Check ')).props.onClick();await f.flush()
 const probe=f.calls.find(call=>call.apiPath.endsWith('/probe'))!;expect(probe.body).toMatchObject({sourceId:'same-source',revision:7,level:'configuration',requestId:expect.any(String)});expect(probe.signal).toBeUndefined()
 f.button('Disable connection').props.onClick();await f.flush();const control=f.calls.find(call=>call.apiPath.endsWith('/control'))!;expect(control.body).toMatchObject({sourceId:'same-source',revision:7,enabled:false,requestId:expect.any(String)});expect(control.signal).toBeUndefined();expect(f.calls.every(call=>call.workspace==='studio')).toBe(true)
})
it('binds validate, plan and existing apply to the same workspace without cancelling submitted POSTs',async()=>{
 const f=await filled();await f.submit();await f.submit();expect(f.calls.map(call=>call.path)).toEqual(['/workspaces/studio/api/connectors/validate','/workspaces/studio/api/connectors/plan','/workspaces/studio/api/plugin-market/connection/apply']);expect(f.calls[0]!.body).toMatchObject({revision:7,actors:[],intent:'draft',credentials:{token:'SECRET_DRAFT'}});expect(f.calls[1]!.body).toEqual(f.calls[0]!.body);expect(f.calls[2]!.body).toEqual({id:'plan-studio'});expect(f.text()).toContain('Saving reloads the configuration. Connections may briefly disconnect.');expect(f.text()).toContain('This connection stays disabled. No message test or Worker tool access is added.');expect(f.calls.every(call=>call.signal===undefined)).toBe(true);expect(f.created).toEqual([false])
})
it('aborts old inventory reads and does not publish a delayed snapshot into the next workspace',async()=>{
 const f=fixture('page');await f.flush();const pending=deferred();f.setHandler(call=>call.workspace==='studio'?pending.promise:Promise.resolve(f.snapshot(call.workspace)));f.button('Refresh').props.onClick();await new Promise(resolve=>setImmediate(resolve));const held=f.calls.at(-1)!,old=f.switchTo('other');expect(held.signal).toBe(old.readSignal);expect(held.signal!.aborted).toBe(true);await f.flush();pending.resolve(f.snapshot('studio'));await f.flush();expect(f.text()).toContain('other connection');expect(f.text()).not.toContain('studio connection')
})
it.each(['result','error'])('clears private drafts and never plans after obsolete validation %s',async kind=>{
 const f=await filled(),pending=deferred();f.setHandler(()=>pending.promise);const old=f.submit();f.switchTo('other');if(kind==='result')pending.resolve({valid:true});else pending.reject({status:400,payload:{code:'connector_invalid',issues:[{field:'token',code:'required'}],error:'SECRET_ERROR'}});await old;await f.flush();expect(f.calls).toHaveLength(1);expect(f.created).toEqual([]);expect(f.text()).not.toMatch(/SECRET|connector_invalid/);await f.submit();expect(f.input('token').props.value).toBe('');expect(f.input('rooms').props.value).toBe('')
})
it('rejects an old saved submit before sending after A to B to A with identical IDs and revisions',async()=>{
 const f=await filled(),oldSubmit=f.submitCallback();f.switchTo('other');f.switchTo('studio');oldSubmit({preventDefault(){}});await f.flush();expect(f.calls).toEqual([]);expect(f.created).toEqual([])
})
it('does not publish or apply a plan completed after the context changed',async()=>{
 const f=await filled(),pending=deferred();f.setHandler(call=>call.apiPath.endsWith('/validate')?Promise.resolve({valid:true}):pending.promise);const old=f.submit();await new Promise(resolve=>setImmediate(resolve));expect(f.calls).toHaveLength(2);f.switchTo('other');pending.resolve({id:'old-plan',expiresAt:Date.now()+60000});await old;await f.flush();expect(f.calls.map(call=>call.apiPath)).toEqual(['/api/connectors/validate','/api/connectors/plan']);expect(f.created).toEqual([]);expect(f.text()).not.toContain('Review settings')
})
it('never applies an old reviewed form after a workspace change',async()=>{
 const f=await filled();await f.submit();const oldApply=f.submitCallback();f.switchTo('other');oldApply({preventDefault(){}});await f.flush();expect(f.calls).toHaveLength(2);expect(f.calls.some(call=>call.apiPath.endsWith('/apply'))).toBe(false)
})
it.each(['result','error'])('leaves submitted apply %s in its original namespace without new-page success or replay',async kind=>{
 const f=await filled();await f.submit();const pending=deferred();f.setHandler(()=>pending.promise);const old=f.submit();expect(f.calls.at(-1)!.apiPath).toBe('/api/plugin-market/connection/apply');expect(f.calls.at(-1)!.signal).toBeUndefined();f.switchTo('other');if(kind==='result')pending.resolve({applied:true});else pending.reject({status:503,payload:{code:'setup_apply_failed',error:'SECRET_RESULT'}});await old;await f.flush();expect(f.calls.filter(call=>call.apiPath.endsWith('/apply'))).toHaveLength(1);expect(f.calls.at(-1)!.workspace).toBe('studio');expect(f.created).toEqual([]);expect(f.text()).not.toMatch(/SECRET|saved|connector_request_failed/)
})
it.each(['probe','control'])('does not refresh or show an obsolete %s result in the next workspace',async kind=>{
 const f=fixture('page');await f.flush();const pending=deferred();f.setHandler(call=>call.body===undefined?Promise.resolve(f.snapshot(call.workspace)):pending.promise)
 if(kind==='probe')f.nodes().find(node=>node.type==='button'&&node.props['aria-label']?.startsWith('Check ')).props.onClick();else f.button('Disable connection').props.onClick()
 await new Promise(resolve=>setImmediate(resolve));f.switchTo('other');await f.flush();const count=f.calls.length;pending.resolve({enabled:false});await f.flush();expect(f.calls).toHaveLength(count);expect(f.text()).toContain('other connection');expect(f.text()).not.toContain('Connection disabled. New calls')
})
it('keeps fixed field issues from the legacy error payload and never adds a second 401 navigation',async()=>{
 const f=await filled();f.setHandler(async()=>{throw {status:400,payload:{code:'connector_invalid',error:'SECRET_RAW',issues:[{field:'token',code:'required',raw:'SECRET_RAW'},{field:'SECRET_FIELD',code:'required'}]}}});await f.submit();expect(f.input('token').props['aria-invalid']).toBe(true);expect(f.text()).not.toContain('SECRET');f.setHandler(async()=>{throw {status:401,payload:{code:'account_login_required'}}});await f.submit();expect(f.navigate).not.toHaveBeenCalled()
})
it('does not continue validation after unmount even when its response ignores cancellation',async()=>{
 const f=await filled(),pending=deferred();f.setHandler(()=>pending.promise);const old=f.submit();f.unmount();pending.resolve({valid:true});await old;expect(f.calls).toHaveLength(1);expect(f.created).toEqual([])
})

it.each([403,404])('shows a fixed initial inventory failure for current-context workspace rejection %s',async status=>{
 const f=fixture('page',async()=>{throw {status,payload:{code:'workspace_unavailable',error:'SECRET_WORKSPACE_ERROR'}}});await f.flush();expect(f.text()).toContain('Connections are unavailable. Try refreshing.');expect(f.text()).not.toMatch(/SECRET|Loading connections/);expect(f.calls).toHaveLength(1);expect(f.calls[0]!.workspace).toBe('studio');expect(f.navigate).not.toHaveBeenCalled()
})
it.each(['workspace_unavailable','workspace_unsupported'])('shows current-context %s control failure without fallback or navigation',async code=>{
 const f=fixture('page');await f.flush();f.setHandler(async()=>{throw {status:403,payload:{code,error:'SECRET_WORKSPACE_ERROR'}}});f.button('Disable connection').props.onClick();await f.flush();expect(f.text()).toContain('The request could not finish. Refresh before trying again.');expect(f.text()).not.toContain('SECRET');expect(f.calls.filter(call=>call.apiPath.startsWith('/api/connectors'))).toHaveLength(2);expect(f.calls.filter(call=>call.apiPath==='/api/credential-references')).toHaveLength(1);expect(f.calls.every(call=>call.path.startsWith('/workspaces/studio/'))).toBe(true);expect(f.navigate).not.toHaveBeenCalled()
})
it('shows a fixed current-context workspace validation error and does not continue to plan',async()=>{
 const f=await filled();f.setHandler(async()=>{throw {status:403,payload:{code:'workspace_unsupported',error:'SECRET_WORKSPACE_ERROR'}}});await f.submit();expect(f.text()).toContain('connector_request_failed');expect(f.text()).not.toContain('SECRET');expect(f.calls.map(call=>call.apiPath)).toEqual(['/api/connectors/validate']);expect(f.navigate).not.toHaveBeenCalled()
})

it('groups ordinary help outside labels in one closed disclosure with unique accessible descriptions',async()=>{
 const f=await filled()
 const verify=()=>{
  const disclosures=f.nodes().filter(node=>node.type==='details'&&node.props.children?.[0]?.type==='summary'&&textOf(node.props.children[0])==='Field help')
  expect(disclosures).toHaveLength(1);expect(disclosures[0].props.open).toBeUndefined()
  const ids=f.nodes().map(node=>node.props?.id).filter(Boolean);expect(new Set(ids).size).toBe(ids.length)
  for(const field of ['rooms','token']){
   const help=f.nodes().find(node=>node.props?.id==='connector-help-'+field);expect(help).toBeTruthy();expect(textOf(disclosures[0])).toContain(help.props.children)
   for(const id of (f.input(field).props['aria-describedby']??'').split(' ').filter(Boolean))expect(ids).toContain(id)
  }
  for(const label of f.nodes().filter(node=>node.type==='label'))expect(textOf(label)).not.toMatch(/Field help|Internal source adapter|Credential instructions/)
 }
 verify();f.setHandler(async()=>{throw {status:400,payload:{code:'connector_invalid',issues:[{field:'rooms',code:'invalid_format'}]}}});await f.submit();expect(f.text()).toContain('Check the marked fields.');expect(f.input('rooms').props['aria-invalid']).toBe(true)
 const toggle=f.nodes().find(node=>node.type==='input'&&node.props.type==='checkbox');toggle.props.onChange({target:{checked:true}});f.render();verify()
 const warning=f.nodes().find(node=>node.type==='small'&&node.props.id==='connector-env-help-token');expect(warning.props.children).toBe('Enter the environment variable name, not its value.');expect(f.input('token').props['aria-describedby']).toContain(warning.props.id)
})
it.each([
 ['adapter_restart_required','The adapter still uses earlier credentials.'],['credential_changed','Credential information changed.'],['credential_missing','Required credential information is missing.'],['adapter_changed','The adapter changed.'],['evidence_lifecycle_changed','The runtime changed.'],['credential_basis_unavailable','The credentials actually used by the adapter could not be confirmed.'],
])('renders %s as invalidated evidence with a fixed explanation and no automatic probe',async(code,explanation)=>{
 const f=fixture('page');await f.flush()
 f.setHandler(async call=>{
  if(call.apiPath==='/api/credential-references')return {schema:1,scope:'host',settingsRevision:7,observedAt:Date.now(),connections:[]}
  const data:any=f.snapshot(call.workspace),record={id:'old',sourceId:'same-source',level:'authentication',revision:7,current:false,status:code==='credential_basis_unavailable'?'unknown':'stale',code,finishedAt:Date.now(),evidenceMode:'configured-adapter',realCall:false}
  data.instances[0].layers.authentication=record
  data.diagnostics=[{...record,current:undefined,status:'passed',code:'identity_verified'}]
  return data
 })
 f.button('Refresh').props.onClick();await f.flush();await f.flush()
 const layer=f.nodes().find(n=>n.props?.['data-layer']==='authentication')
 expect(layer.props['data-state']).toBe(code==='credential_basis_unavailable'?'unknown':'stale')
 expect(textOf(layer)).toContain(explanation);expect(textOf(layer)).not.toContain('Identity verified')
 expect(f.text()).toContain('Earlier results may no longer apply.')
 if(['credential_missing','adapter_restart_required'].includes(code))expect(f.nodes().some(n=>n.type==='a'&&n.props.href==='#connections'&&textOf(n)==='Review connection settings')).toBe(true)
 if(code==='adapter_restart_required')expect(textOf(layer)).toContain('This page does not restart it automatically.')
 expect(f.calls.every(c=>c.body===undefined)).toBe(true);expect(f.navigate).not.toHaveBeenCalled();f.unmount()
})
