// Exercise the real encoder across the process boundary without a model provider.
import {randomUUID} from 'node:crypto'
import {workerInputTransport} from '../../plugins/backend-codex/worker-input.ts'
import type {BackendPlugin} from '../../plugins/backend-sdk.ts'

export default {create(){return {
 async probe(){return {available:true,authenticated:true,remoteVerified:false,accountIdentity:'a'.repeat(64)}},
 async run(request){
  const threadId=request.threadId??randomUUID(),turnId=randomUUID()
  request.onThread?.(threadId);request.onTurn?.(turnId)
  return {threadId,turnId,text:JSON.stringify({activity:request.activity??null,transport:workerInputTransport(request)})}
 },
}}} satisfies BackendPlugin
