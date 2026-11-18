import {createContext,runInContext} from 'node:vm'
import {expect,it} from 'vitest'
import {routerProactivePage} from '../src/ui/router-proactive.ts'
class Element {
 value='';textContent='';className='';disabled=false;required=false;checked=false;children:Element[]=[];options:Element[]=[];onclick:any;onchange:any;onsubmit:any;hidden=false;open=false
 elements:Record<string,Element>=new Proxy({} as Record<string,Element>,{get:(o,k:string)=>o[k]??(o[k]=new Element())})
 replaceChildren(...children:Element[]){this.textContent='';this.children=children;this.options=children;if(children.length&&!children.some(c=>c.value===this.value))this.value=children[0]!.value}
 append(...children:Element[]){this.children.push(...children)}
 createTHead(){const node=new Element();this.append(node);return node}createTBody(){return this.createTHead()}insertRow(){return this.createTHead()}insertCell(){return this.createTHead()}reset(){}focus(){}
}
function fixture(){
 const nodes=new Map<string,Element>(),get=(s:string)=>{if(!nodes.has(s))nodes.set(s,new Element());return nodes.get(s)!},calls:any[]=[],pending:any[]=[],stateResponses:any[]=[],listeners:Record<string,()=>void>={}
 const states:Record<string,any>={a:{settings:{revision:3,enabled:true,debounceMs:1,maxWaitMs:5,cooldownMs:60,quietHours:{timezone:'Asia/Shanghai',start:'22:00',end:'07:00'}},duties:[],schedules:[],runs:[],decisions:[],acceptedGoals:[],skills:[]},b:{settings:{revision:8,enabled:true,debounceMs:2,maxWaitMs:6,cooldownMs:70,quietHours:null},duties:[],schedules:[],runs:[],decisions:[],acceptedGoals:[],skills:[]}}
 const context=createContext({Node:Element,Date,Intl,crypto,URLSearchParams,location:{search:''},window:{addEventListener(name:string,fn:()=>void){listeners[name]=fn}},document:{querySelector:get,createElement:()=>new Element()},FormData:class{constructor(private form:Element){}get(k:string){const e=this.form.elements[k]!;return e.disabled?null:k==='quietEnabled'?e.checked?'on':null:e.value}getAll(k:string){return [this.get(k)]}},fetch(path:string,options:any){const body=options.body?JSON.parse(options.body):undefined;calls.push({path,body});if(body)return new Promise((resolve,reject)=>pending.push({resolve:(v:any={})=>resolve({ok:true,json:async()=>v}),reject}));if(path.startsWith('/router-proactive/state')&&stateResponses.length){const next=stateResponses.shift();return new Promise((resolve,reject)=>{next.resolve=(data:any)=>resolve({ok:true,json:async()=>data});next.reject=reject})}const data=path==='/router-scopes'?{scopes:[{id:'a',name:'A'},{id:'b',name:'B'}],entries:[]}:path==='/router-management/catalog'?{contexts:[],tasks:[],workers:[]}:states[new URL(path,'https://host.test').searchParams.get('scopeId')!];return Promise.resolve({ok:true,json:async()=>data})}})
 const script=routerProactivePage.split('<script>')[1]!.split('</script>')[0]!
 runInContext(script,context)
 const flush=async()=>{await new Promise(r=>setImmediate(r))}
 return {get,calls,pending,states,flush,holdState(){const response:any={};stateResponses.push(response);return response},text(selector:string){const walk=(node:Element):string=>[node.textContent,...node.children.map(walk)].filter(Boolean).join(' | ');return walk(get(selector))},submit(){return get('#settings').onsubmit({preventDefault(){},target:get('#settings')})},changeScope(id:string){get('#scope').value=id;get('#scope').onchange()},pagehide(){listeners.pagehide?.()},buttons(){const walk=(n:Element):Element[]=>[n,...n.children.flatMap(walk)];return [...nodes.values()].flatMap(walk)}}
}
it('loads separate quiet-hours fields and explicitly submits cross-midnight settings without changing execution policy',async()=>{
 const f=fixture();await f.flush();const fields=f.get('#settings').elements;expect(fields.quietEnabled!.checked).toBe(true);expect(fields.quietTimezone!.value).toBe('Asia/Shanghai');expect(fields.quietStart!.value).toBe('22:00');void f.submit();expect(f.calls.at(-1).body).toMatchObject({action:'settings.put',scopeId:'a',expectedRevision:3,settings:{quietHours:{timezone:'Asia/Shanghai',start:'22:00',end:'07:00'}}});f.pending.shift().resolve();await f.flush();expect(routerProactivePage).toContain('不暂停任务执行');expect(routerProactivePage).toContain('夏令时按当地墙钟时段判断');f.pagehide()
})
it('submits explicit null when disabled and ignores dormant invalid quiet fields',async()=>{
 const f=fixture();await f.flush();const fields=f.get('#settings').elements;fields.quietEnabled!.checked=false;fields.quietEnabled!.onchange();fields.quietTimezone!.value='invalid';void f.submit();expect(f.calls.at(-1).body.settings.quietHours).toBeNull();f.pending.shift().resolve();await f.flush();f.pagehide()
})
it('rejects invalid timezone and equal start/end before sending any command',async()=>{
 for(const kind of ['zone','same','time']){const f=fixture();await f.flush();const fields=f.get('#settings').elements;if(kind==='zone')fields.quietTimezone!.value='Not/AZone';if(kind==='same')fields.quietEnd!.value=fields.quietStart!.value;if(kind==='time')fields.quietStart!.value='25:00';await f.submit();expect(f.calls.filter(c=>c.body)).toEqual([]);expect(f.get('#notice').className).toBe('error');f.pagehide()}
})
it('single-flights repeated submits and reuses operationId after an interrupted response',async()=>{
 const f=fixture();await f.flush();void f.submit();void f.submit();expect(f.calls.filter(c=>c.body)).toHaveLength(1);const first=f.calls.at(-1).body;f.pending.shift().reject(Error('interrupted'));await f.flush();void f.submit();expect(f.calls.at(-1).body).toEqual(first);f.pending.shift().resolve();await f.flush();f.pagehide()
})
it('never applies old scope command results or revisions to a newly selected scope',async()=>{
 const f=fixture();await f.flush();void f.submit();const old=f.pending.shift();f.changeScope('b');await f.flush();expect(f.get('#settings').elements.quietEnabled!.checked).toBe(false);old.resolve();await f.flush();expect(f.get('#notice').textContent).not.toBe('已保存。');expect(f.get('#settings').elements.debounceMs!.value).toBe('2');void f.submit();expect(f.calls.at(-1).body).toMatchObject({scopeId:'b',expectedRevision:8,settings:{quietHours:null}});f.pending.shift().resolve();await f.flush();f.pagehide()
})
it('renders cancellation for a completed run with pending notifications',async()=>{
 const f=fixture();f.states.a.runs=[{id:'run',revision:9,state:'completed',delivery:'pending',spec:{name:'Ended task'},scheduledAt:1,activeWork:false,pendingNotifications:true}];await f.flush();const stop=f.buttons().find(b=>b.textContent==='停止本次运行');expect(stop).toBeDefined();void stop!.onclick();await f.flush();expect(f.calls.at(-1).body).toMatchObject({action:'run.cancel',scopeId:'a',expectedRevision:9,id:'run'});f.pending.shift().resolve();await f.flush();f.pagehide()
})
it('does not show a success notice after the page is left',async()=>{
 const f=fixture();await f.flush();void f.submit();f.pagehide();f.pending.shift().resolve();await f.flush();expect(f.get('#notice').textContent).not.toBe('已保存。')
})

const recordedDate=(value:number,timezone='UTC')=>new Date(value).toLocaleString('zh-CN',{timeZone:timezone,timeZoneName:'short',hour12:false})
function lifecycleRun(extra:any={}){
 return {id:'run',revision:9,state:'completed',delivery:'sent',spec:{name:'Daily check'},scheduledAt:1000,activeWork:false,pendingNotifications:false,
 lifecycle:{schema:1,plan:{id:'plan',revision:9},trigger:{kind:'scheduled',dueAt:1000,observedAt:2000,firstDueAt:0,backlog:'coalesced',misfire:'coalesce_latest'},execution:{state:'completed',queuedAt:2000,startedAt:3000,finishedAt:4000},delivery:{state:'sent',messages:1,recipientReadback:'not_observed'}},...extra}
}
function schedule(extra:any={}){return {id:'plan',name:'Daily check',revision:4,active:true,nextAt:10000,timing:{timezone:'UTC'},lifecycle:{schema:1,state:'due',revision:4,nextDueAt:10000,misfire:'coalesce_latest',overlap:'skip'},...extra}}
it('renders plan, trigger, execution and notification independently with recorded times in native details',async()=>{
 const f=fixture();f.states.a.schedules=[schedule()];f.states.a.runs=[lifecycleRun()];await f.flush()
 const text=f.text('#runs'),plan=f.text('#schedules')
 expect(text).toContain('计划 | 触发 | 执行 | 通知');expect(text).toContain('定时触发');expect(text).toContain('运行已结束');expect(text).toContain('已发送');expect(text).not.toContain('已交付');expect(text).not.toContain('已收到')
 for(const label of ['计划版本','计划时间','触发记录','进入队列','开始协调','运行结束','最早积压时间','已合并，只补最近一次','收件方回执 | 未核实'])expect(text).toContain(label)
 expect(text).toContain(recordedDate(0));expect(text).toContain(recordedDate(3000));expect(plan).toContain('已到期，待触发');expect(plan).toContain('只补最近一次');expect(plan).toContain('跳过本次触发');expect(f.calls.filter(c=>c.body)).toHaveLength(0);f.pagehide()
})
it('never invents queue/start observations for legacy or unsupported lifecycle records',async()=>{
 for(const lifecycle of [undefined,{schema:2,execution:{queuedAt:55555,startedAt:66666},delivery:{state:'sent'}}]){
  const f=fixture();f.states.a.runs=[lifecycleRun({lifecycle,createdAt:55555,finishedAt:66666,delivery:'failed'})];await f.flush();const text=f.text('#runs')
  expect(text).toContain('来源未记录');expect(text).toContain('进入队列 | 未记录');expect(text).toContain('开始协调 | 未记录');expect(text).toContain('触发记录 | 未记录');expect(text).toContain('运行结束 | 未记录');expect(text).toContain('需核查');expect(text).not.toContain(recordedDate(55555));expect(text).not.toContain('已发送');f.pagehide()
 }
})
it.each(['unknown','held','sending','pending','failed','dropped','none'])('keeps execution complete separate from notification %s',async state=>{
 const f=fixture(),run=lifecycleRun();run.lifecycle.delivery.state=state;f.states.a.runs=[run];await f.flush();const text=f.text('#runs')
 const label:any={unknown:'结果未知',held:'等待处理',sending:'发送中',pending:'待发送',failed:'发送失败',dropped:'不再发送',none:'无外发'}
 expect(text).toContain('运行已结束');expect(text).toContain(label[state]);expect(text).not.toContain('已发送');if(state==='unknown')expect(text).not.toContain('失败');f.pagehide()
})
it('keeps pausing future plans separate from stopping one run and single-flights repeated controls',async()=>{
 const f=fixture();f.states.a.schedules=[schedule()];f.states.a.runs=[lifecycleRun({activeWork:true})];await f.flush()
 const pause=f.buttons().find(b=>b.textContent==='暂停')!;void pause.onclick();void pause.onclick();await f.flush();expect(f.calls.filter(c=>c.body)).toHaveLength(1);expect(f.calls.at(-1).body).toMatchObject({action:'schedule.pause',id:'plan',expectedRevision:4})
 f.states.a.schedules=[schedule({active:false,lifecycle:{schema:1,state:'paused',nextDueAt:null,misfire:'coalesce_latest',overlap:'skip'}})];f.pending.shift().resolve();await f.flush()
 expect(f.text('#schedules')).toContain('已暂停');expect(f.text('#schedules')).not.toContain(recordedDate(10000));expect(f.text('#runs')).toContain('运行已结束')
 const stop=f.buttons().find(b=>b.textContent==='停止本次运行')!;void stop.onclick();await f.flush();expect(f.calls.at(-1).body).toMatchObject({action:'run.cancel',id:'run',expectedRevision:9});f.pending.shift().resolve();await f.flush();f.pagehide()
})
it('retains the last lifecycle view after a failed refresh instead of replacing it with success or empty data',async()=>{
 const f=fixture();f.states.a.runs=[lifecycleRun()];await f.flush();const previous=f.text('#runs'),response=f.holdState();void f.get('#refresh').onclick();await f.flush();response.reject(Error('Refresh interrupted'));await f.flush();expect(f.text('#runs')).toBe(previous);expect(f.get('#notice').textContent).toBe('Refresh interrupted');expect(f.get('#notice').className).toBe('error');f.pagehide()
})
it('ignores stale lifecycle refreshes after scope changes and after a newer refresh',async()=>{
 const f=fixture();f.states.a.runs=[lifecycleRun()];await f.flush();const old=f.holdState();void f.get('#refresh').onclick();await f.flush();f.changeScope('b');await f.flush();old.resolve({...f.states.a,runs:[lifecycleRun({spec:{name:'stale-private-run'}})]});await f.flush();expect(f.text('#runs')).not.toContain('stale-private-run');expect(f.text('#runs')).toContain('暂无记录')
 f.changeScope('a');await f.flush();const first=f.holdState();void f.get('#refresh').onclick();await f.flush();f.states.a.runs=[lifecycleRun({spec:{name:'newest-run'}})];void f.get('#refresh').onclick();await f.flush();first.resolve({...f.states.a,runs:[lifecycleRun({spec:{name:'older-run'}})]});await f.flush();expect(f.text('#runs')).toContain('newest-run');expect(f.text('#runs')).not.toContain('older-run');f.pagehide()
})
it('does not render invalid or out-of-range lifecycle dates as observations',async()=>{
 const f=fixture(),run=lifecycleRun();run.lifecycle.execution.queuedAt=Number.MAX_SAFE_INTEGER;run.lifecycle.execution.startedAt=NaN;f.states.a.runs=[run];await f.flush();const text=f.text('#runs');expect(text).toContain('进入队列 | 未记录');expect(text).toContain('开始协调 | 未记录');expect(text).not.toContain('Invalid Date');f.pagehide()
})

it('uses plan and historical run timezones rather than browser local time, with explicit UTC fallback',async()=>{
 const f=fixture();f.states.a.schedules=[schedule({timing:{timezone:'Asia/Shanghai'}})];f.states.a.runs=[lifecycleRun({spec:{name:'Historical run',timing:{timezone:'America/New_York'}}})];await f.flush()
 expect(f.text('#schedules')).toContain(recordedDate(10000,'Asia/Shanghai'));expect(f.text('#runs')).toContain(recordedDate(1000,'America/New_York'));expect(f.text('#runs')).toContain(recordedDate(3000,'America/New_York'));expect(f.text('#runs')).not.toContain(recordedDate(3000,'Asia/Shanghai'))
 f.states.a.schedules=[schedule({timing:{}})];f.states.a.runs=[lifecycleRun()];void f.get('#refresh').onclick();await f.flush();expect(f.text('#schedules')).toContain(recordedDate(10000));expect(f.text('#runs')).toContain(recordedDate(3000));expect(f.text('#runs')).toContain('UTC')
 f.states.a.schedules=[schedule({timing:{timezone:'Invalid/Zone'}})];f.states.a.runs=[lifecycleRun({spec:{name:'Invalid zone',timing:{timezone:'Invalid/Zone'}}})];void f.get('#refresh').onclick();await f.flush();expect(f.text('#schedules')).toContain('时区无效');expect(f.text('#runs')).toContain('时区无效');expect(f.text('#runs')).not.toContain(recordedDate(3000));f.pagehide()
})
