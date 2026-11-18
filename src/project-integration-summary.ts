import type {Runtime} from './runtime.ts'
import type {GoalNode} from './goal-contract.ts'
import type {RouterGoal} from './router-goals.ts'
import type {CodeReceipt} from './project-code.ts'
import {validateProjectOwnership} from './project-ownership.ts'
export interface ProjectIntegrationSummary {
 schema:1;role:'integration'|'contributor';ownership:'checked'|'blocked'|'legacy_unknown'|'unverified';
 ownerWorkerId:string|null;sharedFileCount:number;defaultLockfiles:boolean;head:string|null;
 checks:{kind:'build'|'start'|'business';state:'passed'|'failed'|'unverified';head:string|null}[];
 legacyTest:'passed'|'failed'|'unverified';complete:boolean
}
const sha=(v:unknown):v is string=>typeof v==='string'&&/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(v)
/** Projection only: never imports commits, starts checks or synthesizes old evidence. */
export function projectIntegrationSummary(g:RouterGoal,ticketId:string,code?:CodeReceipt,validate?:(g:RouterGoal,n:GoalNode,r:CodeReceipt)=>void):ProjectIntegrationSummary|undefined {
 const p=g.project,node=g.nodes?.find(n=>n.ticketId===ticketId);if(!p||!node)return
 const role=node.id===p.integration?'integration':'contributor',head=sha(code?.head)?code.head:null
 let valid=false
 try{valid=!!validateProjectOwnership(p.ownership,p.base,p.integration,g.nodes?.find(n=>n.id===p.integration)?.workerId,p.policy,p.policy.sharedFiles)&&p.integrationWorkerId===p.ownership?.integrationWorkerId}catch{}
 let receiptValid=false
 try{if(code&&validate){validate(g,node,code);receiptValid=true}}catch{}
 const bound=receiptValid&&valid&&code?.goalId===g.id&&code.ticketId===ticketId&&code.ownership?.status==='checked'&&code.ownership.digest===p.ownership!.digest&&code.ownership.head===head&&code.ownership.nodeId===node.id&&code.ownership.workerId===node.workerId
 const ownership=p.ownership||p.integrationWorkerId!==undefined?(code?.error?'blocked':bound?'checked':'unverified'):'legacy_unknown'
 const checks=defs.map(kind=>{
  const stages=(code as CodeReceipt&{stages?:Stage[]}|undefined)?.stages
  const records=Array.isArray(stages)?stages.filter(s=>s&&s.kind===kind):[],s=records.length===1?records[0]:undefined
  const expected=p.policy.stages?(kind==='build'?p.policy.stages.buildCommand:kind==='business'?p.policy.stages.businessCommand:p.policy.stages.startCheck.command):undefined
  const matched=!!p.policy.stages&&!!s&&s.command===expected&&typeof s.output==='string'&&s.output.length<=4000&&bound&&!!head&&s.head===head&&s.policyDigest===p.ownership!.policyDigest&&Number.isSafeInteger(s.startedAt)&&Number.isSafeInteger(s.finishedAt)&&s.startedAt>=0&&s.finishedAt>=s.startedAt&&Number.isInteger(s.exit)
  const state: 'passed'|'failed'|'unverified'=!matched?'unverified':s.exit!==0||kind==='start'&&s.ready!==true?'failed':'passed'
  return {kind,state,head:matched?head:null}
 })
 const legacyTest=receiptValid&&head&&code?.test&&code.test.command===p.policy.testCommand?(code.test.exit===0?'passed' as const:'failed' as const):'unverified' as const
 return {schema:1,role,ownership,ownerWorkerId:valid?p.ownership!.integrationWorkerId:null,sharedFileCount:valid?p.ownership!.sharedFiles.length:0,defaultLockfiles:valid,head,checks,legacyTest,complete:role==='integration'&&bound&&!code?.error&&legacyTest==='passed'&&checks.every(c=>c.state==='passed')}
}
const defs=['build','start','business'] as const
interface Stage {kind:typeof defs[number];head:string;policyDigest:string;startedAt:number;finishedAt:number;exit:number;command:string;output:string;ready?:boolean}

/** Retain evidence for completed goals, but require one current authorized association. */
export function projectIntegrationForTask(host:Pick<Runtime,'store'|'goals'|'projectCode'>,ticketId:string){
 try{
  const candidates=host.store.list<RouterGoal>('router-goal').filter(g=>g.project&&g.taskIds?.includes(ticketId)&&g.nodes?.some(n=>n.ticketId===ticketId))
  if(candidates.length!==1)return
  const candidate=candidates[0]!,g=host.goals.list(host.goals.context(candidate)).find(g=>g.id===candidate.id)
  if(!g?.project)return
  const delivery=host.store.get<{id:string}>('goal-delivery',ticketId),code=delivery?host.projectCode.receipt(delivery.id):undefined
  return projectIntegrationSummary(g,ticketId,code,host.projectCode.validateReceipt.bind(host.projectCode))
 }catch{return undefined}
}
