import {record,records,recordPages} from '../records.ts'
import {spawn,type ChildProcessWithoutNullStreams} from 'node:child_process'
import {createInterface} from 'node:readline'
import {imageResource} from '../../src/resources.ts'
import { larkRequest } from './lark-cli.ts'
import { createHash } from 'node:crypto'
import { MessageSource, UncertainDelivery, bodyDigest, type SourceContext } from '../../src/sources.ts'
import type { SourceConfig } from '../../src/config.ts'
import type { Trigger, OutboundMessage } from '../../src/vendor/dsh-core/index.ts'

export type FeishuRequest=(method:string,path:string,body?:unknown,signal?:AbortSignal)=>Promise<any>
export class FeishuSource extends MessageSource {
  override get verificationCommand(){return this.config.feishu?.command??'/agent'}
  replay(scope:string|undefined,since:string){if(!this.config.feishu!.chats.includes(scope??''))throw Error('Chat not configured');return {key:this.config.id+':'+scope,since:String(Math.floor(Date.parse(since)/1000))}}
  async check(){if((this.config.feishu!.otherChats==='mentions'||this.config.feishu!.directMessages)&&!this.config.feishu!.liveEvents)throw Error('Enable Feishu liveEvents for mentions from other chats')}
  private live=new Map<string,ChildProcessWithoutNullStreams>()
  private sourceContext?:SourceContext
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
    if(path==='bot/v3/info')return {bot:result.bot??result.data?.bot}
    return result.data
  }
  private permitted(chat:string){return this.config.feishu!.chats.includes(chat)||this.discovered.has(chat)}
  validThread(thread:string){const i=thread.indexOf(':');return i>0&&this.permitted(thread.slice(0,i))&&/^om_[A-Za-z0-9_-]+$/.test(thread.slice(i+1))}
  async identity(){
    const bot=await this.api('GET','bot/v3/info'),id=bot.bot?.open_id??bot.open_id
    if(this.config.feishu!.mentionId&&id!==this.config.feishu!.mentionId)throw Error('Bot identity does not match mentionId')
    if(typeof id!=='string'||!/^ou_[A-Za-z0-9_-]+$/.test(id))throw Error('Bot identity readback is unavailable')
    return {id,type:'bot',verified:true}
  }
  private async verifiedAccount(ctx?:SourceContext){
    const expected=ctx?.store.get<any>('source-identity',this.config.id)
    if(!expected)return
    let identity:{id:string;type:string;verified:boolean}
    try{identity=await this.identity()}catch(error){if(!String(error).includes('Bot identity does not match mentionId'))throw error;identity={id:'configured-mention-mismatch',type:'bot',verified:false}}
    if(identity.id!==expected.principal){
      for(const chat of this.config.feishu!.chats){const key=this.config.id+':account-mismatch:'+expected.principal+':'+identity.id+':'+chat;const at=ctx!.store.get<number>('source-identity-mismatch',key)??Date.now();ctx!.store.put('source-identity-mismatch',key,at);ctx!.change?.({id:key,kind:'entry.unavailable',scope:chat,at})}
      throw Error('Verified connection account changed; use a separately bound source')
    }
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
    this.sourceContext=ctx
    if(event.header?.event_type){await this.verifiedAccount(ctx);this.lifecycleEvent(event,ctx);return}
    if(event.type!=='im.message.receive_v1'||!/^oc_[A-Za-z0-9_-]+$/.test(event.chat_id??'')||!/^om_[A-Za-z0-9_-]+$/.test(event.message_id??''))return
    const configured=this.config.feishu!.chats.includes(event.chat_id),mentioned=(event.mentions??[]).some((m:any)=>m.id===this.config.feishu!.mentionId)
    if(!configured&&!(this.config.feishu!.otherChats==='mentions'&&mentioned)&&!(this.config.feishu!.directMessages&&event.chat_type==='p2p'))return
    // Read the original for identical ids/content across live events and polling.
    if(!configured)this.discovered.add(event.chat_id)
    try{const item=await this.one(event.message_id);if(item.chat_id!==event.chat_id)throw Error('Event chat mismatch');const trigger=await this.acceptItem(item,event.chat_id,ctx);if(trigger){trigger.meta.chatType=event.chat_type;if(event.chat_type==='p2p'&&this.config.feishu!.directMessages)trigger.addressed='direct';ctx.receive(trigger)}}
    catch(error){if(!configured)this.discovered.delete(event.chat_id);throw error}
  }
  private lifecycleEvent(value:any,ctx:SourceContext){
    if(!ctx.change||this.config.feishu!.lifecycleEvents===false)return
    const header=value.header,event=value.event,key=header?.event_type
    if(!header?.event_id||!event||!this.config.feishu!.chats.includes(event.chat_id))return
    const at=Number(header.create_time);if(!Number.isSafeInteger(at)||at<0)throw Error('Lifecycle timestamp is unavailable')
    const base={id:header.event_id,scope:event.chat_id,at}
    if(key==='im.chat.disbanded_v1'||key==='im.chat.member.bot.deleted_v1')ctx.change({...base,kind:'entry.unavailable'})
    else if(key==='im.chat.member.bot.added_v1')ctx.change({...base,kind:'entry.available'})
    else if(['im.chat.member.user.added_v1','im.chat.member.user.deleted_v1'].includes(key)){
      const actors=(event.users??[]).map((u:any)=>u.user_id?.open_id).filter((id:any)=>typeof id==='string'&&/^ou_[A-Za-z0-9_-]+$/.test(id))
      if(actors.length)ctx.change({...base,kind:key.endsWith('added_v1')?'member.added':'member.removed',actorIds:actors})
      else throw Error('Member lifecycle event lacks verified open IDs')
    }else if(key==='im.chat.updated_v1'){
      const after=event.after_change??{},permissions=Object.keys(after).filter(k=>/permission|restricted|visibility|owner_id|group_message_type|membership/.test(k))
      if(permissions.length)ctx.change({...base,kind:'entry.permissions_changed'})
      if(typeof after.name==='string')ctx.store.put('entry-label',this.config.id+':'+event.chat_id,{sourceId:this.config.id,nativeId:event.chat_id,name:after.name})
    }
  }
  start(ctx:SourceContext){
    this.sourceContext=ctx
    for(const trigger of ctx.store.list<Trigger>('trigger'))if(trigger.source===this.config.id&&typeof trigger.meta.chat==='string'&&(this.config.feishu!.otherChats==='mentions'&&trigger.addressed||this.config.feishu!.directMessages&&trigger.meta.chatType==='p2p'))this.discovered.add(trigger.meta.chat)
    if(this.closing||!this.config.feishu!.liveEvents||!this.config.feishu!.cli)return
    const keys=['im.message.receive_v1',...(ctx.change&&this.config.feishu!.lifecycleEvents!==false?['im.chat.updated_v1','im.chat.disbanded_v1','im.chat.member.bot.deleted_v1','im.chat.member.bot.added_v1','im.chat.member.user.deleted_v1','im.chat.member.user.added_v1']:[])]
    for(const key of keys){
      if(this.live.has(key))continue
      const health=key==='im.message.receive_v1'?this.config.id:this.config.id+':'+key,child=spawn(this.config.feishu!.cli,['event','consume',key,'--as','bot'],{stdio:['pipe','pipe','pipe'],shell:false})
      this.live.set(key,child);let ready=false,stderr=''
      child.stderr.on('data',chunk=>{stderr=(stderr+String(chunk)).slice(-65536)})
      createInterface({input:child.stderr}).on('line',line=>{
        if(line.startsWith('[event] ready event_key='+key)){ready=true;ctx.store.put('source-live',health,{status:'ready',event:key,at:Date.now()})}
        else if(line.includes('WARN')||line.startsWith('{'))ctx.store.put('source-live',health,{status:'warning',event:key,at:Date.now(),error:line.slice(0,300)})
      })
      createInterface({input:child.stdout}).on('line',line=>{this.pendingEvents=this.pendingEvents.then(async()=>{if(!ready)throw Error('Event arrived before ready marker');await this.receiveEvent(JSON.parse(line),ctx)}).catch(error=>{ctx.store.put('source-live',health,{status:'error',event:key,at:Date.now(),error:String(error).slice(0,300)})})})
      const timer=setTimeout(()=>{if(!ready){child.stdin.end();child.kill('SIGTERM')}},20000)
      child.on('error',error=>ctx.store.put('source-live',health,{status:'error',event:key,at:Date.now(),error:String(error).slice(0,300)}))
      child.on('close',code=>{
        clearTimeout(timer);this.live.delete(key)
        if(this.closing)return
        const previous=ctx.store.get<any>('source-live',health)
        let diagnostic:Record<string,string>|undefined
        try{const e=JSON.parse(stderr.slice(stderr.indexOf('{'),stderr.lastIndexOf('}')+1)).error;if(e)diagnostic=Object.fromEntries(['type','subtype','message','hint'].filter(k=>typeof e[k]==='string').map(k=>[k,e[k].slice(0,2000)]))}catch{}
        ctx.store.put('source-live',health,{...previous,status:code===0?'disconnected':'error',event:key,at:Date.now(),code,...(diagnostic?{diagnostic,error:diagnostic.message}:{}),readyObserved:ready})
      })
    }
  }
  async close(){this.closing=true;await Promise.all([...this.live.values()].map(child=>new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Feishu event consumer did not stop within 10 seconds')),10000);child.once('close',()=>{clearTimeout(timer);resolve()});child.stdin.end();child.kill('SIGTERM')})));await this.pendingEvents}
  private text(item:any):string|undefined{
    const raw=item.body?.content??item.content??'{}'
    try{const content=typeof raw==='string'&&raw.startsWith('{')?JSON.parse(raw):{text:String(raw)};return content.text??JSON.stringify(content)}catch{return}
  }
  private async observe(item:any,chat:string,ctx:SourceContext){
    if(!ctx.change||this.config.feishu!.lifecycleEvents===false)return false
    const key=this.config.id+':'+item.message_id,old=await record<any>(ctx,'source-message-observation',key),known=(await records<Trigger>(ctx,'trigger',{sourceId:this.config.id,scope:chat,messageIds:[item.message_id]})).items.map(r=>r.value).filter(t=>t.source===this.config.id)
    const text=this.text(item);if(text===undefined&&!item.deleted)return false
    const hash=bodyDigest(text??''),previousHash=old?.hash??(known[0]?bodyDigest(known[0].text):undefined)
    const revised=!!old?.revised||previousHash!==undefined&&(hash!==previousHash||!!item.deleted!==!!old?.deleted)
    const version=Number(item.update_time??item.create_time),at=Number.isSafeInteger(version)&&version>=0?version:Date.now()
    if(old?.version>at)return true
    if(known.length&&(previousHash!==hash||!!item.deleted!==!!old?.deleted))ctx.change({id:'message:'+item.message_id+':'+at+':'+hash+':'+!!item.deleted,kind:item.deleted?'message.deleted':'message.updated',scope:chat,messageId:item.message_id,contentHash:hash,at})
    ctx.store.put('source-message-observation',key,{sourceId:this.config.id,scope:chat,messageId:item.message_id,hash,deleted:!!item.deleted,revised,version:at,checkedAt:Date.now()})
    return revised
  }
  private async acceptItem(item:any,chat:string,ctx:SourceContext){return await record(ctx,'source-message-state',bodyDigest([this.config.id,chat,item.message_id]))||await this.observe(item,chat,ctx)?undefined:this.fromMessage(item,chat)}
  private async refreshKnown(ctx:SourceContext){
    if(!ctx.change||this.config.feishu!.lifecycleEvents===false)return
    const cursor=ctx.store.get<string>('plugin-state',this.config.id+':historyCursor'),page=await records<Trigger>(ctx,'trigger',{sourceId:this.config.id,cursor,limit:this.config.feishu!.historyCheckLimit??20})
    for(const t of page.items.map(r=>r.value).filter(t=>t.source===this.config.id&&typeof t.meta.messageId==='string'&&this.config.feishu!.chats.includes(String(t.meta.chat)))){
      const observation=await record<any>(ctx,'source-message-observation',this.config.id+':'+t.meta.messageId)
      if(Date.now()-(observation?.checkedAt??0)<(this.config.feishu!.historyCheckSeconds??60)*1000)continue
      const key=this.config.id+':'+t.meta.messageId
      try{const item=await this.one(t.meta.messageId as string);await this.observe(item,String(t.meta.chat),ctx);ctx.store.put('source-freshness',key,{sourceId:this.config.id,triggerId:t.id,status:'verified',checkedAt:Date.now()})}
      catch(error){ctx.store.put('source-freshness',key,{sourceId:this.config.id,triggerId:t.id,status:'unavailable',checkedAt:Date.now(),error:String(error).slice(0,300)});const old=await record<any>(ctx,'source-message-observation',key)??{};ctx.store.put('source-message-observation',key,{...old,checkedAt:Date.now()})}
    }
    ctx.store.put('plugin-state',this.config.id+':historyCursor',page.next??'')
  }
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
    this.sourceContext=ctx
    await this.verifiedAccount(ctx)
    for(const chat of this.config.feishu!.chats){
      const healthKey=this.config.id+':chat:'+chat
      try{
      const key=this.config.id+':'+chat
      const since=ctx.store.get<{since:string}>('source-cursor',key)?.since??String(Math.floor(Date.now()/1000)-10)
      if(!ctx.store.get('source-cursor',key))ctx.store.put('source-cursor',key,{since})
      const progressKey=this.config.id+':history:'+chat,saved=ctx.store.get<any>('plugin-state',progressKey),window=saved?.since===since?saved:{since,boundary:String(Math.floor(Date.now()/1000)),page:''}
      const boundary=window.boundary
      let page=window.page;const seen=new Set<string>()
      for(let count=0;count<5;count++){
        if(seen.has(page))throw Error('Chat pagination did not advance');seen.add(page)
        const data=await this.api('GET','im/v1/messages?container_id_type=chat&container_id='+encodeURIComponent(chat)+'&start_time='+since+'&end_time='+boundary+'&sort_type=ByCreateTimeAsc&page_size=50'+(page?'&page_token='+encodeURIComponent(page):''),undefined,ctx.signal)
        for(const item of data.items??[]){const trigger=await this.acceptItem(item,chat,ctx);if(trigger)ctx.receive(trigger)}
        await ctx.checkpoint?.()
        if(data.has_more&&!data.page_token)throw Error('Feishu pagination is incomplete')
        const next=data.has_more?data.page_token:''
        if(next&&next===page)throw Error('Chat pagination did not advance')
        ctx.store.put('plugin-state',progressKey,next?{...window,page:next}:null)
        if(!next)ctx.store.put('source-cursor',key,{since:String(Number(boundary)-2)})
        await ctx.checkpoint?.();page=next;if(!page)break
      }
      ctx.store.put('thread-health',healthKey,{source:this.config.id,chat,at:Date.now(),consecutiveFailures:0})
      }catch(error){const previous=await record<any>(ctx,'thread-health',healthKey);ctx.store.put('thread-health',healthKey,{source:this.config.id,chat,at:Date.now(),consecutiveFailures:(previous?.consecutiveFailures??0)+1,error:String(error).slice(0,300)})}
    }
    {
      for await(const threads of recordPages(ctx,'thread',{sourceId:this.config.id,subscribed:true}))for(const thread of threads.filter(t=>t.ref.source===this.config.id)){
        const separator=thread.ref.id.indexOf(':'),chat=thread.ref.id.slice(0,separator),root=thread.ref.id.slice(separator+1)
        if(!this.permitted(chat))continue
        const healthKey=this.config.id+':'+thread.ref.id
        try{
        const progressKey=this.config.id+':thread:'+thread.ref.id
        let page=ctx.store.get<string>('plugin-state',progressKey)??'';const seen=new Set<string>()
        for(let count=0;count<5;count++){
          if(seen.has(page))throw Error('Thread pagination did not advance');seen.add(page)
          const data=await this.threadPage(root,page,50,ctx.signal)
          for(const item of data.items??[]){const trigger=await this.acceptItem({...item,root_id:root},chat,ctx);if(trigger)ctx.receive(trigger)}
          await ctx.checkpoint?.()
        if(data.has_more&&!data.page_token)throw Error('Feishu pagination is incomplete')
          const next=data.has_more?data.page_token:''
          if(next&&next===page)throw Error('Thread pagination did not advance')
          ctx.store.put('plugin-state',progressKey,next);await ctx.checkpoint?.();page=next;if(!page)break
        }
        ctx.store.put('thread-health',healthKey,{source:this.config.id,thread:thread.key,at:Date.now(),consecutiveFailures:0})
        }catch(error){const previous=await record<any>(ctx,'thread-health',healthKey);ctx.store.put('thread-health',healthKey,{source:this.config.id,thread:thread.key,at:Date.now(),consecutiveFailures:(previous?.consecutiveFailures??0)+1,error:String(error).slice(0,300)})}
      }
    }
    await this.refreshKnown(ctx)
  }
  private async one(messageId:string){
    if(!/^om_[A-Za-z0-9_-]+$/.test(messageId))throw Error('Invalid Feishu message id')
    await this.verifiedAccount(this.sourceContext)
    const data=await this.api('GET','im/v1/messages/'+encodeURIComponent(messageId))
    const item=(data.items??data.messages??[]).find((x:any)=>x.message_id===messageId)
    if(!item||!this.permitted(item.chat_id))throw Error('Message is outside configured chats or unavailable')
    if(this.sourceContext){
      await this.observe(item,item.chat_id,this.sourceContext)
      const latest=await record<any>(this.sourceContext,'source-message-state',bodyDigest([this.config.id,item.chat_id,messageId]))
      if(latest&&(latest.deleted&&!item.deleted||latest.contentHash&&latest.contentHash!==bodyDigest(this.text(item)??'')))throw Error('Message readback is older than the verified source revision')
    }
    return item
  }
  private async threadPage(root:string,cursor:string,pageSize:number,signal?:AbortSignal){
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
    const original=await this.one(id),chat=message.channel.address.chat,root=original.root_id??original.message_id
    if(original.chat_id!==chat||message.channel.source!==this.config.id||message.channel.thread!==chat+':'+root)throw Error('Feishu reply destination does not match its authorized thread')
    const uuid=createHash('sha256').update(message.id).digest('hex').slice(0,32)
    try{await this.api('POST','im/v1/messages/'+encodeURIComponent(id)+'/reply',{msg_type:'text',content:JSON.stringify({text:message.text}),reply_in_thread:true,uuid})}
    catch{throw new UncertainDelivery('Feishu reply outcome unknown; reconcile message before replay')}
  }
}
