import {useEffect,useState} from 'react'
import type {ArtifactHandoff} from '../../src/artifact-handoff.ts'
import type {ArtifactReference} from '../../src/artifact-reference.ts'
import {artifactDownload,artifactIdValid} from './artifact-result-model.ts'
import {useWorkspaceTransport} from './workspace-context.tsx'

function handoff(data:unknown,reference:ArtifactReference):ArtifactHandoff{
 const value=data as ArtifactHandoff
 if(value?.schema!==1||value.artifactVersion?.id!==reference.id||value.artifactVersion.version!==reference.version||value.artifactVersion.sha256!==reference.sha256||
    value.destination?.kind!=='operator_workspace'||value.audience!=='authorized_workspace_operators'||!artifactIdValid(value.permissionVersion)||
    !['draft','accepted'].includes(value.acceptance?.state)||
    !validDelivery(value.delivery,value.acceptance.state)||
    value.publication?.state!=='not_confirmed'||value.publication.capability!=='unavailable')throw Error('handoff_unavailable')
 return value
}

function validDelivery(delivery:ArtifactHandoff['delivery']|undefined,acceptance:ArtifactHandoff['acceptance']['state']):boolean{
 if(!delivery)return false
 const {state,reason,receiptId}=delivery
 const acceptedReceipt=acceptance==='accepted'&&typeof receiptId==='string'&&artifactIdValid(receiptId)
 if(state==='ready')return reason===null&&acceptedReceipt
 if(state==='withdrawn')return reason==='operator_withdrew'?(receiptId===null||acceptedReceipt):reason==='goal_withdrawn'&&receiptId===null
 return state==='not_ready'&&receiptId===null&&(reason==='file_unavailable'||(acceptance==='accepted'?reason==='goal_pending':reason==='not_accepted'))
}

type Localize=(en:string,zh:string)=>string
function handoffExplanation(reason:ArtifactHandoff['delivery']['reason'],L:Localize):string|null{
 switch(reason){
  case 'not_accepted': return L('Independent acceptance has not been recorded for this version.','此版本尚无独立验收记录。')
  case 'goal_pending': return L('The associated goal has not completed.','关联目标尚未完成。')
  case 'file_unavailable': return L('The retained file for this version is unavailable.','此版本保留的文件不可用。')
  case 'goal_withdrawn': return L('The associated goal was canceled or superseded.','关联目标已取消或被替换。')
  case 'operator_withdrew': return L('A workspace operator withdrew this handoff.','工作区操作者已撤回此次交付。')
  default: return null
 }
}

export function ArtifactHandoffStatus({reference,language}:{reference:ArtifactReference;language:'en'|'zh-CN'}){
 const {binding,context,readSignal}=useWorkspaceTransport()
 const L=(en:string,zh:string)=>language==='en'?en:zh
 const [value,setValue]=useState<ArtifactHandoff|null>(null),[error,setError]=useState(false),[withdrawing,setWithdrawing]=useState(false),[reload,setReload]=useState(0)
 const path='/artifact-handoffs/'+reference.id
 useEffect(()=>{
  const controller=new AbortController(),signal=AbortSignal.any([controller.signal,readSignal])
  void binding.request<unknown>(path,undefined,false,undefined,signal).then(data=>{
   if(signal.aborted)return
   setValue(handoff(data,reference));setError(false)
  }).catch(()=>{if(!signal.aborted){setValue(null);setError(true)}})
  return()=>controller.abort()
 },[binding,path,reference,reload,readSignal])
 const visible=readSignal.aborted?null:value
 const download=visible?.delivery.state==='ready'&&visible.delivery.receiptId?artifactDownload(reference.id,context):null
 const explanation=visible?handoffExplanation(visible.delivery.reason,L):null
 return <section aria-label={L('Acceptance and delivery','验收与交付')}>
  <h3>{L('Acceptance and delivery','验收与交付')}</h3>
  {!visible&&!error?<p role="status">{L('Reading handoff status…','正在读取交付状态…')}</p>:null}
  {error?<p role="alert">{L('Handoff status is unavailable. Refresh to check again.','无法确认交付状态，请刷新后重查。')} <button type="button" onClick={()=>{setError(false);setReload(n=>n+1)}}>{L('Refresh','刷新')}</button></p>:null}
  {visible?<><dl className="template-meta" aria-live="polite">
   <div><dt>{L('Independent acceptance','独立验收')}</dt><dd>{visible.acceptance.state==='accepted'?L('Accepted','已验收'):L('Draft / not accepted','草稿／未验收')}</dd></div>
   <div><dt>{L('Private workspace handoff','工作区内交付')}</dt><dd>{visible.delivery.state==='ready'?L('Ready; not sent','可交付，未发送'):visible.delivery.state==='withdrawn'?L('Withdrawn','已撤回'):L('Not ready','不可交付')}</dd></div>
   <div><dt>{L('External publication','对外发布')}</dt><dd>{L('Not confirmed; publishing is unavailable here','未确认；此处不支持发布')}</dd></div>
  </dl>
  {explanation?<p>{explanation}</p>:null}
  <details>
   <summary>{L('Private handoff details','工作区内交付详情')}</summary>
   <dl className="template-meta">
    <div><dt>{L('Fixed file version','固定文件版本')}</dt><dd>{visible.artifactVersion.version}</dd></div>
    <div><dt>SHA-256</dt><dd><code style={{overflowWrap:'anywhere'}}>{visible.artifactVersion.sha256}</code></dd></div>
    <div><dt>{L('Destination type','目标类型')}</dt><dd>{L('Private operator workspace','私有操作者工作区')}</dd></div>
    <div><dt>{L('Audience','受众')}</dt><dd>{L('Authorized workspace operators','获授权的工作区操作者')}</dd></div>
    <div><dt>{L('Private handoff receipt ID','工作区内交付回执 ID')}</dt><dd>{visible.delivery.receiptId?<code style={{overflowWrap:'anywhere'}}>{visible.delivery.receiptId}</code>:L('None for this status','此状态下无回执')}</dd></div>
   </dl>
   <p>{L('This receipt identifies the private handoff for this version. A ready status means it can be downloaded by authorized operators, not that it was sent, delivered, or published externally.','回执标识此版本的工作区内交付。“可交付”表示获授权的操作者可以下载，不代表已经对外发送、送达或发布。')}</p>
  </details>
  {download?<p><a href={download+'?handoffReceipt='+encodeURIComponent(visible!.delivery.receiptId!)} onClick={event=>{if(readSignal.aborted||withdrawing)event.preventDefault()}}>{L('Download for private handoff','下载工作区内交付版本')}</a></p>:null}
  {visible.delivery.state==='ready'&&visible.delivery.receiptId?<button type="button" disabled={withdrawing} onClick={()=>{
   if(readSignal.aborted||!visible.delivery.receiptId||withdrawing)return
   setWithdrawing(true);setError(false)
   void binding.request<unknown>(path,{action:'withdraw',receiptId:visible.delivery.receiptId}).then(data=>{
    if(!readSignal.aborted)setValue(handoff(data,reference))
   }).catch(()=>{if(!readSignal.aborted){setValue(null);setError(true)}}).finally(()=>{if(!readSignal.aborted)setWithdrawing(false)})
  }}>{withdrawing?L('Withdrawing…','正在撤回…'):L('Withdraw private handoff','撤回工作区内交付')}</button>:null}
  {visible.delivery.state==='withdrawn'?<p>{L('Withdrawal stops this handoff. It does not delete the workspace file or recall anything already copied.','撤回只停止此交付，不会删除工作区文件，也不能收回已经复制的内容。')}</p>:null}</>:null}
 </section>
}
