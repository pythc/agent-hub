import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {GithubSource,GhApi,type GithubApi} from './connectors/github.ts'
import type {Runtime} from './runtime.ts'
import type {Config} from './config.ts'
import type {Run} from './store.ts'
import {latestAssignment} from './vendor/dsh-core/index.ts'
export interface MergeGrant {id:string;ticketId:string;source:string;number:number;head:string;branch:string;base:string;expiresAt:number;enabled:boolean}
export interface MergeAttempt {id:string;phase:'waiting'|'submitting'|'merged'|'uncertain'|'revoked';head:string;at:number;reason?:string;sha?:string;checkError?:string}
export function mergeEligibility(snapshot:any,policy:Config['delivery']):string[]{
 const {pull,reviews,checks,graph}=snapshot,errors:string[]=[]
 if(pull.state!=='open'||pull.draft||pull.merged)errors.push('PR is not open and ready')
 if(pull.additions+pull.deletions>=policy.maxChangedLines)errors.push('Changed-line threshold reached')
 if(pull.mergeable!==true)errors.push('Mergeability is unknown or blocked')
 if(graph?.autoMergeRequest)errors.push('PR already has externally managed auto-merge')
 if(graph?.reviewThreads?.pageInfo?.hasNextPage||!graph?.reviewThreads||graph.reviewThreads.nodes.some((r:any)=>!r.isResolved&&!r.isOutdated))errors.push('Unresolved or incomplete review threads')
 const latest=new Map<string,any>()
 for(const review of [...reviews].sort((a,b)=>String(a.submitted_at??'').localeCompare(String(b.submitted_at??''))||a.id-b.id)){
  if(review.state==='COMMENTED'||review.state==='PENDING')continue
  latest.set(review.user?.login?.toLowerCase(),review)
 }
 const approved=[...latest.values()].filter(r=>r.state==='APPROVED'&&r.commit_id===pull.head.sha&&r.user?.login?.toLowerCase()!==snapshot.actor?.toLowerCase()&&r.user?.type!=='Bot'&&!String(r.user?.login).endsWith('[bot]'))
 if([...latest.values()].some(r=>r.state==='CHANGES_REQUESTED'))errors.push('Changes were requested')
 if(policy.requiredReviewers.length){for(const name of policy.requiredReviewers)if(!approved.some(r=>r.user.login.toLowerCase()===name.toLowerCase()))errors.push('Current-head approval missing: '+name)}
 else if(!approved.length)errors.push('Current-head human approval missing')
 if(policy.requireChecks){
  if(!checks.checks.length&&!checks.statuses.length)errors.push('No CI evidence')
  if(checks.head!==pull.head.sha||checks.checks.some((c:any)=>c.status!=='completed'||!['success','neutral','skipped'].includes(c.conclusion))||checks.statuses.some((s:any)=>s.state!=='success'))errors.push('CI is incomplete or failing')
 }
 return errors
}
/** Automatic merging is opt-in, scoped to an owned PR and one explicitly authorized head SHA. */
export class Merger {
 private running:Promise<void>|undefined
 private stopping=false
 constructor(private host:Runtime,private injectedApi?:GithubApi){}
 private source(id:string){const source=this.host.sources.get(id);if(!(source instanceof GithubSource))throw Error('GitHub merge source required');if(!source.config.enabled)throw Error('GitHub merge source is disabled');return source}
 private async owned(ticketId:string,sourceId:string,number:number,snapshot:any){
  const ticket=this.host.store.tickets.get(ticketId),run=this.host.store.get<Run>('run',ticketId)
  if(!ticket||ticket.ended||!run||run.phase!=='idle'||ticket.mandate.actor.source!==sourceId||!ticket.follows?.some(f=>f.own&&f.thread===sourceId+':'+this.source(sourceId).config.repository+'#'+number))throw Error('Merge requires this live task own PR')
  const branch=(await promisify(execFile)('git',['branch','--show-current'],{cwd:run.cwd,encoding:'utf8',timeout:5000})).stdout.trim()
  const repo=this.source(sourceId).config.repository
  if(!branch.startsWith('superagent/')||snapshot.pull.head.ref!==branch||snapshot.pull.head.repo.full_name.toLowerCase()!==repo?.toLowerCase()||snapshot.pull.base.repo.full_name.toLowerCase()!==repo?.toLowerCase())throw Error('PR branch or repository is outside this task')
  return {ticket,run,branch}
 }
 async authorize(ticketId:string,sourceId:string,number:number,expectedHead:string){
  if(this.stopping)throw Error('Host is stopping')
  const snapshot=await this.source(sourceId).mergeSnapshot(number)
  if(this.stopping)throw Error('Host is stopping')
  const {branch}=await this.owned(ticketId,sourceId,number,snapshot)
  // Source settings can change while reading GitHub or the task's git branch.
  this.source(sourceId)
  if(this.stopping)throw Error('Host is stopping')
  if(snapshot.pull.head.sha!==expectedHead)throw Error('PR head changed; inspect the current commit before authorizing')
  const grant:MergeGrant={id:sourceId+':'+number,ticketId,source:sourceId,number,head:expectedHead,branch,base:snapshot.pull.base.ref,expiresAt:Date.now()+86400000,enabled:true}
  this.host.store.atomic(()=>{this.host.store.put('merge-grant',grant.id,grant);this.host.store.audit({type:'operator.merge.authorized',...grant})})
  return grant
 }
 revoke(source:string,number:number,reason='Revoked by operator'){
  const id=source+':'+number
  if(['submitting','uncertain'].includes(this.host.store.get<MergeAttempt>('merge-attempt',id)?.phase??''))throw Error('Merge is already submitting; inspect its outcome before revoking')
  const grant=this.host.store.get<MergeGrant>('merge-grant',id)
  if(!grant)throw Error('Unknown merge authorization')
  this.host.store.put('merge-grant',id,{...grant,enabled:false})
  this.host.store.put('merge-attempt',id,{id,phase:'revoked',head:grant.head,at:Date.now(),reason})
 }
 async beforePush(ticketId:string,source:string,branch:string){
  for(const grant of this.host.store.list<MergeGrant>('merge-grant').filter(g=>g.ticketId===ticketId&&g.source===source&&g.branch===branch&&g.enabled))this.revoke(source,grant.number,'Withdrawn before a new revision is pushed')
 }
 tick(){if(this.stopping)return Promise.resolve();if(!this.running)this.running=this.perform().finally(()=>{this.running=undefined});return this.running}
 private async perform(){
  if(this.host.config.delivery.autoMerge&&this.host.config.delivery.authorization==='policy'&&!this.stopping){
   for(const ticket of this.host.store.tickets.open()){
    if(this.stopping)return
    if(this.host.store.get<Run>('run',ticket.id)?.phase!=='idle'||ticket.undelivered.length||latestAssignment(ticket)?.report?.state!=='ready')continue
    for(const follow of ticket.follows??[]){
     if(!follow.own)continue
     const separator=follow.thread.indexOf(':'),sourceId=follow.thread.slice(0,separator),source=this.host.sources.get(sourceId),number=Number(follow.thread.split('#').at(-1))
     if(!(source instanceof GithubSource)||!source.config.enabled||sourceId!==ticket.mandate.actor.source)continue
     const key=sourceId+':'+number,grant=this.host.store.get<MergeGrant>('merge-grant',key),attempt=this.host.store.get<MergeAttempt>('merge-attempt',key)
     if(grant?.enabled||attempt&&['submitting','uncertain','merged'].includes(attempt.phase))continue
     try{const snapshot=await source.mergeSnapshot(number);if(!mergeEligibility(snapshot,this.host.config.delivery).length&&!(grant&&!grant.enabled&&grant.head===snapshot.pull.head.sha)){await this.authorize(ticket.id,sourceId,number,snapshot.pull.head.sha);this.host.store.audit({type:'policy.merge.authorized',ticketId:ticket.id,head:snapshot.pull.head.sha})}}catch(error){this.host.store.audit({type:'policy.merge.blocked',ticketId:ticket.id,error:String(error).slice(0,200)})}
    }
   }
  }
  for(const grant of this.host.store.list<MergeGrant>('merge-grant')){
   if(this.stopping)return
   if(!grant.enabled)continue
   const previous=this.host.store.get<MergeAttempt>('merge-attempt',grant.id)
   if(previous?.phase==='merged')continue
   if(previous&&Date.now()-previous.at<5000)continue
   const record=(phase:MergeAttempt['phase'],reason?:string,sha?:string)=>{
    const current=this.host.store.get<MergeAttempt>('merge-attempt',grant.id)
    // Failed checks, disabled policy and expiry do not prove an earlier PUT had
    // no effect. Keep its durable fence and the original write failure intact.
    if(phase==='waiting'&&current&&['submitting','uncertain'].includes(current.phase)){
     this.host.store.put('merge-attempt',grant.id,{...current,at:Date.now(),checkError:reason});return
    }
    this.host.store.put('merge-attempt',grant.id,{id:grant.id,phase,head:grant.head,at:Date.now(),reason,sha})
   }
   const policy=this.host.config.delivery
   try{
    if(!policy.autoMerge||!policy.mergeGh){record('waiting','Automatic merging is disabled or the merge identity CLI is missing');continue}
    if(grant.expiresAt<Date.now()){this.revoke(grant.source,grant.number,'Authorization expired');continue}
    const source=this.source(grant.source),snapshot=await source.mergeSnapshot(grant.number)
    if(snapshot.pull.merged){
     if(snapshot.pull.head.sha!==grant.head){this.revoke(grant.source,grant.number,'A different head was merged externally')}
     else record('merged','Observed merged PR',snapshot.pull.merge_commit_sha)
     continue
    }
    if(previous?.phase==='submitting'||previous?.phase==='uncertain'){record('uncertain','Inspect the submitted merge before any retry');continue}
    const {ticket,run}=await this.owned(grant.ticketId,grant.source,grant.number,snapshot)
    const issues=mergeEligibility(snapshot,policy)
    if(snapshot.pull.head.sha!==grant.head||snapshot.pull.base.ref!==grant.base)issues.push('Authorized head or base changed')
    if(ticket.undelivered.length||latestAssignment(ticket)?.report?.state!=='ready')issues.push('Worker has not finished current inputs')
    if(issues.length){record('waiting',issues.join('; '));continue}
    const merger=this.injectedApi??new GhApi(policy.mergeGh),actor=await merger.request('GET','user')
    if(actor.login.toLowerCase()===snapshot.actor.toLowerCase()){record('waiting','Merge identity must differ from the agent account');continue}
    const fresh=this.host.store.get<MergeGrant>('merge-grant',grant.id),live=this.host.store.tickets.get(ticket.id),liveRun=this.host.store.get<Run>('run',ticket.id)
    if(this.stopping||this.host.status().paused||!source.config.enabled||this.host.sources.get(grant.source)!==source||!fresh?.enabled||fresh.head!==grant.head||fresh.expiresAt<Date.now()||live?.ended||live?.undelivered.length||latestAssignment(live!)?.report?.state!=='ready'||liveRun?.phase!=='idle'||JSON.stringify(policy)!==JSON.stringify(this.host.config.delivery))continue
    // REST merge performs the head comparison atomically on GitHub. Enabling queued
    // auto-merge has no expected-head field and would leave a stale-head race.
    this.host.store.atomic(()=>{record('submitting');this.host.store.put('run',ticket.id,{...run,phase:'merging'})})
    try{
     const result=await merger.request('PUT','repos/'+source.config.repository+'/pulls/'+grant.number+'/merge',{sha:grant.head,merge_method:policy.method})
     if(!result.merged)throw Error('GitHub did not confirm the merge')
     record('merged',undefined,result.sha)
    }catch(error){record('uncertain',String(error).slice(0,500))}
    finally{const current=this.host.store.get<Run>('run',ticket.id);if(current?.phase==='merging')this.host.store.put('run',ticket.id,{...current,phase:'idle'})}
   }catch(error){record('waiting',String(error).slice(0,500))}
  }
 }
 async close(){this.stopping=true;await this.running}
}
