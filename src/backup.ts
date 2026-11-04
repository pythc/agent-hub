import {DatabaseSync,backup} from 'node:sqlite'
import {mkdirSync,writeFileSync,readFileSync,existsSync,copyFileSync,unlinkSync,chmodSync,openSync,closeSync,renameSync} from 'node:fs'
import {join,resolve} from 'node:path'
import {createHash} from 'node:crypto'
import type {Config} from './config.ts'
const hash=(path:string)=>createHash('sha256').update(readFileSync(path)).digest('hex')
/** SQLite's backup API snapshots WAL and committed records without copying live database files. */
export async function backupState(config:Config,destination:string){
 const directory=resolve(destination)
 if(existsSync(directory))throw Error('Backup destination already exists')
 mkdirSync(directory,{recursive:true,mode:0o700})
 const db=new DatabaseSync(join(config.stateDir,'state.sqlite'),{readOnly:true})
 const target=join(directory,'state.sqlite')
 let schema:number
 try{schema=Number(db.prepare('PRAGMA user_version').get()!.user_version);await backup(db,target)}finally{db.close()}
 chmodSync(target,0o600)
 const manifest={format:1,application:'0.5.0',schema,at:new Date().toISOString(),sha256:hash(target)}
 writeFileSync(join(directory,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{mode:0o600})
 writeFileSync(join(directory,'config.json'),JSON.stringify(config,null,2)+'\n',{mode:0o600})
 return {directory,...manifest}
}
export function verifyBackup(directory:string){
 const manifest=JSON.parse(readFileSync(join(directory,'manifest.json'),'utf8'))
 if(manifest.format!==1||![1,2].includes(manifest.schema))throw Error('Unsupported backup format or schema')
 const path=join(directory,'state.sqlite')
 if(hash(path)!==manifest.sha256)throw Error('Backup checksum mismatch')
 const db=new DatabaseSync(path,{readOnly:true})
 try{
  if(Number(db.prepare('PRAGMA user_version').get()!.user_version)!==manifest.schema||db.prepare('PRAGMA integrity_check').get()!.integrity_check!=='ok')throw Error('Backup failed SQLite verification')
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
  const previous=join(config.stateDir,'backups','before-restore-'+Date.now())
  if(existsSync(join(config.stateDir,'state.sqlite')))await backupState(config,previous)
  const target=join(config.stateDir,'state.sqlite')
  copyFileSync(join(directory,'state.sqlite'),temporary);chmodSync(temporary,0o600)
  for(const suffix of ['-wal','-shm'])if(existsSync(target+suffix))unlinkSync(target+suffix)
  renameSync(temporary,target)
  return {restored:true,previous,manifest:verified}
 }finally{
  if(existsSync(temporary))unlinkSync(temporary)
  unlinkSync(lock)
 }
}
