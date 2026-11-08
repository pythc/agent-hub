import {randomUUID} from 'node:crypto'
import {z} from 'zod'
import type {Runtime} from './runtime.ts'
import type {ScopeContext} from './router-scope.ts'
import type {MemoryFact,MemoryProjection,MemoryCapture,ContextManifest} from './router-memory.ts'
import {stableDigest} from './sources.ts'
import {memoryPolicySchema,normalizeMemory,lexicalScore,cosine,assertNoMemorySecret,type MemoryPolicy} from './memory-policy.ts'
import {embedMemory,validateMemoryVector,type EmbedMemory} from './memory-vectors.ts'
import {extractMemories,consolidateMemories} from './memory-learning.ts'

export interface MemoryObservation {id:string;space:string;triggerId:string;discussion:string;scopeId:string;entryId:string;actor:string;session:string;sourceId:string;start?:number;end?:number;generation:number;epoch:number;policyRevision:number;sequence:number;state:'pending'|'running'|'done'|'held'|'stale';attempts:number;nextAt:number;lease?:string;error?:string}
interface Vector {id:string;factId:string;revision:number;generation:number;scopeId:string;model:string;vector:number[]}
interface Topic {id:string;space:string;scopeId:string;generation:number;label:string;aliases:string[];sources:{id:string;version:number}[];sessions:string[];proposalId?:string}
interface QueryVector {vector?:number[];mode:string;at:number;epoch:number;generation:number;policyRevision:number}
export class AgentMemory {
 private queries=new Map<string,QueryVector>()
 private active?:Promise<void>
 private controller?:AbortController
 private closed=false
 constructor(readonly host:Runtime,readonly embed:EmbedMemory=embedMemory,readonly now=Date.now){
  const schema=host.store.get<number>('memory-schema','current')??1
  if(schema>2)throw Error('Memory schema is newer than this host; use a compatible release')
  // Additive upgrade: legacy facts retain their IDs, state, audience and sources.
  host.store.atomic(()=>{for(const f of host.store.list<MemoryFact>('memory-fact'))if(!f.kind)host.store.put('memory-fact',f.id,{...f,kind:'fact',importance:3,protected:f.state==='active'});host.store.put('memory-schema','current',2);host.store.db.exec('PRAGMA user_version=7')})
  host.memory.recall=(c,q)=>this.recall(c,q)
  host.memory.validateUse=(c,refs)=>{if(!refs.length)return;if(!this.enabled(c))throw Error('Memory use disabled');const allowed=this.authorized(c);if(refs.some(ref=>!allowed.some(f=>f.id===ref.id&&f.revision===ref.revision)))throw Error('Memory audience changed')}
  host.memory.onMutation=()=>{this.queries.clear();this.reconcile()}
  for(const row of this.observations())if(row.state==='running')this.saveObservation({...row,state:'pending',lease:undefined,nextAt:this.now()})
  host.store.atomic(()=>{for(const row of host.store.db.prepare("SELECT id,body FROM records WHERE kind='memory-consolidation'").all()){
   const report=JSON.parse(String(row.body));if(report.status!=='running')continue
   host.store.put('memory-consolidation',String(row.id),{...report,status:'interrupted',reason:'host_restart'})
   host.store.put('memory-maintenance',String(row.id),0)
  }})
  this.reconcile()
 }
 space(c:ScopeContext){return stableDigest([c.route.tenantId,c.route.scopeId,c.route.entryId,c.actor])}
 policy(c:ScopeContext):MemoryPolicy{return memoryPolicySchema.parse(this.host.store.get<any>('memory-policy',c.route.scopeId)?.value??{})}
 policyRevision(c:ScopeContext){return this.host.store.get<any>('memory-policy',c.route.scopeId)?.revision??0}
 enabled(c:ScopeContext){this.host.scopes.assertCurrent(c);return this.host.scopes.scope(c.route.scopeId).memoryEnabled&&this.policy(c).enabled&&this.host.store.get<any>('memory-personal',this.space(c))?.enabled!==false}
 context(row:MemoryObservation,refreshEpoch=false){
  const t=this.host.store.triggers.get(row.triggerId);if(!t)throw Error('source_unavailable')
  const c=this.host.scopes.context(t,row.discussion)
  if(!c||this.space(c)!==row.space||(!refreshEpoch&&c.route.epoch!==row.epoch)||this.host.memory.generation(row.scopeId)!==row.generation)throw Error('scope_changed')
  this.host.routerIngress.authority(t.id)
  this.host.memory.capture(c,[row.sourceId])
  return c
 }
 observations(){return this.host.store.list<MemoryObservation>('memory-observation')}
 saveObservation(row:MemoryObservation){this.host.store.put('memory-observation',row.id,row)}
 observe(c:ScopeContext){
  if(!c.trigger.human||!this.enabled(c))return
  const p=this.policy(c);if(p.writeMode!=='auto')return
  const e=this.host.memory.ingest(c);if(e.revoked)return
  const space=this.space(c),length=[...e.text].length
  let sensitive=false;try{assertNoMemorySecret(e.text)}catch{sensitive=true}
  this.host.store.atomic(()=>{
   for(let start=0;start<length;start+=12000){
   const end=Math.min(length,start+12000),id=stableDigest([space,c.trigger.id,e.version,this.host.memory.generation(c.route.scopeId),start])
   if(this.host.store.get('memory-observation',id))continue
   const sequence=(this.host.store.get<number>('memory-sequence',space)??0)+1
   this.host.store.put('memory-sequence',space,sequence)
   const last=this.host.store.get<number>('memory-last-extract',space)??0
   this.saveObservation({id,space,triggerId:c.trigger.id,discussion:c.route.discussion,scopeId:c.route.scopeId,entryId:c.route.entryId,actor:c.actor,session:c.route.discussion,sourceId:e.id,start,end,generation:this.host.memory.generation(c.route.scopeId),epoch:c.route.epoch,policyRevision:this.policyRevision(c),sequence,state:sensitive?'held':'pending',...(sensitive?{error:'sensitive_content'}:{}),attempts:0,nextAt:Math.max(this.now()+p.delayMs,last+p.minIntervalMs)})
   }
  })
 }
 authorized(c:ScopeContext,candidates=false){
  if(!this.enabled(c))return []
  const items:MemoryProjection[]=[];let cursor:string|undefined
  do{const page=this.host.memory.query(c,{limit:50,candidates,cursor});items.push(...page.items);cursor=page.cursor}while(cursor)
  return items.filter(f=>!['profile','preference','interest'].includes(f.kind??'fact')||f.owner===c.actor)
 }
 private queryKey(c:ScopeContext,q:string){return stableDigest([this.space(c),q.slice(0,200),this.policyRevision(c)])}
 modelSelection(c:ScopeContext){const p=this.policy(c),scope=this.host.scopes.scope(c.route.scopeId),backend=p.extractBackend??scope.router?.backend??this.host.config.execution.router?.backend??this.host.config.execution.roles.router??this.host.config.execution.backend;if(!scope.backendIds.includes(backend))throw Error('Memory backend is outside scope');return {backendId:backend,model:p.extractModel??scope.router?.model??this.host.config.execution.router?.model}}
 private vectorModel(c:ScopeContext){const e=this.policy(c).embedding;return e?stableDigest([e.url,e.model]):''}
 async prepare(c:ScopeContext,query:string){
  if(!this.enabled(c))return
  const p=this.policy(c),key=this.queryKey(c,query),old=this.queries.get(key),generation=this.host.memory.generation(c.route.scopeId)
  if(old&&old.epoch===c.route.epoch&&old.generation===generation&&this.now()-old.at<60000)return
  const capture=this.host.memory.capture(c,[]),revision=this.policyRevision(c)
  let vector:number[]|undefined,mode=p.embedding?'embedding_unavailable':'lexical'
  let sensitive=false;try{assertNoMemorySecret(query)}catch{sensitive=true;mode='embedding_skipped_sensitive'}
  if(p.embedding&&!sensitive)try{vector=validateMemoryVector(await this.embed(query.slice(0,200),p.embedding,AbortSignal.timeout(2000)));mode='hybrid'}catch{}
  this.host.scopes.assertCurrent(c)
  if(capture.generation!==this.host.memory.generation(c.route.scopeId)||revision!==this.policyRevision(c)||!this.enabled(c))return
  if(this.queries.size>=100)this.queries.delete(this.queries.keys().next().value!)
  this.queries.set(key,{vector,mode,at:this.now(),epoch:c.route.epoch,generation,policyRevision:revision})
 }
 similar(c:ScopeContext,a:MemoryFact,b:MemoryFact){const model=this.vectorModel(c),av=this.host.store.get<Vector>('memory-vector',stableDigest([a.id,model])),bv=this.host.store.get<Vector>('memory-vector',stableDigest([b.id,model]));return av?.revision===a.revision&&bv?.revision===b.revision&&av.generation===a.generation&&bv.generation===b.generation?cosine(av.vector,bv.vector):0}
 rank(c:ScopeContext,query:string,items=this.authorized(c)){
  const cached=this.queries.get(this.queryKey(c,query)),model=this.vectorModel(c)
  const q=cached&&cached.epoch===c.route.epoch&&cached.generation===this.host.memory.generation(c.route.scopeId)&&this.now()-cached.at<60000?cached:undefined
  const lexical=items.map(f=>({f,score:lexicalScore(query,f.subject+' '+f.content)})).filter(x=>x.score>0).sort((a,b)=>b.score-a.score||a.f.id.localeCompare(b.f.id))
  const vectors=q?.vector?items.flatMap(f=>{const v=this.host.store.get<Vector>('memory-vector',stableDigest([f.id,model]));return v&&v.revision===f.revision&&v.generation===f.generation?[{f,score:cosine(q.vector!,v.vector)}]:[]}).filter(x=>x.score>=0.5).sort((a,b)=>b.score-a.score||a.f.id.localeCompare(b.f.id)):[]
  const scores=new Map<string,number>()
  for(const ranking of [lexical,vectors])ranking.forEach((x,i)=>scores.set(x.f.id,(scores.get(x.f.id)??0)+1/(60+i)))
  return {items:items.filter(f=>scores.has(f.id)).sort((a,b)=>scores.get(b.id)!-scores.get(a.id)!||a.id.localeCompare(b.id)),mode:q?.vector&&items.some(f=>{const v=this.host.store.get<Vector>('memory-vector',stableDigest([f.id,model]));return !v||v.revision!==f.revision||v.generation!==f.generation||v.vector.length!==q.vector!.length})?'embedding_index_incomplete':q?.mode??(model?'embedding_not_prepared':'lexical')}
 }
 recall(c:ScopeContext,query:string){
  if(!this.enabled(c))return {items:[],status:'unavailable',reason:'Memory disabled'}
  const all=this.authorized(c),resident=all.filter(f=>['profile','preference'].includes(f.kind??'fact')||f.origin==='explicit').sort((a,b)=>(b.importance??3)-(a.importance??3)||b.createdAt-a.createdAt)
  const ranked=this.rank(c,query,all),selected:MemoryProjection[]=[]
  let standingBytes=0,relatedBytes=0
  for(const f of resident){const bytes=Buffer.byteLength(f.content);if(standingBytes+bytes<=3600){standingBytes+=bytes;selected.push(f)}}
  for(const f of ranked.items){if(selected.some(s=>s.id===f.id))continue;const bytes=Buffer.byteLength(f.content);if(relatedBytes+bytes>2400)continue;relatedBytes+=bytes;selected.push(f);if(selected.length>=resident.filter(f=>selected.includes(f)).length+5)break}
  return {items:selected,status:ranked.mode.startsWith('embedding_')?'partial':'complete',reason:ranked.mode.startsWith('embedding_')?ranked.mode:undefined}
 }
 async search(c:ScopeContext,query:string,limit=20){await this.prepare(c,query);if(!this.enabled(c))return {items:[],status:'unavailable',reason:'Memory disabled'};const result=this.rank(c,query);const items=result.items.slice(0,Math.min(20,Math.max(1,limit)));this.recordUse(c,items,'search',result.mode);return {items,status:result.mode.startsWith('embedding_')?'partial':'complete',mode:result.mode}}
 async tool(c:ScopeContext,value:unknown){
  const x=z.object({action:z.enum(['query','inspect','propose']),query:z.string().max(200).optional(),id:z.string().max(300).optional(),subject:z.string().max(300).optional(),content:z.string().max(16000).optional(),operationId:z.string().max(300).optional()}).strict().parse(value)
  if(!this.enabled(c))return {items:[],status:'unavailable',reason:'Memory disabled'}
  if(x.action==='query')return this.search(c,x.query??'')
  if(x.action==='inspect'){const items=this.authorized(c).filter(f=>!x.id||f.id===x.id).slice(0,20);this.recordUse(c,items,'inspect','authorized');return {items,status:'complete'}}
  return this.host.memory.tool(c,x)
 }
 recordUse(c:ScopeContext,items:{id:string;revision:number}[],kind:string,mode:string){
  const now=this.now();for(const ref of items){const f=this.host.memory.fact(ref.id);if(f?.revision===ref.revision)this.host.store.put('memory-fact',f.id,{...f,lastUsedAt:now})}
  this.host.store.put('memory-use',stableDigest([this.space(c),c.trigger.id,kind]),{space:this.space(c),scopeId:c.route.scopeId,entryId:c.route.entryId,actor:c.actor,triggerId:c.trigger.id,generation:this.host.memory.generation(c.route.scopeId),items,kind,mode,at:now})
 }
 recordManifest(c:ScopeContext,m:ContextManifest){this.recordUse(c,m.facts,'context',m.retrieval?.status??'complete')}
 async index(c:ScopeContext,signal:AbortSignal){
  const p=this.policy(c),model=this.vectorModel(c);if(!this.enabled(c)||!p.embedding)return
  const generation=this.host.memory.generation(c.route.scopeId),revision=this.policyRevision(c)
  const facts=this.authorized(c).filter(f=>f.entryId===c.route.entryId&&f.owner===c.actor)
  let count=0
  for(const f of facts){
   try{assertNoMemorySecret(f.subject+' '+f.content)}catch{continue}
   const id=stableDigest([f.id,model]),old=this.host.store.get<Vector>('memory-vector',id);if(old?.revision===f.revision&&old.generation===f.generation)continue
   signal.throwIfAborted();if(count++>=20)break
   let vector:number[]
   try{vector=validateMemoryVector(await this.embed(f.subject+' '+f.content,p.embedding,AbortSignal.any([signal,AbortSignal.timeout(10000)])))}catch{return}
   signal.throwIfAborted();this.host.scopes.assertCurrent(c)
   if(generation!==this.host.memory.generation(c.route.scopeId)||revision!==this.policyRevision(c)||!this.enabled(c))return
   const current=this.host.memory.query(c,{id:f.id}).items[0];if(!current||current.revision!==f.revision)continue
   this.host.store.put('memory-vector',id,{id,factId:f.id,revision:f.revision,generation,scopeId:f.scopeId,model,vector} satisfies Vector)
  }
 }
 reconcile(){
  const store=this.host.store
  for(const row of this.observations())if(['pending','running','held'].includes(row.state))try{this.context(row)}catch{
   try{const current=this.context(row,true);this.saveObservation({...row,epoch:current.route.epoch,state:row.state==='held'?'held':'pending',lease:undefined,error:row.state==='held'?row.error:'context_refreshed'})}
   catch{this.saveObservation({...row,state:'stale',lease:undefined,error:'source_or_scope_changed'})}
  }
  for(const row of store.list<Vector>('memory-vector')){const f=this.host.memory.fact(row.factId);if(!f||f.archived||f.state!=='active'||f.revision!==row.revision||f.generation!==this.host.memory.generation(f.scopeId)||f.sources.some(s=>{const e=this.host.memory.evidence(s.id);return !e||e.revoked||e.version!==s.version}))store.db.prepare("DELETE FROM records WHERE kind='memory-vector' AND id=?").run(row.id)}
  for(const row of store.list<Topic>('memory-topic')){const aliases=row.aliases.filter(alias=>!this.host.memory.topicSuppressed(row.scopeId,alias));if(aliases.length!==row.aliases.length)store.put('memory-topic',row.id,{...row,aliases});if(row.proposalId==='forgotten'||this.host.memory.topicSuppressed(row.scopeId,row.label)||row.generation!==this.host.memory.generation(row.scopeId)||row.sources.some(s=>{const e=this.host.memory.evidence(s.id);return !e||e.revoked||e.version!==s.version}))store.db.prepare("DELETE FROM records WHERE kind='memory-topic' AND id=?").run(row.id)}
  const groups=new Map<string,MemoryFact[]>()
  for(const f of store.list<MemoryFact>('memory-fact'))if(!f.archived&&f.generation===this.host.memory.generation(f.scopeId)&&['active','candidate'].includes(f.state)){
   const key=stableDigest([f.scopeId,f.entryId,f.owner,f.state]);groups.set(key,[...groups.get(key)??[],f])
  }
  for(const group of groups.values()){
   const p=memoryPolicySchema.parse(store.get<any>('memory-policy',group[0]!.scopeId)?.value??{})
   const ranked=group.sort((a,b)=>Number(!!b.protected)-Number(!!a.protected)||(b.importance??3)-(a.importance??3)||(b.lastUsedAt??b.createdAt)-(a.lastUsedAt??a.createdAt))
   for(const f of ranked.slice(p.maxItems))if(!f.protected){store.put('memory-version',f.id+':'+f.revision,f);store.put('memory-fact',f.id,{...f,archived:true,revision:f.revision+1})}
  }
 }
 charge(c:ScopeContext){
  const key=stableDigest([c.route.scopeId,new Date(this.now()).toISOString().slice(0,10)]),used=this.host.store.get<number>('memory-call-count',key)??0
  if(used>=this.policy(c).maxCallsPerDay)throw Error('daily_model_budget')
  this.host.store.put('memory-call-count',key,used+1)
 }
 tick(){
  if(this.closed||this.active)return
  this.reconcile()
  const row=this.observations().filter(r=>r.state==='pending'&&r.nextAt<=this.now()).sort((a,b)=>a.nextAt-b.nextAt||a.sequence-b.sequence).find(r=>{try{const c=this.context(r);return this.enabled(c)&&this.policy(c).writeMode==='auto'&&this.now()>=(this.host.store.get<number>('memory-last-extract',r.space)??0)+this.policy(c).minIntervalMs}catch{return false}})
  if(!row){this.maintain();return}
  let c:ScopeContext;try{c=this.context(row)}catch{return}
  if(!this.enabled(c)||this.policy(c).writeMode!=='auto')return
  this.controller=new AbortController()
  this.active=this.process(c,row,this.controller.signal).catch(()=>{}).finally(()=>{this.active=undefined;this.controller=undefined})
 }
 async drain(){await this.active}
 async close(){this.closed=true;this.controller?.abort();await this.active}
 private maintain(){
  for(const fact of this.host.store.list<MemoryFact>('memory-fact')){
   if(fact.archived||fact.state!=='active')continue
   const evidence=this.host.memory.evidence(fact.sources[0]?.id??''),trigger=evidence?.locator.startsWith('trigger:')?this.host.store.triggers.get(evidence.locator.slice(8)):undefined
   if(!trigger)continue
   try{
    const c=this.host.scopes.context(trigger,trigger.source+':'+trigger.threads[0]!.id);if(!c||c.actor!==fact.owner||!this.enabled(c))continue
    this.host.routerIngress.authority(trigger.id)
    const p=this.policy(c),space=this.space(c),last=this.host.store.get<number>('memory-maintenance',space)??0
    if(this.now()-last<60000||!p.embedding&&p.writeMode!=='auto')continue
    this.host.store.put('memory-maintenance',space,this.now());this.controller=new AbortController()
    const signal=this.controller.signal
    this.active=(async()=>{
     await this.index(c,signal)
     if(!this.enabled(c))return
     for(const f of this.authorized(c))if(f.owner===c.actor&&f.kind==='task'&&!f.protected&&(f.lastUsedAt??f.createdAt)<this.now()-45*86400000&&(f.importance??3)>1)this.host.store.put('memory-fact',f.id,{...f,importance:1})
     const review=this.host.store.get<any>('memory-consolidation',space)
     if(this.policy(c).writeMode==='auto'&&(review?.status==='interrupted'||this.now()-(review?.at??0)>=86400000)&&this.authorized(c).filter(f=>f.owner===c.actor).length>=6)await consolidateMemories(this,c,signal)
    })().catch(()=>{}).finally(()=>{this.active=undefined;this.controller=undefined})
    return
   }catch{}
  }
 }
 private async process(c:ScopeContext,first:MemoryObservation,signal:AbortSignal){
  const policy=this.policy(c)
  let size=0
  const batch=this.observations().filter(r=>r.space===first.space&&r.session===first.session&&r.state==='pending'&&r.nextAt<=this.now()&&r.generation===first.generation&&r.epoch===first.epoch).sort((a,b)=>a.sequence-b.sequence).slice(0,20).filter(r=>{const length=(r.end??this.host.memory.evidence(r.sourceId)!.text.length)-(r.start??0);if(size+length>24000)return false;size+=length;return true})
  const lease=randomUUID(),capture=this.host.memory.capture(c,batch.map(r=>r.sourceId)),revision=this.policyRevision(c)
  this.host.store.atomic(()=>{for(const r of batch)this.saveObservation({...r,state:'running',lease,attempts:r.attempts+1})})
  try{
   const result=await extractMemories(this,c,batch,signal)
   signal.throwIfAborted();this.assertBatch(c,batch,lease,capture,revision)
   this.host.store.atomic(()=>{
    this.assertBatch(c,batch,lease,capture,revision)
    result.apply(capture)
    for(const r of batch)this.saveObservation({...r,state:'done',attempts:r.attempts+1,lease:undefined,error:undefined})
    this.host.store.put('memory-extraction-session',stableDigest([first.space,first.session]),{space:first.space,session:first.session,processedThrough:batch.at(-1)!.sequence,sourceIds:batch.map(r=>r.sourceId),at:this.now()})
    this.host.store.put('memory-last-extract',first.space,this.now())
   })
   await this.index(c,signal)
  }catch(error){
   for(const r of batch){const current=this.host.store.get<MemoryObservation>('memory-observation',r.id);if(current?.state!=='running'||current.lease!==lease)continue
    const reason=error instanceof Error&&['daily_model_budget','unverifiable_memory_source','invalid_memory_target','sensitive_content','invalid_memory_expiry','memory_policy_changed'].includes(error.message)?error.message:'extraction_failed'
    const attempts=current.attempts,state=signal.aborted?'pending':attempts>=3||['daily_model_budget','sensitive_content'].includes(reason)?'held':'pending'
    this.saveObservation({...current,state,lease:undefined,nextAt:this.now()+(signal.aborted?0:Math.min(300000,1000*2**attempts)),error:signal.aborted?'interrupted':reason})
   }
  }
 }
 assertBatch(c:ScopeContext,batch:MemoryObservation[],lease:string,capture:MemoryCapture,revision:number){
  this.host.scopes.assertCurrent(c)
  if(!this.enabled(c)||this.policy(c).writeMode!=='auto'||this.policyRevision(c)!==revision||capture.generation!==this.host.memory.generation(c.route.scopeId))throw Error('memory_policy_changed')
  for(const r of batch){this.context(r);const current=this.host.store.get<MemoryObservation>('memory-observation',r.id);if(current?.state!=='running'||current.lease!==lease)throw Error('memory_lease_lost')}
 }
 observeTopics(c:ScopeContext,labels:string[],batch:MemoryObservation[]){
  const space=this.space(c),generation=this.host.memory.generation(c.route.scopeId)
  for(const label of labels){
   if(this.host.memory.topicSuppressed(c.route.scopeId,label))continue
   const candidates=this.host.store.list<Topic>('memory-topic').filter(t=>t.space===space&&t.generation===generation)
   const same=candidates.find(t=>[t.label,...t.aliases].some(x=>normalizeMemory(x)===normalizeMemory(label)))
   const id=same?.id??stableDigest([space,generation,normalizeMemory(label)])
   const row:Topic=same??{id,space,scopeId:c.route.scopeId,generation,label,aliases:[],sources:[],sessions:[]}
   row.sessions=[...new Set([...row.sessions,...batch.map(b=>b.session)])]
   row.sources=[...new Map([...row.sources,...batch.map(b=>{const e=this.host.memory.evidence(b.sourceId)!;return {id:e.id,version:e.version}})].map(s=>[s.id,s])).values()]
   if(!row.proposalId&&row.sessions.length>=this.policy(c).interestThreshold){
    try{const fact=this.host.memory.command(c,{action:'remember',operationId:'interest:'+id,expectedRevision:0,subject:'interest:'+row.label,content:row.label,sourceIds:row.sources.slice(-30).map(s=>s.id),kind:'interest',candidate:true,topicAliases:row.aliases,visibility:this.host.scopes.binding(c.route.entryId).privateActor?'private':'group'}) as MemoryFact;row.proposalId=fact.id}catch{}
   }
   this.host.store.put('memory-topic',id,row)
  }
 }
 recordDocuments(c:ScopeContext,refs:{documentId:string;revision:number}[],eventId:string){
  if(!this.enabled(c)||!this.policy(c).retrievalConditioning)return
  for(const ref of refs){try{this.host.knowledge.validate(c,[ref])}catch{continue}
   const id=stableDigest([this.space(c),eventId,ref.documentId]);this.host.store.put('memory-document-use',id,{space:this.space(c),scopeId:c.route.scopeId,generation:this.host.memory.generation(c.route.scopeId),triggerId:c.trigger.id,...ref})
  }
 }
 affinity(c:ScopeContext,documentId:string,revision:number){
  if(!this.enabled(c)||!this.policy(c).retrievalConditioning)return 1
  const count=this.host.store.list<any>('memory-document-use').filter(r=>{if(r.space!==this.space(c)||r.generation!==this.host.memory.generation(c.route.scopeId)||r.documentId!==documentId||r.revision!==revision)return false;const t=this.host.store.triggers.get(r.triggerId);try{if(!t)return false;this.host.scopes.assertTrigger(t);return true}catch{return false}}).length
  return count<2?1:1+Math.min(.15,Math.log1p(count)/Math.log(9)*.15)
 }
 async consolidate(c:ScopeContext,signal=AbortSignal.timeout(120000)){
  if(!this.host.scopes.canManage(c))throw Error('Memory consolidation requires scope manager')
  if(this.closed)throw Error('Memory is closed')
  if(this.active)return {status:'busy'}
  this.controller=new AbortController()
  const run=consolidateMemories(this,c,AbortSignal.any([signal,this.controller.signal]))
  this.active=run.then(()=>{},()=>{}).finally(()=>{this.active=undefined;this.controller=undefined})
  return run
 }
 manage(c:ScopeContext,value:unknown){
  const x=z.object({action:z.enum(['inspect','configure','personal','retry','archive','unarchive','topics.forget']),expectedRevision:z.number().int().min(0).optional(),policy:memoryPolicySchema.optional(),enabled:z.boolean().optional(),id:z.string().optional()}).strict().parse(value)
  this.host.scopes.assertCurrent(c)
  if(x.action==='inspect'){
   this.reconcile()
   const items=this.authorized(c,true),fact=x.id?items.find(f=>f.id===x.id):undefined
   if(x.id&&!fact)throw Error('Memory unavailable')
   const origin=fact?.entryId===c.route.entryId
   const evidence=origin?fact!.sources.flatMap(s=>{try{this.host.memory.capture(c,[s.id]);return [this.host.memory.evidence(s.id)!]}catch{return []}}):[]
   const versions=fact&&origin?this.host.store.list<MemoryFact>('memory-version').filter(v=>v.id===fact.id&&v.entryId===c.route.entryId&&v.sources.every(s=>{const e=this.host.memory.evidence(s.id);return e&&!e.revoked&&e.version===s.version})):[]
   return {policy:this.policy(c),revision:this.policyRevision(c),enabled:this.enabled(c),items,detail:fact?{fact,evidence,versions}:undefined,consolidation:this.host.store.get('memory-consolidation',this.space(c)),observations:this.observations().filter(r=>r.space===this.space(c)),topics:this.host.store.list<Topic>('memory-topic').filter(r=>r.space===this.space(c)&&r.generation===this.host.memory.generation(c.route.scopeId)),uses:this.host.store.list<any>('memory-use').filter(r=>r.space===this.space(c)&&r.generation===this.host.memory.generation(c.route.scopeId)),archived:this.host.store.list<MemoryFact>('memory-fact').filter(f=>f.archived&&f.entryId===c.route.entryId&&f.owner===c.actor&&f.generation===this.host.memory.generation(c.route.scopeId)).map(f=>({id:f.id,revision:f.revision,kind:f.kind,createdAt:f.createdAt}))}
  }
  if(!this.host.scopes.canManage(c))throw Error('Memory management requires scope manager')
  if(x.action==='configure'){
   if(x.expectedRevision===undefined||x.expectedRevision!==this.policyRevision(c)||!x.policy)throw Error('Memory policy revision conflict')
   if(x.policy.extractBackend&&!this.host.scopes.scope(c.route.scopeId).backendIds.includes(x.policy.extractBackend))throw Error('Memory backend is outside scope')
   this.host.store.put('memory-policy',c.route.scopeId,{value:x.policy,revision:x.expectedRevision+1});this.queries.clear();return {revision:x.expectedRevision+1}
  }
  if(x.action==='personal'){if(x.enabled===undefined)throw Error('Enabled required');this.host.store.put('memory-personal',this.space(c),{enabled:x.enabled});this.queries.clear();return {enabled:x.enabled}}
  if(x.action==='retry'){
   const row=this.observations().find(r=>r.id===x.id&&r.space===this.space(c));if(!row||row.state!=='held')throw Error('Held extraction required');this.context(row);this.saveObservation({...row,state:'pending',attempts:0,nextAt:this.now(),policyRevision:this.policyRevision(c),error:undefined});return {state:'pending'}
  }
  if(x.action==='topics.forget'){
   const topic=this.host.store.get<Topic>('memory-topic',x.id??'');if(!topic||topic.space!==this.space(c))throw Error('Topic unavailable')
   // Reuse the durable content-free revocation ledger, including all known aliases.
   let f=topic.proposalId?this.host.memory.fact(topic.proposalId):undefined
   if(!f||!['candidate','active'].includes(f.state))f=this.host.memory.command(c,{action:'remember',operationId:'topic-fence:'+topic.id,expectedRevision:0,subject:'interest:'+topic.label,content:topic.label,kind:'interest',topicAliases:topic.aliases,sourceIds:topic.sources.slice(-30).map(s=>s.id),candidate:true},true) as MemoryFact
   else if(topic.aliases.length)this.host.store.put('memory-fact',f.id,f={...f,topicAliases:topic.aliases})
   this.host.memory.command(c,{action:'forget',operationId:'forget-topic:'+topic.id+':'+f.revision,expectedRevision:f.revision,id:f.id},true)
   this.host.store.db.prepare("DELETE FROM records WHERE kind='memory-topic' AND id=?").run(topic.id);return {forgotten:true}
  }
  const f=this.host.memory.fact(x.id??'');if(!f||f.scopeId!==c.route.scopeId||f.entryId!==c.route.entryId||f.owner!==c.actor||f.revision!==x.expectedRevision||f.generation!==this.host.memory.generation(f.scopeId))throw Error('Memory revision or owner changed')
  this.host.store.put('memory-version',f.id+':'+f.revision,f);this.host.store.put('memory-fact',f.id,{...f,archived:x.action==='archive',revision:f.revision+1});this.reconcile();return {id:f.id,archived:x.action==='archive'}
 }
}
