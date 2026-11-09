import {DatabaseSync} from 'node:sqlite'
import {openSync,writeFileSync,closeSync,unlinkSync} from 'node:fs'
import {join} from 'node:path'
import type {Config} from './config.ts'
import {backupState,verifyBackup} from './backup.ts'
import {MAX_DB_SCHEMA} from './store.ts'
import {webhookProtocol} from './webhook-schema.ts'

/** Offline activation shares the host lock. No legacy process can race the backup or activation. */
export async function upgradeWebhooks(config:Config,destination:string){
 const lock=join(config.stateDir,'host.lock')
 const fd=openSync(lock,'wx',0o600);writeFileSync(fd,String(process.pid));closeSync(fd)
 try{
  const before=new DatabaseSync(join(config.stateDir,'state.sqlite'),{readOnly:true})
  let version:number,protocol:1|2
  try{version=Number(before.prepare('PRAGMA user_version').get()!.user_version);if(version<7||version>MAX_DB_SCHEMA)throw Error('Unsupported Webhook migration source');protocol=webhookProtocol(before)}finally{before.close()}
  if(protocol===2)return {protocol:2,changed:false}
  const backup=await backupState(config,destination);verifyBackup(destination)
  const db=new DatabaseSync(join(config.stateDir,'state.sqlite'))
  try{
   db.exec('BEGIN IMMEDIATE')
   if(Number(db.prepare('PRAGMA user_version').get()!.user_version)!==version)throw Error('Schema changed after backup')
   db.prepare("INSERT OR REPLACE INTO records(kind,id,body) VALUES('webhook-protocol','current',?)").run(JSON.stringify({version:2,activatedAt:Date.now(),backupHash:backup.sha256,fromSchema:version}))
   db.exec('PRAGMA user_version='+Math.max(version,9)+'; COMMIT')
  }catch(error){if(db.isTransaction)db.exec('ROLLBACK');throw error}finally{db.close()}
  return {protocol:2,changed:true,backup:backup.directory,backupHash:backup.sha256}
 }finally{unlinkSync(lock)}
}
