import {configuredHistoryReader,type HistoryReader} from './history-backup.ts'
import {SourceRegistry} from './source-plugins.ts'
import {DatabaseSync,backup} from 'node:sqlite'
import {existsSync,mkdirSync,readFileSync,writeFileSync,openSync,closeSync,unlinkSync,renameSync,chmodSync} from 'node:fs'
import {join,resolve} from 'node:path'
import {randomUUID} from 'node:crypto'
import {z} from 'zod'
import {configSchema,type Config} from './config.ts'
import {Store,MAX_DB_SCHEMA} from './store.ts'
import {RouterScopes,scopeCommandSchema,type EntryBinding,type TaskOwnership} from './router-scope.ts'
import {stableDigest} from './sources.ts'
import {atomicPrivateFile} from './managed-config.ts'
import {makePolicy} from './policy.ts'
import {backupState,verifyBackup} from './backup.ts'

// Persistent formats owned by this host. Unknown plugin kinds require an explicit migration adapter.
export const migrationKinds=new Set(`trigger disposition thread ticket decision run clock settings settings-history settings-backends
browser-profile browser-session browser-receipt chat-call chat-conversation chat-message chat-revision chat-run
router-cancelled router-candidate router-candidate-job router-followup router-followup-notice router-followup-stop-attempt router-followup-stopped router-handback
approval asset backend-binding backend-thread capabilities entry-client-event entry-client-install entry-client-receipt entry-invite entry-label entry-plan entry-verification
execution-call health member-preview merge-attempt merge-grant onboarding onboarding-deployment pr-delivery progress prompt-preview prompt-use resource-page retired-worker review-action review-rounds
router-input-set router-duty router-proactive-settings router-schedule router-schedule-run router-batch router-intervention-clock proactive-receipt router-admission router-delegation router-error router-inbox router-migration router-read router-reply-owner router-report-read router-result router-session router-version
router-journal router-commitment router-checkpoint journal-receipt router-goal goal-wake goal-receipt goal-delivery goal-verification goal-verification-attempt goal-repair goal-release goal-replan goal-plan-dispatch knowledge-document knowledge-version knowledge-chunk knowledge-receipt
setup source-cursor source-envelope source-event-key source-health source-live source-observed thread-cursor thread-health tool-receipt transcript wecom-inbox
work work-request worker-assignment worker-command worker-grant worker-migration worker-pool agent-configuration agent-input agent-progress restore-commit setup-commit
management-scope entry-binding task-ownership task-routing task-channel tenant-epoch control-receipt router-route task-context context-manifest memory-evidence memory-event-first-seen memory-fact memory-version memory-share memory-generation memory-watermark memory-suppression memory-receipt memory-revocation-head memory-clock memory-query-version history-plan history-cleanup history-fence backend-deleted backend-delete-pending context-budget model-session model-tool-receipt context-rebuild context-handoff context-session-fence task-continuation source-change-receipt source-invalid-trigger source-entry-state source-member-state source-message-state source-message-observation source-freshness source-identity source-native-proof source-identity-mismatch identity-receipt identity-challenge identity-link maintenance-gap scope-migration reply-hold reply-review-receipt memory-schema memory-policy memory-personal memory-observation memory-sequence memory-last-extract memory-extraction-session memory-vector memory-topic memory-document-use memory-use memory-maintenance memory-consolidation memory-call-count`.split(/\s+/))
const specSchema=z.object({operationId:z.string().min(1).max(100),commands:z.array(scopeCommandSchema).default([])}).strict()
export type MigrationSpec=z.infer<typeof specSchema>
interface MigrationItem {kind:string;id:string;status:'mapped'|'held'|'conflict'|'unchanged';reason?:string;scopeId?:string;entryId?:string}
export interface MigrationPlan {protocol:1;operationId:string;schema:number;fingerprint:string;configFingerprint:string;items:MigrationItem[];counts:Record<string,number>;taskOwners:TaskOwnership[];commands:unknown[];canApply:boolean}
function rows(db:DatabaseSync){return db.prepare('SELECT kind,id,body FROM records ORDER BY kind,id').all().map(r=>({kind:String(r.kind),id:String(r.id),body:JSON.parse(String(r.body))}))}
function fingerprint(db:DatabaseSync){return stableDigest({schema:db.prepare('PRAGMA user_version').get(),records:db.prepare('SELECT * FROM records ORDER BY kind,id').all(),jobs:db.prepare('SELECT * FROM jobs ORDER BY id').all(),outbox:db.prepare('SELECT * FROM outbox ORDER BY id').all(),audit:db.prepare('SELECT * FROM audit ORDER BY seq').all()})}
export function previewScopeMigration(config:Config,value:unknown):MigrationPlan{
 const spec=specSchema.parse(value),path=join(config.stateDir,'state.sqlite'),db=new DatabaseSync(path,{readOnly:true})
 try{
  db.exec('BEGIN');const schema=Number(db.prepare('PRAGMA user_version').get()!.user_version)
  if(![5,6,7].includes(schema))throw Error('Scope migration supports schema 5 and unscoped schema 6 or 7 only')
  if(schema>=6&&db.prepare("SELECT 1 FROM records WHERE kind='management-scope' LIMIT 1").get())throw Error('Database already has Router scopes; use explicit task and entry commands')
  if(db.prepare('PRAGMA integrity_check').get()!.integrity_check!=='ok')throw Error('Source database failed integrity check')
  const savedSettings=db.prepare("SELECT body FROM records WHERE kind='settings' AND id='current'").get()
  if(savedSettings&&stableDigest(configSchema.parse(JSON.parse(String(savedSettings.body)).config))!==stableDigest(config))throw Error('Export the current effective configuration before migration; saved runtime settings differ')
  const records=rows(db),lookup=(kind:string,id:string)=>records.find(r=>r.kind===kind&&r.id===id)?.body
  const scopes=spec.commands.filter(c=>c.action==='scope.put').map(c=>c.scope)
  const bindings=spec.commands.filter(c=>c.action==='entry.bind').map(c=>{const scope=scopes.find(s=>s.id===c.scopeId),source=config.sources.find(s=>s.id===c.sourceId);if(!scope||!source)throw Error('Migration bindings need an explicit scope and configured source');return {...c,tenantId:scope.tenantId,id:stableDigest([scope.tenantId,source.kind,c.accountNamespace,c.nativeId])}})
  if(spec.commands.some(c=>!['scope.put','entry.bind'].includes(c.action)||c.expectedRevision!==0))throw Error('Migration plan can only create new scope definitions and bindings')
  if(new Set(scopes.map(s=>s.id)).size!==scopes.length||new Set(bindings.map(b=>b.sourceId+':'+b.nativeId)).size!==bindings.length)throw Error('Migration mapping is ambiguous')
  const taskOwners:TaskOwnership[]=[],items:MigrationItem[]=records.map(r=>({kind:r.kind,id:r.id,status:migrationKinds.has(r.kind)?'unchanged':'conflict',...(!migrationKinds.has(r.kind)?{reason:'Unknown persistent format; adapter required'}:{})}))
  for(const item of items.filter(i=>i.kind==='ticket')){
   const ticket=lookup('ticket',item.id),a=lookup('worker-assignment',item.id),trigger=a?.parentTrigger?lookup('trigger',a.parentTrigger):undefined
   const matches=trigger?bindings.filter(b=>b.sourceId===trigger.source&&b.nativeId===String(trigger.meta.chat??trigger.meta.scope??trigger.threads?.[0]?.id)):[]
   const run=lookup('run',item.id),admission=trigger&&lookup('router-admission',trigger.id),origin=lookup('trigger',ticket.origin.triggerId)
   const scope=matches.length===1?scopes.find(s=>s.id===matches[0]!.scopeId):undefined
   const reason=!a||!trigger?'needs_router_ownership':!admission?.mandate||admission.state!=='accepted'||!origin||!ticket.mandate||!makePolicy(config,()=>false).revalidate(admission.mandate)||!makePolicy(config,()=>false).revalidate(ticket.mandate)||admission.mandate.basis.via==='followup'&&!admission.anchor?'needs_authority_reconciliation':matches.length!==1?'needs_explicit_entry_mapping':!scope?.sourceIds.includes(trigger.source)||!scope.backendIds.includes(run?.backendId??config.execution.backend)?'target_environment_or_backend_unavailable':run&&run.phase!=='idle'?'execution_requires_reconciliation':records.some(r=>r.kind==='work'&&r.body.ticketId===item.id&&['starting','running'].includes(r.body.state))?'background_work_not_drained':undefined
   item.status=reason?'held':'mapped';item.reason=reason
   if(scope&&matches[0]){
    item.scopeId=scope.id;item.entryId=matches[0].id
    taskOwners.push({ticketId:item.id,tenantId:scope.tenantId,scopeId:scope.id,routerId:'pending',ownerEpoch:1,originEntry:matches[0].id,discussion:a.discussion,requiredSourceIds:[trigger.source],backendId:run?.backendId??config.execution.backend,state:reason?'held':'active',...(reason?{reason}:{})})
   }
  }
  for(const item of items.filter(i=>i.kind==='work')){const work=lookup('work',item.id);let alive=false;if(work.kind==='shell'&&Number.isSafeInteger(work.pid)&&work.pid>0){try{process.kill(work.pid,0);alive=true}catch(error:any){if(error.code!=='ESRCH')alive=true}}if(['starting','running'].includes(work.state)||alive){item.status='held';item.reason='background_work_not_drained'}}
  for(const item of items){
   const value=lookup(item.kind,item.id)
   if(item.kind==='browser-session'&&value.active||item.kind==='browser-receipt'&&['running','uncertain'].includes(value.state)||item.kind==='chat-call'&&value.state==='running'||item.kind==='chat-message'&&value.status==='streaming'){
    item.status='held';item.reason='Reconcile in-flight external effects'
   }
  }
  for(const table of ['jobs','outbox'])for(const r of db.prepare('SELECT * FROM '+table+' ORDER BY id').all()){
   const state=String(r.state??r.status),uncertain=['running','sending','uncertain'].includes(state)
   items.push({kind:table,id:String(r.id),status:uncertain?'held':'unchanged',...(uncertain?{reason:'Reconcile in-flight external effects'}:{})})
  }
  const counts=Object.fromEntries(['mapped','held','conflict','unchanged'].map(s=>[s,items.filter(i=>i.status===s).length]))
  return {protocol:1,operationId:spec.operationId,schema,fingerprint:stableDigest([fingerprint(db),stableDigest(config)]),configFingerprint:stableDigest(config),items,counts,taskOwners,commands:spec.commands,canApply:counts.conflict===0}
 }finally{db.close()}
}
/** Takes the same exclusive lease as Runtime, stages a full copy, then switches while stopped. */
export async function applyScopeMigration(config:Config,spec:unknown,expected:string,options:{onPhase?:(phase:string)=>void;historyReader?:HistoryReader}={}){
 const parsed=specSchema.parse(spec),lock=join(config.stateDir,'host.lock')
 mkdirSync(config.stateDir,{recursive:true,mode:0o700})
 if(existsSync(lock)){
  const pid=Number(readFileSync(lock,'utf8'));if(!Number.isSafeInteger(pid)||pid<=0)throw Error('Invalid host lock; inspect it')
  try{process.kill(pid,0);throw Error('Stop host and supervisor before migration')}catch(e:any){if(e.code!=='ESRCH')throw e}
  unlinkSync(lock)
 }
 const fd=openSync(lock,'wx',0o600);writeFileSync(fd,String(process.pid));closeSync(fd)
 const key=stableDigest(parsed.operationId),folder=join(config.stateDir,'migrations',key),staged=join(folder,'staged.sqlite'),activation=join(config.stateDir,'scope-activation.json')
 try{
  const target=join(config.stateDir,'state.sqlite'),existing=new DatabaseSync(target,{readOnly:true})
  let completed:any
  try{const version=Number(existing.prepare('PRAGMA user_version').get()!.user_version);if(version>MAX_DB_SCHEMA)throw Error('Database is newer than this program');if(version>=6){const r=existing.prepare("SELECT body FROM records WHERE kind='scope-migration' AND id='current'").get();completed=r&&JSON.parse(String(r.body))}}finally{existing.close()}
  if(completed){
   if(completed.operationId!==parsed.operationId||completed.specFingerprint!==stableDigest(parsed))throw Error('Database already migrated by another plan')
   const journal=existsSync(activation)?JSON.parse(readFileSync(activation,'utf8')):{}
   if(journal.operationId===parsed.operationId&&journal.phase==='switching')atomicPrivateFile(activation,JSON.stringify({...journal,phase:completed.phase}))
   return completed
  }
  options.onPhase?.('M2')
  const plan=previewScopeMigration(config,parsed)
  if(plan.fingerprint!==expected)throw Error('Migration preview expired; state changed')
  if(!plan.canApply)throw Error('Unknown or conflicting records block migration')
  if(plan.items.some(i=>i.reason==='execution_requires_reconciliation'||i.reason==='background_work_not_drained'||i.reason==='Reconcile in-flight external effects'))throw Error('Drain execution and reconcile effects before migration')
  if(existsSync(folder)){
   const prior=JSON.parse(readFileSync(join(folder,'plan.json'),'utf8'))
   if(prior.fingerprint!==plan.fingerprint||stableDigest(prior.commands)!==stableDigest(plan.commands))throw Error('Staging belongs to a different migration plan')
   // The live schema-5 state still matches the reviewed preview. Retain the failed
   // attempt for inspection and rebuild from the authoritative source, not partial data.
   renameSync(folder,folder+'.interrupted-'+randomUUID())
  }
  const registry=await SourceRegistry.load(config),identities:any[]=[]
  for(const id of new Set(parsed.commands.filter(c=>c.action==='entry.bind').map(c=>c.sourceId))){const sourceConfig=config.sources.find(s=>s.id===id)!;if(sourceConfig.kind==='local')continue;const source=registry.create(sourceConfig);try{const identity=await source.identity?.();if(identity?.verified!==true)throw Error('Migration source identity cannot be verified');const namespace=sourceConfig.kind+':'+identity.type+':'+identity.id;if(parsed.commands.some(c=>c.action==='entry.bind'&&c.sourceId===id&&c.accountNamespace!==namespace))throw Error('Migration namespace does not match actual connection');identities.push({sourceId:id,namespace,principal:identity.id,provider:sourceConfig.kind,type:identity.type,revision:1,verifiedAt:Date.now()})}finally{await source.close?.()}}
  mkdirSync(folder,{recursive:true,mode:0o700})
  writeFileSync(join(folder,'plan.json'),JSON.stringify(plan,null,2),{mode:0o600})
  const historyDb=new DatabaseSync(target,{readOnly:true})
  try{await backupState(config,join(folder,'before'),{historyReader:options.historyReader??configuredHistoryReader(config,historyDb)})}finally{historyDb.close()}
  verifyBackup(join(folder,'before'));options.onPhase?.('M3')
  const source=new DatabaseSync(target,{readOnly:true});try{await backup(source,staged)}finally{source.close()};chmodSync(staged,0o600)
  const staging=new DatabaseSync(staged);try{staging.exec('PRAGMA user_version='+Math.max(plan.schema,6))}finally{staging.close()}
  const store=new Store(staged)
  let result:any
  try{
   const scopes=new RouterScopes(store,config)
   store.atomic(()=>{
    store.put('scope-migration','current',{phase:'staging'})
    for(const identity of identities)store.put('source-identity',identity.sourceId,identity)
    for(const command of plan.commands)scopes.command(command)
    for(const proposed of plan.taskOwners){
     const owner={...proposed,routerId:scopes.scope(proposed.scopeId).routerId};store.put('task-ownership',owner.ticketId,owner)
     store.put('task-channel',stableDigest([owner.ticketId,owner.originEntry]),{ticketId:owner.ticketId,entryId:owner.originEntry,revision:1,context:true,request:true,result:true,active:true})
    }
    result={operationId:parsed.operationId,specFingerprint:stableDigest(parsed),phase:'verified_paused',revision:1,planFingerprint:plan.fingerprint,counts:plan.counts,held:plan.items.filter(i=>i.status==='held'),previousPaused:store.get('settings','paused')??false,backup:join(folder,'before'),at:Date.now()}
    store.put('maintenance-gap',parsed.operationId,{id:parsed.operationId,startedAt:Date.now(),state:'open',zeroLossVerified:false,cursors:store.db.prepare("SELECT id,body FROM records WHERE kind='source-cursor'").all().map(r=>({key:String(r.id),value:JSON.parse(String(r.body))})),sources:config.sources.filter(s=>s.enabled&&s.capabilities.events).map(s=>({sourceId:s.id,mode:registry.replayCursors(s).length?'cursor_replay':'external_replay_required'})),cursorFingerprint:stableDigest(store.list('source-cursor')),notice:'Cursor replay cannot recover unretained events. Reconcile external event gaps before activation.'});
    store.put('scope-migration','current',result);store.put('settings','paused',true)
   })
   // All original records (except the intentional pause flag), jobs and outbox must remain byte-identical.
   const before=new DatabaseSync(join(folder,'before','state.sqlite'),{readOnly:true})
   try{for(const row of before.prepare('SELECT * FROM records').all()){if(row.kind==='settings'&&row.id==='paused')continue;const current=store.db.prepare('SELECT body FROM records WHERE kind=? AND id=?').get(String(row.kind),String(row.id));if(current?.body!==row.body)throw Error('Migration changed an existing record: '+row.kind+':'+row.id)}for(const table of ['jobs','outbox'])if(stableDigest(before.prepare('SELECT * FROM '+table+' ORDER BY id').all())!==stableDigest(store.db.prepare('SELECT * FROM '+table+' ORDER BY id').all()))throw Error('Migration changed '+table)}finally{before.close()}
   store.db.exec('PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode=DELETE')
  }finally{store.close()}
  const verifiedStage=new DatabaseSync(staged,{readOnly:true})
  let stagedFingerprint:string
  try{stagedFingerprint=fingerprint(verifiedStage)}finally{verifiedStage.close()}
  const journal={operationId:parsed.operationId,sourceSchema:plan.schema,phase:'switching',staged,target,backup:join(folder,'before'),stagedFingerprint,configFingerprint:plan.configFingerprint}
  options.onPhase?.('M4')
  atomicPrivateFile(activation,JSON.stringify(journal))
  const old=new DatabaseSync(target);try{const checkpoint=old.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get();if(Number(checkpoint?.busy??0)!==0)throw Error('Database still has readers')}finally{old.close()}
  for(const suffix of ['-wal','-shm'])if(existsSync(target+suffix))unlinkSync(target+suffix)
  options.onPhase?.('M5.before')
  renameSync(staged,target)
  options.onPhase?.('M5.after')
  atomicPrivateFile(activation,JSON.stringify({...journal,phase:'verified_paused'}))
  options.onPhase?.('M6')
  return result
 }finally{unlinkSync(lock)}
}

/** Offline rollback only before any post-migration state has advanced. Never loses new inputs. */
export async function rollbackScopeMigration(config:Config,operationId:string){
 const lock=join(config.stateDir,'host.lock'),target=join(config.stateDir,'state.sqlite'),activation=join(config.stateDir,'scope-activation.json')
 if(existsSync(lock)){
  const pid=Number(readFileSync(lock,'utf8'));if(!Number.isSafeInteger(pid)||pid<=0)throw Error('Invalid host lock')
  try{process.kill(pid,0);throw Error('Stop host and supervisor before rollback')}catch(e:any){if(e.code!=='ESRCH')throw e}
  unlinkSync(lock)
 }
 const fd=openSync(lock,'wx',0o600);writeFileSync(fd,String(process.pid));closeSync(fd)
 const temporary=join(config.stateDir,'rollback-'+randomUUID()+'.sqlite')
 try{
  const journal=JSON.parse(readFileSync(activation,'utf8'))
  if(journal.operationId!==operationId)throw Error('Migration operation does not match')
  if(journal.phase==='rolled_back')return {operationId,phase:'rolled_back',requiresProgram:'schema-'+(journal.sourceSchema??5)+'-compatible'}
  if(!['switching','verified_paused'].includes(journal.phase)||journal.configFingerprint!==stableDigest(config))throw Error('Rollback requires the unchanged migration configuration')
  const live=new DatabaseSync(target,{readOnly:true})
  try{
   if(fingerprint(live)!==journal.stagedFingerprint)throw Error('State advanced after migration; preserve new inputs and effects with forward repair')
   const row=live.prepare("SELECT body FROM records WHERE kind='scope-migration' AND id='current'").get()
   if(!row||JSON.parse(String(row.body)).phase!=='verified_paused')throw Error('Migration is no longer paused')
  }finally{live.close()}
  if(existsSync(join(config.stateDir,'memory-revocations.jsonl')))throw Error('Memory revocations require forward repair, not a legacy rollback')
  const verified=verifyBackup(journal.backup);if(verified.schema!==(journal.sourceSchema??5))throw Error('Rollback source schema does not match the migration journal')
  await backupState(config,join(config.stateDir,'backups','before-scope-rollback-'+randomUUID()))
  const saved=new DatabaseSync(join(journal.backup,'state.sqlite'),{readOnly:true})
  try{await backup(saved,temporary)}finally{saved.close()}
  chmodSync(temporary,0o600)
  const current=new DatabaseSync(target)
  try{if(Number(current.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get()?.busy??0))throw Error('Database still has readers')}finally{current.close()}
  for(const suffix of ['-wal','-shm'])if(existsSync(target+suffix))unlinkSync(target+suffix)
  renameSync(temporary,target)
  atomicPrivateFile(activation,JSON.stringify({...journal,phase:'rolled_back'}))
  return {operationId,phase:'rolled_back',requiresProgram:'schema-'+(journal.sourceSchema??5)+'-compatible'}
 }finally{if(existsSync(temporary))unlinkSync(temporary);unlinkSync(lock)}
}
