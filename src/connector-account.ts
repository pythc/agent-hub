import type {Store} from './store.ts'
import type {SourceConfig} from './config.ts'

export interface ConnectorAccountObservation {id:string;type:string;verified?:boolean}
interface PinnedAccount {namespace:string}
interface AccountFence {sourceId:string;state:'quarantined';reason:'verified_account_changed';at:number}

export const accountNamespace=(provider:string,identity:ConnectorAccountObservation)=>provider+':'+identity.type+':'+identity.id
export function accountFence(store:Store|undefined,sourceId:string){
 return store?.get<AccountFence>('source-account-fence',sourceId)
}

/** Mismatch is sticky: a source ID owns persisted history, cursors and approvals.
 * A different provider principal must use a new ID, even if the old credential is restored. */
export function pinObservedAccount(store:Store,source:SourceConfig,identity:ConnectorAccountObservation|undefined){
 const expected=store.get<PinnedAccount>('source-identity',source.id)
 if(accountFence(store,source.id))throw Error('Connector account changed; configure a separately bound source')
 if(!identity||identity.verified!==true||typeof identity.id!=='string'||!identity.id||
    typeof identity.type!=='string'||!identity.type)throw Error('Connector cannot verify its account identity')
 const namespace=accountNamespace(source.kind,identity)
 if(expected&&expected.namespace!==namespace){
  store.atomic(()=>{
   if(accountFence(store,source.id))return
   const fence:AccountFence={sourceId:source.id,state:'quarantined',reason:'verified_account_changed',at:Date.now()}
   store.put('source-account-fence',source.id,fence)
   store.audit({type:'connector.account-quarantined',sourceId:source.id})
  })
  throw Error('Connector account changed; configure a separately bound source')
 }
 // An unbound source must not become verified against an unintended configured workspace.
 const workspace=source.kind==='slack'?source.options?.teamId:source.kind==='linear'?source.options?.workspaceId:undefined
 if(workspace!==undefined&&(typeof workspace!=='string'||!workspace||identity.id.split(':',1)[0]!==workspace))
  throw Error('Connector identity does not match the configured workspace')
 return namespace
}
