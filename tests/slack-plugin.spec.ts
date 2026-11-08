import {it,expect,afterEach} from 'vitest'
import {mkdtempSync,rmSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {SlackSource} from '../plugins/slack/index.ts'
import {configSchema} from '../src/config.ts'
import {Store} from '../src/store.ts'
import {bodyDigest,type SourceContext} from '../src/sources.ts'
import type {Trigger} from '../plugins/sdk.ts'
const roots:string[]=[],stores:Store[]=[]
afterEach(()=>{for(const s of stores.splice(0))s.close();for(const r of roots.splice(0))rmSync(r,{recursive:true,force:true})})
function fixture(overrides:(method:string,operation:string,input:any)=>any=()=>undefined){
 const root=mkdtempSync(join(tmpdir(),'slack-plugin-'));roots.push(root)
 const c=configSchema.parse({stateDir:root,sources:[{id:'slack',kind:'slack',cwd:root,allowedActors:['UUSER'],options:{channels:['CROOM'],teamId:'TTEAM',tokenEnv:'TEST_SLACK'}}]}).sources[0]!
 const store=new Store(join(root,'test.sqlite'));stores.push(store);const events:Trigger[]=[],changes:any[]=[],calls:any[]=[]
 const context:SourceContext={store,receive(t){events.push(t)},change(e){changes.push(e)},bind(){},closed(){}}
 const source=new SlackSource(c,async(method,op,input)=>{calls.push({method,op,input});const result=await overrides(method,op,input);if(result!==undefined)return result;if(op==='auth.test')return {team_id:'TTEAM',user_id:'UBOT',bot_id:'BBOT'};throw Error('Unexpected API '+op)})
 source.start(context);return {source,c,store,context,events,changes,calls}
}
const message={ts:'1804500000.000001',text:'/agent do work',user:'UUSER'}
it('paginates history and subscribed replies without changing message identity on redelivery',async()=>{
 const f=fixture((_,op,input)=>{
  if(op==='conversations.history')return input.cursor?{messages:[],has_more:false}:{messages:[message],has_more:true,response_metadata:{next_cursor:'next'}}
  if(op==='conversations.replies')return input.cursor?{messages:[{...message,ts:'1804500000.000002',thread_ts:message.ts}]}:{messages:[message],has_more:true,response_metadata:{next_cursor:'reply-next'}}
 })
 f.store.put('thread','slack:CROOM:'+message.ts,{ref:{source:'slack',id:'CROOM:'+message.ts},subscriptions:['task']})
 await f.source.poll(f.context);expect(f.events).toHaveLength(3);expect(f.events[0]!.id).toBe(f.events[1]!.id);expect(f.events[2]!.threads[0]!.id).toBe('CROOM:'+message.ts)
 expect(f.events[0]!.actor).toEqual({source:'slack',id:'UUSER'});expect(f.events[0]!.human).toBe(true)
 expect(f.store.get('source-cursor','slack:CROOM')).toBeDefined()
})
it('does not advance an unfinished channel cursor and respects persisted rate limit windows',async()=>{
 const f=fixture((_,op)=>op==='conversations.history'?{messages:[message],has_more:true}:undefined)
 f.store.put('source-cursor','slack:CROOM',{since:'1000'})
 await expect(f.source.poll(f.context)).rejects.toThrow('incomplete');expect(f.store.get('source-cursor','slack:CROOM')).toEqual({since:'1000'})
 f.store.put('plugin-state','retryAt',Date.now()+60000);await expect(f.source.poll(f.context)).rejects.toThrow('retry window')
})
it('validates account identity and does not accept a bot as a human member',async()=>{
 const f=fixture((_,op,input)=>op==='conversations.members'?{members:['UUSER','UBOT']}:op==='users.info'?{user:{is_bot:input.user==='UBOT'}}:undefined)
 expect(await f.source.members('CROOM')).toEqual([{id:'UUSER',bot:false,name:undefined},{id:'UBOT',bot:true,name:undefined}])
 f.store.put('source-identity','slack',{principal:'TOTHER:UBOT'});await expect(f.source.poll(f.context)).rejects.toThrow('account changed')
})
it('reports edits as lifecycle changes rather than new authorized user instructions',async()=>{
 let text=message.text;const f=fixture((_,op)=>op==='conversations.history'?{messages:[{...message,text}]}:undefined)
 await f.source.poll(f.context);text='changed request';await f.source.poll(f.context)
 expect(f.events).toHaveLength(1);expect(f.changes).toMatchObject([{kind:'message.updated',scope:'CROOM',messageId:message.ts,contentHash:bodyDigest(text)}])
})
it('reads an anchored reply using the thread API, rejects changed content, and keeps exact reply destination',async()=>{
 let text=message.text;const f=fixture((_,op)=>op==='conversations.replies'?{messages:[{...message,text}]}:op==='chat.postMessage'?{channel:'CROOM',ts:'1804500000.000003'}:undefined)
 const trigger=f.source.trigger({id:'root',thread:'CROOM:'+message.ts,text:message.text,addressed:true},'UUSER');trigger.meta={chat:'CROOM',root:message.ts,messageId:message.ts}
 expect(await f.source.read({resource:'message',trigger,pageSize:50})).toMatchObject({message})
 text='edit';await expect(f.source.read({resource:'message',trigger,pageSize:50})).rejects.toThrow('changed')
 const delivery={id:'delivery-one',channel:{source:'slack',thread:'CROOM:'+message.ts,address:{chat:'CROOM',root:message.ts}},text:'result'} as any
 await f.source.deliver(delivery);expect(f.calls.at(-1).input).toMatchObject({channel:'CROOM',thread_ts:message.ts,text:'result'})
 await expect(f.source.deliver({...delivery,channel:{...delivery.channel,thread:'COTHER:'+message.ts}})).rejects.toThrow('outside')
})
it('never converts an ambiguous network write into a successful receipt',async()=>{
 const f=fixture((_,op)=>{if(op==='chat.postMessage')throw Error('connection lost')})
 await expect(f.source.deliver({id:'one',channel:{source:'slack',thread:'CROOM:'+message.ts,address:{chat:'CROOM',root:message.ts}},text:'result'} as any)).rejects.toThrow('outcome unknown')
 expect(f.calls.filter(c=>c.op==='chat.postMessage')).toHaveLength(1)
})
it('routes live old-thread replies, deletions and membership revocation with workspace validation',async()=>{
 const f=fixture();await f.source.identity()
 const payload=(event:any)=>({team_id:'TTEAM',event_id:'Ev1',event_time:1804500000,event:{...event,event_ts:'1804500000.000002',channel:'CROOM'}})
 await f.source.receiveEnvelope(payload({type:'message',...message,ts:'1804500000.000002',thread_ts:'1704500000.000001'}),f.context)
 expect(f.events[0]!.threads[0]!.id).toBe('CROOM:1704500000.000001')
 await f.source.receiveEnvelope(payload({type:'message',subtype:'message_deleted',deleted_ts:message.ts}),f.context)
 await f.source.receiveEnvelope(payload({type:'member_left_channel',user:'UBOT'}),f.context)
 expect(f.changes.map(e=>e.kind)).toEqual(['message.deleted','entry.unavailable'])
 await expect(f.source.receiveEnvelope({...payload({type:'message',...message}),team_id:'TOTHER'},f.context)).rejects.toThrow('workspace')
})
it('acknowledges real Socket Mode frames only after the host commits their events',async()=>{
 const {WebSocketServer}=await import('ws'),server=new WebSocketServer({port:0,host:'127.0.0.1'})
 await new Promise<void>(resolve=>server.on('listening',resolve))
 const address=server.address() as {port:number},acks:string[]=[];let persisted=false,commit!:()=>void
 const f=fixture((_,op)=>op==='apps.connections.open'?{url:'ws://127.0.0.1:'+address.port}:undefined)
 f.c.options.appTokenEnv='APP_TOKEN';f.c.options.apiBase='http://127.0.0.1/'
 f.context.checkpoint=()=>new Promise<void>(resolve=>{commit=()=>{persisted=true;resolve()}})
 server.on('connection',socket=>{socket.on('message',bytes=>acks.push(String(bytes)));socket.send(JSON.stringify({type:'events_api',envelope_id:'envelope-1',payload:{team_id:'TTEAM',event_id:'Ev1',event_time:1804500000,event:{type:'message',channel:'CROOM',...message,thread_ts:'1704500000.000001'}}}))})
 try{
  await f.source.start(f.context)
  for(let i=0;i<100&&!commit;i++)await new Promise(r=>setTimeout(r,5))
  expect(f.events).toHaveLength(1);expect(acks).toHaveLength(0);expect(persisted).toBe(false)
  commit();for(let i=0;i<100&&!acks.length;i++)await new Promise(r=>setTimeout(r,5))
  expect(acks.map(x=>JSON.parse(x))).toEqual([{envelope_id:'envelope-1'}])
 }finally{await f.source.close();for(const socket of server.clients)socket.terminate();await new Promise<void>(resolve=>server.close(()=>resolve()))}
})

it('never admits a first history copy after its edit or deletion arrived first',async()=>{
 for(const subtype of ['message_deleted','message_changed']){
  const f=fixture((_,op)=>op==='conversations.history'?{messages:[message]}:undefined)
  await f.source.identity()
  await f.source.receiveEnvelope({team_id:'TTEAM',event_id:'early-'+subtype,event_time:1804500001,event:{type:'message',subtype,channel:'CROOM',deleted_ts:message.ts,message:{...message,text:'changed request'}}},f.context)
  await f.source.poll(f.context);expect(f.events).toHaveLength(0)
 }
})
it('opens Socket Mode through the actual HTTP transport using the app credential',async()=>{
 const {createServer}=await import('node:http'),{WebSocketServer}=await import('ws'),ws=new WebSocketServer({port:0,host:'127.0.0.1'})
 await new Promise<void>(r=>ws.on('listening',r));const port=(ws.address() as {port:number}).port,calls:{path:string;auth:string|undefined}[]=[]
 const http=createServer((req,res)=>{calls.push({path:req.url!,auth:req.headers.authorization});res.setHeader('content-type','application/json');res.end(JSON.stringify(req.url==='/api/auth.test'?{ok:true,team_id:'TTEAM',user_id:'UBOT',bot_id:'BBOT'}:req.url==='/api/apps.connections.open'?{ok:true,url:'ws://127.0.0.1:'+port}:{ok:true,messages:[]}))})
 await new Promise<void>(r=>http.listen(0,'127.0.0.1',r));const f=fixture();f.c.options={...f.c.options,appTokenEnv:'TEST_SLACK_APP',apiBase:'http://127.0.0.1:'+(http.address() as {port:number}).port+'/api/'}
 process.env.TEST_SLACK='test-bot';process.env.TEST_SLACK_APP='test-app';const source=new SlackSource(f.c)
 try{await source.start(f.context);await source.poll(f.context);expect(calls).toContainEqual({path:'/api/apps.connections.open',auth:'Bearer test-app'});expect(calls).toContainEqual({path:'/api/auth.test',auth:'Bearer test-bot'})}
 finally{await source.close();delete process.env.TEST_SLACK;delete process.env.TEST_SLACK_APP;for(const s of ws.clients)s.terminate();await Promise.all([new Promise<void>(r=>ws.close(()=>r())),new Promise<void>(r=>http.close(()=>r()))])}
})

it('resumes a fixed paginated history window after adapter restart without advancing oldest early',async()=>{
 let page=0;const f=fixture((_,op,input)=>op==='conversations.history'?{messages:[],has_more:page<6,response_metadata:{next_cursor:page++<6?'page-'+page:''}}:undefined)
 await f.source.poll(f.context)
 expect(f.calls.filter(c=>c.op==='conversations.history')).toHaveLength(5)
 const initial=f.calls.find(c=>c.op==='conversations.history').input,old=f.store.get<any>('source-cursor','slack:CROOM').since
 expect(old).toBe(initial.oldest);expect(f.store.get<any>('plugin-state','history:CROOM').cursor).toBe('page-5')
 const next=new SlackSource(f.c,async(_,op,input)=>{if(op==='auth.test')return {team_id:'TTEAM',user_id:'UBOT',bot_id:'BBOT'};expect(input).toMatchObject({cursor:'page-5',oldest:initial.oldest,latest:initial.latest});return {messages:[],has_more:false}})
 await next.start(f.context);await next.poll(f.context)
 expect(f.store.get('plugin-state','history:CROOM')).toBeNull();expect(f.store.get<any>('source-cursor','slack:CROOM').since).toBe(String(Number(initial.latest)-2))
})
