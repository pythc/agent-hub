import {readFileSync} from 'node:fs'
import {createContext,runInContext} from 'node:vm'
import {expect,it} from 'vitest'
const source=readFileSync(new URL('../src/ui/execution-page.js',import.meta.url),'utf8')
const fields=['inputTokens','cachedInputTokens','cacheWriteInputTokens','outputTokens','reasoningOutputTokens','totalTokens']
function snapshot(){const tokens={inputTokens:120,cachedInputTokens:20,cacheWriteInputTokens:null,outputTokens:10,reasoningOutputTokens:null,totalTokens:130},counts={calls:3,reportedCalls:2,unknownCalls:1,partialCalls:1,steps:3};return {schema:1,scope:'host',observedAt:1763200000000,settingsRevision:0,usage:{since:100,...counts,tokens,fieldReported:Object.fromEntries(fields.map(key=>[key,2])),groups:[{purpose:'worker',...counts,tokens}],legacyUntrackedCalls:0},context:{retainedActivities:2,withinBudgetActivities:1,exceededActivities:1,unrecognizedActivities:0,lastCheckAt:900},work:{retainedItems:2,states:{starting:0,running:1,completed:1,failed:0,cancelled:0,interrupted:0},unrecognizedStateItems:0,deadlineItems:1,pastDeadlineItems:1,invalidDeadlineItems:0,limits:{maxAgentsPerTicket:3,maxDepth:3,backgroundTimeoutMs:1800000,maxOutputBytesPerShell:1000000}}}}
function fixture(withBridge=false){
 class Element{isConnected=true;hidden=false;disabled=false;id='';textContent='';dateTime='';dataset:Record<string,string>={};attributes:Record<string,string>={};children:Element[]=[];resourceFields:any;onclick:any;constructor(readonly tagName:string,readonly className='',text=''){this.textContent=text}setAttribute(key:string,value:string){this.attributes[key]=value}append(...children:Element[]){this.children.push(...children)}getClientRects(){return [1]}}
 const timers:(()=>void)[]=[],microtasks:(()=>void)[]=[],calls:any[]=[],listeners=new Set<()=>void>(),workspaceContext:any={epoch:1,activeId:'team-a'},entryState:any={account:null},S:any={authed:true,draft:{untouched:true}},document={hidden:false}
 const context=createContext({Date,JSON,Object,Number,Error,Set,AbortController,document,workspaceContext,entryState,S,configurationHost:{active:()=>true},lang:'en',L:(en:string)=>en,el:(tag:string,css='',text='')=>new Element(tag,css,text),add:(node:Element,...children:Element[])=>{node.append(...children);return node},opButton:(text:string,onclick:()=>void,kind:string)=>{const node=new Element('button',kind,text);node.onclick=onclick;return node},queueMicrotask:(fn:()=>void)=>microtasks.push(fn),setInterval:(fn:()=>void)=>timers.push(fn),api:async(...args:any[])=>{calls.push(args);return snapshot()},...(withBridge?{workspaceBridge:()=>({context:()=>({state:workspaceContext.bridgePhase??workspaceContext.transportPhase??'ready',epoch:workspaceContext.epoch,activeId:workspaceContext.activeId,sessionIsolation:workspaceContext.sessionIsolation??null}),subscribe:(fn:()=>void)=>{listeners.add(fn);return()=>listeners.delete(fn)}})}:{})})
 runInContext(source,context);const get=(code:string)=>runInContext(code,context),mount=()=>get('resourcePanel()') as Element,flush=async()=>{while(microtasks.length)microtasks.shift()!();await new Promise(resolve=>setImmediate(resolve))}
 return {context,get,mount,flush,timers,calls,workspaceContext,entryState,S,document,notify:()=>listeners.forEach(fn=>fn())}
}
function deferred(){let resolve!:(v:any)=>void,reject!:(v:any)=>void;const promise=new Promise((r,j)=>{resolve=r;reject=j});return {promise,resolve,reject}}
it('shows only the original reported total, coverage and observation time in the global configuration area',async()=>{
 const f=fixture(),root=f.mount();await f.flush();expect(f.calls[0].slice(0,4)).toEqual(['/api/resource-usage',undefined,false,'team-a']);expect(root.resourceFields.values.tokens.textContent).toBe('130');expect(root.resourceFields.coverage.textContent).toBe('Reported calls: 2 / 3 · Unreported: 1 · Partial: 1');expect(root.resourceFields.time.textContent).toContain('Observed at ');expect(root.resourceFields.details.tagName).toBe('details');expect(f.S.draft).toEqual({untouched:true})
 const team=readFileSync(new URL('../src/ui/team-studio.js',import.meta.url),'utf8');expect(team).toContain('section.append(schedulerPanel(),resourcePanel())');expect(team).not.toContain("['usage'");expect(team).not.toContain('usage:resourcePanel')
})
it('reads only once per identity on first configuration entry, not on scheduler timers, rerenders or re-entry',async()=>{
 const f=fixture(),first=f.mount();await f.flush();const second=f.mount();first.isConnected=false;await f.flush();expect(f.calls).toHaveLength(1);expect(f.timers).toHaveLength(1);f.timers[0]!();await f.flush();expect(f.calls).toHaveLength(1)
 await f.get('resourceRefresh()');expect(f.calls).toHaveLength(2);expect(second.resourceFields.refresh.disabled).toBe(false)
})
it('keeps null unknown instead of zero and never adds input, cache, reasoning or output fields',async()=>{
 const f=fixture();f.context.api=async()=>{const s=snapshot();s.usage.tokens.totalTokens=null as any;s.usage.tokens.inputTokens=999;s.usage.tokens.cachedInputTokens=888;return s};const root=f.mount();await f.flush();expect(root.resourceFields.values.tokens.textContent).toBe('Not reported')
 f.context.api=async()=>{const s=snapshot();s.usage.tokens.totalTokens=0;return s};await f.get('resourceRefresh()');expect(root.resourceFields.values.tokens.textContent).toBe('0')
})
it('shows incomplete coverage, observer unavailability and legacy untracked records without claiming a bill or quota',async()=>{
 const f=fixture();f.context.api=async()=>({...snapshot(),usage:{...snapshot().usage,watchdogUnavailable:true,legacyUntrackedCalls:4}});const root=f.mount();await f.flush();expect(root.resourceFields.observer.hidden).toBe(false);expect(root.resourceFields.observer.textContent).toContain('unavailable');expect(root.resourceFields.legacy.textContent).toContain('4');expect(root.resourceFields.coverage.textContent).toContain('Unreported: 1');expect(root.resourceFields.extraValues['work.pastDeadlineItems'].textContent).toBe('1')
})
it('keeps a dated prior snapshot on 503 and does not silently retry after rerender',async()=>{
 const f=fixture(),root=f.mount();await f.flush();const time=root.resourceFields.time.textContent;let attempts=0;f.context.api=async()=>{attempts++;throw Error('SECRET_PROVIDER')};await f.get('resourceRefresh()');expect(root.dataset.state).toBe('stale');expect(root.resourceFields.values.tokens.textContent).toBe('130');expect(root.resourceFields.time.textContent).toBe(time);expect(root.resourceFields.failure.textContent).toContain('snapshot from the time above');const next=f.mount();root.isConnected=false;await f.flush();expect(attempts).toBe(1);expect(next.dataset.state).toBe('stale');expect(next.resourceFields.failure.textContent).not.toContain('SECRET')
})
it('shows unavailable without fabricated zero when the first read fails',async()=>{
 const f=fixture();f.context.api=async()=>{throw Error('SECRET')};const root=f.mount();await f.flush();expect(root.dataset.state).toBe('unavailable');expect(root.resourceFields.metrics.hidden).toBe(true);expect(root.resourceFields.values.tokens.textContent).toBe('—');expect(root.resourceFields.failure.textContent).not.toContain('SECRET')
})
for(const [label,mutate] of [
 ['schema',(s:any)=>s.schema=2],['scope',(s:any)=>s.scope='worker'],['timestamp',(s:any)=>s.observedAt=NaN],['unsafe tokens',(s:any)=>s.usage.tokens.totalTokens=Number.MAX_SAFE_INTEGER+1],['negative tokens',(s:any)=>s.usage.tokens.totalTokens=-1],['missing total',(s:any)=>delete s.usage.tokens.totalTokens],['coverage',(s:any)=>s.usage.unknownCalls=0],['unknown purpose',(s:any)=>s.usage.groups[0].purpose='SECRET'],['group counters',(s:any)=>s.usage.groups[0].calls=4],['context count',(s:any)=>s.context.retainedActivities=99],['context time',(s:any)=>s.context.lastCheckAt=null],['deadline',(s:any)=>s.work.pastDeadlineItems=2],['work count',(s:any)=>s.work.retainedItems=99],['limit',(s:any)=>s.work.limits.maxDepth=0],
] as const)it('rejects malformed '+label+' without replacing the dated snapshot',async()=>{
 const f=fixture(),root=f.mount();await f.flush();f.context.api=async()=>{const s=snapshot();mutate(s);return s};await f.get('resourceRefresh()');expect(root.dataset.state).toBe('stale');expect(root.resourceFields.values.tokens.textContent).toBe('130')
})
it('reconstructs a numeric display DTO and discards extra secret metadata',()=>{
 const f=fixture();f.context.input={...snapshot(),prompt:'SECRET',usage:{...snapshot().usage,raw:'SECRET'},work:{...snapshot().work,command:'SECRET'}};expect(JSON.stringify(f.get('resourceSnapshot(input)'))).not.toContain('SECRET')
})
it.each(['workspace','account','session','logout'])('clears visible old data and ignores a late response after %s changes',async change=>{
 const f=fixture(),root=f.mount();await f.flush();const old=deferred();f.context.api=()=>old.promise;const pending=f.get('resourceRefresh()')
 if(change==='workspace'){f.workspaceContext.epoch++;f.workspaceContext.activeId='team-b'}else if(change==='account')f.entryState.account={authenticated:true,user:{id:'other'}};else if(change==='session')f.workspaceContext.sessionIsolation='new-page-session';else f.S.authed=false
 old.resolve({...snapshot(),usage:{...snapshot().usage,tokens:{...snapshot().usage.tokens,totalTokens:999}}});await pending;expect(f.get('resourceView.data')).toBeNull();expect(root.resourceFields.metrics.hidden).toBe(true);expect(root.resourceFields.values.tokens.textContent).toBe('—');expect(root.resourceFields.time.textContent).toBe('');expect(root.resourceFields.time.dateTime).toBe('')
})
it('uses existing C1 notifications when present, clearing old account content synchronously without an old response',async()=>{
 const f=fixture(true),root=f.mount();await f.flush();f.entryState.account={authenticated:true,user:{id:'other'}};f.notify();expect(root.resourceFields.metrics.hidden).toBe(true);expect(root.resourceFields.values.tokens.textContent).toBe('—');expect(f.get('resourceView.data')).toBeNull()
})
it('will not read while hidden, disconnected, signed out or waiting for an available C1 context',async()=>{
 for(const condition of ['hidden','disconnected','signed-out','pending','blocked']){const f=fixture(),root=f.mount();if(condition==='hidden')f.document.hidden=true;else if(condition==='disconnected')root.isConnected=false;else if(condition==='signed-out')f.S.authed=false;else f.workspaceContext.transportPhase=condition;await f.flush();expect(f.calls,condition).toHaveLength(0)}
})
it('keeps normal readable type, keyboard focus and reduced-motion styles',()=>{
 const css=readFileSync(new URL('../src/ui/execution-page.css',import.meta.url),'utf8');expect(css).toContain('.resource-panel {');expect(css).toMatch(/resource-panel[^}]*font-size:14px/);expect(css).toContain('.resource-details summary:focus-visible');expect(css).toMatch(/prefers-reduced-motion:reduce[^}]*resource-panel/)
})

it.each([401,403])('clears prior usage on lost authorization (%i) instead of treating it as a refresh outage',async status=>{
 const f=fixture(),root=f.mount();await f.flush();f.context.api=async()=>{throw {status,payload:{code:'token_required'}}};await f.get('resourceRefresh()');expect(f.get('resourceView.data')).toBeNull();expect(root.resourceFields.metrics.hidden).toBe(true);expect(root.resourceFields.values.tokens.textContent).toBe('—');expect(root.resourceFields.time.textContent).toBe('');expect(root.resourceFields.time.dateTime).toBe('')
})

it('honors C1 derived blocked readiness, including invalid explicit links, rather than trusting the raw ready phase',async()=>{
 const f=fixture(true);f.workspaceContext.transportPhase='ready';f.workspaceContext.bridgePhase='blocked';const root=f.mount();await f.flush();expect(f.calls).toHaveLength(0);expect(root.resourceFields.metrics.hidden).toBe(true)
 const g=fixture(true),visible=g.mount();await g.flush();g.workspaceContext.bridgePhase='blocked';g.notify();expect(visible.resourceFields.values.tokens.textContent).toBe('—');await g.get('resourceRefresh()');expect(g.calls).toHaveLength(1)
})
