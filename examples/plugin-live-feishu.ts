/** Opt-in live bot acceptance. Destination and credentials must be explicitly configured. */
import {readFileSync,mkdirSync,writeFileSync,existsSync} from 'node:fs'
import {join,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {buildPluginPackage} from '../src/plugin-package.ts'
import {SourceRegistry} from '../src/source-plugins.ts'
import {configSchema} from '../src/config.ts'
import {ProcessSource} from '../src/plugin-process.ts'
import {Store} from '../src/store.ts'
const out=resolve(process.argv[2]??'.local/plugin-feishu-live'),root=fileURLToPath(new URL('../',import.meta.url))
mkdirSync(out,{recursive:true,mode:0o700})
const pkgDir=join(out,'package')
const pkg=existsSync(pkgDir)?(await import('../src/plugin-package.ts')).readPluginPackage(pkgDir):await buildPluginPackage(join(root,'plugins/feishu/package.ts'),JSON.parse(readFileSync(join(root,'plugins/feishu/manifest.json'),'utf8')),pkgDir)
const config=configSchema.parse({stateDir:join(out,'state'),work:{sandboxDriver:'seatbelt'},sources:[{id:'feishu-test',kind:'feishu',cwd:out,allowedActors:[],feishu:{chats:(process.env.AGENTHUB_TEST_FEISHU_CHATS??'').split(',').filter(Boolean),appIdEnv:'AGENTHUB_TEST_FEISHU_APP_ID',appSecretEnv:'AGENTHUB_TEST_FEISHU_APP_SECRET',mentionId:process.env.AGENTHUB_TEST_FEISHU_BOT_ID??''}}],sourcePlugins:[{directory:pkg.directory,digest:pkg.digest,replaceBuiltin:true}]})
if(!config.sources[0]!.feishu!.chats.length||!config.sources[0]!.feishu!.mentionId)throw Error('Set authorized chat IDs and bot ID before live acceptance')
const registry=await SourceRegistry.load(config),source=registry.create(config.sources[0]!) as ProcessSource,store=new Store(join(config.stateDir,'live.sqlite'))
source.attach(store)
try{
 const probe=await source.probe();writeFileSync(join(out,'probe.json'),JSON.stringify({at:new Date().toISOString(),digest:pkg.digest,probe},null,2)+'\n',{mode:0o600});console.log(JSON.stringify({phase:'probe',result:probe}))
 if(process.env.AGENTHUB_LIVE_SEND!=='1')process.exitCode=0
 else {
  const tokenResponse=await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({app_id:process.env.AGENTHUB_TEST_FEISHU_APP_ID,app_secret:process.env.AGENTHUB_TEST_FEISHU_APP_SECRET})}).then(r=>r.json()) as any
  if(tokenResponse.code!==0)throw Error('Bot token unavailable')
  const api=async(method:string,path:string,body?:unknown)=>{
   const response=await fetch('https://open.feishu.cn/open-apis/'+path,{method,headers:{authorization:'Bearer '+tokenResponse.tenant_access_token,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000),redirect:'error'}),data=await response.json() as any
   if(!response.ok||data.code!==0)throw Error('Live bot API failed: '+data.code)
   return data.data
  }
  const results:any[]=[]
  for(const chat of config.sources[0]!.feishu!.chats){
   const receiptPath=join(out,'seed-'+chat+'.json'),text='[AgentHub 插件验收] '+out.split('/').at(-1)+'：验证机器人插件的消息回读、进程重启与回执保持。仅为技术验收，无需群成员操作。'
   let receipt:any
   if(existsSync(receiptPath)){receipt=JSON.parse(readFileSync(receiptPath,'utf8'));if(!receipt.messageId)throw Error('Uncertain seed send; reconcile before continuing')}
   else {
    writeFileSync(receiptPath,JSON.stringify({state:'sending',chat}),{mode:0o600,flag:'wx'})
    const sent=await api('POST','im/v1/messages?receive_id_type=chat_id',{receive_id:chat,msg_type:'text',content:JSON.stringify({text}),uuid:(await import('node:crypto')).createHash('sha256').update(out+chat).digest('hex').slice(0,32)})
    receipt={state:'sent',chat,messageId:sent.message_id,text};writeFileSync(receiptPath,JSON.stringify(receipt,null,2),{mode:0o600})
   }
   const trigger=source.trigger({id:'acceptance:'+receipt.messageId,thread:chat+':'+receipt.messageId,text:receipt.text,scope:chat,addressed:false},probe.identity.id,false)
   trigger.meta={scope:chat,chat,root:receipt.messageId,messageId:receipt.messageId};trigger.channel!.address={chat,root:receipt.messageId,messageId:receipt.messageId}
   store.triggers.save(trigger)
   const before=await source.read({resource:'message',trigger,pageSize:50})
   const reply={id:'acceptance:'+out+':'+chat,kind:'reply' as const,channel:trigger.channel!,text:'[AgentHub 插件验收回执 '+pkg.digest.slice(0,8)+'] 独立进程插件已读取原消息，正在核对重启后的同一消息与线程。'}
   const delivered=store.get<any>('acceptance-delivery',reply.id)
   if(!delivered){store.put('acceptance-delivery',reply.id,{state:'sending'});await source.deliver(reply);store.put('acceptance-delivery',reply.id,{state:'sent'})}
   else if(delivered.state!=='sent')throw Error('Uncertain reply; reconcile before continuing')
   const original=await api('GET','im/v1/messages/'+receipt.messageId),thread=original.items?.[0]?.thread_id
   const replies=thread?await api('GET','im/v1/messages?container_id_type=thread&container_id='+encodeURIComponent(thread)+'&page_size=50'):{items:[]}
   const matches=(replies.items??[]).filter((m:any)=>{try{return JSON.parse(m.body?.content??'{}').text===reply.text}catch{return false}})
   if(matches.length!==1)throw Error('Expected exactly one live reply readback')
   results.push({chat,messageId:receipt.messageId,replyMessageId:matches[0].message_id,readback:before,trigger})
  }
  await source.close()
  const restored=(await SourceRegistry.load(config)).create(config.sources[0]!) as ProcessSource;restored.attach(store)
  try{for(const result of results){const after=await restored.read({resource:'message',trigger:result.trigger,pageSize:50});if(after.status!==result.readback.status||['id','text','from','at'].some(k=>after.message[k]!==result.readback.message[k]))throw Error('Message content or identity changed across process restart')}}finally{await restored.close()}
  const evidence={ok:true,at:new Date().toISOString(),digest:pkg.digest,identity:probe.identity,checks:{authorizedChats:results.length===config.sources[0]!.feishu!.chats.length,realBotReplies:true,independentPlatformReadback:true,pluginProcessRestart:true,noDuplicateReply:true},messages:results.map(({chat,messageId,replyMessageId})=>({chat,messageId,replyMessageId})),boundary:'Real platform plugin I/O and process restart; model task/host upgrade acceptance is recorded separately.'}
  writeFileSync(join(out,'evidence.json'),JSON.stringify(evidence,null,2)+'\n',{mode:0o600});console.log(JSON.stringify(evidence))
 }
}finally{await source.close();store.close()}
