import type {Runtime} from './runtime.ts'

/** Keep ordinary MCP polling small enough to be read in real clients, rather than spilling to a temporary file. */
export function clientStatus(status:ReturnType<Runtime['status']>,filter:{discussion?:string;requestId?:string}={}){
 const wanted=status.events.filter((e:any)=>(!filter.discussion||e.threads.some((t:any)=>t.id===filter.discussion))&&(!filter.requestId||e.id.endsWith(':'+filter.requestId))).map((e:any)=>e.id)
 const matching=status.tickets.filter(t=>!filter.discussion&&!filter.requestId||wanted.includes(t.origin.triggerId)||t.inputs.some(i=>i.kind==='trigger'&&wanted.includes(i.triggerId))),selected=matching.slice(0,filter.discussion||filter.requestId?10:5),replyLimit=filter.discussion||filter.requestId?4000:1000
 const tickets=selected.map(t=>{
  const origin=status.events.find((e:any)=>e.id===t.origin.triggerId) as any,run=t.run
  return {id:t.id,title:t.title.slice(0,160),origin:{triggerId:t.origin.triggerId},discussion:origin?.threads[0]?.id,stage:t.stage,ended:t.ended,attention:t.attention?{question:t.attention.question.slice(0,1000)}:undefined,resultResource:'ticket/'+t.id+'/result',...(run?{run:{phase:run.phase,result:run.result?.slice(0,replyLimit),replyTruncated:!!run.result&&run.result.length>replyLimit,error:run.error,threadId:run.threadId,turnId:run.turnId,backendId:run.backendId,backendKind:run.backendKind,...((!run.backendKind||run.backendKind==='codex')?{nativeThreadId:run.threadId,nativeTurnId:run.turnId}:{})}}:{})}
 })
 const routerResults=(status.routerResults??[]).filter(r=>!filter.discussion||r.discussion===filter.discussion||r.discussion.endsWith(':'+filter.discussion)).slice(-10).map(r=>({discussion:r.discussion,reply:r.reply.slice(0,replyLimit),threadId:r.threadId,turnId:r.turnId}))
 const routerErrors=(status.routerErrors??[]).filter(r=>!filter.discussion||r.discussion===filter.discussion||r.discussion.endsWith(':'+filter.discussion)).slice(-10)
 return {routerResults,routerErrors,paused:status.paused,active:status.active,tickets,totalMatching:matching.length,more:matching.length>tickets.length,catalog:'catalog',detail:'Use agent_read with a task resource for history, files or the complete result.'}
}
