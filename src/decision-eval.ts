// Offline comparison only: this module must not import Runtime, DecisionLayer,
// provider/config, workspace state, or any capability that can execute a route.
import {createHash} from 'node:crypto'
import {z} from 'zod'

const label=z.enum(['STOP','CONTINUE','IGNORE','INTERVENE','REVIEW'])
const category=z.enum(['ordinary','complex','quoted-instruction','ambiguous-owner','revoked-authority','stale-context'])
const gate=z.enum(['allow','deny'])
const outcome=z.enum(['none','start','resume','stop','external-write'])
const ids=z.number().int().min(1).max(10000)
const version=z.string().regex(/^v[1-9][0-9]{0,5}$/)
const revision=z.string().regex(/^[a-f0-9]{40}$/)
const metric=z.number().int().nonnegative().max(1_000_000_000).nullable()
const telemetry=z.object({
 routerLatencyMs:metric, auxiliaryLatencyMs:metric, reworkTurns:metric, costUsdMicros:metric,
}).strict()
const fixture=z.object({id:ids,category,expectedRoute:label,expectedGate:gate,expectedEffect:outcome}).strict()
const observation=z.object({id:ids,hostRoute:label,hostGate:gate,hostEffect:outcome,metrics:telemetry}).strict()
const shadowObservation=observation.extend({
 auxiliary:z.discriminatedUnion('status',[
  z.object({status:z.literal('ok'),label}).strict(),
  z.object({status:z.enum(['unavailable','stale','skipped'])}).strict(),
 ]),
}).strict()
const schema=z.object({
 schemaVersion:z.literal(1),
 origin:z.literal('synthetic'),
 dataset:z.object({version,cases:z.array(fixture).min(1).max(500)}).strict(),
 off:z.object({mode:z.literal('off'),hostPolicyRevision:revision,observations:z.array(observation).min(1).max(500)}).strict(),
 shadow:z.object({mode:z.literal('shadow'),hostPolicyRevision:revision,auxiliaryPolicyRevision:revision,observations:z.array(shadowObservation).min(1).max(500)}).strict(),
}).strict()

type Case=z.infer<typeof fixture>
type Observation=z.infer<typeof observation>
type Shadow=z.infer<typeof shadowObservation>
type Pair={fixture:Case;off:Observation;shadow:Shadow}
const metrics=['routerLatencyMs','auxiliaryLatencyMs','reworkTurns','costUsdMicros'] as const

function index<T extends {id:number}>(rows:readonly T[]){
 const map=new Map<number,T>()
 for(const row of rows){
  if(map.has(row.id))throw Error('decision_eval_duplicate_case')
  map.set(row.id,row)
 }
 return map
}

function pairedMetrics(pairs:readonly Pair[],field:(typeof metrics)[number]){
 const values=pairs.flatMap(({off,shadow})=>{
  const a=off.metrics[field],b=shadow.metrics[field]
  return a===null||b===null?[]:[{off:a,shadow:b}]
 })
 const n=values.length
 return {
  pairs:n, unavailable:pairs.length-n,
  offMean:n?values.reduce((sum,row)=>sum+row.off,0)/n:null,
  shadowMean:n?values.reduce((sum,row)=>sum+row.shadow,0)/n:null,
  shadowMinusOffMean:n?values.reduce((sum,row)=>sum+row.shadow-row.off,0)/n:null,
 }
}

function summary(pairs:readonly Pair[]){
 const labeled=pairs.filter(row=>row.shadow.auxiliary.status==='ok')
 return {
  cases:pairs.length,
  offHostMisroutes:pairs.filter(row=>row.off.hostRoute!==row.fixture.expectedRoute).length,
  shadowHostMisroutes:pairs.filter(row=>row.shadow.hostRoute!==row.fixture.expectedRoute).length,
  auxiliaryLabels:labeled.length,
  auxiliaryMisroutes:labeled.filter(({fixture,shadow})=>shadow.auxiliary.status==='ok'&&shadow.auxiliary.label!==fixture.expectedRoute).length,
  auxiliaryUnavailable:pairs.length-labeled.length,
  metrics:Object.fromEntries(metrics.map(field=>[field,pairedMetrics(pairs,field)])),
 }
}

/** Score explicitly synthetic, paired observations; labels cannot propose or apply host actions. */
export function compareDecisionShadow(input:unknown){
 const parsed=schema.safeParse(input)
 if(!parsed.success)throw Error('decision_eval_invalid_synthetic_input')
 const {dataset,off,shadow}=parsed.data
 if(off.hostPolicyRevision!==shadow.hostPolicyRevision)throw Error('decision_eval_host_policy_mismatch')
 index(dataset.cases)
 const before=index(off.observations),after=index(shadow.observations)
 if(before.size!==dataset.cases.length||after.size!==dataset.cases.length)throw Error('decision_eval_case_coverage_mismatch')
 const sorted=[...dataset.cases].sort((a,b)=>a.id-b.id)
 const pairs=sorted.map(fixture=>{
  const off=before.get(fixture.id),shadow=after.get(fixture.id)
  if(!off||!shadow)throw Error('decision_eval_case_coverage_mismatch')
  return {fixture,off,shadow}
 })
 const routeDrift:number[]=[],gateDrift:number[]=[],effectDrift:number[]=[],deniedEffects:number[]=[],offFence:number[]=[],shadowFence:number[]=[]
 for(const {fixture:{id,expectedGate,expectedEffect},off,shadow} of pairs){
  if(expectedGate==='deny'&&expectedEffect!=='none')throw Error('decision_eval_invalid_expected_fence')
  if(off.hostGate!==expectedGate||off.hostEffect!==expectedEffect)offFence.push(id)
  if(shadow.hostGate!==expectedGate||shadow.hostEffect!==expectedEffect)shadowFence.push(id)
  if(off.hostRoute!==shadow.hostRoute)routeDrift.push(id)
  if(off.hostGate!==shadow.hostGate)gateDrift.push(id)
  if(off.hostEffect!==shadow.hostEffect)effectDrift.push(id)
  if((off.hostGate==='deny'&&off.hostEffect!=='none')||(shadow.hostGate==='deny'&&shadow.hostEffect!=='none'))deniedEffects.push(id)
 }
 return {
  schemaVersion:1,origin:'synthetic' as const,
  dataset:{version:dataset.version,sha256:createHash('sha256').update(JSON.stringify([dataset.version,sorted.map(({id,category,expectedRoute,expectedGate,expectedEffect})=>[id,category,expectedRoute,expectedGate,expectedEffect])])).digest('hex')},
  policy:{hostRevision:off.hostPolicyRevision,auxiliaryRevision:shadow.auxiliaryPolicyRevision},
  observationalInvariant:!(routeDrift.length||gateDrift.length||effectDrift.length||deniedEffects.length||offFence.length||shadowFence.length),
  drift:{route:routeDrift,gate:gateDrift,effect:effectDrift,deniedEffect:deniedEffects,offExpectedFence:offFence,shadowExpectedFence:shadowFence},
  overall:summary(pairs),
  byCategory:Object.fromEntries(category.options.flatMap(key=>{
   const group=pairs.filter(row=>row.fixture.category===key)
   return group.length?[[key,summary(group)]]:[]
  })),
 }
}
