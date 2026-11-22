import {readFileSync} from 'node:fs'
import {createContext,runInContext} from 'node:vm'
import ts from 'typescript'
import {expect,it,vi} from 'vitest'

/** Runs the actual page module and its actual UI handlers against a deferred C1 binding.
 * This is a hook/network simulation, not browser or real multiworkspace acceptance. */
function pageFixture(){
 const slots:any[]=[],effects:number[]=[],writes:any[]=[],calls:any[]=[],pending:any[]=[],timers:any[]=[];let index=0,active='studio',provided=true
 const owner=new AbortController(),assign=vi.fn(),replace=vi.fn(),rootFetch=vi.fn(()=>{throw Error('unscoped fetch forbidden')})
 const originalBinding={context:{activeId:'studio'},request(path:string,body?:unknown,publicRead?:boolean,scope?:string,signal?:AbortSignal){
  if(active!=='studio')return Promise.reject({status:409,payload:{code:'workspace_obsolete'}})
  calls.push({path,url:'/workspaces/studio'+path,body,publicRead,scope,signal});return new Promise((resolve,reject)=>pending.push({path,resolve,reject}))
 }}
 const workspace={binding:originalBinding,contextKey:'["studio",1]',readSignal:owner.signal}
 const react={useRef(value:any){const i=index++;if(!slots[i])slots[i]={kind:'ref',current:value};return slots[i]},useState(value:any){const i=index++;if(!slots[i])slots[i]={kind:'state',value:typeof value==='function'?value():value};return [slots[i].value,(next:any)=>{slots[i].value=typeof next==='function'?next(slots[i].value):next;writes.push({i,value:slots[i].value})}]},useEffect(setup:any,deps:any[]){const i=index++,old=slots[i];if(!old||deps.some((v,n)=>!Object.is(v,old.deps[n]))){old?.cleanup?.();slots[i]={kind:'effect',setup,deps};effects.push(i)}}}
 const exports:any={},context=createContext({exports,AbortController,AbortSignal,URLSearchParams,Map,Set,Date,Object,Promise,crypto,fetch:rootFetch,location:{assign,replace},setInterval(callback:any){const timer={callback,cleared:false};timers.push(timer);return timer},clearInterval(timer:any){timer.cleared=true},require(id:string){if(id==='react')return react;if(id==='react/jsx-runtime')return {jsx:(type:any,props:any,key:any)=>({type,props,key}),jsxs:(type:any,props:any,key:any)=>({type,props,key})};if(id==='lucide-react')return new Proxy({},{get:()=>()=>null});if(id==='./workspace-context.tsx')return {useWorkspaceTransport(){if(!provided)throw Error('workspace_owner_required');return workspace}};if(id==='./execution-status-view.ts')return {};return {}}})
 const source=ts.transpileModule(readFileSync(new URL('../web/chat/execution-trace.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText
 runInContext(source,context)
 return {calls,pending,writes,timers,owner,assign,replace,rootFetch,workspace,
  render(){index=0;return exports.ExecutionTrace({language:'en'})},flush(){for(const i of effects.splice(0))slots[i].cleanup=slots[i].setup()},unmount(){for(const slot of slots)if(slot?.kind==='effect')slot.cleanup?.()},replay(){for(const slot of slots)if(slot?.kind==='effect'){slot.cleanup?.();slot.cleanup=slot.setup()}},switchContext(){active='other';owner.abort()},withoutOwner(){provided=false},stateValues:()=>slots.filter(s=>s.kind==='state').map(s=>s.value),
 }
}
const tick=()=>new Promise(resolve=>setImmediate(resolve))
const task={id:'same-task',revision:7,observed:'same-observation',workerId:'worker-1',state:'idle',unknownEffects:false,actions:['inspect','read_history','resume_session','cancel'],problem:'none',next:'none',hasResult:false,evidence:{commit:'unverified',tests:'unverified',deployment:'unverified'}}
const snapshot=(tasks:any[]=[task],revision=7)=>({visibility:'visibility',at:1,revision,cursor:0,total:tasks.length,offset:0,more:false,tasks})
const events=(cursor=5,more=false)=>({visibility:'visibility',events:[],cursor,head:cursor,more,at:1})
function find(node:any,predicate:(n:any)=>boolean):any{if(!node||typeof node!=='object')return;if(predicate(node))return node;for(const child of [node.props?.children].flat(Infinity)){const result=find(child,predicate);if(result)return result}}
function button(node:any,label:string){const found=find(node,n=>n.type==='button'&&[n.props.children].flat(Infinity).includes(label));if(!found)throw Error('Missing button '+label);return found}
async function settlePage(p:ReturnType<typeof pageFixture>){p.render();p.flush();p.pending.shift().resolve(snapshot());await tick();p.pending.shift().resolve(events());await tick();return p.render()}
async function selectTask(p:ReturnType<typeof pageFixture>,selectedTask:any=task){const view=await settlePage(p);find(view,n=>n.type==='select'&&n.props.id==='trace-task').props.onChange({target:{value:task.id}});p.render();p.flush();p.pending.shift().resolve(snapshot([selectedTask]));await tick();p.pending.shift().resolve(events());await tick();return p.render()}
it('uses the original workspace binding for snapshot, event catch-up and polling, never direct fetch',async()=>{
 const p=pageFixture();await settlePage(p);expect(p.calls.map(c=>c.path)).toEqual(['/api/execution-trace?limit=100','/api/execution-trace/events?cursor=0&limit=100']);expect(p.calls.every(c=>c.url.startsWith('/workspaces/studio/'))).toBe(true);expect(p.calls[0].signal).not.toBe(p.owner.signal)
 p.timers[0].callback();expect(p.calls.at(-1).path).toBe('/api/execution-trace?limit=100');expect(p.rootFetch).not.toHaveBeenCalled();p.unmount();expect(p.calls[0].signal.aborted).toBe(true)
})
it('aborts page reads on unmount and prevents delayed snapshot, error or next event stage writes',async()=>{
 const p=pageFixture();p.render();p.flush();const old=p.pending.shift(),signal=p.calls[0].signal;p.unmount();expect(signal.aborted).toBe(true);const count=p.writes.length;old.resolve(snapshot([],99));await tick();expect(p.writes).toHaveLength(count);expect(p.calls).toHaveLength(1);p.timers[0].callback();expect(p.calls).toHaveLength(1)
 const q=pageFixture();q.render();q.flush();const failure=q.pending.shift();q.unmount();const before=q.writes.length;failure.reject({status:500,payload:{code:'SECRET_RAW'}});await tick();expect(q.writes).toHaveLength(before)
})
it('honors owner read cancellation even before page cleanup and blocks new polling stages',async()=>{
 const p=pageFixture();p.render();p.flush();const old=p.pending.shift();p.owner.abort();const before=p.writes.length;old.resolve(snapshot());await tick();p.timers[0].callback();expect(p.writes).toHaveLength(before);expect(p.calls).toHaveLength(1);expect(p.calls[0].signal.aborted).toBe(true)
})
it('StrictMode page effect replay gets a fresh local read signal and ignores the cleaned-up response',async()=>{
 const p=pageFixture();p.render();p.flush();const old=p.pending.shift(),first=p.calls[0].signal;p.replay();const next=p.pending.shift();expect(first.aborted).toBe(true);expect(p.calls[1].signal).not.toBe(first);expect(p.calls[1].signal.aborted).toBe(false);const count=p.writes.length;old.resolve(snapshot([],99));await tick();expect(p.writes).toHaveLength(count);next.resolve(snapshot());await tick();expect(p.calls).toHaveLength(3);p.unmount()
})
it('keeps selection event cursors fenced when an older event response arrives late',async()=>{
 const p=pageFixture();p.render();p.flush();p.pending.shift().resolve(snapshot());await tick();const oldEvents=p.pending.shift(),view=p.render();find(view,n=>n.type==='select').props.onChange({target:{value:task.id}});p.render();p.flush();p.pending.shift().resolve(snapshot());await tick();p.pending.shift().resolve(events(5,true));await tick();const before=p.writes.length;oldEvents.resolve(events(999,true));await tick();expect(p.writes).toHaveLength(before)
 button(p.render(),'Load more').props.onClick();expect(p.calls.at(-1).path).toContain('cursor=5&');expect(p.calls.at(-1).path).toContain('ticketId=same-task');p.unmount()
})
it('preserves the exact existing recovery action body and never attaches a read-cancel signal to POST',async()=>{
 const p=pageFixture(),view=await selectTask(p);button(view,'Check current state').props.onClick();const call=p.calls.at(-1);expect(call.path).toBe('/api/execution-trace/recover');expect(call.body).toEqual({ticketId:task.id,action:'inspect',revision:task.revision,observed:task.observed,requestId:expect.any(String)});expect(call.signal).toBeUndefined();expect(call.publicRead).toBe(false)
 p.pending.shift().resolve({status:'inspected'});await tick();expect(p.calls.at(-1).path).toBe('/api/execution-trace?limit=100');p.pending.shift().resolve(snapshot());await tick();p.pending.shift().resolve(events());await tick();expect(p.stateValues()).toContain('Current task state checked.');p.unmount()
})
it('does not publish an old recovery result or start its follow-up refresh after page unmount',async()=>{
 const p=pageFixture(),view=await selectTask(p);button(view,'Check current state').props.onClick();const old=p.pending.shift(),count=p.calls.length;p.unmount();const before=p.writes.length;old.resolve({status:'inspected'});await tick();expect(p.writes).toHaveLength(before);expect(p.calls).toHaveLength(count);expect(p.stateValues()).not.toContain('Current task state checked.')
})
it('does not publish an old recovery error/notice or refresh into a newly selected task',async()=>{
 const p=pageFixture(),view=await selectTask(p);button(view,'Check current state').props.onClick();const old=p.pending.shift();find(p.render(),n=>n.type==='select').props.onChange({target:{value:''}});p.render();p.flush();const count=p.calls.length,before=p.writes.length;old.reject({status:409,payload:{code:'trace_changed'}});await tick();expect(p.writes).toHaveLength(before);expect(p.calls).toHaveLength(count);p.unmount()
})
it('keeps stale UI actions bound to their original workspace and performs no send after a context switch',async()=>{
 const p=pageFixture(),view=await selectTask(p),action=button(view,'Check current state').props.onClick,count=p.calls.length;p.switchContext();action();await tick();expect(p.calls).toHaveLength(count);expect(p.rootFetch).not.toHaveBeenCalled();p.unmount()
})
it('never adds a stale-page login redirect and leaves current-session login handling to C1',async()=>{
 const p=pageFixture();p.render();p.flush();const old=p.pending.shift();p.switchContext();const before=p.writes.length;old.reject({status:401,payload:{code:'token_required'}});await tick();expect(p.writes).toHaveLength(before);expect(p.assign).not.toHaveBeenCalled();expect(p.replace).not.toHaveBeenCalled()
 const q=pageFixture();q.render();q.flush();q.pending.shift().reject({status:401,payload:{code:'token_required'}});await tick();expect(q.stateValues()).toContain('login_required');expect(q.assign).not.toHaveBeenCalled();q.unmount()
})
it('maps unrecognized transport exceptions to fixed errors without raw messages or credential-shaped codes',async()=>{
 const p=pageFixture();p.render();p.flush();p.pending.shift().reject({message:'SECRET_ERROR',status:500,payload:{code:'SECRET_TOKEN'}});await tick();expect(p.stateValues()).toContain('trace_request_failed');expect(JSON.stringify(p.stateValues())).not.toContain('SECRET');p.unmount()
})
it('fails closed outside the shared owner without any root fallback',()=>{
 const p=pageFixture();p.withoutOwner();expect(()=>p.render()).toThrow('workspace_owner_required');expect(p.calls).toEqual([]);expect(p.rootFetch).not.toHaveBeenCalled()
})

it('requires explicit repair confirmation and invalidates it on settings revision change',async()=>{
 const p=pageFixture(),blocked={...task,blocker:{resolution:'review_quota',retryPolicy:{mode:'after_repair',automatic:false}}}
 let view=await selectTask(p,blocked)
 const count=p.calls.length
 button(view,'Continue task').props.onClick();view=p.render()
 expect(p.calls).toHaveLength(count)
 expect(button(view,'Checked, continue once')).toBeTruthy()
 p.timers.at(-1).callback();p.pending.shift().resolve(snapshot([{...blocked,revision:8}]));await tick();p.pending.shift().resolve(events());await tick()
 expect(find(p.render(),n=>n.type==='div'&&n.props['aria-label']==='Confirm repair')).toBeUndefined()
 button(p.render(),'Continue task').props.onClick();button(p.render(),'Checked, continue once').props.onClick()
 expect(p.calls.at(-1).body).toMatchObject({action:'resume_session',revision:8,repairConfirmed:true})
 p.unmount()
})
it('passes async inbox evidence from the selected current task only and refreshes it without extra requests',async()=>{
 const p=pageFixture(),inbox={schema:1,received:1,applied:1,archived:0,latest:{kind:'progress',disposition:'applied',observedAt:1000}}
 let view=await selectTask(p,{...task,asyncInbox:inbox});const summary=(tree:any)=>find(tree,n=>typeof n.type==='function'&&n.type.name==='AsyncInboxSummary')
 expect(summary(view).props.value).toEqual(inbox);const before=p.calls.length;button(view,'Refresh').props.onClick();p.pending.shift().resolve(snapshot([{...task,asyncInbox:{...inbox,received:2,archived:1}}]));await tick();p.pending.shift().resolve(events());await tick();view=p.render();expect(summary(view).props.value.received).toBe(2);expect(p.calls.length-before).toBe(2)
 button(view,'Refresh').props.onClick();p.pending.shift().resolve(snapshot());await tick();p.pending.shift().resolve(events());await tick();expect(summary(p.render()).props.value).toBeUndefined();expect(p.rootFetch).not.toHaveBeenCalled();p.unmount()
})
it('does not apply late async inbox evidence after the owning workspace changes',async()=>{
 const p=pageFixture();const view=await selectTask(p);button(view,'Refresh').props.onClick();const stale=p.pending.shift(),before=p.writes.length;p.switchContext();stale.resolve(snapshot([{...task,asyncInbox:{schema:1,received:99,applied:99,archived:0,latest:null}}]));await tick();expect(p.writes).toHaveLength(before);expect(p.stateValues().some(v=>v?.tasks?.[0]?.asyncInbox?.received===99)).toBe(false);p.unmount()
})

it('requires fresh confirmation to stop after the task changes, not just when settings change',async()=>{
 const p=pageFixture(),group=(view:any)=>find(view,n=>n.props?.['aria-label']==='Confirm stop')
 let view=await selectTask(p);button(view,'Stop task').props.onClick();view=p.render()
 const stale=button(group(view),'Stop task').props.onClick
 p.timers.at(-1).callback();p.pending.shift().resolve(snapshot([{...task}]));await tick();p.pending.shift().resolve(events());await tick()
 expect(group(p.render())).toBeTruthy()
 p.timers.at(-1).callback();p.pending.shift().resolve(snapshot([{...task,observed:'revised-contract'}]));await tick();p.pending.shift().resolve(events());await tick()
 const count=p.calls.length;stale();await tick();expect(p.calls).toHaveLength(count)
 view=p.render();expect(group(view)).toBeUndefined()
 button(view,'Stop task').props.onClick();button(group(p.render()),'Stop task').props.onClick()
 expect(p.calls.at(-1).body).toMatchObject({action:'cancel',revision:7,observed:'revised-contract'});expect(p.calls.length).toBe(count+1)
 p.unmount()
})
it('ignores a queued old repair click after the latest observation changed',async()=>{
 const p=pageFixture(),blocked={...task,blocker:{resolution:'review_quota',retryPolicy:{mode:'after_repair',automatic:false}}}
 const view=await selectTask(p,blocked);button(view,'Continue task').props.onClick()
 const stale=button(p.render(),'Checked, continue once').props.onClick
 p.timers.at(-1).callback();p.pending.shift().resolve(snapshot([{...blocked,observed:'new-basis'}]));await tick();p.pending.shift().resolve(events());await tick()
 p.render();const count=p.calls.length;stale();await tick();expect(p.calls).toHaveLength(count)
 p.unmount()
})

it('labels late Worker results as archived rather than presenting them as execution or acceptance',async()=>{
 const p=pageFixture();p.render();p.flush();p.pending.shift().resolve(snapshot());await tick()
 const receipt={id:'event:4',cursor:4,at:'2026-11-22T00:00:00Z',stage:'run',state:'observed',ticketId:task.id,baseline:false,workerEvent:{kind:'result',disposition:'archived'}}
 p.pending.shift().resolve({...events(),events:[receipt]});await tick()
 const e=find(p.render(),n=>n.type==='li'&&n.key==='event:4')
 expect(find(e,n=>n.type==='strong')?.props.children).toBe('Worker result')
 expect(find(e,n=>n.props?.className==='trace-state')?.props.children).toBe('Archived only')
 expect(JSON.stringify(e)).not.toMatch(/Result saved|Acceptance passed/)
 p.unmount()
})
