import {readFileSync} from 'node:fs'
import {createContext,runInContext} from 'node:vm'
import ts from 'typescript'
import {expect,it,vi} from 'vitest'

/** Runs the actual page module and its actual UI handlers against a deferred C1 binding.
 * This is a hook/network simulation, not browser or real multiworkspace acceptance. */
function pageFixture(){
 const slots:any[]=[],effects:number[]=[],writes:any[]=[],calls:any[]=[],pending:any[]=[],timers:any[]=[];let index=0,active='studio',provided=true,currentId='a'.repeat(64)
 const owner=new AbortController(),assign=vi.fn(),replace=vi.fn(),rootFetch=vi.fn(()=>{throw Error('unscoped fetch forbidden')})
 const originalBinding={context:{state:'ready',managed:true,activeId:'studio'},request(path:string,body?:unknown,publicRead?:boolean,scope?:string,signal?:AbortSignal){
  if(active!=='studio')return Promise.reject({status:409,payload:{code:'workspace_obsolete'}})
  calls.push({path,url:'/workspaces/studio'+path,body,publicRead,scope,signal});return new Promise((resolve,reject)=>pending.push({path,resolve,reject}))
 }}
 const workspace={context:originalBinding.context,binding:originalBinding,contextKey:'["studio",1]',readSignal:owner.signal}
 const react={useRef(value:any){const i=index++;if(!slots[i])slots[i]={kind:'ref',current:value};return slots[i]},useState(value:any){const i=index++;if(!slots[i])slots[i]={kind:'state',value:typeof value==='function'?value():value};return [slots[i].value,(next:any)=>{slots[i].value=typeof next==='function'?next(slots[i].value):next;writes.push({i,value:slots[i].value})}]},useEffect(setup:any,deps:any[]){const i=index++,old=slots[i];if(!old||deps.some((v,n)=>!Object.is(v,old.deps[n]))){old?.cleanup?.();slots[i]={kind:'effect',setup,deps};effects.push(i)}}}
 const exports:any={},context=createContext({exports,AbortController,AbortSignal,URLSearchParams,Map,Set,Date,Object,Promise,crypto,fetch:rootFetch,location:{assign,replace},setInterval(callback:any){const timer={callback,cleared:false};timers.push(timer);return timer},clearInterval(timer:any){timer.cleared=true},require(id:string){if(id==='react')return react;if(id==='react/jsx-runtime')return {jsx:(type:any,props:any,key:any)=>({type,props,key}),jsxs:(type:any,props:any,key:any)=>({type,props,key})};if(id==='lucide-react')return new Proxy({},{get:()=>()=>null});if(id==='./workspace-context.tsx')return {useWorkspaceTransport(){if(!provided)throw Error('workspace_owner_required');return workspace}};if(id==='./artifact-result-model.ts')return {artifactIdValid:(id:string)=>/^[a-f0-9]{64}$/.test(id),artifactReference:(v:any,id:string)=>v?.id===id?v:null,artifactDownload:(id:string)=>'/workspaces/studio/goal-artifacts/'+id};return {}}})
 const source=ts.transpileModule(readFileSync(new URL('../web/chat/artifact-result.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText
 runInContext(source,context)
 return {calls,pending,writes,timers,owner,assign,replace,rootFetch,workspace,
  select(id:string){currentId=id},render(){index=0;return exports.ArtifactResult({id:currentId,language:'en'})},flush(){for(const i of effects.splice(0))slots[i].cleanup=slots[i].setup()},unmount(){for(const slot of slots)if(slot?.kind==='effect')slot.cleanup?.()},replay(){for(const slot of slots)if(slot?.kind==='effect'){slot.cleanup?.();slot.cleanup=slot.setup()}},switchContext(){active='other';owner.abort()},withoutOwner(){provided=false},stateValues:()=>slots.filter(s=>s.kind==='state').map(s=>s.value),
 }
}
const tick=()=>new Promise(resolve=>setImmediate(resolve))

const descriptor=(id='a'.repeat(64))=>({id,name:'report.pdf',version:1,bytes:2,sha256:'b'.repeat(64),mediaType:'application/pdf',availability:'retained'})
it('loads through captured workspace authority and cancels stale reads on navigation',async()=>{
 const p=pageFixture();p.render();p.flush();expect(p.calls[0].url).toBe('/workspaces/studio/goal-artifact-versions/'+'a'.repeat(64));const old=p.pending.shift();p.select('c'.repeat(64));p.render();p.flush();expect(p.calls[0].signal.aborted).toBe(true);const count=p.writes.length;old.resolve(descriptor());await tick();expect(p.writes.length).toBe(count);p.pending.shift().resolve(descriptor('c'.repeat(64)));await tick();expect(JSON.stringify(p.render())).toContain('c'.repeat(64));expect(p.rootFetch).not.toHaveBeenCalled()
})
it('does not publish delayed data or raw errors after unmount or workspace invalidation',async()=>{
 for(const mode of ['unmount','switchContext'] as const){const p=pageFixture();p.render();p.flush();const old=p.pending.shift();p[mode]();const count=p.writes.length;old.resolve(descriptor());await tick();expect(p.writes.length).toBe(count)}
 const p=pageFixture();p.render();p.flush();p.pending.shift().reject(Error('SECRET'));await tick();expect(JSON.stringify(p.render())).not.toContain('SECRET')
})
it('replays StrictMode with a fresh signal and makes no request for invalid ids',()=>{
 const p=pageFixture();p.render();p.flush();p.replay();expect(p.calls[0].signal.aborted).toBe(true);expect(p.calls[1].signal.aborted).toBe(false);p.unmount();const q=pageFixture();q.select('../bad');q.render();q.flush();expect(q.calls).toHaveLength(0)
})
