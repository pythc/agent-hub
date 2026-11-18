import {readFileSync} from 'node:fs'
import {createContext,runInContext} from 'node:vm'
import {transformSync} from 'esbuild'
import {expect,it} from 'vitest'
const code=transformSync(readFileSync(new URL('../web/chat/plugin-marketplace.tsx',import.meta.url),'utf8'),{loader:'tsx',format:'cjs',jsx:'automatic'}).code
function fixture(category='source',route='integrations/installed'){
 const slots:any[]=[],effects:(()=>void)[]=[],calls:any[]=[],pending:any[]=[];let index=0,tree:any
 const release={version:'1.0.0',digest:'a'.repeat(64),notes:{en:'Notes','zh-CN':'说明'},permissions:[]}
 const installed={id:'fixture',category,name:{en:'Fixture','zh-CN':'测试'},enabled:false,selected:release,active:release,connections:[],origin:{repository:'test/fixture',repositoryId:1}}
 const snapshot:any={revision:3,settingsRevision:4,platform:'linux',catalogs:[],installed:[installed],operations:[],blockers:[]}
 const react={useRef(v:any){const n=index++;return slots[n]??(slots[n]={current:v})},useState(v:any){const n=index++;if(!slots[n])slots[n]={value:v};return [slots[n].value,(x:any)=>{slots[n].value=typeof x==='function'?x(slots[n].value):x}]},useEffect(fn:any,deps:any[]){const n=index++,old=slots[n];if(!old||deps.some((v,i)=>!Object.is(v,old.deps[i]))){old?.cleanup?.();slots[n]={deps};effects.push(()=>{slots[n].cleanup=fn()})}}}
 const exports:any={},context=createContext({module:{exports},exports,Date,crypto,Event:class{},setInterval:()=>1,clearInterval(){},window:{dispatchEvent(){}},document:{hidden:false},fetch(path:string,options:any){calls.push({path,body:options.body?JSON.parse(options.body):undefined});if(options.method==='GET')return Promise.resolve({ok:true,json:async()=>snapshot});return new Promise(resolve=>pending.push((value:any)=>resolve({ok:true,json:async()=>value})))},require(name:string){if(name==='react')return react;if(name==='react/jsx-runtime')return {jsx:(type:any,props:any,key:any)=>({type,props,key}),jsxs:(type:any,props:any,key:any)=>({type,props,key})};if(name.includes('plugin-market-contract'))return {compatible:()=>true,latestCompatible:(p:any)=>p.releases[0]};return new Proxy({},{get:()=>()=>null})}})
 runInContext(code,context)
 const nodes=(t:any):any[]=>!t||typeof t!=='object'?[]:Array.isArray(t)?t.flatMap(nodes):[t,...nodes(t.props?.children)]
 const render=()=>{index=0;tree=context.module.exports.PluginMarketplace({route,language:'en'});for(const f of effects.splice(0))f();return tree}
 const text=(t:any):string=>t==null||typeof t==='boolean'?'':typeof t==='string'||typeof t==='number'?String(t):Array.isArray(t)?t.map(text).join(''):text(t.props?.children)
 const flush=async()=>{await new Promise(r=>setImmediate(r));render()}
 const button=(label:string)=>nodes(tree).find(n=>n.type==='button'&&text(n).trim()===label)
 return {render,flush,nodes:()=>nodes(tree),text:()=>text(tree),button,calls,pending,snapshot,parse:context.module.exports.sourcePlanCompatibility,async click(label:string){button(label).props.onClick();await flush()},unmount(){for(const s of slots)s?.cleanup?.()}}
}
const plan=(extra:any={})=>({id:'plan',pluginId:'fixture',action:'activate',revision:3,settingsRevision:4,expiresAt:Date.now()+60000,permissionsAdded:[],restart:true,connections:[],sourceCompatibility:{state:'passed',code:'declared_compatible',connections:[]},...extra})
async function staged(value:any,category='source'){const f=fixture(category);f.render();await f.flush();await f.click('Manage');await f.click('Enable plugin');f.pending.shift()({...value,action:'enable'});await f.flush();return f}
it('shows blocked declaration evidence, retains cancel/recheck, and refuses execute even if clicked programmatically',async()=>{
 const f=await staged(plan({sourceCompatibility:{state:'blocked',code:'schema_invalid',connections:[]}}));expect(f.text()).toContain('declared configuration schema cannot be validated');expect(f.button('Confirm enable').props.disabled).toBe(true);await f.click('Confirm enable');expect(f.calls.some(c=>c.path.endsWith('/execute'))).toBe(false);expect(f.button('Cancel')).toBeDefined();await f.click('Recheck availability');expect(f.calls.filter(c=>c.path.endsWith('/plan'))).toHaveLength(2);f.unmount()
})
it('shows passed declarations without implying service success and preserves restart confirmation',async()=>{
 const f=await staged(plan());expect(f.text()).toContain('not authentication, service access or runtime code');expect(f.text()).toContain('restarts the host');expect(f.button('Confirm enable').props.disabled).toBe(false);expect(f.calls.some(c=>c.path.endsWith('/execute'))).toBe(false);f.unmount()
})
it('blocks missing or malformed source evidence but leaves workspace-view enable unchanged',async()=>{
 for(const sourceCompatibility of [undefined,{state:'passed',code:'schema_invalid',connections:[]},{state:'passed',code:'declared_compatible',connections:[{id:'extra',compatible:true}]},{state:'passed',code:'declared_compatible',connections:[{id:'one',compatible:'true'}]}]){
  const f=await staged(plan({sourceCompatibility}));expect(f.button('Confirm enable').props.disabled).toBe(true);expect(f.text()).toContain('not been verified');f.unmount()
 }
 const f=await staged(plan({sourceCompatibility:undefined}),'workspace-view');expect(f.button('Confirm enable').props.disabled).toBe(false);f.unmount()
})
it('rejects stale revision evidence even if declaration checks passed',async()=>{
 const f=await staged(plan({settingsRevision:2}));expect(f.button('Confirm enable').props.disabled).toBe(true);expect(f.text()).toContain('out of date');f.unmount()
})
it('validates code/state and exact unique connection coverage, while download stays not checked',()=>{
 const f=fixture(),parse=f.parse
 expect(parse({state:'not_checked',code:'download_required',connections:[]},'install',[])).toMatchObject({state:'not_checked',code:'download_required'})
 for(const value of [null,{state:'passed',code:'declared_compatible',connections:[]},{state:'passed',code:'declared_compatible',connections:[{id:'x',compatible:false}]},{state:'passed',code:'declared_compatible',connections:[{id:'x',compatible:true},{id:'x',compatible:true}]}])expect(parse(value,'activate',['x']).state).toBe('not_checked')
 expect(parse({state:'passed',code:'declared_compatible',connections:[{id:'x',compatible:true}]},'rollback',['x']).state).toBe('passed')
})
it('discards plan responses after the selection drawer closes',async()=>{
 const f=fixture();f.render();await f.flush();await f.click('Manage');await f.click('Enable plugin');const drawer=f.nodes().find(n=>typeof n.type==='function'&&n.props.title==='Fixture');drawer.props.close();f.render();f.pending.shift()(plan({action:'enable'}));await f.flush();await f.click('Manage');expect(f.button('Confirm enable')).toBeUndefined();f.unmount()
})
it('allows download-only install with explicit not-checked evidence',async()=>{
 const f=fixture('source','integrations/market'),release={version:'1.0.0',digest:'a'.repeat(64),notes:{en:'Notes','zh-CN':'说明'},permissions:[]}
 f.snapshot.installed=[];f.snapshot.catalogs=[{id:'catalog',url:'https://github.com/test/fixture',origin:{repository:'test/fixture',repositoryId:1},checkedAt:Date.now(),plugins:[{id:'fixture',category:'source',name:{en:'Fixture','zh-CN':'测试'},description:{en:'Fixture','zh-CN':'测试'},releases:[release]}]}]
 f.render();await f.flush();await f.click('Install');await f.click('Install plugin');f.pending.shift()(plan({action:'install',sourceCompatibility:{state:'not_checked',code:'download_required',connections:[]}}));await f.flush();expect(f.text()).toContain('Download the package first');expect(f.button('Confirm install').props.disabled).toBe(false);f.unmount()
})
it('keeps restart blockers authoritative even after passed declarations',async()=>{
 const f=await staged(plan());f.snapshot.blockers=[{kind:'active_tasks',count:1}];f.render();expect(f.button('Confirm enable').props.disabled).toBe(true);await f.click('Confirm enable');expect(f.calls.some(c=>c.path.endsWith('/execute'))).toBe(false);f.unmount()
})
