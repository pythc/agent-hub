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
const dto=()=>({schema:1,objective:'Review the saved change',inputCount:2,dependencyCount:1,tools:['read'],connections:['docs'],interface:{key:'Review interface',version:1,digest:'a'.repeat(64),inputs:['Saved patch'],outputs:['Review report'],acceptance:['Describe findings']},workspace:{access:'read-only',scope:'whole_root',network:false,leaseCount:0},budget:{timeoutMs:30000,maxSteps:10},createdAt:1000})
const render=(value:unknown,language='en')=>renderToStaticMarkup(createElement(exports.TaskAssignmentSummary,{value,language}))
it('renders frozen assignment facts without granting authority or claiming completed acceptance',()=>{
 const html=render({...dto(),id:'PRIVATE_TASK',raw:'PRIVATE_RAW',blocker:'PRIVATE_BLOCKER'});for(const label of ['Assignment agreement at dispatch','Review the saved change','Saved patch','Review report','Describe findings','Tool ceiling','Connection ceiling','Whole root, not individual files','Awaiting start','Not configured','not unlimited','do not grant additional permission','does not describe provider network'])expect(html).toContain(label)
 expect(html).not.toMatch(/PRIVATE|<button|<a\s|open=|Passed/);expect(html).toContain('Review interface');expect(html).toContain('Interface version');expect(html).toContain('aaaaaaaaaaaa');expect(html).not.toContain('a'.repeat(64));expect(fetch).not.toHaveBeenCalled();expect(source).toContain('<TaskAssignmentSummary value={task.assignment} language={language}/>')
 const zh=render(dto(),'zh-CN');expect(zh).toContain('派工时约定');expect(zh).toContain('待启动 · 未获得租约');expect(zh).toContain('非文件粒度');expect(zh).toContain('未配置不表示无限')
})
it('preserves legacy unknowns and uses only the supplied frozen snapshot',()=>{
 for(const value of [undefined,null,{}, {...dto(),schema:2}]){expect(render(value)).toContain('Not recorded');expect(render(value)).not.toContain('Review the saved change')}
 const value:any=dto();delete value.interface;value.budget={};expect(render(value)).toContain('Interface inputs</dt><dd>Not recorded');expect(render(value)).toContain('Not configured');value.workspace.leaseCount=2;value.workspace.access='workspace-write';expect(render(value)).toContain('Workspace write');expect(render(value)).not.toContain('Awaiting start')
})
it('escapes display text and does not create actions from untrusted strings',()=>{
 const value=dto();value.objective='<script>alert(1)</script>';value.interface.outputs=['<img src=x onerror=x>'];value.tools=['<a href=x>tool</a>'];const html=render(value);expect(html).toContain('&lt;script&gt;');expect(html).toContain('&lt;img');expect(html).not.toMatch(/<script|<img|<a\s/)
})
it('fails closed on invalid counts, authority enums, budgets and interface metadata',()=>{
 for(const patch of [{inputCount:-1},{dependencyCount:1.5},{createdAt:8640000000000001},{workspace:{...dto().workspace,scope:'file'}},{workspace:{...dto().workspace,network:'yes'}},{workspace:{...dto().workspace,access:'admin'}},{budget:null},{budget:{maxSteps:0}},{budget:{maxToolCalls:NaN}},{interface:{...dto().interface,digest:'INVALID'}},{tools:[3]}])expect(render({...dto(),...patch})).toContain('Not recorded')
})
it('never invokes accessors or array iterators and rejects unreadable evidence',()=>{
 const getter=vi.fn(()=>{throw Error('PRIVATE')});const value=dto();Object.defineProperty(value,'objective',{get:getter});expect(render(value)).toContain('Not recorded');expect(getter).not.toHaveBeenCalled()
 const safe=dto();Object.defineProperty(safe.tools,Symbol.iterator,{get:getter});expect(render(safe)).toContain('Review the saved change');expect(getter).not.toHaveBeenCalled()
})

it('shows escaped user-declared interface names with a version and short fingerprint',()=>{
 const value=dto();value.interface.key='<img src=x> Review';value.interface.version=7;const html=render(value);expect(html).toContain('&lt;img src=x&gt; Review');expect(html).toContain('Interface version</dt><dd>7');expect(html).toContain('Interface fingerprint</dt><dd>aaaaaaaaaaaa');expect(html).not.toContain('<img')
})
it.each([
 ['assignment_contract_interface_superseded','协作接口已替代','collaboration interface was replaced'],
 ['required_capability_unavailable','所需能力当前不可用','required capability is unavailable'],
 ['capability_changed','可用能力已变更','capabilities changed'],
 ['backend_changed','执行后端已变更','execution backend changed'],
 ['basis_changed','派工依据已变更','assignment basis changed'],
 ['initial_input_changed','初始输入已变更','initial input changed'],
 ['dependency_not_independently_accepted','依赖尚未通过独立验收','dependency has not passed independent acceptance'],
 ['authority_ended','此派工的授权已结束','authority for this assignment ended'],
])('explains known blocker %s without echoing arbitrary codes', (blocker,zh,en)=>{
 const value={...dto(),blocker};expect(render(value,'zh-CN')).toContain(zh);expect(render(value)).toContain(en);expect(render(value)).not.toContain(blocker)
})
it('keeps unknown and prototype-named blockers generic',()=>{
 for(const blocker of ['PRIVATE_UNKNOWN','toString','__proto__']){const html=render({...dto(),blocker});expect(html).toContain('Assignment restriction recorded');expect(html).not.toContain(blocker)}
})

it('displays the assignment revision separately from the interface version and preserves older responses',()=>{
 const value={...dto(),contractRevision:3}
 expect(render(value)).toContain('Assignment agreement</summary>')
 expect(render(value)).toContain('Contract revision</dt><dd>3')
 expect(render(value)).toContain('Interface version</dt><dd>1')
 expect(render(value,'zh-CN')).toContain('派工约定版本</dt><dd>3')
 for(const revision of [undefined,null,0,-1,1.5,'3',Number.MAX_SAFE_INTEGER+1]){const html=render({...value,contractRevision:revision});expect(html).not.toContain('Contract revision');expect(html).toContain('Review the saved change')}
 const getter=vi.fn(()=>3);Object.defineProperty(value,'contractRevision',{get:getter})
 expect(render(value)).not.toContain('Contract revision');expect(getter).not.toHaveBeenCalled()
})
