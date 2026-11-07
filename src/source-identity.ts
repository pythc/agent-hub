import {randomBytes} from 'node:crypto'
import {z} from 'zod'
import type {Source} from './sources.ts'
import {stableDigest} from './sources.ts'
import type {RouterScopes} from './router-scope.ts'
import type {Store} from './store.ts'
import type {Trigger} from './vendor/dsh-core/index.ts'
const id=z.string().min(1).max(300),base={operationId:id,expectedRevision:z.number().int().min(0)}
export const identityCommandSchema=z.discriminatedUnion('action',[
 z.object({action:z.literal('source.verify'),...base,sourceId:id}).strict(),
 z.object({action:z.literal('identity.challenge'),...base,actors:z.array(z.object({sourceId:id,actorId:id,entryId:id}).strict()).length(2)}).strict(),
 z.object({action:z.literal('identity.link'),...base,challengeId:id,triggerIds:z.array(id).length(2)}).strict(),
 z.object({action:z.literal('identity.unlink'),...base,id}).strict(),
])
/** Identity links describe verified equivalence only. Authorization always retains
 * its source-qualified actor and must be granted separately. */
export class SourceIdentities {
 constructor(private store:Store,private scopes:RouterScopes,private sources:Map<string,Source>){}
 async command(value:unknown){
  const x=identityCommandSchema.parse(value),key=stableDigest(['identity',x.operationId]),fingerprint=stableDigest(x),receipt=this.store.get<any>('identity-receipt',key)
  if(receipt){if(receipt.fingerprint!==fingerprint)throw Error('operationId reused with different content');return receipt.result}
  if(x.action==='source.verify'){
   const source=this.sources.get(x.sourceId);if(!source?.identity||!source.config.enabled)throw Error('Source has no enabled identity verifier')
   const identity=await source.identity()
   if(identity.verified!==true||!identity.id)throw Error('Connector cannot verify its account identity')
   const namespace=source.config.kind+':'+identity.type+':'+identity.id,old=this.store.get<any>('source-identity',x.sourceId)
   if((old?.revision??0)!==x.expectedRevision)throw Error('Identity revision conflict')
   if(old&&old.namespace!==namespace)throw Error('Connection account changed; create a new source identity')
   const result={sourceId:x.sourceId,namespace,provider:source.config.kind,principal:identity.id,type:identity.type,revision:(old?.revision??0)+1,verifiedAt:Date.now()}
   this.store.atomic(()=>{const current=this.store.get<any>('source-identity',x.sourceId);if((current?.revision??0)!==x.expectedRevision)throw Error('Identity changed during verification');this.store.put('source-identity',x.sourceId,result);this.store.put('identity-receipt',key,{fingerprint,result})});return result
  }
  return this.store.atomic(()=>{
   let result:any
   if(x.action==='identity.challenge'){
    if(x.expectedRevision!==0||new Set(x.actors.map(a=>JSON.stringify([a.sourceId,a.actorId]))).size!==2)throw Error('Two distinct qualified actors required')
    const entries=x.actors.map(a=>{const e=this.scopes.binding(a.entryId);if(e.sourceId!==a.sourceId||!this.scopes.sourceActive(e)||!this.store.get('source-identity',a.sourceId))throw Error('Verified active source and entry required');return e})
    if(entries[0]!.tenantId!==entries[1]!.tenantId)throw Error('Identity links cannot span tenants')
    const challengeId='link-'+randomBytes(16).toString('hex'),token=randomBytes(24).toString('base64url')
    result={id:challengeId,revision:1,actors:x.actors,tenantId:entries[0]!.tenantId,createdAt:Date.now(),expiresAt:Date.now()+600000,command:'/agenthub-link '+token,state:'pending'}
    this.store.put('identity-challenge',challengeId,result)
   }else if(x.action==='identity.link'){
    const challenge=this.store.get<any>('identity-challenge',x.challengeId)
    if(!challenge||challenge.revision!==x.expectedRevision||challenge.state!=='pending'||challenge.expiresAt<Date.now())throw Error('Identity challenge expired or consumed')
    for(const a of challenge.actors){
     const match=x.triggerIds.map(id=>this.store.triggers.get(id)).find(t=>!!t&&t.source===a.sourceId&&t.actor.id===a.actorId)
     const proof=match&&this.store.get<any>('source-native-proof',match.id)
     if(!match?.human||!proof||proof.hash!==stableDigest(match)||proof.at<challenge.createdAt||Date.parse(match.at)<challenge.createdAt||this.scopes.entry(match)?.id!==a.entryId||match.text.trim()!==challenge.command)throw Error('Both accounts must send the challenge through their verified native entry')
     this.scopes.assertTrigger(match)
    }
    result={id:challenge.id,tenantId:challenge.tenantId,actors:challenge.actors,revision:1,active:true,triggerIds:x.triggerIds,at:Date.now(),authority:'unchanged'}
    this.store.put('identity-link',result.id,result);this.store.put('identity-challenge',challenge.id,{...challenge,state:'consumed',revision:challenge.revision+1})
   }else{
    const old=this.store.get<any>('identity-link',x.id);if(!old||old.revision!==x.expectedRevision)throw Error('Identity link revision conflict')
    result={...old,active:false,revision:old.revision+1};this.store.put('identity-link',old.id,result)
   }
   this.store.put('identity-receipt',key,{fingerprint,result});return result
  })
 }
 recordNative(trigger:Trigger){this.store.put('source-native-proof',trigger.id,{triggerId:trigger.id,sourceId:trigger.source,actorId:trigger.actor.id,hash:stableDigest(trigger),at:Date.now()})}
}
