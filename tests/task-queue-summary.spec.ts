import {expect,it,vi} from 'vitest'
import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {readFileSync} from 'node:fs'
import {createContext,runInContext} from 'node:vm'
import * as jsx from 'react/jsx-runtime'
import ts from 'typescript'
const exports:any={},fetch=vi.fn(()=>{throw Error('No network')})
const source=readFileSync(new URL('../web/chat/execution-trace.tsx',import.meta.url),'utf8')
runInContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,createContext({exports,fetch,require:(id:string)=>id==='react/jsx-runtime'?jsx:{}}))
const dto=()=>({schema:1,reason:'resource_quota',waitMs:150,resources:[{kind:'workspace',ref:'resource-123456abcdef',limit:1,used:1,reserved:0,available:0,blocker:'limit_reached'},{kind:'workspace',ref:'resource-abcdef123456',limit:null,used:0,reserved:0,available:null,blocker:'identity_unknown'}]})
const render=(value:unknown,language='en')=>renderToStaticMarkup(createElement(exports.TaskQueueSummary,{value,language}))
it('shows task-specific reason, elapsed wait, distinct resource references and blocked dimensions without actions',()=>{
 const html=render({...dto(),id:'PRIVATE_ID',error:'PRIVATE_ERROR'});for(const value of ['Resource quota','150','resource-123456abcdef','resource-abcdef123456','Limit reached','Resource identity unverified','Not recorded'])expect(html).toContain(value)
 expect(html).not.toMatch(/PRIVATE|<button|<a\s|open=/);expect(fetch).not.toHaveBeenCalled();expect(source).toContain('<TaskQueueSummary value={task.queue} language={language}/>');expect(source).toContain("task.actions.includes('cancel')")
 const zh=render(dto(),'zh-CN');expect(zh).toContain('已等待（毫秒）');expect(zh).toContain('资源身份未核实');expect(zh).toContain('已达上限')
})
it('keeps legacy and unknown timing unrecorded rather than inventing zero or a start promise',()=>{
 for(const value of [undefined,null,{}, {...dto(),schema:2}]){const html=render(value);expect(html).toContain('Not recorded');expect(html).not.toContain('150')}
 const value:any=dto();value.waitMs=null;value.reason='eligible';value.resources=[];const html=render(value);expect(html).toContain('Eligible, not a start guarantee');expect(html).toContain('Not recorded');expect(html).not.toContain('150')
})
it('fails closed on unrecognized reasons, refs, dimensions and malformed counts without echoing input',()=>{
 const variants=[{reason:'PRIVATE_ERROR'},{reason:'toString'},{waitMs:-1},{waitMs:.5},{resources:[{...dto().resources[0],ref:'/private/path'}]},{resources:[{...dto().resources[0],ref:'resource-<script>'}]},{resources:[{...dto().resources[0],kind:'PRIVATE_KIND'}]},{resources:[{...dto().resources[0],used:'1'}]},{resources:[{...dto().resources[0],reserved:NaN}]},{resources:[{...dto().resources[0],blocker:'PRIVATE_ERROR'}]}]
 for(const patch of variants){const html=render({...dto(),...patch});expect(html).toContain('Not recorded');expect(html).not.toMatch(/PRIVATE|private\/path|<script/)}
})
it('never invokes queue evidence accessors or array iterators',()=>{
 const getter=vi.fn(()=>{throw Error('PRIVATE')}),value=dto();Object.defineProperty(value,'reason',{get:getter});expect(render(value)).toContain('Not recorded');expect(getter).not.toHaveBeenCalled()
 const safe=dto();Object.defineProperty(safe.resources,Symbol.iterator,{get:getter});expect(render(safe)).toContain('Resource quota');expect(getter).not.toHaveBeenCalled()
})
