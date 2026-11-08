import {record,recordPages} from '../records.ts'
import {createHash} from 'node:crypto'
import {MessageSource,UncertainDelivery,bodyDigest,type SourceContext} from '../../src/sources.ts'
import type {SourceConfig} from '../../src/config.ts'
import type {Trigger,OutboundMessage} from '../../src/vendor/dsh-core/index.ts'

type Request=(method:string,operation:string,input?:Record<string,unknown>)=>Promise<any>
interface Options {channels:string[];tokenEnv:string;teamId:string;command?:string;apiBase?:string;appTokenEnv?:string}
const timestamp=(value:unknown)=>typeof value==='string'&&/^\d{10,}\.[0-9]{6}$/.test(value)
export class SlackSource extends MessageSource {
  private socket?:WebSocket
  private pendingEvents:Promise<void>=Promise.resolve()
  private closing=false
  private api:Request
  private current?:SourceContext
  private account?:{id:string;type:string;verified:true;user:string}
  private get options(){return this.config.options as unknown as Options}
  override get verificationCommand(){return this.options.command??'/agent'}
  constructor(config:SourceConfig,api?:Request){super(config);this.api=api??this.request.bind(this)}
  private async request(method:string,operation:string,input:Record<string,unknown>={}){
    if(!/^[a-z]+(?:\.[a-zA-Z]+)+$/.test(operation))throw Error('Invalid Slack API operation')
    const token=process.env[operation==='apps.connections.open'?(this.options.appTokenEnv??''):this.options.tokenEnv];if(!token)throw Error('Slack credential is unavailable')
    const base=new URL(this.options.apiBase??'https://slack.com/api/')
    if(base.href!=='https://slack.com/api/'&&!(base.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(base.hostname)))throw Error('Slack API must use its official origin or a local test service')
    const url=new URL(operation,base)
    if(method==='GET')for(const [key,value] of Object.entries(input))if(value!==undefined)url.searchParams.set(key,String(value))
    const response=await fetch(url,{method,headers:{authorization:'Bearer '+token,'content-type':'application/json; charset=utf-8'},...(method==='POST'?{body:JSON.stringify(input)}:{}),redirect:'error',signal:AbortSignal.timeout(15000)})
    if(response.status===429){const after=Number(response.headers.get('retry-after'));if(this.current&&Number.isFinite(after))this.current.store.put('plugin-state','retryAt',Date.now()+Math.min(86400,Math.max(1,after))*1000);throw Error('Slack rate limited')}
    const result=await response.json() as any
    if(!response.ok||!result.ok)throw Error('Slack API rejected operation: '+String(result.error??response.status).slice(0,80))
    return result
  }
  private allowed(channel:string){return this.options.channels.includes(channel)}
  validThread(thread:string){const i=thread.indexOf(':');return i>0&&this.allowed(thread.slice(0,i))&&timestamp(thread.slice(i+1))}
  async identity(){
    const identity=await this.api('POST','auth.test')
    if(identity.team_id!==this.options.teamId||!identity.user_id)throw Error('Slack workspace identity mismatch')
    this.account={id:identity.team_id+':'+identity.user_id,type:identity.bot_id?'bot':'user',verified:true,user:identity.user_id}
    const saved=this.current?.store.get<any>('source-identity',this.config.id)
    if(saved&&saved.principal!==this.account.id)throw Error('Slack connection account changed')
    return this.account
  }
  async probe(){
    const identity=await this.identity(),choices:any[]=[];let cursor=''
    for(let page=0;page<100;page++){
      const data=await this.api('GET','conversations.list',{limit:100,exclude_archived:true,types:'public_channel,private_channel',...(cursor?{cursor}:{})})
      for(const channel of data.channels??[])if(channel.is_member)choices.push({id:channel.id,label:channel.name??channel.id})
      const next=data.response_metadata?.next_cursor??'';if(!next)return {identity,choices}
      if(next===cursor)throw Error('Slack pagination did not advance');cursor=next
    }
    throw Error('Slack directory exceeds pagination limit')
  }
  async members(channel=this.options.channels[0]!){
    if(!this.allowed(channel))throw Error('Channel is outside connection')
    const result:any[]=[];let cursor=''
    for(let page=0;page<100;page++){
      const data=await this.api('GET','conversations.members',{channel,limit:100,...(cursor?{cursor}:{})})
      for(const id of data.members??[]){const user=await this.api('GET','users.info',{user:id});if(typeof user.user?.is_bot!=='boolean')throw Error('Slack member type is unavailable');result.push({id,name:user.user.real_name??user.user.name,bot:user.user.is_bot})}
      const next=data.response_metadata?.next_cursor??'';if(!next)return result
      if(next===cursor)throw Error('Slack pagination did not advance');cursor=next
    }
    throw Error('Slack membership exceeds pagination limit')
  }
  private async message(item:any,channel:string,ctx:SourceContext):Promise<Trigger|undefined> {
    if(!timestamp(item.ts)||typeof item.text!=='string'||!item.user||item.user===this.account?.user)return
    const root=item.thread_ts??item.ts;if(!timestamp(root))throw Error('Invalid Slack thread timestamp')
    const hash=bodyDigest(item.text),key=this.config.id+':'+channel+':'+item.ts,old=await record<any>(ctx,'source-message-observation',key)
    if(old?.revised||await record(ctx,'source-message-state',bodyDigest([this.config.id,channel,item.ts])))return
    if(old&&old.hash!==hash){ctx.change?.({id:'edit:'+channel+':'+item.ts+':'+hash,kind:'message.updated',scope:channel,messageId:item.ts,contentHash:hash,at:Math.floor(Number(item.edited?.ts??item.ts)*1000)});ctx.store.put('source-message-observation',key,{sourceId:this.config.id,scope:channel,messageId:item.ts,hash,revised:true});return}
    if(old?.revised)return
    ctx.store.put('source-message-observation',key,{sourceId:this.config.id,scope:channel,messageId:item.ts,hash})
    const addressed=item.text.includes('<@'+this.account?.user+'>')||item.text.startsWith(this.verificationCommand)
    const t=this.trigger({id:'message:'+channel+':'+item.ts+':'+hash,thread:channel+':'+root,text:item.text,addressed,scope:channel,at:new Date(Math.floor(Number(item.ts)*1000)).toISOString()},item.user,!item.bot_id&&!item.subtype)
    t.meta={scope:channel,chat:channel,messageId:item.ts,root,team:this.options.teamId}
    t.channel!.address={chat:channel,root,messageId:item.ts}
    return t
  }
  async start(context:SourceContext){
    this.current=context
    if(this.closing||!this.options.appTokenEnv||this.socket?.readyState===WebSocket.OPEN||this.socket?.readyState===WebSocket.CONNECTING)return
    await this.identity()
    const result=await this.api('POST','apps.connections.open'),url=new URL(result.url)
    if(!(url.protocol==='wss:'&&(url.hostname==='slack.com'||url.hostname.endsWith('.slack.com')))&&!(this.options.apiBase&&url.protocol==='ws:'&&['127.0.0.1','localhost'].includes(url.hostname)))throw Error('Invalid Slack event socket origin')
    const socket=new WebSocket(url);this.socket=socket
    socket.addEventListener('message',event=>{
      if(this.closing)return
      this.pendingEvents=this.pendingEvents.then(async()=>{
        if(String(event.data).length>1000000)throw Error('Slack event exceeds limit')
        const envelope=JSON.parse(String(event.data))
        if(envelope.type==='disconnect'){socket.close();return}
        if(envelope.type!=='events_api'||typeof envelope.envelope_id!=='string')return
        await this.receiveEnvelope(envelope.payload,context)
        await context.checkpoint?.()
        if(socket.readyState===WebSocket.OPEN)socket.send(JSON.stringify({envelope_id:envelope.envelope_id}))
      }).catch(()=>{if(this.closing)return;context.store.put('source-live',this.config.id,{status:'error',at:Date.now()});socket.close()})
    })
    socket.addEventListener('error',()=>{if(this.closing)return;context.store.put('source-live',this.config.id,{status:'error',at:Date.now()});socket.close()})
    socket.addEventListener('close',()=>{if(this.socket===socket){this.socket=undefined;if(this.closing)return;context.store.put('source-live',this.config.id,{status:'disconnected',at:Date.now()})}})
    await new Promise<void>((resolve,reject)=>{
      const timer=setTimeout(()=>{socket.close();reject(Error('Slack event socket timed out'))},10000)
      socket.addEventListener('open',()=>{clearTimeout(timer);context.store.put('source-live',this.config.id,{status:'ready',at:Date.now()});resolve()},{once:true})
      socket.addEventListener('error',()=>{clearTimeout(timer);reject(Error('Slack event socket failed'))},{once:true})
    })
  }
  async receiveEnvelope(payload:any,context:SourceContext){
    if(payload?.team_id!==this.options.teamId||typeof payload.event_id!=='string')throw Error('Slack event workspace is unverified')
    const event=payload.event,scope=event?.channel
    if(!this.allowed(scope))return
    const at=Math.floor(Number(event.event_ts??payload.event_time)*1000)
    if(!Number.isSafeInteger(at)||at<0)throw Error('Slack event time is invalid')
    const base={id:payload.event_id,scope,at}
    if(event.type==='message'){
      if(event.subtype==='message_deleted'||event.subtype==='message_changed'){
        const messageId=event.subtype==='message_deleted'?event.deleted_ts:event.message?.ts
        if(!timestamp(messageId))throw Error('Invalid Slack lifecycle message')
        context.store.put('source-message-observation',this.config.id+':'+scope+':'+messageId,{sourceId:this.config.id,scope,messageId,revised:true,deleted:event.subtype==='message_deleted'})
        context.change?.({...base,kind:event.subtype==='message_deleted'?'message.deleted':'message.updated',messageId,...(event.subtype==='message_changed'?{contentHash:bodyDigest(event.message.text??'')}:{})})
      }
      else {const trigger=await this.message(event,scope,context);if(trigger)context.receive(trigger)}
    }else if(event.type==='member_joined_channel'||event.type==='member_left_channel'){
      if(event.user===this.account?.user)context.change?.({...base,kind:event.type==='member_left_channel'?'entry.unavailable':'entry.available'})
      else if(typeof event.user==='string')context.change?.({...base,kind:event.type==='member_left_channel'?'member.removed':'member.added',actorIds:[event.user]})
    }else if(event.type==='channel_archive'||event.type==='channel_unarchive')context.change?.({...base,kind:event.type==='channel_archive'?'entry.unavailable':'entry.available'})
  }
  async close(){
    this.closing=true;await this.pendingEvents
    const socket=this.socket;this.socket=undefined
    if(socket&&socket.readyState!==WebSocket.CLOSED)await new Promise<void>(resolve=>{const timer=setTimeout(resolve,2000);socket.addEventListener('close',()=>{clearTimeout(timer);resolve()},{once:true});socket.close()})
  }
  async poll(context:SourceContext){
    this.current=context
    if((context.store.get<number>('plugin-state','retryAt')??0)>Date.now())throw Error('Slack retry window has not elapsed')
    await this.identity()
    for(const channel of this.options.channels){
      const key=this.config.id+':'+channel,old=context.store.get<{since:string}>('source-cursor',key)?.since??String(Math.floor(Date.now()/1000)-10)
      if(!context.store.get('source-cursor',key))context.store.put('source-cursor',key,{since:old})
      const progressKey='history:'+channel,saved=context.store.get<any>('plugin-state',progressKey)
      const window=saved?.old===old?saved:{old,boundary:String(Math.floor(Date.now()/1000)),cursor:''}
      let cursor=window.cursor;const seen=new Set<string>()
      for(let page=0;page<5;page++){
        if(seen.has(cursor))throw Error('Slack history pagination did not advance');seen.add(cursor)
        const data=await this.api('GET','conversations.history',{channel,oldest:window.old,latest:window.boundary,inclusive:true,limit:100,...(cursor?{cursor}:{})})
        for(const item of [...data.messages??[]].reverse()){const t=await this.message(item,channel,context);if(t)context.receive(t)}
        const next=data.response_metadata?.next_cursor??''
        if(data.has_more&&!next)throw Error('Slack history is incomplete')
        if(next===cursor&&next)throw Error('Slack history pagination did not advance')
        context.store.put('plugin-state',progressKey,next?{...window,cursor:next}:null)
        if(!next)context.store.put('source-cursor',key,{since:String(Number(window.boundary)-2)})
        await context.checkpoint?.();cursor=next;if(!cursor)break
      }
    }
    for await(const threads of recordPages(context,'thread',{sourceId:this.config.id,subscribed:true}))for(const thread of threads.filter(t=>t.ref.source===this.config.id)){
      if(!this.validThread(thread.ref.id))continue
      const split=thread.ref.id.indexOf(':'),channel=thread.ref.id.slice(0,split),ts=thread.ref.id.slice(split+1)
      const progressKey='thread:'+thread.ref.id,window=context.store.get<any>('plugin-state',progressKey)??{boundary:String(Math.floor(Date.now()/1000)),cursor:undefined}
      let cursor:string|undefined=window.cursor;const seen=new Set<string>()
      for(let page=0;page<5;page++){
        const data=await this.thread(channel,ts,100,cursor,window.boundary)
        for(const item of data.messages??[]){const t=await this.message(item,channel,context);if(t)context.receive(t)}
        const next=data.response_metadata?.next_cursor
        if(data.has_more&&!next||next&&(seen.has(next)||next===cursor))throw Error('Slack thread pagination did not advance')
        context.store.put('plugin-state',progressKey,next?{...window,cursor:next}:null)
        await context.checkpoint?.();if(next)seen.add(next);cursor=next;if(!cursor)break
      }
    }
  }
  private async thread(channel:string,ts:string,limit:number,cursor?:string,latest?:string){
    if(!this.allowed(channel)||!timestamp(ts))throw Error('Slack thread is outside connection')
    return this.api('GET','conversations.replies',{channel,ts,limit,...(cursor?{cursor}:{}),...(latest?{latest}:{})})
  }
  async read({resource,trigger,pageSize}:{resource:string;trigger?:Trigger;pageSize:number}){
    if(!trigger||trigger.source!==this.config.id||!this.allowed(String(trigger.meta.chat)))throw Error('An authorized Slack source message is required')
    await this.identity()
    const [kind,cursor]=resource.split('/'),channel=String(trigger.meta.chat),root=String(trigger.meta.root)
    if(kind==='message'){
      const data=await this.api('GET','conversations.replies',{channel,ts:root,oldest:trigger.meta.messageId,latest:trigger.meta.messageId,inclusive:true,limit:100}),message=data.messages?.find((m:any)=>m.ts===trigger.meta.messageId)
      if(!message)throw Error('Slack message is unavailable')
      if(bodyDigest(message.text??'')!==bodyDigest(trigger.text))throw Error('Slack source message changed')
      return {message}
    }
    if(kind==='thread'){
      const data=await this.thread(channel,root,pageSize,cursor?decodeURIComponent(cursor):undefined)
      if(data.has_more&&!data.response_metadata?.next_cursor)throw Error('Slack thread pagination is incomplete')
      return {messages:data.messages,next_resource:data.response_metadata?.next_cursor?'trigger-source/'+trigger.id+'/thread/'+encodeURIComponent(data.response_metadata.next_cursor):null}
    }
    throw Error('Unknown Slack resource')
  }
  async context(thread:string){if(!this.validThread(thread))throw Error('Thread is outside connection');const i=thread.indexOf(':');return this.thread(thread.slice(0,i),thread.slice(i+1),50)}
  async deliver(message:OutboundMessage){
    const {chat,root}=message.channel.address
    if(!chat||!this.allowed(chat)||!timestamp(root)||message.channel.source!==this.config.id||message.channel.thread!==chat+':'+root)throw Error('Slack reply is outside connection')
    await this.identity()
    // client_msg_id aids reconciliation; it does not promise exactly-once delivery.
    const h=createHash('sha256').update(message.id).digest('hex'),client_msg_id=h.slice(0,8)+'-'+h.slice(8,12)+'-4'+h.slice(13,16)+'-a'+h.slice(17,20)+'-'+h.slice(20,32)
    try{const sent=await this.api('POST','chat.postMessage',{channel:chat,thread_ts:root,text:message.text,client_msg_id,unfurl_links:false,unfurl_media:false});if(sent.channel!==chat||!timestamp(sent.ts))throw Error('Invalid Slack delivery receipt')}
    catch{throw new UncertainDelivery('Slack reply outcome unknown; reconcile destination before retry')}
  }
}
export default {create:(config:SourceConfig)=>new SlackSource(config)}
