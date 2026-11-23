import {matchesArtifactRegistration,operatorArtifactRegistration,type ArtifactRegistration} from './artifact-registry.ts'
import {randomUUID} from 'node:crypto'
import type {Runtime} from './runtime.ts'
import type {ArtifactReference,ArtifactRegistrationState,WorkspaceViewArtifactReference} from './artifact-reference.ts'
import {enabledView,viewArtifactReference} from './workspace-view-package.ts'
import type {ManagedMarketState} from './plugin-market-state.ts'

export type RetainedViewLink={version:string;packageVersion:string}
type OperatorRegistration=Extract<ArtifactRegistration,{domain:'operator_workspace'}>
type InstalledView=ManagedMarketState['installed'][number]

/** Read-only lookup: a retained-object link points to the existing, independent resolver. */
function viewArtifactLinkHistory(row:InstalledView|undefined,current:string):RetainedViewLink[]{
 if(!row?.enabled||row.active?.digest!==current)return []
 const seen=new Set([current])
 const links:RetainedViewLink[]=[]
 for(const release of [row.previous,row.selected,row.active]){
  if(!release||seen.has(release.digest)||!row.viewPromotions?.some(v=>v.registration?.kind==='workspace-view'&&v.registration.id===row.id&&v.registration.version===release.digest))continue
  if(!/^[a-f0-9]{64}$/.test(release.digest))continue
  seen.add(release.digest);links.push({version:release.digest,packageVersion:release.version})
 }
 return links
}
function viewRegistrationState(row:InstalledView|undefined,reference:WorkspaceViewArtifactReference):ArtifactRegistrationState{
 const expected=operatorArtifactRegistration(reference)
 return row?.viewPromotions?.some(v=>matchesArtifactRegistration(v.registration,expected))?'recorded':'source_only'
}
function installedViews(host:Runtime){
 const row=host.store.db.prepare("SELECT body FROM records WHERE kind='plugin-market' AND id='current'").get()
 const market=row?JSON.parse(String(row.body)) as ManagedMarketState:undefined
 return new Map((market?.installed??[]).filter(item=>item.category==='workspace-view').map(item=>[item.id,item]))
}
export function exactViewRegistrationState(host:Runtime,reference:WorkspaceViewArtifactReference){
 return viewRegistrationState(installedViews(host).get(reference.id),reference)
}
export type ArtifactCatalogEntry={reference:ArtifactReference|WorkspaceViewArtifactReference;label:{en:string;'zh-CN':string};registration?:OperatorRegistration;registrationState?:ArtifactRegistrationState;previousVersions?:RetainedViewLink[]}
export interface ArtifactCatalog {schema:1;items:ArtifactCatalogEntry[];truncated:boolean;nextCursor:string|null}
type Position={kind:'goal'|'view';after:string}
type Cursor={position:Position;expires:number}
// Process-local, workspace-bound, bounded continuation state; never object authority or persistence.
const cursors=new WeakMap<Runtime,Map<string,Cursor>>()
const pageSize=100,scanSize=200,cursorLimit=256,cursorLifetime=10*60*1000
export class ArtifactCatalogCursorError extends Error {}
function cursorState(host:Runtime){let state=cursors.get(host);if(!state){state=new Map();cursors.set(host,state)};for(const [key,value]of state)if(value.expires<=Date.now())state.delete(key);return state}
/** Each page rechecks current access. Inserts, cleanup and configuration changes are not a snapshot. */
export function artifactCatalog(host:Runtime,cursor?:string):ArtifactCatalog {
 const state=cursorState(host)
 let position:Position={kind:'goal',after:''}
 if(cursor!==undefined){const saved=state.get(cursor);if(!saved)throw new ArtifactCatalogCursorError('catalog_cursor_expired');position=saved.position}
 const items:ArtifactCatalogEntry[]=[]
 const finish=(next:Position|null):ArtifactCatalog=>{
  let nextCursor:string|null=null
  if(next){while(state.size>=cursorLimit)state.delete(state.keys().next().value!);nextCursor=randomUUID();state.set(nextCursor,{position:next,expires:Date.now()+cursorLifetime})}
  return {schema:1,items,truncated:nextCursor!==null,nextCursor}
 }
 if(position.kind==='goal'){
  // Indexed keyset scan: never materialize all records or use an inaccessible ID as a public cursor.
  const rows=host.store.db.prepare("SELECT id FROM records WHERE kind='goal-artifact' AND id>? ORDER BY id LIMIT ?").all(position.after,scanSize+1) as {id:string}[]
  for(const row of rows.slice(0,scanSize)){
   position={kind:'goal',after:row.id}
   try{const reference=host.artifacts.describe(row.id);items.push({reference,registration:operatorArtifactRegistration(reference),...(reference.registrationState?{registrationState:reference.registrationState}:{}),label:{en:reference.name,'zh-CN':reference.name}})}catch{}
   if(items.length===pageSize)return finish(position)
  }
  if(rows.length>scanSize)return finish(position)
  position={kind:'view',after:''}
 }
 // Config is already in memory. Only this bounded page's packages are read/verified.
 const installed=installedViews(host)
 const refs=host.config.viewPlugins.filter(ref=>ref.enabled&&ref.id>position.after).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0)
 for(const ref of refs.slice(0,scanSize)){
  position={kind:'view',after:ref.id}
  try{
   const pkg=enabledView(host.config,ref.id),reference=viewArtifactReference(pkg),row=installed.get(ref.id)
   const registrationState=viewRegistrationState(row,reference),previousVersions=viewArtifactLinkHistory(row,reference.version)
   items.push({reference,registration:operatorArtifactRegistration(reference),...(registrationState==='recorded'?{registrationState}:{}),...(previousVersions.length?{previousVersions}:{}),label:pkg.manifest.label})
  }catch{}
  if(items.length===pageSize)return finish(position)
 }
 return finish(refs.length>scanSize?position:null)
}
