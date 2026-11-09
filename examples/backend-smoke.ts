import {isApiBackend} from '../src/backend-config.ts'
import {mkdtempSync,mkdirSync,writeFileSync} from 'node:fs'
import {resolve,join} from 'node:path'
import {randomUUID} from 'node:crypto'
import {loadConfig,configSchema} from '../src/config.ts'
import {Runtime} from '../src/runtime.ts'

// Opt-in real provider acceptance. Uses synthetic files and a separate database;
// never starts configured GitHub/Feishu sources or changes the running host.
const [file,id]=process.argv.slice(2)
if(!file||!id)throw Error('Usage: backend-smoke.ts CONFIG BACKEND_ID')
const original=loadConfig(file),backend=original.backends[id]
if(!backend||!isApiBackend(backend))throw Error('Select a configured API backend')
if(backend.apiKeyEnv&&!process.env[backend.apiKeyEnv]?.trim())throw Error('Missing environment variable '+backend.apiKeyEnv)
mkdirSync('.local',{recursive:true})
const root=mkdtempSync(resolve('.local/provider-smoke-')),cwd=join(root,'files'),marker='agenthub-'+randomUUID()
mkdirSync(cwd);writeFileSync(join(cwd,'acceptance.txt'),marker+'\n')
const config=configSchema.parse({...original,stateDir:join(root,'state'),execution:{backend:id,roles:{}},models:{},backends:{[id]:backend},delivery:{},work:{sandboxDriver:'disabled'},sources:[{id:'local',kind:'local',cwd,allowedActors:['operator'],sandbox:'read-only'}]})
const host=new Runtime(config)
try{
 const wait=async(count:number)=>{
  const deadline=Date.now()+config.turnTimeoutMs*2+30000
  while(Date.now()<deadline){
   await host.tick();await host.flush()
   const ticket=host.store.tickets.list()[0]
   if(ticket?.attention)throw Error('Provider task needs attention: '+JSON.stringify(ticket.attention))
   if(host.store.deliveries().filter(d=>d.kind==='reply'&&d.status==='sent'&&d.text.includes(marker)).length>=count)return
   await new Promise(r=>setTimeout(r,100))
  }
  throw Error('Provider acceptance timed out; inspect retained state')
 }
 host.receive('local','operator',{id:'first',thread:'provider-acceptance',addressed:true,text:'Use superagent_read to read files/acceptance.txt. Reply with the exact marker in that file. This is a read-only acceptance task.'})
 await wait(1)
 const ticket=host.store.tickets.list()[0]!,first=host.store.get<any>('run',ticket.id)
 host.receive('local','operator',{id:'follow-up',thread:'provider-acceptance',addressed:true,text:'Read files/acceptance.txt again with superagent_read, and reply with its exact marker. Continue the same task.'})
 await wait(2)
 const second=host.store.get<any>('run',ticket.id)
 if(first.threadId!==second.threadId)throw Error('Follow-up did not retain its conversation')
 const history=await host.model.history!(second.threadId,cwd)
 if(history.turns.filter((t:any)=>t.status==='completed').length<2||history.turns.filter((t:any)=>t.items.some((i:any)=>i.type==='functionCall'&&i.name==='superagent_read')).length<2)throw Error('Missing real file-tool evidence in both turns')
 const result={at:new Date().toISOString(),kind:backend.kind,model:backend.model,passed:true,realProvider:true,ticketId:ticket.id,threadId:second.threadId,checks:['routing','scoped-file-tool','result-delivery','same-conversation-follow-up'],stateDir:config.stateDir}
 writeFileSync(join(root,'report.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2))
}finally{await host.close()}
