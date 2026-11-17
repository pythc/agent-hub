import {createHash,randomUUID} from 'node:crypto'
import {mkdirSync,writeFileSync,renameSync,readFileSync,lstatSync,existsSync} from 'node:fs'
import {dirname} from 'node:path'
import {BackendAdapterError} from '../backend-sdk.ts'
export const digest=(value:string)=>createHash('sha256').update(value).digest('hex')
export function privateFile(path:string,value:string){
 mkdirSync(dirname(path),{recursive:true,mode:0o700})
 if(existsSync(path)&&lstatSync(path).isSymbolicLink())throw new BackendAdapterError('configuration_invalid')
 const next=path+'.'+randomUUID()+'.tmp';writeFileSync(next,value,{mode:0o600,flag:'wx'});renameSync(next,path)
}
export function readJson(path:string){
 if(!existsSync(path))return undefined
 if(lstatSync(path).isSymbolicLink()||lstatSync(path).size>16_000_000)throw new BackendAdapterError('configuration_invalid')
 try{return JSON.parse(readFileSync(path,'utf8'))}catch{throw new BackendAdapterError('invalid_output')}
}
export function endpoint(value:string|undefined){
 if(!value)return
 const u=new URL(value)
 if(u.username||u.password||u.search||u.hash||u.protocol!=='https:'&&!(u.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(u.hostname)))throw new BackendAdapterError('configuration_invalid')
 return value.replace(/\/$/,'')
}
