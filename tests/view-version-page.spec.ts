import {expect,it,vi} from 'vitest'
import {readFileSync} from 'node:fs'
import {createContext,runInContext} from 'node:vm'
import ts from 'typescript'
function fixture(selection='board/'+ 'a'.repeat(64)){
 const slots:any[]=[],effects:number[]=[],calls:any[]=[],pending:any[]=[];let index=0
 const owner=new AbortController(),rootFetch=vi.fn(()=>{throw Error('root fetch forbidden')})
 const workspace={context:{state:'ready',managed:true,activeId:'studio',epoch:1,accountId:'owner',sessionIsolation:'test',code:null},contextKey:'studio:1',readSignal:owner.signal,binding:{request(path:string,_body:any,_public:any,_scope:any,signal:AbortSignal){calls.push({path,url:'/workspaces/studio'+path,signal});return new Promise((resolve,reject)=>pending.push({resolve,reject}))}}}
 const react={useRef(value:any){const i=index++;if(!slots[i])slots[i]={kind:'ref',current:value};return slots[i]},useState(value:any){const i=index++;if(!slots[i])slots[i]={kind:'state',value:typeof value==='function'?value():value};return [slots[i].value,(next:any)=>{slots[i].value=typeof next==='function'?next(slots[i].value):next}]},useEffect(setup:any,deps:any[]){const i=index++,old=slots[i];if(!old||deps.some((v,n)=>!Object.is(v,old.deps[n]))){old?.cleanup?.();slots[i]={kind:'effect',setup,deps};effects.push(i)}}}
 const exports:any={}
 const context=createContext({exports,AbortController,AbortSignal,fetch:rootFetch,require(name:string){if(name==='react')return react;if(name==='react/jsx-runtime')return {jsx:(type:any,props:any,key:any)=>({type,props,key}),jsxs:(type:any,props:any,key:any)=>({type,props,key})};if(name==='./workspace-context.tsx')return {useWorkspaceTransport:()=>workspace};return {}}})
 runInContext(ts.transpileModule(readFileSync(new URL('../web/chat/view-version.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,context)
 const render=()=>{index=0;return exports.ViewVersionPage({selection,language:'en'})}
 const nodes=(tree:any):any[]=>!tree||typeof tree!=='object'?[]:[tree,...Object.values(tree.props??{}).flatMap(v=>Array.isArray(v)?v.flatMap(nodes):nodes(v))]
 return {workspace,owner,calls,pending,rootFetch,render,nodes,select(next:string){selection=next},flush(){for(const i of effects.splice(0))slots[i].cleanup=slots[i].setup()},unmount(){for(const s of slots)if(s?.kind==='effect')s.cleanup?.()},click(label:string){nodes(render()).find(n=>n.type==='button'&&n.props.children===label).props.onClick()}}
}
const tick=()=>new Promise(resolve=>setImmediate(resolve))
const metadata={reference:{schema:1,kind:'workspace-view',id:'board',version:'a'.repeat(64),sha256:'b'.repeat(64),visibility:'operator_workspace',retention:'subject_to_plugin_removal',publication:'not_tracked'},label:{en:'Retained board','zh-CN':'保留看板'},packageVersion:'1.0',current:false}
it('reads fixed metadata through the captured workspace only, without bundle/runtime or frames',async()=>{
 const p=fixture();p.render();p.flush();expect(p.calls[0].url).toBe('/workspaces/studio/api/workspace-views/board/versions/'+'a'.repeat(64));p.pending.shift().resolve(metadata);await tick();expect(JSON.stringify(p.render())).toContain('Retained board');expect(JSON.stringify(p.render())).toContain('not currently enabled');expect(p.nodes(p.render()).some(n=>n.type==='iframe')).toBe(false);expect(p.calls).toHaveLength(1);expect(p.rootFetch).not.toHaveBeenCalled();p.unmount()
})
it('drops old route responses and rejects a mismatched digest instead of falling back to current',async()=>{
 const p=fixture();p.render();p.flush();const old=p.pending.shift();p.select('board/'+'c'.repeat(64));p.render();p.flush();expect(p.calls[0].signal.aborted).toBe(true);old.resolve(metadata);p.pending.shift().resolve(metadata);await tick();expect(JSON.stringify(p.render())).not.toContain('Retained board');expect(JSON.stringify(p.render())).toContain('unavailable');p.unmount()
})
it('retries denial with the same pinned identity and clears metadata on lease invalidation',async()=>{
 const p=fixture();p.render();p.flush();p.pending.shift().reject({status:403});await tick();expect(JSON.stringify(p.render())).toContain('unavailable');p.click('Try again');p.render();p.flush();expect(p.calls[1].path).toBe(p.calls[0].path);p.pending.shift().resolve(metadata);await tick();expect(JSON.stringify(p.render())).toContain('Retained board');p.owner.abort();expect(JSON.stringify(p.render())).not.toContain('Retained board');p.unmount()
})
it('does not show late responses after unmount or owner invalidation',async()=>{
 for(const action of ['unmount','abort']){const p=fixture();p.render();p.flush();const pending=p.pending.shift();action==='unmount'?p.unmount():p.owner.abort();pending.resolve(metadata);await tick();expect(JSON.stringify(p.render())).not.toContain('Retained board')}
})
it('rejects malformed routes without making a request',()=>{
 for(const route of ['board','../board/'+ 'a'.repeat(64),'board/'+ 'a'.repeat(64)+'/extra','board/'+ 'A'.repeat(64)]){const p=fixture(route);p.render();p.flush();expect(p.calls).toEqual([]);expect(JSON.stringify(p.render())).toContain('unavailable');p.unmount()}
})
it('rejects malformed metadata fields',async()=>{
 for(const data of [{...metadata,current:'false'},{...metadata,reference:{...metadata.reference,id:'other'}},{...metadata,reference:{...metadata.reference,sha256:'bad'}},{...metadata,label:{}},null]){const p=fixture();p.render();p.flush();p.pending.shift().resolve(data);await tick();expect(JSON.stringify(p.render())).toContain('unavailable');p.unmount()}
})
it('refresh rechecks access and removes previously visible details on denial',async()=>{
 const p=fixture();p.render();p.flush();p.pending.shift().resolve(metadata);await tick();p.click('Refresh');p.render();p.flush();expect(JSON.stringify(p.render())).not.toContain('Retained board');p.pending.shift().reject({status:404});await tick();expect(JSON.stringify(p.render())).toContain('unavailable');p.unmount()
})
it('keeps the fixed route inside the workspace owner and disables the legacy root catalog',()=>{
 const main=readFileSync(new URL('../web/chat/main.tsx',import.meta.url),'utf8'),catalog=readFileSync(new URL('../web/chat/artifact-catalog.tsx',import.meta.url),'utf8')
 expect(main).toContain("hash.startsWith('artifact-view-version/')")
 expect(main).toContain('||scopedViewRoute||viewVersionRoute;')
 expect(main).toContain('useWorkspaceViews(!environmentRoute&&!scopedViewRoute&&!catalogRoute&&!viewVersionRoute)')
 expect(main).toContain('viewVersionRoute?<ViewVersionPage key={hash} selection={hash.slice(22)}')
 expect(catalog).toContain("'#artifact-view-version/'+reference.id+'/'+reference.version")
})
