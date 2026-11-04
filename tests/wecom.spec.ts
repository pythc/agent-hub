import {EventEmitter} from 'node:events'
import {mkdtempSync,mkdirSync,rmSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterEach,it,expect,vi} from 'vitest'
import {createCipheriv} from 'node:crypto'
import {WebSocketServer,type WebSocket} from 'ws'
import {configSchema} from '../src/config.ts'
import {Store} from '../src/store.ts'
import {Runtime} from '../src/runtime.ts'
import {WecomSource,type WecomTransport,downloadWecom} from '../src/connectors/wecom.ts'
import {UncertainDelivery,type SourceContext} from '../src/sources.ts'
import type {Model,ModelRequest} from '../src/model.ts'
const roots:string[]=[],stores:Store[]=[],sources:WecomSource[]=[],hosts:Runtime[]=[],servers:WebSocketServer[]=[]
afterEach(async()=>{for(const h of hosts.splice(0))await h.close();for(const s of sources.splice(0))await s.close();for(const w of servers.splice(0)){for(const c of w.clients)c.terminate();await new Promise<void>(r=>w.close(()=>r()))};for(const s of stores.splice(0))s.close();for(const p of roots.splice(0))rmSync(p,{recursive:true,force:true});delete process.env.WECOM_FIXTURE_ID;delete process.env.WECOM_FIXTURE_SECRET;vi.restoreAllMocks()})
class Transport extends EventEmitter implements WecomTransport {
 receipts:any[]=[];sends:any[]=[];fail=false
 connect(){this.emit('authenticated')}
 disconnect(){this.emit('disconnected')}
 async replyStream(frame:any,id:string,text:string,finish:boolean){this.receipts.push({frame,id,text,finish})}
 async sendMessage(chatid:string,body:any){this.sends.push({chatid,body});if(this.fail)throw Error('Lost ACK')}
}
function root(){const p=mkdtempSync(join(tmpdir(),'wecom-source-'));roots.push(p);return p}
function configuration(p:string,extra:any={}){return configSchema.parse({stateDir:join(p,'state'),codex:'/missing/codex',work:{sandboxDriver:'disabled'},sources:[{id:'wecom',kind:'wecom',cwd:p,allowedActors:['alice'],wecom:{botIdEnv:'WECOM_FIXTURE_ID',secretEnv:'WECOM_FIXTURE_SECRET',chats:['allowed-group'],...extra}}]})}
function credentials(){process.env.WECOM_FIXTURE_ID='bot-fixture';process.env.WECOM_FIXTURE_SECRET='synthetic-wecom-secret'}
const frame=(id='one',body:any={})=>({cmd:'aibot_msg_callback',headers:{req_id:'req-'+id},body:{msgid:id,aibotid:'bot-fixture',chattype:'single',from:{userid:'alice'},msgtype:'text',text:{content:'Read acceptance.txt'},...body}})
function fixture(extra:any={},download?:any){
 credentials();const p=root(),config=configuration(p,extra),store=new Store(join(config.stateDir,'state.sqlite'));stores.push(store);store.put('settings','current',{config})
 const events:any[]=[],ctx:SourceContext={store,receive:t=>events.push(t),bind(){},closed(){}},transport=new Transport(),source=new WecomSource(config.sources[0]!,()=>transport,download);sources.push(source);source.start(ctx)
 return {p,config,store,events,ctx,transport,source}
}
const delivery=(f:ReturnType<typeof fixture>)=>({id:'result-one',kind:'reply' as const,text:'verified-result',ticketId:'task',channel:f.events[0].channel})
it('deduplicates incoming messages and sends results only to the original conversation',async()=>{
 const f=fixture();await f.source.receiveFrame(frame());await f.source.receiveFrame(frame())
 expect(f.events).toHaveLength(1);expect(f.events[0]).toMatchObject({human:true,actor:{id:'alice'},threads:[{id:'single:alice'}]});expect(f.transport.receipts).toHaveLength(1)
 await f.source.deliver(delivery(f));expect(f.transport.sends[0].chatid).toBe('alice')
 await expect(f.source.deliver({...delivery(f),channel:{...delivery(f).channel,address:{...delivery(f).channel.address,chat:'other'}}})).rejects.toThrow('outside')
 await expect(f.source.receiveFrame(frame('one',{text:{content:'Altered'}}))).rejects.toThrow('reused')
})
it('refuses unconfigured groups, mismatched bots and disabled sources without execution',async()=>{
 const f=fixture({directMessages:false});await f.source.receiveFrame(frame());await f.source.receiveFrame(frame('group',{chattype:'group',chatid:'other'}));await f.source.receiveFrame(frame('bad',{aibotid:'other-bot'}))
 expect(f.events).toHaveLength(0);await f.source.receiveFrame(frame('allowed',{chattype:'group',chatid:'allowed-group'}));expect(f.events).toHaveLength(1)
 f.config.sources[0]!.enabled=false;await f.source.receiveFrame(frame('disabled',{chattype:'group',chatid:'allowed-group'}));expect(f.events).toHaveLength(1)
})
it('retains unlisted sender identity for operator setup without replying or downloading',async()=>{
 let downloads=0;const f=fixture({},async()=>{downloads++;throw Error('must not fetch')})
 await f.source.receiveFrame(frame('unknown',{from:{userid:'unlisted'},msgtype:'file',file:{url:'https://example.invalid/secret',aeskey:'temporary-key'}}))
 expect(f.transport.receipts).toHaveLength(0);expect(downloads).toBe(0);expect(f.store.list<any>('source-observed')[0].actor).toBe('unlisted')
 expect(JSON.stringify(f.store.list('wecom-inbox'))).not.toContain('temporary-key')
})
it('caches mixed attachments while keeping temporary URLs and decryption keys out of resources',async()=>{
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+yR5cAAAAASUVORK5CYII=','base64')
 const f=fixture({},async(url:string)=>url.includes('image')?png:Buffer.from('file-marker'))
 await f.source.receiveFrame(frame('media',{msgtype:'mixed',mixed:{msg_item:[{msgtype:'text',text:{content:'Check these'}},{msgtype:'image',image:{url:'https://test.weixin.qq.com/image?signed=secret',aeskey:'secret-key'}},{msgtype:'file',file:{url:'https://test.weixin.qq.com/file',aeskey:'file-key',filename:'report.txt'}}]}}))
 const t=f.events[0];expect((await f.source.read({resource:'asset/0',trigger:t,pageSize:20})).kind).toBe('image')
 const file=await f.source.read({resource:'asset/1',trigger:t,pageSize:20});expect(Buffer.from(file.data,'base64').toString()).toBe('file-marker')
 const record=JSON.stringify(f.store.list('wecom-inbox'));expect(record).not.toContain('secret-key');expect(record).not.toContain('signed=secret')
 await expect(f.source.read({resource:'asset/0',trigger:{...t,id:'other'},pageSize:20})).rejects.toThrow('unavailable')
 await expect(f.source.read({resource:'message',pageSize:20})).rejects.toThrow('anchored')
})
it('bounds media hosts before any network request',async()=>{
 for(const url of ['http://127.0.0.1/file','https://evil.invalid/file','https://u:p@work.weixin.qq.com/file'])await expect(downloadWecom(url,'key',['weixin.qq.com'],new AbortController().signal)).rejects.toThrow('host')
})
it('decrypts bounded file responses and preserves the filename supplied by the platform',async()=>{
 const key=Buffer.alloc(32,7),cipher=createCipheriv('aes-256-cbc',key,key.subarray(0,16)),encrypted=Buffer.concat([cipher.update(Buffer.from('office-file-marker')),cipher.final()])
 const fetch=vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(Uint8Array.from(encrypted),{headers:{'content-disposition':"attachment; filename*=UTF-8''report.docx"}}))
 const result=await downloadWecom('https://files.weixin.qq.com/resource',key.toString('base64'),['weixin.qq.com'],new AbortController().signal)
 expect(Buffer.isBuffer(result)).toBe(false);if(!Buffer.isBuffer(result)){expect(result.filename).toBe('report.docx');expect(result.buffer.toString()).toBe('office-file-marker')}
 expect(fetch.mock.calls[0]![1]!.redirect).toBe('error')
})
it('treats lost send acknowledgements as uncertain and does not silently retry',async()=>{
 const f=fixture();await f.source.receiveFrame(frame());f.transport.fail=true
 await expect(f.source.deliver(delivery(f))).rejects.toBeInstanceOf(UncertainDelivery);expect(f.transport.sends).toHaveLength(1)
})
it('refuses expired active-send windows and oversized replies before sending',async()=>{
 const f=fixture();await f.source.receiveFrame(frame());const r=f.store.list<any>('wecom-inbox')[0];r.receivedAt=Date.now()-25*3600000;f.store.put('wecom-inbox',r.key,r)
 await expect(f.source.deliver(delivery(f))).rejects.toThrow('window expired');expect(f.transport.sends).toHaveLength(0)
 r.receivedAt=Date.now();f.store.put('wecom-inbox',r.key,r);await expect(f.source.deliver({...delivery(f),text:'文'.repeat(7000)})).rejects.toThrow('text limit')
})
it('revokes group reads and delivery when that group is removed from the configuration',async()=>{
 const f=fixture();await f.source.receiveFrame(frame('group-revocation',{chattype:'group',chatid:'allowed-group'}));f.config.sources[0]!.wecom!.chats=[]
 await expect(f.source.read({resource:'message',trigger:f.events[0],pageSize:20})).rejects.toThrow('no longer configured')
 await expect(f.source.deliver(delivery(f))).rejects.toThrow('no longer configured');expect(f.transport.sends).toHaveLength(0)
})
it('recovers durable input after a host restart without replaying its receipt',async()=>{
 const f=fixture();f.ctx.receive=()=>{throw Error('crash boundary')};await expect(f.source.receiveFrame(frame())).rejects.toThrow('crash boundary')
 await f.source.close();const nextTransport=new Transport(),next=new WecomSource(f.config.sources[0]!,()=>nextTransport);sources.push(next);next.start({...f.ctx,receive:t=>f.events.push(t)})
 expect(f.events).toHaveLength(1);expect(nextTransport.receipts).toHaveLength(0)
})
it('uses the actual official SDK over WebSocket for authentication, receipt, routing and result delivery',async()=>{
 credentials();const p=root(),wss=new WebSocketServer({host:'127.0.0.1',port:0});servers.push(wss);await new Promise<void>(r=>wss.once('listening',r))
 let socket:WebSocket|undefined;const frames:any[]=[]
 wss.on('connection',ws=>{socket=ws;ws.on('message',data=>{const f=JSON.parse(data.toString());frames.push(f);ws.send(JSON.stringify({headers:f.headers,errcode:0}))})})
 const config=configuration(p,{wsUrl:'ws://127.0.0.1:'+(wss.address() as any).port});let workerRuns=0
 const model:Model={async run(r:ModelRequest){const threadId=r.threadId??'synthetic-worker',turnId='turn-'+Date.now();r.onThread?.(threadId);r.onTurn?.(turnId)
  if(r.ephemeral)return {threadId,turnId,text:JSON.stringify({action:'accept',title:'Read',scope:'Inspect received message',rules:[],ruleAssessments:[],reason:'Explicit test',targetTicketId:null})}
  workerRuns++;const raw=JSON.parse(r.input),trigger=raw.origin?.[0]??raw.inputs.find((i:any)=>i.event)?.event
  if(trigger)await r.onTool!('superagent_read',{resource:'wecom/'+trigger.id+'/message'},'read')
  return {threadId,turnId,text:JSON.stringify({state:'ready',summary:'Read',reply:'wecom-runtime-result',question:null,handbacks:[]})}
 }}
 const host=new Runtime(config,{model});hosts.push(host)
 for(let i=0;i<100&&!host.store.get<any>('source-live','wecom')?.authenticated;i++){await host.tick();await new Promise(r=>setTimeout(r,10))}
 expect(host.store.get<any>('source-live','wecom').authenticated).toBe(true);expect(frames.find(f=>f.cmd==='aibot_subscribe').body.secret).toBe('synthetic-wecom-secret')
 socket!.send(JSON.stringify(frame()))
 for(let i=0;i<100&&!host.store.deliveries().some(d=>d.kind==='reply'&&d.status==='sent');i++){await host.tick();await host.flush();await new Promise(r=>setTimeout(r,10))}
 expect(workerRuns).toBe(1);expect(frames.some(f=>f.cmd==='aibot_respond_msg')).toBe(true);expect(frames.find(f=>f.cmd==='aibot_send_msg'&&f.body.markdown?.content==='wecom-runtime-result').body).toMatchObject({chatid:'alice',markdown:{content:'wecom-runtime-result'}})
 socket!.send(JSON.stringify(frame()));await new Promise(r=>setTimeout(r,40));await host.tick();expect(workerRuns).toBe(1)
})
