import {ArtifactReferenceDetails} from './artifact-reference-details.tsx'
import {useState} from 'react'
import {useAui,useAuiState,type AttachmentAdapter,type CompleteAttachment,type PendingAttachment} from '@assistant-ui/react'
import {Download,FileText,LoaderCircle,X} from 'lucide-react'
import type {ChatAttachment} from '../../src/chat-attachments.ts'

type Localize=(en:string,zh:string)=>string
export function attachmentParts(file:ChatAttachment):CompleteAttachment {
  return {id:file.id,name:file.name,type:file.previewUrl?'image':'document',contentType:file.mimeType,status:{type:'complete'},content:[{type:'file',filename:file.name,mimeType:file.mimeType,data:file.url},...(file.previewUrl?[{type:'image' as const,image:file.previewUrl}]:[])]}
}
export function attachmentError(code:string,L:Localize){
  if(code==='attachment_too_large')return L('File exceeds 25 MB.','文件不能超过 25 MB。')
  if(code==='attachment_limit')return L('Send or remove existing files first (10 max).','最多 10 个文件，请先发送或移除已有文件。')
  if(code==='attachment_missing')return L('File unavailable. Upload it again.','文件已失效，请重新上传。')
  return L('Upload failed. Remove the file and try again.','上传失败，请移除文件后重试。')
}
async function request(url:string,init?:RequestInit){
  const response=await fetch(url,{credentials:'same-origin',...init}),body=await response.json()
  if(!response.ok)throw Error(body.code??'request_failed')
  return body
}
export function createAttachmentAdapter(conversation:()=>Promise<string>,maxBytes:number,L:Localize):AttachmentAdapter {
  const active=new Map<string,AbortController>()
  return {
    accept:'*',
    async *add({file}){
      const id=crypto.randomUUID(),base={id,type:'document',name:file.name,contentType:file.type,file},controller=new AbortController()
      active.set(id,controller)
      yield {...base,status:{type:'running',reason:'uploading',progress:0}}
      try{
        if(file.size>maxBytes)throw Error('attachment_too_large')
        const target=await conversation()
        const result:ChatAttachment=await request('/api/chat/conversations/'+target+'/attachments/'+id+'?name='+encodeURIComponent(file.name),{method:'POST',headers:{'content-type':file.type||'application/octet-stream'},body:file,signal:controller.signal})
        yield {...attachmentParts(result),file,status:{type:'requires-action',reason:'composer-send'}}
      }catch(error){
        if(!controller.signal.aborted)yield {...base,status:{type:'incomplete',reason:'error',message:attachmentError(error instanceof Error?error.message:'',L)}}
      }finally{active.delete(id)}
    },
    async send(attachment:PendingAttachment){
      if(attachment.status.type!=='requires-action')throw Error(attachment.status.type==='incomplete'?attachment.status.message:L('File is still uploading.','文件仍在上传。'))
      return {...attachment,status:{type:'complete'}} as CompleteAttachment
    },
    async remove(attachment){
      active.get(attachment.id)?.abort()
      const part=attachment.content?.find(c=>c.type==='file')
      const target=await conversation(),url=part?.type==='file'?String(part.data):'/api/chat/conversations/'+target+'/attachments/'+attachment.id
      try{await request(url,{method:'DELETE'})}catch(error){if(!(error instanceof Error&&error.message==='attachment_missing'))throw error}
    },
  }
}
export function MessageAttachments({files,L}:{files:ChatAttachment[];L:Localize}){
  if(!files.length)return null
  return <div className="message-attachments">{files.map(file=><div key={file.id} className="message-attachment-result"><a className={'chat-attachment'+(file.previewUrl?' image-attachment':'')} href={file.url} download={file.name} title={L('Download ','下载 ')+file.name}>
    {file.previewUrl?<img src={file.previewUrl} alt={file.name} loading="lazy"/>:<FileText size={22}/>}
    <span className="attachment-info"><strong>{file.name}</strong><span>{file.bytes<1024?file.bytes+' B':file.bytes<1048576?Math.ceil(file.bytes/1024)+' KB':(file.bytes/1048576).toFixed(1)+' MB'}</span></span><Download size={15}/>
  </a><ArtifactReferenceDetails reference={file.reference} L={L}/></div>)}</div>
}
export function DraftAttachment({L}:{L:Localize}){
  const aui=useAui(),attachment=useAuiState(s=>s.attachment),[removing,setRemoving]=useState(false),[error,setError]=useState('')
  const image=attachment.content?.find(c=>c.type==='image'),uploading=attachment.status.type==='running',failed=attachment.status.type==='incomplete'
  async function remove(){
    setRemoving(true);setError('')
    try{
      // Restored drafts are complete runtime attachments; their persisted upload still needs removal.
      if(attachment.status.type==='complete'){
        const part=attachment.content?.find(c=>c.type==='file')
        if(part?.type==='file')await request(String(part.data),{method:'DELETE'})
      }
      await aui.attachment().remove()
    }catch{setError(L('Could not remove. Try again.','移除失败，请重试。'))}finally{setRemoving(false)}
  }
  return <div className="chat-attachment draft-attachment" data-failed={failed||!!error}>
    {image?.type==='image'?<img src={image.image} alt=""/>:uploading?<LoaderCircle size={22} className="spin"/>:<FileText size={22}/>}
    <span className="attachment-info"><strong>{attachment.name}</strong><span role="status">{error|| (attachment.status.type==='incomplete'?attachment.status.message:uploading?L('Uploading…','上传中…'):attachment.name.split('.').at(-1)?.toUpperCase())}</span></span>
    <button type="button" className="icon-button" disabled={removing} onClick={()=>void remove()} aria-label={L('Remove ','移除 ')+attachment.name}>{removing?<LoaderCircle size={14} className="spin"/>:<X size={14}/>}</button>
  </div>
}
