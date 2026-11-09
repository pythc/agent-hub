import {z} from 'zod'

const loopback=new Set(['127.0.0.1','localhost','[::1]'])
export const publicOriginSchema=z.string().max(2000).refine(value=>{
 try{const u=new URL(value);return u.protocol==='http:'&&loopback.has(u.hostname)&&!u.username&&!u.password&&!u.search&&!u.hash&&u.pathname==='/'&&(value===u.origin||value==='http://'+u.hostname+':80')}catch{return false}
},'Use a loopback HTTP origin with no path, credentials, query or fragment').transform(value=>new URL(value).origin)
export const httpDeploymentSchema=z.object({listenHost:z.enum(['127.0.0.1','0.0.0.0','::1']).default('127.0.0.1'),publicOrigin:publicOriginSchema}).strict()
/** Internal clients keep their loopback URL; only the browser origin is mapped. */
export function requestHostOrigin(host:string|undefined,internal:string,publicOrigin?:string){
 if(!host||/[\s,\\/@?#]/.test(host))throw Error('Invalid Host')
 const u=new URL('http://'+host),ports=new Set([new URL(internal).port,...(publicOrigin?[new URL(publicOrigin).port]:[])])
 if(!loopback.has(u.hostname)||!ports.has(u.port)||u.username||u.password||u.pathname!=='/'||u.search||u.hash)throw Error('Use the configured local origin')
 return u.origin
}
