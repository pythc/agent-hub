import {mkdirSync,mkdtempSync,writeFileSync} from 'node:fs'
import {join,resolve} from 'node:path'
import {randomBytes} from 'node:crypto'
import {Runtime} from '../src/runtime.ts'
import {configSchema} from '../src/config.ts'
import {CodexModel} from '../src/codex.ts'
import {reportSchema} from '../src/schemas.ts'
import {serve} from '../src/server.ts'
import {latestAssignment} from '../src/vendor/dsh-core/index.ts'
mkdirSync(resolve('validation'),{recursive:true})
mkdirSync(resolve('.local'),{recursive:true})
const root=mkdtempSync(resolve('validation/managed-native-resources-'))
const codex=process.env.CODEX_BINARY??'codex'
writeFileSync(join(root,'marker.txt'),'resource-evidence-20261104')
writeFileSync(join(root,'pixel.png'),Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAjUlEQVR4nO3awQnAQAwDwfWS/lu+FOHAsZD5CwR+GTRwKJM4iZM4iZM4iZM4iZM4iZM4iZM4iZM4iZM4iZO4ZxM+zCclZvGX5y8gcRIncRIncRIncRIncRIncRIncRIncRIncRIncRIncRI3/1biMomTOImTOImTOImTOImTOImTOImTOImTOInzdoGtFx55BH+YOx2GAAAAAElFTkSuQmCC','base64'))
const evidence:any={at:new Date().toISOString()}
for(const legacy of (process.env.LEGACY_ONLY?[true]:[false,true])){
 const config=configSchema.parse({stateDir:join(root,legacy?'legacy-state':'state'),port:0,codex,model:'gpt-6.1-terra',effort:'high',turnTimeoutMs:180000,sources:[{id:'local',kind:'local',allowedActors:['operator'],cwd:root}]})
 let seed:string|undefined
 if(legacy){const model=new CodexModel(config);seed=(await model.run({cwd:root,instructions:'只回复 JSON。',input:'仅作原生会话初始化，ready，summary 为 initialized，reply 为 initialized，question 为 null，handbacks 为空数组。',schema:reportSchema,sandbox:'read-only',archiveOnComplete:true})).threadId}
 const host=new Runtime(config),calls:string[]=[],token=randomBytes(8).toString('hex')
 host.approvals.request=async(id,native)=>{writeFileSync('validation/native-mcp-elicitation.json',JSON.stringify(native,null,2));throw Error('Unexpected elicitation captured')}
 const original=host.resources.read.bind(host.resources)
 host.resources.read=async(value:any,principal:any={})=>{
  if(principal.ticketId)calls.push(value.resource)
  const result=await original(value,principal)
  if(principal.ticketId&&value.resource==='files/marker.txt'){
   const current=host.settings.current()
   host.updateSettings(current.revision,{prompts:{...host.config.prompts,worker:'本轮最终 reply 必须额外包含这段刚生效的验收码：'+token+'。仅在最终答复显示验收码，继续遵守原任务。'}})
  }
  return result
 }
 host.receive('local','operator',{id:'resource-test',thread:'resources',addressed:true,text:'合成只读验收：依次调用 superagent_read 读取 image/pixel.png 和 files/marker.txt。确认图片内容由原生图片输入返回。最终 reply 包含文件原文，说明图片是否看到了，并遵守本轮生效的团队提示词。禁止 shell 和子代理，不联系外部系统。'})
 if(seed){
  host.engine.evaluateDue()
  const trigger=host.store.list<any>('trigger')[0],candidate=host.engine.candidate(trigger.id)!
  host.engine.decide(trigger.id,{kind:'accept',title:'Legacy MCP resources',scope:trigger.text,rules:[],reason:'Synthetic acceptance',evalId:candidate.evalId})
  const t=host.store.tickets.list()[0]!
  host.store.put('run',t.id,{ticketId:t.id,assignmentId:'pre-v4-seed',cwd:root,prepared:true,phase:'idle',threadId:seed})
 }
 const server=await serve(host)
 try{
  const until=Date.now()+240000
  while(Date.now()<until){
   await new Promise(r=>setTimeout(r,250))
   const t=host.store.tickets.list()[0]
   if(!t)continue
   const run=host.store.get<any>('run',t.id)
   if(run?.phase==='uncertain')throw Error(JSON.stringify(run))
   if(t.ended){
    const cap=host.store.get<any>('capabilities',t.id),uses=host.store.list<any>('prompt-use')
    if(!calls.includes('image/pixel.png')||!calls.includes('files/marker.txt')||!run.result?.includes(token)||!run.result.includes('resource-evidence-20261104')||!run.result.includes('蓝')||!run.result.includes('红')||!uses.some(u=>u.injected)||legacy&&run.threadId!==seed||legacy&&!cap.mcpServers.includes('superagent-worker'))throw Error('Resource acceptance failed '+JSON.stringify({run,calls,cap,uses}))
    evidence[legacy?'legacyMcp':'nativeDynamic']={ticket:t.id,thread:run.threadId,sameSeed:legacy?run.threadId===seed:undefined,calls,result:run.result,capabilities:cap,promptUses:uses}
    writeFileSync('validation/native-resource-hot-update.json',JSON.stringify(evidence,null,2)+'\n')
    break
   }
  }
  if(!host.store.tickets.list()[0]?.ended)throw Error('Resource acceptance deadline')
 }finally{await new Promise<void>(r=>server.server.close(()=>r()));await host.close()}
}
writeFileSync('validation/native-resource-hot-update.json',JSON.stringify(evidence,null,2)+'\n')
console.log(JSON.stringify({passed:true,...evidence}))
