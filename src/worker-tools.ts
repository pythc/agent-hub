import {deliverDraft} from './delivery.ts'
import {randomBytes,createHash} from 'node:crypto'
import {mkdirSync,writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {z} from 'zod'
import {readSchema} from './resources.ts'
import type {Runtime} from './runtime.ts'
import type {WorkOwner} from './work.ts'
import type {ToolSpec,ToolContent} from './model.ts'
const json=(properties:Record<string,unknown>,required:string[])=>({type:'object',additionalProperties:false,properties,required})
const text={type:'string'},integer={type:'integer',minimum:0}
export const workerDefinitions=[
 {name:'superagent_read',description:'Read a paginated task-scoped resource. Start with catalog. Retain returned cursor and nextOffset for text pages. Images return actual image content.',validator:readSchema,schema:json({resource:text,offset:integer,limit:{type:'integer',minimum:1,maximum:8000},pageSize:{type:'integer',minimum:1,maximum:50},cursor:text},['resource'])},
 {name:'superagent_shell',description:'Run a command in the task sandbox. The host owns the process, output and lifecycle. It becomes a background job after 5 seconds (60 in a subagent). Reuse requestId only to retry the same command.',validator:z.object({command:z.string().min(1).max(100000),requestId:z.string().min(1).max(200),yieldMs:z.number().int().min(0).max(60000).default(5000)}).strict(),schema:json({command:text,requestId:text,yieldMs:integer},['command','requestId'])},
 {name:'superagent_job',description:'Read, wait for or cancel an owned job. Wait returns within five seconds for a root worker. Completion wakes the same worker automatically while it owns a slot.',validator:z.object({id:z.string(),action:z.enum(['read','wait','stop']),yieldMs:z.number().int().min(0).max(60000).default(5000),offset:z.number().int().min(0).default(0)}).strict(),schema:json({id:text,action:{type:'string',enum:['read','wait','stop']},yieldMs:integer,offset:integer},['id','action'])},
 {name:'superagent_spawn',description:'Start a managed subagent with this task sandbox and mandate. It cannot publish, change configuration or access other tasks. Nested subagents retain these limits. Return the job ID immediately.',validator:z.object({prompt:z.string().min(1).max(50000),requestId:z.string().min(1).max(200)}).strict(),schema:json({prompt:text,requestId:text},['prompt','requestId'])},
 {name:'superagent_ack',description:'Acknowledge a reached human request once in its original thread before substantial work. Use its trigger ID or trigger/<id> resource reference. Never acknowledge bots or CI.',validator:z.object({triggerId:z.string(),text:z.string().min(1).max(500)}).strict(),schema:json({triggerId:text,text},['triggerId','text'])},
 {name:'superagent_progress',description:'Record an internal progress update without ending this turn or contacting people.',validator:z.object({summary:z.string().min(1).max(8000)}).strict(),schema:json({summary:text},['summary'])},
 {name:'superagent_publish',description:'Publish or update the task isolated Git branch as a draft PR, only when workerPublish is explicitly enabled by host policy. Never merge. Returns the bound PR and head SHA.',validator:z.object({title:z.string().min(1).max(200),body:z.string().max(50000)}).strict(),schema:json({title:text,body:text},['title','body'])},
 {name:'superagent_review',description:'Handle an inline review delivered to the task own PR. Fixed requires a successful managed verification job and a clean published head. Decline sends one concise inline explanation, then resolves the thread.',validator:z.object({triggerId:z.string(),action:z.enum(['fixed','decline']),reason:z.string().min(1).max(1000),evidenceJobId:z.string().optional()}).strict(),schema:json({triggerId:text,action:{type:'string',enum:['fixed','decline']},reason:text,evidenceJobId:text},['triggerId','action','reason'])},
 {name:'superagent_follow',description:'Follow a related configured thread for context, or mark a followed thread unrelated. This never grants new authority.',validator:z.object({source:z.string(),thread:z.string(),action:z.enum(['context','unrelated']),reason:z.string().default('Unrelated')}).strict(),schema:json({source:text,thread:text,action:{type:'string',enum:['context','unrelated']},reason:text},['source','thread','action'])}
] as const
export const workerSpecs:ToolSpec[]=workerDefinitions.map(d=>({type:'function',name:d.name,description:d.description,inputSchema:d.schema}))
export class WorkerTools {
 constructor(private host:Runtime){}
 async call(owner:WorkOwner,name:string,value:unknown):Promise<{contentItems:ToolContent[];success:boolean}>{
  const run=this.host.store.get<any>('run',owner.ticketId),ticket=this.host.store.tickets.get(owner.ticketId)
  return this.host.activity.tool(name,{ticketId:owner.ticketId,workerId:run?.workerId,agentId:owner.agentId,sourceId:ticket?.mandate.actor.source,triggerId:ticket?.origin.triggerId},()=>this.invoke(owner,name,value))
 }
 private async invoke(owner:WorkOwner,name:string,value:unknown):Promise<{contentItems:ToolContent[];success:boolean}>{
  if(!this.host.validWork(owner))throw Error('Assignment capability has ended')
  const definition=workerDefinitions.find(d=>d.name===name);if(!definition)throw Error('Unknown worker tool')
  const args=definition.validator.parse(value) as any
  await this.host.refreshWork(owner)
  let result:any
  if(name==='superagent_read')result=await this.host.resources.read(args,owner)
  else if(name==='superagent_shell')result=await this.host.work.shell(owner,args.command,args.requestId,args.yieldMs)
  else if(name==='superagent_spawn')result=await this.host.work.agent(owner,args.prompt,args.requestId)
  else if(name==='superagent_ack'){if(owner.agentId)throw Error('Subagents cannot contact people');const triggerId=args.triggerId.startsWith('trigger/')?args.triggerId.slice('trigger/'.length):args.triggerId;result=this.host.engine.reply({purpose:'acknowledgement',ticketId:owner.ticketId,triggerId,text:args.text})}
  else if(name==='superagent_progress'){if(owner.agentId){this.host.store.put('agent-progress',owner.agentId,{ticketId:owner.ticketId,agentId:owner.agentId,summary:args.summary,at:Date.now()})}else this.host.engine.report(owner.ticketId,{state:'progress',summary:args.summary});result={ok:true}}
  else if(name==='superagent_publish'){if(owner.agentId||owner.sandbox!=='workspace-write'||!this.host.config.delivery.workerPublish)throw Error('Worker publication is not enabled for this root worker');const ticket=this.host.store.tickets.get(owner.ticketId)!;result=await deliverDraft(this.host,owner.ticketId,ticket.mandate.actor.source,args.title,args.body,owner.assignmentId)}
  else if(name==='superagent_review')result=await this.host.reviews.act(owner,args.triggerId,args.action,args.reason,args.evidenceJobId)
  else if(name==='superagent_job')result=args.action==='read'?this.host.work.read(owner,args.id,args.offset):args.action==='wait'?await this.host.work.wait(owner,args.id,args.yieldMs):await this.host.work.stop(owner,args.id)
  else{
   const source=this.host.sources.get(args.source);if(!source)throw Error('Unknown source')
   if(source.validThread&&!source.validThread(args.thread))throw Error('Thread is outside configured source')
   if(args.action==='context')this.host.engine.followForContext(owner.ticketId,{source:args.source,id:args.thread})
   else this.host.engine.markUnrelated(owner.ticketId,args.source+':'+args.thread,args.reason)
   result={ok:true}
  }
  await this.host.refreshWork(owner)
  if(result?.kind==='image')return {success:true,contentItems:[{type:'inputImage',imageUrl:'data:'+result.mimeType+';base64,'+result.data}]}
  return {success:true,contentItems:[{type:'inputText',text:JSON.stringify(result)}]}
 }
 grant(owner:WorkOwner){
  const token=randomBytes(32).toString('hex'),key=createHash('sha256').update(token).digest('hex')
  const directory=join(this.host.config.stateDir,'grants');mkdirSync(directory,{recursive:true,mode:0o700})
  const path=join(directory,key)
  this.host.store.put('worker-grant',key,owner)
  writeFileSync(path,token,{flag:'wx',mode:0o600})
  return path
 }
 authenticate(authorization:string|undefined){
  if(!authorization?.startsWith('Bearer '))throw Error('Worker capability required')
  const key=createHash('sha256').update(authorization.slice(7)).digest('hex'),owner=this.host.store.get<WorkOwner>('worker-grant',key)
  if(!owner||!this.host.validWork(owner))throw Error('Worker capability has expired')
  return owner
 }
}
