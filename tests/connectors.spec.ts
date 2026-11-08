import { mkdtempSync,rmSync,writeFileSync,chmodSync } from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterEach,it,expect} from 'vitest'
import {configSchema} from '../src/config.ts'
import {Store} from '../src/store.ts'
import {GithubSource,type GithubApi} from '../src/connectors/github.ts'
import {FeishuSource} from '../src/connectors/feishu.ts'
import type {SourceContext} from '../src/sources.ts'
const roots:string[]=[],stores:Store[]=[]
afterEach(()=>{for(const s of stores.splice(0))s.close();for(const r of roots.splice(0))rmSync(r,{recursive:true,force:true})})
function context(){
 const root=mkdtempSync(join(tmpdir(),'agent-source-'));roots.push(root);const store=new Store(join(root,'state.db'));stores.push(store)
 const events:any[]=[]
 const ctx:SourceContext={store,receive:e=>events.push(e),bind:()=>{},closed:()=>{}}
 return {ctx,events}
}
it('preserves structured lifecycle subscription failures after the native consumer exits',async()=>{
 const {ctx}=context(),root=mkdtempSync(join(tmpdir(),'event-consumer-'));roots.push(root)
 const cli=join(root,'consumer')
 // The contract is CLI stderr/exit handling; avoid starting seven JS runtimes just to print JSON.
 const diagnostic={ok:false,error:{type:'validation',subtype:'failed_precondition',message:'Event type is not subscribed',hint:'Enable the event in the application console'}}
 writeFileSync(cli,"#!/bin/sh\nprintf '%s\\n' '"+JSON.stringify(diagnostic,null,2)+"' >&2\nexit 2\n");chmodSync(cli,0o700)
 const config=configSchema.parse({sources:[{id:'f',kind:'feishu',cwd:root,feishu:{cli,chats:['oc_test'],liveEvents:true}}]}).sources[0]!,source=new FeishuSource(config)
 try{
  source.start({...ctx,change:()=>{}})
  const end=Date.now()+3000
  while(Date.now()<end){const health=ctx.store.list<any>('source-live');if(health.length===7&&health.every(h=>h.code===2))break;await new Promise(r=>setTimeout(r,10))}
  const health=ctx.store.list<any>('source-live');expect(health).toHaveLength(7)
  for(const h of health)expect(h).toMatchObject({status:'error',code:2,readyObserved:false,diagnostic:{type:'validation',subtype:'failed_precondition',message:'Event type is not subscribed'}})
 }finally{await source.close()}
})
it.each(['closed','merged'])('still receives inline human follow-ups after a PR is %s',async outcome=>{
 const {ctx,events}=context(),paths:string[]=[],closes:string[]=[]
 const config=configSchema.parse({sources:[{id:'github',kind:'github',cwd:'.',repository:'owner/repo'}]}).sources[0]!
 ctx.store.threads.save({key:'github:owner/repo#7',ref:{source:'github',id:'owner/repo#7'},subscriptions:['ticket'],correlated:[],pending:[],createdAt:new Date().toISOString(),meta:{}})
 ctx.closed=(_thread,state)=>{closes.push(state)}
 let failed=false
 const source=new GithubSource(config,{async request(_method,path){
  paths.push(path)
  if(path==='user')return {login:'agent'}
  if(path.includes('issues?')||path.includes('issues/comments'))return []
  if(path.endsWith('/issues/7'))return {number:7,state:'closed',pull_request:{},closed_at:new Date(Date.now()-10000).toISOString()}
  if(path.endsWith('/pulls/7'))return {head:{sha:'a'},merged_at:outcome==='merged'?new Date(Date.now()-10000).toISOString():null}
  if(path.includes('/comments?')){if(failed)throw Error('Temporary read failure');return [{id:42,body:'Please explain this merged line',updated_at:new Date().toISOString(),user:{login:'alice',type:'User'}}]}
  return []
 }})
 await source.poll(ctx)
 expect(events.map(e=>e.text)).toEqual(['Please explain this merged line'])
 expect(closes).toEqual([outcome]);expect(paths.some(p=>p.includes('check-runs'))).toBe(false)
 const before=ctx.store.get('thread-cursor','github:owner/repo#7');failed=true
 await source.poll(ctx)
 expect(ctx.store.get('thread-cursor','github:owner/repo#7')).toEqual(before)
 expect(ctx.store.get<any>('thread-health','github:owner/repo#7').consecutiveFailures).toBe(1)
})
it('polls GitHub, preserves source identities, ignores own markers and maintains a durable cursor',async()=>{
 const {ctx,events}=context()
 const config=configSchema.parse({sources:[{id:'github',kind:'github',allowedActors:['alice'],cwd:'.',repository:'owner/repo'}]}).sources[0]!
 const api:GithubApi={async request(method,path){
  if(path.includes('issues/comments'))return [{id:2,issue_url:'https://api.github.com/repos/owner/repo/issues/7',body:'/agent compare',updated_at:'2026-11-04T00:00:01Z',user:{login:'alice',type:'User'}},{id:3,issue_url:'https://api.github.com/repos/owner/repo/issues/7',body:'done <!-- superagent:reply -->',user:{login:'alice'}}]
  return [{id:1,number:7,title:'Question',body:'/agent compare',updated_at:new Date().toISOString(),user:{login:'alice',type:'User'}}]
 }}
 const source=new GithubSource(config,api)
 await source.poll(ctx)
 expect(events).toHaveLength(2)
 expect(events[1].actor).toEqual({source:'github',id:'alice'})
 expect(events[1].channel.address.number).toBe('7')
 const first=events[0].id
 await source.poll(ctx)
 expect(events[2].id).toBe(first)
 expect(ctx.store.get('source-cursor','github')).toBeDefined()
})
it('polls live subscriptions and the two-week horizon after the later of message or ticket completion',async()=>{
 const {ctx}=context(),reads:number[]=[]
 const now=Date.now(),at=(days:number)=>new Date(now-days*86400000).toISOString()
 const config=configSchema.parse({sources:[{id:'github',kind:'github',cwd:'.',repository:'owner/repo'}]}).sources[0]!
 const states=[{last:30,end:30},{last:30,end:13},{last:13,end:30},{last:30,end:null}]
 for(const [index,state] of states.entries()){
  const id='ticket-'+index
  ctx.store.put('ticket',id,{id,...(state.end===null?{}:{ended:{at:at(state.end)}})})
  ctx.store.threads.save({key:'github:owner/repo#'+(index+1),ref:{source:'github',id:'owner/repo#'+(index+1)},subscriptions:[id],createdAt:at(30),lastAt:at(state.last),correlated:[],pending:[],meta:{}})
 }
 const source=new GithubSource(config,{async request(_method,path){
  if(path==='user')return {login:'agent'}
  const match=/\/issues\/(\d+)$/.exec(path)
  if(match){reads.push(Number(match[1]));return {state:'closed',closed_at:at(30)}}
  return []
 }})
 await source.poll(ctx)
 expect(reads).toEqual([2,3,4])
 expect(ctx.store.threads.get('github:owner/repo#1')!.subscriptions).toEqual(['ticket-0'])
})
it('does not repeat an already published GitHub reply',async()=>{
 const config=configSchema.parse({sources:[{id:'github',kind:'github',allowedActors:['alice'],cwd:'.',repository:'owner/repo'}]}).sources[0]!
 let posts=0
 const source=new GithubSource(config,{async request(method){if(method==='POST'){posts++;return {id:3}}return [{body:'Existing <!-- superagent:delivery1 -->'}]}})
 await source.deliver({id:'delivery1',kind:'reply',text:'result',channel:{source:'github',thread:'owner/repo#7',address:{number:'7'}}})
 expect(posts).toBe(0)
})
it('polls Feishu topics and replies with a stable idempotency uuid',async()=>{
 const {ctx,events}=context()
 const config=configSchema.parse({sources:[{id:'chat',kind:'feishu',allowedActors:['ou_alice'],cwd:'.',feishu:{appIdEnv:'FIXTURE_ID',appSecretEnv:'FIXTURE_SECRET',chats:['oc_test'],mentionId:'bot'}}]}).sources[0]!
 const calls:any[]=[]
 const source=new FeishuSource(config,async(method,path,body)=>{
  calls.push({method,path,body})
  return method==='GET'?{items:[{message_id:'om_2',chat_id:'oc_test',root_id:'om_1',create_time:'1',body:{content:JSON.stringify({text:'compare'})},sender:{id:'ou_alice',id_type:'open_id',sender_type:'user'},mentions:[{id:'bot'}]}],has_more:false}:{message_id:'reply'}
 })
 await source.poll(ctx)
 expect(events[0].threads[0].id).toBe('oc_test:om_1')
 expect(events[0].addressed).toBe('direct')
 const message={id:'reply-key',kind:'reply' as const,text:'result',channel:events[0].channel}
 await source.deliver(message);await source.deliver(message)
 const posts=calls.filter(c=>c.method==='POST')
 expect(posts[0].body.uuid).toBe(posts[1].body.uuid)
 expect(posts[0].body.reply_in_thread).toBe(true)
})

it('normalizes typed CLI paths and converts real CLI message output',async()=>{
 const {larkRequest}=await import('../src/connectors/lark-cli.ts')
 const {writeFileSync}=await import('node:fs')
 const root=mkdtempSync(join(tmpdir(),'lark-adapter-'));roots.push(root)
 const binary=join(root,'fixture-cli')
 writeFileSync(binary,'#!'+process.execPath+'\nconsole.log(JSON.stringify({ok:true,data:{messages:[{message_id:"m1",content:"/agent test"}],has_more:false}}))\n',{mode:0o700})
 const request=larkRequest(binary)
 const result=await request('GET','im/v1/messages?container_id=oc_test&start_time=1&end_time=2')
 expect(result.items[0].message_id).toBe('m1')
})
it('reads a remotely verified bot identity even when the raw API envelope omits top-level bot fields',async()=>{
 const {larkRequest}=await import('../src/connectors/lark-cli.ts'),{writeFileSync}=await import('node:fs')
 const root=mkdtempSync(join(tmpdir(),'lark-identity-'));roots.push(root);const binary=join(root,'fixture-cli')
 writeFileSync(binary,'#!'+process.execPath+'\nif(JSON.stringify(process.argv.slice(2))!==JSON.stringify(["auth","status","--json","--verify"]))process.exit(1);console.log(JSON.stringify({identities:{bot:{verified:true,available:true,openId:"ou_bot",appName:"Bot"}}}))\n',{mode:0o700})
 expect(await larkRequest(binary)('GET','bot/v3/info')).toMatchObject({bot:{open_id:'ou_bot',app_name:'Bot'}})
 writeFileSync(binary,'#!'+process.execPath+'\nconsole.log(JSON.stringify({identities:{bot:{available:true,openId:"ou_unverified"}}}))\n',{mode:0o700})
 await expect(larkRequest(binary)('GET','bot/v3/info')).rejects.toThrow('not verified')
})

it('finds a GitHub delivery marker on later pages before attempting a replay',async()=>{
 const config=configSchema.parse({sources:[{id:'github',kind:'github',allowedActors:['alice'],cwd:'.',repository:'owner/repo'}]}).sources[0]!
 let posts=0
 const source=new GithubSource(config,{async request(method,path){
  if(method==='POST'){posts++;return {}}
  return path.includes('page=2')?[{body:'done <!-- superagent:late -->'}]:Array.from({length:100},()=>({body:'other'}))
 }})
 await source.deliver({id:'late',kind:'reply',text:'done',channel:{source:'github',thread:'owner/repo#7',address:{number:'7'}}})
 expect(posts).toBe(0)
})

it('keeps bridged Feishu event IDs separate when platform message metadata is absent',()=>{
 const config=configSchema.parse({sources:[{id:'chat',kind:'feishu',allowedActors:['alice'],cwd:'.',feishu:{cli:'fixture',chats:['test']}}]}).sources[0]!
 const source=new FeishuSource(config,async()=>({}))
 const first=source.trigger({id:'one',thread:'t',text:'same',addressed:true},'alice')
 const second=source.trigger({id:'two',thread:'t',text:'same',addressed:true},'alice')
 expect(source.idempotencyKey(first)).not.toBe(source.idempotencyKey(second))
})

it('refuses credential-bearing HTTP requests to a different origin',async()=>{
 const {GithubHttpApi}=await import('../src/connectors/github.ts')
 const api=new GithubHttpApi('unused')
 await expect(api.request('GET','https://outside.invalid/collect')).rejects.toThrow('api.github.com')
})

it('retains approval reviews with empty bodies and serves paginated source resources',async()=>{
 const {ctx,events}=context(),config=configSchema.parse({sources:[{id:'github',kind:'github',allowedActors:['alice'],cwd:'.',repository:'owner/repo'}]}).sources[0]!
 ctx.store.threads.save({key:'github:owner/repo#7',ref:{source:'github',id:'owner/repo#7'},subscriptions:['ticket'],correlated:[],pending:[],createdAt:new Date().toISOString(),meta:{}})
 const source=new GithubSource(config,{async request(method,path){
  if(path.includes('issues?')||path.includes('issues/comments'))return []
  if(path.endsWith('/issues/7'))return {number:7,state:'open',pull_request:{}}
  if(path.endsWith('/pulls/7'))return {number:7,title:'Test',state:'open',head:{sha:'a'}}
  if(path.includes('/reviews?'))return [{id:9,state:'APPROVED',body:'',commit_id:'a',submitted_at:new Date().toISOString(),user:{login:'alice',type:'User'}}]
  if(path.includes('/check-runs'))return {check_runs:[]}
  return []
 }})
 await source.poll(ctx)
 expect(events.some(e=>e.text==='APPROVED'&&e.human)).toBe(true)
 const result:any=await source.read({resource:'github/pulls/7/reviews/1',pageSize:20})
 expect(result.messages[0]).toMatchObject({state:'APPROVED',head:'a'})
})

it('anchors Feishu root, parent and image reads to the source chat and returned image key',async()=>{
 const config=configSchema.parse({sources:[{id:'feishu',kind:'feishu',allowedActors:['alice'],cwd:'.',feishu:{cli:'fixture',chats:['oc_test']}}]}).sources[0]!
 const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+yR5cAAAAASUVORK5CYII='
 const source=new FeishuSource(config,async(method,path)=>path.includes('/resources/')?{binary:png}:{items:[{message_id:'om_test',chat_id:'oc_test',create_time:'1000',body:{content:'{"image_key":"img_test"}'},sender:{id:'alice',sender_type:'user'}}]})
 const trigger=source.trigger({id:'one',thread:'oc_test:om_test',text:'image',addressed:true},'alice');trigger.meta={messageId:'om_test',chat:'oc_test'}
 expect(await source.read({resource:'image/img_test',trigger,pageSize:20})).toMatchObject({kind:'image',mimeType:'image/png',data:png})
 await expect(source.read({resource:'image/img_other',trigger,pageSize:20})).rejects.toThrow('not returned')
 trigger.meta.chat='oc_other'
 await expect(source.read({resource:'message',trigger,pageSize:20})).rejects.toThrow('changed')
})

it('paginates every inline review thread and refuses a nonadvancing cursor',async()=>{
 const config=configSchema.parse({sources:[{id:'github',kind:'github',cwd:'.',repository:'owner/repo'}]}).sources[0]!
 const after:any[]=[]
 const source=new GithubSource(config,{async request(method,path,body:any){after.push(body.variables.after);return {data:{repository:{pullRequest:{id:'PR',reviewThreads:{nodes:[{id:body.variables.after?'two':'one',isResolved:true}],pageInfo:{hasNextPage:!body.variables.after,endCursor:'next'}}}}}}}})
 expect((await source.reviewGraph(7)).reviewThreads.nodes.map((x:any)=>x.id)).toEqual(['one','two'])
 expect(after).toEqual([undefined,'next'])
})
it('replies inline and deduplicates an uncertain review reply by its exact marker',async()=>{
 const config=configSchema.parse({sources:[{id:'github',kind:'github',cwd:'.',repository:'owner/repo'}]}).sources[0]!,calls:any[]=[]
 let stored:any[]=[]
 const source=new GithubSource(config,{async request(method,path,body:any){calls.push({method,path,body});if(method==='POST'){stored.push(body);return {}}return stored}})
 const message:any={id:'inline-reply',kind:'reply',text:'A concrete reason',channel:{source:'github',thread:'owner/repo#7',address:{number:'7',reviewComment:'42'}}}
 await source.deliver(message);await source.deliver(message)
 expect(calls.filter(c=>c.method==='POST')).toHaveLength(1)
 expect(calls.find(c=>c.method==='POST').path).toBe('repos/owner/repo/pulls/7/comments/42/replies')
})
it('discovers only explicitly enabled Feishu mentions and uses the original for deduplication',async()=>{
 const config=configSchema.parse({sources:[{id:'feishu',kind:'feishu',cwd:'.',feishu:{cli:'fixture',chats:['oc_configured'],mentionId:'ou_bot',otherChats:'mentions'}}]}).sources[0]!,{ctx,events}=context()
 let reads=0
 const source=new FeishuSource(config,async()=>{reads++;return {items:[{message_id:'om_live',chat_id:'oc_other',body:{content:'{"text":"@bot hello"}'},mentions:[{id:'ou_bot'}],sender:{id:'ou_person',sender_type:'user'}}]}})
 const event={type:'im.message.receive_v1',message_id:'om_live',chat_id:'oc_other',sender_id:'ou_person',sender_type:'user'}
 await source.receiveEvent(event,ctx);expect(reads).toBe(0)
 await source.receiveEvent({...event,mentions:[{id:'ou_bot'}]},ctx);expect(events).toHaveLength(1)
 expect(events[0].actor.id).toBe('ou_person');expect(events[0].addressed).toBe('direct')
})
it('does not sync an empty Feishu directory or read members from an unconfigured chat',async()=>{
 const config=configSchema.parse({sources:[{id:'feishu',kind:'feishu',cwd:'.',feishu:{cli:'fixture',chats:['oc_test']}}]}).sources[0]!
 const source=new FeishuSource(config,async()=>({items:[{member_id:'ou_one',name:'One'}],has_more:false}))
 expect(await source.members('oc_test')).toEqual([{id:'ou_one',name:'One',bot:false}])
 await expect(source.members('oc_other')).rejects.toThrow('configured')
})

it('discovers an owned PR by its exact task branch even when its body has a host marker',async()=>{
 const {createHash}=await import('node:crypto'),{ctx}=context(),binds:any[]=[]
 ctx.store.tickets.save({id:'task',mandate:{actor:{source:'github'}}} as any);ctx.bind=(...args)=>{binds.push(args)}
 const config=configSchema.parse({sources:[{id:'github',kind:'github',cwd:'.',repository:'owner/repo'}]}).sources[0]!
 const source=new GithubSource(config,{async request(method,path){
  if(path==='user')return {login:'agent'}
  if(path.endsWith('/pulls/7'))return {head:{ref:'superagent/'+createHash('sha256').update('task').digest('hex').slice(0,20),repo:{full_name:'owner/repo'}}}
  if(path.includes('/issues?'))return [{id:7,number:7,title:'Draft',body:'<!-- superagent:branch -->',pull_request:{},user:{login:'agent',type:'User'}}]
  return []
 }})
 await source.poll(ctx);expect(binds).toEqual([['task','owner/repo#7',true]])
})
it('isolates a failing subscribed GitHub thread and keeps its own review cursor',async()=>{
 const {ctx,events}=context(),config=configSchema.parse({sources:[{id:'github',kind:'github',cwd:'.',repository:'owner/repo'}]}).sources[0]!
 for(const n of [7,8])ctx.store.threads.save({key:'github:owner/repo#'+n,ref:{source:'github',id:'owner/repo#'+n},subscriptions:['task'],correlated:[],pending:[],createdAt:new Date().toISOString(),meta:{}})
 const source=new GithubSource(config,{async request(method,path){
  if(path==='user')return {login:'agent'}
  if(path.endsWith('/issues/7'))throw Error('Fixture connection failed')
  if(path.endsWith('/issues/8'))return {state:'open',pull_request:{}}
  if(path.endsWith('/pulls/8'))return {head:{sha:'a'}}
  if(path.includes('/reviews?'))return [{id:9,state:'APPROVED',body:'',submitted_at:new Date().toISOString(),user:{login:'reviewer',type:'User'}}]
  if(path.includes('/check-runs'))return {check_runs:[]}
  return []
 }})
 for(let i=0;i<3;i++)await source.poll(ctx)
 expect(events.some(e=>e.meta.number===8)).toBe(true)
 expect(ctx.store.get<any>('thread-health','github:owner/repo#7').consecutiveFailures).toBe(3)
 expect(ctx.store.get('thread-cursor','github:owner/repo#7')).toBeUndefined()
 expect(ctx.store.get('thread-cursor','github:owner/repo#8')).toBeDefined()
})
it('retains explicitly enabled direct-message resource access across source restart',async()=>{
 const {ctx,events}=context(),config=configSchema.parse({sources:[{id:'chat',kind:'feishu',cwd:'.',feishu:{cli:'fixture',chats:['oc_configured'],directMessages:true}}]}).sources[0]!
 const request=async()=>({items:[{message_id:'om_dm',chat_id:'oc_dm',body:{content:'{"text":"please read"}'},sender:{id:'ou_person',sender_type:'user'}}]})
 const first=new FeishuSource(config,request)
 await first.receiveEvent({type:'im.message.receive_v1',message_id:'om_dm',chat_id:'oc_dm',chat_type:'p2p'},ctx)
 expect(events[0].addressed).toBe('direct');ctx.store.triggers.save(events[0])
 const second=new FeishuSource(config,request);second.start(ctx)
 expect(await second.read({resource:'message',trigger:events[0],pageSize:20})).toMatchObject({status:'available'})
})

it('F14 checks known Feishu edits and recalls before replay, without turning revised text into another task',async()=>{
 const {ctx,events}=context(),changes:any[]=[];ctx.change=e=>changes.push(e)
 ctx.receive=e=>{ctx.store.triggers.save(e);events.push(e)}
 const config=configSchema.parse({sources:[{id:'f',kind:'feishu',allowedActors:['ou_person'],cwd:'.',feishu:{cli:'test-lark',chats:['oc_test'],mentionId:'ou_bot'}}]}).sources[0]!
 let item:any={message_id:'om_test',chat_id:'oc_test',create_time:'1000',update_time:'1000',sender:{id:'ou_person',sender_type:'user'},body:{content:'{"text":"first body"}'}}
 const source=new FeishuSource(config,async()=>({items:[item]}));await source.poll(ctx)
 expect(events).toHaveLength(1)
 item={...item,update_time:'2000',body:{content:'{"text":"edited body"}'}};await source.poll(ctx);await source.poll(ctx)
 expect(events).toHaveLength(1);expect(changes.filter(c=>c.kind==='message.updated')).toHaveLength(1)
 item={...item,deleted:true,update_time:'3000'};await source.poll(ctx)
 expect(changes.at(-1)).toMatchObject({kind:'message.deleted',messageId:'om_test',scope:'oc_test'})
 expect(events).toHaveLength(1)
})
it('R14 uses Feishu V2 membership fields and treats a group rename only as a label',async()=>{
 const {ctx}=context(),changes:any[]=[];ctx.change=e=>changes.push(e)
 const config=configSchema.parse({sources:[{id:'f',kind:'feishu',cwd:'.',feishu:{cli:'test-lark',chats:['oc_test'],mentionId:'ou_bot'}}]}).sources[0]!,source=new FeishuSource(config,async()=>({}))
 const event=(type:string,data:any)=>({schema:'2.0',header:{event_id:type,event_type:type,create_time:'1000'},event:{chat_id:'oc_test',...data}})
 await source.receiveEvent(event('im.chat.updated_v1',{after_change:{name:'Renamed'}}),ctx);expect(changes).toHaveLength(0)
 expect(ctx.store.get<any>('entry-label','f:oc_test').name).toBe('Renamed')
 await source.receiveEvent(event('im.chat.member.user.deleted_v1',{users:[{user_id:{open_id:'ou_person'}}]}),ctx)
 await source.receiveEvent(event('im.chat.member.bot.deleted_v1',{}),ctx)
 expect(changes.map(c=>c.kind)).toEqual(['member.removed','entry.unavailable'])
 await expect(source.receiveEvent(event('im.chat.member.user.added_v1',{users:[]}),ctx)).rejects.toThrow('open IDs')
})
it('R05 rejects a configured bot ID when native identity readback is absent',async()=>{
 const config=configSchema.parse({sources:[{id:'f',kind:'feishu',cwd:'.',feishu:{cli:'test-lark',chats:['oc_test'],mentionId:'ou_bot'}}]}).sources[0]!
 await expect(new FeishuSource(config,async()=>({})).identity()).rejects.toThrow()
 expect(await new FeishuSource(config,async()=>({bot:{open_id:'ou_bot'}})).identity()).toMatchObject({id:'ou_bot',verified:true})
})
it('R05 refuses a source read when a verified connection switches accounts',async()=>{
 const {ctx,events}=context(),changes:any[]=[];ctx.change=e=>changes.push(e)
 const config=configSchema.parse({sources:[{id:'f',kind:'feishu',cwd:'.',feishu:{cli:'test-lark',chats:['oc_test']}}]}).sources[0]!
 ctx.store.put('source-identity','f',{sourceId:'f',principal:'ou_original'})
 let bot='ou_original'
 const source=new FeishuSource(config,async(_method,path)=>path==='bot/v3/info'?{bot:{open_id:bot}}:{items:[]})
 await source.poll(ctx);bot='ou_other'
 await expect(source.poll(ctx)).rejects.toThrow('account changed')
 expect(changes[0]).toMatchObject({kind:'entry.unavailable',scope:'oc_test'});expect(events).toHaveLength(0)
 await expect(source.poll(ctx)).rejects.toThrow('account changed');expect(changes[1]).toEqual(changes[0])
})

it('resumes Feishu history from its durable page and fixed time window after restart',async()=>{
 const {ctx}=context(),requests:URL[]=[]
 const config=configSchema.parse({sources:[{id:'f',kind:'feishu',cwd:'.',feishu:{chats:['oc_test'],mentionId:'ou_bot',appIdEnv:'TEST_APP_ID',appSecretEnv:'TEST_APP_SECRET'}}]}).sources[0]!
 const request=async(_method:string,path:string)=>{
  if(path==='bot/v3/info')return {bot:{open_id:'ou_bot'}}
  const url=new URL(path,'https://example.test/');requests.push(url)
  return {items:[],has_more:true,page_token:'page-'+requests.length}
 }
 const first=new FeishuSource(config,request);await first.poll(ctx)
 expect(requests).toHaveLength(5);const old=ctx.store.get<any>('source-cursor','f:oc_test').since,window=ctx.store.get<any>('plugin-state','f:history:oc_test')
 expect(window.page).toBe('page-5');expect(window.since).toBe(old)
 const second=new FeishuSource(config,async(_method,path)=>{
  if(path==='bot/v3/info')return {bot:{open_id:'ou_bot'}}
  const url=new URL(path,'https://example.test/');expect(url.searchParams.get('page_token')).toBe('page-5');expect(url.searchParams.get('start_time')).toBe(old);expect(url.searchParams.get('end_time')).toBe(window.boundary)
  return {items:[],has_more:false}
 })
 await second.poll(ctx);expect(ctx.store.get('plugin-state','f:history:oc_test')).toBeNull();expect(ctx.store.get<any>('source-cursor','f:oc_test').since).toBe(String(Number(window.boundary)-2))
})
