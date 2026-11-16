import {createHash,randomUUID} from 'node:crypto'
import {mkdirSync,openSync,closeSync,writeSync,fsyncSync,renameSync,readFileSync,lstatSync,rmSync,constants} from 'node:fs'
import {join} from 'node:path'
import {BackendAdapterError} from '../backend-sdk.ts'
export interface AcpSession {
 version:1;sessionId:string;cwd:string;endpoint:string;createdAt:number;updatedAt:number
 state:'ready'|'prompt_pending'|'uncertain'|'closed';lastTurnId?:string;closeConfirmed?:boolean
}
export class AcpState {
 private readonly root:string
 constructor(directory:string){this.root=join(directory,'acp-v1');mkdirSync(this.root,{recursive:true,mode:0o700})}
 private path(sessionId:string){return join(this.root,createHash('sha256').update(sessionId).digest('hex')+'.json')}
 private syncDirectory(){const fd=openSync(this.root,constants.O_RDONLY);try{fsyncSync(fd)}finally{closeSync(fd)}}
 read(sessionId:string):AcpSession {
  try{
   const path=this.path(sessionId),s=lstatSync(path)
   if(!s.isFile()||s.isSymbolicLink()||s.size>16000)throw Error()
   const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW)
   let value:any;try{value=JSON.parse(readFileSync(fd,'utf8'))}finally{closeSync(fd)}
   if(value.version!==1||value.sessionId!==sessionId||typeof value.cwd!=='string'||typeof value.endpoint!=='string'||!['ready','prompt_pending','uncertain','closed'].includes(value.state))throw Error()
   return value
  }catch{throw new BackendAdapterError('configuration_invalid')}
 }
 create(value:AcpSession){
  let fd:number
  try{fd=openSync(this.path(value.sessionId),constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600)}catch{throw new BackendAdapterError('outcome_unknown')}
  try{writeSync(fd,JSON.stringify(value));fsyncSync(fd)}finally{closeSync(fd)}
  this.syncDirectory()
 }
 write(value:AcpSession){
  const path=this.path(value.sessionId),temporary=path+'.'+randomUUID()+'.tmp'
  const fd=openSync(temporary,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600)
  try{writeSync(fd,JSON.stringify(value));fsyncSync(fd)}finally{closeSync(fd)}
  renameSync(temporary,path);this.syncDirectory()
 }
 lock(sessionId:string):()=>void {
  const path=this.path(sessionId)+'.lock'
  try{mkdirSync(path,{mode:0o700})}catch{throw new BackendAdapterError('outcome_unknown')}
  return ()=>rmSync(path,{recursive:true,force:true})
 }
}
