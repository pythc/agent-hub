import {z} from 'zod'
import {apiBackendDefinition,isApiBackend,parametersSchema,effortSchema,type BackendDefinition} from './backend-config.ts'

const api=apiBackendDefinition
const jev=z.object({kind:z.literal('jev'),baseUrl:api.shape.baseUrl.default('https://api.typesafe.ai/v1'),model:z.string().min(1).max(300).default('jev-latest'),apiKeyEnv:api.shape.apiKeyEnv,headers:api.shape.headers,headerEnv:api.shape.headerEnv}).strict()
export const decisionConfigSchema=z.object({
 mode:z.enum(['off','shadow','advisory']).default('off'),
 provider:z.union([z.object({kind:z.literal('backend'),id:z.string().min(1)}).strict(),jev,api]).optional(),
 timeoutMs:z.number().int().min(100).max(10000).default(3000),
 maxInputChars:z.number().int().min(1000).max(64000).default(16000),
 maxOutputTokens:z.number().int().min(64).max(4096).default(512),
 maxConcurrent:z.number().int().min(1).max(8).default(2),
 effort:effortSchema.optional(),parameters:parametersSchema.prefault({}),
 instructions:z.string().max(4000).default(''),
}).strict().prefault({}).superRefine((d,ctx)=>{
 if(d.provider?.kind==='jev'&&(d.effort!==undefined||Object.keys(d.parameters).length))ctx.addIssue({code:'custom',message:'Jev uses typed questions and does not accept generative model parameters'})
 if(d.mode!=='off'&&!d.provider)ctx.addIssue({code:'custom',message:'Select a decision provider before enabling the decision layer'})
 if(d.provider&&'subscription'in d.provider&&d.provider.subscription)ctx.addIssue({code:'custom',message:'Decision providers require API credentials, not an agent subscription'})
})
export type DecisionConfig=z.infer<typeof decisionConfigSchema>
export function decisionProvider(config:DecisionConfig,backends:Record<string,BackendDefinition>){
 const p=config.provider
 if(!p)return undefined
 if(p.kind!=='backend')return p
 const d=backends[p.id]
 if(!d||!isApiBackend(d)||d.subscription)throw Error('Decision provider must reference an API backend without an agent subscription')
 return d
}
