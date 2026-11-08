import type {MemoryPolicy} from './memory-policy.ts'
import {memoryJSON} from './memory-vectors.ts'

export interface MemoryRelevance {index:number;score:number}
export type RerankMemory=(query:string,documents:string[],config:NonNullable<MemoryPolicy['reranker']>,signal:AbortSignal)=>Promise<MemoryRelevance[]>
/** Cohere-compatible rerank response; require a complete, unambiguous score mapping. */
export const rerankMemory:RerankMemory=async(query,documents,config,signal)=>{
 const result=await memoryJSON(config,{model:config.model,query,documents,top_n:documents.length},signal,'rerank')
 return validateMemoryRelevance(result.results,documents.length)
}
export function validateMemoryRelevance(value:unknown,count:number):MemoryRelevance[]{
 if(!Array.isArray(value)||value.length!==count)throw Error('invalid_rerank_results')
 const seen=new Set<number>()
 return value.map(row=>{
  if(!row||!Number.isInteger(row.index)||row.index<0||row.index>=count||seen.has(row.index)||typeof row.relevance_score!=='number'||!Number.isFinite(row.relevance_score)||row.relevance_score<0||row.relevance_score>1)throw Error('invalid_rerank_results')
  seen.add(row.index);return {index:row.index,score:row.relevance_score}
 })
}
/** Reserve opportunities for both channels; weak lexical hits cannot evict every dense hit. */
export function memoryCandidates<T extends {id:string}>(dense:T[],lexical:T[],limit:number):T[]{
 const result:T[]=[],seen=new Set<string>()
 for(let i=0;i<Math.max(dense.length,lexical.length)&&result.length<limit;i++)for(const item of [dense[i],lexical[i]]){
  if(!item||seen.has(item.id))continue
  seen.add(item.id);result.push(item);if(result.length===limit)break
 }
 return result
}
export const memoryRetrievalComplete=(mode:string)=>['lexical','hybrid','reranked','verified'].includes(mode)
