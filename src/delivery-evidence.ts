import {deliveryReceiptSchema,bodyDigest,stableDigest,UncertainDelivery} from './sources.ts'
import type {DeliveryReceipt} from './sources.ts'
import type {Store} from './store.ts'
import type {SourceConfig} from './config.ts'
import type {OutboundMessage} from './vendor/dsh-core/index.ts'

interface RetainedReceipt extends DeliveryReceipt {sourceId:string;revision:number;fingerprint:string;acceptedAt:number}
/** Called only by the host after an already-authorized outbox send. No new sends. */
export function retainDeliveryReceipt(store:Store,message:OutboundMessage,value:unknown,revision:number,fingerprint:string){
 if(value===undefined||value===null)return // Legacy adapters do not return acknowledgements.
 const parsed=deliveryReceiptSchema.safeParse(value)
 if(!parsed.success||parsed.data.messageId!==message.id||parsed.data.thread!==message.channel.thread||parsed.data.contentDigest!==bodyDigest(message.text))throw new UncertainDelivery('Provider acknowledgement is invalid; reconcile destination before retry')
 const receipt:RetainedReceipt={...parsed.data,sourceId:message.channel.source,revision,fingerprint,acceptedAt:Date.now()}
 store.put('delivery-provider-receipt',message.id,receipt)
}
/** Management-only, content-free history. Acknowledgement never means end-to-end passed. */
export function connectorDeliveryEvidence(store:Store,config:SourceConfig,revision:number){
 const blockedBy:('disabled'|'sending_disabled')[]=[]
 if(!config.enabled)blockedBy.push('disabled')
 if(!config.capabilities.replies)blockedBy.push('sending_disabled')
 const deliveries=new Map(store.deliveries().filter(d=>d.channel.source===config.id).map(d=>[d.id,d]))
 const receipts=store.list<RetainedReceipt>('delivery-provider-receipt').flatMap(value=>{
  const parsed=deliveryReceiptSchema.safeParse({providerAccepted:value.providerAccepted,messageId:value.messageId,remoteMessageId:value.remoteMessageId,thread:value.thread,contentDigest:value.contentDigest})
  const message=deliveries.get(value.messageId)
  if(!parsed.success||value.sourceId!==config.id||!message||message.status!=='sent'||message.channel.thread!==value.thread||bodyDigest(message.text)!==value.contentDigest||!Number.isSafeInteger(value.acceptedAt)||value.acceptedAt<0)return []
  return [{messageId:value.messageId,remoteMessageId:value.remoteMessageId,thread:value.thread,acceptedAt:value.acceptedAt,current:value.revision===revision&&value.fingerprint===stableDigest(config),providerAccepted:true as const,observed:false as const}]
 }).sort((a,b)=>b.acceptedAt-a.acceptedAt).slice(0,5)
 return {status:'not_verified' as const,blockedBy,receipts}
}
