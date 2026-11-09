import {createHash} from 'node:crypto'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {CodexModel,probeCodexAccount} from './model.ts'
import {BackendAdapterError,type BackendPlugin} from '../backend-sdk.ts'
import type {Config} from '../../src/config.ts'
const exec=promisify(execFile)

export default {create(config){
 const command=String(config.command??'codex'),args=(config.args??[]) as string[]
 const model=new CodexModel({codex:command,model:config.model as string|undefined,effort:(config.effort??'high') as Config['effort'],turnTimeoutMs:Number(config.timeoutMs??300000)},args)
 return Object.assign(model,{async probe(){
  let version:string
  try{version=(await exec(command,[...args,'--version'],{timeout:10000,maxBuffer:64000})).stdout.trim()}catch{throw new BackendAdapterError('configuration_invalid')}
  const {account,workspaceRouting}=await probeCodexAccount(command,args)
  const identity=account?.id??account?.email,workspace=workspaceRouting?.chatgptAccountId
  if(!identity||account.type==='chatgpt'&&!workspace)throw new BackendAdapterError('auth_required')
  return {available:true,authenticated:true as const,remoteVerified:false as const,version,accountIdentity:createHash('sha256').update(JSON.stringify([account.type,identity,workspace,workspaceRouting?.backendOrigin])).digest('hex')}
 }})
}} satisfies BackendPlugin
