import type {PreferenceDecision} from '../../src/preference-resolution.ts';
import type {MemoryProjection} from '../../src/router-memory.ts';
export type Labels=(en:string,zh:string)=>string;
export type Method={id:string;version:number;goalId:string;title:string;state:string;revision:number;passed:number;failed:number;parameters:{name:string;label:string}[]};
export type Entry={conversationId?:string;request:{id:string;text:string};id:string;label:string;scopeId:string;revision:number;enabled:boolean;policy:{writeMode:string};items:MemoryProjection[];canManageExceptions?:boolean;preferenceDecisions?:Record<string,PreferenceDecision>;skills:Method[];goals:{id:string;title:string}[];cooperation:{id:string;content:string;condition:string}[]};
export async function request<T>(body?:unknown,signal?:AbortSignal):Promise<T>{
 const response=await fetch('/api/chat/memory',{signal,...(body?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{})});
 if(!response.ok)throw Error('memory_request_failed');return response.json();
}
export function download(file:string,text:string){const url=URL.createObjectURL(new Blob([text],{type:'text/markdown;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download=file;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
