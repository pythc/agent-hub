import {createServer} from 'node:http'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {it,expect} from 'vitest'
import {Runtime} from '../src/runtime.ts'
import {configSchema} from '../src/config.ts'

it('uses separate Router and Worker models across all three API protocols and retains an existing conversation after reassignment',async()=>{
 const root=mkdtempSync(join(tmpdir(),'worker-protocols-')),requests:{path:string;model:string}[]=[]
 const server=createServer(async(req,res)=>{
  let body='';for await(const chunk of req)body+=chunk;const data=JSON.parse(body),path=req.url!;requests.push({path,model:data.model})
  const routing=data.model==='router-model',followup=JSON.stringify(data).includes('Classify this worker-owned follow-up')
  const text=JSON.stringify(routing?{action:followup?'ignore':'accept',title:'Protocol work',scope:'Reply only',reason:'Explicit request',rules:[],ruleAssessments:[],targetTicketId:null}:{state:'ready',summary:'Worker result',reply:'From '+data.model,question:null,handbacks:[]})
  const result=path.includes('/responses')?{status:'completed',output:[{type:'message',content:[{type:'output_text',text}]}]}:path.includes('/anthropic')?{stop_reason:'end_turn',content:[{type:'text',text}]}:{choices:[{message:{content:text}}]}
  res.setHeader('content-type','application/json');res.end(JSON.stringify(result))
 })
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+(server.address() as any).port
 const config=configSchema.parse({stateDir:join(root,'state'),codex:'/missing/codex',work:{sandboxDriver:'disabled'},backends:{chat:{kind:'openai-chat',baseUrl:url+'/chat/v1',model:'service-default'},responses:{kind:'openai-responses',baseUrl:url+'/responses/v1',model:'service-default'},anthropic:{kind:'anthropic',baseUrl:url+'/anthropic/v1',model:'service-default'}},execution:{backend:'chat',roles:{router:'chat'},workers:[{id:'one',backend:'chat',model:'worker-chat'},{id:'two',backend:'responses',model:'worker-responses'},{id:'three',backend:'anthropic',model:'worker-anthropic'}]},models:{router:'router-model'},sources:[{id:'local',kind:'local',cwd:root,allowedActors:['operator']}]})
 const host=new Runtime(config)
 const settle=async(count:number)=>{for(let n=0;n<500;n++){await host.tick();await new Promise(r=>setTimeout(r,4));if(host.store.deliveries().filter(d=>d.kind==='reply'&&d.status==='sent').length>=count)return}throw Error('Protocol workers did not finish')}
 try{
  for(let i=0;i<3;i++){host.receive('local','operator',{id:String(i),thread:'topic-'+i,text:'Request '+i,addressed:true});await settle(i+1)}
  expect(new Set(requests.map(r=>r.model))).toEqual(new Set(['router-model','worker-chat','worker-responses','worker-anthropic']))
  const first=host.store.tickets.list().find(t=>host.store.triggers.get(t.origin.triggerId)?.text==='Request 0')!,run=host.store.get<any>('run',first.id),threadId=run.threadId
  host.updateSettings(0,{execution:{...host.config.execution,workers:[{id:'one',backend:'anthropic',model:'changed-model'},{id:'two',backend:'responses',model:'worker-responses'},{id:'three',backend:'anthropic',model:'worker-anthropic'}]}})
  host.receive('local','operator',{id:'followup',thread:'topic-0',text:'Continue this request',addressed:true});await settle(4)
  expect(host.store.get<any>('run',first.id)).toMatchObject({threadId,backendId:'chat',model:'worker-chat'})
  expect(requests.filter(r=>r.model==='worker-chat')).toHaveLength(2);expect(requests.some(r=>r.model==='changed-model')).toBe(false)
 }finally{await host.close();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));rmSync(root,{recursive:true,force:true})}
})
