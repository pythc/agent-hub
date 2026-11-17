import {mkdirSync,writeFileSync,readFileSync} from 'node:fs'
import {join} from 'node:path'
import {Runtime} from '../src/runtime.ts'
import {configSchema} from '../src/config.ts'
import {serve} from '../src/server.ts'
const root=process.env.MEMORY_BROWSER_DIR??'/tmp/agenthub-memory-browser-'+Date.now();mkdirSync(root,{recursive:true})
const config=configSchema.parse({stateDir:join(root,'state'),port:0,acceptMode:'auto',work:{sandboxDriver:'disabled'},execution:{router:{mode:'host'},management:{enabled:true},workers:[{id:'one',backend:'codex'}]},sources:[{id:'local',kind:'local',cwd:root,workspace:{mode:'source'},allowedActors:['alice']}]})
const h=new Runtime(config,{model:{async run(){throw Error('Browser fixture does not execute models')},async purge(){return {local:'verified',provider:'not_managed'}}}});h.pause(true)
h.scopes.command({action:'scope.put',operationId:'scope',expectedRevision:0,scope:{id:'team',tenantId:'test',name:'Memory browser',managers:[JSON.stringify(['local','alice'])],workerIds:['one'],sourceIds:['local'],backendIds:['codex']}})
for(const name of ['a','b'])h.scopes.command({action:'entry.bind',operationId:name,expectedRevision:0,scopeId:'team',sourceId:'local',accountNamespace:'local',nativeId:name,history:'group'})
let n=0
const send=(text:string,group='a')=>{const out=h.receive('local','alice',{id:'msg-'+(++n),scope:group,thread:group,addressed:true,text}) as any;const t=h.store.triggers.get(out.triggerId)!;return h.scopes.context(t,'local:'+group)!}
const c=send('技术报告先给结论；原始来源验证标记；<script>window.memoryPwned=1</script>'),e=h.memory.ingest(c)
const remember=(subject:string,content:string,extra:any={})=>h.memory.command(c,{action:'remember',operationId:'write-'+(++n),expectedRevision:0,subject,content,kind:'preference',sourceIds:[e.id],candidate:false,...extra},true) as any
const old=remember('报告顺序','技术报告先给结论',{learning:{inferred:false,condition:'技术报告',quote:'技术报告先给结论'}})
const pending=remember('报告顺序','技术报告先列未验证项',{candidate:true,replaces:[{id:old.id,revision:old.revision}],origin:'extracted',learning:{inferred:false,condition:'技术报告',quote:'技术报告先给结论'}})
const rejectedSource=h.memory.ingest(send('用于浏览器拒绝建议验证'))
const rejected=remember('不保留项目','用于浏览器拒绝建议验证',{candidate:true,kind:'fact',sourceIds:[rejectedSource.id]})
const forgetTarget=remember('过期事项','浏览器过期约定',{kind:'fact'})
const deletion=remember('删除过期事项','浏览器过期约定',{kind:'fact',candidate:true,proposalAction:'forget',replaces:[{id:forgetTarget.id,revision:forgetTarget.revision}]})
const other=send('另一入口的独立内容','b')
const host=await serve(h),authorization='Bearer '+readFileSync(host.tokenPath,'utf8').trim()
const setup=await fetch(host.url+'/account/setup',{method:'POST',headers:{authorization,'content-type':'application/json',origin:host.url},body:JSON.stringify({username:'memory-review',displayName:'记忆验证',password:'isolated memory browser password',remember:false})});if(setup.status!==201)throw Error('setup failed '+setup.status)
const cookie=setup.headers.get('set-cookie')!.split(';')[0]!
const identity=await (await fetch(host.url+'/api/chat/readiness',{headers:{cookie}})).json() as {user:{id:string}}
h.pause(false)
const chat=h.chat.create(identity.user.id);h.chat.space(identity.user.id)
const otherChat=h.chat.create(identity.user.id)
const chatTitle='以后技术报告先给结论，再给验证证据；日常更新简短一些。'
const chatRun=h.chat.send(chat.id,identity.user.id,{clientMessageId:crypto.randomUUID(),text:chatTitle})
h.chat.send(otherChat.id,identity.user.id,{clientMessageId:crypto.randomUUID(),text:'另一个独立任务'})
const hiddenChat=h.chat.create('another-owner');h.chat.send(hiddenChat.id,'another-owner',{clientMessageId:crypto.randomUUID(),text:'这条属于另一个账号，不可展示'})
h.pause(true)
const chatContext=h.scopes.context(h.store.triggers.get(chatRun.runId)!,'local:chat:'+chat.id)!,chatSource=h.memory.ingest(chatContext)
const note=(subject:string,content:string,extra:any={})=>h.memory.command(chatContext,{action:'remember',operationId:'chat-memory-'+(++n),expectedRevision:0,subject,content,kind:'preference',sourceIds:[chatSource.id],candidate:false,...extra},true) as any
const chatPreference=note('报告顺序','技术报告先给结论，再给验证证据',{learning:{inferred:false,condition:'技术报告',quote:'技术报告先给结论，再给验证证据'}})
const chatTentative=note('日常沟通','日常进度更新可以简短一些',{candidate:true,origin:'extracted',learning:{inferred:true,condition:'日常更新',quote:'日常更新简短一些'}})
h.memory.acceptLearning(chatContext,chatTentative)
const chatCandidate=note('待核对的工作约定','验收时保留测试结果的原始输出',{candidate:true,kind:'fact'})
const chatConvention=note('Verify generated files','Read generated files back before reporting completion.',{kind:'fact',origin:'experience',learning:{inferred:true,condition:'File generation',quote:'再给验证证据'}})
// Synthetic completed goal for browser-only method editing. Unit tests execute
// the real Worker and independent verification path separately.
const accepted=h.goals.command({action:'start',operationId:'browser-method',expectedRevision:0,title:'演示报告方法',objective:'生成 report.md',authorizationQuote:chatTitle,criteria:[{id:'report',description:'报告文件存在',files:['report.md'],check:{kind:'file_exists',path:'report.md'}}],nodes:[{id:'write',title:'生成报告',instruction:'生成 report.md',workerId:'one',criterionIds:['report']}]},chatContext)
h.store.put('goal-verification','browser-acceptance',{id:'browser-acceptance',goalId:accepted.id,state:'passed',at:Date.now(),checks:[],snapshot:{evidence:[]}})
h.store.put('router-goal',accepted.id,{...accepted,state:'completed',finalRoundId:'browser-acceptance'})
writeFileSync(join(root,'fixture.json'),JSON.stringify({url:host.url,cookie,triggerId:c.trigger.id,other:other.trigger.id,old:old.id,pending:pending.id,rejected:rejected.id,deletion:deletion.id,forgetTarget:forgetTarget.id,chat:chat.id,otherChat:otherChat.id,chatTitle,chatTrigger:chatRun.runId,chatPreference:chatPreference.id,chatTentative:chatTentative.id,chatCandidate:chatCandidate.id,chatConvention:chatConvention.id}),{mode:0o600})
console.log(host.url)
const stop=async()=>{await new Promise<void>(r=>host.server.close(()=>r()));await host.closeRuntime();process.exit(0)};process.on('SIGTERM',()=>void stop());process.on('SIGINT',()=>void stop())
