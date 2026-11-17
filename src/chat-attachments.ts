import {createWriteStream,copyFileSync,mkdirSync,readFileSync,rmSync} from 'node:fs'
import {dirname,extname,join} from 'node:path'
import {pipeline} from 'node:stream/promises'
import type {Runtime} from './runtime.ts'
import {ChatError} from './chat-errors.ts'
import {stableDigest} from './sources.ts'

export const chatUploadLimits={maxBytes:25*1024*1024,maxFiles:10}
export interface ChatAttachment {id:string;name:string;mimeType:string;bytes:number;url:string;previewUrl?:string}
interface Upload {id:string;kind:'chat-upload';conversationId:string;name:string;mimeType:string;bytes:number;path:string;createdAt:number;state:'uploading'|'ready';triggerId?:string;previewType?:string}
interface Conversation {id:string;owner:string;discussion:string;archived:boolean}

function previewType(bytes:Buffer){
  if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return 'image/png'
  if(bytes[0]===255&&bytes[1]===216)return 'image/jpeg'
  if(['GIF87a','GIF89a'].includes(bytes.subarray(0,6).toString()))return 'image/gif'
  if(bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP')return 'image/webp'
}
export class ChatAttachments {
  constructor(private host:Runtime,private conversation:(id:string,owner:string)=>Conversation){
    for(const row of host.store.list<Upload>('asset'))if(row.kind==='chat-upload'&&row.state==='uploading')this.discard(row)
  }
  private discard(row:Upload){rmSync(dirname(row.path),{recursive:true,force:true});this.host.store.db.prepare("DELETE FROM records WHERE kind='asset' AND id=?").run(row.id)}
  private public(row:Upload):ChatAttachment {
    const url='/api/chat/conversations/'+row.conversationId+'/attachments/'+row.id
    return {id:row.id,name:row.name,mimeType:row.mimeType,bytes:row.bytes,url,...(row.previewType?{previewUrl:url+'?preview=1'}:{})}
  }
  private row(id:string,conversationId:string){
    const row=this.host.store.get<Upload>('asset',id)
    if(row?.kind!=='chat-upload'||row.conversationId!==conversationId||row.state!=='ready'||this.host.memory.cleanup.blocked('asset',id,row))throw new ChatError('attachment_missing','File not found.',404)
    return row
  }
  drafts(id:string,owner:string){
    this.conversation(id,owner)
    return this.host.store.list<Upload>('asset').filter(row=>row.kind==='chat-upload'&&row.conversationId===id&&row.state==='ready'&&!row.triggerId&&!this.host.memory.cleanup.blocked('asset',row.id,row)).map(row=>this.public(row))
  }
  async upload(conversationId:string,owner:string,id:string,input:{name:string;mimeType:string},body:AsyncIterable<Uint8Array>,authorize:()=>void=()=>{}){
    const conversation=this.conversation(conversationId,owner)
    if(conversation.archived)throw new ChatError('conversation_archived','Restore this conversation before uploading.')
    const drafts=this.host.store.list<Upload>('asset').filter(row=>row.kind==='chat-upload'&&row.conversationId===conversationId&&!row.triggerId)
    if(drafts.length>=chatUploadLimits.maxFiles)throw new ChatError('attachment_limit','Send or remove existing files first.',413)
    if(this.host.store.get('asset',id))throw new ChatError('attachment_conflict','Upload identity already exists.')
    const directory=join(this.host.config.stateDir,'assets',id),path=join(directory,'upload'+extname(input.name).replace(/[^.a-z0-9]/gi,'').slice(0,20))
    const row:Upload={id,kind:'chat-upload',conversationId,name:input.name,mimeType:input.mimeType,bytes:0,path,createdAt:Date.now(),state:'uploading'}
    mkdirSync(directory,{recursive:true,mode:0o700});this.host.store.put('asset',id,row)
    try{
      await pipeline(body,async function*(source){for await(const chunk of source){row.bytes+=chunk.byteLength;if(row.bytes>chatUploadLimits.maxBytes)throw new ChatError('attachment_too_large','File exceeds 25 MB.',413);yield chunk}},createWriteStream(path,{flags:'wx',mode:0o600}))
      authorize();this.conversation(conversationId,owner)
      if(!this.host.store.get('asset',id))throw new ChatError('attachment_missing','Upload was removed.',404)
      row.previewType=previewType(readFileSync(path).subarray(0,12));if(row.previewType)row.mimeType=row.previewType
      row.state='ready';this.host.store.put('asset',id,row)
      return this.public(row)
    }catch(error){this.discard(row);throw error}
  }
  remove(conversationId:string,owner:string,id:string){
    this.conversation(conversationId,owner);const row=this.host.store.get<Upload>('asset',id)
    if(row?.kind!=='chat-upload'||row.conversationId!==conversationId)throw new ChatError('attachment_missing','File not found.',404)
    if(row.triggerId)throw new ChatError('attachment_sent','Sent files are part of the conversation.')
    this.discard(row);return {removed:true}
  }
  download(conversationId:string,owner:string,id:string){this.conversation(conversationId,owner);return this.row(id,conversationId)}
  resolve(conversationId:string,owner:string,ids:string[]){
    this.conversation(conversationId,owner)
    if(ids.length>chatUploadLimits.maxFiles||new Set(ids).size!==ids.length)throw new ChatError('attachment_limit','Select up to 10 different files.',400)
    return ids.map(id=>{const row=this.row(id,conversationId);if(row.triggerId)throw new ChatError('attachment_sent','This file was already sent.');return this.public(row)})
  }
  bind(ids:string[],triggerId:string){for(const id of ids){const row=this.host.store.get<Upload>('asset',id)!;this.host.store.put('asset',id,{...row,triggerId})}}
  private taskCopy(row:Upload,ticketId:string){const id=stableDigest(['chat-attachment',ticketId,row.id]);return {id,path:join(this.host.config.stateDir,'assets',id,'upload'+extname(row.path))}}
  /** Declare the same exact paths to the model that managed shell grants on resource reads. */
  taskPaths(ticketId:string){
    const authority=this.host.taskAuthority(ticketId),run=authority?.parentTrigger?this.host.store.get<{conversationId:string}>('chat-run',authority.parentTrigger):undefined
    if(!run)return []
    return this.host.store.list<Upload>('asset').filter(row=>row.kind==='chat-upload'&&row.conversationId===run.conversationId&&row.state==='ready'&&row.triggerId&&!this.host.memory.cleanup.blocked('asset',row.id,row)).map(row=>this.taskCopy(row,ticketId).path)
  }
  /** A task may read this Chat's files only while its current reply authority belongs to this Chat. */
  authorize(id:string,principal:{ticketId?:string;chatTriggerId?:string}){
    const authority=principal.ticketId?this.host.taskAuthority(principal.ticketId):undefined
    const triggerId=principal.chatTriggerId??authority?.parentTrigger
    const run=triggerId?this.host.store.get<{conversationId:string}>('chat-run',triggerId):undefined
    if(!run)throw new ChatError('attachment_scope','File is outside this conversation.',403)
    const stored=this.host.store.get<Conversation>('chat-conversation',run.conversationId)!
    const conversation=this.conversation(stored.id,stored.owner),row=this.row(id,conversation.id)
    if(!row.triggerId)throw new ChatError('attachment_unsent','File has not been sent.',403)
    this.host.routerIngress.authority(triggerId!,conversation.discussion)
    this.host.routerIngress.authority(row.triggerId,conversation.discussion)
    if(authority&&authority.discussion!==conversation.discussion)throw new ChatError('attachment_scope','File is outside this task.',403)
    return row
  }
  read(id:string,principal:{ticketId?:string;chatTriggerId?:string}){
    const row=this.authorize(id,principal)
    let path:string|undefined,resource='asset/'+id
    if(principal.ticketId){
      const copy=this.taskCopy(row,principal.ticketId)
      if(!this.host.store.get('asset',copy.id)){
        mkdirSync(dirname(copy.path),{recursive:true,mode:0o700});copyFileSync(row.path,copy.path)
        this.host.store.put('asset',copy.id,{...this.public(row),...copy,ticketId:principal.ticketId,uploadId:id,resource:'asset/'+copy.id})
      }
      path=copy.path;resource='asset/'+copy.id
    }
    const bytes=readFileSync(row.path)
    if(row.previewType&&bytes.length<=8*1024*1024)return {kind:'image',mimeType:row.previewType,data:bytes.toString('base64')}
    if(!row.previewType&&!bytes.includes(0)&&bytes.subarray(0,5).toString()!=='%PDF-'){
      try{return new TextDecoder('utf-8',{fatal:true}).decode(bytes)}catch{/* Binary attachments are read by the Worker's task tools. */}
    }
    return {name:row.name,mimeType:row.mimeType,bytes:row.bytes,resource,...(path?{path}:{processing:'Use a Worker to process the original file with task tools.'})}
  }
}
