import type {MemoryProjection} from './router-memory.ts'
import type {ScopeContext} from './router-scope.ts'

export type PreferenceDecision = 'applied'|'condition_unmatched'|'explicit_preferred'|'narrower_preferred'|'ambiguous'|'equivalent'
const fold = (value:string) => value.normalize('NFKC').trim().replace(/\s+/gu,' ').toLowerCase()
export const preferenceCondition = (phrase:string) => 'request contains: '+phrase.trim()
export function isPreferenceException(f:Pick<MemoryProjection,'kind'|'learning'|'expiresAt'>) {
 return f.kind==='preference' && (f.expiresAt!==undefined || !!f.learning?.discussion || !!f.learning?.condition?.trim())
}
const inferred = (f:MemoryProjection) => !f.protected&&f.learning?.inferred===true
const specificity = (f:MemoryProjection) =>
 (f.visibility==='task'?8:0)+(f.learning?.discussion?4:0)+(f.learning?.condition?.trim()?2:0)+(f.expiresAt!==undefined?1:0)

/** Call only with authorized projections; never use foreign IDs to explain a conflict. */
export function resolvePreferences(items:MemoryProjection[], c:ScopeContext, now:number) {
 const decisions=new Map<string,PreferenceDecision>(), topics=new Map<string,MemoryProjection[]>()
 const request=fold(c.trigger.text)
 for(const f of items) {
  if(f.kind!=='preference'||f.scopeId!==c.route.scopeId||f.entryId!==c.route.entryId||f.owner!==c.actor)continue
  const condition=f.learning?.condition?.trim(), phrase=condition?.match(/^request contains:\s*(.+)$/is)?.[1]
  // Conditions are data, not authority. Historical free-form predicates cannot
  // be asserted automatically. Only the literal request matcher is executable.
  if ((f.expiresAt!==undefined&&f.expiresAt<=now)||(f.learning?.discussion&&f.learning.discussion!==c.route.discussion)||
      (condition&&(!phrase?.trim()||!request.includes(fold(phrase))))) {
   decisions.set(f.id,'condition_unmatched');continue
  }
  const key=fold(f.subject),group=topics.get(key)
  if(group)group.push(f);else topics.set(key,[f])
 }
 for(const group of topics.values()) {
  const explicit=group.some(f=>!inferred(f)), eligible=group.filter(f=>!explicit||!inferred(f))
  const best=Math.max(...eligible.map(specificity)), finalists=eligible.filter(f=>specificity(f)===best)
  const ambiguous=new Set(finalists.map(f=>fold(f.content))).size>1
  const representative=finalists.map(f=>f.id).sort()[0]
  for(const f of group) decisions.set(f.id,explicit&&inferred(f)?'explicit_preferred':
   specificity(f)<best?'narrower_preferred':ambiguous?'ambiguous':f.id===representative?'applied':'equivalent')
 }
 return {decisions,items:items.filter(f=>f.kind!=='preference'||decisions.get(f.id)==='applied')}
}
