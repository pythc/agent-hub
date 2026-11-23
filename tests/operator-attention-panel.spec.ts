/** Real legacy UI module in a deterministic DOM/bridge VM; not browser evidence. */
import {readFileSync} from 'node:fs'
import {createContext,runInContext} from 'node:vm'
import {expect,it} from 'vitest'
const source=readFileSync(new URL('../src/ui/operator-workspace.js',import.meta.url),'utf8')
function item(n=1,change:Record<string,unknown>={}){return {id:'native_request:'+String(n).padStart(64,'0'),kind:'native_approval',state:'expired',sourceLabel:'Local operator',createdAt:1763200000000,expiresAt:1763200001000,observed:'a'.repeat(64),taskRef:{id:'task-1',assignmentId:'assignment-1'},next:{kind:'task',id:'task-1'},...change}}
function snapshot(items=[item()],offset=0,total=items.length){return {schema:1,readOnly:true,observedAt:1763200002000,total,offset,limit:25,more:offset+25<total,items}}
function deferred(){let resolve!:(v:any)=>void,reject!:(e:any)=>void;const promise=new Promise((r,j)=>{resolve=r;reject=j});return {promise,resolve,reject}}
function fixture(){
 class Element{children:Element[]=[];attributes:Record<string,string>={};id='';dateTime='';href='';open=false;tabIndex=0;onclick:any;onclose:any;oncancel:any;type='';value='';focusCount=0;scrollCount=0;constructor(readonly tagName:string,public className='',public textContent=''){}append(...children:Element[]){this.children.push(...children.filter(Boolean))}setAttribute(k:string,v:string){this.attributes[k]=v}replaceChildren(...children:Element[]){this.children=children}focus(){this.focusCount++}scrollIntoView(){this.scrollCount++}close(){this.open=false}remove(){nodes.delete(this.id)}querySelector(){return new Element('span')}querySelectorAll(){return []}getClientRects(){return [1]}}
 const nodes=new Map<string,Element>(),listeners=new Set<()=>void>(),timers:(()=>Promise<void>)[]=[],calls:any[]=[],apiCalls:any[]=[],current:any={state:'ready',managed:true,activeId:'team-a',epoch:1,accountId:'account-a',sessionIsolation:'session-a'}
 let response:(...args:any[])=>Promise<any>=async()=>snapshot(),renders=0,active=true
 const bridge={context:()=>Object.freeze({...current}),subscribe:(f:()=>void)=>{listeners.add(f);return()=>listeners.delete(f)},bind:(expected:any)=>{const captured={...expected};return {context:captured,request:async(...args:any[])=>{if(JSON.stringify(current)!==JSON.stringify(captured))throw Error('workspace_obsolete');calls.push({context:captured,args});return response(...args)}}}}
 const el=(tag:string,css='',text:any='')=>new Element(tag,css,String(text)),add=(node:Element,...children:Element[])=>{node.append(...children);return node}
 const document:any={hidden:false,activeElement:{id:'attention-record-0'},addEventListener:()=>{},getElementById:(id:string)=>nodes.get(id),querySelectorAll:()=>[]}
 const entryState:any={page:'attention',role:'operator',busy:'',account:{authenticated:true,user:{id:'account-a'}}},S:any={authed:true,surface:'entries',busy:''}
 const context=createContext({Date,JSON,Object,Number,Error,Set,Map,AbortController,URL,document,entryState,S,icons:{},executionAssets:{},location:{origin:'http://fixture.local'},workspaceContext:{activeId:'team-a'},window:{addEventListener:()=>{},innerWidth:1024},configurationHost:{active:()=>active},workspaceBridge:()=>bridge,setInterval:(fn:()=>Promise<void>)=>{timers.push(fn)},matchMedia:()=>({matches:true}),lang:'zh',L:(_:string,zh:string)=>zh,el,add,icon:()=>el('svg'),action:(text:string,onclick:any,kind:string)=>{const b=el('button',kind,text);b.onclick=onclick;return b},detail:(title:string,content:Element)=>add(el('details'),el('summary','',title),content),raw:()=>el('pre'),entryName:()=> '本地助手',render:()=>{renders++},refreshEntries:()=>{},entryNavigate:()=>{},entryRun:async(_:string,op:()=>Promise<void>)=>op(),api:async(...args:any[])=>{apiCalls.push(args);if(args[0].startsWith('/entry-workspace/task/'))return {id:'task-1',title:'原任务',approvals:[]};return {attention:[],tasks:[]}}})
 runInContext(source,context);const get=(code:string)=>runInContext(code,context),flush=async()=>{await new Promise(resolve=>setImmediate(resolve))}
 return {get,context,calls,apiCalls,current,entryState,S,nodes,timers,flush,setResponse:(fn:typeof response)=>{response=fn},notify:()=>listeners.forEach(fn=>fn()),renders:()=>renders,setActive:(value:boolean)=>{active=value}}
}
function walk(node:any):any[]{return Array.isArray(node)?node.flatMap(walk):node?[node,...node.children.flatMap(walk)]:[]}
function text(node:any){return walk(node).map(n=>n.textContent).join(' ')}
function button(node:any,label:string){return walk(node).find(n=>n.tagName==='button'&&n.textContent===label)}
it('binds the initial GET to original workspace/account/session and introduces no second poll timer',async()=>{
 const f=fixture();f.get('attentionPageChanged()');await f.flush()
 expect(f.calls).toHaveLength(1);expect(f.calls[0].args.slice(0,4)).toEqual(['/entry-workspace/attention?offset=0&limit=25',undefined,false,'team-a']);expect(f.calls[0].args[4]).toBeInstanceOf(AbortSignal);expect(f.calls[0].context).toMatchObject({epoch:1,accountId:'account-a',sessionIsolation:'session-a'})
 f.get('attentionPageChanged();attentionSupplement();attentionSupplement()');await f.flush();expect(f.calls).toHaveLength(1);expect(f.timers).toHaveLength(1)
})
it('validates and whitelists the DTO without retaining observed or rendering opaque IDs',()=>{
 const f=fixture();f.context.dto={...snapshot(),secret:'SECRET',items:[{...item(),params:{token:'SECRET'},url:'javascript:SECRET'}]}
 const value=f.get('attentionDTO(dto,0)');expect(JSON.stringify(value)).not.toMatch(/SECRET|observed"|assignmentId|javascript/)
 for(const bad of [{schema:2},{observedAt:9e15},{items:[item(),item()]},{items:[item(1,{next:{kind:'url',id:'https://evil'}})]},{items:[item(1,{sourceLabel:'SECRET'})]},{items:[item(1,{expiresAt:-1})]}]){f.context.dto={...snapshot(),...bad};expect(()=>f.get('attentionDTO(dto,0)')).toThrow('attention_invalid')}
})
it('adds independent statuses to one existing active card instead of duplicating it or replacing its actions',async()=>{
 const f=fixture();f.setResponse(async()=>snapshot([item(1,{state:'waiting_permission'}),item(2,{state:'waiting_permission'})]));f.get("operator.work={attention:[{id:'task-1',title:'原任务',entryId:'local',summary:'原摘要'}]};attentionPageChanged()");await f.flush()
 const card=f.get('opAttentionCard(operator.work.attention[0])');expect(walk(card).filter(n=>n.tagName==='h3')).toHaveLength(1);expect(walk(card).filter(n=>n.tagName==='li')).toHaveLength(2);expect(text(f.get('attentionSupplement()'))).not.toContain('查看记录')
 await button(card,'查看详情').onclick();expect(f.apiCalls[0][0]).toBe('/entry-workspace/task/task-1');expect(f.get('operator.drawer.id')).toBe('task-1')
 const approval=f.get("opApproval({id:'existing',method:'item/commandExecution/requestApproval',request:{}})");await button(approval,'拒绝').onclick();expect(f.apiCalls).toContainEqual(['/approval',{id:'existing',answer:'decline'}])
})
it('shows expired, ACP-unavailable and unknown rows in a view-only dialog with no new mutation controls',async()=>{
 const f=fixture();f.setResponse(async()=>snapshot([item(),item(2,{state:'unavailable'}),item(3,{kind:'effect_unknown',state:'outcome_unknown',next:{kind:'records',id:'task-1'}})]));f.get('attentionPageChanged()');await f.flush()
 const panel=f.get('attentionSupplement()');expect(walk(panel).filter(n=>n.className==='attention-record-row')).toHaveLength(3);expect(text(panel)).not.toContain('native_request:')
 button(panel,'查看记录').onclick();const dialog=f.get('opTaskDialog()');expect(text(dialog)).toContain('仅查看记录');expect(text(dialog)).toContain('此请求已到期');expect(text(dialog)).not.toMatch(/批准|提交回答|核对后重试|停止任务|保存为技能/)
 const link=walk(dialog).find(n=>n.tagName==='a');expect(link.href).toBe('http://fixture.local/configure?workspace=team-a#execution-trace');expect(link.textContent).toBe('打开全部执行记录');expect(f.apiCalls).toEqual([])
})
it('only locates a matching existing card and never invents a workflow or platform URL',async()=>{
 const f=fixture();f.setResponse(async()=>snapshot([item(1,{kind:'workflow_review',state:'stale',next:{kind:'workflow',id:'existing'}})]));f.get("operator.work={workflowActions:[{id:'existing'}]};attentionPageChanged()");await f.flush();button(f.get('attentionSupplement()'),'查看记录').onclick();const dialog=f.get('opTaskDialog()'),node:any={focusCount:0,scrollCount:0,focus(){this.focusCount++},scrollIntoView(){this.scrollCount++}};f.nodes.set('attention-workflow-existing',node)
 button(dialog,'定位已有事项').onclick();expect(node.focusCount).toBe(1);expect(node.scrollCount).toBe(1);expect(f.apiCalls).toEqual([]);expect(f.get('operator.attentionView.drawer')).toBe(null)
})
it('retains dated data on 503 or malformed DTO while original cards remain usable',async()=>{
 const f=fixture();f.get("operator.work={attention:[{id:'task-1',title:'原任务',entryId:'local'}]};attentionPageChanged()");await f.flush();const time=f.get('operator.attentionView.snapshot.observedAt')
 for(const response of [async()=>{throw Error('SECRET')},async()=>({schema:9})]){f.setResponse(response);await f.get('readAttentionProjection()');expect(f.get('operator.attentionView.snapshot.observedAt')).toBe(time);const panel=f.get('attentionSupplement()');expect(text(panel)).toContain('更新失败');expect(text(panel)).toContain('读取于');expect(text(panel)).not.toContain('SECRET');expect(button(f.get('opAttentionCard(operator.work.attention[0])'),'查看详情')).toBeTruthy()}
})
it.each(['epoch','activeId','accountId','sessionIsolation'] as const)('clears old data and ignores late success/errors on %s change',async field=>{
 const f=fixture(),pending=deferred();f.get('attentionPageChanged()');await f.flush();button(f.get('attentionSupplement()'),'查看记录').onclick();f.setResponse(()=>pending.promise);const reading=f.get('readAttentionProjection()'),signal=f.calls.at(-1).args[4]
 f.current[field]=field==='epoch'?2:'new-identity';f.current.state='pending';f.notify();expect(signal.aborted).toBe(true);expect(f.get('operator.attentionView.snapshot')).toBe(null);expect(f.get('operator.attentionView.drawer')).toBe(null)
 pending.resolve(snapshot());await reading;expect(f.get('operator.attentionView.snapshot')).toBe(null);expect(f.get('operator.attentionView.failed')).toBe(false)
})
it('does not let a late 401 alter the next identity or leak its error',async()=>{
 const f=fixture(),pending=deferred();f.setResponse(()=>pending.promise);f.get('attentionPageChanged()');f.current.accountId='next';f.current.state='blocked';f.notify();pending.reject({status:401,message:'SECRET'});await f.flush();expect(f.get('operator.attentionView.failed')).toBe(false);expect(f.get('operator.attentionView.snapshot')).toBe(null);expect(f.apiCalls).toEqual([])
})
it('aborts and clears on page leave, and old row/link handlers cannot act after identity changes',async()=>{
 const f=fixture();f.get('attentionPageChanged()');await f.flush();const row=button(f.get('attentionSupplement()'),'查看记录');row.onclick();const link=walk(f.get('opTaskDialog()')).find(n=>n.tagName==='a');f.entryState.page='home';f.get('attentionPageChanged()');expect(f.get('operator.attentionView.snapshot')).toBe(null);expect(f.get('operator.attentionView.drawer')).toBe(null);row.onclick();expect(f.get('operator.attentionView.drawer')).toBe(null);let prevented=false;link.onclick({preventDefault(){prevented=true}});expect(prevented).toBe(true);expect(f.calls).toHaveLength(1)
 const lifecycle=readFileSync(new URL('../src/ui/entry-session.js',import.meta.url),'utf8');expect(lifecycle).toContain("if(typeof attentionPageChanged==='function')attentionPageChanged()")
})
it('pages using one bound GET and treats missing bridge or unsupported context as blocked without root fallback',async()=>{
 const f=fixture();f.setResponse(async(path:string)=>path.includes('offset=25')?snapshot(Array.from({length:5},(_,n)=>item(n+26)),25,30):snapshot(Array.from({length:25},(_,n)=>item(n+1)),0,30));f.get('attentionPageChanged()');await f.flush();button(f.get('attentionSupplement()'),'下一页').onclick();await f.flush();expect(f.calls.at(-1).args[0]).toBe('/entry-workspace/attention?offset=25&limit=25');expect(f.get('operator.attentionView.snapshot.offset')).toBe(25)
 f.current.state='blocked';f.notify();await f.get('readAttentionProjection()');expect(f.calls).toHaveLength(2);expect(f.get('operator.attentionView.snapshot')).toBe(null)
})

it('aborts an in-flight read on page leave and does not restore data when it completes',async()=>{
 const f=fixture(),pending=deferred();f.setResponse(()=>pending.promise);f.get('attentionPageChanged()');const signal=f.calls[0].args[4];f.entryState.page='home';f.get('attentionPageChanged()');expect(signal.aborted).toBe(true);pending.resolve(snapshot());await f.flush();expect(f.get('operator.attentionView.snapshot')).toBe(null);expect(f.get('operator.attentionView.busy')).toBe(false);expect(f.calls).toHaveLength(1)
})
it('shows a readable blocked state without a bridge and rejects impossible kind/state pairs',()=>{
 const f=fixture();f.context.workspaceBridge=undefined;f.get('attentionPageChanged()');expect(f.calls).toEqual([]);expect(text(f.get('attentionSupplement()'))).toContain('请打开可用工作区');f.context.dto=snapshot([item(1,{kind:'effect_unknown',state:'waiting_permission'})]);expect(()=>f.get('attentionDTO(dto,0)')).toThrow('attention_invalid')
})

it('cleans an owned pending read when the React host hides without a context event and loads afresh on return',async()=>{
 const f=fixture(),pending=deferred();f.setResponse(()=>pending.promise);f.get('attentionPageChanged()');f.setActive(false);pending.resolve(snapshot());await f.flush();expect(f.get('operator.attentionView.busy')).toBe(false);expect(f.get('operator.attentionView.snapshot')).toBe(null)
 f.setResponse(async()=>snapshot());f.setActive(true);f.get('attentionPageChanged()');await f.flush();expect(f.calls).toHaveLength(2);expect(f.get('operator.attentionView.snapshot.total')).toBe(1)
})
it('rejects short synchronous pages and translates fixed source labels without redundant empty text',async()=>{
 const f=fixture();f.context.dto=snapshot([item()],0,30);expect(()=>f.get('attentionDTO(dto,0)')).toThrow('attention_invalid');f.get('attentionPageChanged()');await f.flush();expect(text(f.get('attentionSupplement()'))).toContain('本地入口');expect(text(f.get('attentionSupplement()'))).not.toContain('Local operator')
 f.setResponse(async()=>snapshot([]));await f.get('readAttentionProjection()');expect(text(f.get('attentionSupplement()'))).not.toContain('本页没有额外记录')
})
it('labels the read-only dialog, closes on Escape and restores focus without letting an old close handler affect a new dialog',async()=>{
 const f=fixture(),origin:any={focusCount:0,focus(){this.focusCount++}};f.nodes.set('attention-record-0',origin);f.get('attentionPageChanged()');await f.flush();button(f.get('attentionSupplement()'),'查看记录').onclick();const dialog=f.get('opTaskDialog()');expect(dialog.attributes['aria-labelledby']).toBe('attention-record-title');expect(walk(dialog).some(n=>n.id==='attention-record-title')).toBe(true)
 let prevented=false;dialog.oncancel({preventDefault(){prevented=true}});expect(prevented).toBe(true);expect(f.get('operator.attentionView.drawer')).toBe(null);expect(origin.focusCount).toBe(1)
 button(f.get('attentionSupplement()'),'查看记录').onclick();const current=f.get('operator.attentionView.drawer');dialog.oncancel({preventDefault(){}});expect(f.get('operator.attentionView.drawer')).toBe(current);expect(origin.focusCount).toBe(1)
})

it('binds row and paging handlers to their rendered context even when the next workspace reuses item IDs',async()=>{
 const f=fixture();f.setResponse(async()=>snapshot(Array.from({length:25},(_,n)=>item(n+1)),0,30));f.get('attentionPageChanged()');await f.flush();const oldPanel=f.get('attentionSupplement()'),oldOpen=button(oldPanel,'查看记录'),oldNext=button(oldPanel,'下一页')
 f.setResponse(async()=>snapshot([item(1,{sourceLabel:'Connection'})]));f.current.activeId='team-b';f.current.epoch=2;f.notify();await f.flush();const count=f.calls.length
 oldOpen.onclick();oldNext.onclick();await f.flush();expect(f.calls).toHaveLength(count);expect(f.get('operator.attentionView.drawer')).toBe(null)
 button(f.get('attentionSupplement()'),'查看记录').onclick();expect(text(f.get('opTaskDialog()'))).toContain('接入来源');expect(text(f.get('opTaskDialog()'))).not.toContain('本地入口')
})

it('keeps the selected page when the existing work poll refreshes the projection',async()=>{
 const f=fixture();f.setResponse(async(path:string)=>path.includes('offset=25')?snapshot(Array.from({length:5},(_,n)=>item(n+26)),25,30):snapshot(Array.from({length:25},(_,n)=>item(n+1)),0,30));f.get('attentionPageChanged()');await f.flush();button(f.get('attentionSupplement()'),'下一页').onclick();await f.flush();expect(f.get('operator.attentionView.snapshot.offset')).toBe(25)
 await f.timers[0]!();await f.flush();expect(f.calls.at(-1).args[0]).toBe('/entry-workspace/attention?offset=25&limit=25');expect(f.get('operator.attentionView.snapshot.offset')).toBe(25)
})

it.each(['epoch','activeId','accountId','sessionIsolation','host'] as const)('discards a normal drawer response with reused task ID after %s changes',async field=>{
 const f=fixture(),pending=deferred();f.context.api=async()=>pending.promise;const reading=f.get("openOperatorTask('task-1')")
 if(field==='host')f.setActive(false);else {f.current[field]=field==='epoch'?2:'new-context';f.notify()}
 pending.resolve({id:'task-1',title:'OLD_BODY',contractView:{secret:'OLD_CONTRACT'}});await reading;expect(f.get('operator.drawer')).toBe(null);expect(f.get('operator.answers')).toEqual({})
})
it('invalidates normal drawer reads on close and A→B→A page navigation',async()=>{
 for(const action of ['close','page']){
  const f=fixture(),pending=deferred();f.context.api=async()=>pending.promise;const reading=f.get("openOperatorTask('task-1')")
  if(action==='close')f.get('closeOperatorTask()');else {f.entryState.page='activity';f.get('attentionPageChanged()');f.entryState.page='attention';f.get('attentionPageChanged()')}
  pending.resolve({id:'task-1',title:'OLD_BODY'});await reading;expect(f.get('operator.drawer')).toBe(null);expect(f.get('opTaskDialog()')).toBe(null)
 }
})
it('gives the single contract hook only current source-attributed data, clears it on logout, and leaves read-only metadata untouched',async()=>{
 const f=fixture(),cards:any[]=[];f.context.taskContractCard=(value:any,id:string)=>{cards.push({value,id});return {tagName:'section',className:'contract',textContent:'contract',children:[]}};f.context.api=async()=>({id:'task-1',title:'Current task',contractView:{schema:1,taskId:'task-1'}})
 await f.get("openOperatorTask('task-1')");f.get('opTaskDialog()');expect(cards).toEqual([{value:{schema:1,taskId:'task-1'},id:'task-1'}])
 f.S.authed=false;expect(f.get('opTaskDialog()')).toBe(null);expect(f.get('operator.drawer')).toBe(null);expect(cards).toHaveLength(1)
 f.S.authed=true;f.get('attentionPageChanged()');await f.flush();button(f.get('attentionSupplement()'),'查看记录').onclick();f.get('opTaskDialog()');expect(cards).toHaveLength(1)
})
it('downgrades only the contract component for legacy directly seeded drawers without source proof',()=>{
 const f=fixture(),cards:any[]=[];f.context.taskContractCard=(value:any,id:string)=>{cards.push({value,id});return {tagName:'section',className:'contract',textContent:'unverified',children:[]}};f.get("operator.drawer={id:'task-1',title:'Legacy seeded task',contractView:{secret:'OLD_CONTRACT'}}")
 expect(text(f.get('opTaskDialog()'))).toContain('Legacy seeded task');expect(cards).toEqual([{value:undefined,id:'task-1'}])
})
it('cannot revive an app-loaded ordinary drawer from an old post-refresh assignment after it was closed',async()=>{
 const f=fixture();await f.get("openOperatorTask('task-1')");f.get("closeOperatorTask();operator.drawer={id:'task-1',title:'OLD_REFRESH_BODY'}");expect(f.get('opTaskDialog()')).toBe(null);expect(f.get('operator.drawer')).toBe(null)
})

it('never claims no pending items during first loading, a first failure, malformed data or a stale known-zero refresh',async()=>{
 const pending=deferred(),loading=fixture();loading.setResponse(()=>pending.promise);loading.get("operator.work={attention:[],workflowActions:[],projectReviews:[]};attentionPageChanged()");expect(text(loading.get('opAttention()'))).not.toContain('暂无待处理事项');pending.resolve(snapshot([]));await loading.flush();expect(text(loading.get('opAttention()'))).toContain('暂无待处理事项')
 for(const bad of [async()=>{throw Error('unavailable')},async()=>({schema:9})]){const f=fixture();f.setResponse(bad);f.get("operator.work={attention:[],workflowActions:[],projectReviews:[]};attentionPageChanged()");await f.flush();expect(text(f.get('opAttention()'))).not.toContain('暂无待处理事项')}
 loading.setResponse(async()=>{throw Error('unavailable')});await loading.get('readAttentionProjection()');expect(loading.get('operator.attentionView.snapshot.total')).toBe(0);expect(text(loading.get('opAttention()'))).toContain('更新失败');expect(text(loading.get('opAttention()'))).not.toContain('暂无待处理事项')
})

it.each(['epoch','activeId','accountId','sessionIsolation','host'] as const)('does not load old contract or body when a populated normal drawer has stale %s proof',async field=>{
 const f=fixture(),cards:any[]=[];f.context.taskContractCard=(...args:any[])=>{cards.push(args);return {tagName:'section',className:'contract',textContent:'contract',children:[]}};f.context.api=async()=>({id:'task-1',title:'OLD_BODY',contractView:{secret:'OLD_CONTRACT'}});await f.get("openOperatorTask('task-1')")
 if(field==='host')f.setActive(false);else f.current[field]=field==='epoch'?2:'other-identity'
 expect(f.get('opTaskDialog()')).toBe(null);expect(f.get('operator.drawer')).toBe(null);expect(cards).toEqual([])
})

function composeRealLegacyApi(f:ReturnType<typeof fixture>,fetcher:(path:string,options:any)=>Promise<any>){
 f.context.AbortSignal=AbortSignal;f.context.crypto=crypto;f.context.Event=Event;f.context.fetch=fetcher;f.context.clearTimeout=clearTimeout;f.context.entrySafeDetail=()=>''
 f.context.location={href:'http://fixture.local/configure#tasks/history',origin:'http://fixture.local',pathname:'/configure',search:'',hash:'#tasks/history',replace:()=>{throw Error('A stale response must not redirect')}}
 f.entryState.page='activity';f.entryState.account={configured:false,authenticated:false};f.S.token='initial-token'
 f.get(readFileSync(new URL('../src/ui/workspaces.js',import.meta.url),'utf8'))
 const app=readFileSync(new URL('../src/ui/application.js',import.meta.url),'utf8'),entry=readFileSync(new URL('../src/ui/entry-session.js',import.meta.url),'utf8')
 f.get(app.slice(app.indexOf('class ApiError'),app.indexOf('async function health()')))
 f.get(entry.slice(entry.indexOf('function entryError('),entry.indexOf('async function loadEntryGuide()')))
 f.get("workspaceContext.discovered=true;workspaceContext.epoch=1;workspaceContext.sessionIsolation='initial-session';workspaceContext.transportPhase='ready';S.authed=true")
 f.context.handled401=0;f.get("const actualEntryError=entryError;entryError=error=>{if(error.status===401)handled401++;return actualEntryError(error)}")
}
it('passes a current real token-mode 401 through original api/entryRun/entryError after synchronous session-ended notification',async()=>{
 const f=fixture();composeRealLegacyApi(f,async()=>({ok:false,status:401,json:async()=>({code:'token_required'})}))
 await f.get("openOperatorTask('task-1')")
 expect(f.get('handled401')).toBe(1);expect(f.S.authed).toBe(false);expect(f.S.token).toBe('');expect(f.entryState.error.code).toBe('token_required');expect(f.get('workspaceBridge().context().code')).toBe('workspace_session_ended');expect(f.get('operator.drawer')).toBe(null)
})
it.each(['account','session'] as const)('discards a real api late 401 without signing out a ready replacement %s identity',async field=>{
 const f=fixture(),pending=deferred();composeRealLegacyApi(f,async()=>pending.promise);const reading=f.get("openOperatorTask('task-1')")
 // No notification is needed for api's own response fence. Keeping the read
 // signal live specifically exercises its identity-to-409 path before 401.
 f.get("workspaceContext.epoch=2;workspaceContext.sessionIsolation='replacement-session';S.token='replacement-token'")
 if(field==='account')f.entryState.account={configured:true,authenticated:true,user:{id:'replacement-account'}}
 pending.resolve({ok:false,status:401,json:async()=>({code:'old_token_required'})});await reading
 expect(f.get('handled401')).toBe(0);expect(f.S.authed).toBe(true);expect(f.S.token).toBe('replacement-token');expect(f.get('workspaceBridge().context().state')).toBe('ready');expect(f.get('workspaceBridge().context().code')).toBe(null);expect(f.get('operator.drawer')).toBe(null)
})

it('hands a real current projection 401 to the original authentication error handler',async()=>{
 const f=fixture();composeRealLegacyApi(f,async()=>({ok:false,status:401,json:async()=>({code:'token_required'})}));f.entryState.page='attention';f.get('attentionPageChanged()');await f.flush()
 expect(f.get('handled401')).toBe(1);expect(f.S.authed).toBe(false);expect(f.S.token).toBe('');expect(f.get('operator.attentionView.snapshot')).toBe(null)
})
it('ignores the real projection api late 401 after a replacement session is ready',async()=>{
 const f=fixture(),pending=deferred();composeRealLegacyApi(f,async()=>pending.promise);f.entryState.page='attention';f.get('attentionPageChanged()');f.get("workspaceContext.epoch=2;workspaceContext.sessionIsolation='replacement-session';S.token='replacement-token'");pending.resolve({ok:false,status:401,json:async()=>({code:'old_token_required'})});await f.flush()
 expect(f.get('handled401')).toBe(0);expect(f.S.authed).toBe(true);expect(f.S.token).toBe('replacement-token');expect(f.get('workspaceBridge().context().state')).toBe('ready')
})
it('clears its read-only record holder before a legitimate SPA records-link navigation so returning cannot reopen it',async()=>{
 const f=fixture();f.get('attentionPageChanged()');await f.flush();button(f.get('attentionSupplement()'),'查看记录').onclick();const link=walk(f.get('opTaskDialog()')).find(n=>n.tagName==='a');let prevented=false;link.onclick({preventDefault(){prevented=true}});expect(prevented).toBe(false);expect(f.get('operator.attentionView.drawer')).toBe(null);expect(f.get('operator.attentionView.snapshot')).toBe(null)
 f.setActive(false);f.setActive(true);f.get('attentionPageChanged()');await f.flush();expect(f.get('opTaskDialog()')).toBe(null);expect(button(f.get('attentionSupplement()'),'查看记录')).toBeTruthy()
})
it('does not claim empty when legacy work is absent or its current refresh fails after successful zero metadata',async()=>{
 const f=fixture();f.setResponse(async()=>snapshot([]));f.get('attentionPageChanged()');await f.flush();expect(text(f.get('opAttention()'))).not.toContain('暂无待处理事项')
 f.get("operator.work={attention:[],workflowActions:[],projectReviews:[]}");expect(text(f.get('opAttention()'))).toContain('暂无待处理事项')
 f.context.api=async()=>{throw {status:503}};await f.get('readOperatorWork()');expect(f.get('operator.error')).toBe(true);expect(f.get('operator.attentionView.snapshot.total')).toBe(0);expect(text(f.get('opAttention()'))).toContain('更新失败');expect(text(f.get('opAttention()'))).not.toContain('暂无待处理事项')
})

it('uses readable titles on existing cards and details while keeping task action identity and old-server fallback',async()=>{
 const f=fixture();f.get("operator.work={attention:[]}");f.context.api=async(...args:any[])=>{f.apiCalls.push(args);return {id:'task-1',title:'RAW_GENERATED_PACKET',displayTitle:'[Bug] Review the result',approvals:[]}}
 const card=f.get("opAttentionCard({id:'task-1',title:'RAW_GENERATED_PACKET',displayTitle:'[Bug] Review the result',entryId:'local'})");expect(text(card)).toContain('[Bug] Review the result');expect(text(card)).not.toContain('RAW_GENERATED_PACKET')
 await button(card,'查看详情').onclick();expect(f.apiCalls[0][0]).toBe('/entry-workspace/task/task-1');const dialog=f.get('opTaskDialog()');expect(walk(dialog).find(n=>n.tagName==='h2').textContent).toBe('[Bug] Review the result');expect(f.get('operator.drawer.id')).toBe('task-1')
 expect(text(f.get("opAttentionCard({id:'legacy',title:'Human task',entryId:'local'})"))).toContain('Human task')
})
function effectProposal(state='applied'){
 return {effectSummary:{schema:1,kind:state==='applied'?'confirmed':state==='observed'?'observed':'unknown',attemptedAt:1000,observedAt:2000},effectReceiptVersion:1,id:'operation',sourceId:'source',originTriggerId:'trigger',entryRevision:1,ownerEpoch:2,dataRevision:3,target:{issueId:'configured-alias'},view:{label:'Change status',account:'account',issue:'remote-issue',current:{name:'Open'}},next:{id:'done',name:'Done'},state,effectReceipt:{schema:1,producer:'workflow_status',localOperationId:'operation',requestDigest:'a'.repeat(64),target:{sourceId:'source',accountId:'account',issueId:'remote-issue'},authorization:{originTriggerId:'trigger',entryRevision:1,ownerEpoch:2,dataRevision:3,sourceIdentityDigest:'b'.repeat(64)},query:{kind:'workflow_state',supported:true},state:state==='applied'?'confirmed':state==='observed'?'observed':'unknown',remoteOperationId:null,remote:{objectId:'remote-issue',revision:'PRIVATE_REVISION',stateId:'done'},attemptedAt:1000,observedAt:2000}}
}
it('shows bounded effect evidence without claiming observed state proves this writer',()=>{
 const f=fixture();f.context.proposal=effectProposal();expect(f.get('workflowOutcome(proposal)')).toContain('本次写入已由回执和回读确认');const body=text(f.get('workflowEffectDetails(proposal)'));expect(body).toContain('效果证据');expect(body).toContain('UTC');expect(body).not.toMatch(/PRIVATE|operation|remote-issue|aaaaaaa|bbbbbbb/)
 f.context.proposal=effectProposal('observed');expect(f.get('workflowOutcome(proposal)')).toContain('写入方未确认');expect(text(f.get('workflowEffectDetails(proposal)'))).not.toContain('本次写入已由回执');expect(f.apiCalls).toEqual([])
})
it('keeps legacy receipts and malformed or inconsistent effect evidence explicitly unknown',()=>{
 const f=fixture(),legacy:any=effectProposal();delete legacy.effectReceipt;delete legacy.effectReceiptVersion;delete legacy.effectSummary;f.context.proposal=legacy;expect(f.get('workflowOutcome(proposal)')).toContain('历史回执，未捕获统一证据')
 for(const change of [(v:any)=>v.effectSummary.schema=2,(v:any)=>v.effectSummary.kind='observed',(v:any)=>delete v.effectSummary.observedAt,(v:any)=>v.effectSummary.observedAt=-1,(v:any)=>v.effectSummary.kind='PRIVATE_SECRET',(v:any)=>v.effectSummary.observedAt=0]){const p=effectProposal();change(p);f.context.proposal=p;expect(f.get('workflowOutcome(proposal)')).toContain('写入结果未知');expect(text(f.get('workflowEffectDetails(proposal)'))).not.toContain('PRIVATE_SECRET')}
 let calls=0;const p=effectProposal();Object.defineProperty(p.effectSummary,'kind',{get(){calls++;throw Error('PRIVATE')}});f.context.proposal=p;expect(f.get('workflowOutcome(proposal)')).toContain('写入结果未知');expect(calls).toBe(0)
})
it('retains reconcile as the only uncertain workflow control and adds no effect retry',()=>{
 const f=fixture();f.context.proposal=effectProposal('uncertain');f.get('operator.work={attention:[],projectReviews:[],workflowActions:[proposal]}');const tree=f.get('opAttention()');expect(button(tree,'核对远端状态')).toBeTruthy();expect(walk(tree).filter(n=>n.tagName==='button'&&/重试|Retry|执行/.test(n.textContent))).toEqual([]);expect(f.apiCalls).toEqual([])
})

it('never derives confirmation from embedded receipt shape without canonical summary',()=>{
 const f=fixture();for(const change of [(p:any)=>delete p.effectSummary,(p:any)=>{delete p.effectSummary;delete p.effectReceipt},(p:any)=>{delete p.effectSummary;delete p.effectReceiptVersion},(p:any)=>p.effectSummary={schema:1,kind:'unknown'},(p:any)=>p.effectSummary={schema:1,kind:'legacy'}]){const p=effectProposal();change(p);f.context.proposal=p;expect(f.get('workflowOutcome(proposal)')).toContain('写入结果未知')}
 const p:any=effectProposal();p.effectSummary={schema:1,kind:'confirmed',attemptedAt:1000,observedAt:2000,raw:'PRIVATE_SECRET',requestDigest:'PRIVATE_DIGEST'};f.context.proposal=p;expect(f.get('workflowOutcome(proposal)')).toContain('本次写入已由回执和回读确认');expect(text(f.get('workflowEffectDetails(proposal)'))).not.toContain('PRIVATE')
})
