import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {randomUUID} from 'node:crypto'
import {isRepositorySource} from './repository-source.ts'
import type {Runtime} from './runtime.ts'
import type {WorkOwner} from './work.ts'
export class Reviews {
 constructor(private host:Runtime){}
 async act(owner:WorkOwner,triggerId:string,action:'fixed'|'decline',reason:string,evidenceJobId?:string){
  if(owner.agentId||owner.sandbox!=='workspace-write')throw Error('Review decisions require the writable root worker')
  const ticket=this.host.store.tickets.get(owner.ticketId)!,trigger=this.host.store.triggers.get(triggerId),source=trigger&&this.host.sources.get(trigger.source)
  if(!trigger||!isRepositorySource(source)||!ticket.inputs.some(i=>i.kind==='trigger'&&i.triggerId===triggerId)&&!ticket.origin.triggerIds.includes(triggerId))throw Error('Review was not delivered to this task')
  const number=Number(trigger.meta.number),comment=trigger.channel?.address.reviewComment
  if(!comment||!ticket.follows?.some(f=>f.own&&f.thread===trigger.source+':'+source.code.threadPrefix+number))throw Error('Only inline reviews of the task own PR can be resolved')
  const graph=await source.reviewGraph(number),thread=graph.reviewThreads.nodes.find((t:any)=>String(t.comments.nodes[0]?.databaseId)===comment)
  if(!thread)throw Error('Inline review thread is unavailable')
  const key=owner.ticketId+':'+thread.id,previous=this.host.store.get<any>('review-action',key)
  if(previous)return previous
  let expectedHead:string|undefined
  if(action==='fixed'){
   const evidence=evidenceJobId&&this.host.store.get<any>('work',evidenceJobId)
   if(!evidence||evidence.kind!=='shell'||evidence.ticketId!==owner.ticketId||evidence.assignmentId!==owner.assignmentId||evidence.state!=='completed'||evidence.exitCode!==0)throw Error('A successful managed verification job is required')
   const pull=await source.repositoryPull(number)
   const git=async(...args:string[])=>(await promisify(execFile)('git',args,{cwd:owner.cwd,encoding:'utf8',timeout:5000})).stdout.trim()
   expectedHead=pull.head
   if(await git('status','--porcelain')||await git('rev-parse','HEAD')!==pull.head)throw Error('Push and verify the clean current PR head before resolving a fix')
  }else if(reason.trim().split(/\s+/).length>100||reason.length>1000)throw Error('Declined review reply must be concise')
  const messageId=action==='decline'?'review:'+randomUUID():undefined
  const record={id:key,ticketId:owner.ticketId,source:trigger.source,number,thread:thread.id,action,reason,evidenceJobId,expectedHead,messageId,phase:'pending',at:Date.now()}
  if(!this.host.validWork(owner))throw Error('Review assignment ended during verification')
  this.host.store.atomic(()=>{
   this.host.store.put('review-action',key,record)
   if(messageId)this.host.store.outbox.send({id:messageId,ticketId:owner.ticketId,kind:'reply',channel:trigger.channel!,text:reason})
  })
  return record
 }
 async tick(){
  for(const record of this.host.store.list<any>('review-action').filter(r=>r.phase==='pending')){
   if(record.messageId&&this.host.store.outbox.status(record.messageId)!=='sent')continue
   const ticket=this.host.store.tickets.get(record.ticketId)
   if(!ticket||ticket.ended?.by==='human')continue
   const source=this.host.sources.get(record.source)
   if(!isRepositorySource(source))continue
   try{if(record.expectedHead){const pull:any=await source.repositoryPull(record.number);if(pull.head!==record.expectedHead){this.host.store.put('review-action',record.id,{...record,phase:'stale',error:'PR head changed before resolution'});continue}}await source.resolveReview(record.number,record.thread,()=>this.host.canWrite()&&this.host.store.tickets.get(record.ticketId)?.ended?.by!=='human');this.host.store.put('review-action',record.id,{...record,phase:'resolved',endedAt:Date.now()})}
   catch(error){this.host.store.put('review-action',record.id,{...record,error:String(error).slice(0,300)})}
  }
 }
}
