import {readFileSync,writeFileSync} from 'node:fs'
import {join,resolve} from 'node:path'
import {Runtime} from '../src/runtime.ts'
import {serve} from '../src/server.ts'
import {loadConfig} from '../src/config.ts'
import type {Model,ModelRequest} from '../src/model.ts'

// Isolated acceptance host. Fixture and real-model modes are deliberately explicit.
const [configFile,role]=process.argv.slice(2)
if(!configFile||!['parent','child'].includes(role??''))throw Error('Use delegation-host CONFIG parent|child [--real-model]')
const real=process.argv.includes('--real-model'),goalMode=process.argv.includes('--goal'),calls:unknown[]=[]
const config=loadConfig(resolve(configFile))
const decode=(value:any)=>{if(!value.success)throw Error('Fixture tool rejected: '+JSON.stringify(value));return JSON.parse(value.contentItems[0].text)}
const model:Model={async run(r:ModelRequest){
 const threadId=r.threadId??role+'-fixture-'+Date.now(),turnId='fixture-'+Date.now()+'-'+calls.length
 r.onThread?.(threadId);r.onTurn?.(turnId)
 calls.push({role:r.role,threadId,turnId})
 writeFileSync(join(config.stateDir,'fixture-calls.json'),JSON.stringify(calls),{mode:0o600})
 if(r.role==='worker'){
  const read=await r.onTool!('superagent_read',{resource:'files/input.txt'},'read-input')
  if(!read.success)throw Error('Fixture could not read its granted input')
  decode(await r.onTool!('superagent_artifact',{path:'input.txt'},'capture-input'))
  return {threadId,turnId,text:JSON.stringify({state:'ready',summary:'Read input.txt and checked 1+1=2',reply:'2',question:null,askedBy:null,handbacks:[]})}
 }
 const input=JSON.parse(r.input)
 if(role==='parent'){
  if(goalMode&&input.kind==='goal_verification'){
   let fileRead=false
   for(const e of input.evidence){let offset=0;for(;;){const value=decode(await r.onTool!('goal_evidence',{id:e.id,offset},'evidence-'+e.id+'-'+offset));if(e.kind==='file'&&e.key==='input.txt'&&value.content==='2\n')fileRead=true;if(value.nextOffset===null)break;offset=value.nextOffset}}
   if(!fileRead)throw Error('Independent fixture verifier did not receive the actual expected bytes')
   return {threadId,turnId,text:JSON.stringify({checks:input.criteria.map((c:any)=>({criterionId:c.id,verdict:'passed',explanation:'Read the captured input.txt bytes independently',evidenceIds:input.evidence.filter((e:any)=>c.id==='__goal__'||e.criterionIds.includes(c.id)).map((e:any)=>e.id)}))})}
  }
  if(goalMode){
   const list=decode(await r.onTool!('team_delegate',{action:'list'},'list-teams'))
   decode(await r.onTool!('router_goal',{action:'start',operationId:'goal-acceptance',expectedRevision:0,title:'Verified child file',objective:'The actual child input.txt content is exactly 2 followed by a newline',authorizationQuote:'Use a structured goal with independent acceptance',maxRepairs:0,maxReplans:0,
    criteria:[{id:'value',description:'Actual input.txt contains 2 followed by a newline',files:['input.txt'],check:{kind:'text_contains',path:'input.txt',text:'2\n'}}],nodes:[{id:'child',title:'Verify child file',instruction:'Read input.txt, check 1+1=2, and capture the declared file',teamTargetId:list.targets[0].id,criterionIds:['value']}]},'start-goal'))
   return {threadId,turnId,text:JSON.stringify({reply:''})}
  }
  if(input.kind==='team_result'){
   if(input.task.remoteState!=='ready')return {threadId,turnId,text:JSON.stringify({reply:'Remote work needs attention: '+input.task.remoteState})}
   const read=decode(await r.onTool!('team_delegate',{action:'inspect',id:input.task.id},'inspect'))
   if(!read.evidence.some((e:any)=>e.kind==='remote-artifact'&&e.content.trim()==='2'))throw Error('Fixture evidence mismatch')
   const list=decode(await r.onTool!('team_delegate',{action:'list'},'list'))
   decode(await r.onTool!('team_delegate',{action:'accept',id:input.task.id,operationId:'review',expectedRevision:list.revision,evidence:read.evidence.map((e:any)=>e.id)},'accept'))
   return {threadId,turnId,text:JSON.stringify({reply:'DELEGATION_VERIFIED_2'})}
  }
  const list=decode(await r.onTool!('team_delegate',{action:'list'},'list'))
  decode(await r.onTool!('team_delegate',{action:'assign',targetId:list.targets[0].id,operationId:'fixture-delegation',expectedRevision:list.revision,text:'Read input.txt, check it is the result of 1+1, and return the file as evidence.',acceptance:'Read the actual file and confirm the value is 2.',artifacts:['input.txt']},'assign'))
 }else if(input.kind==='worker_result'){
  decode(await r.onTool!('worker_manage',{action:'result',ticketId:input.messages[0].ticketId},'inspect-worker'))
  return {threadId,turnId,text:JSON.stringify({reply:'Worker checked input.txt: 2'})}
 }else{
  const list=decode(await r.onTool!('worker_manage',{action:'list'},'list'))
  decode(await r.onTool!('worker_manage',{action:'assign',id:'one',requestId:'fixture-worker',revision:list.revision,text:'Read files/input.txt using superagent_read and confirm that it contains 2, the result of 1+1.',acceptance:'Actual file read; value 2'},'assign-worker'))
 }
 return {threadId,turnId,text:JSON.stringify({reply:''})}
}}
const runtime=await Runtime.create(config,real?{}:{model}),host=await serve(runtime)
console.log(JSON.stringify({url:host.url,stateDir:config.stateDir,mode:real?'real-model':'fixture',pid:process.pid}))
let stopping=false
async function close(){
 if(stopping)return;stopping=true
 host.server.closeAllConnections();await new Promise<void>(r=>host.server.close(()=>r()));await host.closeRuntime()
}
process.once('SIGTERM',()=>void close());process.once('SIGINT',()=>void close())
