/** Opt-in real Slack acceptance. Run `listen`, post its marker through another authorized
 * identity, then run `resume` after posting the offline marker. No credentials are logged. */
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs'
import {join,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {buildPluginPackage,readPluginPackage} from '../src/plugin-package.ts'
import {SourceRegistry} from '../src/source-plugins.ts'
import {configSchema} from '../src/config.ts'
import {ProcessSource} from '../src/plugin-process.ts'
import {Store} from '../src/store.ts'
import type {SourceContext} from '../src/sources.ts'
import type {Trigger} from '../plugins/sdk.ts'

const phase=process.argv[2],out=resolve(process.argv[3]??'.local/plugin-slack-live')
assert(['listen','resume'].includes(phase??''),'Use listen or resume')
assert.equal(process.env.AGENTHUB_LIVE_SEND,'1','Explicit live-send opt-in is required')
const channel=process.env.AGENTHUB_TEST_SLACK_CHANNEL??'',team=process.env.AGENTHUB_TEST_SLACK_TEAM??''
assert(/^[CG][A-Z0-9]+$/.test(channel)&&/^T[A-Z0-9]+$/.test(team),'Explicit authorized channel and workspace are required')
assert(process.env.AGENTHUB_SLACK_BOT_TOKEN&&process.env.AGENTHUB_SLACK_APP_TOKEN,'Bot and Socket Mode credentials are required')
mkdirSync(out,{recursive:true,mode:0o700})
const write=(name:string,data:unknown)=>writeFileSync(join(out,name+'.json'),JSON.stringify(data,null,2)+'\n',{mode:0o600})
const read=(name:string)=>JSON.parse(readFileSync(join(out,name+'.json'),'utf8'))
const root=fileURLToPath(new URL('../',import.meta.url)),pkgDir=join(out,'package')
const pkg=existsSync(pkgDir)?readPluginPackage(pkgDir):await buildPluginPackage(join(root,'plugins/slack/index.ts'),JSON.parse(readFileSync(join(root,'plugins/slack/manifest.json'),'utf8')),pkgDir)
const run=createHash('sha256').update(out+pkg.digest).digest('hex').slice(0,12)
const marker=(stage:string)=>'[AgentHub Slack validation '+run+' '+stage+']'
const config=configSchema.parse({stateDir:join(out,'state'),work:{sandboxDriver:'seatbelt'},sourcePlugins:[{directory:pkg.directory,digest:pkg.digest}],sources:[{id:'slack-live',kind:'slack',cwd:out,allowedActors:[],options:{channels:[channel],teamId:team,tokenEnv:'AGENTHUB_SLACK_BOT_TOKEN',appTokenEnv:'AGENTHUB_SLACK_APP_TOKEN'}}]})
const store=new Store(join(config.stateDir,'live.sqlite')),source=(await SourceRegistry.load(config)).create(config.sources[0]!) as ProcessSource
source.attach(store)
const context:SourceContext={store,receive(t){store.triggers.save(t)},change(e){store.put('acceptance-change',e.id,e)},bind(){throw Error('Unexpected binding request')},closed(){throw Error('Unexpected close request')}}
const api=async(operation:string,input:Record<string,unknown>)=>{
 const url=new URL(operation,'https://slack.com/api/');for(const [k,v] of Object.entries(input))url.searchParams.set(k,String(v))
 const response=await fetch(url,{headers:{authorization:'Bearer '+process.env.AGENTHUB_SLACK_BOT_TOKEN},redirect:'error',signal:AbortSignal.timeout(15000)})
 const data=await response.json() as any
 assert(response.ok&&data.ok,'Independent Slack readback failed: '+String(data.error??response.status))
 return data
}
// The authorized Slack connector appends its visible attribution to user messages.
// Match only the exact marker or that suffix; retain and verify the full platform text.
const isMarker=(text:string,stage:string)=>text===marker(stage)||(text.startsWith(marker(stage))&&/^\s+\*发送工具\*\s+<@U[A-Z0-9]+>$/.test(text.slice(marker(stage).length)))
const findMarker=(stage:string)=>store.list<Trigger>('trigger').find(t=>t.meta.chat===channel&&isMarker(t.text,stage))
async function verifyAndReply(trigger:Trigger,stage:string){
 assert.equal(trigger.source,'slack-live');assert.equal(trigger.meta.chat,channel)
 const before=await source.read({resource:'message',trigger,pageSize:50})
 assert.equal(before.message.ts,trigger.meta.messageId);assert(isMarker(trigger.text,stage));assert.equal(before.message.text,trigger.text)
 const id='acceptance:'+run+':'+stage,text=marker(stage+'-reply')+' Independent plugin read and reply verified.'
 const existing=store.get<any>('acceptance-delivery',id)
 if(!existing){
  store.put('acceptance-delivery',id,{state:'sending',channel,root:trigger.meta.root,text})
  await source.deliver({id,kind:'reply',channel:trigger.channel!,text})
  store.put('acceptance-delivery',id,{state:'sent',channel,root:trigger.meta.root,text})
 }else assert.equal(existing.state,'sent','Uncertain delivery; reconcile destination before retry')
 let cursor='',matches:any[]=[]
 for(let page=0;page<20;page++){
  const data=await api('conversations.replies',{channel,ts:trigger.meta.root,limit:100,...(cursor?{cursor}:{})})
  matches.push(...(data.messages??[]).filter((m:any)=>m.text===text))
  const next=data.response_metadata?.next_cursor??''
  assert(!data.has_more||next,'Incomplete independent readback')
  if(!next)break
  assert(next!==cursor&&page<19,'Independent readback exceeded pagination bound');cursor=next
 }
 assert.equal(matches.length,1,'Expected exactly one independently read-back bot reply')
 assert.equal(matches[0].user,(await source.identity()).id.split(':')[1])
 return {stage,triggerId:trigger.id,root:trigger.meta.root,messageId:trigger.meta.messageId,replyId:matches[0].ts,text:trigger.text}
}
try{
 const identity=await source.identity();assert.equal(identity.type,'bot')
 const probe=await source.probe();assert(probe.choices.some((c:any)=>c.id===channel),'Bot must be a member of the authorized test channel')
 assert((await source.members(channel)).some((m:{id:string;bot?:boolean})=>identity.id.endsWith(':'+m.id)&&m.bot),'Bot membership must be verified')
 store.put('source-identity','slack-live',{principal:identity.id})
 if(phase==='listen'){
  assert(!existsSync(join(out,'ready.json')),'Listen phase already started; use resume if complete, otherwise use a fresh acceptance directory')
  await source.start(context)
  assert.equal(store.get<any>('source-live','slack-live')?.status,'ready')
  write('ready',{run,digest:pkg.digest,team,channel,identity,liveMarker:marker('live'),offlineMarker:marker('offline'),at:new Date().toISOString()})
  console.log(JSON.stringify({phase:'listening',run,channel,marker:marker('live')}))
  const deadline=Date.now()+10*60_000
  while(!findMarker('live')&&Date.now()<deadline)await new Promise(r=>setTimeout(r,250))
  const trigger=findMarker('live');assert(trigger,'No matching real Socket Mode event received before deadline')
  const result=await verifyAndReply(trigger,'live')
  assert(!findMarker('offline'),'Offline marker was posted before shutdown; use a fresh acceptance directory')
  store.put('thread','slack-live:'+channel+':'+trigger.meta.root,{ref:{source:'slack-live',id:channel+':'+trigger.meta.root},subscriptions:['acceptance']})
  const cursor={since:String(Math.floor(Date.now()/1000)-2)}
  store.put('source-cursor','slack-live:'+channel,cursor)
  await source.close();store.close()
  write('restart-ready',{run,digest:pkg.digest,team,channel,identity,result,cursor,offlineMarker:marker('offline'),at:new Date().toISOString()})
  console.log(JSON.stringify({phase:'offline',run,channel,thread:trigger.meta.root,marker:marker('offline')}))
 }else{
  const previous=read('restart-ready')
  assert.equal(previous.run,run);assert.equal(previous.digest,pkg.digest);assert.equal(previous.team,team);assert.equal(previous.channel,channel);assert.equal(previous.identity.id,identity.id)
  assert.deepEqual(store.get('source-cursor','slack-live:'+channel),previous.cursor,'Durable cursor changed before resumed poll')
  const original=store.triggers.get(previous.result.triggerId);assert(original,'Live event did not survive full process restart')
  const originalRead=await source.read({resource:'message',trigger:original,pageSize:50});assert.equal(originalRead.message.text,previous.result.text)
  assert(!findMarker('offline'),'Offline event was already persisted before the recovery phase')
  // Poll before opening a socket: this proves downtime recovery came from durable backfill.
  await source.poll(context)
  const recovered=findMarker('offline');assert(recovered,'Offline marker not recovered; post it while listen is stopped before running resume')
  assert.equal(recovered.meta.root,previous.result.root,'Offline event must be recovered from the original subscribed thread')
  const result=await verifyAndReply(recovered,'offline')
  const count=store.list<Trigger>('trigger').filter(t=>t.meta.chat===channel&&isMarker(t.text,'offline')).length
  assert.equal(count,1,'Expected one durable offline event')
  await source.poll(context)
  assert.equal(store.list<Trigger>('trigger').filter(t=>t.meta.chat===channel&&isMarker(t.text,'offline')).length,count,'Repeated poll duplicated durable events')
  // Existing sent receipts must survive restart; this call only reads back the first reply.
  assert(store.get<any>('acceptance-delivery','acceptance:'+run+':live')?.state==='sent','Live reply receipt did not survive restart')
  await verifyAndReply(original,'live')
  await source.start(context);assert.equal(store.get<any>('source-live','slack-live')?.status,'ready')
  const evidence={ok:true,at:new Date().toISOString(),run,digest:pkg.digest,team,channel,identity,checks:{realBotIdentity:true,realSocketIngress:true,pluginMessageRead:true,pluginBotReply:true,independentPlatformReadback:true,fullProcessRestart:true,durableCursor:true,downtimeBackfill:true,repeatedPollDedup:true,socketReconnect:true},messages:[previous.result,result],boundary:'Isolated real Slack I/O, Socket Mode and full acceptance-process restart. Router/Worker model tasks and plugin upgrade/rollback have separate evidence; production host unchanged.'}
  write('evidence',evidence);console.log(JSON.stringify(evidence))
 }
}finally{await source.close();if(store.db.isOpen)store.close()}
