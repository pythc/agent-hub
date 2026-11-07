import {mkdirSync,writeFileSync,readFileSync} from 'node:fs'
import {join} from 'node:path'
import {Runtime} from '../src/runtime.ts'
import {configSchema} from '../src/config.ts'
import {serve} from '../src/server.ts'
const root=process.env.MEMORY_BROWSER_DIR??'/tmp/agenthub-memory-browser-'+Date.now();mkdirSync(root,{recursive:true})
const config=configSchema.parse({stateDir:join(root,'state'),port:0,acceptMode:'auto',work:{sandboxDriver:'disabled'},execution:{router:{mode:'host'},management:{enabled:true},workers:[{id:'one',backend:'codex'}]},sources:[{id:'local',kind:'local',cwd:root,workspace:{mode:'source'},allowedActors:['alice']}]})
const h=new Runtime(config,{model:{async run(){throw Error('Browser fixture does not execute models')}}});h.pause(true)
h.scopes.command({action:'scope.put',operationId:'scope',expectedRevision:0,scope:{id:'team',tenantId:'test',name:'Memory browser',managers:[JSON.stringify(['local','alice'])],workerIds:['one'],sourceIds:['local'],backendIds:['codex']}})
for(const name of ['a','b'])h.scopes.command({action:'entry.bind',operationId:name,expectedRevision:0,scopeId:'team',sourceId:'local',accountNamespace:'local',nativeId:name,history:'group'})
let n=0
const send=(text:string,group='a')=>{const out=h.receive('local','alice',{id:'msg-'+(++n),scope:group,thread:group,addressed:true,text}) as any;const t=h.store.triggers.get(out.triggerId)!;return h.scopes.context(t,'local:'+group)!}
const c=send('技术报告先给结论；原始来源验证标记；<script>window.memoryPwned=1</script>'),e=h.memory.ingest(c)
const remember=(subject:string,content:string,extra:any={})=>h.memory.command(c,{action:'remember',operationId:'write-'+(++n),expectedRevision:0,subject,content,kind:'preference',sourceIds:[e.id],candidate:false,...extra},true) as any
const old=remember('报告顺序','技术报告先给结论')
const pending=remember('报告顺序','技术报告先列未验证项',{candidate:true,replaces:[{id:old.id,revision:old.revision}],origin:'extracted'})
const rejected=remember('不保留项目','用于浏览器拒绝建议验证',{candidate:true,kind:'fact'})
const other=send('另一入口的独立内容','b')
const host=await serve(h),authorization='Bearer '+readFileSync(host.tokenPath,'utf8').trim()
const setup=await fetch(host.url+'/account/setup',{method:'POST',headers:{authorization,'content-type':'application/json',origin:host.url},body:JSON.stringify({username:'memory-review',displayName:'记忆验证',password:'isolated memory browser password',remember:false})});if(setup.status!==201)throw Error('setup failed '+setup.status)
writeFileSync(join(root,'fixture.json'),JSON.stringify({url:host.url,cookie:setup.headers.get('set-cookie')!.split(';')[0],triggerId:c.trigger.id,other:other.trigger.id,old:old.id,pending:pending.id,rejected:rejected.id}),{mode:0o600})
console.log(host.url)
const stop=async()=>{await new Promise<void>(r=>host.server.close(()=>r()));await host.closeRuntime();process.exit(0)};process.on('SIGTERM',()=>void stop());process.on('SIGINT',()=>void stop())
