import {createHash} from 'node:crypto'
import type {Runtime} from './runtime.ts'
import {isApiBackend,type BackendDefinition} from './backend-config.ts'

export interface ConnectionCheck {
 ok:boolean;remoteVerified:boolean;preview:boolean
 checks:{id:string;status:'ok'|'required'|'pending';code:string;detail?:string}[]
}
interface CheckRecord {fingerprint:string;at:number;result:ConnectionCheck}

// Private digest: changing credentials, a CLI profile, or a subscription session
// must invalidate old success. Neither values nor their digest enter the UI.
function fingerprint(host:Runtime,definition:BackendDefinition){
 const {label,...config}=definition
 const env=isApiBackend(definition)?[definition.apiKeyEnv,...Object.values(definition.headerEnv??{})]:Object.values(definition.env??{})
 const subscription=isApiBackend(definition)&&definition.subscription
 return createHash('sha256').update(JSON.stringify({config,codex:host.config.codex,model:host.config.model,
  env:env.map(key=>key?process.env[key]:undefined),account:subscription?host.subscriptions.list().find(a=>a.id===subscription.account):undefined})).digest('hex')
}
export function recordConnectionCheck(host:Runtime,id:string,definition:BackendDefinition,result:ConnectionCheck){
 if(result.preview)return
 host.store.put('connection-check',id,{fingerprint:fingerprint(host,definition),at:Date.now(),result} satisfies CheckRecord)
}
export function connectionChecks(host:Runtime){
 return Object.fromEntries(Object.entries({codex:{kind:'codex' as const},...host.config.backends}).flatMap(([id,definition])=>{
  const record=host.store.get<CheckRecord>('connection-check',id)
  return record&&record.fingerprint===fingerprint(host,definition)?[[id,{at:record.at,...record.result}]]:[]
 }))
}
/** An unambiguous local principal may be selected automatically, never an arbitrary external actor. */
export function subscriptionOwners(host:Runtime){
 const choices=host.config.sources.filter(s=>s.enabled).flatMap(s=>s.allowedActors.map(actor=>({source:s.id,actor,label:(s.label??s.id)+' · '+actor,local:s.kind==='local'})))
 const local=choices.filter(c=>c.local)
 return {choices,defaultOwner:local.length===1?{source:local[0]!.source,actor:local[0]!.actor}:undefined}
}
