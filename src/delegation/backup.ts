import {existsSync,readFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {join} from 'node:path'
import type {DatabaseSync} from 'node:sqlite'
import {atomicPrivateFile} from '../managed-config.ts'
import {identityFile,readIdentity,publicIdentity,quarantineRestore} from './identity.ts'
import {requireDelegation} from './contract.ts'

export function captureDelegationIdentity(db:DatabaseSync,state:string,destination:string){
 const row=db.prepare("SELECT body FROM records WHERE kind='delegation-identity' AND id='current'").get()
 if(!row)return undefined
 const pinned=JSON.parse(String(row.body)),file=identityFile(state)
 requireDelegation(existsSync(file),'delegation_identity_missing')
 const identity=readIdentity(state)
 requireDelegation(identity.id===pinned.id&&identity.publicKey===pinned.publicKey,'delegation_identity_changed')
 const bytes=readFileSync(file);atomicPrivateFile(identityFile(destination),bytes.toString('utf8'))
 return createHash('sha256').update(bytes).digest('hex')
}
export function verifyDelegationIdentity(db:DatabaseSync,directory:string,hash?:string){
 const row=db.prepare("SELECT body FROM records WHERE kind='delegation-identity' AND id='current'").get()
 if(!row){requireDelegation(!hash,'unexpected_delegation_identity');return}
 requireDelegation(hash&&existsSync(identityFile(directory)),'backup_delegation_identity_missing')
 const bytes=readFileSync(identityFile(directory))
 requireDelegation(createHash('sha256').update(bytes).digest('hex')===hash,'backup_delegation_identity_checksum')
 const identity=publicIdentity(readIdentity(directory)),pinned=JSON.parse(String(row.body))
 requireDelegation(identity.id===pinned.id&&identity.publicKey===pinned.publicKey,'backup_delegation_identity_mismatch')
}
export function prepareDelegationRestore(state:string,directory:string,hash?:string){
 if(!hash)return
 const incoming=readIdentity(directory)
 if(existsSync(identityFile(state))){
  const current=readIdentity(state)
  requireDelegation(current.id===incoming.id&&current.publicKey===incoming.publicKey,'restore_instance_identity_mismatch')
 }
 // The marker is durable before the DB replacement: a failed restore must never start unreviewed service work.
 quarantineRestore(state)
 atomicPrivateFile(identityFile(state),readFileSync(identityFile(directory),'utf8'))
}
