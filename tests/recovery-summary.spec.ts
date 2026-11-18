import {expect,it} from 'vitest'
import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {readFileSync} from 'node:fs'
import {createContext,runInContext} from 'node:vm'
import * as jsx from 'react/jsx-runtime'
import ts from 'typescript'
import {readRecoveryManifest} from '../web/chat/recovery-summary-model.ts'
import type {TraceTask} from '../src/execution-trace.ts'
const manifest={schema:1,ticketId:'private-task',settingsRevision:2,observation:'a'.repeat(64),session:'original_inspectable',nextSafeAction:'inspect_original_session',replayAllowed:false,checkpoints:[{stage:'tool',cursor:12,origin:'transition'},{stage:'delivery',cursor:13,origin:'baseline'}],checkpointScope:'retained_ticket_history'}
const task={id:'private-task',revision:2,observed:'a'.repeat(64),unknownEffects:false,status:{effects:{state:'none'},delivery:{state:'none'}},actions:['inspect','read_history'],recovery:manifest} as unknown as TraceTask
const exports:any={}
runInContext(ts.transpileModule(readFileSync(new URL('../web/chat/recovery-summary.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,createContext({exports,require:(id:string)=>id==='react/jsx-runtime'?jsx:id==='./recovery-summary-model.ts'?{readRecoveryManifest}:{}}))
const render=(value:TraceTask=task,language='en')=>renderToStaticMarkup(createElement(exports.RecoverySummary,{task:value,language}))
it('renders redacted, bilingual local checkpoint guidance without adding actions',()=>{
 const html=render({...task,recovery:{...manifest,secret:'SECRET_CREDENTIAL'} as any})
 expect(html).toContain('Inspect the original session');expect(html).toContain('Record');expect(html).toContain('12');expect(html).toContain('Imported baseline')
 expect(html).not.toMatch(/private-task|SECRET_CREDENTIAL|aaaaaaa|<button|<a\s|<iframe|<script/)
 expect(html).toContain('not a backup');expect(html).toContain('permission to replay')
 const chinese=render(task,'zh-CN');expect(chinese).toContain('恢复指引与检查点');expect(chinese).toContain('导入基线');expect(chinese).toContain('重放许可')
})
it('fails closed on stale task, revision, observation or session authority',()=>{
 for(const override of [{id:'other'},{revision:3},{observed:'b'.repeat(64)},{actions:['inspect']}]){
  const next={...task,...override} as TraceTask
  expect(readRecoveryManifest(manifest,next)).toBeNull();expect(render(next)).toContain('does not match');expect(render(next)).not.toContain('Record 12')
 }
})
it('rejects unsupported or malformed manifests and checkpoints',()=>{
 for(const patch of [{schema:2},{replayAllowed:true},{session:'restorable'},{nextSafeAction:'resume_now'},{checkpointScope:'all_history'},{settingsRevision:2.5},{checkpoints:[{stage:'tool',cursor:-1,origin:'transition'}]},{checkpoints:[{stage:'tool',cursor:1.5,origin:'transition'}]},{checkpoints:[{stage:'tool',cursor:1,origin:'remote_success'}]},{checkpoints:[{stage:'SECRET_STAGE',cursor:1,origin:'transition'}]},{checkpoints:[manifest.checkpoints[0],manifest.checkpoints[0]]},{checkpoints:Array(4).fill(manifest.checkpoints[0])}])expect(readRecoveryManifest({...manifest,...patch},task)).toBeNull()
 expect(readRecoveryManifest(null,task)).toBeNull()
 expect(readRecoveryManifest({...manifest,session:'unavailable'},{...task,actions:['inspect']})).toBeNull()
})
it('keeps uncertain effects in reconciliation guidance and never suggests replay',()=>{
 for(const current of [{...task,unknownEffects:true},{...task,status:{...task.status,effects:{state:'unknown'}}},{...task,status:{...task.status,delivery:{state:'uncertain'}}}] as TraceTask[]){
  expect(readRecoveryManifest(manifest,current)).toBeNull()
  const html=render({...current,recovery:{...manifest,nextSafeAction:'reconcile_effects'} as any});expect(html).toContain('Do not repeat uncertain actions');expect(html).not.toContain('<button')
 }
})
it('handles legacy absence and empty retained history without claiming that nothing happened',()=>{
 expect(render({...task,recovery:undefined})).toBe('')
 const html=render({...task,actions:['inspect'],recovery:{...manifest,session:'unavailable',nextSafeAction:'inspect_state',checkpoints:[]} as any})
 expect(html).toContain('No retained checkpoints');expect(html).toContain('do not prove');expect(html).toContain('not currently available')
})
it('renders every supported next safe action using fixed text only',()=>{
 for(const nextSafeAction of ['reconcile_effects','wait_for_current_work','answer_approval','review_context','repair_blocker','review_result','inspect_original_session','inspect_state']){
  const html=render({...task,recovery:{...manifest,nextSafeAction} as any});expect(html).not.toContain('does not match');expect(html).not.toContain('<button');expect(html).toContain('trace-guidance')
 }
 const source=readFileSync(new URL('../web/chat/execution-trace.tsx',import.meta.url),'utf8')
 expect(source).toContain('<RecoverySummary task={task} language={language}/>')
})
