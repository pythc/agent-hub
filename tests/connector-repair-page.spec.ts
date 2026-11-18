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
const code=transformSync(readFileSync(new URL('../web/chat/connector-management.tsx',import.meta.url),'utf8'),{loader:'tsx',format:'cjs',jsx:'automatic'}).code+'\nmodule.exports.__Setup=Repair;'
const require=createRequire(import.meta.url)
const definitions=[{kind:'fixture-im',label:'Fixture IM',setupAvailable:true,setup:{description:'Fixture'},fields:[{name:'rooms',label:'Rooms',required:true,input:'tags',credential:false,help:'Internal source adapter onboarding instructions'},{name:'token',label:'Token',required:true,credential:true,help:'Credential instructions'}]}]
const deferred=()=>{let resolve!:(value:any)=>void,reject!:(reason:any)=>void;const promise=new Promise<any>((r,j)=>{resolve=r;reject=j});return {promise,resolve,reject}}
interface Call {path:string;apiPath:string;workspace:string;body:any;signal?:AbortSignal}
const repairRead={sourceId:'same-source',kind:'fixture-im',revision:7,label:'Existing connection',fields:{rooms:['ROOM']},credentialAvailability:[{field:'token',available:true}],enabled:false}
function fixture(component:'page'|'setup'='setup',initial?:(call:Call)=>Promise<any>){
 const slots:any[]=[],initialized=new Set<number>(),effects:(()=>void)[]=[],cleanups:(()=>void)[]=[],deps:any[][]=[],calls:Call[]=[],created:boolean[]=[],listeners=new Map<string,Set<()=>void>>(),navigate=vi.fn()
 let cursor=0,tree:any,epoch=1,liveId='studio',lease:WorkspacePageContext
 const enabled=new Map<string,boolean>()
 function snapshot(workspace:string){return {revision:7,definitions,instances:[{id:'same-source',kind:'fixture-im',label:workspace+' connection',enabled:false,repairAvailable:true,scopeCount:1,layers:{},credentialReferences:[]}],tools:[],diagnostics:[]}}
 let handler:(call:Call)=>Promise<any>=initial??(async call=>{
  if(call.apiPath==='/api/connectors/repair/read')return repairRead
  if(call.apiPath==='/api/connectors/repair/plan')return {id:'repair-plan',expiresAt:Date.now()+60000}
  if(call.apiPath==='/api/plugin-market/connection/apply')return {applied:true}
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
 function render(){cursor=0;tree=component==='setup'?exports.__Setup({definition:definitions[0],target:{sourceId:'same-source',kind:'fixture-im',revision:7},L:(en:string)=>en,close(){},saved:()=>created.push(true)}):exports.ConnectorManagement({language:'en'});for(const node of nodes()){const ref=node.props?.ref;if(ref){const element=node.type==='dialog'?{showModal(){},addEventListener(){},removeEventListener(){},close(){}}:{focus(){}};if(typeof ref==='function')ref(element);else ref.current=element}}while(effects.length)effects.shift()!();return tree}
 const flush=async()=>{await new Promise(resolve=>setImmediate(resolve));render()}
 const submitCallback=()=>nodes().find(node=>node.type==='form')?.props.onSubmit
 const submit=async()=>{submitCallback()?.({preventDefault(){}});await flush()}
 const input=(id:string)=>nodes().find(node=>node.type==='input'&&node.props.id==='repair-field-'+id)
 const change=(id:string,value:string)=>{input(id).props.onChange({target:{value}});render()}
 const button=(label:string)=>nodes().find(node=>node.type==='button'&&textOf(node)===label)
 function switchTo(id:string){const old=lease;active.reads.abort();liveId=id;epoch++;active=newLease();lease=active.value;render();render();return old}
 render()
 return {calls,created,navigate,snapshot,nodes,text,render,flush,submit,submitCallback,input,change,button,switchTo,lease:()=>lease,setHandler:(next:typeof handler)=>{handler=next},emit:(name:string)=>listeners.get(name)?.forEach(callback=>callback()),unmount:()=>cleanups.forEach(cleanup=>cleanup?.())}
}
function textOf(value:any):string{if(value==null||typeof value==='boolean')return '';if(typeof value==='string'||typeof value==='number')return String(value);return Array.isArray(value)?value.map(textOf).join(''):textOf(value.props?.children)}

it('reads safe editable fields through the binding and preserves blank credentials without changing people or enabled state',async()=>{
 const f=fixture();await f.flush();expect(f.input('rooms').props.value).toBe('ROOM');expect(f.input('token').props.value).toBe('');expect(f.text()).toContain('Leave a credential blank');await f.submit();const plan=f.calls.find(c=>c.apiPath.endsWith('/repair/plan'))!;expect(plan.body).toEqual({sourceId:'same-source',revision:7,fields:{rooms:'ROOM'},credentials:{},credentialMode:'value'});expect(f.calls.some(c=>c.apiPath.includes('/check')||c.apiPath.includes('/probe'))).toBe(false);await f.submit();expect(f.calls.at(-1)?.body).toEqual({id:'repair-plan'});expect(f.created).toEqual([true]);f.unmount()
})
it('single-flights planning, clears replacement credentials and retries exactly the same plan after interrupted apply',async()=>{
 const f=fixture();await f.flush();f.change('token','PRIVATE_REPLACEMENT');const wait=deferred();f.setHandler(async call=>call.apiPath.endsWith('/repair/plan')?wait.promise:Promise.reject(Error('PRIVATE_SERVER_ERROR')));const submit=f.submitCallback();submit({preventDefault(){}});submit({preventDefault(){}});expect(f.calls.filter(c=>c.apiPath.endsWith('/repair/plan'))).toHaveLength(1);wait.resolve({id:'same-plan',expiresAt:Date.now()+60000});await f.flush();expect(f.text()).not.toContain('PRIVATE_REPLACEMENT');await f.submit();expect(f.text()).not.toContain('PRIVATE_SERVER_ERROR');expect(f.text()).toContain('Retry same repair plan');f.setHandler(async()=>({applied:true}));await f.submit();const applies=f.calls.filter(c=>c.apiPath.endsWith('/apply'));expect(applies).toHaveLength(2);expect(applies.map(c=>c.body)).toEqual([{id:'same-plan'},{id:'same-plan'}]);expect(f.created).toEqual([true]);f.unmount()
})
it('drops late repair reads and apply results after workspace changes or unmount',async()=>{
 const read=deferred(),f=fixture('setup',()=>read.promise);f.switchTo('other');read.resolve(repairRead);await f.flush();expect(f.calls.every(c=>c.path.startsWith('/workspaces/'))).toBe(true);f.unmount()
 const g=fixture();await g.flush();await g.submit();const apply=deferred();g.setHandler(()=>apply.promise);void g.submit();g.unmount();apply.resolve({applied:true});await g.flush();expect(g.created).toEqual([])
})
it('does not render secrets or environment references returned under credential fields',async()=>{
 const f=fixture('setup',async()=>({...repairRead,fields:{rooms:'ROOM',token:'PRIVATE_OLD_ENV'}}));await f.flush();expect(f.text()).not.toContain('PRIVATE_OLD_ENV');expect(f.text()).toContain('could not be confirmed');expect(f.input('token')).toBeUndefined();f.unmount()
})
it('clears secret inputs on switching credential mode and sends only newly supplied environment names',async()=>{
 const f=fixture();await f.flush();f.change('token','PRIVATE_VALUE');f.nodes().find(n=>n.type==='input'&&n.props.type==='checkbox').props.onChange({target:{checked:true}});f.render();expect(f.input('token').props.value).toBe('');f.change('token','NEW_KEY');await f.submit();expect(f.calls.find(c=>c.apiPath.endsWith('/repair/plan'))!.body).toMatchObject({credentialMode:'environment',credentials:{token:'NEW_KEY'}});f.unmount()
})
it('reports failed rollback as setup recovery required and prevents another apply',async()=>{
 const f=fixture();await f.flush();await f.submit();f.setHandler(async()=>{throw {payload:{code:'setup_recovery_required',error:'PRIVATE_PATH'}}});await f.submit();expect(f.text()).toContain('host requires setup recovery');expect(f.text()).not.toContain('PRIVATE_PATH');const before=f.calls.length;await f.submit();expect(f.calls).toHaveLength(before);f.unmount()
})
it('offers repair only on a disabled repairable instance',async()=>{
 const f=fixture('page');await f.flush();expect(f.button('Repair connection')).toBeDefined();f.setHandler(async call=>{const data:any=f.snapshot(call.workspace);data.instances[0].enabled=true;return data});f.button('Refresh').props.onClick();await f.flush();expect(f.button('Repair connection')).toBeUndefined();f.unmount()
})
it('freezes submitted non-secret fields and retained credential intent in the review before apply',async()=>{
 const f=fixture();await f.flush();f.change('rooms','UPDATED_ROOM\nSECOND_ROOM');const wait=deferred();f.setHandler(async call=>call.apiPath.endsWith('/repair/plan')?wait.promise:{applied:true})
 void f.submit();await f.flush();wait.resolve({id:'reviewed-plan',expiresAt:Date.now()+60000});await f.flush()
 expect(f.text()).toContain('Review repair changes');expect(f.text()).toContain('Rooms');expect(f.text()).toContain('UPDATED_ROOM\nSECOND_ROOM');expect(f.text()).toContain('Token');expect(f.text()).toContain('Keep existing credential reference');expect(f.input('rooms')).toBeUndefined()
 await f.submit();expect(f.calls.at(-1)?.body).toEqual({id:'reviewed-plan'});f.unmount()
})
it.each([false,true])('retains replacement intent after clearing credentials without exposing value or environment reference (%s)',async environment=>{
 const f=fixture();await f.flush()
 if(environment){f.nodes().find(n=>n.type==='input'&&n.props.type==='checkbox').props.onChange({target:{checked:true}});f.render()}
 f.change('token',environment?'PRIVATE_ENV_REFERENCE':'PRIVATE_SECRET_VALUE');await f.submit()
 expect(f.text()).toContain('Replace credential reference (value hidden)');expect(f.text()).not.toContain('Keep existing credential reference');expect(f.text()).not.toMatch(/PRIVATE_ENV_REFERENCE|PRIVATE_SECRET_VALUE/)
 f.setHandler(async()=>{throw Error('interrupted')});await f.submit();expect(f.text()).toContain('Replace credential reference (value hidden)');expect(f.text()).not.toMatch(/PRIVATE_ENV_REFERENCE|PRIVATE_SECRET_VALUE/);f.unmount()
})
