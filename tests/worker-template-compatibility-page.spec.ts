import {readFileSync} from 'node:fs'
import {createContext,runInContext} from 'node:vm'
import {createRequire} from 'node:module'
import {transformSync} from 'esbuild'
import {expect,it,vi} from 'vitest'
import type {WorkspaceBinding,WorkspaceTransportContext} from '../web/chat/workspace-transport.ts'

type WorkspacePageContext={context:WorkspaceTransportContext;binding:WorkspaceBinding;contextKey:string;readSignal:AbortSignal}

// Execute the actual page and ledger. The hook/transport lifecycle harness is
// not browser evidence or a claim that a local server supports workspaces.
const require=createRequire(import.meta.url)
const compile=(path:string,loader:'tsx'|'ts')=>transformSync(readFileSync(new URL(path,import.meta.url),'utf8'),{loader,format:'cjs',jsx:'automatic'}).code
const pageCode=compile('../web/chat/worker-templates.tsx','tsx')+'\nmodule.exports.parts={TemplatePage};'
const ledgerCode=compile('../web/chat/worker-template-requests.ts','ts')
const manifest={apiVersion:1,type:'worker-template',id:'reviewer',version:'1.0.0',label:'Safe recipe',description:'Local fixture recipe',digest:'a'.repeat(64),instructions:'Review evidence.',requirements:{capabilities:['managed','tools','resume','history','contextBudget'],tools:['read']},acceptance:['Check evidence'],examples:[],source:{name:'Fixture',url:'https://example.test/recipe',license:'MIT'}}
const attemptBody=(extra:Record<string,unknown>={})=>({id:manifest.id,version:manifest.version,digest:manifest.digest,revision:3,settingsRevision:9,workerId:'safe-worker',label:'Safe Worker',backend:'codex',...extra})
const deferred=()=>{let resolve!:(v:any)=>void,reject!:(v:any)=>void;const promise=new Promise<any>((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject}}
const compatibility=(body:any)=>({...body,compatible:true,managementEnabled:true,backendState:'available',capabilities:[...new Set(['managed','tools','resume','history','contextBudget',...manifest.requirements.capabilities])].map(name=>({name,requiredByTemplate:manifest.requirements.capabilities.includes(name),requiredByHost:['managed','tools','resume','history','contextBudget'].includes(name),available:true})),tools:manifest.requirements.tools.map(name=>({name,available:false,requiresAuthorization:true})),grants:[],startsWorker:false})
function fixture(){
 let slots:any[]=[],initialized=new Set<number>(),effects:(()=>void)[]=[],index=0,mount=0,currentKey='',tree:any,wrapper:any,active=true
 const calls:{owner:string;path:string;body:any;signal:AbortSignal|undefined}[]=[],writes:{mount:number;value:any}[]=[],frames:(()=>void)[]=[],timers:(()=>void)[]=[],focus:number[]=[],links:any[]=[],storageData=new Map<string,string>()
 const storage={getItem:(key:string)=>storageData.get(key)??null,setItem:(key:string,value:string)=>{storageData.set(key,value)}}
 const context:WorkspaceTransportContext={state:'ready',code:null,managed:true,activeId:'studio',epoch:1,accountId:'account-a',sessionIsolation:'page-a'}
 const key=(value:WorkspaceTransportContext)=>JSON.stringify([value.managed,value.activeId,value.epoch,value.accountId,value.sessionIsolation])
 let owner:WorkspacePageContext,ownerReads:AbortController
 let snapshot:any={revision:3,settingsRevision:9,managementEnabled:true,templates:[{manifest}],starters:[],backends:[{id:'codex',label:'Codex',eligible:true},{id:'acp',label:'ACP',eligible:false}]}
 let handler:(path:string,body:any)=>Promise<any>=async(path,body)=>path.endsWith('/compatibility')?compatibility(body):path.endsWith('/preview')?{manifest,conflict:false}:path.endsWith('/export')?manifest:path==='/api/worker-templates'?snapshot:{ok:true}
 function bind(next:WorkspaceTransportContext){
  ownerReads=new AbortController();const captured={...next},contextKey=key(captured),binding={context:captured,async request<T>(path:string,body?:unknown,_publicRead?:boolean,_scope?:string,signal?:AbortSignal):Promise<T>{
   if(!active||owner.contextKey!==contextKey)throw {status:409,payload:{code:'workspace_obsolete'}}
   calls.push({owner:contextKey,path,body:structuredClone(body),signal})
   const value=await handler(path,body)
   if(!active||owner.contextKey!==contextKey)throw {status:409,payload:{code:'workspace_obsolete'}}
   return value
  }}
  owner={context:captured,contextKey,binding,readSignal:ownerReads.signal}
 }
 bind(context)
 const hooks={useState:(initial:any)=>{const at=index++,store=slots,id=mount;if(!initialized.has(at)){initialized.add(at);store[at]={kind:'state',value:typeof initial==='function'?initial():initial}}return [store[at].value,(value:any)=>{store[at].value=typeof value==='function'?value(store[at].value):value;writes.push({mount:id,value:store[at].value})}]},useRef:(initial:any)=>{const at=index++;if(!initialized.has(at)){initialized.add(at);slots[at]={kind:'ref',value:{current:initial}}}return slots[at].value},useEffect:(setup:()=>any,deps:any[])=>{const at=index++,old=slots[at];if(!old||deps.some((value,i)=>!Object.is(value,old.deps[i]))){const store=slots;effects.push(()=>{old?.cleanup?.();store[at]={kind:'effect',setup,deps,cleanup:setup()}})}}}
 const rootFetch=vi.fn(()=>{throw Error('direct root fetch forbidden')}),createURL=vi.fn(()=> 'blob:old-template'),revokeURL=vi.fn()
 const LocalURL:any=function(value:string){return new URL(value)};LocalURL.createObjectURL=createURL;LocalURL.revokeObjectURL=revokeURL
 const environment:any={module:{exports:{}},exports:{},AbortController,AbortSignal,Blob,URL:LocalURL,crypto,structuredClone,location:{origin:'https://hub.example',reload:vi.fn()},sessionStorage:storage,
  fetch:rootFetch,requestAnimationFrame:(callback:()=>void)=>frames.push(callback),setTimeout:(callback:()=>void)=>timers.push(callback),document:{createElement:()=>{const link={href:'',download:'',click:vi.fn()};links.push(link);return link}},
  require:(name:string)=>name==='react'?hooks:name==='react/jsx-runtime'?require(name):name==='lucide-react'?new Proxy({},{get:()=>()=>null}):name==='./worker-template-requests.ts'?ledger:name==='./workspace-context.tsx'?{useWorkspaceTransport:()=>owner}:name.endsWith('.css')?{}:(()=>{throw Error('Unexpected import '+name)})()}
 environment.exports=environment.module.exports;const vm=createContext(environment)
 runInContext(ledgerCode,vm);const ledger=environment.module.exports;environment.module={exports:{}};environment.exports=environment.module.exports;runInContext(pageCode,vm);const exported=environment.module.exports
 const nodes=(value:any):any[]=>value==null||typeof value!=='object'?[]:Array.isArray(value)?value.flatMap(nodes):[value,...nodes(value.props?.children)]
 const all=()=>nodes(tree)
 function cleanup(){for(const slot of slots)if(slot?.kind==='effect')slot.cleanup?.()}
 function render(){
  wrapper=exported.WorkerTemplates({language:'en'})
  if(currentKey!==wrapper.key){cleanup();slots=[];initialized=new Set();effects=[];mount++;currentKey=wrapper.key}
  index=0;tree=wrapper.type(wrapper.props)
  for(const node of all()){const ref=node.props?.ref;if(ref&&typeof ref==='object')ref.current={focus:()=>focus.push(mount)}}
  while(effects.length)effects.shift()!()
  return tree
 }
 async function flush(){await new Promise(resolve=>setImmediate(resolve));render()}
 function button(label:string){return all().find(node=>node.type==='button'&&(text(node).trim()===label||node.props['aria-label']===label))}
 async function click(label:string){const node=button(label);expect(node,'Missing button '+label).toBeDefined();node.props.onClick();await flush()}
 function field(label:string){return all().find(node=>node.type==='label'&&text(node).startsWith(label))?.props.children.find((node:any)=>node?.type==='input'||node?.type==='select')}
 function fill(label:string,value:string){field(label).props.onChange({target:{value}});render()}
 function submit(css:string){all().find(node=>node.type==='form'&&node.props.className===css).props.onSubmit({preventDefault(){}})}
 return {render,flush,click,fill,submit,button,all,field,calls,writes,focus,links,rootFetch,createURL,revokeURL,frames,timers,storageData,ledger,storage,
  get owner(){return owner},get snapshot(){return snapshot},set snapshot(value:any){snapshot=value},get mount(){return mount},get wrapper(){return wrapper},reload:environment.location.reload,text:()=>text(tree),setHandler:(next:typeof handler)=>{handler=next},
  replay(){for(const slot of slots)if(slot?.kind==='effect'){slot.cleanup?.();slot.cleanup=slot.setup()}},unmount(){cleanup()},abortOwner(){ownerReads.abort()},switch(next:Partial<WorkspaceTransportContext>){ownerReads.abort();bind({...owner.context,...next});render()},
  seed(body=attemptBody()){const ledgerInstance=new ledger.TemplateRequestLedger(ledger.templateLedgerScope(owner.context,'https://hub.example'),storage);return ledgerInstance.prepare('/create',body)},
 }
}
function text(value:any):string{if(value==null||typeof value==='boolean')return '';if(typeof value==='string'||typeof value==='number')return String(value);return Array.isArray(value)?value.map(text).join(''):text(value.props?.children)}
async function loaded(f=fixture()){f.render();await f.flush();return f}
async function reviewed(f=fixture()){await loaded(f);await f.click('Review recipe');return f}
async function startCreate(f:ReturnType<typeof fixture>){await f.click('Create Worker');await f.flush();f.fill('Worker ID','safe-worker');f.fill('Display name','Safe Worker');f.submit('template-create');await f.flush()}

it('shows required capability gaps and lets operators inspect an ineligible backend without creating',async()=>{
 const f=await reviewed();await f.click('Create Worker');await f.flush();expect(f.text()).toContain('Required capabilities are available');expect(f.text()).toContain('Not currently offered');expect(f.all().filter(n=>n.type==='option').every((n:any)=>!n.props.disabled)).toBe(true)
 f.setHandler(async(path,body)=>path.endsWith('/compatibility')?{...compatibility(body),compatible:false,capabilities:compatibility(body).capabilities.map((c:any)=>({...c,available:c.name!=='history'}))}:f.snapshot)
 f.fill('Execution backend','acp');f.fill('Worker ID','worker');f.fill('Display name','Worker');f.submit('template-create');expect(f.calls.some(c=>c.path.endsWith('/create'))).toBe(false);await f.flush();expect(f.text()).toContain('history · Missing');expect(f.button('Create paused Worker').props.disabled).toBe(true);f.unmount()
})
it('discards late backend checks, and requires the exact current check before new creation',async()=>{
 const f=await reviewed(),pending=deferred();f.setHandler(async(path,body)=>path.endsWith('/compatibility')?(body.backend==='codex'?pending.promise:compatibility(body)):f.snapshot)
 await f.click('Create Worker');f.fill('Execution backend','acp');await f.flush();const first=f.calls.find(c=>c.path.endsWith('/compatibility'))!;pending.resolve({...compatibility(first.body),compatible:false,backendState:'missing'});await f.flush();expect(f.text()).toContain('Required capabilities are available');f.fill('Worker ID','worker');f.fill('Display name','Worker');f.submit('template-create');await f.flush();expect(f.calls.find(c=>c.path.endsWith('/create'))?.body.backend).toBe('acp');f.unmount()
})
it('rejects mismatched and internally inconsistent responses before creating',async()=>{
 for(const change of [(v:any)=>({...v,digest:'b'.repeat(64)}),(v:any)=>({...v,settingsRevision:10}),(v:any)=>({...v,grants:['tool']}),(v:any)=>({...v,capabilities:[]}),(v:any)=>({...v,tools:[{name:'unrequested',available:true,requiresAuthorization:true}]}),(v:any)=>({...v,startsWorker:true})]){
  const f=await reviewed();f.setHandler(async(path,body)=>path.endsWith('/compatibility')?change(compatibility(body)):f.snapshot);await f.click('Create Worker');await f.flush();expect(f.text()).toContain('Compatibility could not be verified');f.fill('Worker ID','worker');f.submit('template-create');expect(f.calls.some(c=>c.path.endsWith('/create'))).toBe(false);f.unmount()
 }
})
it('does not gate completion of a previous creation on compatibility availability',async()=>{
 const f=fixture(),attempt=f.seed();await loaded(f);f.setHandler(async(path)=>{if(path.endsWith('/compatibility'))throw Error('unavailable');return path==='/api/worker-templates'?f.snapshot:{ok:true}});await f.click('Complete previous creation');expect(f.calls.find(c=>c.path.endsWith('/create'))?.body).toEqual({...attempt.body,requestId:attempt.requestId});expect(f.calls.some(c=>c.path.endsWith('/compatibility'))).toBe(false);f.unmount()
})
it('ignores checks after workspace change or closing creation',async()=>{
 for(const close of ['workspace','cancel']){const f=await reviewed(),pending=deferred();f.setHandler(async(path)=>path.endsWith('/compatibility')?pending.promise:f.snapshot);await f.click('Create Worker');const input=f.calls.at(-1)!.body;close==='workspace'?f.switch({activeId:'new',epoch:2}):await f.click('Cancel');pending.resolve(compatibility(input));await f.flush();expect(f.text()).not.toContain('Required capabilities are available');expect(f.calls.some(c=>c.path.endsWith('/create'))).toBe(false);f.unmount()}
})
it('invalidates a successful preflight when settings change and never silently picks another backend',async()=>{
 const f=await reviewed();await f.click('Create Worker');await f.flush();expect(f.text()).toContain('Required capabilities are available');const pending=deferred();f.snapshot={...f.snapshot,settingsRevision:10,backends:[{id:'acp',label:'ACP',eligible:true}]};f.setHandler(async(path)=>path.endsWith('/compatibility')?pending.promise:f.snapshot)
 await f.click('Refresh templates');f.fill('Worker ID','worker');f.submit('template-create');expect(f.field('Execution backend').props.value).toBe('codex');expect(f.text()).toContain('codex · unavailable');expect(f.calls.some(c=>c.path.endsWith('/create'))).toBe(false);const input=f.calls.at(-1)!.body;expect(input.settingsRevision).toBe(10);pending.resolve({...compatibility(input),backendState:'missing',compatible:false});await f.flush();expect(f.button('Create paused Worker').props.disabled).toBe(true);f.unmount()
})
it('allows explicit preflight retry without changing the creation ledger',async()=>{
 const f=await reviewed();let checks=0;f.setHandler(async(path,body)=>{if(path.endsWith('/compatibility')){if(checks++===0)throw Error('probe failed');return compatibility(body)}return f.snapshot});await f.click('Create Worker');await f.flush();expect(f.text()).toContain('Compatibility could not be verified');await f.click('Check again');await f.flush();expect(f.text()).toContain('Required capabilities are available');expect(f.calls.some(c=>c.path.endsWith('/create'))).toBe(false);expect(f.calls.filter(c=>c.path.endsWith('/compatibility')).every(c=>c.body.requestId===undefined)).toBe(true);f.unmount()
})
