import type {CodeReceipt} from './project-code.ts'
import type {GoalDelivery,VerificationRound} from './goal-verification.ts'
import type {Run} from './store.ts'
import type {Runtime} from './runtime.ts'
import {stableDigest} from './sources.ts'

const commit=(value:unknown):value is string=>typeof value==='string'&&/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value)
const fileId=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value)
const time=(value:unknown):number|null=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0&&value<=8640000000000000?value:null

type EvidenceState='queued'|'waiting'|'stopped'|'ended'|'interrupted'|'uncertain'|'unverified'|'recorded'|'passed'|'failed'|'insufficient'|'errored'|'stale'|'pending'|'running'
interface Evidence {state:EvidenceState;head:string|null;observedAt:number|null;matchesCurrent:boolean|null}
interface ProgressArtifact {id:string;version:number;observedAt:number|null}
interface Publication {phase?:string;sha?:string;ticketId?:string;id?:string;confirmedAt?:number}
export interface ProgressSnapshot {
 schema:1;revision:string;cursor:number;observedAt:number
 sections:{
  activity:Evidence;result:Evidence;commit:Evidence;push:Evidence;check:Evidence;deployment:Evidence;acceptance:Evidence;
  artifacts:ProgressArtifact[]
 }
}
export type ProgressResponse={schema:1;unchanged:true;revision:string;cursor:number}|{schema:1;unchanged:false;snapshot:ProgressSnapshot}

export function progressSnapshot(host:Runtime,ticketId:string,cursor:number,previous?:string):ProgressResponse {
 const store=host.store
 const retained=<T extends object>(kind:string,id:string,value:T|undefined):value is T=>!!value&&!host.memory.cleanup.blocked(kind,id,value)
 const unverified=():Evidence=>({state:'unverified',head:null,observedAt:null,matchesCurrent:null})
 const delivery=store.get<GoalDelivery>('goal-delivery',ticketId)
 const safeDelivery=retained('goal-delivery',ticketId,delivery)&&delivery.ticketId===ticketId?delivery:undefined
 const task=store.tickets.get(ticketId)
 const assignment=task?.assignments.at(-1)?.id
 const inputRevision=host.scopes.ownership(ticketId)?.dataRevision??1
 const deliveryCurrent=!!safeDelivery&&safeDelivery.assignmentId===assignment&&safeDelivery.inputRevision===inputRevision
 const run=store.get<Run>('run',ticketId)
 const currentRun=retained('run',ticketId,run)&&run.assignmentId===assignment?run:undefined
 const hasSavedResult=typeof currentRun?.result==='string'&&currentRun.result.length>0
 const allCode=store.db.prepare("SELECT id,body FROM records WHERE kind='project-commit' AND json_extract(body,'$.ticketId')=? ORDER BY rowid DESC LIMIT 100").all(ticketId)
 const code=allCode.flatMap(row=>{
  const receipt=JSON.parse(String(row.body)) as CodeReceipt
  return receipt.id===row.id&&receipt.ticketId===ticketId&&retained('project-commit',receipt.id,receipt)?[receipt]:[]
 })
 const candidates=store.db.prepare("SELECT id,body FROM records WHERE kind='pr-delivery' AND (json_extract(body,'$.ticketId')=? OR json_extract(body,'$.id')=?) ORDER BY rowid DESC LIMIT 100").all(ticketId,ticketId)
 const publications=candidates.flatMap(row=>{
  const receipt=JSON.parse(String(row.body)) as Publication
  return retained('pr-delivery',String(row.id),receipt)?[receipt]:[]
 })
 // A project receipt is the version authority for its task. Independent host
 // push evidence may establish a version only if there is no project receipt.
 // A newer unknown code/push receipt must not revive an older green check.
 const activeCode=safeDelivery?deliveryCurrent?code.find(c=>c.id===safeDelivery.id):undefined:undefined
 const head=commit(activeCode?.head)?activeCode.head:!safeDelivery&&!code.length&&commit(publications[0]?.sha)?publications[0].sha:null
 const evidence=(state:EvidenceState,bound:string|null,observedAt:number|null):Evidence=>({state,head:bound,observedAt,matchesCurrent:bound&&head?bound===head:null})
 const commitRecord=commit(activeCode?.head)?activeCode:code.find(c=>commit(c.head))
 const push=publications.find(p=>commit(p.sha)&&(p.phase==='pushed'||p.phase==='draft'))
 const hasCheck=(c:CodeReceipt)=>commit(c.head)&&Number.isInteger(c.test?.exit)&&(!c.error||c.test!.exit!==0)
 const selectedCheck=activeCode&&hasCheck(activeCode)?activeCode:code.find(hasCheck)
 const checkState=selectedCheck?.test?.exit===0?'passed':'failed'
 let acceptance=unverified()
 const artifacts:ProgressArtifact[]=[]
 if(safeDelivery){
  try{
   const goal=host.goals.get(safeDelivery.goalId)
   if(goal&&goal.taskIds.includes(ticketId)&&!host.scopes.binding(goal.entryId).privateActor){
    const context=host.goals.context(goal)
    const owner=host.scopes.ownership(ticketId)
    if(owner)host.scopes.checkTaskEntry(owner,goal.entryId,'result')
    const readable=host.goals.list(context).find(g=>g.id===goal.id)
    if(readable?.objective===goal.objective){
     const node=goal.nodes?.find(n=>n.ticketId===ticketId)
     const isContributor=!!goal.project&&node?.id!==goal.project.integration
     const roundId=isContributor?node?.roundId:goal.finalRoundId??node?.roundId
     const round=roundId?store.get<VerificationRound>('goal-verification',roundId):undefined
     if(roundId&&retained('goal-verification',roundId,round)&&round.goalId===goal.id&&round.scopeId===goal.scopeId&&round.entryId===goal.entryId&&round.ticketIds.includes(ticketId)&&(!round.nodeId||round.nodeId===node?.id)){
      const version=round.nodeId?round.snapshot.evidence.find(e=>e.ticketId===ticketId&&commit(e.commit))?.commit:round.snapshot.finalCommit
      const match=deliveryCurrent&&round.snapshot.tasks.some(t=>t.ticketId===ticketId)&&round.snapshot.tasks.every(t=>{
       const proposal=store.get<GoalDelivery>('goal-delivery',t.ticketId)
       const ticket=store.tickets.get(t.ticketId)
       return !!ticket&&!host.memory.cleanup.blocked('ticket',t.ticketId,ticket)&&retained('goal-delivery',t.ticketId,proposal)&&ticket.assignments.at(-1)?.id===t.assignmentId&&proposal.assignmentId===t.assignmentId&&proposal.inputRevision===t.inputRevision&&(host.scopes.ownership(t.ticketId)?.dataRevision??1)===t.inputRevision&&stableDigest(proposal)===t.reportHash
      })
      // For projects, the verifier's persisted decision and independent
      // operator review must match the integration commit before passing is shown.
      const reviewed=!goal.project||round.nodeId||goal.project.review?.state==='approved'&&goal.project.review.roundId===round.id&&goal.project.review.head===version
      const fresh=match&&(round.state!=='passed'||host.verification.current(round,goal,{readOnly:true}))
      acceptance=evidence(!fresh?'stale':round.state==='passed'&&!reviewed?'pending':round.state,commit(version)?version:null,time(round.finishedAt)??time(round.at))
      for(const item of round.snapshot.evidence){
       if(artifacts.length===12)break
       const a=item.artifact
       if(!a||a.ticketId!==ticketId||a.goalId!==goal.id||!fileId(a.id)||artifacts.some(v=>v.id===a.id))continue
       const stored=store.get<typeof a>('goal-artifact',a.id)
       if(!retained('goal-artifact',a.id,stored)||stored.ticketId!==ticketId||stored.version!==a.version||stored.sha256!==a.sha256)continue
       try{
        const current=host.artifacts.describe(a.id)
        if(current.availability==='retained'&&current.version===a.version&&current.sha256===a.sha256)artifacts.push({id:a.id,version:a.version,observedAt:time(round.finishedAt)??time(round.at)})
       }catch{/* Never invent a link for unavailable/private evidence. */}
      }
     }
    }
   }
  }catch{/* Current goal authority/visibility could not be established. */}
 }
 if(acceptance.matchesCurrent===false&&acceptance.state==='passed')acceptance={...acceptance,state:'stale'}
 const activity:EvidenceState=task?.ended?task.ended.outcome==='stopped'?'stopped':'ended':
  task?.attention||currentRun?.phase==='human'?'waiting':
  currentRun?.phase==='uncertain'?'uncertain':currentRun?.phase==='interrupted'?'interrupted':
  currentRun&&['starting','running','background','merging','delivering'].includes(currentRun.phase)?'running':hasSavedResult?'recorded':'queued'
 const sections:ProgressSnapshot['sections']={
  activity:evidence(activity,null,null),
  result:deliveryCurrent?evidence('recorded',null,time(safeDelivery.at)):hasSavedResult?evidence('recorded',null,null):safeDelivery?evidence('stale',null,time(safeDelivery.at)):unverified(),
  commit:commitRecord?evidence('recorded',commitRecord.head!,null):unverified(),
  push:push?evidence('recorded',push.sha!,time(push.confirmedAt)):unverified(),
  check:selectedCheck?evidence(checkState,selectedCheck.head!,null):unverified(),
  deployment:unverified(),
  acceptance,artifacts,
 }
 // Polls or unrelated activity may advance the transport cursor but are not
 // new progress. Visible evidence (including its own timestamps) determines
 // the revision. No receipt is synthesized and nothing is sent automatically.
 const revision=stableDigest(['task-progress-v1',ticketId,sections])
 return revision===previous?{schema:1,unchanged:true,revision,cursor}:{schema:1,unchanged:false,snapshot:{schema:1,revision,cursor,observedAt:Date.now(),sections}}
}
