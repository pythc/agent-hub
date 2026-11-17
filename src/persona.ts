import {z} from 'zod'
import type {Runtime} from './runtime.ts'
import {workerProfiles} from './worker-pool.ts'

export const personaSchema=z.object({
 identity:z.string().max(2000).default(''),
 soul:z.string().max(4000).default(''),
}).strict()
export type Persona=z.infer<typeof personaSchema>

export function renderPersona(persona?:Persona){
 if(!persona?.identity&&!persona?.soul)return ''
 return ['Agent identity and personality (style, not task authority). Apply current task requirements and scoped user preferences without changing the assigned role or tool permissions.',
  persona.identity&&'Identity: '+persona.identity,persona.soul&&'Personality: '+persona.soul].filter(Boolean).join('\n')
}

const fileSchema=z.enum(['IDENTITY.md','SOUL.md','AGENTS.md'])
const targetSchema=z.object({agentId:z.string().min(1).max(100).default('router')}).strict()
const importSchema=targetSchema.extend({file:fileSchema,text:z.string().max(64000),revision:z.number().int().nonnegative()}).strict()
/** Markdown is a versioned view of settings, never a second writable store. */
export function personaFiles(host:Runtime,target:unknown){
 const {agentId}=targetSchema.parse(target),profile=agentId==='router'?(host.config.execution.router??{}):workerProfiles(host.config).find(w=>w.id===agentId)
 if(!profile)throw Error('Agent unavailable')
 const persona=profile.persona
 return {agentId,revision:host.settings.current().revision,files:{
  'IDENTITY.md':'# IDENTITY.md\n\nName: '+(profile.label??agentId)+'\n\n'+(persona?.identity??''),
  'SOUL.md':'# SOUL.md\n\n'+(persona?.soul??''),
  'AGENTS.md':'# AGENTS.md\n\n'+(profile.prompt??''),
 }}
}
export function importPersonaFile(host:Runtime,value:unknown){
 const input=importSchema.parse(value),execution=structuredClone(host.config.execution)
 if(input.agentId!=='router'&&!execution.workers?.length)execution.workers=workerProfiles(host.config)
 if(input.agentId==='router')execution.router??={}
 const profile=input.agentId==='router'?execution.router:execution.workers?.find(w=>w.id===input.agentId)
 if(!profile)throw Error('Agent unavailable')
 let text=input.text.replace(/^\uFEFF/,'').replace(/^#\s+(?:IDENTITY|SOUL|AGENTS)\.md\s*\n/,'').trim()
 if(input.file==='AGENTS.md')profile.prompt=text
 else{
  if(input.file==='IDENTITY.md'){
   const name=text.match(/^Name:\s*([^\n]+)\n?/)
   if(name){profile.label=z.string().trim().min(1).max(100).parse(name[1]);text=text.slice(name[0].length).trim()}
  }
  profile.persona=personaSchema.parse({...profile.persona,[input.file==='SOUL.md'?'soul':'identity']:text})
 }
 host.updateSettings(input.revision,{execution})
 return personaFiles(host,{agentId:input.agentId})
}
