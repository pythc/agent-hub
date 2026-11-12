import {existsSync,lstatSync,rmSync} from 'node:fs'
import {join,resolve,relative,sep,dirname} from 'node:path'
import type {Store} from './store.ts'
import {stableDigest} from './sources.ts'
import type {Model} from './model.ts'

export interface HistoryPlan {
 id:string;scopeId:string;at:number;roots:string[];records:[string,string][];
 tickets:string[];triggers:string[];sessions:{threadId:string;cwd:string}[];files:string[];unresolvedSessions?:string[]
}
export interface CleanupReceipt {id:string;scopeId:string;status:'processing'|'completed';phase:'quiescing'|'native_history'|'files'|'database'|'verified';attempts:number;nativeDone:string[];local?:'verified';external:'not_managed';backups:'restore_fenced';error?:string;nextAt?:number;at:number}
export function protocolTombstone(id:string,value:any){return {id,deleted:true,effectReceipts:value?.effectReceipts??Object.entries(value?.effects??{}).map(([callId,e]:[string,any])=>({callId,digest:e.digest,state:e.state}))}}
// Configuration, authority identities and memory projections have their own revision
// semantics. They must never be swept through a free-text or shared-scope join.
const excluded=/^(?:router-duty$|router-proactive-settings$|memory-|history-|settings|scope-|management-scope$|entry-|source-(?:cursor|health|live|observed|event-key|change-receipt|invalid-trigger|entry-state|member-state|message-state|message-observation|freshness|identity|identity-mismatch)$|context-session-fence$|identity-link$|backend-(?:binding|deleted)$|task-(?:ownership|channel)$|worker-(?:pool|grant)$|retired-worker$|clock$|health$|tenant-epoch$|router-route$|context-manifest$)/
const metadata=new Set(('id key type kind state status phase code role name source sourceId actor actorId tenantId scopeId entryId routerId ticketId assignmentId triggerId triggerIds parentTrigger threadId turnId discussion channel address channels origin follows threads inputs undelivered assignments mandate basis policyVersion rules authority human addressed at createdAt startedAt endedAt capturedAt occurredAt updatedAt revision version epoch generation ownerEpoch dataRevision workerId agentId backendId backendKind model cwd path requestId callId operationId fingerprint digest hash sha256 expires expiresAt nextAt attempts pid exitCode notify prepared toolsVersion toolsDigest format ephemeral reason depth sandbox parentId activity contextId external local bytes success deleted').split(' '))
for(const key of ['messageId','chat','root','parent','userId','conversationId','strength','via','cell','row','connection','tool','report','ended','meta','owner','responseTo','ref','subscriptions','correlated','pending','context','evalId','decisionId','fanout','acked','handbacks','inputIds','lastAt','by','outcome','answers','attention','readAt','deliveredAt'])metadata.add(key)
const payloads=new Set('text title summary reply scope content prompt instructions result error description question command arguments output data payload body message details input parameters sent requested confirmed assessment acceptance ruleAssessments messages turns effects name reason'.split(' '))
/** Keep the envelope and effect identity; remove arbitrary payload keys as well as text. */
export function redactBody(value:any,key=''):any {
 if(key==='meta'&&value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([k,v])=>['scope','chat','root','messageId','parent'].includes(k)&&typeof v==='string'))
 if(payloads.has(key))return Array.isArray(value)?[]:value&&typeof value==='object'?{deleted:true}:typeof value==='string'?'':null
 if(value===null)return value
 if(typeof value==='boolean'||typeof value==='number')return metadata.has(key)?value:null
 if(typeof value==='string')return metadata.has(key)&&!['reason','name'].includes(key)?value:''
 if(Array.isArray(value))return value.map(v=>redactBody(v,key))
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([k])=>metadata.has(k)||payloads.has(k)).map(([k,v])=>[k,redactBody(v,k)]))
 return null
}
function references(value:any,ids:Set<string>):boolean {
 if(typeof value==='string'){
  if(ids.has(value))return true
  // Resource names and encoded principals are references, not substring keywords.
  if(value.startsWith('{')||value.startsWith('[')){try{return references(JSON.parse(value),ids)}catch{}}
  // Cached resource pages can refer to a source only through their resource URI.
  // Match the documented grammar and an ID boundary, never arbitrary substrings.
  const resource=/^(?:trigger|ticket|transcript|native|feishu|wecom|trigger-source|thread|decision|asset|tool-call|model-tool-receipt|agent-configuration|job)\/(.+)$/.exec(value)
  return !!resource&&[...ids].some(id=>resource[1]===id||resource[1]!.startsWith(id+'/'))
 }
 return value&&typeof value==='object'?Object.values(value).some(v=>references(v,ids)):false
}
const rows=(s:Store)=>s.db.prepare('SELECT kind,id,body FROM records').all().map(r=>({kind:String(r.kind),id:String(r.id),body:JSON.parse(String(r.body))}))

/** Content-free dependency snapshot is written to the revocation ledger before wiping. */
export function planHistory(store:Store,stateDir:string,scopeId:string,id:string,at:number,sourceEvidence?:string):HistoryPlan {
 const all=rows(store),roots=new Set<string>(),triggers=new Set<string>(),tickets=new Set<string>()
 for(const r of all)if(r.kind==='memory-evidence'&&(sourceEvidence?r.id===sourceEvidence:r.body.scopeId===scopeId)){
  roots.add(r.id);if(r.body.locator?.startsWith('trigger:'))triggers.add(r.body.locator.slice(8))
 }
 if(!sourceEvidence){
  for(const r of all)if(r.kind==='router-route'&&r.body.scopeId===scopeId)triggers.add(r.body.triggerId)
  for(const r of all)if(r.kind==='task-ownership'&&r.body.scopeId===scopeId)tickets.add(r.body.ticketId)
 }
 for(const r of all)if(r.kind==='memory-fact'&&r.body.sources?.some((s:any)=>roots.has(s.id))&&(r.body.relation==='joint'||r.body.sources.every((s:any)=>roots.has(s.id))))roots.add(r.id)
 for(const v of [...triggers,...tickets])roots.add(v)
 for(const r of all)if(r.kind==='context-manifest'&&references(r.body,roots))roots.add(r.id)
 const plan:HistoryPlan={id,scopeId,at,roots:[...roots],records:[],tickets:[...tickets],triggers:[...triggers],sessions:[],files:[]}
 return expandPlan(store,stateDir,plan)
}
function expandPlan(store:Store,stateDir:string,plan:HistoryPlan):HistoryPlan {
 const all=rows(store),ids=new Set(plan.roots),selected=new Map(plan.records.map(([k,id])=>[k+'\0'+id,[k,id] as [string,string]]))
 const nonDocumentIds=new Set(all.filter(r=>r.kind!=='knowledge-document').map(r=>r.id))
 for(const [,id] of selected.values())ids.add(id)
 let changed=true
 while(changed){
  // A legacy knowledge ID may be equal to an unrelated task or other record.
  // Refuse ambiguous deletion before writing the revocation ledger or clearing data.
  for(const d of all)if(d.kind==='knowledge-document'&&nonDocumentIds.has(d.id)&&(ids.has(d.id)||references(d.body,ids)))throw Error('History cleanup has an ambiguous document ID; reconcile the conflicting records before deleting')
  changed=false;for(const r of all){
  if(excluded.test(r.kind)||selected.has(r.kind+'\0'+r.id))continue
  if(ids.has(r.id)||references(r.body,ids)){
   selected.set(r.kind+'\0'+r.id,[r.kind,r.id]);ids.add(r.id);changed=true
   if(r.kind==='ticket'){for(const a of r.body.assignments??[])ids.add(a.id)}
   if(['run','work','model-session','router-session','router-result','worker-migration','router-migration','context-handoff'].includes(r.kind))for(const threadId of [r.body.threadId,r.body.from?.threadId,r.body.previousThread])if(typeof threadId==='string')ids.add(threadId)
  }
 }
 for(const j of store.db.prepare('SELECT id,payload FROM jobs').all())if(!ids.has(String(j.id))&&references(JSON.parse(String(j.payload)),ids)){ids.add(String(j.id));changed=true}
 }
 const sessions=new Map(plan.sessions.map(s=>[s.threadId,s])),unresolved=new Set(plan.unresolvedSessions??[]),files=new Set(plan.files),tickets=new Set(plan.tickets),triggers=new Set(plan.triggers)
 for(const r of all)if(selected.has(r.kind+'\0'+r.id)){
  if(r.kind==='ticket')tickets.add(r.id)
  if(r.kind==='trigger')triggers.add(r.id)
  if(['run','work','model-session','router-session','router-result','worker-migration','router-migration','context-handoff','backend-thread','backend-plugin-thread'].includes(r.kind)&&!r.body.ephemeral){
   const sourceId=r.body.source??all.find(x=>x.kind==='trigger'&&plan.triggers.includes(x.id)&&r.body.discussion===x.body.source+':'+x.body.threads?.[0]?.id)?.body.source
   const cwd=r.body.cwd??r.body.from?.cwd??all.find(x=>x.kind==='run'&&x.id===r.body.ticketId)?.body.cwd??all.find(x=>x.kind==='settings'&&x.id==='current')?.body.config?.sources?.find((s:any)=>s.id===sourceId)?.cwd
   for(const threadId of [r.body.threadId,r.body.from?.threadId,r.body.previousThread,...(['backend-thread','backend-plugin-thread'].includes(r.kind)?[r.id]:[])])if(typeof threadId==='string'){if(cwd)sessions.set(threadId,{threadId,cwd});else unresolved.add(threadId)}
  }
  if(r.kind==='router-goal'&&r.body.project?.base){
   files.add(join(stateDir,'code-projects',stableDigest(r.id)))
   for(const ticket of r.body.taskIds)files.add(join(stateDir,'work',stableDigest(['code-project',ticket])))
  }
  if(r.kind==='asset'&&r.body.path)files.add(dirname(r.body.path))
  if(r.kind==='work')for(const suffix of ['.spec.json','.output','.result.json'])files.add(join(stateDir,'jobs',r.id+suffix))
 }
 return {...plan,records:[...selected.values()],roots:[...ids],sessions:[...sessions.values()],unresolvedSessions:[...unresolved].filter(id=>!sessions.has(id)),files:[...files],tickets:[...tickets],triggers:[...triggers]}
}

export class HistoryCleanup {
 private busy=false
 onExpand?:(plan:HistoryPlan)=>void
 constructor(readonly store:Store,readonly stateDir:string){
  store.bodyFilter=(kind,id,value)=>this.filter(kind,id,value)
  for(const plan of this.plans())if(rows(store).some(r=>this.blocked(r.kind,r.id,r.body)&&JSON.stringify(r.body)!==JSON.stringify(this.filter(r.kind,r.id,r.body))))this.apply(plan)
 }
 plans(){return this.store.list<HistoryPlan>('history-plan')}
 receipts(){return this.store.list<CleanupReceipt>('history-cleanup')}
 blocked(kind:string,id:string,value?:unknown){return this.plans().some(p=>p.records.some(([k,i])=>k===kind&&i===id)||!excluded.test(kind)&&references(value,new Set(p.roots)))}
 private filter(kind:string,id:string,value:unknown){
  if(!this.blocked(kind,id,value))return value
  if(kind==='thread'){
   const v=value as any,ref=v.ref??this.store.triggers.get(id)?.threads[0]??this.store.list<any>('trigger').flatMap(t=>t.threads??[]).find(r=>r.source+':'+r.id===id)
   if(!ref)throw Error('Deleted thread requires its original source identity for reconciliation')
   return {...redactBody(v),ref,subscriptions:[],correlated:[],pending:[],context:[]}
  }
  if(kind==='backend-plugin-thread'){
   // The deletion fence blocks normal reads/resume immediately. Keep only the
   // private native mapping needed to retry purge until its verified receipt.
   const body=redactBody(value)
   if(this.store.get('backend-deleted',id))return {...body,deleted:true}
   const v=value as Record<string,unknown>
   return {...body,...Object.fromEntries(['pluginId','stateVersion','identity','nativeId','accountIdentity'].filter(k=>v[k]!==undefined).map(k=>[k,v[k]]))}
  }
  return kind==='backend-thread'?protocolTombstone(id,value):redactBody(value)
 }
 apply(plan:HistoryPlan){
  // Replayed after restore even if the old snapshot claimed cleanup was complete.
  this.store.put('history-plan',plan.id,plan)
  for(const session of plan.sessions)this.store.put('backend-delete-pending',session.threadId,{threadId:session.threadId,cleanupId:plan.id})
  const previous=this.store.get<CleanupReceipt>('history-cleanup',plan.id)
  this.store.put('history-cleanup',plan.id,{id:plan.id,scopeId:plan.scopeId,status:'processing',phase:'quiescing',attempts:previous?.attempts??0,nativeDone:[],external:'not_managed',backups:'restore_fenced',at:Date.now()} satisfies CleanupReceipt)
  this.sweep(plan)
 }
 private sweep(plan:HistoryPlan){
  const ids=new Set(plan.roots)
  this.store.atomic(()=>{
   for(const r of rows(this.store))if(this.blocked(r.kind,r.id,r.body)){
    if(r.kind==='knowledge-chunk')this.store.db.prepare('DELETE FROM memory_search WHERE id=?').run(r.id)
    this.store.put(r.kind,r.id,r.body)
   }
   for(const id of plan.tickets){const o=this.store.get<any>('task-ownership',id);if(o)this.store.put('task-ownership',id,{...o,state:'held',reason:'History body deleted; explicit current authorization required'})}
   for(const row of this.store.db.prepare('SELECT * FROM jobs').all())if(references(JSON.parse(String(row.payload)),ids))this.store.db.prepare("UPDATE jobs SET payload=?,state=CASE WHEN state='done' THEN state ELSE 'blocked' END,error=NULL WHERE id=?").run(JSON.stringify(redactBody(JSON.parse(String(row.payload)))),String(row.id))
   for(const row of this.store.db.prepare('SELECT * FROM outbox').all())if(ids.has(String(row.id))||references(JSON.parse(String(row.body)),ids))this.store.db.prepare("UPDATE outbox SET body=?,status=CASE WHEN status IN ('sent','uncertain','sending') THEN status ELSE 'dropped' END,error=NULL WHERE id=?").run(JSON.stringify(redactBody(JSON.parse(String(row.body)))),String(row.id))
   for(const row of this.store.db.prepare('SELECT seq,body FROM audit').all())if(references(JSON.parse(String(row.body)),ids))this.store.db.prepare('UPDATE audit SET body=? WHERE seq=?').run(JSON.stringify(redactBody(JSON.parse(String(row.body)))),row.seq!)
  })
 }
 async process(model:Model,quiesce:(plan:HistoryPlan)=>Promise<boolean>){
  if(this.busy)return;this.busy=true
  try{for(const old of this.plans()){
   let receipt=this.store.get<CleanupReceipt>('history-cleanup',old.id)!
   if(receipt.status==='completed'||(receipt.nextAt??0)>Date.now())continue
   const plan=expandPlan(this.store,this.stateDir,old)
   if(JSON.stringify(plan)!==JSON.stringify(old))this.onExpand?.(plan)
   this.store.put('history-plan',plan.id,plan)
   for(const session of plan.sessions)this.store.put('backend-delete-pending',session.threadId,{threadId:session.threadId,cleanupId:plan.id})
   const save=(patch:Partial<CleanupReceipt>)=>{receipt={...receipt,...patch,at:Date.now()};this.store.put('history-cleanup',plan.id,receipt)}
   try{
    save({attempts:receipt.attempts+1,error:undefined,nextAt:undefined,phase:'quiescing'})
    if(!await quiesce(plan))continue
    save({phase:'native_history'})
    if(plan.unresolvedSessions?.length)throw Error('Owned history has no verified execution directory; reconcile its session metadata before cleanup can complete')
    for(const session of plan.sessions)if(!receipt.nativeDone.includes(session.threadId)){
     if(!model.purge)throw Error('Backend has no verifiable history deletion capability')
     await model.purge(session.threadId,session.cwd);save({nativeDone:[...receipt.nativeDone,session.threadId]})
    }
    save({phase:'files'})
    for(const path of plan.files){
     const rel=relative(resolve(this.stateDir),resolve(path))
     if(rel.startsWith('..'+sep)||!['assets','jobs'].includes(rel.split(sep)[0]!)&&!/^(code-projects|work)[\\/]([a-f0-9]{64})$/.test(rel))throw Error('Deletion file is outside managed history storage')
     // Reject symlink ancestors; never traverse into a user workspace.
     const parts=rel.split(sep);for(let n=1;n<parts.length;n++){const parent=join(this.stateDir,...parts.slice(0,n));if(existsSync(parent)&&lstatSync(parent).isSymbolicLink())throw Error('Managed history path contains a symlink')}
     rmSync(path,{force:true,recursive:true});if(existsSync(path))throw Error('Managed file deletion readback failed')
    }
    save({phase:'database'});this.sweep(plan)
    for(const r of rows(this.store))if(this.blocked(r.kind,r.id,r.body)&&JSON.stringify(r.body)!==JSON.stringify(this.filter(r.kind,r.id,r.body)))throw Error('Body deletion readback failed')
    this.store.db.exec("INSERT INTO memory_search(memory_search) VALUES('rebuild')")
    if(Number(this.store.db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get()?.busy)!==0)throw Error('Database readers must release before physical cleanup')
    this.store.db.exec('VACUUM')
    if(Number(this.store.db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get()?.busy)!==0)throw Error('Database cleanup checkpoint is pending')
    save({status:'completed',phase:'verified',local:'verified'})
   }catch(error){save({status:'processing',error:String(error).slice(0,300),nextAt:Date.now()+Math.min(60000,1000*2**Math.min(receipt.attempts-1,6))})}
  }}finally{this.busy=false}
 }
}
