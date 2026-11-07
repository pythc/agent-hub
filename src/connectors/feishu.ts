import {spawn,type ChildProcessWithoutNullStreams} from 'node:child_process'
import {createInterface} from 'node:readline'
import {imageResource} from '../resources.ts'
import { larkRequest } from './lark-cli.ts'
import { createHash } from 'node:crypto'
import { MessageSource, UncertainDelivery, bodyDigest, type SourceContext } from '../sources.ts'
import type { SourceConfig } from '../config.ts'
import type { Trigger, OutboundMessage } from '../vendor/dsh-core/index.ts'

export type FeishuRequest=(method:string,path:string,body?:unknown,signal?:AbortSignal)=>Promise<any>
export class FeishuSource extends MessageSource {
  override get verificationCommand(){return this.config.feishu?.command??'/agent'}
  replay(scope:string|undefined,since:string){if(!this.config.feishu!.chats.includes(scope??''))throw Error('Chat not configured');return {key:this.config.id+':'+scope,since:String(Math.floor(Date.parse(since)/1000))}}
  async check(){if((this.config.feishu!.otherChats==='mentions'||this.config.feishu!.directMessages)&&!this.config.feishu!.liveEvents)throw Error('Enable Feishu liveEvents for mentions from other chats')}
  private live?:ChildProcessWithoutNullStreams
  private closing=false
  private pendingEvents=Promise.resolve()
  private discovered=new Set<string>()
  private accessToken=''
  private expiresAt=0
  private readonly api:FeishuRequest
  constructor(config:SourceConfig,api?:FeishuRequest){super(config);if(!config.feishu)throw Error('Feishu configuration required');this.api=api??(config.feishu.cli?larkRequest(config.feishu.cli):this.request.bind(this))}
  private async request(method:string,path:string,body?:unknown,signal?:AbortSignal){
    signal?.throwIfAborted()
    const deadline=()=>signal?AbortSignal.any([signal,AbortSignal.timeout(15000)]):AbortSignal.timeout(15000)
    if(Date.now()>=this.expiresAt){
      const appId=process.env[this.config.feishu!.appIdEnv??""],secret=process.env[this.config.feishu!.appSecretEnv??""]
      if(!appId||!secret)throw Error('Feishu app credentials are not configured')
      const response=await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({app_id:appId,app_secret:secret}),signal:deadline()})
      const token=await response.json() as any
      if(token.code!==0||!token.tenant_access_token)throw Error('Feishu tenant authentication failed')
      this.accessToken=token.tenant_access_token;this.expiresAt=Date.now()+Math.max(1,token.expire-60)*1000
    }
    const response=await fetch('https://open.feishu.cn/open-apis/'+path,{method,headers:{authorization:'Bearer '+this.accessToken,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:deadline()})
    if(path.includes('/resources/')&&response.ok){if(Number(response.headers.get('content-length')??0)>8000000)throw Error('Resource exceeds 8 MB');const data=Buffer.from(await response.arrayBuffer());if(data.length>8000000)throw Error('Resource exceeds 8 MB');return {binary:data.toString('base64'),mimeType:response.headers.get('content-type')}}
    const result=await response.json() as any
    if(!response.ok||result.code!==0){if(result.code===99991663)this.expiresAt=0;throw Error('Feishu API failed: '+result.code)}
    return result.data
  }
  private permitted(chat:string){return this.config.feishu!.chats.includes(chat)||this.discovered.has(chat)}
  validThread(thread:string){const i=thread.indexOf(':');return i>0&&this.permitted(thread.slice(0,i))&&/^om_[A-Za-z0-9_-]+$/.test(thread.slice(i+1))}
  async identity(){
    const bot=await this.api('GET','bot/v3/info'),id=bot.bot?.open_id??bot.open_id??this.config.feishu!.mentionId
    if(this.config.feishu!.mentionId&&id!==this.config.feishu!.mentionId)throw Error('Bot identity does not match mentionId')
    return {id,type:'bot'}
  }
  async members(scope?:string){
    const chat=scope??this.config.feishu!.chats[0]!
    if(!this.config.feishu!.chats.includes(chat))throw Error('Member sync requires a configured chat')
    const members:any[]=[];let cursor=''
    for(let page=0;page<100;page++){
      const data=await this.api('GET','im/v1/chats/'+encodeURIComponent(chat)+'/members?member_id_type=open_id&page_size=100'+(cursor?'&page_token='+encodeURIComponent(cursor):''))
      members.push(...(data.items??[]).map((x:any)=>({id:x.member_id,name:x.name,bot:false})))
      if(!data.has_more)return members
      if(!data.page_token||data.page_token===cursor)throw Error('Member pagination did not advance')
      cursor=data.page_token
    }
    throw Error('Member directory pagination limit reached')
  }
  async receiveEvent(event:any,ctx:SourceContext){
    if(event.type!=='im.message.receive_v1'||!/^oc_[A-Za-z0-9_-]+$/.test(event.chat_id??'')||!/^om_[A-Za-z0-9_-]+$/.test(event.message_id??''))return
    const configured=this.config.feishu!.chats.includes(event.chat_id),mentioned=(event.mentions??[]).some((m:any)=>m.id===this.config.feishu!.mentionId)
    if(!configured&&!(this.config.feishu!.otherChats==='mentions'&&mentioned)&&!(this.config.feishu!.directMessages&&event.chat_type==='p2p'))return
    // Read the original for identical ids/content across live events and polling.
    if(!configured)this.discovered.add(event.chat_id)
    try{const item=await this.one(event.message_id);if(item.chat_id!==event.chat_id)throw Error('Event chat mismatch');const trigger=this.fromMessage(item,event.chat_id);if(trigger){trigger.meta.chatType=event.chat_type;if(event.chat_type==='p2p'&&this.config.feishu!.directMessages)trigger.addressed='direct';ctx.receive(trigger)}}
    catch(error){if(!configured)this.discovered.delete(event.chat_id);throw error}
  }
  start(ctx:SourceContext){
    for(const trigger of ctx.store.list<Trigger>('trigger'))if(trigger.source===this.config.id&&typeof trigger.meta.chat==='string'&&(this.config.feishu!.otherChats==='mentions'&&trigger.addressed||this.config.feishu!.directMessages&&trigger.meta.chatType==='p2p'))this.discovered.add(trigger.meta.chat)
    if(this.live||this.closing||!this.config.feishu!.liveEvents||!this.config.feishu!.cli)return
    const child=this.live=spawn(this.config.feishu!.cli,['event','consume','im.message.receive_v1','--as','bot'],{stdio:['pipe','pipe','pipe'],shell:false})
    let ready=false
    createInterface({input:child.stderr}).on('line',line=>{
      if(line.startsWith('[event] ready event_key=im.message.receive_v1')){ready=true;ctx.store.put('source-live',this.config.id,{status:'ready',at:Date.now()})}
      else if(line.includes('WARN')||line.startsWith('{'))ctx.store.put('source-live',this.config.id,{status:'warning',at:Date.now(),error:line.slice(0,300)})
    })
    createInterface({input:child.stdout}).on('line',line=>{
      this.pendingEvents=this.pendingEvents.then(async()=>{if(!ready)throw Error('Event arrived before ready marker');await this.receiveEvent(JSON.parse(line),ctx)}).catch(error=>{ctx.store.put('source-live',this.config.id,{status:'error',at:Date.now(),error:String(error).slice(0,300)})})
    })
    const timer=setTimeout(()=>{if(!ready){child.stdin.end();child.kill('SIGTERM')}},20000)
    child.on('error',error=>ctx.store.put('source-live',this.config.id,{status:'error',at:Date.now(),error:String(error).slice(0,300)}))
    child.on('close',code=>{clearTimeout(timer);this.live=undefined;if(!this.closing)ctx.store.put('source-live',this.config.id,{status:'disconnected',at:Date.now(),code})})
  }
  async close(){this.closing=true;const child=this.live;if(child)await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Feishu event consumer did not stop within 10 seconds')),10000);child.once('close',()=>{clearTimeout(timer);resolve()});child.stdin.end();child.kill('SIGTERM')});await this.pendingEvents}
  idempotencyKey(trigger:Trigger){return trigger.meta.messageId?this.config.id+':message:'+trigger.meta.messageId+':'+bodyDigest(trigger.text):trigger.id}
  private fromMessage(item:any,chat:string):Trigger|undefined{
    if(item.deleted)return
    let content:any
    const raw=item.body?.content??item.content??'{}'
    try{content=typeof raw==='string'&&raw.startsWith('{')?JSON.parse(raw):{text:String(raw)}}catch{return}
    const text=content.text??JSON.stringify(content)
    const addressed=String(content.text??'').includes(this.config.feishu!.command)||(item.mentions??[]).some((m:any)=>m.id===this.config.feishu!.mentionId||m.id?.open_id===this.config.feishu!.mentionId)
    const thread=item.root_id??item.message_id
    const actor=item.sender?.open_bot_id??item.sender?.id??item.sender?.sender_id?.open_id??'unknown'
    if(actor===this.config.feishu!.mentionId)return
    const human=item.sender?.sender_type?item.sender.sender_type==='user':!item.sender?.open_bot_id&&item.sender?.id_type==='open_id'
    const trigger=this.trigger({id:'message:'+item.message_id+':'+bodyDigest(text),thread:chat+':'+thread,text,addressed},actor,human)
    trigger.meta={scope:chat,messageId:item.message_id,chat,root:thread}
    trigger.channel!.address={messageId:item.message_id,chat,root:thread}
    return trigger
  }
  async poll(ctx:SourceContext):Promise<void>{
    for(const chat of this.config.feishu!.chats){
      const healthKey=this.config.id+':chat:'+chat
      try{
      const key=this.config.id+':'+chat
      const since=ctx.store.get<{since:string}>('source-cursor',key)?.since??String(Math.floor(Date.now()/1000)-10)
      if(!ctx.store.get('source-cursor',key))ctx.store.put('source-cursor',key,{since})
      const boundary=String(Math.floor(Date.now()/1000))
      let page='';const seen=new Set<string>()
      do{
        if(seen.has(page)||seen.size>=200)throw Error('Chat pagination did not advance');seen.add(page)
        const data=await this.api('GET','im/v1/messages?container_id_type=chat&container_id='+encodeURIComponent(chat)+'&start_time='+since+'&end_time='+boundary+'&sort_type=ByCreateTimeAsc&page_size=50'+(page?'&page_token='+encodeURIComponent(page):''),undefined,ctx.signal)
        for(const item of data.items??[]){const trigger=this.fromMessage(item,chat);if(trigger)ctx.receive(trigger)}
        page=data.has_more?data.page_token:''
      }while(page)
      ctx.store.put('source-cursor',key,{since:String(Number(boundary)-2)});ctx.store.put('thread-health',healthKey,{source:this.config.id,chat,at:Date.now(),consecutiveFailures:0})
      }catch(error){const previous=ctx.store.get<any>('thread-health',healthKey);ctx.store.put('thread-health',healthKey,{source:this.config.id,chat,at:Date.now(),consecutiveFailures:(previous?.consecutiveFailures??0)+1,error:String(error).slice(0,300)})}
    }
    {
      for(const thread of ctx.store.threads.list().filter(t=>t.ref.source===this.config.id&&t.subscriptions.length)){
        const separator=thread.ref.id.indexOf(':'),chat=thread.ref.id.slice(0,separator),root=thread.ref.id.slice(separator+1)
        if(!this.permitted(chat))continue
        const healthKey=this.config.id+':'+thread.ref.id
        try{
        let page='';const seen=new Set<string>()
        do{
          if(seen.has(page)||seen.size>=200)throw Error('Thread pagination did not advance');seen.add(page)
          const data=await this.threadPage(root,page,50,ctx.signal)
          for(const item of data.items??[]){const trigger=this.fromMessage({...item,root_id:root},chat);if(trigger)ctx.receive(trigger)}
          page=data.has_more?data.page_token:''
        }while(page)
        ctx.store.put('thread-health',healthKey,{source:this.config.id,thread:thread.key,at:Date.now(),consecutiveFailures:0})
        }catch(error){const previous=ctx.store.get<any>('thread-health',healthKey);ctx.store.put('thread-health',healthKey,{source:this.config.id,thread:thread.key,at:Date.now(),consecutiveFailures:(previous?.consecutiveFailures??0)+1,error:String(error).slice(0,300)})}
      }
    }
  }
  private async one(messageId:string){
    if(!/^om_[A-Za-z0-9_-]+$/.test(messageId))throw Error('Invalid Feishu message id')
    const data=await this.api('GET','im/v1/messages/'+encodeURIComponent(messageId))
    const item=(data.items??data.messages??[]).find((x:any)=>x.message_id===messageId)
    if(!item||!this.permitted(item.chat_id))throw Error('Message is outside configured chats or unavailable')
    return item
  }
  private async threadPage(root:string,cursor:string,pageSize:number,signal?:AbortSignal){
    if(this.config.feishu!.cli)return this.api('GET','typed/threads/'+encodeURIComponent(root)+(cursor?'?page_token='+encodeURIComponent(cursor):''),undefined,signal)
    const source=await this.one(root),threadId=source.thread_id
    if(!threadId)return {items:[],has_more:false}
    return this.api('GET','im/v1/messages?container_id_type=thread&container_id='+encodeURIComponent(threadId)+'&page_size='+pageSize+(cursor?'&page_token='+encodeURIComponent(cursor):''),undefined,signal)
  }
  async read(request:{resource:string;trigger?:Trigger;pageSize:number}){
    const trigger=request.trigger
    if(!trigger||trigger.source!==this.config.id||typeof trigger.meta.messageId!=='string')throw Error('An anchored Feishu trigger is required')
    const source=await this.one(trigger.meta.messageId)
    if(source.chat_id!==trigger.meta.chat)throw Error('Source chat changed')
    const [section,cursor]=request.resource.split('/')
    const view=(x:any)=>({id:x.message_id,from:x.sender?.id??x.sender?.open_bot_id,at:x.create_time,text:x.body?.content??x.content??'',reply_to:x.parent_id,root:x.root_id,thread:x.thread_id,bot:x.sender?.sender_type!=='user',deleted:x.deleted,url:x.message_app_link})
    if(['message','root','parent'].includes(section!)){
      const id=section==='root'?source.root_id:section==='parent'?source.parent_id:source.message_id
      if(!id)return {status:'no_'+section,message:null}
      const item=id===source.message_id?source:await this.one(id)
      if(item.chat_id!==source.chat_id)throw Error('Message is outside source chat')
      return {status:item.deleted?'deleted':'available',message:view(item)}
    }
    if(section==='thread'){
      const data=await this.threadPage(source.root_id??source.message_id,cursor?decodeURIComponent(cursor):'',request.pageSize)
      const items=data.items??data.messages??[]
      if(items.some((i:any)=>i.chat_id&&i.chat_id!==source.chat_id))throw Error('Thread crossed chat boundary')
      if(data.has_more&&(!data.page_token||data.page_token===cursor))throw Error('Thread pagination did not advance')
      return {messages:items.map(view),next_resource:data.has_more?'feishu/'+trigger.id+'/thread/'+encodeURIComponent(data.page_token):null}
    }
    if(section==='around'){
      const at=Number(source.create_time);if(!Number.isFinite(at))throw Error('Source timestamp unavailable')
      const path='im/v1/messages?container_id_type=chat&container_id='+encodeURIComponent(source.chat_id)+'&page_size=6'
      const before=await this.api('GET',path+'&end_time='+Math.ceil(at/1000)+'&sort_type=ByCreateTimeDesc')
      const after=await this.api('GET',path+'&start_time='+Math.floor(at/1000)+'&sort_type=ByCreateTimeAsc')
      const same=(items:any[])=>items.filter(x=>(!x.chat_id||x.chat_id===source.chat_id)&&x.message_id!==source.message_id)
      return {messages:[...same(before.items??[]).filter(x=>Number(x.create_time)<=at).slice(0,5).reverse(),source,...same(after.items??[]).filter(x=>Number(x.create_time)>=at).slice(0,5)].map(view)}
    }
    if(section==='image'||section==='file'){
      const content=String(source.body?.content??source.content??'')
      const keys=new Set(content.match(/(?:img|file)_[A-Za-z0-9_-]+/g)??[])
      if(!cursor||!keys.has(cursor))throw Error('Resource key was not returned in this source message')
      const data=await this.api('GET','im/v1/messages/'+source.message_id+'/resources/'+cursor+'?type='+(section==='image'?'image':'file'))
      const bytes=Buffer.from(data.binary,'base64');if(bytes.length>8000000)throw Error('Resource exceeds 8 MB')
      if(section==='image')return imageResource(bytes)
      let name=cursor;try{name=JSON.parse(content).file_name??cursor}catch{}
      return {kind:'file',name,data:data.binary}
    }
    throw Error('Unknown Feishu resource')
  }
  async context(thread:string){const separator=thread.indexOf(':');const chat=thread.slice(0,separator);if(!this.permitted(chat))throw Error('Chat not configured');return this.config.feishu!.cli?this.api('GET','typed/threads/'+encodeURIComponent(thread.slice(separator+1))):this.api('GET','im/v1/messages/'+encodeURIComponent(thread.slice(separator+1)))}
  async deliver(message:OutboundMessage):Promise<void>{
    const id=message.channel.address.messageId
    if(!id||!this.permitted(message.channel.address.chat!))throw Error('Feishu reply is outside configured chats')
    const uuid=createHash('sha256').update(message.id).digest('hex').slice(0,32)
    try{await this.api('POST','im/v1/messages/'+encodeURIComponent(id)+'/reply',{msg_type:'text',content:JSON.stringify({text:message.text}),reply_in_thread:true,uuid})}
    catch{throw new UncertainDelivery('Feishu reply outcome unknown; reconcile message before replay')}
  }
}
