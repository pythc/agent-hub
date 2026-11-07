import type {MemoryPolicy} from './memory-policy.ts'

export type EmbedMemory=(text:string,config:NonNullable<MemoryPolicy['embedding']>,signal:AbortSignal)=>Promise<number[]>
/** Explicitly configured endpoint only. Redirects cannot forward the credential. */
export const embedMemory:EmbedMemory=async(text,config,signal)=>{
 const key=config.apiKeyEnv?process.env[config.apiKeyEnv]:undefined
 if(config.apiKeyEnv&&!key)throw Error('embedding_credential_unavailable')
 const response=await fetch(config.url,{method:'POST',redirect:'error',signal,headers:{'content-type':'application/json',...(key?{authorization:'Bearer '+key}:{})},body:JSON.stringify({model:config.model,input:text})})
 if(!response.ok)throw Error('embedding_http_'+response.status)
 const length=Number(response.headers.get('content-length')??0);if(length>1000000)throw Error('embedding_response_too_large')
 const reader=response.body?.getReader();if(!reader)throw Error('embedding_empty_response')
 const chunks:Uint8Array[]=[];let bytes=0
 try{while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>1000000)throw Error('embedding_response_too_large');chunks.push(part.value)}}finally{await reader.cancel()}
 const result=JSON.parse(Buffer.concat(chunks).toString('utf8'))
 return validateMemoryVector(result.data?.[0]?.embedding)
}
export function validateMemoryVector(value:unknown):number[]{
 if(!Array.isArray(value)||!value.length||value.length>8192||value.some(n=>typeof n!=='number'||!Number.isFinite(n))||!value.some(n=>n!==0))throw Error('invalid_embedding')
 return value
}
