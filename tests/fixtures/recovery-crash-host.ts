/** Test-only real host process. No CLI, model inference, external service or automatic ticks. */
import {readFileSync,writeFileSync,openSync,writeSync,fsyncSync,closeSync} from 'node:fs'
import {join} from 'node:path'
import {Runtime} from '../../src/runtime.ts'
import {configSchema} from '../../src/config.ts'
import {ExecutionTrace} from '../../src/execution-trace.ts'
import type {WorkOwner} from '../../src/work.ts'
const [root,url,mode]=process.argv.slice(2) as [string,string,string]
const config=configSchema.parse({stateDir:join(root,'state'),work:{sandboxDriver:'disabled',autoRecover:false},sources:[{id:'local',kind:'local',cwd:root,allowedActors:['operator']}],toolConnections:{fixture:{transport:{kind:'http',url},allowedTools:['write'],timeoutMs:60000}}})
let executeAllowed=false
const host=new Runtime(config,{model:{async run(request){
 if(!executeAllowed)throw Error('Inference is not allowed in this fixture')
 const fd=openSync(join(root,'model-calls.jsonl'),'a',0o600)
 try{writeSync(fd,JSON.stringify({kind:'fixture-model'})+'\n');fsyncSync(fd)}finally{closeSync(fd)}
 request.onThread?.('fixture-session');request.onTurn?.('fixture-result-turn')
 return {threadId:'fixture-session',turnId:'fixture-result-turn',text:JSON.stringify({state:'ready',summary:'Local result awaiting independent acceptance',reply:'fixture persisted result',question:null,handbacks:[]})}
}}})
let owner:WorkOwner
if(mode==='create'){
 const {triggerId}=host.receive('local','operator',{id:'crash-test',thread:'crash-test',text:'Use the local fixture tool',addressed:true}) as {triggerId:string}
 const decision=host.engine.decide(triggerId,{kind:'accept',title:'Fixture',scope:'Local test',reason:'Test',rules:[]})
 const ticket=host.store.tickets.get(decision.ticketId!)!,assignment=ticket.assignments.at(-1)!
 host.engine.assignmentStarted(ticket.id,assignment.id)
 host.store.put('run',ticket.id,{ticketId:ticket.id,assignmentId:assignment.id,cwd:root,phase:'idle',threadId:'fixture-session',backendId:'codex',agentOptions:{toolConnections:['fixture']}})
 owner={ticketId:ticket.id,assignmentId:assignment.id,cwd:root,sandbox:'read-only',depth:0}
 writeFileSync(join(root,'owner.json'),JSON.stringify(owner))
}else owner=JSON.parse(readFileSync(join(root,'owner.json'),'utf8'))
const trace=new ExecutionTrace(()=>host)
const snapshot=()=>({run:host.store.get('run',owner.ticketId),task:trace.snapshot({ticketId:owner.ticketId}).tasks[0],receipts:host.toolConnections.receipts(owner.ticketId),events:trace.events({ticketId:owner.ticketId,limit:200}).events})
const send=(type:string,value:unknown)=>process.send?.({type,value})
let releaseBeforeCall:(()=>void)|undefined
const call=async()=>{const result=await host.workerTools.call(owner,'superagent_tool',{connection:'fixture',tool:'write',arguments:{text:'fixture effect'},requestId:'stable-request'});send('result',{result,...snapshot()})}
process.on('message',async command=>{
 try{
  if(command==='inspect')send('snapshot',snapshot())
  else if(command==='before-call'){
   // IPC barrier immediately before entering the real Worker tool boundary.
   const gate=new Promise<void>(resolve=>{releaseBeforeCall=resolve})
   send('before-call',snapshot())
   await gate
   await call()
  }else if(command==='release-before-call'){releaseBeforeCall?.()}else if(command==='execute'){
   host.engine.note(owner.ticketId,'Finish the local fixture result without repeating the completed tool effect')
   executeAllowed=true
   await (host as any).execute(host.store.tickets.get(owner.ticketId)!,owner.assignmentId)
   executeAllowed=false
   send('executed',snapshot())
  }else if(command==='call'){
   await call()
  }else if(command==='close'){await host.close();process.disconnect?.()}
 }catch(error){send('error',String(error))}
})
send('ready',snapshot())
