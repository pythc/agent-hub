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
const head='a'.repeat(40),dto=()=>({schema:1,role:'integration',ownership:'checked',ownerWorkerId:'PRIVATE_WORKER_ID',sharedFileCount:1,defaultLockfiles:true,head,checks:['build','start','business'].map(kind=>({kind,state:'passed',head})),legacyTest:'passed',complete:true})
const render=(value:unknown)=>renderToStaticMarkup(createElement(exports.ProjectIntegrationEvidence,{value}))
const operator=readFileSync(new URL('../src/ui/operator-workspace.js',import.meta.url),'utf8')
function review(value:unknown,paths:unknown){
 class Node{children:Node[]=[];constructor(readonly tag:string,readonly css='',readonly text=''){}append(...children:Node[]){this.children.push(...children)}}
 const el=(tag:string,css='',text='')=>new Node(tag,css,text),context=createContext({value,paths,L:(en:string)=>en,el,detail:(title:string,body:Node)=>{const n=el('details');n.append(el('summary','',title),body);return n}})
 runInContext(operator.slice(operator.indexOf('function readProjectIntegration('),operator.indexOf('function projectReviewCard(')),context)
 const node=runInContext('projectIntegrationCard(value,paths)',context)as Node,walk=(n:Node):Node[]=>[n,...n.children.flatMap(walk)]
 return {text:walk(node).map(n=>n.text).join(' '),nodes:walk(node)}
}
it('shows all three stages only for the same checked commit, with responsibility distinct from permission',()=>{
 const html=render({...dto(),cwd:'/PRIVATE_CWD',sharedFiles:['PRIVATE_PATH']});for(const str of ['Integration responsibility, not additional permission','Build','Start readiness','Business checks','Same-commit integration evidence complete','Protected shared files: '])expect(html).toContain(str)
 expect(html).not.toMatch(/PRIVATE|<button|<a\s|open=/);expect(fetch).not.toHaveBeenCalled();expect(source).toContain('<ProjectIntegrationEvidence value={task.projectIntegration} language={language}/>')
 expect(review(dto(),['src/shared.ts']).text).toContain('src/shared.ts');expect(review(dto(),['src/shared.ts']).text).not.toContain('PRIVATE_WORKER_ID')
})
it('does not turn legacy combined tests or mismatched commit evidence into passed stages',()=>{
 const legacy={...dto(),ownership:'legacy_unknown',checks:dto().checks.map(c=>({...c,state:'unverified',head:null})),complete:false};expect(render(legacy)).toContain('Legacy combined test');expect(render(legacy)).toContain('Integration evidence incomplete');expect(render(legacy)).toContain('Not recorded')
 const wrong=dto();wrong.checks[0]!.head='b'.repeat(40);expect(render(wrong)).toContain('Integration evidence incomplete');expect(render(wrong)).toContain('Not recorded');expect(review(wrong,['src/shared.ts']).text).toContain('Integration evidence incomplete')
 const failed=dto();failed.checks[1]!.state='failed';expect(render(failed)).toContain('Failed');expect(render(failed)).not.toContain('Same-commit integration evidence complete')
 const contributor={...dto(),role:'contributor'};expect(render(contributor)).toContain('Contributor responsibility');expect(render(contributor)).not.toContain('Same-commit integration evidence complete')
})
it('shows only explicit protected repo-relative paths under checked ownership',()=>{
 for(const paths of [['/PRIVATE_CWD'],['../PRIVATE_PATH'],['C:\\PRIVATE_PATH'],['src/../PRIVATE_PATH'],['src//PRIVATE_PATH']])expect(review(dto(),paths).text).not.toContain('PRIVATE')
 expect(review({...dto(),ownership:'blocked'},['PRIVATE_PATH']).text).not.toContain('PRIVATE_PATH');const literal=review(dto(),['src/<img>.ts']);expect(literal.text).toContain('src/<img>.ts');expect(literal.nodes.some(n=>n.tag==='img')).toBe(false)
})
it('fails closed on unknown schemas, invalid states, duplicate stages and getters',()=>{
 for(const value of [undefined,null,{...dto(),schema:2},{...dto(),sharedFileCount:-1},{...dto(),checks:[dto().checks[0],dto().checks[0],dto().checks[2]]},{...dto(),checks:dto().checks.slice(0,2)},{...dto(),checks:dto().checks.map(c=>({...c,state:'PRIVATE_ERROR'}))}]){expect(render(value)).toContain('Not recorded');expect(render(value)).not.toContain('PRIVATE');expect(review(value,[]).text).toContain('Not recorded')}
 const getter=vi.fn(()=>{throw Error('PRIVATE')}),value=dto();Object.defineProperty(value,'checks',{get:getter});expect(render(value)).toContain('Not recorded');expect(getter).not.toHaveBeenCalled();expect(review(value,[]).text).toContain('Not recorded');expect(getter).not.toHaveBeenCalled()
})
