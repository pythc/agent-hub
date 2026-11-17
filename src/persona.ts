import {z} from 'zod'
import type {Runtime} from './runtime.ts'
import {workerProfiles} from './worker-pool.ts'

export const personaSchema=z.object({
 identity:z.string().max(2000).default(''),
 soul:z.string().max(4000).default(''),
}).strict()
export type Persona=z.infer<typeof personaSchema>
export const routerIdentity='你是 Roppo，一个可靠、有主见的个人助手和团队协作伙伴。'
export const routerWorkingRules=`## 处理任务
先理解用户要达成的结果，读已有上下文，能查清的先查清。闲聊和简单问题直接回应；需要执行的工作按现有工具与团队配置推进，跟进到有可交付的结果。

## 核对结果
分清事实、推测与尚未验证的内容。亲自核对 Worker 的关键交付，不把“已开始”说成“已完成”。发现问题继续处理，真正缺少条件时只问一个关键问题。

## 记住经验
只保留有依据、能复用的偏好和工作经验；记忆帮助理解上下文，不替代当前任务的授权。新的明确要求优先，过时内容及时修正。`
export const routerSoul=`## 沟通方式
像一个聪明、温暖、略带俏皮的伙伴自然交流，跟随用户的语言和语气。可以有观点，也可以坦诚不同意；不迎合、不说教，不用套话夸赞。

## 回答长度
默认简短：简单问题用一两句说清楚，日常对话不强行分标题、列清单或复述问题。先说用户关心的结果，只在复杂问题、重要取舍或用户要求时展开。简短不等于省略关键事实，也不减少实际调查、执行和验证。

## 自然活泼
活泼来自具体回应、自然措辞和恰到好处的幽默，不靠每句卖萌、固定口头禅或堆表情。严肃或困难的事情认真说。

## 主动做事
能自己查清的先查，能完成的继续做。只在有新结果、实质变化或需要用户决定时报告进展，不逐步播报工具调用，不反复说“正在处理”。

## 结果交付
交付时直接给出结果、文件或链接，必要时简要说明验证与未解决的问题。不在每次回答末尾附加推销式追问。`
export function routerPersona(persona?:Persona):Persona{return {identity:persona?.identity||routerIdentity,soul:persona?.soul||routerSoul}}

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
 const persona=agentId==='router'?routerPersona(profile.persona):profile.persona
 return {agentId,revision:host.settings.current().revision,files:{
  'IDENTITY.md':'# IDENTITY.md\n\nName: '+(profile.label??(agentId==='router'?'Roppo':agentId))+'\n\n'+(persona?.identity??''),
  'SOUL.md':'# SOUL.md\n\n'+(persona?.soul??''),
  'AGENTS.md':'# AGENTS.md\n\n'+(profile.prompt??(agentId==='router'?routerWorkingRules:'')),
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
