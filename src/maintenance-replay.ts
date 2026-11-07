import type {Store} from './store.ts'
import type {SourceConfig} from './config.ts'
import {stableDigest} from './sources.ts'
/** An advancing message cursor proves bounded message replay, not recovery of
 * unretained platform lifecycle events. Keep those gaps explicit. */
export function recordMaintenanceReplay(store:Store,source:SourceConfig){
 for(const gap of store.list<any>('maintenance-gap')){
  if(!gap.resumedAt)continue
  const item=gap.sources.find((s:any)=>s.sourceId===source.id)
  if(!item||item.mode!=='cursor_replay')continue
  const keys=source.kind==='feishu'?(source.feishu?.chats??[]).map(id=>source.id+':'+id):[source.id]
  const unavailable=store.list<any>('thread-health').some(h=>h.source===source.id&&h.consecutiveFailures>0)
  const snapshots=keys.map(key=>({key,before:gap.cursors?.find((c:any)=>c.key===key)?.value,after:store.get<any>('source-cursor',key)}))
  const time=(v:any)=>{const since=v?.since;return typeof since==='string'&&/^\d+$/.test(since)?Number(since)*1000:Date.parse(since)}
  const hasStart=!!keys.length&&snapshots.every(s=>Number.isFinite(time(s.before)))
  const advanced=hasStart&&snapshots.every(s=>Number.isFinite(time(s.after))&&time(s.after)>=Math.floor(gap.resumedAt/1000)*1000-2000&&time(s.after)>=time(s.before))
  const status=unavailable?'partial':!hasStart?'missing_prior_cursor':advanced?'messages_replayed':'pending'
  const next={...item,status,checkedAt:Date.now(),cursorFingerprint:stableDigest(snapshots),unrecoverable:['unretained_platform_events']}
  store.put('maintenance-gap',gap.id,{...gap,state:'partial',sources:gap.sources.map((s:any)=>s.sourceId===source.id?next:s),zeroLossVerified:false})
 }
}
