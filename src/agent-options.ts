import type {AgentOptions,ApiDefinition} from './backend-config.ts'

/** Omission inherits, null is a provider value, arrays replace. Never mutate defaults. */
export function mergeParameters(base:Record<string,unknown>={},override:Record<string,unknown>={}):Record<string,unknown>{
 const result=structuredClone(base)
 for(const [key,value] of Object.entries(override)){
  if(['__proto__','prototype','constructor'].includes(key))throw Error('Invalid parameter key')
  result[key]=value&&typeof value==='object'&&!Array.isArray(value)?mergeParameters(isRecord(result[key])?result[key]:{},value as Record<string,unknown>):structuredClone(value)
 }
 return result
}
function isRecord(v:unknown):v is Record<string,unknown>{return !!v&&typeof v==='object'&&!Array.isArray(v)}
export function mergeOptions(base:AgentOptions={},override:AgentOptions={}):AgentOptions{return {...structuredClone(base),...structuredClone(override),parameters:mergeParameters(base.parameters,override.parameters)}}
export function apiOptions(d:ApiDefinition,o:AgentOptions):ApiDefinition{
 let parameters=mergeParameters(d.parameters,o.parameters)
 if(o.effort!==undefined){
  if(d.kind==='anthropic')throw Error('Anthropic uses provider thinking/output_config parameters; generic effort is not mapped implicitly')
  const raw=d.kind==='openai-responses'?(parameters.reasoning as any)?.effort:parameters.reasoning_effort
  if(raw!==undefined&&raw!==o.effort)throw Error('Conflicting reasoning effort in form and provider parameters')
  parameters=d.kind==='openai-responses'?mergeParameters(parameters,{reasoning:{effort:o.effort}}):{...parameters,reasoning_effort:o.effort}
 }
 return {...d,parameters,...(o.maxOutputTokens!==undefined?{maxOutputTokens:o.maxOutputTokens}:{}),...(o.maxSteps!==undefined?{maxSteps:o.maxSteps}:{}),...(o.maxToolCalls!==undefined?{maxToolCalls:o.maxToolCalls}:{})}
}
