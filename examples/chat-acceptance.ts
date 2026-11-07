/** Isolated chat acceptance host. `native` uses the signed-in Codex CLI; default uses a model fixture. */
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs'
import {resolve,join} from 'node:path'
import {randomUUID} from 'node:crypto'
import {Runtime} from '../src/runtime.ts'
import {configSchema} from '../src/config.ts'
import {serve} from '../src/server.ts'
import type {ModelRequest} from '../src/model.ts'
const native=process.argv[2]==='native'
const root=resolve(process.argv[3]??('.local/chat-'+(native?'native':'fixture')+'-20261107'))
mkdirSync(join(root,'workspace'),{recursive:true})
const config=configSchema.parse({stateDir:join(root,'state'),port:Number(process.env.ROPPO_CHAT_PORT??0),work:{sandboxDriver:'disabled',network:false},turnTimeoutMs:180000,
  execution:{router:{mode:'host',model:'gpt-6.1-terra',effort:'medium'},management:{enabled:true,maxWorkers:4},workers:[{id:'research',label:'Research',backend:'codex',model:'gpt-6.1-sol',effort:'high'},{id:'planning',label:'Planning',backend:'codex',model:'gpt-6.1-sol',effort:'high'},{id:'review',label:'Review',backend:'codex',model:'gpt-6.1-sol',effort:'high'},{id:'worker-4',label:'Worker 4',backend:'codex',model:'gpt-6.1-sol',effort:'high'}]},
  sources:[{id:'local',kind:'local',cwd:join(root,'workspace'),allowedActors:['operator'],workspace:{mode:'source'}}]})
const model={async run(r:ModelRequest){
  const threadId=r.threadId??randomUUID(),turnId=randomUUID();r.onThread?.(threadId);r.onTurn?.(turnId)
  const wait=(ms=2800)=>new Promise<void>((resolve,reject)=>{const timer=setTimeout(done,ms);function done(){r.signal?.removeEventListener('abort',stop);resolve()}function stop(){clearTimeout(timer);reject(Error('Fixture cancelled'))}r.signal?.addEventListener('abort',stop,{once:true});if(r.signal?.aborted)stop()})
  const reply=async(text:string)=>{const raw=JSON.stringify({reply:text});r.onOutput?.({id:turnId,type:'start',phase:'answer'});for(let i=0;i<raw.length;i+=9){r.onOutput?.({id:turnId,type:'delta',phase:'answer',text:raw.slice(i,i+9)});await wait(120)}return {threadId,turnId,text:raw}}
  await wait()
  if(r.role==='worker'){await r.onTool?.('superagent_progress',{summary:'Checked the launch scope and milestones.'},turnId+'-progress');return {threadId,turnId,text:JSON.stringify({state:'ready',summary:'Review complete',reply:'Checked the launch scope and milestones.',question:null,askedBy:null,handbacks:[]})}}
  const data=JSON.parse(r.input)
  if(data.kind==='user_message'){
    const result=await r.onTool!('worker_manage',{action:'list'},'list')
    const revision=JSON.parse(result.contentItems[0]!.text!).revision
    let ticketId=''
    for(const [index,id] of ['research','planning','review'].entries()){const assigned=await r.onTool!('worker_manage',{action:'assign',id,revision,requestId:turnId+'-'+id,text:['Research the market for Roppo','Draft the release plan','Review the onboarding scope'][index]},id);ticketId=JSON.parse(assigned.contentItems[0]!.text!).ticketId}
    await r.onTool!('worker_manage',{action:'result',ticketId,waitMs:1800},turnId+'-result')
    return reply('I’ll split the research and launch planning across the team, then bring the results together.')
  }
  return reply('The team has returned its findings.\n\n## Recommended next steps\n\n1. Start with individual users.\n2. Make the first Router conversation easy to begin.\n3. Keep Worker progress visible and results easy to review.')
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
