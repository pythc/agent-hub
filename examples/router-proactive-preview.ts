/** Isolated operator UI fixture. No external model or group messages. */
import {mkdtempSync,writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {Runtime} from '../src/runtime.ts'
import {serve} from '../src/server.ts'
import {configSchema} from '../src/config.ts'
const root=mkdtempSync(join(tmpdir(),'router-proactive-ui-'))
const h=new Runtime(configSchema.parse({stateDir:join(root,'state'),port:Number(process.env.AGENTHUB_PREVIEW_PORT??0),acceptMode:'auto',execution:{router:{mode:'host'},management:{enabled:true},workers:[{id:'one',backend:'codex'}]},sources:[{id:'local',kind:'local',cwd:root,allowedActors:['operator'],workspace:{mode:'source'}}]}),{model:{
 async run(r){
  const threadId=r.threadId??'fixture-'+Date.now();r.onThread?.(threadId)
  return {threadId,turnId:'fixture-turn',text:JSON.stringify(r.ephemeral?{action:'ignore',title:'',scope:'',reason:'No action needed',question:'',rules:[],targetTicketId:null,ruleAssessments:[]}:{reply:'已完成本地演示检查。'})}
 }
}})
h.scopes.command({action:'scope.put',operationId:'scope',expectedRevision:0,scope:{id:'team',tenantId:'org',name:'演示团队',managers:[JSON.stringify(['local','operator'])],workerIds:['one'],sourceIds:['local'],backendIds:['codex']}})
h.scopes.command({action:'entry.bind',operationId:'entry',expectedRevision:0,scopeId:'team',sourceId:'local',accountNamespace:'local',nativeId:'demo',history:'group'})
const anchor=h.receive('local','operator',{id:'authorized',thread:'demo-topic',scope:'demo',text:'允许创建演示用定时检查，结果只发送到本地演示入口。',addressed:true}) as any
const server=await serve(h),file=process.env.AGENTHUB_PREVIEW_INFO??join(root,'preview.json')
writeFileSync(file,JSON.stringify({url:server.operatorUrl,endpoint:server.url,root,triggerId:anchor.triggerId,tokenPath:server.tokenPath}),{mode:0o600})
console.log(JSON.stringify({preview:server.url,info:file}))
process.once('SIGTERM',()=>{server.server.close();void server.closeRuntime()})
