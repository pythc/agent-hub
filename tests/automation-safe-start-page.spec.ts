import {readFileSync} from 'node:fs'
import {createContext,runInContext} from 'node:vm'
import {transformSync} from 'esbuild'
import {expect,it,vi} from 'vitest'
import * as model from '../web/chat/automations-model.ts'
const code=transformSync(readFileSync(new URL('../web/chat/automations.tsx',import.meta.url),'utf8'),{loader:'tsx',format:'cjs',jsx:'automatic'}).code+'\nmodule.exports.Editor=AutomationEditor;module.exports.Detail=AutomationDetail;'
const grant:any={id:'grant',namespace:'fixture',active:true,receiving:false,expiresAt:Date.now()+60000,template:{title:'Fixture',objective:'Do the authorized task'},eventSource:'https://example.test',eventTypes:['fixture'],parameters:{},secretEnvs:['IN_KEY'],callback:{url:'https://example.test/result',secretEnv:'OUT_KEY'}}
function fixture(mode:'editor'|'detail'|'workspace'='editor'){
 let tree:any,index=0;const slots:any[]=[],effects:(()=>void)[]=[],calls:any[]=[],pending:any[]=[],saved=vi.fn(),notice=vi.fn(),control=vi.fn(async()=>{})
 const snapshot={configured:true,grants:[grant],receipts:[],deliveries:[],waits:[],attempts:[]},detail={goals:[],receipts:[],events:[]}
 const react={useRef(v:any){const n=index++;return slots[n]??(slots[n]={current:v})},useState(v:any){const n=index++;if(!slots[n])slots[n]={value:typeof v==='function'?v():v};return [slots[n].value,(x:any)=>{slots[n].value=typeof x==='function'?x(slots[n].value):x}]},useEffect(fn:any,deps:any[]){const n=index++,old=slots[n];if(!old||deps.some((v,i)=>!Object.is(v,old.deps[i]))){old?.cleanup?.();slots[n]={deps};effects.push(()=>{slots[n].cleanup=fn()})}}}
 const context=createContext({module:{exports:{}},Date,crypto,URLSearchParams,location:{search:''},history:{replaceState(){}},fetch(path:string,options:any={}){calls.push({path,body:options.body?JSON.parse(options.body):undefined});if(!options.method)return Promise.resolve({ok:true,json:async()=>path==='/router-management/catalog'?{contexts:[{id:'trigger',title:'Authorized task',scopeId:'scope',entryId:'entry'}],workers:[{id:'one',label:'One'}]}:path==='/router-scopes'?{scopes:[{id:'scope',workerIds:['one']}]}:path.startsWith('/webhooks/detail')?detail:snapshot});return new Promise((resolve,reject)=>pending.push({resolve:(v:any)=>resolve({ok:true,json:async()=>v}),reject}))},require(name:string){if(name==='react')return react;if(name==='react/jsx-runtime')return {jsx:(type:any,props:any,key:any)=>({type,props,key}),jsxs:(type:any,props:any,key:any)=>({type,props,key})};if(name==='./automations-model.ts')return model;return new Proxy({},{get:()=>()=>null})}})
 runInContext(code,context)
 const nodes=(t:any):any[]=>!t||typeof t!=='object'?[]:Array.isArray(t)?t.flatMap(nodes):[t,...nodes(t.props?.children)]
 const text=(t:any):string=>t==null||typeof t==='boolean'?'':typeof t==='string'||typeof t==='number'?String(t):Array.isArray(t)?t.map(text).join(''):text(t.props?.children)
 const render=()=>{index=0;const e:any=context.module.exports;tree=mode==='editor'?e.Editor({language:'en',cancel(){},saved}):mode==='detail'?e.Detail({grant,detail,snapshot,language:'en',run:async(fn:any)=>fn(),busy:false,control,refresh:async()=>{},notice}):e.AutomationWorkspace({language:'en'});for(const fn of effects.splice(0))fn();return tree}
 const flush=async()=>{await new Promise(r=>setImmediate(r));render()},button=(label:string)=>nodes(tree).find(n=>n.type==='button'&&(text(n).trim()===label||n.props['aria-label']===label))
 const form=()=>nodes(tree).find(n=>n.type==='form'),submit=()=>form().props.onSubmit({preventDefault(){}})
 render();return {render,flush,calls,pending,saved,notice,control,button,submit,nodes:()=>nodes(tree),text:()=>text(tree),fill(name:string,value:any){nodes(tree).find(n=>n.props?.name===name).props.onChange({target:{value,checked:value}});render()},unmount(){slots.forEach(s=>s?.cleanup?.())}}
}
async function editor(){const f=fixture();await f.flush();f.fill('triggerId','trigger');f.fill('title','Fixture');f.fill('objective','Produce result');f.fill('acceptance','Check result');f.submit();f.render();return f}
it('creates paused by default only after explicit submit, with a synchronous duplicate-click guard',async()=>{
 const f=await editor();expect(f.text()).toContain('saved with receiving paused');f.submit();f.submit();expect(f.calls.filter(c=>c.path==='/webhooks/grants')).toHaveLength(1);expect(f.calls.at(-1).body.receiving).toBe(false);f.pending.shift().resolve(grant);await f.flush();expect(f.saved).toHaveBeenCalledExactlyOnceWith(grant);expect(f.calls.some(c=>c.path==='/webhooks/control')).toBe(false);f.unmount()
})
it('retains the exact creation body and operationId after an uncertain response and freezes edits',async()=>{
 const f=await editor();f.submit();const first=f.calls.at(-1).body;f.pending.shift().reject(Error('SECRET_SERVER_ERROR'));await f.flush();expect(f.text()).toContain('Retry original creation');expect(f.text()).not.toContain('SECRET_SERVER_ERROR');expect(f.nodes().find(n=>n.type==='fieldset').props.disabled).toBe(true);f.submit();expect(f.calls.at(-1).body).toEqual(first);f.pending.shift().resolve(grant);await f.flush();expect(f.saved).toHaveBeenCalledTimes(1);f.unmount()
})
it('does not adopt a creation response after leaving the editor',async()=>{
 const f=await editor();f.submit();f.unmount();f.pending.shift().resolve(grant);await f.flush();expect(f.saved).not.toHaveBeenCalled()
})
it('rehearsal never starts reception and accurately limits verification',async()=>{
 const f=fixture('detail');expect(f.text()).toContain('does not stop existing queued events or tasks');expect(f.button('Start receiving')).toBeDefined();f.button('Connection').props.onClick();f.render();expect(f.text()).toContain('does not test real signatures, normalizer execution or platform delivery');f.submit();expect(f.calls.at(-1).path).toBe('/webhooks/dry-run');f.pending.shift().resolve({matches:true});await f.flush();expect(f.notice).toHaveBeenCalledWith(expect.stringContaining('signatures, normalizers and the real platform were not tested'));expect(f.control).not.toHaveBeenCalled();f.button('Start receiving').props.onClick();expect(f.control).toHaveBeenCalledWith(grant,'start_receiving');f.unmount()
})
it('does not publish a rehearsal notice after closing the detail',async()=>{
 const f=fixture('detail');f.button('Connection').props.onClick();f.render();f.submit();f.unmount();f.pending.shift().resolve({matches:true});await f.flush();expect(f.notice).not.toHaveBeenCalled()
})
it('keeps start_receiving single-flight and retries the original operationId after an interrupted response',async()=>{
 const f=fixture('workspace');await f.flush();f.nodes().find(n=>n.type==='button'&&n.props.className==='automation-row').props.onClick();f.render();await f.flush();const props=f.nodes().find(n=>typeof n.type==='function'&&n.props.grant)?.props;expect(props).toBeDefined();void props.run(()=>props.control(grant,'start_receiving'));void props.run(()=>props.control(grant,'start_receiving'));expect(f.calls.filter(c=>c.path==='/webhooks/control')).toHaveLength(1);const first=f.calls.at(-1).body;f.pending.shift().reject(Error('connection lost'));await f.flush();void props.run(()=>props.control(grant,'start_receiving'));expect(f.calls.at(-1).body).toEqual(first);f.pending.shift().resolve({ok:true});await f.flush();f.unmount()
})
