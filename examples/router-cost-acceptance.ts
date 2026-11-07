/** Live subscription acceptance. Uses isolated state; never opens a messaging connector.
 * node --import tsx examples/router-cost-acceptance.ts OUTPUT_ROOT [IMPLEMENTATION_ROOT] [stop]
 * The optional implementation root permits the identical harness to measure a pinned baseline.
 */
import {mkdirSync,writeFileSync,existsSync,readFileSync} from 'node:fs'
import {resolve,join} from 'node:path'
import {pathToFileURL,fileURLToPath} from 'node:url'
import assert from 'node:assert/strict'
import type {Runtime as RuntimeType} from '../src/runtime.ts'
import type {ModelRequest} from '../src/model.ts'
const root=resolve(process.argv[2]??'.local/router-cost')
if(existsSync(join(root,'result.json'))||existsSync(join(root,'state')))throw Error('Use a new acceptance directory')
const implementation=resolve(process.argv[3]??fileURLToPath(new URL('..',import.meta.url)))
const {Runtime}=await import(pathToFileURL(join(implementation,'src/runtime.ts')).href) as typeof import('../src/runtime.ts')
const {configSchema}=await import(pathToFileURL(join(implementation,'src/config.ts')).href) as typeof import('../src/config.ts')
mkdirSync(join(root,'workspace'),{recursive:true,mode:0o700})
const stop=process.argv[4]==='stop'
const config=configSchema.parse({stateDir:join(root,'state'),port:0,turnTimeoutMs:180000,acceptMode:'auto',
 rules:[{id:'acceptance',instruction:'仅处理本地验收对话中已经确定标准的文案修订，以及明确要求运行的本地验收脚本。闲聊、假设、未确定方案不接手。不得访问网络或外部服务。'}],
 work:{sandboxDriver:stop?(process.platform==='darwin'?'seatbelt':'bubblewrap'):'disabled',network:false},
 execution:{router:{mode:'host',model:'gpt-6.1-terra',effort:'medium'},management:{enabled:true,maxWorkers:4},workers:[{id:'research',label:'Research',backend:'codex',model:'gpt-6.1-sol',effort:'high'},{id:'planning',backend:'codex',model:'gpt-6.1-sol',effort:'high'},{id:'review',backend:'codex',model:'gpt-6.1-sol',effort:'high'},{id:'worker-4',backend:'codex',model:'gpt-6.1-sol',effort:'high'}]},
 sources:[{id:'local',kind:'local',cwd:join(root,'workspace'),allowedActors:['operator'],workspace:{mode:'source'},sandbox:stop?'workspace-write':'read-only'}]})
const h:RuntimeType=new Runtime(config),calls:any[]=[],steps:any[]=[]
const save=(name:string,value:unknown)=>writeFileSync(join(root,name+'.json'),JSON.stringify(value,null,2)+'\n',{mode:0o600})
const originalRun=h.model.run.bind(h.model)
h.model.run=async(r:ModelRequest)=>{
 const row:any={role:r.role,threadId:r.threadId,startedAt:Date.now(),inputKind:JSON.parse(r.input).kind??r.role,instructionsChars:r.instructions.length,inputChars:r.input.length,toolSchemaChars:JSON.stringify(r.tools??[]).length,tools:r.tools?.map(t=>t.name),toolCalls:[]};calls.push(row);save('calls',calls)
 try{return await originalRun({...r,onThread:id=>{row.threadId=id;r.onThread?.(id);save('calls',calls)},onTurn:id=>{row.turnId=id;r.onTurn?.(id)},onTool:r.onTool?async(name,args,id)=>{row.toolCalls.push({name,action:(args as any)?.action});return r.onTool!(name,args,id)}:undefined})}
 catch(error){row.error=String(error);throw error}
 finally{row.endedAt=Date.now();save('calls',calls)}
}
const send=(thread:string,id:string,text:string)=>{const at=Date.now(),result=h.receive('local','operator',{id,thread,text,addressed:false});steps.push({id,thread,text,at,result});save('steps',steps);return result}
const pending=()=>h.store.db.prepare("SELECT id,kind,state,error FROM jobs WHERE state IN ('pending','running','failed')").all()
async function until(label:string,predicate:()=>boolean,timeout=150000){const start=Date.now();for(;;){if(predicate())return;if(Date.now()-start>timeout)throw Error('Timed out '+label+': '+JSON.stringify(pending()));await new Promise(r=>setTimeout(r,100))}}
const publicReplies=()=>h.store.deliveries().filter(d=>!d.channel.address.routerInbox&&d.status==='sent')
let failure:string|undefined
try{
 h.start()
 if(!stop){
 send('chatter','chatter-1','今天的天气不错。首页也许以后可以换一种文案，不过还没有确定要改什么，先随便聊聊。')
 await until('ignore',()=>h.routerIngress.get('local:chatter-1')?.state==='ignored'&&h.status().active===0)
 assert.equal(h.store.tickets.list().length,0);assert.equal(publicReplies().length,0)
 console.log(JSON.stringify({stage:'chatter',passed:true}))
 send('copy','copy-1','这是已确认的三句文案校对任务：将以下每一个 Ropoo 修正为 Roppo，其余正文不改，只返回三句修订结果，并在末尾单独加临时 DRAFT 标签。最终标签稍后会在本任务的后续消息中给出，届时仍在同一任务替换临时标签。\n1. Ropoo 是一个本地多 Agent 工作区。\n2. 用户与 Router 对话，Worker 执行任务。\n3. Ropoo 支持持久化浏览器，Ropoo 保留登录状态。')
 await until('copy delivery',()=>publicReplies().some(d=>d.text.includes('DRAFT'))&&h.status().active===0)
 const ticket=h.store.tickets.list()[0]!,workerThread=h.store.get<any>('run',ticket.id).threadId,routerThread=h.store.get<any>('router-session','local:copy').threadId
 assert.equal(h.store.tickets.list().length,1);assert.equal(ticket.ended?.outcome,'completed')
 send('copy','copy-2','刚才三句品牌文案的同一校对任务，最终标签现在确定为 CHECK-ALPHA-739。仅把交付末尾的 DRAFT 替换为这个标签，三句已校对的正文保持原样，重新返回完整结果即可。')
 await until('follow-up delivery',()=>publicReplies().some(d=>d.text.includes('CHECK-ALPHA-739'))&&h.status().active===0)
 assert.equal(h.store.tickets.list().length,1);assert.equal(h.store.get<any>('run',ticket.id).threadId,workerThread);assert.equal(h.store.get<any>('router-session','local:copy').threadId,routerThread)
 assert(!publicReplies().filter(d=>d.text.includes('CHECK-ALPHA-739')).some(d=>d.text.includes('Ropoo')))
 console.log(JSON.stringify({stage:'continuation',passed:true,ticketId:ticket.id,workerThread,routerThread}))
 }else{
 writeFileSync(join(root,'workspace','slow-check.mjs'),"import{writeFileSync}from'node:fs';writeFileSync('started.txt','ready');setTimeout(()=>{writeFileSync('completed.txt','done');console.log('DONE')},120000)\n")
 send('stop','stop-1','运行一个已确认的本地验收检查：使用 superagent_shell 执行 node slow-check.mjs。脚本需要约120秒，只读写当前验收目录，不联网。启动一次即可，不要重启脚本或轮询；运行期间保持 waiting，等宿主通知完成后报告真实结果。')
 await until('real job running',()=>existsSync(join(root,'workspace','started.txt')))
 const ticket=h.store.tickets.list()[0]!,routerThread=h.store.get<any>('router-session','local:stop').threadId
 save('stop-before',{ticket,run:h.store.get('run',ticket.id),jobs:h.work.list(ticket.id),at:Date.now()})
 send('stop','stop-2','请立即停止刚才的本地验收检查任务 '+ticket.id+'，这是明确的人工停止请求。终止正在运行的检查，不要继续，也不要新建替代任务。')
 await until('semantic stop',()=>!!h.store.tickets.get(ticket.id)?.ended&&h.status().active===0)
 const ended=h.store.tickets.get(ticket.id)!.ended
 save('stop-after',{ticket:h.store.tickets.get(ticket.id),jobs:h.work.list(ticket.id),stops:h.store.list('router-followup-stopped'),at:Date.now()})
 assert.equal(ended?.by,'human','A Worker dropped report is not a human stop')
 assert.equal(ended?.outcome,'stopped');assert(h.store.list('router-followup-stopped').length>0)
 assert(h.work.list(ticket.id).every(w=>!['starting','running'].includes(w.state)));assert(!existsSync(join(root,'workspace','completed.txt')))
 const assignments=h.store.tickets.get(ticket.id)!.assignments.length
 send('stop','stop-3','补充记录：该任务保持停止状态，今天先到这里。这不是恢复或新建任务的请求。')
 await until('post-stop message',()=>h.routerIngress.get('local:stop-3')?.state==='ignored'&&h.status().active===0)
 assert.equal(h.store.tickets.get(ticket.id)!.assignments.length,assignments);assert.equal(h.store.tickets.list().length,1);assert.equal(h.store.get<any>('router-session','local:stop').threadId,routerThread)
 console.log(JSON.stringify({stage:'semantic-stop',passed:true,ticketId:ticket.id,ended}))
 }
}catch(error){failure=String(error);console.error(failure);process.exitCode=1}
finally{
 save('result',{passed:!failure,error:failure,implementation,at:new Date().toISOString(),steps,calls,status:h.status(),jobs:pending()})
 // Clean up only this isolated host's unfinished test jobs, retaining their evidence.
 for(const t of h.store.tickets.list())if(!t.ended)await h.stop(t.id)
 await h.close()
}
