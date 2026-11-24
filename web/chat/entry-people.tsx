import {useEffect,useRef,useState,type FormEvent} from 'react'
import {useWorkspaceTransport} from './workspace-context.tsx'

const bindingId=/^[a-f0-9]{64}$/
type Observation={id:string;actorId:string;sourceId:string;verifiedAt:number;role?:'scope-manager';membership?:'observed-added'}
type Snapshot={team:string;truncated:boolean;people:Observation[];expiresIn:number}
function record(value:unknown){return value&&typeof value==='object'?value as Record<string,unknown>:null}
const time=(n:unknown):n is number=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=0&&n<=8.64e15
const short=(s:unknown,max:number):s is string=>typeof s==='string'&&s.length>0&&s.length<=max
function readSnapshot(value:unknown,entryId:string,revision:number):Snapshot|null{
 const v=record(value),team=record(v?.team)
 if(v?.schema===1&&v.availability==='unavailable'&&Array.isArray(v.people)&&v.people.length===0)return null
 if(v?.schema!==1||v.availability!=='partial'||v.entryId!==entryId||v.settingsRevision!==revision||
    !team||team.kind!=='management-scope'||!short(team.label,100)||!time(v.observedAt)||!time(v.expiresAt)||
    v.expiresAt-v.observedAt>15_000||v.expiresAt<v.observedAt||typeof v.truncated!=='boolean'||!Array.isArray(v.people)||v.people.length>100)throw Error('people_index_unavailable')
 const seen=new Set<string>(),observedAt=v.observedAt
 const people=v.people.map((item:unknown):Observation=>{
  const p=record(item)
  if(!p||typeof p.id!=='string'||!bindingId.test(p.id)||seen.has(p.id)||!short(p.actorId,300)||!short(p.sourceId,300)||
      !time(p.verifiedAt)||p.verifiedAt>observedAt||p.evidence!=='native-entry-activity'||
      (p.role!==undefined&&p.role!=='scope-manager')||(p.membership!==undefined&&p.membership!=='observed-added'))throw Error('people_index_unavailable')
  seen.add(p.id)
  return {id:p.id,actorId:p.actorId,sourceId:p.sourceId,verifiedAt:p.verifiedAt,...(p.role==='scope-manager'?{role:p.role}:{}),...(p.membership==='observed-added'?{membership:p.membership}:{})}
 })
 return {team:team.label,truncated:v.truncated,people,expiresIn:v.expiresAt-observedAt}
}

export function EntryPeople({language,settingsRevision}:{language:'en'|'zh-CN';settingsRevision:number}){
 const L=(en:string,zh:string)=>language==='en'?en:zh,workspace=useWorkspaceTransport()
 const [entry,setEntry]=useState(''),[snapshot,setSnapshot]=useState<Snapshot|null>(null)
 const [state,setState]=useState<'idle'|'loading'|'unavailable'|'expired'|'ready'>('idle')
 const request=useRef<AbortController|null>(null),timer=useRef<number|undefined>(undefined)
 function cancel(){
  request.current?.abort();request.current=null
  window.clearTimeout(timer.current);timer.current=undefined
 }
 useEffect(()=>{
  const reset=()=>{cancel();setSnapshot(null);setState('idle')}
  const hidden=()=>{if(document.hidden)reset()}
  workspace.readSignal.addEventListener('abort',reset,{once:true})
  document.addEventListener('visibilitychange',hidden)
  window.addEventListener('pagehide',reset)
  window.addEventListener('roppo:plugins-changed',reset)
  return ()=>{
   workspace.readSignal.removeEventListener('abort',reset)
   document.removeEventListener('visibilitychange',hidden)
   window.removeEventListener('pagehide',reset)
   window.removeEventListener('roppo:plugins-changed',reset)
   cancel()
  }
 },[workspace.binding,workspace.contextKey,workspace.readSignal,settingsRevision])
 async function lookup(event:FormEvent<HTMLFormElement>){
  event.preventDefault()
  const id=entry.trim()
  if(!bindingId.test(id)||workspace.readSignal.aborted||document.hidden)return
  cancel();setSnapshot(null);setState('loading')
  const controller=new AbortController(),started=performance.now()
  request.current=controller
  const current=()=>request.current===controller&&!controller.signal.aborted&&!workspace.readSignal.aborted&&!document.hidden
  try{
   const query=new URLSearchParams({entryId:id})
   const data=await workspace.binding.request<unknown>('/api/people-index?'+query,undefined,false,undefined,controller.signal)
   if(!current())return
   const next=readSnapshot(data,id,settingsRevision)
   if(!next){setState('unavailable');return}
   // Subtract the entire request duration rather than assume synchronized clocks.
   const remaining=next.expiresIn-(performance.now()-started)
   if(remaining<=0){setState('expired');return}
   setSnapshot(next);setState('ready')
   timer.current=window.setTimeout(()=>{if(current()){setSnapshot(null);setState('expired')}},remaining)
  }catch{if(current())setState('unavailable')}
 }
 return <section className="connector-card" aria-labelledby="entry-people-title">
  <h2 id="entry-people-title">{L('Recent people observed in one entry','单个入口的近期人员观察')}</h2>
  <p>{L('Read local evidence for one bound group entry only. These observations are partial, not a roster or a permission check.','只读取一个已绑定群入口的本地证据。结果不完整，不是成员名册，也不能用于判断权限。')}</p>
  <form onSubmit={event=>void lookup(event)}>
   <label>{L('Exact entry binding ID','入口绑定 ID')}
    <input value={entry} maxLength={64} autoComplete="off" spellCheck={false} required pattern="[a-f0-9]{64}"
     onChange={event=>{cancel();setSnapshot(null);setState('idle');setEntry(event.target.value)}}/>
   </label>
   <p>{L('Use the binding ID shown under Groups and entries in Router management, not the native group ID.','请使用 Router 管理「群与入口」表中的绑定 ID，不是平台群号。')}</p>
   <button type="submit" disabled={state==='loading'||!bindingId.test(entry)}>{L('Read observations','读取观察记录')}</button>
  </form>
  <div role="status" aria-live="polite">
   {state==='loading'?L('Reading local evidence…','正在读取本地证据…'):state==='unavailable'
    ?L('No current evidence is available for this entry.','此入口当前没有可用证据。'):state==='expired'
    ?L('The view expired. Read again to check current evidence.','结果已清除，请重新读取当前证据。'):null}
   {snapshot&&!workspace.readSignal.aborted?<p>{L('Management scope: ','管理范围：')}<bdi>{snapshot.team}</bdi>{snapshot.truncated?L(' · Results limited',' · 结果已截断'):''}</p>:null}
  </div>
  {snapshot&&!workspace.readSignal.aborted?(snapshot.people.length?<ul>{snapshot.people.map(p=><li key={p.id}>
   <bdi>{p.actorId}</bdi>{' · '}<bdi>{p.sourceId}</bdi>{' · '}<time dateTime={new Date(p.verifiedAt).toISOString()}>{new Date(p.verifiedAt).toLocaleString(language)}</time>
   {p.role?L(' · Local scope manager',' · 本地范围管理者'):''}{p.membership?L(' · Addition observed',' · 曾观测到加入'):''}
  </li>)}</ul>:<p>{L('No recent verified people in this entry.','此入口暂无经核验的近期人员观察。')}</p>):null}
 </section>
}
