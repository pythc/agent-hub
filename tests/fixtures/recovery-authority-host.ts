/** Real Runtime crash fixture: no automatic ticks, provider calls, or external services. */
import {readFileSync,writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {Runtime} from '../../src/runtime.ts'
import {configSchema} from '../../src/config.ts'
import {ExecutionTrace} from '../../src/execution-trace.ts'
import type {Run} from '../../src/store.ts'
const [root,mode]=process.argv.slice(2) as [string,string]
let modelCalls=0
const config=configSchema.parse({stateDir:join(root,'state'),work:{sandboxDriver:'disabled',autoRecover:false},sources:[{id:'local',kind:'local',cwd:root,allowedActors:['operator']}]})
const host=new Runtime(config,{model:{describe:()=>({id:'codex',kind:'codex',nativeTakeover:false,images:false,resume:true,tools:true,steering:false,promptRefresh:false}),async run(){modelCalls++;throw Error('No inference permitted')}}})
let ticketId:string
if(mode==='create'){
 const {triggerId}=host.receive('local','operator',{id:'authority',thread:'authority',text:'Local recovery test',addressed:true}) as {triggerId:string}
 ticketId=host.engine.decide(triggerId,{kind:'accept',title:'Fixture',scope:'Local test',reason:'Test',rules:[]}).ticketId!
 const ticket=host.store.tickets.get(ticketId)!,assignment=ticket.assignments.at(-1)!
 host.engine.assignmentStarted(ticketId,assignment.id)
 host.store.put('run',ticketId,{ticketId,assignmentId:assignment.id,cwd:root,phase:'idle',threadId:'fixture-session',backendId:'codex',workerId:'worker-1'} satisfies Run)
 host.engine.report(ticketId,{state:'blocked',summary:'Fixture blocked',question:null})
 writeFileSync(join(root,'ticket.json'),JSON.stringify(ticketId))
}else ticketId=JSON.parse(readFileSync(join(root,'ticket.json'),'utf8'))
const trace=new ExecutionTrace(()=>host)
const snapshot=()=>({task:trace.snapshot({ticketId}).tasks[0],assignments:host.store.tickets.get(ticketId)!.assignments,jobs:host.store.db.prepare('SELECT id,kind,state,attempts FROM jobs ORDER BY id').all(),effects:{tools:host.toolConnections.receipts(ticketId),browser:host.store.list('browser-receipt'),repository:host.store.list('pr-delivery'),deliveries:host.store.deliveries()},modelCalls,commands:host.store.list('execution-trace-command')})
const send=(type:string,value:unknown)=>process.send?.({type,value})
process.on('message',async (command:any)=>{
 try{
  if(command.type==='mutate'){
   if(command.kind==='permission')host.settings.save(host.settings.current().revision,{sources:host.config.sources.map(source=>({...source,allowedActors:['replacement-operator']}))})
   else if(command.kind==='mandate')host.engine.stopTicket(ticketId,'Fixture mandate withdrawn')
   // Synthetic durable provider outcome, not a simulated recovery implementation.
   else if(command.kind==='evidence')host.store.put('pr-delivery',ticketId+':pr',{phase:'uncertain',detail:'fixture outcome unknown'})
   else throw Error('Unknown mutation')
   send('mutated',snapshot())
  }else if(command.type==='recover'){
   let result:unknown,error:string|undefined
   try{result=await trace.recover(command.value)}catch(e){error=e instanceof Error?e.message:String(e)}
   send('recovered',{result,error,...snapshot()})
  }else if(command.type==='inspect')send('snapshot',snapshot())
 }catch(e){send('error',String(e))}
})
send('ready',snapshot())
