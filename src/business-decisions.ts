import {z} from 'zod'
import {bodyDigest} from './sources.ts'
import {ChatError} from './chat-errors.ts'
import type {Runtime} from './runtime.ts'
import type {ActorRef,Ticket,Trigger} from './vendor/dsh-core/index.ts'

export const decisionTermsSchema=z.object({
 target:z.object({label:z.string().trim().min(1).max(2000),version:z.string().trim().min(1).max(500)}).strict(),
 amount:z.object({value:z.string().regex(/^(0|[1-9]\d{0,14})(\.\d{1,6})?$/),currency:z.string().regex(/^[A-Z]{3}$/)}).strict().nullable(),
 recipient:z.object({id:z.string().trim().min(1).max(500),label:z.string().trim().min(1).max(500)}).strict().nullable(),
 validForSeconds:z.number().int().min(60).max(7*86400),
}).strict()
export type DecisionTerms=z.infer<typeof decisionTermsSchema>
export interface BusinessDecisionView {
 id:string;ticketId:string;question:string;summary:string;version:string;createdAt:number;expiresAt:number;
 status:'pending'|'answered'|'expired'|'stale'|'withdrawn'|'unavailable';reason:string|null;
 target:{label:string;version:string;amount:DecisionTerms['amount'];recipient:DecisionTerms['recipient']};
 answer:{text:string;at:number}|null
}
interface DecisionRecord extends BusinessDecisionView {schema:1;actor:ActorRef;basis:string;terms:DecisionTerms|null;admissionSeq:number}
const fail=(code:string)=>new ChatError(code,code,code==='decision_identity'?403:409)
function readDecision(host:Runtime,id:string):DecisionRecord|undefined {
 const d=host.store.get<DecisionRecord>('business-decision',id),time=(v:unknown)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0&&v<=8.64e15
 if(!d||d.schema!==1||d.id!==id||typeof d.ticketId!=='string'||!d.ticketId||typeof d.question!=='string'||!d.question||typeof d.summary!=='string'||!/^[a-f0-9]{64}$/.test(d.version)||d.basis!==d.version||!time(d.createdAt)||!time(d.expiresAt)||d.expiresAt<d.createdAt||!Number.isSafeInteger(d.admissionSeq)||d.admissionSeq<0||!d.actor?.source||!d.actor.id||!['pending','answered'].includes(d.status)||d.terms!==null&&!decisionTermsSchema.safeParse(d.terms).success||!d.target||typeof d.target.label!=='string'||typeof d.target.version!=='string')return
 if(d.status==='answered'&&(!d.answer||typeof d.answer.text!=='string'||!time(d.answer.at)))return
 return d
}

export function decisionAsker(host:Runtime,ticket:Ticket):Trigger|undefined {
 let t=host.store.triggers.get(ticket.attention?.triggerId??ticket.origin.triggerId)
 if(t?.meta.delegatedBy==='router'&&typeof t.meta.parentTrigger==='string')t=host.store.triggers.get(t.meta.parentTrigger)
 return t?.human?t:undefined
}
function basis(host:Runtime,ticket:Ticket,terms:DecisionTerms|null):string {
 const assignment=ticket.assignments.at(-1),owner=host.scopes.ownership(ticket.id)
 const goals=host.store.list<any>('router-goal').filter(g=>g.taskIds?.includes(ticket.id)).map(g=>({id:g.id,revision:g.revision,contract:g.contract,objective:g.objective,criteria:g.criteria,project:g.project?.policy}))
 // Only a digest is retained. Any relevant task/recipient/amount/goal/permission
 // change invalidates the business choice; this never grants execution authority.
 return bodyDigest({assignment:assignment?.id,report:assignment?.report?{state:assignment.report.state,summary:assignment.report.summary}:null,mandate:ticket.mandate,attention:ticket.attention,channels:ticket.channels,owner,goals,terms,continuation:host.store.get('task-continuation',ticket.id)??null})
}
export function captureBusinessDecision(host:Runtime,ticket:Ticket,terms?:DecisionTerms|null):void {
 if(!ticket.attention)return
 const id=ticket.attention.id
 if(terms!==undefined)host.store.put('business-decision-terms',ticket.id,{questionId:id,terms})
 const savedTerms=host.store.get<{questionId:string;terms:DecisionTerms|null}>('business-decision-terms',ticket.id)
 const currentTerms=savedTerms?.questionId===id?savedTerms.terms:null
 if(host.store.get('business-decision',id))return
 const asker=decisionAsker(host,ticket);if(!asker)return
 const createdAt=Date.now(),version=basis(host,ticket,currentTerms),summary=ticket.assignments.at(-1)?.report?.summary??''
 const record:DecisionRecord={schema:1,id,ticketId:ticket.id,question:ticket.attention.question,summary,version,basis:version,actor:asker.actor,terms:currentTerms,createdAt,expiresAt:createdAt+(currentTerms?.validForSeconds??86400)*1000,status:'pending',reason:null,target:{label:currentTerms?.target.label??ticket.title,version:currentTerms?.target.version??version,amount:currentTerms?.amount??null,recipient:currentTerms?.recipient??null},answer:null,admissionSeq:Number(host.store.db.prepare('SELECT COALESCE(MAX(seq),0) AS seq FROM audit').get()!.seq)}
 host.store.put('business-decision',id,record)
}
export function businessDecision(host:Runtime,id:string,now=Date.now()):BusinessDecisionView|undefined {
 const d=readDecision(host,id);if(!d)return
 const {schema,actor,basis:expected,terms,admissionSeq,...view}=d,t=host.store.tickets.get(d.ticketId)
 if(d.status==='answered')return view
 if(!t||t.ended||!t.attention||t.attention.id!==id)return {...view,status:'withdrawn',reason:'question_replaced_or_task_closed'}
 const latest=host.store.get<{questionId:string;terms:DecisionTerms|null}>('business-decision-terms',t.id)
 if(basis(host,t,latest?.questionId===id?latest.terms:null)!==expected)return {...view,status:'stale',reason:'target_changed'}
 if(!Number.isFinite(now)||now<d.createdAt)return {...view,status:'unavailable',reason:'clock_unavailable'}
 if(now>=d.expiresAt)return {...view,status:'expired',reason:d.reason??'deadline_passed'}
 return view
}
export function assertBusinessDecision(host:Runtime,id:string,version:string|undefined,actor:ActorRef):BusinessDecisionView {
 const record=readDecision(host,id),view=businessDecision(host,id)
 if(!record||!view)throw fail('decision_unavailable')
 if(record.actor.source!==actor.source||record.actor.id!==actor.id)throw fail('decision_identity')
 if(version!==undefined&&version!==record.version)throw fail('decision_stale')
 if(view.status!=='pending')throw fail('decision_'+(view.status==='withdrawn'?'stale':view.status))
 return view
}
export function answerBusinessDecision(host:Runtime,id:string,version:string|undefined,trigger:Trigger,text:string):void {
 assertBusinessDecision(host,id,version,trigger.actor);const record=host.store.get<DecisionRecord>('business-decision',id)!
 const seq=host.store.db.prepare("SELECT MIN(seq) AS seq FROM audit WHERE json_extract(body,'$.type')='router.admission' AND json_extract(body,'$.triggerId')=?").get(trigger.id)?.seq
 if(!trigger.human||trigger.meta.delegatedBy||seq==null||Number(seq)<=record.admissionSeq||!Number.isFinite(Date.parse(trigger.at))||Date.parse(trigger.at)<=record.createdAt)throw fail('decision_stale')
 host.store.put('business-decision',id,{...record,status:'answered',answer:{text,at:Date.now()}})
}
export function decisionActorMatches(host:Runtime,id:string,actor:ActorRef):boolean {
 const d=readDecision(host,id);return !!d&&d.actor.source===actor.source&&d.actor.id===actor.id
}
export function decisionTerms(host:Runtime,ticketId:string):DecisionTerms|null {return host.store.get<{terms:DecisionTerms|null}>('business-decision-terms',ticketId)?.terms??null}

/** Old pending questions lack a reviewed snapshot: expose them as expired, never approve them retroactively. */
export function migrateBusinessDecisions(host:Runtime):void {
 host.store.atomic(()=>{for(const t of host.store.tickets.open())if(t.attention&&!host.store.get('business-decision',t.attention.id)){
  captureBusinessDecision(host,t)
  const d=host.store.get<DecisionRecord>('business-decision',t.attention.id)
  if(d)host.store.put('business-decision',d.id,{...d,expiresAt:d.createdAt,reason:'legacy_question_requires_renewal'})
 }})
}
