import {generateKeyPairSync,createPublicKey,sign,verify,randomUUID} from 'node:crypto'
import {existsSync,lstatSync,readFileSync,writeFileSync,chmodSync} from 'node:fs'
import {join} from 'node:path'
import {z} from 'zod'
import {atomicPrivateFile} from '../managed-config.ts'
import {stableDigest} from '../sources.ts'
import {delegationId,requireDelegation} from './contract.ts'

const identitySchema=z.object({version:z.literal(1),id:delegationId,publicKey:z.string().max(1000),privateKey:z.string().max(2000)}).strict()
export type InstanceIdentity=z.infer<typeof identitySchema>
export const publicIdentitySchema=identitySchema.omit({privateKey:true})
export type PublicIdentity=z.infer<typeof publicIdentitySchema>
export const identityFile=(state:string)=>join(state,'delegation-identity.json')
export function readIdentity(state:string):InstanceIdentity {
 const file=identityFile(state)
 if(existsSync(file)){
  requireDelegation(lstatSync(file).isFile()&&!lstatSync(file).isSymbolicLink(),'invalid_identity_file')
  const value=identitySchema.parse(JSON.parse(readFileSync(file,'utf8')))
  requireDelegation(createPublicKey(value.privateKey).export({type:'spki',format:'pem'}).toString()===value.publicKey,'identity_key_mismatch')
  chmodSync(file,0o600);return value
 }
 const pair=generateKeyPairSync('ed25519'),value:InstanceIdentity={version:1,id:randomUUID(),publicKey:pair.publicKey.export({format:'pem',type:'spki'}).toString(),privateKey:pair.privateKey.export({format:'pem',type:'pkcs8'}).toString()}
 writeFileSync(file,JSON.stringify(value)+'\n',{mode:0o600,flag:'wx'});return value
}
export const publicIdentity=(i:InstanceIdentity):PublicIdentity=>({version:1,id:i.id,publicKey:i.publicKey})
export function signature(i:InstanceIdentity,value:unknown){return sign(null,Buffer.from(stableDigest(value)),i.privateKey).toString('base64')}
export function verifies(i:PublicIdentity,value:unknown,sig:string){
 try{return verify(null,Buffer.from(stableDigest(value)),i.publicKey,Buffer.from(sig,'base64'))}catch{return false}
}
export const packetSchema=z.object({
 version:z.literal(1),issuer:delegationId,target:delegationId,nonce:z.string().uuid(),
 at:z.number().int().positive(),operation:z.string().min(1).max(100),body:z.unknown(),signature:z.string().max(200),
}).strict()
export type Packet=z.infer<typeof packetSchema>
export function packet(i:InstanceIdentity,target:string,operation:string,body:unknown):Packet {
 const value={version:1 as const,issuer:i.id,target,nonce:randomUUID(),at:Date.now(),operation,body}
 return {...value,signature:signature(i,value)}
}
export function validatePacket(value:unknown,identity:PublicIdentity,target:string):Packet {
 const p=packetSchema.parse(value),{signature:sig,...body}=p
 requireDelegation(p.issuer===identity.id&&p.target===target&&Math.abs(Date.now()-p.at)<=30000&&verifies(identity,body,sig),'invalid_service_identity',401)
 return p
}
export function validateEndpoint(value:string){
 const u=new URL(value)
 requireDelegation(u.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(u.hostname)&&!u.username&&!u.password&&u.pathname==='/'&&!u.search&&!u.hash,'p1_requires_loopback_origin')
 return u.origin
}
export function quarantineRestore(state:string){atomicPrivateFile(join(state,'delegation-restored.json'),JSON.stringify({version:1,at:Date.now()})+'\n')}
