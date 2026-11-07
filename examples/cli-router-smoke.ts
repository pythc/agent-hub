/** Real foreground CLI -> MCP -> four Workers, then a same-session follow-up. */
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync} from 'node:fs'
import {join,resolve} from 'node:path'
import {tmpdir} from 'node:os'
import {spawn} from 'node:child_process'
import {createInterface} from 'node:readline'
import {configSchema} from '../src/config.ts'
import {Runtime} from '../src/runtime.ts'
import {serve} from '../src/server.ts'
import {codexRouterCommand} from '../src/codex-router.ts'
import {CodexModel} from '../src/codex.ts'
import type {Run} from '../src/store.ts'
const root=process.env.AGENTHUB_SMOKE_DIR?resolve(process.env.AGENTHUB_SMOKE_DIR):mkdtempSync(join(tmpdir(),'cli-router-')),cwd=join(root,'workspace'),binary=process.env.AGENTHUB_CODEX??'codex'
mkdirSync(cwd,{recursive:true})
if(existsSync(join(root,'evidence.json'))||existsSync(join(root,'state')))throw Error('Use a fresh acceptance directory')
const runtime=new Runtime(configSchema.parse({stateDir:join(root,'state'),port:0,codex:binary,turnTimeoutMs:120000,work:{sandboxDriver:'disabled'},execution:{router:{mode:'client',model:'gpt-6.1-terra',effort:'medium'},management:{enabled:true,maxWorkers:4,backends:['codex']},workers:Array.from({length:4},(_,i)=>({id:'worker-'+(i+1),backend:'codex',model:'gpt-6.1-sol',effort:'high',tools:[],prompt:'Perform only the assigned arithmetic subtask. Return a ready report with just the number in reply, no handbacks, and no tools.'}))},sources:[{id:'local',kind:'local',cwd,allowedActors:['operator'],workspace:{mode:'source'}}]}))
const host=await serve(runtime),phases:any[]=[],commands:any[]=[]
async function turn(name:string,prompt:string,resume?:string){
 const output=join(root,name+'.txt'),command=codexRouterCommand(runtime.config,{url:host.url,tokenFile:host.tokenPath,prompt,resume,json:true,output}),events:any[]=[]
 commands.push({name,binary:command.binary,args:command.args,model:command.model,effort:command.effort})
 const child=spawn(command.binary,command.args,{cwd:command.cwd,env:command.env,stdio:['ignore','pipe','pipe'],shell:false})
 let stderr='',timedOut=false;child.stderr.on('data',chunk=>{if(stderr.length<64000)stderr+=chunk.toString()})
 createInterface({input:child.stdout}).on('line',line=>{try{const event=JSON.parse(line);events.push(event);if(event.type==='item.completed'&&event.item?.type==='mcp_tool_call')console.log(JSON.stringify({phase:name,tool:event.item.tool,action:event.item.arguments?.action,status:event.item.status}));writeFileSync(join(root,name+'-events.json'),JSON.stringify(events,null,2))}catch{}})
 const timer=setTimeout(()=>{timedOut=true;child.kill('SIGTERM')},420000)
 try{
  const code=await new Promise<number|null>((r,reject)=>{child.once('error',reject);child.once('close',r)})
  const text=existsSync(output)?readFileSync(output,'utf8').trim():''
  const phase={name,code,timedOut,text,threadId:events.find(e=>e.type==='thread.started')?.thread_id??resume,events,runs:runtime.store.list<Run>('run'),deliveries:runtime.store.deliveries()};phases.push(phase)
  writeFileSync(join(root,name+'-stderr.txt'),stderr,{mode:0o600});console.log(JSON.stringify({phase:name,code,text}));return phase
 }finally{clearTimeout(timer);child.kill('SIGTERM')}
}
let ok=false,error:string|undefined,history:any,contexts:any[]=[],reviews:any[]=[]
try{
 const first=await turn('initial','Run this explicitly authorized isolated AgentHub acceptance. Use the four EXISTING Workers, worker-1 through worker-4, to compute 1+1, 2+2, 3+3, 4+4 respectively. Assign each once, using discussion cli-pilot and unique stable requestIds. Do not create/configure/delete Workers, use files, or contact anyone. Collect each actual result with worker_manage result (waitMs 5000). Only after all four complete, reply exactly VERIFIED 2 4 6 8. Retain the ticket IDs for my follow-up.')
 if(first.code!==0||first.text!=='VERIFIED 2 4 6 8'||!first.threadId)throw Error('Initial CLI coordination did not complete')
 const second=await turn('followup','Follow-up within the original task scope: ask only worker-2 to independently recheck its original calculation 2+2. Use worker_manage send on its existing ticket, never assign a new task or rerun the other Workers. Wait for the NEW verification to complete rather than relying on its old report. Retain the other three verified results, then reply exactly RECHECKED 2 4 6 8. This bounded follow-up is authorized; no files or external messages.',first.threadId)
 history=await new CodexModel({codex:binary,effort:'medium',turnTimeoutMs:30000}).history(first.threadId,cwd)
 if(history.path&&existsSync(history.path))for(const line of readFileSync(history.path,'utf8').split('\n')){try{const item=JSON.parse(line);if(item.type==='turn_context')contexts.push(item.payload);if(/approval.*review|review.*approval/i.test(JSON.stringify(item.type)+' '+JSON.stringify(item.payload?.type)))reviews.push(item)}catch{}}
 const runs=runtime.store.list<any>('run'),calls=runtime.activity.list(),configs=runtime.store.list<any>('agent-configuration'),deliveries=runtime.store.deliveries()
 const successfulCalls=phases.flatMap(p=>p.events.filter((e:any)=>e.type==='item.completed'&&e.item?.type==='mcp_tool_call').map((e:any)=>e.item))
 const checks={
  initial:first.code===0&&first.text==='VERIFIED 2 4 6 8',followup:second.code===0&&second.text==='RECHECKED 2 4 6 8',sameRouter:first.threadId===second.threadId,
  actualRouterModel:history.model==='gpt-6.1-terra'&&history.reasoningEffort==='medium'&&contexts.length===2&&contexts.every(c=>c.model==='gpt-6.1-terra'&&c.effort==='medium'),
  nativeApprovalReview:contexts.length===2&&contexts.every(c=>c.approval_policy==='on-request'&&c.approvals_reviewer==='auto_review'&&c.sandbox_policy?.type==='workspace-write'),
  fourWorkers:runs.length===4&&new Set(runs.map(r=>r.workerId)).size===4&&new Set(runs.map(r=>r.threadId)).size===4,
  noWorkerThreadChange:runs.every(r=>first.runs.some((old:any)=>old.ticketId===r.ticketId&&old.threadId===r.threadId)),
  onlyWorkerTwoReactivated:runs.every(r=>{const old=first.runs.find((p:any)=>p.ticketId===r.ticketId);return r.workerId==='worker-2'?r.turnId!==old?.turnId:r.turnId===old?.turnId}),
  fiveWorkerActivations:calls.filter(c=>c.kind==='worker').length===5,
  workerModels:runs.every(r=>r.model==='gpt-6.1-sol')&&configs.length===5&&configs.every(c=>c.sent?.effort==='high'),
  internalDeliveryOnly:deliveries.length>=5&&deliveries.every(d=>!!d.channel.address.routerInbox&&d.status==='sent'),
  noSecondRouter:!calls.some(c=>c.kind==='router')&&runtime.store.list('router-session').length===0,
  mcpOnly:successfulCalls.length>0&&successfulCalls.every((c:any)=>c.server==='agenthub-router'&&c.tool==='worker_manage'&&c.status==='completed'&&!c.result?.isError),
  noInFlight:runtime.status().active===0&&runs.every(r=>r.phase==='idle')&&calls.every(c=>c.state!=='running'),
 }
 ok=Object.values(checks).every(Boolean)
 writeFileSync(join(root,'checks.json'),JSON.stringify(checks,null,2)+'\n')
}catch(e){error=String(e)}finally{
 writeFileSync(join(root,'evidence.json'),JSON.stringify({ok,error,commands,phases,contexts,reviews,history,calls:runtime.activity.list(),runs:runtime.store.list('run'),configurations:runtime.store.list('agent-configuration'),delegations:runtime.store.list('worker-assignment'),deliveries:runtime.store.deliveries(),active:runtime.status().active},null,2)+'\n',{mode:0o600})
 console.log(JSON.stringify({ok,error,evidence:join(root,'evidence.json')}));if(!ok)process.exitCode=1
 await new Promise<void>(r=>host.server.close(()=>r()));await host.closeRuntime()
}
