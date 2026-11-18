import {readFileSync} from 'node:fs'
import {createContext,runInContext} from 'node:vm'
import {expect,it} from 'vitest'

const source=readFileSync(new URL('../src/ui/execution-page.js',import.meta.url),'utf8')
const snapshot=()=>({schema:1,observedAt:1763200000000,paused:false,occupancy:{jobs:7,routingJobs:4,workerJobs:3,controllers:2,backgroundReservations:1,activeManagedWork:5},workers:{configured:5,enabled:3,paused:1,retiring:1,idleEnabled:1},routing:{countedLimit:4,admittedButWorkerCountedJobs:1},interactive:{additionalLimit:1,eligibleQueued:2,activeReservedExecutions:1,mode:'existing_session'},queue:{ready:6,delayed:2,blocked:1,uncertain:1}})
function fixture(){
 class Element{
  isConnected=true;hidden=false;disabled=false;id='';textContent='';dataset:Record<string,string>={};attributes:Record<string,string>={};children:Element[]=[];schedulerFields:any;onclick:any
  constructor(readonly tagName:string,readonly className='',text=''){this.textContent=text}
  setAttribute(key:string,value:string){this.attributes[key]=value}
  append(...children:Element[]){this.children.push(...children)}
  replaceChildren(...children:Element[]){this.children=children;this.textContent=''}
  getClientRects(){return [1]}
 }
 const timers:Array<()=>void>=[],microtasks:Array<()=>void>=[],calls:any[]=[],document={hidden:false},workspaceContext={epoch:1,activeId:'team-a'},S={authed:true,draft:{untouched:true}}
 const context=createContext({Date,JSON,Object,Number,Error,document,workspaceContext,S,configurationHost:{active:()=>true},lang:'en',
  L:(en:string,_zh:string)=>en,el:(tag:string,css='',text='')=>new Element(tag,css,text),add:(node:Element,...children:Element[])=>{node.append(...children);return node},
  opButton:(text:string,onclick:()=>void,kind:string)=>{const node=new Element('button',kind,text);node.onclick=onclick;return node},
  queueMicrotask:(cb:()=>void)=>microtasks.push(cb),setInterval:(cb:()=>void)=>timers.push(cb),
  api:async(...args:any[])=>{calls.push(args);return snapshot()}})
 runInContext(source,context)
 const get=(code:string)=>runInContext(code,context),mount=()=>get('schedulerPanel()') as Element,flush=async()=>{while(microtasks.length)microtasks.shift()!();await new Promise(resolve=>setImmediate(resolve))}
 return {context,get,mount,flush,timers,calls,document,workspaceContext,S}
}
const deferred=()=>{let resolve!:(v:unknown)=>void;const promise=new Promise(r=>resolve=r);return {promise,resolve}}

it('shows authoritative aggregate counts without calculating free capacity or changing draft state',async()=>{
 const f=fixture(),root=f.mount();await f.flush()
 expect(f.calls).toEqual([['/api/scheduler-status']])
 expect(root.schedulerFields.values['occupancy.jobs'].textContent).toBe('7')
 expect(root.schedulerFields.values['workers.idleEnabled'].textContent).toBe('1')
 expect(root.schedulerFields.values['queue.ready'].textContent).toBe('6')
 expect(root.schedulerFields.values['occupancy.backgroundReservations'].textContent).toBe('1')
 expect(f.S.draft).toEqual({untouched:true})
 expect(root.schedulerFields.details.tagName).toBe('details')
 expect(root.schedulerFields.time.textContent).toContain('Status at ')
 expect(root.schedulerFields.interactive.textContent).toContain('at most one additional slot')
 expect(root.schedulerFields.interactive.textContent).toContain('other scheduling checks still apply')
})
it('retains the last successful counts and timestamp on failure without showing server errors',async()=>{
 const f=fixture(),root=f.mount();await f.flush();const time=root.schedulerFields.time.textContent
 f.context.api=async()=>{throw Error('secret-token/raw upstream stderr')};await f.get('schedulerRefresh()')
 expect(root.dataset.state).toBe('stale');expect(root.schedulerFields.failure.hidden).toBe(false)
 expect(root.schedulerFields.failure.textContent).toBe('Couldn’t refresh. Showing the last recorded state.')
 expect(root.schedulerFields.values['occupancy.jobs'].textContent).toBe('7');expect(root.schedulerFields.time.textContent).toBe(time)
 expect(JSON.stringify(f.get('schedulerView'))).not.toContain('secret-token')
})
it('shows an unavailable state without inventing zero counts and supports retry',async()=>{
 const f=fixture();f.context.api=async()=>{throw Error('private upstream')};const root=f.mount();await f.flush()
 expect(root.schedulerFields.state.textContent).toBe('Team status unavailable');expect(root.schedulerFields.metrics.hidden).toBe(true)
 expect(root.schedulerFields.time.hidden).toBe(true);expect(root.schedulerFields.refresh.disabled).toBe(false)
 f.context.api=async()=>snapshot();await root.schedulerFields.refresh.onclick()
 await new Promise(resolve=>setImmediate(resolve));expect(root.schedulerFields.metrics.hidden).toBe(false);expect(root.schedulerFields.failure.hidden).toBe(true)
})
it('keeps paused admission distinct from running work and does not promise an idle Worker is available',async()=>{
 const f=fixture();f.context.api=async()=>({...snapshot(),paused:true});const root=f.mount();await f.flush()
 expect(root.dataset.state).toBe('paused');expect(root.schedulerFields.state.textContent).toBe('Scheduling paused')
 expect(root.schedulerFields.paused.textContent).toBe('Existing work may still be running.')
 expect(root.schedulerFields.values['occupancy.jobs'].textContent).toBe('7')
 expect(root.schedulerFields.details.children[1]!.textContent).toContain('may not be available to a particular task')
})
it('allows only one in-flight refresh and ignores hidden or detached panels',async()=>{
 const f=fixture(),pending=deferred();let calls=0;f.context.api=()=>{calls++;return pending.promise};const root=f.mount();await f.flush()
 const again=f.get('schedulerRefresh()');await again;f.timers[0]!();expect(calls).toBe(1)
 pending.resolve(snapshot());await new Promise(resolve=>setImmediate(resolve));expect(root.schedulerFields.refresh.disabled).toBe(false)
 f.document.hidden=true;await f.get('schedulerRefresh()');f.document.hidden=false;root.isConnected=false;f.timers[0]!();expect(calls).toBe(1)
})
it('never exposes the prior workspace snapshot or accepts its late response after a switch',async()=>{
 const f=fixture(),first=f.mount();await f.flush();const pending=deferred();f.context.api=()=>pending.promise
 const old=f.get('schedulerRefresh()');f.workspaceContext.epoch++;f.workspaceContext.activeId='team-b';const latest=f.mount()
 expect(f.get('schedulerView.data')).toBeNull();pending.resolve({...snapshot(),occupancy:{...snapshot().occupancy,jobs:99,workerJobs:95}});await old
 expect(f.get('schedulerView.data')).toBeNull();expect(first.schedulerFields.values['occupancy.jobs'].textContent).toBe('7')
 f.context.api=async()=>({...snapshot(),occupancy:{...snapshot().occupancy,jobs:0,routingJobs:0,workerJobs:0},routing:{countedLimit:4,admittedButWorkerCountedJobs:0}});await f.flush()
 expect(latest.schedulerFields.values['occupancy.jobs'].textContent).toBe('0')
})
it('clears old counts even if workspace changes during a request before its replacement panel mounts',async()=>{
 const f=fixture(),root=f.mount();await f.flush();const pending=deferred();f.context.api=()=>pending.promise;const old=f.get('schedulerRefresh()')
 f.workspaceContext.epoch++;pending.resolve(snapshot());await old
 expect(f.get('schedulerView.data')).toBeNull();expect(root.schedulerFields.metrics.hidden).toBe(true);expect(root.schedulerFields.time.hidden).toBe(true)
})
it('does not fetch on every unrelated team form rerender or move keyboard focus on poll',async()=>{
 const f=fixture();const first=f.mount();await f.flush();const second=f.mount();first.isConnected=false;await f.flush()
 expect(f.calls).toHaveLength(1);const button=second.schedulerFields.refresh;await f.get('schedulerRefresh()');expect(second.schedulerFields.refresh).toBe(button)
})
it('reconstructs only aggregate fields and handles the legacy interactive rule without inventing eligibility',()=>{
 const f=fixture();f.context.input={...snapshot(),token:'hidden',interactive:{...snapshot().interactive,mode:'legacy_pool',secret:'hidden'}}
 const safe=f.get('schedulerSnapshot(input)');expect(JSON.stringify(safe)).not.toContain('hidden');expect(safe.interactive.mode).toBe('legacy_pool')
})
for(const [name,change]of [
 ['unknown schema',(s:any)=>s.schema=2],['missing queue',(s:any)=>delete s.queue],['negative count',(s:any)=>s.queue.ready=-1],['non-integer',(s:any)=>s.queue.ready=.5],['string count',(s:any)=>s.workers.enabled='3'],['bad timestamp',(s:any)=>s.observedAt=NaN],['invalid mode',(s:any)=>s.interactive.mode='always'],['false pause type',(s:any)=>s.paused='false'],['inconsistent jobs',(s:any)=>s.occupancy.jobs=1],['inconsistent workers',(s:any)=>s.workers.configured=99],['idle over enabled',(s:any)=>s.workers.idleEnabled=4],['eligible over queue',(s:any)=>s.interactive.eligibleQueued=9],['extra-slot changed',(s:any)=>s.interactive.additionalLimit=2],['routing count over worker side',(s:any)=>s.routing.admittedButWorkerCountedJobs=4],
] as const)it('rejects '+name+' and preserves a valid last snapshot',async()=>{
 const f=fixture(),root=f.mount();await f.flush();const invalid=snapshot();change(invalid);f.context.api=async()=>invalid;await f.get('schedulerRefresh()')
 expect(root.dataset.state).toBe('stale');expect(root.schedulerFields.values['occupancy.jobs'].textContent).toBe('7')
})

const admission=()=>({schema:1,interactiveBurst:2,reasons:[{code:'worker_busy',count:2},{code:'eligible',count:1}],resources:[{kind:'workspace',limit:null,used:1,reserved:0,available:null}],browser:{enabled:true,limit:1,used:1,reserved:0,queuedActions:0,activeActions:0,waitReason:null,admission:'at_capacity'},waits:{windowMs:3600000,interactive:{samples:2,p50Ms:20,p95Ms:30,maxMs:40},background:{samples:0,p50Ms:null,p95Ms:null,maxMs:null},unknown:3}})
const content=(node:any):string=>[node.textContent,...node.children.map(content)].join(' ')
it('renders bounded aggregate admission and observed waits inside the existing native details',async()=>{
 const f=fixture();f.context.api=async()=>({...snapshot(),admission:{...admission(),secret:'PRIVATE_PATH'}});const root=f.mount();await f.flush();const body=content(root.schedulerFields.admission)
 for(const word of ['Worker busy','Workspace resources','Not recorded','At capacity, not a capacity waiting queue','Observed waits','Samples','20','30','Unknown waits: 3','not an SLA'])expect(body).toContain(word)
 expect(body).not.toContain('PRIVATE');expect(f.calls).toEqual([]);expect(root.schedulerFields.details.tagName).toBe('details');expect(root.schedulerFields.details.attributes).not.toHaveProperty('open');expect(f.S.draft).toEqual({untouched:true})
})
it('renders legacy admission as not recorded and strips extra IDs from aggregate projections',async()=>{
 const f=fixture(),root=f.mount();await f.flush();expect(content(root.schedulerFields.admission)).toContain('Not recorded')
 const a:any=admission();a.resources[0].id='PRIVATE_PATH';a.browser.user='PRIVATE_USER';a.waits.interactive.raw='PRIVATE';f.context.input={...snapshot(),admission:a};expect(JSON.stringify(f.get('schedulerSnapshot(input)'))).not.toContain('PRIVATE')
})
it('rejects invalid admission fields and retains the last observation',async()=>{
 const changes=[(a:any)=>a.schema=2,(a:any)=>a.reasons[0].code='PRIVATE',(a:any)=>a.reasons[0].code='toString',(a:any)=>a.resources[0].used=-1,(a:any)=>a.resources[0].kind='PRIVATE',(a:any)=>a.browser.waitReason='PRIVATE',(a:any)=>a.browser.queuedActions=.5,(a:any)=>a.waits.windowMs=1,(a:any)=>a.waits.interactive.p95Ms='10']
 for(const change of changes){const f=fixture();f.context.api=async()=>({...snapshot(),admission:admission()});const root=f.mount();await f.flush();const before=content(root.schedulerFields.admission),bad=admission();change(bad);f.context.api=async()=>({...snapshot(),admission:bad});await f.get('schedulerRefresh()');expect(root.dataset.state).toBe('stale');expect(content(root.schedulerFields.admission)).toBe(before);expect(content(root)).not.toContain('PRIVATE')}
})

it('distinguishes aggregate resources by safe stable references while accepting older rows without references',()=>{
 const f=fixture(),a:any=admission();a.resources.push({...a.resources[0],ref:'resource-123456abcdef'});f.context.input={...snapshot(),admission:a};const safe=f.get('schedulerSnapshot(input)');expect(safe.admission.resources[1].ref).toBe('resource-123456abcdef');expect(safe.admission.resources[0].ref).toBeUndefined()
 for(const ref of ['/private/path','PRIVATE_ID','resource-<script>',123]){a.resources[1].ref=ref;f.context.input={...snapshot(),admission:a};expect(()=>f.get('schedulerSnapshot(input)')).toThrow('scheduler_admission_invalid')}
})
