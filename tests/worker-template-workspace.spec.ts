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
 let handler:(path:string,body:any)=>Promise<any>=async(path,body)=>path.endsWith('/preview')?{manifest,conflict:false}:path.endsWith('/export')?manifest:path==='/api/worker-templates'?snapshot:{ok:true}
 function bind(next:WorkspaceTransportContext){
  ownerReads=new AbortController();const captured={...next},contextKey=key(captured),binding={context:captured,async request<T>(path:string,body?:unknown,_publicRead?:boolean,_scope?:string,signal?:AbortSignal):Promise<T>{
   if(!active||owner.contextKey!==contextKey)throw {status:409,payload:{code:'workspace_obsolete'}}
   calls.push({owner:contextKey,path,body:structuredClone(body),signal})
   const value=path.endsWith('/compatibility')?compatibility(body):await handler(path,body)
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
it('keys the real page by the C2 owner and routes its initial GET through the bound transport with a page/owner read signal',async()=>{
 const f=await loaded();expect(f.wrapper.key).toBe(f.owner.contextKey);expect(f.calls[0]).toMatchObject({path:'/api/worker-templates',owner:f.owner.contextKey,body:undefined});expect(f.calls[0]!.signal).toBeInstanceOf(AbortSignal);expect(f.rootFetch).not.toHaveBeenCalled();f.unmount();expect(f.calls[0]!.signal!.aborted).toBe(true)
})
it('keeps preview/export/create/remove requests and paused/permission semantics on their original binding',async()=>{
 const f=await reviewed();await f.click('Export');expect(f.createURL).toHaveBeenCalledTimes(1);expect(f.links[0].click).toHaveBeenCalledTimes(1);expect(f.text()).toContain('Installation grants no permissions and runs no tasks.')
 await startCreate(f);expect(f.text()).toContain('Worker created and paused.');const creation=f.calls.find(call=>call.path.endsWith('/create'))!;expect(creation.body).toEqual({...attemptBody(),requestId:expect.any(String)});expect(creation.signal).toBeUndefined()
 await f.click('Remove recipe');await f.click('Confirm removal');expect(f.calls.find(call=>call.path.endsWith('/remove'))!.body).toMatchObject({id:'reviewer',version:'1.0.0',revision:3,requestId:expect.any(String)})
 expect(f.calls.every(call=>call.owner===f.owner.contextKey)).toBe(true);expect(f.calls.filter(call=>call.body!==undefined).every(call=>call.signal===undefined)).toBe(true);expect(f.rootFetch).not.toHaveBeenCalled()
})
it('installs only the reviewed recipe and digest using the original revision',async()=>{
 const f=fixture();f.snapshot={...f.snapshot,templates:[],starters:[manifest]};await reviewed(f);await f.click('Install reviewed recipe');expect(f.calls.find(call=>call.path.endsWith('/install'))!.body).toEqual({manifest,digest:manifest.digest,revision:3,requestId:expect.any(String)});expect(f.text()).toContain('Existing Workers are unchanged.')
})
it('retries an uncertain creation with its exact original body and request ID after a settings refresh',async()=>{
 const f=await reviewed();let creates=0
 f.setHandler(async(path)=>{if(path.endsWith('/create')&&creates++===0)throw Error('lost response');return path==='/api/worker-templates'?{...f.snapshot,revision:300,settingsRevision:900}:{ok:true}})
 await startCreate(f);const first=f.calls.find(call=>call.path.endsWith('/create'))!;expect(f.text()).toContain('Complete previous creation');await f.click('Complete previous creation');const all=f.calls.filter(call=>call.path.endsWith('/create'));expect(all).toHaveLength(2);expect(all[1]!.body).toEqual(first.body);expect(all[1]!.owner).toBe(first.owner);expect(f.text()).toContain('Worker creation confirmed.')
})
it('retains an issued POST as pending but never adopts or replays it in a new workspace/account',async()=>{
 const f=await reviewed(),pending=deferred();f.setHandler(async(path)=>path.endsWith('/create')?pending.promise:path==='/api/worker-templates'?f.snapshot:{ok:true});await startCreate(f);const original=f.calls.find(call=>call.path.endsWith('/create'))!,oldMount=f.mount
 f.switch({activeId:'other',accountId:'account-b',epoch:2,sessionIsolation:'page-b'});await f.flush();const writes=f.writes.filter(write=>write.mount===oldMount).length;pending.resolve({ok:true});await f.flush()
 expect(f.calls.filter(call=>call.path.endsWith('/create'))).toHaveLength(1);expect(f.text()).not.toContain('Safe Worker');expect(f.text()).not.toContain('creation confirmed');expect(f.writes.filter(write=>write.mount===oldMount)).toHaveLength(writes);expect(original.signal).toBeUndefined()
 f.switch({activeId:'studio',accountId:'account-a',epoch:3,sessionIsolation:'page-return'});await f.flush();expect(f.text()).toContain('Complete previous creation');expect(f.calls.filter(call=>call.path.endsWith('/create'))).toHaveLength(1)
 f.setHandler(async path=>path==='/api/worker-templates'?f.snapshot:{ok:true});await f.click('Complete previous creation');expect(f.calls.filter(call=>call.path.endsWith('/create'))[1]!.body).toEqual(original.body)
})
it('suppresses late preview, errors and focus after context replacement',async()=>{
 const f=await loaded(),pending=deferred();f.setHandler(async path=>path.endsWith('/preview')?pending.promise:f.snapshot);await f.click('Review recipe');const oldMount=f.mount
 f.switch({epoch:2,activeId:'other',accountId:'other-account'});await f.flush();pending.resolve({manifest:{...manifest,label:'PRIVATE_OLD_RECIPE'},conflict:false});await f.flush();f.frames.forEach(frame=>frame());expect(f.text()).not.toContain('PRIVATE_OLD_RECIPE');expect(f.focus).not.toContain(oldMount)
})
it.each(['unmount','owner-abort'] as const)('cancels template GET reads on %s without turning a late read into a notice',async how=>{
 const f=fixture(),pending=deferred();f.setHandler(()=>pending.promise);f.render();const signal=f.calls[0]!.signal!;if(how==='unmount')f.unmount();else f.abortOwner();expect(signal.aborted).toBe(true);const written=f.writes.length;pending.resolve({...f.snapshot,templates:[{manifest:{...manifest,label:'PRIVATE_LATE_READ'}}]});await new Promise(resolve=>setImmediate(resolve));expect(f.writes).toHaveLength(written);expect(f.rootFetch).not.toHaveBeenCalled()
})
it('StrictMode replay starts a fresh page read and discards the cleaned-up old read',async()=>{
 const f=fixture(),old=deferred();let calls=0;f.setHandler(async()=>++calls===1?old.promise:{...f.snapshot,templates:[{manifest:{...manifest,label:'Fresh recipe'}}]});f.render();const first=f.calls[0]!.signal!;f.replay();await f.flush();expect(first.aborted).toBe(true);expect(f.calls[1]!.signal!.aborted).toBe(false);old.resolve({...f.snapshot,templates:[{manifest:{...manifest,label:'PRIVATE_STALE_READ'}}]});await f.flush();expect(f.text()).toContain('Fresh recipe');expect(f.text()).not.toContain('PRIVATE_STALE_READ')
})
it('does not construct or click an export Blob after unmount/context end',async()=>{
 const f=await reviewed(),pending=deferred();f.setHandler(async path=>path.endsWith('/export')?pending.promise:f.snapshot);await f.click('Export');f.unmount();pending.resolve(manifest);await new Promise(resolve=>setImmediate(resolve));expect(f.createURL).not.toHaveBeenCalled();expect(f.links).toHaveLength(0);expect(f.calls.find(call=>call.path.endsWith('/export'))!.signal).toBeUndefined()
})
it('guards the download click even if context ends immediately after URL creation and still revokes the URL',async()=>{
 const f=await reviewed();f.createURL.mockImplementation(()=>{f.abortOwner();return 'blob:old-template'});await f.click('Export');expect(f.links.every(link=>link.click.mock.calls.length===0)).toBe(true);f.timers.forEach(timer=>timer());expect(f.revokeURL).toHaveBeenCalledWith('blob:old-template')
})
it('ignores an imported file finishing after the old page unmounts',async()=>{
 const f=await loaded();await f.click('Import recipe');const file=deferred(),input=f.all().find(node=>node.type==='input'&&node.props.type==='file');input.props.onChange({target:{files:[{size:10,name:'recipe.json',text:()=>file.promise}]}});f.unmount();const written=f.writes.length;file.resolve('PRIVATE_OLD_FILE');await new Promise(resolve=>setImmediate(resolve));expect(f.writes).toHaveLength(written);expect(f.calls.filter(call=>call.body!==undefined)).toHaveLength(0)
})
it('shows legacy uncertainty without displaying its body, label or offering a legacy replay',async()=>{
 const f=fixture(),raw=JSON.stringify([{path:'/create',body:{label:'PRIVATE_LEGACY_LABEL',workerId:'PRIVATE_LEGACY_WORKER'},requestId:crypto.randomUUID()}]);f.storageData.set('roppo.worker-template.pending.v1',raw);await loaded(f);expect(f.text()).toContain('An earlier request needs review.');expect(f.text()).not.toContain('PRIVATE_LEGACY');expect(f.button('Complete previous creation')).toBeUndefined();expect(f.storageData.get('roppo.worker-template.pending.v1')).toBe(raw);expect(f.calls.every(call=>call.body===undefined)).toBe(true)
})
it('blocks new creation for unrecognized current storage while retaining valid pending reconciliation only',async()=>{
 const f=fixture(),attempt=f.seed(),entry=[...f.storageData.keys()].find(key=>key.includes('.v2.'))!,raw=JSON.stringify([attempt,{body:{label:'PRIVATE_UNRECOGNIZED'}}]);f.storageData.set(entry,raw);await reviewed(f);expect(f.text()).toContain('Some earlier requests need review.');expect(f.text()).not.toContain('PRIVATE_UNRECOGNIZED');expect(f.button('Create Worker').props.disabled).toBe(true);expect(f.button('Complete previous creation').props.disabled).toBe(false)
 await f.click('Complete previous creation');expect(f.calls.find(call=>call.path.endsWith('/create'))!.body).toEqual({...attempt.body,requestId:attempt.requestId});expect(f.storageData.get(entry)).toBe(raw)
})
it('does not silently discard old intents when the current partition already holds twenty pending creations',async()=>{
 const f=fixture();for(let i=0;i<20;i++)f.seed(attemptBody({workerId:'worker-'+i,label:'Worker '+i}));await reviewed(f);expect(f.button('Create Worker').props.disabled).toBe(true);expect(f.all().filter(node=>node.type==='button'&&text(node)==='Complete previous creation')).toHaveLength(20);expect(f.text()).toContain('Some earlier requests need review.');expect(f.calls.filter(call=>call.path.endsWith('/create'))).toHaveLength(0)
})
it('keeps unknown server errors fixed and clears only definitive current mutation failures',async()=>{
 const f=await reviewed();f.setHandler(async path=>{if(path.endsWith('/create'))throw {status:500,payload:{code:'PRIVATE_ERROR',error:'PRIVATE_RAW'}};return f.snapshot});await startCreate(f);expect(f.text()).not.toContain('PRIVATE_');expect(f.text()).toContain('Complete previous creation')
 f.setHandler(async path=>{if(path.endsWith('/create'))throw {status:400,payload:{code:'template_capabilities_unavailable',error:'PRIVATE_ERROR'}};return f.snapshot});await f.click('Complete previous creation');expect(f.text()).toContain('cannot meet these capabilities');expect(f.button('Complete previous creation')).toBeUndefined()
})
it('uses ordinary 14px-or-larger styles for the new reconciliation notices',()=>{
 const css=readFileSync(new URL('../web/chat/worker-templates.css',import.meta.url),'utf8');expect(css).not.toMatch(/font-size:(?:11|12|13)px/);expect(css).toContain('prefers-reduced-motion');expect(pageCode).not.toContain('fetch(')
})

it.each([['workspace_unavailable',403],['workspace_unsupported',404],['workspace_PRIVATE_CODE',403]] as const)('shows a fixed unavailable error for current %s instead of silently treating it as a context switch',async(code,status)=>{
 const f=await loaded();f.setHandler(async()=>{throw {status,payload:{code,error:'PRIVATE_SERVER_TEXT'}}});const before=f.calls.length;await f.click('Review recipe');expect(f.text()).toContain('This workspace is unavailable. Reload to continue.');expect(f.text()).not.toContain('PRIVATE');expect(f.calls).toHaveLength(before+1);expect(f.button('Reload page')).toBeDefined();await f.click('Reload page');expect(f.reload).toHaveBeenCalledTimes(1);expect(f.rootFetch).not.toHaveBeenCalled()
})
it('shows a current forbidden initial read as fixed unavailable and waits for an explicit reload',async()=>{
 const f=fixture();f.setHandler(async()=>{throw {status:403,payload:{code:'workspace_unavailable',error:'PRIVATE_SERVER_TEXT'}}});await loaded(f);expect(f.calls).toHaveLength(1);expect(f.text()).toContain('This workspace is unavailable.');expect(f.button('Reload page')).toBeDefined();expect(f.text()).not.toContain('PRIVATE')
})
it('drops a late forbidden result from an obsolete owner without adding an error or retry to the new page',async()=>{
 const f=await loaded(),pending=deferred();f.setHandler(async path=>path.endsWith('/preview')?pending.promise:f.snapshot);await f.click('Review recipe');const oldOwner=f.calls.at(-1)!.owner;f.switch({activeId:'new-workspace',epoch:2});await f.flush();const before=f.calls.length;pending.reject({status:403,payload:{code:'workspace_unavailable',error:'PRIVATE_OLD_ERROR'}});await f.flush();expect(f.calls).toHaveLength(before);expect(f.calls.filter(call=>call.owner===oldOwner)).toHaveLength(2);expect(f.button('Reload page')).toBeUndefined();expect(f.text()).not.toContain('PRIVATE');expect(f.text()).not.toContain('This workspace is unavailable.')
})

it('refuses a new creation before POST when browser storage cannot durably save it',async()=>{
 const f=await reviewed();f.storage.setItem=()=>{throw Error('PRIVATE_QUOTA')};await startCreate(f);expect(f.calls.filter(call=>call.path.endsWith('/create'))).toHaveLength(0);expect(f.text()).toContain('Browser could not save this request. Reload before creating again.');expect(f.text()).not.toContain('PRIVATE_QUOTA');expect(f.button('Reload page')).toBeDefined();expect(f.button('Create paused Worker').props.disabled).toBe(true)
 await f.click('Refresh templates');expect(f.button('Create paused Worker').props.disabled).toBe(true);expect(f.text()).toContain('Browser could not save this request.');expect(f.calls.filter(call=>call.path.endsWith('/create'))).toHaveLength(0)
})
it('does not send a new creation if persistence readback cannot be confirmed',async()=>{
 const f=await reviewed(),read=f.storage.getItem,write=f.storage.setItem;let saved=false;f.storage.setItem=(key,value)=>{write(key,value);saved=true};f.storage.getItem=key=>{if(saved)throw Error('PRIVATE_READBACK');return read(key)};await startCreate(f);expect(f.calls.filter(call=>call.path.endsWith('/create'))).toHaveLength(0);expect(f.text()).toContain('Browser could not save this request.');expect(f.text()).not.toContain('PRIVATE_READBACK');expect(f.button('Create paused Worker').props.disabled).toBe(true)
})
