import {captureMarketPackages,verifyMarketPackages,restoreMarketPackages} from './plugin-market-backup.ts'
import {exportHistoryIndex,verifyHistoryIndex,type HistoryReader} from './history-backup.ts'
import {DatabaseSync,backup} from 'node:sqlite'
import {mkdirSync,writeFileSync,readFileSync,existsSync,copyFileSync,unlinkSync,chmodSync,openSync,closeSync,renameSync} from 'node:fs'
import {join,resolve} from 'node:path'
import {createHash,randomUUID} from 'node:crypto'
import {readRevocations} from './router-memory.ts'
import {configSchema,type Config} from './config.ts'
import {managedFiles,recoverManagedFiles,prepareManagedFiles,validateManagedSnapshot,atomicPrivateFile} from './managed-config.ts'
const hash=(path:string)=>createHash('sha256').update(readFileSync(path)).digest('hex')
const digest=(text:string)=>createHash('sha256').update(text).digest('hex')
function captureManaged(state:string){const files=managedFiles(state);if(existsSync(files.journal))throw Error('Setup is changing; retry backup after configuration recovery');return {connections:existsSync(files.connections)?readFileSync(files.connections,'utf8'):undefined,secrets:existsSync(files.secrets)?readFileSync(files.secrets,'utf8'):undefined}}
function checkManaged(db:DatabaseSync,files:{connections?:string;secrets?:string},fallback?:Config){
 const current=db.prepare("SELECT body FROM records WHERE kind='settings' AND id='current'").get(),config=current?JSON.parse(String(current.body)).config:fallback
 if(!config){if(files.connections||files.secrets)throw Error('Managed backup has no matching configuration');return fallback}
 const parsed=configSchema.parse(config),overlay=validateManagedSnapshot(parsed,files.connections,files.secrets)
 for(const row of db.prepare("SELECT body FROM records WHERE kind='onboarding-deployment'").all()){
  const source=JSON.parse(String(row.body)).receipt?.sourceId
  if(source&&!overlay.sources.some(s=>s.id===source))throw Error('Backup is missing a managed workspace')
 }
 return parsed
}
function backupManaged(directory:string,manifest:any){
 const result:{connections?:string;secrets?:string}={}
 if(manifest.managed&&Object.keys(manifest.managed).some(k=>!['connections','secrets'].includes(k)))throw Error('Unsupported managed backup file')
 for(const name of ['connections','secrets'] as const)if(manifest.managed?.[name]){
  const file=join(directory,'setup',name==='connections'?'connections.json':'credentials.json')
  if(!existsSync(file)||hash(file)!==manifest.managed[name])throw Error('Managed backup checksum mismatch')
  result[name]=readFileSync(file,'utf8')
 }
 return result
}
/** SQLite's backup API snapshots WAL and committed records without copying live database files. */
export async function backupState(config:Config,destination:string,options:{historyReader?:HistoryReader}={}){
 const directory=resolve(destination)
 if(existsSync(directory))throw Error('Backup destination already exists')
 mkdirSync(directory,{recursive:true,mode:0o700})
 const managed=captureManaged(config.stateDir)
 const db=new DatabaseSync(join(config.stateDir,'state.sqlite'),{readOnly:true})
 const target=join(directory,'state.sqlite')
 let schema:number
 try{schema=Number(db.prepare('PRAGMA user_version').get()!.user_version);await backup(db,target)}finally{db.close()}
 chmodSync(target,0o600)
 const after=captureManaged(config.stateDir);if(JSON.stringify(managed)!==JSON.stringify(after))throw Error('Setup changed during backup; retry backup')
 const snapshot=new DatabaseSync(target,{readOnly:true});let effective:Config|undefined,history:Awaited<ReturnType<typeof exportHistoryIndex>>
 try{effective=checkManaged(snapshot,managed,config);captureMarketPackages(snapshot,config.stateDir,directory);history=await exportHistoryIndex(snapshot,directory,options.historyReader)}finally{snapshot.close()}
 const hashes:Record<string,string>={}
 for(const name of ['connections','secrets'] as const)if(managed[name]!==undefined){atomicPrivateFile(join(directory,'setup',name==='connections'?'connections.json':'credentials.json'),managed[name]!);hashes[name]=digest(managed[name]!)}
 const ledger=readRevocations(config.stateDir);if(ledger.length)atomicPrivateFile(join(directory,'memory-revocations.jsonl'),ledger.map(r=>JSON.stringify(r)).join('\n')+'\n')
 const manifest={format:1,history,application:'0.10.0',...(ledger.length?{revocations:hash(join(directory,'memory-revocations.jsonl'))}:{}),schema,at:new Date().toISOString(),sha256:hash(target),...(Object.keys(hashes).length?{managed:hashes}:{})}
 writeFileSync(join(directory,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{mode:0o600})
 writeFileSync(join(directory,'config.json'),JSON.stringify(effective??config,null,2)+'\n',{mode:0o600})
 return {directory,...manifest}
}
export function verifyBackup(directory:string){
 const manifest=JSON.parse(readFileSync(join(directory,'manifest.json'),'utf8'))
 if(manifest.format!==1||![1,2,3,4,5,6,7].includes(manifest.schema))throw Error('Unsupported backup format or schema')
 const path=join(directory,'state.sqlite')
 if(hash(path)!==manifest.sha256)throw Error('Backup checksum mismatch')
 const db=new DatabaseSync(path,{readOnly:true})
 try{
  if(Number(db.prepare('PRAGMA user_version').get()!.user_version)!==manifest.schema||db.prepare('PRAGMA integrity_check').get()!.integrity_check!=='ok')throw Error('Backup failed SQLite verification')
  checkManaged(db,backupManaged(directory,manifest));verifyMarketPackages(db,directory)
  if(manifest.history)verifyHistoryIndex(directory,manifest.history)
  const head=db.prepare("SELECT body FROM records WHERE kind='memory-revocation-head' AND id='current'").get()
  if(manifest.revocations&&hash(join(directory,'memory-revocations.jsonl'))!==manifest.revocations)throw Error('Revocation ledger checksum mismatch')
  const ledger=readRevocations(directory),required=head&&JSON.parse(String(head.body))
  if(required&&!ledger.some(r=>r.seq===required.seq&&r.hash===required.hash))throw Error('Backup is missing its revocation ledger')
 }finally{db.close()}
 return manifest
}
/** Offline-only restore. Existing state is retained as a verified backup before replacement. */
export async function restoreState(config:Config,directory:string){
 const lock=join(config.stateDir,'host.lock')
 mkdirSync(config.stateDir,{recursive:true,mode:0o700})
 if(existsSync(lock)){
  const pid=Number(readFileSync(lock,'utf8'))
  if(!Number.isSafeInteger(pid)||pid<=0)throw Error('Invalid host lock; inspect before restoring')
  try{process.kill(pid,0);throw Error('Stop the host and supervisor before restoring')}
  catch(error:any){if(error.code!=='ESRCH')throw error}
  unlinkSync(lock)
 }
 const descriptor=openSync(lock,'wx',0o600)
 writeFileSync(descriptor,String(process.pid));closeSync(descriptor)
 const temporary=join(config.stateDir,'restore-'+process.pid+'.sqlite')
 try{
  const verified=verifyBackup(directory)
  const packageDB=new DatabaseSync(join(directory,'state.sqlite'),{readOnly:true})
  try{restoreMarketPackages(packageDB,directory,config.stateDir)}finally{packageDB.close()}
  recoverManagedFiles(config.stateDir)
  const currentPath=join(config.stateDir,'state.sqlite')
  const ledger=readRevocations(config.stateDir),incoming=readRevocations(directory)
  if(ledger.some((r,i)=>incoming[i]&&incoming[i]!.hash!==r.hash))throw Error('Revocation histories conflict; offline reconciliation required')
  if(existsSync(currentPath)){
   const live=new DatabaseSync(currentPath,{readOnly:true}),old=new DatabaseSync(join(directory,'state.sqlite'),{readOnly:true})
   try{
    if(Number(live.prepare('PRAGMA user_version').get()!.user_version)>=6&&verified.schema<6)throw Error('Online downgrade cannot represent Router scopes; use forward repair or a reviewed offline rollback')
    const head=live.prepare("SELECT body FROM records WHERE kind='memory-revocation-head' AND id='current'").get(),required=head&&JSON.parse(String(head.body))
    if(required&&!ledger.some(r=>r.seq===required.seq&&r.hash===required.hash))throw Error('Latest revocation ledger is missing')
    for(const row of live.prepare("SELECT kind,id,body FROM records WHERE kind IN ('ticket','run','model-session','task-ownership','entry-binding')").all()){
     const previous=old.prepare('SELECT body FROM records WHERE kind=? AND id=?').get(String(row.kind),String(row.id))
     if(!previous||previous.body!==row.body)throw Error('Task, native thread or ownership advanced after backup; reconcile before restore')
    }
    // External calls can finish without changing the task. Their intent/result
    // receipts are the replay fence, including running and uncertain outcomes.
    for(const row of live.prepare("SELECT kind,id,body FROM records WHERE kind IN ('tool-receipt','browser-receipt','merge-attempt','backend-plugin-tool')").all()){
     const previous=old.prepare('SELECT body FROM records WHERE kind=? AND id=?').get(String(row.kind),String(row.id))
     if(!previous||previous.body!==row.body)throw Error('External tool or merge effects advanced after backup; reconcile before restore')
    }
    for(const row of live.prepare("SELECT id,body,status FROM outbox WHERE status IN ('sent','sending','uncertain')").all()){
     const previous=old.prepare('SELECT body,status FROM outbox WHERE id=?').get(String(row.id))
     if(!previous||previous.body!==row.body||previous.status!==row.status)throw Error('External effects advanced after backup; reconcile before restore')
    }
   }finally{live.close();old.close()}
  }
  if(incoming.length>ledger.length)atomicPrivateFile(join(config.stateDir,'memory-revocations.jsonl'),incoming.map(r=>JSON.stringify(r)).join('\n')+'\n')
  const previous=join(config.stateDir,'backups','before-restore-'+Date.now())
  if(existsSync(join(config.stateDir,'state.sqlite')))await backupState(config,previous)
  const target=join(config.stateDir,'state.sqlite')
  if(existsSync(target)){
   const current=new DatabaseSync(target)
   try{const row=current.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get();if(Number(row?.busy??0)!==0)throw Error('Close database readers before restoring')}finally{current.close()}
  }
  copyFileSync(join(directory,'state.sqlite'),temporary);chmodSync(temporary,0o600)
  const id='restore-'+randomUUID(),db=new DatabaseSync(temporary)
  try{db.exec('PRAGMA journal_mode=DELETE');db.prepare('INSERT INTO records VALUES(?,?,?)').run('restore-commit',id,'{}')}finally{db.close()}
  const files=prepareManagedFiles(config.stateDir,id,{...backupManaged(directory,verified),restore:true})
  let replaced=false
  try{
   for(const suffix of ['-wal','-shm'])if(existsSync(target+suffix))unlinkSync(target+suffix)
   renameSync(temporary,target);replaced=true;files.finish()
  }catch(error){if(!replaced)files.rollback();throw error}
  return {restored:true,previous,manifest:verified}
 }finally{
  if(existsSync(temporary))unlinkSync(temporary)
  unlinkSync(lock)
 }
}
