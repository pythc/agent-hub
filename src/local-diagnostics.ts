import {z} from 'zod'
import type {Runtime} from './runtime.ts'
import {probeSandbox} from './sandbox.ts'
export class LocalDiagnosticError extends Error {constructor(readonly code:string,readonly status=409){super(code)}}
const inputSchema=z.object({revision:z.number().int().nonnegative()}).strict()
type Result={revision:number;checkedAt:number;state:'passed'|'failed'|'disabled';code:string}
/** Volatile evidence belongs to this exact host instance, never its replacement.
 * No credentials, provider probes, task grants or configuration writes. */
export class LocalDiagnostics {
 private result?:{host:Runtime;value:Result}
 private busy=false
 constructor(private host:()=>Runtime,private probe=probeSandbox){}
 snapshot(){
  const host=this.host(),revision=host.settings.current().revision
  return {revision,platform:process.platform,nodeVersion:process.versions.node,sandboxDriver:host.config.work.sandboxDriver,browser:{state:'unsupported' as const,code:'browser_isolation_unverified'},result:this.result?.host===host&&this.result.value.revision===revision?this.result.value:null,busy:this.busy}
 }
 async check(value:unknown,authorize:()=>void=()=>{}){
  const input=inputSchema.parse(value),host=this.host(),revision=host.settings.current().revision
  authorize()
  if(input.revision!==revision)throw new LocalDiagnosticError('settings_conflict')
  if(this.busy)throw new LocalDiagnosticError('diagnostic_busy')
  this.busy=true;this.result=undefined
  try{
   const driver=host.config.work.sandboxDriver
   let result:Result={revision,checkedAt:Date.now(),state:'disabled',code:'sandbox_disabled'}
   if(driver!=='disabled'){
    try{const checked=await this.probe(driver,host.config.codex);result={revision,checkedAt:Date.now(),state:checked.verified?'passed':'failed',code:checked.verified?'sandbox_started':'sandbox_unverified'}}
    catch{result={revision,checkedAt:Date.now(),state:'failed',code:'sandbox_start_failed'}}
   }
   authorize()
   if(this.host()!==host||host.settings.current().revision!==revision)throw new LocalDiagnosticError('diagnostic_stale')
   this.result={host,value:result}
   return {...this.snapshot(),busy:false}
  }finally{this.busy=false}
 }
}
