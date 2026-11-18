import {expect,it,vi} from 'vitest'
import {readFileSync} from 'node:fs'
import {createContext,runInContext} from 'node:vm'
import ts from 'typescript'
function fixture(){
 const slots:any[]=[],effects:number[]=[],calls:any[]=[],pending:any[]=[];let index=0
 const owner=new AbortController(),rootFetch=vi.fn(()=>{throw Error('root fetch forbidden')})
 const workspace={context:{state:'ready',managed:true,activeId:'studio',epoch:1,accountId:'owner',sessionIsolation:'test',code:null},contextKey:'studio:1',readSignal:owner.signal,binding:{request(path:string,_body:any,_public:any,_scope:any,signal:AbortSignal){calls.push({path,body:_body,url:'/workspaces/studio'+path,signal});return new Promise((resolve,reject)=>pending.push({resolve,reject}))}}}
 const react={useRef(value:any){const i=index++;if(!slots[i])slots[i]={kind:'ref',current:value};return slots[i]},useState(value:any){const i=index++;if(!slots[i])slots[i]={kind:'state',value:typeof value==='function'?value():value};return [slots[i].value,(next:any)=>{slots[i].value=typeof next==='function'?next(slots[i].value):next}]},useEffect(setup:any,deps:any[]){const i=index++,old=slots[i];if(!old||deps.some((v,n)=>!Object.is(v,old.deps[n]))){old?.cleanup?.();slots[i]={kind:'effect',setup,deps};effects.push(i)}}}
 const exports:any={}
 const context=createContext({exports,AbortController,AbortSignal,fetch:rootFetch,require(name:string){if(name==='react')return react;if(name==='react/jsx-runtime')return {jsx:(type:any,props:any,key:any)=>({type,props,key}),jsxs:(type:any,props:any,key:any)=>({type,props,key})};if(name==='./workspace-context.tsx')return {useWorkspaceTransport:()=>workspace};return {}}})
 runInContext(ts.transpileModule(readFileSync(new URL('../web/chat/local-diagnostics.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,context)
 const render=()=>{index=0;return exports.LocalDiagnostics({language:'en'})}
 const nodes=(tree:any):any[]=>!tree||typeof tree!=='object'?[]:[tree,...Object.values(tree.props??{}).flatMap(v=>Array.isArray(v)?v.flatMap(nodes):nodes(v))]
 return {workspace,owner,calls,pending,rootFetch,render,nodes,flush(){for(const i of effects.splice(0))slots[i].cleanup=slots[i].setup()},unmount(){for(const s of slots)if(s?.kind==='effect')s.cleanup?.()},click(label:string){nodes(render()).find(n=>n.type==='button'&&n.props.children===label).props.onClick()}}
}
const tick=()=>new Promise(resolve=>setImmediate(resolve))
const snapshot={revision:3,platform:'linux',nodeVersion:'22.19.0',sandboxDriver:'bubblewrap',browser:{state:'unsupported',code:'browser_isolation_unverified'},result:null,busy:false}
async function loaded(){const p=fixture();p.render();p.flush();p.pending.shift().resolve(snapshot);await tick();return p}
it('reads only the captured workspace and starts a check only on explicit click',async()=>{
 const p=await loaded();expect(p.calls).toHaveLength(1);expect(p.calls[0].url).toBe('/workspaces/studio/api/local-diagnostics');expect(p.calls[0].body).toBeUndefined();expect(JSON.stringify(p.render())).toContain('no browser was opened')
 const action=p.nodes(p.render()).find(n=>n.type==='button'&&n.props.children==='Check sandbox').props.onClick;action();action();expect(p.calls).toHaveLength(2);expect(p.calls[1].body).toEqual({revision:3})
 p.pending.shift().resolve({...snapshot,result:{revision:3,checkedAt:1,state:'passed',code:'sandbox_started'}});await tick();expect(JSON.stringify(p.render())).toContain('startup passed');expect(p.rootFetch).not.toHaveBeenCalled();p.unmount()
})
it('ignores late probe results after unmount and invalidation',async()=>{
 for(const end of ['unmount','abort']){const p=await loaded();p.click('Check sandbox');end==='unmount'?p.unmount():p.owner.abort();p.pending.shift().resolve({...snapshot,result:{revision:3,checkedAt:1,state:'passed',code:'sandbox_started'}});await tick();expect(JSON.stringify(p.render())).not.toContain('startup passed')}
})
it('drops old workspace results and permits a new workspace read',async()=>{
 const p=await loaded();p.click('Check sandbox');const old=p.pending.shift();p.workspace.contextKey='other:2';p.render();p.flush();p.pending.shift().resolve({...snapshot,platform:'darwin'});await tick();old.resolve({...snapshot,result:{revision:3,checkedAt:1,state:'passed',code:'sandbox_started'}});await tick();expect(JSON.stringify(p.render())).toContain('darwin');expect(JSON.stringify(p.render())).not.toContain('startup passed');p.unmount()
})
it('clears stale results on refresh, handles conflict, and requires rereading before retry',async()=>{
 const p=await loaded();p.click('Check sandbox');p.pending.shift().reject({payload:{code:'settings_conflict'}});await tick();expect(JSON.stringify(p.render())).toContain('Refresh before checking again');p.click('Refresh');p.pending.shift().resolve({...snapshot,revision:4});await tick();p.click('Check sandbox');expect(p.calls.at(-1).body).toEqual({revision:4});p.pending.shift().resolve({...snapshot,revision:4,result:{revision:4,checkedAt:1,state:'disabled',code:'sandbox_disabled'}});await tick();expect(JSON.stringify(p.render())).toContain('Commands are disabled');p.unmount()
})
it('rejects invalid or revision-mismatched responses and exposes no raw errors',async()=>{
 const p=fixture();p.render();p.flush();p.pending.shift().resolve({...snapshot,result:{revision:2,checkedAt:1,state:'passed',code:'secret'}});await tick();expect(JSON.stringify(p.render())).toContain('unavailable');expect(JSON.stringify(p.render())).not.toContain('secret');p.unmount()
})
it('offers refresh for another in-flight check without launching a duplicate',async()=>{
 const p=fixture();p.render();p.flush();p.pending.shift().resolve({...snapshot,busy:true});await tick();p.click('Check sandbox');expect(p.calls).toHaveLength(1);p.click('Refresh');expect(p.calls).toHaveLength(2);p.unmount()
})
it('routes and navigation keep diagnostics inside the workspace owner',()=>{
 const main=readFileSync(new URL('../web/chat/main.tsx',import.meta.url),'utf8'),navigation=readFileSync(new URL('../web/chat/navigation.tsx',import.meta.url),'utf8'),config=readFileSync(new URL('../web/chat/configuration.tsx',import.meta.url),'utf8')
 expect(main).toContain("hash==='environment'");expect(main).toContain('environmentRoute?<LocalDiagnostics language={lang}/>');expect(main).toContain('useWorkspaceViews(!environmentRoute&&');expect(navigation).toContain('/configure#environment');expect(config).toContain("location.hash !== '#environment'")
})
it('ignores an older refresh response when a newer read finished first',async()=>{
 const p=await loaded();p.click('Refresh');const old=p.pending.shift();p.click('Refresh');p.pending.shift().resolve({...snapshot,revision:5,platform:'new-host'});await tick();old.resolve({...snapshot,platform:'old-host'});await tick();expect(JSON.stringify(p.render())).toContain('new-host');expect(JSON.stringify(p.render())).not.toContain('old-host');p.unmount()
})
it('shows failed sandbox checks without suggesting unrestricted fallback',async()=>{
 const p=await loaded();p.click('Check sandbox');p.pending.shift().resolve({...snapshot,result:{revision:3,checkedAt:1,state:'failed',code:'sandbox_start_failed'}});await tick();expect(JSON.stringify(p.render())).toContain('No unrestricted fallback was used');expect(JSON.stringify(p.render())).not.toContain('startup passed');p.unmount()
})
