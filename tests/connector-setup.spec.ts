import {readFileSync} from 'node:fs'
import {createContext,runInContext} from 'node:vm'
import {createRequire} from 'node:module'
import {transformSync} from 'esbuild'
import {expect,it} from 'vitest'
import * as checkView from '../web/chat/connector-status-view.ts'
import * as informationView from '../web/chat/credential-reference-view.ts'

// Execute the actual full TSX module, with hook storage and element refs under
// test control. No copied submit logic, network, DOM dependency or source edits.
const source=readFileSync(new URL('../web/chat/connector-management.tsx',import.meta.url),'utf8')
const code=transformSync(source,{loader:'tsx',format:'cjs',jsx:'automatic'}).code+'\nmodule.exports.test={Setup,setupIssues,setupBody};'
const require=createRequire(import.meta.url)
const definitions=[{kind:'fixture-im',label:'Fixture IM',setupAvailable:true,setup:{description:'App instructions'},fields:[{name:'rooms',label:'Chat IDs',required:true,input:'tags',credential:false,help:'Copy the chat ID.'},{name:'token',label:'Bot token',required:true,credential:true}]},{kind:'another-im',label:'Another IM',setupAvailable:true,fields:[{name:'rooms',label:'Chat IDs',required:true,input:'tags',credential:false},{name:'token',label:'Bot token',required:true,credential:true}]}]
const deferred=()=>{let resolve!:(v:any)=>void;const promise=new Promise<any>(r=>resolve=r);return {promise,resolve}}
function fixture(component='Setup',language='en'){
 const slots:any[]=[],initialized=new Set<number>(),effectDeps:any[][]=[],cleanups:(()=>void)[]=[],effects:(()=>void)[]=[],calls:{path:string;body:any;signal:AbortSignal}[]=[],created:boolean[]=[],focus:string[]=[],clock={now:Date.now()};let index=0,tree:any
 class ClockDate extends Date{static override now(){return clock.now}}
 const hooks={useState:(initial:any)=>{const at=index++;if(!initialized.has(at)){initialized.add(at);slots[at]=typeof initial==='function'?initial():initial}return [slots[at],(value:any)=>{slots[at]=typeof value==='function'?value(slots[at]):value}]},useRef:(initial:any)=>{const at=index++;if(!initialized.has(at)){initialized.add(at);slots[at]={current:initial}}return slots[at]},useEffect:(effect:()=>any,deps:any[])=>{const at=index++,previous=effectDeps[at];if(!previous||deps.some((v,i)=>!Object.is(v,previous[i]))){effectDeps[at]=deps;effects.push(()=>{cleanups[at]?.();cleanups[at]=effect()})}}}
 const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}})
 const snapshot={revision:0,definitions,instances:[],tools:[],diagnostics:[]}
 const readController=new AbortController(),pageContext={context:{state:'ready',code:null,managed:false,activeId:'',epoch:1,accountId:null,sessionIsolation:'setup-test'},contextKey:'setup-test-ready',readSignal:readController.signal,binding:null as any}
 const environment:any={module:{exports:{}},exports:{},AbortController,Date:ClockDate,crypto,document:{activeElement:{focus:()=>focus.push('opener')}},window:{addEventListener(){},removeEventListener(){}},fetch:async(path:string,options:any={})=>{
  calls.push({path,body:options.body?JSON.parse(options.body):undefined,signal:options.signal})
  return handler(path,options)
 },require:(name:string)=>name==='react'?hooks:name==='react/jsx-runtime'?require(name):name==='lucide-react'?new Proxy({},{get:()=>()=>null}):name==='./connector-status-view.ts'?checkView:name==='./credential-reference-view.ts'?informationView:name==='./workspace-context.tsx'?{useWorkspaceTransport:()=>pageContext}:name.endsWith('.css')?{}:(()=>{throw Error('Unexpected import '+name)})()}
 // C1 bridge contract: JSON success and legacy {status,payload} errors. The
 // optional fifth signal applies only to reads, never to an issued mutation.
 pageContext.binding={context:pageContext.context,async request(path:string,body?:unknown,_publicRead=false,_scope?:string,readSignal?:AbortSignal){
  const response=await environment.fetch(path,{credentials:'same-origin',signal:body===undefined?readSignal:new AbortController().signal,...(body===undefined?{}:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)})}),payload=await response.json()
  if(!response.ok)throw Object.assign(new Error('fixture_api_error'),{status:response.status,payload})
  return payload
 }}
 environment.exports=environment.module.exports
 const context=createContext(environment);runInContext(code,context);const exports=environment.module.exports
 let handler:(path:string,options:any)=>Promise<Response>=async path=>path==='/api/credential-references'?json({schema:1,scope:'host',settingsRevision:0,observedAt:clock.now,connections:[]}):path.endsWith('/validate')?json({valid:true,credentialAvailability:[{field:'token',available:true}]}):path.endsWith('/plan')?json({id:'review-1',expiresAt:clock.now+5000}):path.endsWith('/apply')?json({applied:true}):json(snapshot)
 const walk=(value:any):any[]=>value==null||typeof value!=='object'?[]:Array.isArray(value)?value.flatMap(walk):[value,...walk(value.props?.children)]
 const nodes=()=>walk(tree)
 function render(){index=0;tree=component==='Setup'?exports.test.Setup({definitions,revision:0,L:(en:string,zh:string)=>language==='en'?en:zh,close(){},created:(people:boolean)=>created.push(people),message:(code:string)=>code==='connector_plan_expired'?'This review expired. Check the settings again.':'Check the highlighted fields.'}):exports.ConnectorManagement({language})
  for(const node of nodes()){const ref=node.props?.ref;if(!ref)continue;const element=node.type==='dialog'?{showModal(){},addEventListener(){},removeEventListener(){},close(){}}:{focus:()=>focus.push(node.props.id??'summary')};if(typeof ref==='function')ref(element);else ref.current=element}
  while(effects.length)effects.shift()!();return tree
 }
 const flush=async()=>{await new Promise(resolve=>setImmediate(resolve));render()}
 const input=(field:string)=>nodes().find(n=>n.type==='input'&&n.props.id==='connector-field-'+field)
 const change=(field:string,value:string)=>{input(field).props.onChange({target:{value}});render()}
 const submit=async()=>{nodes().find(n=>n.type==='form').props.onSubmit({preventDefault(){}});await flush()}
 const button=(text:string)=>nodes().find(n=>n.type==='button'&&textOf(n)===text)
 const back=()=>{button(language==='en'?'Back':'上一步').props.onClick();render()}
 const text=()=>textOf(tree)
 const setHandler=(next:typeof handler)=>{handler=next}
 render()
 return {render,flush,submit,input,change,back,button,nodes,text,calls,created,focus,clock,json,setHandler,snapshot,exports,unmount:()=>cleanups.forEach(cleanup=>cleanup?.())}
}
function textOf(value:any):string{if(value==null||typeof value==='boolean')return '';if(typeof value==='string'||typeof value==='number')return String(value);return Array.isArray(value)?value.map(textOf).join(''):textOf(value.props?.children)}
async function filled(actors=''){
 const f=fixture();await f.submit();f.change('rooms','ROOM');f.change('token','SECRET_TOKEN');if(actors)f.change('actors',actors);return f
}
it('submits an explicitly disabled empty-actor draft through validate, plan and existing apply only',async()=>{
 const f=await filled();expect(f.input('actors').props.required).toBeUndefined();expect(f.text()).toContain('Who can request work (optional)')
 await f.submit();expect(f.calls.map(c=>c.path)).toEqual(['/api/connectors/validate','/api/connectors/plan']);expect(f.calls[0]!.body).toMatchObject({actors:[],intent:'draft'})
 expect(f.text()).toContain('Not set; connection stays disabled');await f.submit();expect(f.calls.map(c=>c.path)).toEqual(['/api/connectors/validate','/api/connectors/plan','/api/plugin-market/connection/apply']);expect(f.calls[2]!.body).toEqual({id:'review-1'});expect(f.created).toEqual([false]);expect(f.calls.some(c=>/probe|control|activate|members/.test(c.path))).toBe(false)
})
it('keeps the existing nonempty-actor request body without draft intent',async()=>{
 const f=await filled('USER_A, USER_B');await f.submit();expect(f.calls[0]!.body.actors).toEqual(['USER_A','USER_B']);expect(f.calls[0]!.body).not.toHaveProperty('intent');await f.submit();expect(f.created).toEqual([true])
})
it('shows required errors inline, sets aria and focuses the first field without a request',async()=>{
 const f=fixture();await f.submit();f.change('label','');await f.submit();expect(f.calls).toHaveLength(0);expect(f.input('label').props['aria-invalid']).toBe(true);expect(f.input('label').props['aria-describedby']).toBe('connector-error-label');expect(f.input('rooms').props['aria-invalid']).toBe(true);expect(f.focus.at(-1)).toBe('connector-field-label');expect(f.text()).toContain('Fill in this field.')
})
it.each(['validate','plan'])('uses only known %s issues, renders no raw material and focuses the first visible error',async stage=>{
 const f=await filled();f.setHandler(async path=>path.endsWith('/validate')&&stage==='plan'?f.json({valid:true}):f.json({valid:false,code:'connector_invalid',error:'SECRET_RAW_RESPONSE',issues:[{field:'token',code:'invalid_format',raw:'SECRET_RAW'},{field:'rooms',code:'invalid_format'},{field:'SECRET_FIELD',code:'required'},{field:'label',code:'SECRET_CODE'}]},stage==='plan'?400:200));await f.submit()
 expect(f.input('rooms').props['aria-invalid']).toBe(true);expect(f.input('rooms').props['aria-describedby']).toContain('connector-help-rooms');expect(f.input('token').props['aria-invalid']).toBe(true);expect(f.focus.at(-1)).toBe('connector-field-rooms');expect(f.text()).toContain('Check the marked fields.');expect(f.text()).not.toContain('SECRET');expect(f.created).toHaveLength(0)
})
it('keeps unknown server errors fixed and ignores unknown issue fields',async()=>{
 const f=await filled();f.setHandler(async()=>f.json({code:'SECRET_PROVIDER_CODE',error:'SECRET_RESPONSE',issues:[{field:'token',code:'required'}]},500));await f.submit();expect(f.text()).not.toContain('SECRET');expect(f.input('token').props['aria-invalid']).toBe(false)
})
it('clears credential values and invalidates reviews when switching environment mode or app',async()=>{
 const f=await filled();f.nodes().find(n=>n.type==='input'&&n.props.type==='checkbox').props.onChange({target:{checked:true}});f.render();expect(f.input('token').props.value).toBe('');expect(f.input('token').props.type).toBe('text');f.change('token','STORED_TOKEN');await f.submit();f.back();f.back();const select=f.nodes().find(n=>n.type==='select');select.props.onChange({target:{value:'another-im'}});f.render();await f.submit();expect(f.input('token').props.value).toBe('');expect(f.input('actors').props.value).toBe('');expect(f.input('token').props.type).toBe('password');expect(f.text()).not.toContain('SECRET_TOKEN')
})
it('rejects an expired review before apply and lets the user review again',async()=>{
 const f=await filled();await f.submit();f.clock.now+=5001;await f.submit();expect(f.calls.map(c=>c.path)).toEqual(['/api/connectors/validate','/api/connectors/plan']);expect(f.input('token')).toBeDefined();expect(f.text()).toContain('This review expired.');expect(f.created).toHaveLength(0)
})
it('invalidates late validation after switching app without continuing stages or cancelling the issued POST',async()=>{
 const f=fixture(),select=f.nodes().find(n=>n.type==='select');await f.submit();f.change('rooms','ROOM');f.change('token','SECRET_TOKEN');const pending=deferred();f.setHandler(()=>pending.promise);const old=f.submit();select.props.onChange({target:{value:'another-im'}});f.render();pending.resolve(f.json({valid:true}));await old;expect(f.calls).toHaveLength(1);expect(f.calls[0]!.signal.aborted).toBe(false);expect(f.input('token').props.value).toBe('');expect(f.created).toHaveLength(0)
})
it('ignores late review results on unmount and never applies automatically',async()=>{
 const f=await filled(),pending=deferred();f.setHandler(async path=>path.endsWith('/validate')?f.json({valid:true}):pending.promise);const old=f.submit();await new Promise(resolve=>setImmediate(resolve));f.unmount();pending.resolve(f.json({id:'late-review',expiresAt:f.clock.now+5000}));await old;expect(f.calls.map(c=>c.path)).toEqual(['/api/connectors/validate','/api/connectors/plan']);expect(f.created).toHaveLength(0)
})
it('announces unavailable environment material without blocking storage of a disabled draft',async()=>{
 const f=await filled();f.nodes().find(n=>n.type==='input'&&n.props.type==='checkbox').props.onChange({target:{checked:true}});f.render();f.change('token','MISSING_TOKEN');f.setHandler(async path=>path.endsWith('/validate')?f.json({valid:true,credentialAvailability:[{field:'token',available:false}]}):f.json({id:'missing-token-review',expiresAt:f.clock.now+5000}));await f.submit();expect(f.text()).toContain('Credential unavailable. Connection stays disabled.');f.back();expect(f.input('token').props.value).toBe('MISSING_TOKEN');expect(f.calls[0]!.body.credentialMode).toBe('environment')
})
it('shows the existing permissions link on enable refusal and keeps the saved-draft notice disabled',async()=>{
 const f=fixture('ConnectorManagement');f.snapshot.instances.push({id:'draft',label:'Draft',kind:'fixture-im',enabled:false,scopeCount:1,layers:{},credentialReferences:[]} as never);await f.flush();f.button('Refresh').props.onClick();await f.flush();f.setHandler(async()=>f.json({code:'connector_actors_required'},409));f.button('Enable connection').props.onClick();await f.flush();expect(f.text()).toContain('Set who can request work before enabling this connection.');expect(f.nodes().some(n=>n.type==='a'&&n.props.href==='#connections'&&textOf(n)==='Set people')).toBe(true)
 f.nodes().find(n=>n.type==='button'&&textOf(n)==='Add connection').props.onClick();f.render();const setup=f.nodes().find(n=>n.type===f.exports.test.Setup);setup.props.created(false);f.render();expect(f.text()).toContain('Connection saved and disabled.');expect(f.text()).not.toContain('Enable it when you are ready.')
})
it('renders the optional actor and disabled review in Chinese without host jargon',async()=>{
 const f=fixture('Setup','zh-CN');await f.submit();f.change('rooms','ROOM');f.change('token','TOKEN');expect(f.text()).toContain('谁能发起工作（可稍后设置）');await f.submit();expect(f.text()).toContain('尚未设置，连接保持停用');expect(f.text()).not.toContain('宿主')
})
it('rejects accessor-based and undeclared issue values without reading their raw getters',()=>{
 const f=fixture();let reads=0;const issue={get field(){reads++;return 'token'},get code(){reads++;return 'required'}};expect(f.exports.test.setupIssues([issue,{field:'token',code:'required',raw:'SECRET'}],['token'])).toEqual([{field:'token',code:'required'}]);expect(reads).toBe(0)
})

it('keeps only one in-flight form submission even before the busy render',async()=>{
 const f=await filled(),pending=deferred();f.setHandler(()=>pending.promise);const first=f.submit(),second=f.submit();await second;expect(f.calls).toHaveLength(1);pending.resolve(f.json({valid:false,issues:[]}));await first;await f.flush();expect(f.created).toHaveLength(0)
})
