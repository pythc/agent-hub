import {WSClient, decryptFile, type WSClientOptions} from '@wecom/aibot-node-sdk'
import {createHash} from 'node:crypto'
import {mkdirSync,writeFileSync,readFileSync,existsSync} from 'node:fs'
import {join,basename} from 'node:path'
import {MessageSource,UncertainDelivery,bodyDigest,type SourceContext} from '../sources.ts'
import type {SourceConfig} from '../config.ts'
import type {Trigger,OutboundMessage} from '../vendor/dsh-core/index.ts'
import {imageResource} from '../resources.ts'

export interface WecomTransport {
 on(event:string,fn:(...args:any[])=>void):unknown;connect():unknown;disconnect():void
 replyStream(frame:any,id:string,text:string,finish:boolean):Promise<unknown>
 sendMessage(chatid:string,body:{msgtype:'markdown';markdown:{content:string}}):Promise<unknown>
}
type Asset={kind:'image'|'file';name:string;path?:string;error?:string}
type Inbox={key:string;trigger:Trigger;view:any;assets:Asset[];digest:string;receivedAt:number;ingested:boolean;receipt?:'started'|'sent'|'uncertain'}
type Download=(url:string,aesKey:string|undefined,hosts:string[],signal:AbortSignal)=>Promise<Buffer|{buffer:Buffer;filename?:string}>
const digest=(s:string)=>createHash('sha256').update(s).digest('hex').slice(0,32)
const valid=(s:unknown,max=200):s is string=>typeof s==='string'&&s.length>0&&s.length<=max&&!/[\x00-\x1f]/.test(s)

/** Temporary media URLs/keys stay out of model-visible records; cache before their TTL expires. */
export const downloadWecom:Download=async(raw,key,hosts,signal)=>{
 const url=new URL(raw)
 if(url.protocol!=='https:'||url.username||url.password||!hosts.some(h=>url.hostname===h||url.hostname.endsWith('.'+h)))throw Error('WeCom media host is not configured')
 const response=await fetch(url,{redirect:'error',signal:AbortSignal.any([signal,AbortSignal.timeout(15000)])})
 if(!response.ok||Number(response.headers.get('content-length')??0)>8_100_000)throw Error('WeCom media unavailable or oversized')
 const reader=response.body?.getReader();if(!reader)throw Error('Empty WeCom media')
 const chunks:Uint8Array[]=[];let bytes=0
 for(;;){const r=await reader.read();if(r.done)break;bytes+=r.value.length;if(bytes>8_100_000){await reader.cancel();throw Error('WeCom media exceeds 8 MB')};chunks.push(r.value)}
 const encrypted=Buffer.concat(chunks),data=key?decryptFile(encrypted,key):encrypted
 if(data.length>8_000_000)throw Error('WeCom media exceeds 8 MB')
 const header=response.headers.get('content-disposition')??'',match=/filename\*=UTF-8''([^;\s]+)/i.exec(header)??/filename="?([^";]+)/i.exec(header)
 let filename:string|undefined;try{if(match)filename=basename(decodeURIComponent(match[1]!.trim())).replace(/[\x00-\x1f]/g,'').slice(0,120)}catch{}
 return {buffer:data,filename}
}

/** Official smart-bot long connection, not the notification-only group webhook. */
export class WecomSource extends MessageSource {
 private client?:WecomTransport
 private ctx?:SourceContext
 private authenticated=false
 private closing=false
 private abort=new AbortController()
 private pending=new Set<Promise<void>>()
 private discovered=new Set<string>()
 constructor(config:SourceConfig,private factory:(options:WSClientOptions)=>WecomTransport=o=>new WSClient(o) as WecomTransport,private download:Download=downloadWecom){super(config);if(!config.wecom)throw Error('WeCom configuration required')}
 private get options(){return this.config.wecom!}
 private get botId(){const id=process.env[this.options.botIdEnv];if(!id?.trim())throw Error('Missing WeCom bot ID environment variable');return id.trim()}
 private health(status:string){this.ctx?.store.put('source-live',this.config.id,{source:this.config.id,status,at:Date.now(),authenticated:this.authenticated})}
 private permitted(chat:string){return this.options.chats.includes(chat)||this.discovered.has(chat)}
 validThread(thread:string){
  try{const [kind,...parts]=thread.split(':'),id=decodeURIComponent(parts.join(':'));return valid(id)&&(kind==='single'?this.options.directMessages:kind==='group'&&this.permitted(id))}catch{return false}
 }
 async identity(){if(!process.env[this.options.secretEnv]?.trim())throw Error('Missing WeCom secret environment variable');return {id:this.botId,type:'bot',verified:this.authenticated}}
 start(ctx:SourceContext){
  if(this.closing)return;this.ctx=ctx;if(this.client)return
  const secret=process.env[this.options.secretEnv];if(!secret?.trim()){this.health('credentials-required');return}
  try{
   const client=this.client=this.factory({botId:this.botId,secret:secret.trim(),wsUrl:this.options.wsUrl,wsOptions:{maxPayload:1_000_000,followRedirects:false},requestTimeout:5000,maxReconnectAttempts:-1,maxAuthFailureAttempts:3,logger:{debug(){},info(){},warn(){},error(){}}})
   for(const r of ctx.store.list<Inbox>('wecom-inbox').filter(r=>r.trigger.source===this.config.id)){
    if(r.trigger.meta.chatType==='group'&&this.options.otherChats==='mentions')this.discovered.add(String(r.trigger.meta.chat))
    if(!r.ingested){for(const a of r.assets)if(!a.path&&!a.error)a.error='Host restarted before media download; temporary media was not replayed';this.ingest(r)}
   }
   client.on('authenticated',()=>{if(!this.closing){this.authenticated=true;this.health('ready')}})
   client.on('disconnected',()=>{this.authenticated=false;this.health(this.closing?'stopped':'disconnected')})
   client.on('reconnecting',()=>{this.authenticated=false;this.health('reconnecting')})
   client.on('error',()=>this.health('connection-error'))
   client.on('message',frame=>{
    if(this.closing)return
    if(this.pending.size>=32){this.health('overloaded');return}
    const p=this.receiveFrame(frame).catch(()=>this.health('message-error'));this.pending.add(p);void p.finally(()=>this.pending.delete(p))
   })
   this.health('connecting');client.connect()
  }catch{this.client?.disconnect();this.client=undefined;this.health('configuration-error')}
 }
 async poll(){if(!this.authenticated)throw Error('企业微信机器人尚未连接。请检查 Bot ID、Secret 和当前企业的机器人权限。')}
 private ingest(record:Inbox){
  const ctx=this.ctx!;if(this.closing)return
  ctx.store.atomic(()=>{ctx.receive(record.trigger);record.ingested=true;ctx.store.put('wecom-inbox',record.key,record)})
 }
 async receiveFrame(frame:any){
  const ctx=this.ctx,body=frame?.body
  if(!ctx||!this.config.enabled||this.closing||!this.authenticated||body?.aibotid!==this.botId||!valid(body.msgid)||!valid(body.from?.userid)||!valid(frame.headers?.req_id))return
  const group=body.chattype==='group',single=body.chattype==='single'
  if(!group&&!single||single&&!this.options.directMessages||group&&!valid(body.chatid))return
  const chat=group?body.chatid:body.from.userid
  // The official smart-bot callback only supplies group messages addressed to this bot.
  if(group&&!this.permitted(chat)){if(this.options.otherChats!=='mentions')return;this.discovered.add(chat)}
  const parts:any[]=body.msgtype==='mixed'?body.mixed?.msg_item??[]:[body]
  if(!Array.isArray(parts)||parts.length>10)throw Error('Invalid or oversized WeCom message parts')
  const assets:Asset[]=[],downloads:{url:string;key?:string}[]=[],texts:string[]=[]
  for(const part of parts){
   if(part.msgtype==='text'&&typeof part.text?.content==='string')texts.push(part.text.content)
   else if(part.msgtype==='voice'&&typeof part.voice?.content==='string')texts.push(part.voice.content)
   else if(part.msgtype==='image'||part.msgtype==='file'){
    const media=part[part.msgtype];if(typeof media?.url!=='string')continue
    const index=assets.length;assets.push({kind:part.msgtype,name:basename(media.filename??media.file_name??('attachment-'+index))});downloads.push({url:media.url,key:media.aeskey})
   }
  }
  if(!texts.length&&!assets.length)return
  const key=this.config.id+':'+digest(body.msgid),thread=(group?'group:':'single:')+encodeURIComponent(chat)
  const text=texts.join('\n')+(assets.length?'\n附件资源：'+assets.map((_,i)=>'wecom/'+this.config.id+':message:'+digest(body.msgid)+'/asset/'+i).join(', '):'')
  if(text.length>100000)throw Error('WeCom message is too long')
  const signature=bodyDigest({chat,actor:body.from.userid,type:body.msgtype,text,assets:assets.map(a=>({kind:a.kind,name:a.name}))})
  const existing=ctx.store.get<Inbox>('wecom-inbox',key)
  if(existing){if(existing.digest!==signature)throw Error('WeCom message ID reused with different content');return}
  const trigger=this.trigger({id:'message:'+digest(body.msgid),thread,text,addressed:true},body.from.userid,true)
  trigger.meta={scope:chat,chat,chatType:body.chattype,messageKey:key,messageId:body.msgid,resource:'wecom/'+trigger.id+'/message'}
  trigger.channel!.address={chat,messageKey:key}
  const record:Inbox={key,trigger,view:{id:body.msgid,chat,type:body.msgtype,from:body.from.userid,text:texts.join('\n'),quote:typeof body.quote?.text?.content==='string'?body.quote.text.content:undefined},assets,digest:signature,receivedAt:Date.now(),ingested:false}
  ctx.store.put('wecom-inbox',key,record)
  ctx.store.put('source-observed',this.config.id+':'+body.from.userid,{source:this.config.id,actor:body.from.userid,chat,at:Date.now()})
  // Receipt is durably recorded before sending and does not claim task admission.
  // Unlisted people cannot trigger unsolicited replies or media downloads.
  if(this.config.allowedActors.includes(body.from.userid)){
   record.receipt='started';ctx.store.put('wecom-inbox',key,record)
   try{await this.client!.replyStream(frame,'receipt-'+digest(key),'消息已送达后台，结果稍后返回本会话。',true);record.receipt='sent'}catch{record.receipt='uncertain'}
   ctx.store.put('wecom-inbox',key,record)
   for(const [i,asset] of assets.entries()){
    try{
     const d=downloads[i]!,downloaded=await this.download(d.url,d.key,this.options.downloadHosts,this.abort.signal),data=Buffer.isBuffer(downloaded)?downloaded:downloaded.buffer
     if(!Buffer.isBuffer(downloaded)&&downloaded.filename)asset.name=basename(downloaded.filename).slice(0,120)
     if(data.length>8_000_000)throw Error('Oversized media')
     const state=ctx.store.get<{config:{stateDir:string}}>('settings','current')?.config.stateDir
     if(!state)throw Error('Host state directory unavailable')
     const directory=join(state,'wecom-media',digest(key));mkdirSync(directory,{recursive:true,mode:0o700});const path=join(directory,String(i));writeFileSync(path,data,{mode:0o600});asset.path=path
    }catch{asset.error='Media could not be cached; temporary link may have expired or host is not allowed'}
    finally{ctx.store.put('wecom-inbox',key,record)}
   }
  }else for(const a of assets)a.error='Sender is not in the allowed list; media was not downloaded'
  this.ingest(record)
 }
 async context(thread:string){
  if(!this.validThread(thread)||!this.ctx)throw Error('WeCom conversation is not available')
  return this.ctx.store.list<Inbox>('wecom-inbox').filter(r=>r.trigger.source===this.config.id&&r.trigger.threads[0]?.id===thread).sort((a,b)=>a.receivedAt-b.receivedAt).slice(-20).map(r=>r.view)
 }
 async read(request:{resource:string;trigger?:Trigger;pageSize:number}){
  const t=request.trigger;if(!t||t.source!==this.config.id||!this.ctx)throw Error('An anchored WeCom trigger is required')
  if(!this.validThread(t.threads[0]?.id??''))throw Error('WeCom conversation is no longer configured')
  const r=this.ctx.store.get<Inbox>('wecom-inbox',String(t.meta.messageKey));if(!r||r.trigger.id!==t.id)throw Error('WeCom message unavailable')
  if(request.resource==='message')return {...r.view,assets:r.assets.map((a,i)=>({kind:a.kind,name:a.name,available:!!a.path,error:a.error,resource:'wecom/'+t.id+'/asset/'+i}))}
  if(request.resource==='conversation')return this.context(t.threads[0]!.id)
  const m=/^asset\/(\d+)$/.exec(request.resource),a=m?r.assets[Number(m[1])]:undefined
  if(!a?.path||!existsSync(a.path))throw Error(a?.error??'WeCom attachment unavailable')
  const data=readFileSync(a.path);if(data.length>8_000_000)throw Error('WeCom attachment exceeds 8 MB')
  return a.kind==='image'?imageResource(data):{kind:'file',name:a.name,data:data.toString('base64')}
 }
 async deliver(message:OutboundMessage){
  if(!this.config.enabled||!this.ctx||!this.client||!this.authenticated)throw Error('WeCom connection is not ready; nothing was sent')
  const r=this.ctx.store.get<Inbox>('wecom-inbox',message.channel.address.messageKey??'')
  if(!r||r.trigger.source!==this.config.id||r.trigger.channel?.thread!==message.channel.thread||r.trigger.channel.address.chat!==message.channel.address.chat)throw Error('WeCom delivery is outside the original conversation')
  if(!this.validThread(r.trigger.threads[0]?.id??''))throw Error('WeCom conversation is no longer configured; nothing was sent')
  const latest=Math.max(...this.ctx.store.list<Inbox>('wecom-inbox').filter(x=>x.trigger.source===this.config.id&&x.trigger.channel?.thread===r.trigger.channel!.thread).map(x=>x.receivedAt))
  if(Date.now()-latest>23.9*3600000)throw Error('WeCom active-message window expired; ask a person to send a fresh message before retrying')
  if(Buffer.byteLength(message.text)>20000)throw Error('WeCom reply exceeds the text limit; shorten it or deliver an artifact')
  try{await this.client.sendMessage(String(r.trigger.meta.chat),{msgtype:'markdown',markdown:{content:message.text}})}catch{throw new UncertainDelivery('WeCom send outcome unknown; check the conversation before an explicit retry')}
 }
 async close(){this.closing=true;this.abort.abort();this.client?.disconnect();await Promise.allSettled([...this.pending]);this.authenticated=false;this.health('stopped');this.ctx=undefined}
}
