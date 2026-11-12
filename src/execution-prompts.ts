import type {Config} from './config.ts'
import {builtins,compose,composeCoordinator,digest,type Part} from './prompts.ts'
import {appendAgentPrompt,managedBase} from './managed-instructions.ts'
import {mergeOptions} from './agent-options.ts'
import {workerProfiles} from './worker-pool.ts'

export interface PromptSection {id:string;source:string;text:string;digest:string}
export interface ExecutionPrompt {
 role:'router'|'worker'|'subagent'
 environment:Record<string,unknown>
 policyVersion?:string
 hostRouter?:boolean
 scoped?:boolean
 delegated?:boolean
 managedGoal?:boolean
 project?:Record<string,unknown>|boolean
 agentPrompt?:string
}
export const previewModes=['standalone','delegated','goal','project','subagent'] as const
export type PreviewMode=typeof previewModes[number]
export interface PromptPreviewInput {role:'router'|'worker';mode?:PreviewMode;sourceId?:string;workerId?:string}

/** Runtime start, live refresh and operator preview share these mode boundaries. */
export function composeExecutionPrompt(config:Config,input:ExecutionPrompt){
 const sections:PromptSection[]=[]
 const add=(id:string,text:string,source:string)=>{if(text)sections.push({id,text,source,digest:digest(text)})}
 const part=(id:Part)=>add(id,config.prompts.overrides[id]?.text??builtins[id],config.prompts.overrides[id]?'override:'+id:'built-in:'+id)
 if(input.role==='router'){
  add('role',input.hostRouter?composeCoordinator(config,input.environment):compose(config,'router',input.environment,input.policyVersion??'preview'),input.hostRouter?'src/prompts.ts#composeCoordinator':'src/prompts.ts#compose')
  if(input.hostRouter){
   if(input.project)part('runtime/coordinator/project')
   if(input.scoped)part('runtime/coordinator/context')
  }
 }else{
  add('role',compose(config,'worker',input.environment,input.policyVersion??'preview'),'src/prompts.ts#compose')
  if(input.role==='subagent')part('runtime/subagent')
  else{
   if(input.delegated)part('runtime/worker/delegated')
   if(input.project){
    part('runtime/worker/project')
    if(typeof input.project==='object')add('project-context',JSON.stringify(input.project),'task:project')
   }
   part('runtime/worker/tools')
   part(input.managedGoal?'runtime/worker/goal':input.delegated?'runtime/worker/continuation':'runtime/worker/standalone')
  }
 }
 const text=appendAgentPrompt(sections.map(section=>section.text).join('\n\n'),input.agentPrompt)
 if(input.agentPrompt)add('agent-profile','Agent instructions:\n'+input.agentPrompt,'agent:effective-options.prompt')
 return {text,sections}
}

/** A configuration scenario, not a claim to reproduce an existing provider conversation. */
export function previewInstructions(config:Config,input:PromptPreviewInput,scoped=false){
 const source=input.sourceId?config.sources.find(s=>s.id===input.sourceId):config.sources[0]
 if(input.sourceId&&!source)throw Error('Unknown preview source')
 const worker=input.role==='worker'?(input.workerId?workerProfiles(config).find(w=>w.id===input.workerId):workerProfiles(config)[0]):undefined
 if(input.workerId&&!worker)throw Error('Unknown preview Worker')
 const hostRouter=config.execution.router?.mode==='host'
 const mode=input.mode??(source?.workspace?.project?'project':scoped?'goal':input.role==='worker'&&hostRouter?'delegated':'standalone')
 if(input.role==='router'&&['delegated','subagent'].includes(mode))throw Error('This preview mode belongs to a Worker')
 const parentBackend=(input.role==='router'?config.execution.router?.backend:worker?.backend)??config.execution.roles[input.role]??config.execution.backend
 const backendId=mode==='subagent'?config.execution.roles.subagent??parentBackend:parentBackend
 const backend=config.backends[backendId]??(backendId==='codex'?{kind:'codex' as const}:undefined)
 if(!backend)throw Error('Unknown preview backend')
 const profile=input.role==='router'?config.execution.router:mode==='subagent'&&backendId!==parentBackend?undefined:worker
 const options=mergeOptions(backend.defaults,profile)
 const environment={preview:true,source:source?.id,cwd:'<task directory>',...(input.role==='router'?{discussion:'<source conversation>',...(['goal','project'].includes(mode)?{routerId:'<router>',scopeId:'<scope>'}:{})}:{ticketId:'<task>',mandate:'<immutable task mandate>',matchedRules:[],...(mode==='subagent'?{subagent:true}:{})})}
 const composed=composeExecutionPrompt(config,{role:mode==='subagent'?'subagent':input.role,environment,hostRouter,scoped:['goal','project'].includes(mode),delegated:['delegated','goal','project'].includes(mode),managedGoal:['goal','project'].includes(mode),project:mode==='project'?{cwd:'<task directory>',base:'<base commit>',prerequisites:['<accepted dependency commits, if any>'],testCommand:source?.workspace?.project?.testCommand??'<project test command>',integration:true}:false,agentPrompt:options.prompt})
 const baseInstructions=backend.kind==='codex'?managedBase:undefined
 return {...composed,role:input.role,mode,sourceId:source?.id,workerId:worker?.id,backendId,baseInstructions,baseDigest:baseInstructions?digest(baseInstructions):undefined,digest:digest(composed.text),context:'configuration-scenario' as const,boundary:'Task input and output/tool schemas are supplied separately. Provider protocol framing and platform-owned instructions are not part of this role preview.'}
}
