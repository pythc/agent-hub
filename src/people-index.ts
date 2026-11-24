import type {EntryBinding,ManagementScope,RouterRoute} from './router-scope.ts'
import type {Runtime} from './runtime.ts'
import {stableDigest} from './sources.ts'

const freshnessMs=5*60_000
const candidateLimit=500
const resultLimit=100

interface NativeProof {triggerId:string;sourceId:string;actorId:string;hash:string;at:number}
interface VerifiedSource {sourceId:string;provider:string;namespace:string;verifiedAt:number}
interface MemberState {available:boolean;actor:string;entryId:string;at:number}
interface Person {
 id:string
 actorId:string
 sourceId:string
 verifiedAt:number
 evidence:'native-entry-activity'
 role?:'scope-manager'
 membership?:'observed-added'
}

/** Operator-only, entry-local observation. Never a directory completeness or authorization signal. */
export function peopleIndex(host:Runtime,entryId:string,actorId?:string){
 const {store,scopes}=host
 const entry=store.get<EntryBinding>('entry-binding',entryId)
 const unavailable={schema:1 as const,availability:'unavailable' as const,people:[] as Person[]}
 if(!entry||entry.history!=='group'||entry.privateActor||!scopes.sourceActive(entry)||store.get<boolean>('settings','paused'))return unavailable
 const scope=store.get<ManagementScope>('management-scope',entry.scopeId)
 const source=host.sources.get(entry.sourceId)?.config
 const identity=store.get<VerifiedSource>('source-identity',entry.sourceId)
 const health=store.get<{status:string;at:number}>('source-health',entry.sourceId)
 const now=Date.now(),settings=host.settings.current(),settingsAt=Date.parse(settings.at),since=Math.max(now-freshnessMs,settingsAt)
 if(!scope||scope.tenantId!==entry.tenantId||!scope.sourceIds.includes(entry.sourceId)||
  !source?.enabled||!source.capabilities.events||!identity||identity.sourceId!==source.id||identity.provider!==source.kind||
  identity.namespace!==entry.accountNamespace||!Number.isSafeInteger(identity.verifiedAt)||identity.verifiedAt>now||
  !Number.isFinite(settingsAt)||settingsAt>now||health?.status!=='ok'||!Number.isSafeInteger(health.at)||health.at<since||health.at>now)return unavailable
 const epoch=scopes.epoch(entry.tenantId)
 // The only input is existing host-recorded native evidence. Exclude a reused
 // account, repointed entry, other route/tenant, or a replay older than this window.
 const rows=store.db.prepare(`
  SELECT p.body AS proof, r.body AS route
  FROM records r JOIN records p ON p.kind='source-native-proof' AND p.id=r.id
  WHERE r.kind='router-route' AND json_extract(r.body,'$.entryId')=?
    AND json_extract(r.body,'$.bindingRevision')=? AND json_extract(r.body,'$.epoch')=?
    AND json_extract(p.body,'$.sourceId')=? AND json_extract(p.body,'$.at') BETWEEN ? AND ?
    AND (? IS NULL OR json_extract(p.body,'$.actorId')=?)
  ORDER BY json_extract(p.body,'$.at') DESC,p.id
  LIMIT ?
 `).all(entry.id,entry.revision,epoch,entry.sourceId,since,now,actorId??null,actorId??null,candidateLimit+1)
 const allowed=new Set(source.allowedActors),bots=new Set(source.allowedBots)
 const withheld=new Set(store.list<{triggers?:string[]}>('history-plan').flatMap(plan=>plan.triggers??[]))
 const people=new Map<string,Person>()
 // Treat this as a short-lived display snapshot, never as enduring authority.
 let expiresAt=Math.min(now+15_000,health.at+freshnessMs)
 for(const row of rows.slice(0,candidateLimit)){
  if(people.size>=resultLimit)break
  const proof=JSON.parse(String(row.proof)) as NativeProof,route=JSON.parse(String(row.route)) as RouterRoute
  if(withheld.has(proof.triggerId)||people.has(proof.actorId)||!allowed.has(proof.actorId)||bots.has(proof.actorId)||
   route.triggerId!==proof.triggerId||route.entryId!==entry.id||route.tenantId!==entry.tenantId||
   route.scopeId!==entry.scopeId||route.routerId!==scope.routerId||route.bindingRevision!==entry.revision||
   route.epoch!==epoch||!Number.isSafeInteger(proof.at)||proof.at<identity.verifiedAt||proof.at>health.at)continue
  const trigger=store.triggers.get(proof.triggerId)
  const member=store.get<MemberState>('source-member-state',stableDigest([entry.id,proof.actorId]))
  if(!trigger?.human||trigger.source!==entry.sourceId||trigger.actor.source!==entry.sourceId||
   trigger.actor.id!==proof.actorId||scopes.nativeId(trigger)!==entry.nativeId||
   scopes.triggerRestriction(trigger)||stableDigest(trigger)!==proof.hash)continue
  const sentAt=Date.parse(trigger.at)
  if(!Number.isFinite(sentAt)||sentAt<since||sentAt>now||sentAt<identity.verifiedAt)continue
  expiresAt=Math.min(expiresAt,proof.at+freshnessMs,sentAt+freshnessMs)
  people.set(proof.actorId,{
   id:stableDigest([entry.tenantId,entry.scopeId,entry.id,entry.sourceId,entry.accountNamespace,proof.actorId]),
   actorId:proof.actorId,sourceId:entry.sourceId,verifiedAt:proof.at,evidence:'native-entry-activity',
   ...(scope.managers.includes(scopes.actor(trigger))?{role:'scope-manager' as const}:{}),
   ...(member?.available===true&&member.entryId===entry.id&&member.actor===proof.actorId&&
    Number.isSafeInteger(member.at)&&member.at>=since&&member.at>=identity.verifiedAt&&member.at<=sentAt?{membership:'observed-added' as const}:{}),
  })
 }
 return {schema:1 as const,availability:'partial' as const,entryId:entry.id,settingsRevision:settings.revision,expiresAt,
  team:{id:scope.id,label:scope.name,kind:'management-scope' as const},observedAt:now,people:[...people.values()],
  truncated:rows.length>candidateLimit||people.size>=resultLimit}
}
