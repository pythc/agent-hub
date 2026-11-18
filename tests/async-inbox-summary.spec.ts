import {expect,it,vi} from 'vitest'
import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {readFileSync} from 'node:fs'
import {createContext,runInContext} from 'node:vm'
import * as jsx from 'react/jsx-runtime'
import ts from 'typescript'
const exports:any={}
const fetch=vi.fn(()=>{throw Error('No network')})
runInContext(ts.transpileModule(readFileSync(new URL('../web/chat/execution-trace.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,createContext({exports,fetch,require:(id:string)=>id==='react/jsx-runtime'?jsx:{}}))
const sample=()=>({schema:1,received:3,applied:2,archived:1,latest:{kind:'result',disposition:'applied',observedAt:1000}})
const render=(value:unknown=sample(),language='en')=>renderToStaticMarkup(createElement(exports.AsyncInboxSummary,{value,language}))
it('renders only receipt counts and typed metadata, independently from acceptance',()=>{
 const html=render({...sample(),id:'PRIVATE_ID',payload:'SECRET_RAW',latest:{...sample().latest,raw:'SECRET_LATEST'}})
 expect(html).toContain('Async events');expect(html).toContain('Received');expect(html).toContain('Applied');expect(html).toContain('Archived only');expect(html).toContain('Result');expect(html).toContain('does not mean task acceptance passed');expect(html).toContain('UTC');expect(html).toContain('1970-01-01T00:00:01.000Z');expect(html).not.toMatch(/PRIVATE|SECRET|<button|<a\s|<script|open=/);expect(fetch).not.toHaveBeenCalled()
 const zh=render(sample(),'zh-CN');expect(zh).toContain('已采用');expect(zh).toContain('仅归档');expect(zh).toContain('接收或采用结果不等于任务验收通过')
})
it.each(['progress','blocked','result'])('renders typed %s events without claiming success',kind=>{
 const html=render({...sample(),latest:{kind,disposition:'archived',observedAt:0}});expect(html).toContain({progress:'Progress',blocked:'Blocked',result:'Result'}[kind]!);expect(html).toContain('Archived only');expect(html).not.toContain('Completed');expect(html).not.toContain('Passed')
})
it('keeps absent legacy evidence unknown, not zero-success, and distinguishes a recorded empty inbox',()=>{
 for(const value of [undefined,null,{}, {...sample(),schema:2}]){const html=renderToStaticMarkup(createElement(exports.AsyncInboxSummary,{value}));expect(html).toContain('Not recorded');expect(html).not.toContain('<dd>0</dd>');expect(html).not.toContain('Received')}
 expect(render({schema:1,received:0,applied:0,archived:0,latest:null})).toContain('Latest event not recorded')
})
it('fails closed on malformed counts, latest metadata and getters without echoing raw input',()=>{
 const invalid=[{received:-1},{received:1.5},{received:Number.MAX_SAFE_INTEGER+1},{applied:4},{latest:{kind:'SECRET_KIND',disposition:'applied',observedAt:1}},{latest:{kind:'result',disposition:'SECRET_STATE',observedAt:1}},{latest:{kind:'result',disposition:'applied',observedAt:NaN}},{latest:{kind:'result',disposition:'applied',observedAt:8640000000000001}}]
 for(const patch of invalid){const html=render({...sample(),...patch});expect(html).toContain('Not recorded');expect(html).not.toContain('SECRET')}
 const getter=vi.fn(()=>{throw Error('SECRET')}),value=sample();Object.defineProperty(value.latest,'kind',{get:getter});expect(render(value)).toContain('Not recorded');expect(getter).not.toHaveBeenCalled()
})
