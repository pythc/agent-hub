/** Isolated, deterministic companion acceptance host; no external model calls. */
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs'
import {resolve,join} from 'node:path'
import {randomUUID} from 'node:crypto'
import {Runtime} from '../src/runtime.ts'
import {configSchema} from '../src/config.ts'
import {serve} from '../src/server.ts'
import type {ModelRequest} from '../src/model.ts'
const native=false
const root=resolve(process.argv[2]??'.local/chat-companion-fixture')
mkdirSync(join(root,'workspace'),{recursive:true})
const config=configSchema.parse({stateDir:join(root,'state'),port:Number(process.env.ROPPO_CHAT_PORT??0),work:{sandboxDriver:'disabled',network:false},turnTimeoutMs:180000,
  execution:{router:{mode:'host',label:'Rory',model:'gpt-6.1-terra',effort:'medium'},management:{enabled:true,maxWorkers:4},workers:[{id:'research',label:'Atlas',backend:'codex',model:'gpt-6.1-sol',effort:'high'},{id:'planning',label:'Planning',backend:'codex',model:'gpt-6.1-sol',effort:'high'},{id:'review',label:'Review',backend:'codex',model:'gpt-6.1-sol',effort:'high'},{id:'worker-4',label:'Worker 4',backend:'codex',model:'gpt-6.1-sol',effort:'high'}]},
  sources:[{id:'local',kind:'local',cwd:join(root,'workspace'),allowedActors:['operator'],workspace:{mode:'source'}}]})
const model={async run(r:ModelRequest){
  const threadId=r.threadId??randomUUID(),turnId=randomUUID();r.onThread?.(threadId);r.onTurn?.(turnId)
  const wait=(ms:number)=>new Promise<void>((resolve,reject)=>{const timer=setTimeout(done,ms);function done(){r.signal?.removeEventListener('abort',stop);resolve()}function stop(){clearTimeout(timer);reject(Error('Fixture cancelled'))}r.signal?.addEventListener('abort',stop,{once:true});if(r.signal?.aborted)stop()})
  const state=async(phase:string,label:string)=>{const result=await r.onTool!('superagent_status',{phase,label},randomUUID());if(!result.success)throw Error('Status rejected')}
  const data=JSON.parse(r.input),text=String(data.trigger?.text??'')
  const reply=async(text:string)=>{const raw=JSON.stringify({reply:text});r.onOutput?.({id:turnId,type:'start',phase:'answer'});for(let i=0;i<raw.length;i+=80){r.onOutput?.({id:turnId,type:'delta',phase:'answer',text:raw.slice(i,i+80)});await wait(35)}return {threadId,turnId,text:raw}}
  if(r.role==='worker'){
    await state('reviewing','正在核对待确认事项');await wait(1200)
    return {threadId,turnId,text:JSON.stringify({state:'blocked',summary:'Waiting for a design decision',reply:'请确认是否采用这套输入栏布局。',question:'确认后继续吗？',askedBy:null,handbacks:[]})}
  }
  if(data.kind==='user_message'&&text.includes('等待测试')){
    const result=await r.onTool!('worker_manage',{action:'list'},randomUUID());const revision=JSON.parse(result.contentItems[0]!.text!).revision
    await r.onTool!('worker_manage',{action:'assign',id:'research',revision,requestId:turnId+'-research',text:'检查输入栏布局并等待用户确认。'},randomUUID())
    return reply('已交给 Atlas 检查布局。')
  }
  if(data.kind!=='user_message')return reply('请确认布局后继续。')
  if(text.includes('失败测试'))throw Error('Fixture failure: task needs attention')
  if(text.includes('工作测试')){await state('working','正在整理工作文件');await wait(20000);return reply('文件已整理。')}
  await state('thinking','正在梳理聊天布局');await wait(2600)
  await state('working','正在调整输入组件');await wait(3600)
  await state('reviewing','正在审查输入组件');await wait(5000)
  return reply('已完成聊天界面的布局检查。\n\n### 本次调整\n\n1. 消息正文与输入栏共用中心轴。\n2. 头像放在正文左侧。\n3. 输入区域保留当前字号。\n\n| 检查项 | 结果 |\n| --- | --- |\n| 中文输入法 | 已检查 |\n| 窄屏排版 | 已检查 |\n\n```typescript\nconst alignment = { content: 800, avatar: "outside" };\n```\n\n'+Array.from({length:12},(_,i)=>'段落 '+(i+1)+'：这是一段用于检查长消息滚动的测试内容。用户向上阅读时应停留在当前位置，新的输出可以通过回到最新按钮查看。').join('\n\n'))
}}
const runtime=new Runtime(config,native?{}:{model}),host=await serve(runtime)
runtime.start()
const token=readFileSync(join(config.stateDir,'access-token'),'utf8').trim()
const username='chat-preview',password='Roppo-preview-2026!'
const status=await fetch(host.url+'/account/status').then(r=>r.json()) as {configured:boolean}
const response=await fetch(host.url+(status.configured?'/account/login':'/account/setup'),{method:'POST',headers:{authorization:'Bearer '+token,origin:host.url,'content-type':'application/json'},body:JSON.stringify(status.configured?{username,password,remember:true}:{username,displayName:'Alex',password,remember:true})})
if(!response.ok)throw Error('Synthetic acceptance account setup failed: '+response.status)
const cookie=response.headers.get('set-cookie')!.split(';')[0]!
writeFileSync(join(root,'browser.json'),JSON.stringify({base:host.url,url:host.url+'/chat',username,password,cookie,native}),{mode:0o600})
console.log(JSON.stringify({url:host.url+'/chat',mode:native?'native Codex':'model fixture',info:join(root,'browser.json')}))
async function close(){host.server.closeAllConnections();await new Promise<void>(r=>host.server.close(()=>r()));await host.closeRuntime()}
process.once('SIGTERM',()=>void close());process.once('SIGINT',()=>void close())
