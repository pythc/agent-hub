import {createContext,runInContext} from 'node:vm'
import {expect,it} from 'vitest'
import {routerProactivePage} from '../src/ui/router-proactive.ts'
class Element {
 value='';textContent='';className='';disabled=false;required=false;checked=false;children:Element[]=[];options:Element[]=[];onclick:any;onchange:any;onsubmit:any;hidden=false;open=false
 elements:Record<string,Element>=new Proxy({} as Record<string,Element>,{get:(o,k:string)=>o[k]??(o[k]=new Element())})
 replaceChildren(...children:Element[]){this.children=children;this.options=children;if(children.length&&!children.some(c=>c.value===this.value))this.value=children[0]!.value}
 append(...children:Element[]){this.children.push(...children)}
 createTHead(){const node=new Element();this.append(node);return node}createTBody(){return this.createTHead()}insertRow(){return this.createTHead()}insertCell(){return this.createTHead()}reset(){}focus(){}
}
function fixture(){
 const nodes=new Map<string,Element>(),get=(s:string)=>{if(!nodes.has(s))nodes.set(s,new Element());return nodes.get(s)!},calls:any[]=[],pending:any[]=[],listeners:Record<string,()=>void>={}
 const states:Record<string,any>={a:{settings:{revision:3,enabled:true,debounceMs:1,maxWaitMs:5,cooldownMs:60,quietHours:{timezone:'Asia/Shanghai',start:'22:00',end:'07:00'}},duties:[],schedules:[],runs:[],decisions:[],acceptedGoals:[],skills:[]},b:{settings:{revision:8,enabled:true,debounceMs:2,maxWaitMs:6,cooldownMs:70,quietHours:null},duties:[],schedules:[],runs:[],decisions:[],acceptedGoals:[],skills:[]}}
 const context=createContext({Node:Element,Date,Intl,crypto,URLSearchParams,location:{search:''},window:{addEventListener(name:string,fn:()=>void){listeners[name]=fn}},document:{querySelector:get,createElement:()=>new Element()},FormData:class{constructor(private form:Element){}get(k:string){const e=this.form.elements[k]!;return e.disabled?null:k==='quietEnabled'?e.checked?'on':null:e.value}getAll(k:string){return [this.get(k)]}},fetch(path:string,options:any){const body=options.body?JSON.parse(options.body):undefined;calls.push({path,body});if(body)return new Promise((resolve,reject)=>pending.push({resolve:(v:any={})=>resolve({ok:true,json:async()=>v}),reject}));const data=path==='/router-scopes'?{scopes:[{id:'a',name:'A'},{id:'b',name:'B'}],entries:[]}:path==='/router-management/catalog'?{contexts:[],tasks:[],workers:[]}:states[new URL(path,'https://host.test').searchParams.get('scopeId')!];return Promise.resolve({ok:true,json:async()=>data})}})
 const script=routerProactivePage.split('<script>')[1]!.split('</script>')[0]!
 runInContext(script,context)
 const flush=async()=>{await new Promise(r=>setImmediate(r))}
 return {get,calls,pending,states,flush,submit(){return get('#settings').onsubmit({preventDefault(){},target:get('#settings')})},changeScope(id:string){get('#scope').value=id;get('#scope').onchange()},pagehide(){listeners.pagehide?.()},buttons(){const walk=(n:Element):Element[]=>[n,...n.children.flatMap(walk)];return [...nodes.values()].flatMap(walk)}}
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
