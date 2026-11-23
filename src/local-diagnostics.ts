import {randomUUID} from 'node:crypto'
import {z} from 'zod'
import type {Runtime} from './runtime.ts'
import {probeSandbox} from './sandbox.ts'
export class LocalDiagnosticError extends Error {constructor(readonly code:string,readonly status=409){super(code)}}
const inputSchema=z.object({revision:z.number().int().nonnegative(),environmentRef:z.string().uuid().optional()}).strict()
type Result={revision:number;checkedAt:number;state:'passed'|'failed'|'disabled';code:string}
/** Volatile evidence belongs to this exact host instance, never its replacement.
 * No credentials, provider probes, task grants or configuration writes. */
export class LocalDiagnostics {
 private result?:{host:Runtime;value:Result}
 private busy=false
 private readonly environments=new WeakMap<Runtime,string>()
 private environmentRef(host:Runtime){
  let ref=this.environments.get(host)
  if(!ref){ref=randomUUID();this.environments.set(host,ref)}
  return ref
 }
 constructor(private host:()=>Runtime,private probe=probeSandbox){}
 snapshot(){
  const host=this.host(),revision=host.settings.current().revision
  const result=this.result?.host===host&&this.result.value.revision===revision?this.result.value:null
  const sandboxDriver=host.config.work.sandboxDriver
  const localSources=host.config.sources.filter(source=>source.kind==='local'&&source.enabled&&source.allowedActors.length>0)
  // Configuration is not proof an actual ticket directory has been prepared or granted.
  const workspace={readOnly:localSources.some(source=>source.sandbox==='read-only'),workspaceWrite:localSources.some(source=>source.sandbox==='workspace-write')}
  const environment={schema:1 as const,kind:'current-host' as const,ref:this.environmentRef(host),observedAt:Date.now(),workspace,
   eligibility:{sandboxCheck:sandboxDriver!=='disabled',sandboxStartup:sandboxDriver==='disabled'?'disabled' as const:result?.state==='passed'?'verified' as const:result?.state==='failed'?'failed' as const:'unverified' as const,browserPublish:false as const,browserPublishReason:host.config.browser.enabled?'browser_identity_unverified' as const:'browser_disabled' as const,crossMachine:false as const}}
  return {revision,environment,platform:process.platform,nodeVersion:process.versions.node,sandboxDriver,browser:{state:'unsupported' as const,code:'browser_isolation_unverified'},result,busy:this.busy}
 }
 async check(value:unknown,authorize:()=>void=()=>{}){
  const input=inputSchema.parse(value),host=this.host(),revision=host.settings.current().revision
  authorize()
  if(input.environmentRef!==undefined&&input.environmentRef!==this.environmentRef(host))throw new LocalDiagnosticError('diagnostic_stale')
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
