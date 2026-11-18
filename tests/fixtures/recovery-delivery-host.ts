/** Local-only delivery crash host: production Runtime/outbox, IPC destination. */
import {readFileSync,writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {Runtime} from '../../src/runtime.ts'
import {configSchema} from '../../src/config.ts'
import {MessageSource} from '../../src/sources.ts'
import {ExecutionTrace} from '../../src/execution-trace.ts'
import type {OutboundMessage} from '../../src/vendor/dsh-core/index.ts'
const [root,mode]=process.argv.slice(2) as [string,string]
const send=(type:string,value:unknown)=>process.send?.({type,value})
const config=configSchema.parse({stateDir:join(root,'state'),work:{sandboxDriver:'disabled',autoRecover:false},sources:[{id:'local',kind:'local',cwd:root,allowedActors:['operator']} ]})
let modelCalls=0
let acknowledge:undefined|(()=>void)
class Destination extends MessageSource{
 async deliver(message:OutboundMessage){
  if(message.id!=='crash-delivery')return
  await new Promise<void>(resolve=>{acknowledge=resolve;send('effect',{id:message.id})})
 }
}
const host=new Runtime(config,{sources:[new Destination(config.sources[0]!)],model:{async run(){modelCalls++;throw Error('Inference is not allowed in this fixture')}}})
let ticketId:string
if(mode==='create'){
 const {triggerId}=host.receive('local','operator',{id:'delivery-crash',thread:'delivery-crash',text:'Local delivery fixture',addressed:true}) as {triggerId:string}
 ticketId=host.engine.decide(triggerId,{kind:'accept',title:'Fixture',scope:'Local test',reason:'Test',rules:[]}).ticketId!
 const ticket=host.store.tickets.get(ticketId)!,assignment=ticket.assignments.at(-1)!
 host.engine.assignmentStarted(ticketId,assignment.id)
 host.store.put('run',ticketId,{ticketId,assignmentId:assignment.id,cwd:root,phase:'idle'})
 host.store.outbox.send({id:'crash-delivery',ticketId,channel:{source:'local',thread:'delivery-crash',address:{thread:'delivery-crash'}},kind:'reply',text:'Local fixture response'})
 writeFileSync(join(root,'ticket.json'),JSON.stringify(ticketId))
}else ticketId=JSON.parse(readFileSync(join(root,'ticket.json'),'utf8'))
const trace=new ExecutionTrace(()=>host)
const snapshot=()=>({modelCalls,task:trace.snapshot({ticketId}).tasks[0],delivery:host.store.deliveries().find(d=>d.id==='crash-delivery'),events:trace.events({ticketId,limit:200}).events})
process.on('message',async command=>{
 try{
  if(command==='ack'){acknowledge?.();acknowledge=undefined}
  else if(command==='inspect')send('snapshot',snapshot())
  else if(command==='flush'){await host.flush();send('flushed',snapshot())}
 }catch(error){send('error',String(error))}
})
send('ready',snapshot())
