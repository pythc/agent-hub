import {expect,it} from 'vitest'
import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {readFileSync} from 'node:fs'
import {createContext,runInContext} from 'node:vm'
import * as jsx from 'react/jsx-runtime'
import ts from 'typescript'
// Execute the real component with React's renderer without importing JSX into the host tsconfig.
const exports:{ArtifactReferenceDetails?:React.ComponentType<{reference?:VersionedArtifactReference;current?:'available'|'unavailable'|'unchecked';L:(en:string,zh:string)=>string}>}={}
const source=ts.transpileModule(readFileSync(new URL('../web/chat/artifact-reference-details.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText
runInContext(source,createContext({exports,require:(id:string)=>id==='react/jsx-runtime'?jsx:{}}))
const ArtifactReferenceDetails=exports.ArtifactReferenceDetails!
import type {VersionedArtifactReference} from '../src/artifact-reference.ts'
const L=(en:string)=>en
const common={schema:1 as const,id:'a'.repeat(64),sha256:'b'.repeat(64),publication:'not_tracked' as const}
const attachment={...common,kind:'chat-attachment' as const,version:1 as const,visibility:'conversation' as const,retention:'subject_to_history_cleanup' as const}
const view={...common,kind:'workspace-view' as const,version:'b'.repeat(64),visibility:'operator_workspace' as const,retention:'subject_to_plugin_removal' as const}
const file={...common,kind:'goal-artifact' as const,version:2,visibility:'operator_workspace' as const,retention:'subject_to_history_cleanup' as const,name:'report.pdf',mediaType:'application/pdf',bytes:1,category:'document' as const,availability:'retained' as const,downloadPath:'/goal-artifacts/'+common.id}
const render=(reference?:VersionedArtifactReference,current?:'available'|'unavailable'|'unchecked')=>renderToStaticMarkup(createElement(ArtifactReferenceDetails,{reference,current,L}))
it('displays all three reference kinds without inventing links, authorization or publication',()=>{
 for(const ref of [attachment,view,file]){
  const html=render(ref)
  expect(html).toContain(ref.id);expect(html).toContain(ref.sha256)
  expect(html).toContain('Not checked.');expect(html).toContain('does not grant access')
  expect(html).not.toContain('href=');expect(html).not.toContain('<iframe');expect(html).not.toContain('<script')
 }
 expect(render(file,'available')).toContain('retained bytes')
 expect(render(view,'available')).toContain('not a runtime snapshot')
 expect(render(attachment)).toContain('not an immutable version resolver')
})
it('does not imply legacy uploads or missing references have immutable history',()=>{
 expect(render({...attachment,version:null,sha256:null})).toContain('Not recorded')
 expect(render()).toContain('No version identity was recorded')
 expect(render()).toContain('Historical version opening is not supported')
 expect(render(view,'unavailable')).toContain('Unavailable in this context')
})
it('escapes reference text and renders Chinese labels',()=>{
 expect(render({...attachment,id:'<script>alert(1)</script>'})).not.toContain('<script>')
 expect(renderToStaticMarkup(createElement(ArtifactReferenceDetails,{reference:view,L:(_en,zh)=>zh}))).toContain('不是运行时快照')
})
it('keeps all three surfaces connected to the shared read-only presentation',()=>{
 for(const [path,reference] of [['artifact-result.tsx','value'],['attachments.tsx','file.reference'],['workspace-view.tsx','view?.reference']]){
  const source=readFileSync(new URL('../web/chat/'+path,import.meta.url),'utf8')
  expect(source).toContain('<ArtifactReferenceDetails reference={'+reference+'}')
 }
})
