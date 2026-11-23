import {useEffect,useState} from 'react'
import type {ProgressResponse,ProgressSnapshot} from '../../src/progress-snapshot.ts'
import {useWorkspaceTransport} from './workspace-context.tsx'

type Language='en'|'zh-CN'
const fields=['activity','result','commit','push','check','deployment','acceptance'] as const
const id=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value)
export function TaskProgressSnapshot({ticketId,language}:{ticketId:string;language:Language}){
 const {binding,contextKey,readSignal}=useWorkspaceTransport()
 const [current,setCurrent]=useState<{context:string;value:ProgressSnapshot;changes:string[]}|null>(null),[unavailable,setUnavailable]=useState(false)
 const L=(en:string,zh:string)=>language==='en'?en:zh
 const labels={activity:L('Execution','执行'),result:L('Saved result','已留存结果'),commit:L('Commit','提交'),push:L('Remote push','远端推送'),check:L('Integrated test','集成测试'),deployment:L('Deployment','部署'),acceptance:L('Verification record','验收记录'),artifacts:L('Fixed file versions','固定文件版本')}
 useEffect(()=>{
  const controller=new AbortController(),signal=AbortSignal.any([controller.signal,readSignal])
  let previous:ProgressSnapshot|undefined,busy=false
  const read=async()=>{
   if(signal.aborted||busy||document.visibilityState==='hidden')return
   busy=true
   try{
    const query=new URLSearchParams({ticketId,...(previous?{revision:previous.revision}:{})})
    const response=await binding.request<ProgressResponse>('/api/execution-trace/progress?'+query,undefined,false,undefined,signal)
    if(signal.aborted)return
    if(response?.schema!==1)throw Error('Unknown progress format')
    if(response.unchanged)return
    const value=response.snapshot
    if(value.schema!==1||!id(value.revision))throw Error('Unknown progress snapshot')
    const older=previous
    const changes=older?[...fields,'artifacts' as const].filter(key=>JSON.stringify(older.sections[key])!==JSON.stringify(value.sections[key])):[]
    previous=value
    setCurrent({context:contextKey,value,changes})
    setUnavailable(false)
   }catch{
    if(!signal.aborted){previous=undefined;setCurrent(null);setUnavailable(true)}
   }finally{busy=false}
  }
  setCurrent(null);setUnavailable(false)
  void read()
  const timer=setInterval(()=>void read(),5000)
  const onVisible=()=>void read()
  document.addEventListener('visibilitychange',onVisible)
  return()=>{controller.abort();clearInterval(timer);document.removeEventListener('visibilitychange',onVisible)}
 },[binding,contextKey,ticketId,readSignal])
 if(readSignal.aborted)return null
 const snapshot=current?.context===contextKey?current.value:null
 const timestamp=(at:number)=>new Date(at).toLocaleString(language)
 const stamp=(at:number)=><time dateTime={new Date(at).toISOString()}>{timestamp(at)}</time>
 if(!snapshot)return <p className="trace-muted">{unavailable?L('No evidence can be shown for this task.','当前无法显示此任务的证据。'):L('Reading saved evidence…','正在读取留存证据…')}</p>
 const names={queued:L('Queued','已排队'),waiting:L('Waiting','等待中'),stopped:L('Stopped','已停止'),ended:L('Ended','已结束'),interrupted:L('Interrupted','已中断'),uncertain:L('Needs reconciliation','待核查'),unverified:L('Unverified','未验证'),recorded:L('Recorded','有记录'),passed:L('Passed','通过'),failed:L('Failed','未通过'),insufficient:L('Insufficient evidence','证据不足'),errored:L('Check errored','检查出错'),stale:L('Outdated','已过时'),pending:L('Pending','待确认'),running:L('Running','运行中')}
 return <section aria-label={L('Task progress snapshot','任务进展快照')}>
  <h3>{L('Evidence snapshot','证据快照')}</h3>
  <p className="trace-muted">{L('Last changed snapshot observed at ','此快照最近更新于 ')}{stamp(snapshot.observedAt)}</p>
  <div role="status" aria-live="polite">{current?.changes.length?<p key={snapshot.revision}>{L('Changed: ','有新变化：')}{current.changes.map(key=>labels[key as keyof typeof labels]).join(L(', ','、'))}</p>:null}</div>
  <dl className="trace-facts">{fields.map(key=>{
   const datum=snapshot.sections[key]
   return <div key={key}><dt>{labels[key]}</dt><dd><strong>{names[datum.state]}</strong>
    {datum.head?<span> · <code title={datum.head}>{datum.head.slice(0,12)}</code></span>:null}
    {datum.matchesCurrent===false?<p>{L('Earlier or different revision; not current evidence.','较早或不同版本，不代表当前结果。')}</p>:datum.matchesCurrent===null&&datum.state!=='unverified'&&key!=='result'&&key!=='activity'?<p>{L('Not confirmed for the current revision.','未确认适用于当前版本。')}</p>:null}
    {datum.observedAt===null?(datum.state!=='unverified'&&key!=='activity'?<p>{L('Evidence time unavailable','无证据时间')}</p>:null):<p>{L('Evidence recorded at ','证据记录于 ')}{stamp(datum.observedAt)}</p>}
   </dd></div>
  })}</dl>
  {snapshot.sections.artifacts.length?<><h4>{labels.artifacts}</h4><ul>{snapshot.sections.artifacts.filter(a=>id(a.id)).map(a=><li key={a.id}><a href={'/configure#artifact/'+a.id} onClick={event=>{if(readSignal.aborted)event.preventDefault()}}>{L('Open fixed version ','打开固定版本 ')}{a.version}</a>{a.observedAt===null?null:<> · {stamp(a.observedAt)}</>}</li>)}</ul></>:null}
  <p className="trace-muted">{L('A saved result, local test, or pushed commit does not verify deployment or final acceptance.','留存结果、本地测试或推送的提交，都不代表已部署或通过最终验收。')}</p>
 </section>
}
