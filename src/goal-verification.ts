import {constants,closeSync,fstatSync,lstatSync,openSync,readSync,realpathSync} from 'node:fs'
import {isAbsolute,join,relative,resolve,sep} from 'node:path'
import {z} from 'zod'
import type {WatchdogRecovery} from './watchdog-contract.ts'
import type {Runtime} from './runtime.ts'
import type {RouterGoal} from './router-goals.ts'
import type {GoalCriterion,GoalNode} from './goal-contract.ts'
import type {WorkerReport} from './vendor/dsh-core/index.ts'
import type {Run} from './store.ts'
import {stableDigest} from './sources.ts'
import {scopeBudget} from './context-budget.ts'
import {evidenceAccess,type GoalEvidence as Evidence} from './goal-evidence.ts'
import type {DelegationBinding} from './delegation/goals.ts'

export interface GoalDelivery {id:string;goalId:string;ticketId:string;triggerId:string;scopeId:string;assignmentId:string;report:WorkerReport;reply?:string;inputRevision:number;at:number}
interface Snapshot {contract:string;tasks:{ticketId:string;assignmentId:string;reportHash:string;inputRevision:number}[];delegations?:DelegationBinding[];evidence:Evidence[]}
export interface VerificationCheck {criterionId:string;verdict:'passed'|'failed'|'insufficient';explanation:string;evidenceIds:string[];method:'program'|'agent'}
export interface VerificationRound {id:string;goalId:string;nodeId?:string;triggerId:string;scopeId:string;entryId:string;ticketIds:string[];delegationIds?:string[];state:'pending'|'running'|'passed'|'failed'|'insufficient'|'errored'|'stale';snapshot:Snapshot;checks:VerificationCheck[];attempts:number;error?:string;at:number;finishedAt?:number;threadId?:string}
const verdict=z.object({checks:z.array(z.object({criterionId:z.string(),verdict:z.enum(['passed','failed','insufficient']),explanation:z.string().min(1).max(8000),evidenceIds:z.array(z.string()).min(1)}).strict()).min(1)}).strict()
const operational=(e:Evidence)=>e.kind==='execution'||e.kind==='report'&&e.key==='watchdog-observation'

/** Read only declared, bounded artifacts within this task's actual workspace. */
function readArtifact(cwd:string,path:string):{content:string;missing?:boolean} {
 if(isAbsolute(path)||path.split(/[\\/]/).some(p=>p==='..'))throw Error('Evidence path must stay inside the task workspace')
 const root=realpathSync(cwd),file=resolve(root,path),rel=relative(root,file)
 if(!rel||rel.startsWith('..'+sep)||isAbsolute(rel))throw Error('Evidence path escapes workspace')
 try{
  let part=root
  for(const segment of rel.split(sep)){part=join(part,segment);if(lstatSync(part).isSymbolicLink())throw Error('Evidence symlinks are not allowed')}
  const fd=openSync(file,constants.O_RDONLY|constants.O_NOFOLLOW)
  try{const before=fstatSync(fd);if(!before.isFile()||before.size>128*1024)throw Error('Evidence must be a regular file no larger than 128 KiB');const data=Buffer.alloc(128*1024+1);let size=0,n=0;while(size<data.length&&(n=readSync(fd,data,size,data.length-size,size))>0)size+=n;if(size>128*1024)throw Error('Evidence exceeds the bounded read limit');const after=fstatSync(fd);if(before.size!==after.size||before.mtimeMs!==after.mtimeMs)throw Error('Evidence changed while reading');const live=lstatSync(file);if(live.isSymbolicLink()||live.ino!==after.ino||live.dev!==after.dev||realpathSync(file)!==file)throw Error('Evidence path changed while reading');return {content:data.subarray(0,size).toString('utf8')}}finally{closeSync(fd)}
 }catch(error:any){if(error.code==='ENOENT')return {content:'',missing:true};throw error}
}

export class GoalVerification {
 constructor(private host:Runtime,private now:()=>number=Date.now){}
 criteria(g:RouterGoal,node?:GoalNode):GoalCriterion[]{return node?node.criterionIds.length?g.criteria.filter(c=>node.criterionIds.includes(c.id)):[{id:'__step__:'+node.id,description:'Verify this intermediate contribution toward '+node.supports?.join(', ')+': '+node.instruction,files:node.outputs??[],documents:[]}]:g.criteria}
 /** Observation only: a live artifact check never releases a goal or replaces acceptance. */
 observe(g:RouterGoal,node:GoalNode){
  const context=this.host.goals.context(g),ticketId=node.ticketId!,run=this.host.store.get<Run>('run',ticketId)
  this.host.scopes.checkTask(ticketId,context,true)
  const criteria=this.criteria(g,node),evidence:Evidence[]=[]
  for(const path of new Set(criteria.flatMap(c=>[...c.files,...(c.check?[c.check.path]:[])]))){
   const data=run?readArtifact(run.cwd,path):{content:'',missing:true}
   evidence.push({id:'artifact-'+stableDigest([ticketId,path]),kind:'file',ticketId,key:path,criterionIds:criteria.map(c=>c.id),...data,hash:stableDigest(data)})
  }
  for(const id of new Set(criteria.flatMap(c=>c.documents))){
   const doc=this.host.knowledge.command({action:'read',id,limit:100},context)
   if(doc.nextOffset!==null)throw Error('Watchdog document evidence exceeds observation budget')
   evidence.push({id:'document-'+stableDigest([ticketId,id]),kind:'document',ticketId,key:id,criterionIds:criteria.map(c=>c.id),content:doc.content,hash:stableDigest(doc.content),revision:doc.revision})
  }
  return {artifacts:evidence.map(({content,...meta})=>({...meta,bytes:Buffer.byteLength(content)})),checks:criteria.filter(c=>c.check).map(c=>this.program(c,{evidence}))}
 }
 capture(ticketId:string,report:WorkerReport,reply?:string):boolean {
  if(report.state!=='ready')return false
  const g=this.host.goals.forTask(ticketId);if(!g)return false
  this.host.goals.context(g)
  const task=this.host.store.tickets.get(ticketId)!,owner=this.host.scopes.ownership(ticketId)!
  const body={goalId:g.id,ticketId,triggerId:g.triggerId,scopeId:g.scopeId,assignmentId:task.assignments.at(-1)!.id,report,reply,inputRevision:owner.dataRevision??1}
  this.host.store.put('goal-delivery',ticketId,{...body,id:stableDigest(body),at:this.now()} satisfies GoalDelivery)
  this.host.engine.report(ticketId,{state:'waiting',summary:'Delivery retained; independent acceptance is pending',question:null})
  return true
 }
 private execution(ticketId:string){
  if(this.host.store.get('task-continuation',ticketId))return JSON.stringify({basis:'Host-managed execution ledger',complete:false,reason:'Earlier task history is quarantined; operational claims spanning it require explicit reconciliation',jobs:[],toolCalls:[],externalTools:[]})
  const all=this.host.work.list(ticketId),calls=this.host.activity.list().filter(a=>a.ticketId===ticketId&&a.kind==='tool'),receipts=this.host.toolConnections.receipts(ticketId)
  const jobs=all.slice(0,100).map(w=>{
   let policy:any=null
   let output:{text?:string;complete:boolean;hash?:string;reason?:string}|undefined
   if(w.kind==='shell'&&/^[a-f0-9-]{36}$/.test(w.id))try{
    const spec=JSON.parse(readArtifact(this.host.work.directory,w.id+'.spec.json').content)
    if(spec.id===w.id&&spec.command===w.command&&spec.cwd===w.cwd)policy={sandboxDriver:spec.sandboxDriver,sandbox:spec.sandbox,network:spec.network}
   }catch{}
   if(w.kind==='shell'&&/^[a-f0-9-]{36}$/.test(w.id))try{
    const log=readArtifact(this.host.work.directory,w.id+'.output')
    output=log.missing?{complete:false,reason:'Host output is unavailable'}:{text:log.content.slice(0,8000),complete:log.content.length<=8000,hash:stableDigest(log.content)}
   }catch{output={complete:false,reason:'Host output could not be captured within the bounded evidence limit'}}
   return {id:w.id,assignmentId:w.assignmentId,kind:w.kind,state:w.state,exitCode:w.exitCode,error:w.error?.slice(0,1000),command:w.command?.slice(0,16000),commandTruncated:(w.command?.length??0)>16000,commandHash:w.command?stableDigest(w.command):undefined,recordedPolicy:policy,output}
  })
  const cap=this.host.store.get<any>('capabilities',ticketId)
  // These records are host-owned API receipts, not model-authored files or
  // opaque tool output. Preserve uncertain phases and scope by the record key.
  const prefix=ticketId+':',publications=this.host.store.db.prepare("SELECT body FROM records WHERE kind='pr-delivery' AND substr(id,1,?)=? ORDER BY id LIMIT 101").all(prefix.length,prefix).map(row=>{const r=JSON.parse(String(row.body));return {phase:r.phase,sourceId:r.sourceId,repository:r.repository,branch:r.branch,number:r.number,url:r.url,head:r.sha,draft:r.draft,confirmedAt:r.confirmedAt}})
  return JSON.stringify({basis:'Host-managed execution ledger; not a Worker assertion',scope:'Task-side commands and tool calls. Configured model inference is outside task-side network policy. This is not an audit of unrelated OS processes.',complete:all.length<=100&&calls.length<=200&&receipts.length<=100&&publications.length<=100,jobs,toolCalls:calls.slice(0,200).map(a=>({id:a.id,name:a.name,state:a.state})),externalTools:receipts.slice(0,100).map(r=>({id:r.id,connection:r.connection,tool:r.tool,state:r.state})),repositoryPublications:publications.slice(0,100),publicationBasis:'Confirmed receipts describe provider readback at confirmedAt, not a fresh remote query; creating or uncertain phases do not prove success.',managedCapabilities:cap?{managed:cap.managed,mcpServers:cap.mcpServers}:null})
 }
 failureEvidence(g:RouterGoal):Evidence[]{
  const c=this.host.goals.context(g),items:Evidence[]=[];let bytes=0
  const add=(value:Omit<Evidence,'id'|'hash'>,referenceId?:string)=>{const hash=stableDigest(value),item={...value,id:referenceId??'evidence-'+hash,hash};bytes+=Buffer.byteLength(JSON.stringify(item));if(bytes>512*1024)throw Error('Replanning evidence exceeds 512 KiB');if(items.some(e=>e.id===item.id))throw Error('Duplicate failure evidence reference');items.push(item)}
  for(const n of g.nodes??[]){
   if(!n.ticketId)continue
   this.host.scopes.checkTask(n.ticketId,c,true)
   const task=this.host.store.tickets.get(n.ticketId)!,run=this.host.store.get<Run>('run',n.ticketId),manifest=this.host.store.get<any>('task-context',n.ticketId)?.manifest
   if(task.ended||this.host.store.get('task-continuation',n.ticketId))throw Error('Replanning cannot reuse ended or quarantined work')
   if(manifest)this.host.memory.validate(manifest)
   if(!this.host.goals.effectsSettled(n.ticketId))throw Error('Replanning requires settled effects')
   const criteria=this.criteria(g,n),criterionIds=criteria.map(c=>c.id),round=n.roundId?this.host.store.get<VerificationRound>('goal-verification',n.roundId):undefined
   add({kind:'report',ticketId:n.ticketId,key:n.id,criterionIds,content:JSON.stringify({nodeId:n.id,report:task.assignments.at(-1)?.report,assignmentId:task.assignments.at(-1)?.id,inputRevision:this.host.scopes.ownership(n.ticketId)?.dataRevision,failedRound:round?{id:round.id,state:round.state,checks:round.checks,error:round.error}:undefined})})
   add({kind:'execution',ticketId:n.ticketId,key:'host-execution',criterionIds,content:this.execution(n.ticketId)})
   // Reports cite this exact ID. Keep the immutable observation in the host cleanup domain
   // and expose it through the same paged evidence tool as every other failure artifact.
   for(const r of this.host.store.list<WatchdogRecovery>('watchdog-recovery').filter(r=>r.goalId===g.id&&r.ticketId===n.ticketId&&r.state!=='stale')){
    add({kind:'report',ticketId:n.ticketId,key:'watchdog-observation',criterionIds,content:JSON.stringify({id:r.id,assignmentId:r.assignmentId,contractHash:r.contractHash,at:r.at,judgment:r.judgment,observation:r.observation??null})},r.id)
   }
   for(const path of new Set(criteria.flatMap(c=>[...c.files,...(c.check?[c.check.path]:[])]))){if(!run)throw Error('Replanning workspace is unavailable');add({kind:'file',ticketId:n.ticketId,key:path,criterionIds,...readArtifact(run.cwd,path)})}
   for(const id of new Set(criteria.flatMap(c=>c.documents))){const doc=this.host.knowledge.command({action:'read',id,limit:100},c);if(doc.nextOffset!==null)throw Error('Replanning document requires smaller evidence');add({kind:'document',ticketId:n.ticketId,key:id,criterionIds,content:doc.content,revision:doc.revision})}
  }
  return items
 }
 private snapshot(g:RouterGoal,node?:GoalNode,requireSettled=true):Snapshot {
  const c=this.host.goals.context(g),criteria=this.criteria(g,node)
  const closure=(ids:string[])=>{const selected=new Set(ids);let grew=true;while(grew){grew=false;for(const n of g.nodes??[])if(selected.has(n.id))for(const id of n.dependsOn)if(!selected.has(id)){selected.add(id);grew=true}}return selected}
  // A dependent result may describe work performed by its prerequisites. Include
  // their host records and source fingerprints, not just the downstream report.
  const selected=closure(node?[node.id]:g.nodes?.map(n=>n.id)??[])
  const nodes=(g.nodes??[]).filter(n=>selected.has(n.id))
  const semanticAncestors=criteria.filter(cr=>!cr.check).map(cr=>{
   const owners=node?[node.id]:(g.nodes??[]).filter(n=>n.criterionIds.includes(cr.id)).map(n=>n.id),ancestors=new Set<string>()
   for(const owner of owners)for(const id of closure([owner]))if(id!==owner)ancestors.add(id)
   return {id:cr.id,ancestors}
  })
  const tasks:Snapshot['tasks']=[],delegations:DelegationBinding[]=[],evidence:Evidence[]=[];let evidenceBytes=0
  const add=(value:Omit<Evidence,'id'|'hash'>)=>{const hash=stableDigest(value),id='evidence-'+hash,item={...value,id,hash};evidenceBytes+=Buffer.byteLength(JSON.stringify(item));if(evidenceBytes>512*1024)throw Error('Acceptance evidence exceeds 512 KiB; declare smaller artifacts');evidence.push(item)}
  if(nodes.some(n=>n.teamTargetId)){
   const receipt=this.host.store.db.prepare("SELECT body FROM records WHERE kind='goal-receipt' AND json_extract(body,'$.goalId')=? ORDER BY rowid LIMIT 1").get(g.id)
   const created=receipt&&JSON.parse(String(receipt.body))
   if(!created?.result?.contract||stableDigest(created.result.contract)!==stableDigest(g.contract))throw Error('Parent goal creation receipt is unavailable or changed')
   add({kind:'execution',key:'goal-controller',criterionIds:criteria.map(cr=>cr.id),content:JSON.stringify({basis:'Parent host goal-controller receipts; not a Router self-report',goalId:g.id,contractHash:stableDigest(g.contract),creation:{triggerId:created.triggerId,fingerprint:created.fingerprint,action:'router_goal.start'},
    nodes:g.nodes?.map(n=>({id:n.id,kind:n.teamTargetId?'team':'worker',targetId:n.teamTargetId??n.workerId,dependsOn:n.dependsOn,criterionIds:n.criterionIds})),
    ...(!node?{acceptedNodes:g.nodes?.map(n=>{const r=n.roundId?this.host.store.get<VerificationRound>('goal-verification',n.roundId):undefined;return {nodeId:n.id,roundId:r?.id,state:r?.state,snapshotHash:r?stableDigest(r.snapshot):undefined,checks:r?.checks.map(c=>({criterionId:c.criterionId,verdict:c.verdict,method:c.method,evidenceIds:c.evidenceIds}))}})}:{}),
   })})
  }
  for(const n of nodes){
   if(n.teamTargetId){
    const remote=this.host.delegation.goalTasks.evidence(g,n),assigned=this.criteria(g,n)
    delegations.push(remote.binding)
    for(const e of remote.evidence)add({...e,criterionIds:[...new Set([...e.criterionIds,...semanticAncestors.filter(cr=>cr.ancestors.has(n.id)).map(cr=>cr.id)])]})
    for(const documentId of [...new Set(assigned.flatMap(cr=>cr.documents??[]))]){
     const doc=this.host.knowledge.command({action:'read',id:documentId,limit:100},c)
     if(doc.nextOffset!==null)throw Error('Declared document exceeds acceptance evidence limit; declare a smaller document')
     add({kind:'document',delegationId:n.delegationId,sourceInstance:this.host.delegation.identity.id,key:documentId,content:doc.content,revision:doc.revision,criterionIds:assigned.filter(cr=>cr.documents?.includes(documentId)).map(cr=>cr.id)})
    }
    continue
   }
   if(!n.ticketId)throw Error('Goal evidence task is missing')
   this.host.scopes.checkTask(n.ticketId,c)
   const manifest=this.host.store.get<any>('task-context',n.ticketId)?.manifest;if(manifest)this.host.memory.validate(manifest)
   const task=this.host.store.tickets.get(n.ticketId)!,run=this.host.store.get<Run>('run',n.ticketId),proposal=this.host.store.get<GoalDelivery>('goal-delivery',n.ticketId)
   if(!proposal||proposal.assignmentId!==task.assignments.at(-1)?.id||proposal.inputRevision!==(this.host.scopes.ownership(n.ticketId)?.dataRevision??1))throw Error('Delivery no longer matches the current task input')
   if(requireSettled&&!this.host.goals.effectsSettled(n.ticketId))throw Error('Task has unfinished or uncertain effects')
   tasks.push({ticketId:n.ticketId,assignmentId:proposal.assignmentId,reportHash:stableDigest(proposal),inputRevision:proposal.inputRevision})
   const assigned=this.criteria(g,n),ids=assigned.map(cr=>cr.id)
   // Ancestor artifacts support downstream semantic claims. Keep deterministic
   // file-check ownership unchanged, including same-named files in other tasks.
   const citeIds=(values:string[])=>[...new Set([...values,...semanticAncestors.filter(cr=>cr.ancestors.has(n.id)).map(cr=>cr.id)])]
   add({kind:'execution',ticketId:n.ticketId,key:'host-execution',content:this.execution(n.ticketId),criterionIds:citeIds(ids)})
   // Final acceptance needs the same immutable failure observation the planner
   // received. Exclude mutable recovery status so resolving it cannot stale a review.
   for(const r of this.host.store.list<WatchdogRecovery>('watchdog-recovery').filter(r=>r.goalId===g.id&&r.ticketId===n.ticketId&&r.contractHash===stableDigest(g.contract)&&r.state!=='stale')){
    add({kind:'report',ticketId:n.ticketId,key:'watchdog-observation',criterionIds:citeIds(ids),content:JSON.stringify({id:r.id,assignmentId:r.assignmentId,contractHash:r.contractHash,at:r.at,judgment:r.judgment,observation:r.observation??null})})
   }
   add({kind:'report',ticketId:n.ticketId,key:'delivery',content:JSON.stringify({report:proposal.report,reply:proposal.reply}),criterionIds:citeIds(ids)})
   const files=[...new Set(assigned.flatMap(cr=>[...(cr.files??[]),...(cr.check?[cr.check.path]:[])]))]
   for(const path of files){if(!run)throw Error('Task workspace is missing');add({kind:'file',ticketId:n.ticketId,key:path,...readArtifact(run.cwd,path),criterionIds:citeIds(assigned.filter(cr=>cr.files?.includes(path)||cr.check?.path===path).map(cr=>cr.id))})}
   for(const documentId of [...new Set(assigned.flatMap(cr=>cr.documents??[]))]){
    const doc=this.host.knowledge.command({action:'read',id:documentId,limit:100},c)
    if(doc.nextOffset!==null)throw Error('Declared document exceeds acceptance evidence limit; declare a smaller document')
    add({kind:'document',ticketId:n.ticketId,key:documentId,content:doc.content,revision:doc.revision,criterionIds:citeIds(assigned.filter(cr=>cr.documents?.includes(documentId)).map(cr=>cr.id))})
   }
  }
  if(Buffer.byteLength(JSON.stringify(evidence))>512*1024)throw Error('Acceptance evidence exceeds 512 KiB; declare smaller artifacts')
  return {contract:stableDigest({objective:g.objective,criteria:g.criteria,nodes:nodes.map(n=>({id:n.id,instruction:n.instruction,criterionIds:n.criterionIds,supports:n.supports,outputs:n.outputs,dependsOn:n.dependsOn,...(n.teamTargetId?{teamTargetId:n.teamTargetId}:{}),prerequisites:n.dependsOn.map(id=>{const dep=g.nodes?.find(d=>d.id===id);return {id,state:dep?.state,roundId:dep?.roundId}})}))}),tasks,...(delegations.length?{delegations}:{}),evidence}
 }
 current(round:VerificationRound,g:RouterGoal):boolean {
  try{return stableDigest(this.snapshot(g,round.nodeId?g.nodes?.find(n=>n.id===round.nodeId):undefined,false))===stableDigest(round.snapshot)}catch{return false}
 }
 ensure(g:RouterGoal,node?:GoalNode):VerificationRound {
  const snapshot=this.snapshot(g,node,false),id='verify-'+stableDigest([g.id,node?.id??'goal',snapshot])
  const prior=this.host.store.get<VerificationRound>('goal-verification',id);if(prior){if(prior.state==='pending')this.host.store.db.prepare("UPDATE jobs SET state='pending' WHERE id=? AND state IN ('done','failed')").run('goal-verify:'+id);return prior}
  if(snapshot.tasks.some(t=>!this.host.goals.effectsSettled(t.ticketId)))throw Error('Task has unfinished or uncertain effects')
  const round:VerificationRound={id,goalId:g.id,nodeId:node?.id,triggerId:g.triggerId,scopeId:g.scopeId,entryId:g.entryId,ticketIds:snapshot.tasks.map(t=>t.ticketId),...(snapshot.delegations?{delegationIds:snapshot.delegations.map(t=>t.delegationId)}:{}),snapshot,state:'pending',checks:[],attempts:0,at:this.now()}
  this.host.store.atomic(()=>{this.host.store.put('goal-verification',id,round);this.host.store.enqueue('goal-verify:'+id,'goal-verify',{roundId:id,goalId:g.id,triggerId:g.triggerId,discussion:g.discussion})})
  return round
 }
 private program(cr:GoalCriterion,snapshot:Pick<Snapshot,'evidence'>):VerificationCheck {
  const check=cr.check!,items=snapshot.evidence.filter(e=>e.kind==='file'&&e.key===check.path&&e.criterionIds.includes(cr.id))
  let passed=items.length>0,reason='Declared artifact matches the deterministic check'
  for(const e of items){
   if(e.missing){passed=false;reason='Required artifact is missing';continue}
   if(check.kind==='text_contains'&&!e.content.includes(check.text)){passed=false;reason='Required literal text is absent'}
   if(check.kind==='json_equals')try{
    if(check.pointer!==''&&!check.pointer.startsWith('/'))throw Error('Invalid JSON pointer')
    let value:any=JSON.parse(e.content)
    for(const key of check.pointer===''?[]:check.pointer.slice(1).split('/').map(k=>k.replace(/~1/g,'/').replace(/~0/g,'~'))){if(value===null||typeof value!=='object'||!Object.hasOwn(value,key))throw Error('JSON pointer not found');value=value[key]}
    if(stableDigest(value)!==stableDigest(check.expected)){passed=false;reason='JSON value differs from the acceptance contract'}
   }catch{passed=false;reason='Artifact is not valid JSON at the required pointer'}
  }
  return {criterionId:cr.id,verdict:passed?'passed':'failed',explanation:reason,evidenceIds:items.map(e=>e.id),method:'program'}
 }
 async perform(id:string){
  let round=this.host.store.get<VerificationRound>('goal-verification',id);if(!round||!['pending','running'].includes(round.state))return
  if(this.host.shuttingDown)return false
  const save=(patch:Partial<VerificationRound>)=>{round={...round!,...patch};this.host.store.put('goal-verification',id,round)}
  try{
   const g=this.host.goals.get(round.goalId);if(g&&['paused','held','needs_input'].includes(g.state))return
   if(!g||!['active','waiting'].includes(g.state)||!this.current(round,g)){save({state:'stale',finishedAt:this.now()});return}
   if(round.ticketIds.some(id=>!this.host.goals.effectsSettled(id)))throw Error('Task has unfinished or uncertain effects')
   // A previously running round is read-only work interrupted by a host stop;
   // resume that attempt without consuming another recovery allowance.
   save({state:'running',attempts:round.state==='running'?round.attempts:round.attempts+1})
   const node=round.nodeId?g.nodes?.find(n=>n.id===round!.nodeId):undefined,criteria=this.criteria(g,node)
   const checks=criteria.filter(cr=>cr.check).map(cr=>this.program(cr,round!.snapshot))
   const semantic=criteria.filter(cr=>!cr.check).map(cr=>({id:cr.id,description:cr.description}))
   if(!node)semantic.push({id:'__goal__',description:'The combined deliverables satisfy the original overall objective and every stated constraint: '+g.objective})
   if(semantic.length&&checks.every(c=>c.verdict==='passed')){
    const snapshot=round.snapshot
    const access=evidenceAccess(snapshot.evidence,scopeBudget(this.host.scopes.scope(g.scopeId).contextBytes).toolReserveBytes,()=>{const current=this.host.goals.get(g.id);if(!current||!this.current(round!,current))throw Error('Acceptance evidence or authority changed')})
    const read=access.read
    const result=await this.host.runGoalVerifier(g,id,{
     input:JSON.stringify({kind:'goal_verification',objective:g.objective,originalRequest:g.contract?this.host.store.triggers.get(g.contract.triggerId)?.text:undefined,authorizationScope:g.contract?.mandate.scope,criteria:semantic,programChecks:checks,evidence:snapshot.evidence.map(({content,...meta})=>meta)}),
     schema:{type:'object',properties:{checks:{type:'array',minItems:semantic.length,maxItems:semantic.length,items:{type:'object',properties:{criterionId:{type:'string',enum:semantic.map(c=>c.id)},verdict:{type:'string',enum:['passed','failed','insufficient']},explanation:{type:'string'},evidenceIds:{type:'array',items:{type:'string'}}},required:['criterionId','verdict','explanation','evidenceIds'],additionalProperties:false}}},required:['checks'],additionalProperties:false},
     tools:access.tools,onTool:access.onTool,
    })
    if(this.host.shuttingDown)return false
    let parsed:z.infer<typeof verdict>
    try{parsed=verdict.parse(JSON.parse(result.text))}catch(error){throw Error('Verification protocol: '+String(error))}
    if(parsed.checks.length!==semantic.length||semantic.some(cr=>parsed.checks.filter(ch=>ch.criterionId===cr.id).length!==1))throw Error('Verification protocol: Verifier must decide every requested criterion exactly once')
    for(const ch of parsed.checks){
     if(ch.evidenceIds.some(id=>!read.has(id)||ch.criterionId!=='__goal__'&&!snapshot.evidence.find(e=>e.id===id)?.criterionIds.includes(ch.criterionId)))throw Error('Verification protocol: Verifier cited evidence it did not inspect for this criterion')
     const required=snapshot.evidence.filter(e=>(e.kind==='file'||e.kind==='document'||operational(e)&&ch.criterionId==='__goal__')&&(ch.criterionId==='__goal__'||e.criterionIds.includes(ch.criterionId)))
     if(ch.verdict==='passed'&&required.some(e=>e.missing||!read.has(e.id)||!ch.evidenceIds.includes(e.id)))throw Error('Verification protocol: Verifier skipped required artifact evidence')
     checks.push({...ch,method:'agent'})
    }
    save({threadId:result.threadId})
    // An incomplete transport or unread available evidence is not evidence
    // that the work itself failed. Retry only the independent review within
    // the protocol limit; exhaustion retains the insufficient verdict.
    const unresolved=checks.filter(ch=>ch.verdict!=='passed')
    const incomplete=(ch:VerificationCheck)=>/truncat|截断/i.test(ch.explanation)||snapshot.evidence.some(e=>!e.missing&&(['file','document','execution'].includes(e.kind)||operational(e))&&(ch.criterionId==='__goal__'||e.criterionIds.includes(ch.criterionId))&&!read.has(e.id))
    if(unresolved.length&&unresolved.every(ch=>ch.verdict==='insufficient'&&incomplete(ch))){
     save({checks,state:'errored',error:'Verification protocol: evidence output was truncated or available evidence was not fully read',finishedAt:this.now()});return
    }
   }
   const latest=this.host.goals.get(g.id)
   if(!latest||latest.state==='cancelled'||!this.current(round,latest)){save({state:'stale',finishedAt:this.now()});return}
   save({checks,state:checks.some(c=>c.verdict==='failed')?'failed':checks.some(c=>c.verdict==='insufficient')?'insufficient':'passed',finishedAt:this.now()})
  }catch(error){
   if(this.host.shuttingDown){save({state:'running',error:undefined});return false}
   save({state:'errored',error:String(error).slice(0,1000),finishedAt:this.now()})
  }
 }
}
