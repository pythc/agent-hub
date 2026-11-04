import {z} from 'zod'
const envName=z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/)
const name=z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/)
const apiBase=z.string().url().superRefine((s,ctx)=>{
 const u=new URL(s),local=['localhost','127.0.0.1','[::1]'].includes(u.hostname)
 if(!['https:','http:'].includes(u.protocol)||u.protocol==='http:'&&!local||u.username||u.password||u.search||u.hash)ctx.addIssue({code:'custom',message:'Backend requires HTTPS, or loopback HTTP, with no URL credentials/query/fragment'})
})
const parameters=z.record(z.unknown()).default({}).superRefine((p,ctx)=>{
 const reserved=['model','messages','input','instructions','system','tools','tool_choice','stream','store','previous_response_id','conversation','include','response_format','output_config','text','n','max_tokens','max_completion_tokens','max_output_tokens']
 if(Object.keys(p).some(k=>reserved.includes(k)))ctx.addIssue({code:'custom',message:'Provider parameters cannot replace managed model, history, tools or output configuration'})
})
export const backendDefinition=z.discriminatedUnion('kind',[
 z.object({kind:z.literal('codex'),command:z.string().min(1).optional()}).strict(),
 z.object({
  kind:z.enum(['openai-responses','openai-chat','anthropic']),baseUrl:apiBase,model:z.string().min(1),apiKeyEnv:envName.optional(),
  images:z.boolean().default(false),maxSteps:z.number().int().min(1).max(256).default(64),
  maxToolCalls:z.number().int().min(1).max(10000).default(256),
  maxContextBytes:z.number().int().min(4096).max(64000000).default(16000000),
  maxOutputTokens:z.number().int().min(64).max(200000).default(8192),
  requestTimeoutMs:z.number().int().min(100).max(600000).default(120000),
  outputFormat:z.enum(['prompt','json-object','json-schema']).default('prompt'),parameters,
  chatTokenField:z.enum(['max_completion_tokens','max_tokens']).default('max_completion_tokens'),
 }).strict(),
])
export type BackendDefinition=z.infer<typeof backendDefinition>
export type ApiDefinition=Exclude<BackendDefinition,{kind:'codex'}>
export const backendsSchema=z.record(name,backendDefinition).default({})
export const executionSchema=z.object({backend:name.default('codex'),roles:z.object({router:name.optional(),worker:name.optional(),subagent:name.optional()}).strict().default({})}).strict().default({})
export function validateBackendSelection(c:{execution:z.infer<typeof executionSchema>;backends:Record<string,BackendDefinition>}){
 if(c.backends.codex&&c.backends.codex.kind!=='codex')throw Error('The backend ID codex is reserved for native Codex conversations')
 for(const id of [c.execution.backend,...Object.values(c.execution.roles)])if(id&&id!=='codex'&&!c.backends[id])throw Error('Unknown execution backend: '+id)
}
