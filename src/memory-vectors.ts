import type {MemoryPolicy} from './memory-policy.ts'

export type EmbedMemory=(text:string,config:NonNullable<MemoryPolicy['embedding']>,signal:AbortSignal)=>Promise<number[]>
/** Explicitly configured endpoint only. Redirects cannot forward the credential. */
export const embedMemory:EmbedMemory=async(text,config,signal)=>{
 const result=await memoryJSON(config,{model:config.model,input:text},signal,'embedding')
 return validateMemoryVector(result.data?.[0]?.embedding)
}
/** Shared bounded transport; destinations and credentials are explicit scope policy. */
export async function memoryJSON(config:{url:string;apiKeyEnv?:string},body:unknown,signal:AbortSignal,purpose:'embedding'|'rerank'){
 const key=config.apiKeyEnv?process.env[config.apiKeyEnv]:undefined
 if(config.apiKeyEnv&&!key)throw Error(purpose+'_credential_unavailable')
 const input=JSON.stringify(body);if(Buffer.byteLength(input)>256000)throw Error(purpose+'_request_too_large')
 const response=await fetch(config.url,{method:'POST',redirect:'error',signal,headers:{'content-type':'application/json',...(key?{authorization:'Bearer '+key}:{})},body:input})
 if(!response.ok)throw Error(purpose+'_http_'+response.status)
 const length=Number(response.headers.get('content-length')??0);if(length>1000000)throw Error(purpose+'_response_too_large')
 const reader=response.body?.getReader();if(!reader)throw Error(purpose+'_empty_response')
 const chunks:Uint8Array[]=[];let bytes=0
 try{while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>1000000)throw Error(purpose+'_response_too_large');chunks.push(part.value)}}finally{await reader.cancel()}
 return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}
export function validateMemoryVector(value:unknown):number[]{
 if(!Array.isArray(value)||!value.length||value.length>8192||value.some(n=>typeof n!=='number'||!Number.isFinite(n))||!value.some(n=>n!==0))throw Error('invalid_embedding')
 return value
}
