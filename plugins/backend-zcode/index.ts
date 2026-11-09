import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {randomUUID} from 'node:crypto'
import {BackendAdapterError,type BackendPlugin} from '../backend-sdk.ts'
const exec=promisify(execFile)
// Official 0.17.1 CLI tool names. This limited adapter is never admitted to
// managed roles; native MCP/plugin permission mediation is not yet verified.
const disabled=['Read','Write','Edit','ApplyPatch','Bash','Glob','Grep','WebFetch','WebSearch','web_search','TodoRead','TodoWrite','GoalRead','ReadSessionContext','AskUserQuestion','SendMessage','RespondToCoordinator','TaskOutput','TaskStop','js','js_reset','js_add_node_module_dir','mcp__node_repl__js','mcp__node_repl__js_reset','mcp__node_repl__js_add_node_module_dir','Agent','Task','Skill','CreateWorkflow','AmendWorkflow','FillWorkflowHole','submit_result']
export function classifyZcodeFailure(raw:string){
 if(/select a model before|provider config.*(?:missing|invalid)|model.*not configured/i.test(raw))return 'configuration_invalid' as const
 if(/\b1113\b|insufficient.*balance|quota.*exhausted/i.test(raw))return 'quota_exhausted' as const
 if(/\b405\b|\b3012\b|unusual activity/i.test(raw))return 'provider_rejected' as const
 if(/\b401\b|unauthorized|not logged in|login required/i.test(raw))return 'auth_required' as const
 if(/\b429\b|rate.?limit/i.test(raw))return 'rate_limited' as const
 return 'process_failed' as const
}
export function zcodeResult(stdout:string){
 const lines=stdout.split('\n').filter(Boolean).map(line=>{try{return JSON.parse(line)}catch{return undefined}})
 const errors=lines.filter(v=>v?.type==='error');if(errors.length)throw new BackendAdapterError(classifyZcodeFailure(JSON.stringify(errors)))
 const results=lines.filter(v=>v?.type==='result')
 if(results.length!==1||!/^sess_[a-zA-Z0-9_-]+$/.test(results[0].sessionId)||typeof results[0].response!=='string'||!results[0].response.trim())throw new BackendAdapterError('invalid_output')
 return {threadId:results[0].sessionId as string,turnId:typeof results[0].turnId==='string'?results[0].turnId:randomUUID(),text:results[0].response as string}
}
export default {create(config){
 const command=String(config.command??'zcode'),args=(config.args??[]) as string[]
 return {
  async probe(){
   try{const {stdout}=await exec(command,[...args,'--version'],{timeout:10000,maxBuffer:64000});return {available:true,authenticated:'unknown' as const,remoteVerified:false as const,version:stdout.trim()}}
   catch{throw new BackendAdapterError('configuration_invalid')}
  },
  async run(r){
   if(r.managed||r.threadId||r.tools?.length||r.contextBudget||r.model||r.options?.effort||Object.keys(r.options?.parameters??{}).length)throw new BackendAdapterError('unsupported')
   const argv=[...args,'--cwd',r.cwd,'--json','--mode','plan','--workflow-mode','disabled','--toolsearch-mode','off','--disallowed-tools',disabled.join(','),'--prompt',r.instructions+'\n\n'+r.input]
   let stdout:string
   try{({stdout}=await exec(command,argv,{cwd:r.cwd,timeout:r.options?.timeoutMs??120000,signal:r.signal,maxBuffer:8_000_000}))}
   catch(error:any){throw new BackendAdapterError(r.signal?.aborted?'cancelled':classifyZcodeFailure(String(error.stdout??'')+'\n'+String(error.stderr??'')))}
   const result=zcodeResult(stdout);r.onThread?.(result.threadId);r.onTurn?.(result.turnId)
   return result
  }
 }
}} satisfies BackendPlugin
