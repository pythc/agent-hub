import {readFileSync} from 'node:fs'
import {createContext,runInContext} from 'node:vm'
import {transformSync} from 'esbuild'
import {expect,it,vi} from 'vitest'
import {recoveryPackageSchema} from '../src/recovery-package-contract.ts'
const code=transformSync(readFileSync(new URL('../web/chat/recovery-package-export.tsx',import.meta.url),'utf8'),{loader:'tsx',format:'cjs',jsx:'automatic'}).code
const diagnostic={payload:{format:'agent-hub-recovery-diagnostic',schema:1,application:'0.10.0',taskAlias:crypto.randomUUID(),execution:'active',unknownEffects:true,session:'unavailable',nextSafeAction:'reconcile_effects',checkpoints:[{stage:'tool',origin:'transition'}],scope:'retained_local_observation',excluded:'content_credentials_paths_sessions_and_remote_verification',replayAllowed:false},sha256:'a'.repeat(64)}
function fixture(){
 const slots:any[]=[],effects:(()=>void)[]=[],calls:any[]=[],pending:any[]=[],links:any[]=[],blobs:Blob[]=[],timers:(()=>void)[]=[];let index=0,tree:any
 const owner=new AbortController(),workspace={contextKey:'studio:1',readSignal:owner.signal,binding:{request(path:string,body:any){calls.push({path,body});return new Promise((resolve,reject)=>pending.push({resolve,reject}))}}}
 let task:any={id:'PRIVATE_TASK_ID',revision:5,observed:'b'.repeat(64)}
 const react={useRef(v:any){const n=index++;return slots[n]??(slots[n]={current:v})},useState(v:any){const n=index++;if(!slots[n])slots[n]={value:v};return [slots[n].value,(x:any)=>{slots[n].value=typeof x==='function'?x(slots[n].value):x}]},useEffect(fn:any,deps:any[]){const n=index++,old=slots[n];if(!old||deps.some((v,i)=>!Object.is(v,old.deps[i]))){old?.cleanup?.();slots[n]={deps};effects.push(()=>{slots[n].cleanup=fn()})}}}
 const createURL=vi.fn((blob:Blob)=>{blobs.push(blob);return 'blob:diagnostic'}),revokeURL=vi.fn(),rootFetch=vi.fn(()=>{throw Error('root fetch forbidden')})
 const context=createContext({module:{exports:{}},AbortController,AbortSignal,Blob,URL:{createObjectURL:createURL,revokeObjectURL:revokeURL},document:{createElement(){const link={href:'',download:'',click:vi.fn()};links.push(link);return link}},setTimeout(fn:()=>void){timers.push(fn)},fetch:rootFetch,require(name:string){if(name==='react')return react;if(name==='react/jsx-runtime')return {jsx:(type:any,props:any,key:any)=>({type,props,key}),jsxs:(type:any,props:any,key:any)=>({type,props,key})};if(name==='./workspace-context.tsx')return {useWorkspaceTransport:()=>workspace};if(name==='../../src/recovery-package-contract.ts')return {recoveryPackageSchema};throw Error(name)}})
 runInContext(code,context)
 const render=()=>{index=0;tree=(context.module.exports as any).RecoveryPackageExport({task,language:'en'});for(const f of effects.splice(0))f();return tree}
 const nodes=(t:any):any[]=>!t||typeof t!=='object'?[]:Array.isArray(t)?t.flatMap(nodes):[t,...nodes(t.props?.children)]
 const text=(t:any):string=>t==null||typeof t==='boolean'?'':typeof t==='string'||typeof t==='number'?String(t):Array.isArray(t)?t.map(text).join(''):text(t.props?.children)
 const flush=async()=>{await new Promise(r=>setImmediate(r));render()}
 const click=()=>nodes(tree).find(n=>n.type==='button').props.onClick()
 render();return {render,flush,click,calls,pending,links,blobs,timers,createURL,revokeURL,rootFetch,workspace,owner,text:()=>text(tree),change(patch:any){task={...task,...patch};render()},unmount(){for(const s of slots)s?.cleanup?.()}}
}
it('exports only after explicit click through the bound workspace and uses a fixed non-identifying filename',async()=>{
 const f=fixture();expect(f.calls).toEqual([]);f.click();expect(f.calls[0]).toEqual({path:'/api/execution-trace/recovery-package',body:{ticketId:'PRIVATE_TASK_ID',revision:5,observed:'b'.repeat(64)}});f.pending.shift().resolve(diagnostic);await f.flush()
 expect(f.links[0].download).toBe('recovery-diagnostic.json');expect(f.links[0].click).toHaveBeenCalledTimes(1);expect(JSON.parse(await f.blobs[0]!.text())).toEqual(diagnostic);expect(await f.blobs[0]!.text()).not.toContain('PRIVATE_TASK_ID');expect(f.text()).toContain('checksum is not proof of authenticity');expect(f.rootFetch).not.toHaveBeenCalled();f.timers.forEach(fn=>fn());expect(f.revokeURL).toHaveBeenCalledWith('blob:diagnostic');f.unmount()
})
it('keeps duplicate clicks single-flight and retries a failed request without exposing raw errors',async()=>{
 const f=fixture();f.click();f.click();expect(f.calls).toHaveLength(1);f.pending.shift().reject(Error('PRIVATE_ERROR'));await f.flush();expect(f.text()).toContain('could not be verified');expect(f.text()).not.toContain('PRIVATE_ERROR');f.click();f.pending.shift().resolve(diagnostic);await f.flush();expect(f.calls).toHaveLength(2);expect(f.links[0].click).toHaveBeenCalledTimes(1);f.unmount()
})
it.each(['task','observed','revision','workspace','binding','lease','abort','unmount'])('discards a late response after %s changes',async change=>{
 const f=fixture();f.click();const pending=f.pending.shift()
 if(change==='task')f.change({id:'OTHER_TASK'})
 if(change==='observed')f.change({observed:'c'.repeat(64)})
 if(change==='revision')f.change({revision:6})
 if(change==='workspace'){f.workspace.contextKey='other:2';f.render()}
 if(change==='binding'){f.workspace.binding={...f.workspace.binding};f.render()}
 if(change==='lease'){f.workspace.readSignal=new AbortController().signal;f.render()}
 if(change==='abort')f.owner.abort()
 if(change==='unmount')f.unmount()
 pending.resolve(diagnostic);await f.flush();expect(f.createURL).not.toHaveBeenCalled();expect(f.links).toEqual([]);f.unmount()
})
it('rejects invalid packages before creating a file and permits retry',async()=>{
 for(const bad of [{...diagnostic,sha256:'bad'},{...diagnostic,payload:{...diagnostic.payload,replayAllowed:true}},{...diagnostic,payload:{...diagnostic.payload,originalText:'PRIVATE_CONTENT'}}]){const f=fixture();f.click();f.pending.shift().resolve(bad);await f.flush();expect(f.createURL).not.toHaveBeenCalled();expect(f.text()).toContain('could not be verified');f.click();f.pending.shift().resolve(diagnostic);await f.flush();expect(f.links[0].click).toHaveBeenCalledTimes(1);f.unmount()}
})
it('does not click a download if context ends while the blob URL is created',async()=>{
 const f=fixture();f.createURL.mockImplementation(()=>{f.owner.abort();return 'blob:revoked'});f.click();f.pending.shift().resolve(diagnostic);await f.flush();expect(f.links).toEqual([]);f.timers.forEach(fn=>fn());expect(f.revokeURL).toHaveBeenCalledWith('blob:revoked');f.unmount()
})
it('mounts the export control only with a selected trace task',()=>{
 const source=readFileSync(new URL('../web/chat/execution-trace.tsx',import.meta.url),'utf8');expect(source).toContain('<RecoveryPackageExport task={task} language={language}/>');expect(source).toContain('{task?<article className="trace-task-detail">')
})
