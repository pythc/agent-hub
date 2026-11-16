import {readFileSync} from 'node:fs'
import {createContext,runInContext} from 'node:vm'
import {expect,it,vi} from 'vitest'
import {configurationContent} from '../web/chat/configuration-plugin.ts'
import {workspaceBlockMessage,preserveWorkspaceLink,type WorkspaceTransport} from '../web/chat/workspace-transport.ts'
function fixture(href='http://localhost/configure',fetcher?:(path:string,options:any)=>Promise<any>){
 const events=new Map<string,Set<()=>void>>(),calls:{path:string;options:any}[]=[]
 const location={href,replace:vi.fn()},context=createContext({URL,Map,Set,Promise,Object,JSON,AbortSignal,AbortController,crypto,console,location,
  history:{replaceState(_state:unknown,_unused:string,url:URL){location.href=String(url)},pushState(_state:unknown,_unused:string,url:URL){location.href=String(url)}},Event,
  entryState:{account:null,operator:true,inventoryRequest:0},S:{token:'',authed:false},connectionStudioReset(){},integrationsReset(){},
  window:{addEventListener(name:string,fn:()=>void){if(!events.has(name))events.set(name,new Set());events.get(name)!.add(fn)},removeEventListener(name:string,fn:()=>void){events.get(name)?.delete(fn)}},
  fetch:async(path:string,options:any)=>{calls.push({path,options});return fetcher?fetcher(path,options):{ok:true,status:200,json:async()=>({ok:true})}},L:(en:string)=>en})
 runInContext(readFileSync(new URL('../src/ui/workspaces.js',import.meta.url),'utf8'),context)
 const app=readFileSync(new URL('../src/ui/application.js',import.meta.url),'utf8')
 runInContext(app.slice(app.indexOf('class ApiError'),app.indexOf('async function health()')),context)
 const get=(code:string)=>runInContext(code,context)
 const transport=get('workspaceBridge()') as WorkspaceTransport
 const ready=(managed=false)=>get(`workspaceContext.managed=${managed};workspaceContext.activeId=${managed?"'studio'":"''"};workspaceContext.items=${managed?"[{id:'studio',name:'Studio',kind:'organization'},{id:'other',name:'Other',kind:'organization'}]":"[]"};workspaceContext.discovered=true;S.authed=true;workspaceTransportCommitReady()`)
 return {context,get,transport,ready,calls,location,emit:(event:string)=>events.get(event)?.forEach(fn=>fn())}
}
const inventory={version:1,currentId:'studio',items:[{id:'studio',name:'Studio',kind:'organization'},{id:'other',name:'Other',kind:'organization'}]}
const response=(body:unknown,status=200)=>({ok:status>=200&&status<300,status,json:async()=>body})
it('exports the bridge from the existing content controller',async()=>{
 const plugin=configurationContent(),load=plugin.load as (id:string)=>unknown,text=await load.call({},'\0virtual:configuration-content')
 expect(String(text)).toContain('transport:workspaceBridge()');expect(String(text)).toContain('const configurationReady=startEntrySession()')
})
it('keeps explicit pending/ready/blocked states independent of swallowed initialization promises',async()=>{
 const b=fixture();expect(b.transport.context().state).toBe('pending');await expect(b.transport.request('/api/example')).rejects.toMatchObject({payload:{code:'workspace_pending'}});expect(b.calls).toEqual([])
 let settled=false;const waiting=b.transport.ready().then(()=>{settled=true});await Promise.resolve();expect(settled).toBe(false)
 b.ready();await waiting;expect(b.transport.context().state).toBe('ready');expect(b.transport.context()).toBe(b.transport.context())
 b.get("workspaceTransportBlock('workspace_initialization_failed')");await expect(b.transport.ready()).rejects.toMatchObject({payload:{code:'workspace_initialization_failed'}})
})
it('retains ordinary single-Runtime root requests after unsupported inventory without an explicit selector',async()=>{
 const b=fixture(undefined,async path=>path==='/workspaces'?response({},404):response({revision:1}));await b.get('workspaceDiscover()');b.get('S.authed=true;workspaceTransportCommitReady()')
 expect(b.transport.context()).toMatchObject({state:'ready',managed:false,activeId:''});expect(await b.transport.request('/api/example')).toEqual({revision:1});expect(b.calls.map(c=>c.path)).toEqual(['/workspaces','/api/example'])
})
it.each(['?workspace','?workspace=','?workspace=%20','?workspace=studio&workspace=studio','?workspace=studio&workspace=other','?workspace=../escape'])('blocks invalid explicit selector %s before any request',async query=>{
 const b=fixture('http://localhost/configure'+query);await expect(b.get('workspaceDiscover()')).rejects.toMatchObject({payload:{code:'workspace_invalid'}});await expect(b.transport.request('/api/example')).rejects.toMatchObject({payload:{code:'workspace_invalid'}});expect(b.calls).toEqual([])
})
it('blocks an explicit unsupported selector without a default capability read or write',async()=>{
 const b=fixture('http://localhost/configure?workspace=studio',async()=>response({},404));await expect(b.get('workspaceDiscover()')).rejects.toThrow('does not support');await expect(b.transport.request('/api/example')).rejects.toMatchObject({payload:{code:'workspace_unsupported'}});await expect(b.transport.request('/api/example',{change:true})).rejects.toMatchObject({payload:{code:'workspace_unsupported'}});expect(b.calls.map(c=>c.path)).toEqual(['/workspaces'])
})
it.each([response({},403),response({},500),response({...inventory,currentId:'missing'}),response({...inventory,items:[]}),response({...inventory,items:[inventory.items[0],inventory.items[0]]})])('does not fall back after a failed or malformed inventory',async result=>{
 const b=fixture('http://localhost/configure?workspace=studio',async()=>result);await expect(b.get('workspaceDiscover()')).rejects.toBeTruthy();await expect(b.transport.request('/api/example')).rejects.toBeTruthy();expect(b.calls.map(c=>c.path)).toEqual(['/workspaces'])
})
it('requires an explicitly selected ID to exist in the validated inventory',async()=>{
 const b=fixture('http://localhost/configure?workspace=missing',async()=>response(inventory));await expect(b.get('workspaceDiscover()')).rejects.toThrow('unavailable');await expect(b.transport.request('/api/example')).rejects.toBeTruthy();expect(b.calls).toHaveLength(1)
})
it('discovers the managed context and notifies subscribers synchronously after commit',async()=>{
 const b=fixture('http://localhost/configure?workspace=studio',async()=>response(inventory)),seen:any[]=[];const stop=b.transport.subscribe(()=>seen.push(b.transport.context()));await b.get('workspaceDiscover()');expect(seen.at(-1)).toMatchObject({state:'pending',managed:true,activeId:'studio'});b.get('S.authed=true;workspaceTransportCommitReady()');expect(seen.at(-1)).toMatchObject({state:'ready',activeId:'studio'});stop()
 await b.transport.request('/api/example');expect(b.calls.at(-1)!.path).toBe('/workspaces/studio/api/example')
})
it('committed workspace switch synchronizes the explicit selector before notifying during held secondary refreshes',async()=>{
 const b=fixture('http://localhost/configure?workspace=studio#tasks',async path=>response(path.endsWith('/configuration')?{current:{revision:1,config:{}},history:[]}:path.endsWith('/entry-setup')?{entries:[],revision:1}:{tasks:[]}));b.ready(true)
 b.get(`function dirty(){return false} function entryHasDraft(){return false} async function entryRun(label,fn){await fn()} function resetDraft(){} const operator={};const entryModel={};const teamStudio={};const executionView={};function resetGuideSession(){} async function loadGuideContext(){return new Promise(()=>{})}`)
 const seen:any[]=[];b.transport.subscribe(()=>seen.push(b.transport.context()));void b.get("workspaceSwitch('other')");await new Promise(resolve=>setImmediate(resolve));expect(seen.at(-1)).toMatchObject({state:'ready',activeId:'other',epoch:1});expect(new URL(b.location.href).searchParams.get('workspace')).toBe('other');await expect(b.transport.ready()).resolves.toMatchObject({state:'ready',activeId:'other'});await b.transport.request('/api/example');expect(b.calls.at(-1)!.path).toBe('/workspaces/other/api/example')
})
it.each(['epoch','activeId','accountId','sessionIsolation'])('rejects stale bindings before sending after %s changes, even for identical IDs/revisions',async change=>{
 const b=fixture();b.ready(true);const old=b.transport.context(),bound=b.transport.bind(old)
 b.get(change==='epoch'?'workspaceContext.epoch++':change==='activeId'?"workspaceContext.activeId='other'":change==='accountId'?"entryState.account={authenticated:true,user:{id:'another-account'}}":"workspaceContext.sessionIsolation='another-session'")
 expect(()=>b.transport.bind(old)).toThrow();await expect(bound.request('/api/example',{id:'same-id',revision:1})).rejects.toMatchObject({payload:{code:'workspace_obsolete'}});expect(b.calls).toEqual([])
})
it('rejects A→B→A replies and network errors from an obsolete context',async()=>{
 let complete!:(v:any)=>void;const b=fixture(undefined,()=>new Promise(resolve=>complete=resolve));b.ready(true);const pending=b.transport.bind(b.transport.context()).request('/api/example');b.get("workspaceContext.activeId='other';workspaceContext.epoch++;workspaceContext.activeId='studio';workspaceContext.epoch++");complete(response({revision:1}));await expect(pending).rejects.toMatchObject({payload:{code:'workspace_obsolete'}})
 let reject!:(e:Error)=>void;const c=fixture(undefined,()=>new Promise((_resolve,r)=>reject=r));c.ready();const failure=c.transport.bind(c.transport.context()).request('/api/example');c.get('workspaceSessionCommit()');reject(Error('old context failure'));await expect(failure).rejects.toMatchObject({payload:{code:'workspace_obsolete'}})
})
it('preserves legacy auth/origin/error handling and combines caller read cancellation with the timeout',async()=>{
 const b=fixture();b.ready();b.get("S.token='fixture-token'");const abort=new AbortController();await b.transport.request('/api/example',undefined,false,undefined,abort.signal)
 const sent=b.calls[0]!.options;expect(sent).toMatchObject({headers:{authorization:'Bearer fixture-token'},cache:'no-store',redirect:'error',credentials:'same-origin'});expect(sent.signal).not.toBe(abort.signal);abort.abort();expect(sent.signal.aborted).toBe(true)
 const c=fixture(undefined,async()=>response({code:'fixture_conflict',error:'Conflict'},409));c.ready();await expect(c.transport.request('/api/example')).rejects.toMatchObject({status:409,payload:{code:'fixture_conflict'}})
})
it('does not turn read cancellation into a claim of mutation cancellation or permit a publicRead scoped bypass',async()=>{
 const b=fixture();b.ready(true);const aborted=new AbortController();aborted.abort();await b.transport.request('/api/example',{value:1},false,undefined,aborted.signal);expect(b.calls[0]!.options.signal.aborted).toBe(false)
 await expect(b.transport.request('/api/example',undefined,true)).rejects.toMatchObject({payload:{code:'workspace_obsolete'}});await expect(b.transport.request('/api/example',undefined,false,'')).rejects.toMatchObject({payload:{code:'workspace_obsolete'}});expect(b.calls).toHaveLength(1)
})
it('uses real account IDs only when authenticated and otherwise rotates conservative page-session isolation',()=>{
 const b=fixture();b.ready();const initial=b.transport.context();expect(initial.accountId).toBeNull();const seen:any[]=[];b.transport.subscribe(()=>seen.push(b.transport.context()))
 b.get("entryState.account={authenticated:true,user:{id:'actual-account'}};workspaceSessionCommit()");expect(seen.at(-1)).toMatchObject({accountId:'actual-account',state:'pending'});expect(seen.at(-1).sessionIsolation).not.toBe(initial.sessionIsolation)
 b.get('entryState.account=null;workspaceSessionCommit()');expect(seen.at(-1).accountId).toBeNull();b.get('workspaceReset()');expect(seen.at(-1)).toMatchObject({state:'blocked',code:'workspace_disconnected'})
})
it('blocks and notifies on an actual unauthorized response, without inventing a stable identity',async()=>{
 const b=fixture(undefined,async()=>response({code:'token_required'},401));b.ready();const seen:any[]=[];b.transport.subscribe(()=>seen.push(b.transport.context()));await expect(b.transport.request('/api/example')).rejects.toMatchObject({status:401,payload:{code:'token_required'}});expect(seen.at(-1)).toMatchObject({state:'blocked',code:'workspace_session_ended',accountId:null})
})
it('rejects later URL identity changes and offers readable block reasons',async()=>{
 const b=fixture();b.ready();b.location.href='http://localhost/configure?workspace=studio';b.emit('roppo:navigation');await expect(b.transport.request('/api/example')).rejects.toMatchObject({payload:{code:'workspace_unsupported'}});expect(b.calls).toEqual([]);expect(workspaceBlockMessage(b.transport.context(),'en')).toContain('does not support');expect(workspaceBlockMessage(b.transport.context(),'zh-CN')).toContain('不支持')
})

it('does not treat the real swallowed connectHost failure as transport ready',async()=>{
 const b=fixture(undefined,async()=>response({},404));b.get(`S.authed=true;async function run(label,fn){try{await fn()}catch{}} async function snapshot(){throw Error('snapshot unavailable')} async function runtimeStatus(){} async function loadGuideContext(){} async function health(){} function ensureEntryInventory(){}`)
 const app=readFileSync(new URL('../src/ui/application.js',import.meta.url),'utf8');b.get(app.slice(app.indexOf('async function connectHost('),app.indexOf('async function refreshStatus()')))
 await b.get("connectHost('',true)");expect(b.transport.context()).toMatchObject({state:'blocked',code:'workspace_initialization_failed'});await expect(b.transport.ready()).rejects.toMatchObject({payload:{code:'workspace_initialization_failed'}})
})
it('does not treat the real swallowed startEntrySession failure as transport ready',async()=>{
 const b=fixture(undefined,async()=>{throw Error('session unavailable')});b.get(`entryState.operator=false;const entryPairCode='';function render(){} function entryError(){}`)
 const source=readFileSync(new URL('../src/ui/entry-session.js',import.meta.url),'utf8');b.get(source.slice(source.indexOf('async function startEntrySession()'),source.indexOf('function entryEdit(')))
 await b.get('startEntrySession()');expect(b.transport.context()).toMatchObject({state:'blocked',code:'workspace_session_required'});expect(b.transport.context().accountId).toBeNull()
})
it('cannot let an obsolete discovery failure overwrite a newer ready context',async()=>{
 let fail!:(e:Error)=>void;const b=fixture(undefined,()=>new Promise((_resolve,reject)=>fail=reject)),old=b.get('workspaceDiscover()')
 b.get('workspaceContext.epoch++');b.ready(true);fail(Error('obsolete inventory request'));await expect(old).rejects.toThrow();expect(b.transport.context()).toMatchObject({state:'ready',activeId:'studio'})
})

it('rejects an aborted read even if a mocked response ignores its signal',async()=>{
 const b=fixture();b.ready();const controller=new AbortController();controller.abort();await expect(b.transport.request('/api/example',undefined,false,undefined,controller.signal)).rejects.toMatchObject({name:'AbortError'})
})

it('keeps a committed explicit workspace ready after secondary refresh failure',async()=>{
 const b=fixture('http://localhost/configure?workspace=studio#tasks',async path=>response(path.endsWith('/configuration')?{current:{revision:1,config:{}},history:[]}:path.endsWith('/entry-setup')?{entries:[],revision:1}:{tasks:[]}));b.ready(true)
 b.get(`function dirty(){return false} function entryHasDraft(){return false} async function entryRun(label,fn){await fn()} function resetDraft(){} const operator={};const entryModel={};const teamStudio={};const executionView={};function resetGuideSession(){} async function loadGuideContext(){throw Error('secondary unavailable')}`)
 const seen:any[]=[];b.transport.subscribe(()=>seen.push({context:b.transport.context(),href:b.location.href}));await expect(b.get("workspaceSwitch('other')")).rejects.toThrow('secondary unavailable')
 expect(seen.at(-1).context).toMatchObject({state:'ready',activeId:'other'});expect(new URL(seen.at(-1).href).searchParams.get('workspace')).toBe('other');await expect(b.transport.ready()).resolves.toMatchObject({state:'ready',activeId:'other'})
})
it.each(['?workspace=other&unrelated=remove','?workspace=&unrelated=remove','?workspace=studio&workspace=other',''])('preserves workspace selector semantics through existing embedded navigation: %s',query=>{
 const b=fixture('http://localhost/configure'+query+'#tasks');b.ready(true);b.get(`const configurationHost={};function workspaceHash(){return 'execution'}`)
 const source=readFileSync(new URL('../src/ui/entry-session.js',import.meta.url),'utf8');b.get(source.slice(source.indexOf('function updateWorkspaceLocation('),source.indexOf('function applyWorkspaceLocation()')))
 b.context.window.dispatchEvent=()=>true;b.get('updateWorkspaceLocation(true)')
 const next=new URL(b.location.href);expect(next.searchParams.has('unrelated')).toBe(false);expect(next.hash).toBe('#execution')
 expect(next.searchParams.getAll('workspace')).toEqual(query?new URL('http://localhost/'+query).searchParams.getAll('workspace'):['studio'])
})

it.each(['?workspace=studio','?workspace=','?workspace=studio&workspace=other'])('keeps explicit selectors when capability navigation opens the existing picker: %s',query=>{
 const current=new URL('http://localhost/configure'+query+'#connectors'),next=preserveWorkspaceLink(new URL('http://localhost/configure#tasks'),current)
 expect(next.hash).toBe('#tasks');expect(next.searchParams.getAll('workspace')).toEqual(current.searchParams.getAll('workspace'))
 expect(preserveWorkspaceLink(new URL('http://localhost/configure?workspace=other#tasks'),current).searchParams.getAll('workspace')).toEqual(['other'])
 expect(preserveWorkspaceLink(new URL('http://different.example/configure#tasks'),current).search).toBe('')
})
