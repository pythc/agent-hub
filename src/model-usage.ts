import {z} from 'zod'
import type {TokenCounts} from './usage-contract.ts'
export type {TokenCounts,UsageField} from './usage-contract.ts'

const count=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
/** Snapshots replace the same id. Cache is part of input; reasoning is part of output. */
export const modelUsageSchema=z.object({id:z.string().min(1).max(200),inputTokens:count.optional(),cachedInputTokens:count.optional(),cacheWriteInputTokens:count.optional(),outputTokens:count.optional(),reasoningOutputTokens:count.optional(),totalTokens:count.optional()}).strict()
export type ModelUsage=z.infer<typeof modelUsageSchema>
export const usageFields=['inputTokens','cachedInputTokens','cacheWriteInputTokens','outputTokens','reasoningOutputTokens','totalTokens'] as const
const valid=(n:unknown):n is number=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=0

/** Whitelist provider metadata; malformed/missing telemetry never changes task execution. */
export function providerUsage(id:string,kind:string,value:any):ModelUsage{
 const u=value??{},out:ModelUsage={id}
 const fields=kind==='openai-chat'?{inputTokens:u.prompt_tokens,cachedInputTokens:u.prompt_tokens_details?.cached_tokens,outputTokens:u.completion_tokens,reasoningOutputTokens:u.completion_tokens_details?.reasoning_tokens,totalTokens:u.total_tokens}
  :kind==='anthropic'?{inputTokens:valid(u.input_tokens)?u.input_tokens+(valid(u.cache_read_input_tokens)?u.cache_read_input_tokens:0)+(valid(u.cache_creation_input_tokens)?u.cache_creation_input_tokens:0):undefined,cachedInputTokens:u.cache_read_input_tokens,cacheWriteInputTokens:u.cache_creation_input_tokens,outputTokens:u.output_tokens}
  :{inputTokens:u.input_tokens,cachedInputTokens:u.input_tokens_details?.cached_tokens,cacheWriteInputTokens:u.input_tokens_details?.cache_write_tokens,outputTokens:u.output_tokens,reasoningOutputTokens:u.output_tokens_details?.reasoning_tokens,totalTokens:u.total_tokens}
 for(const [key,n] of Object.entries(fields))if(valid(n))(out as any)[key]=n
 return normalizeUsage(out)??{id}
}
export function normalizeUsage(value:unknown):ModelUsage|undefined{
 const parsed=modelUsageSchema.safeParse(value);if(!parsed.success)return
 const u=parsed.data
 if(u.inputTokens!==undefined){if((u.cachedInputTokens??0)>u.inputTokens)delete u.cachedInputTokens;if((u.cacheWriteInputTokens??0)>u.inputTokens)delete u.cacheWriteInputTokens}
 if(u.outputTokens!==undefined&&(u.reasoningOutputTokens??0)>u.outputTokens)delete u.reasoningOutputTokens
 if(u.inputTokens!==undefined&&u.outputTokens!==undefined){const total=u.inputTokens+u.outputTokens;if(valid(total))u.totalTokens=total;else delete u.totalTokens}
 return u
}
export function sumUsage(items:ModelUsage[]):TokenCounts{
 return Object.fromEntries(usageFields.map(field=>{const known=items.flatMap(u=>u[field]===undefined?[]:[u[field]!]),sum=known.reduce((a,b)=>a+b,0);return [field,known.length&&valid(sum)?sum:null]})) as TokenCounts
}
