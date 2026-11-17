/** Actual admitted inputs, memory context, WorkerManager and continuity commands; no model/provider execution. */
import {createHash,randomUUID} from 'node:crypto'
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs'
import {join,resolve} from 'node:path'
import {Runtime} from '../src/runtime.ts'
import {configSchema} from '../src/config.ts'
import {serve} from '../src/server.ts'
const root=resolve(process.argv[2]??'.local/task-decisions-acceptance'),cwd=join(root,'workspace')
mkdirSync(cwd,{recursive:true,mode:0o700});if(existsSync(join(root,'browser.json')))throw Error('Use a fresh private acceptance directory')
let modelCalls=0
const runtime=new Runtime(configSchema.parse({stateDir:join(root,'state'),port:0,watchdog:{enabled:false},work:{sandboxDriver:'disabled',network:false,autoRecover:false},execution:{router:{mode:'host'},management:{enabled:true,maxWorkers:1},workers:[{id:'one',label:'本地分析',backend:'codex'}]},sources:[{id:'local',kind:'local',cwd,workspace:{mode:'source'},allowedActors:['alice']}]}),{model:{async run(){modelCalls++;throw Error('Model execution is outside this read-only fixture')}}})
runtime.pause(true)
runtime.scopes.command({action:'scope.put',operationId:'scope',expectedRevision:0,scope:{id:'team',tenantId:'local',name:'本地预览',contextBytes:128000,managers:[JSON.stringify(['local','alice'])],workerIds:['one'],sourceIds:['local'],backendIds:['codex']}})
runtime.scopes.command({action:'entry.bind',operationId:'entry',expectedRevision:0,scopeId:'team',sourceId:'local',accountNamespace:'local',nativeId:'topic',history:'group'})
let seq=0
function receive(text:string){const value=runtime.receive('local','alice',{id:'request-'+(++seq),thread:'topic',scope:'topic',text,addressed:true})as{triggerId:string},trigger=runtime.store.triggers.get(value.triggerId)!,context=runtime.scopes.context(trigger,'local:topic')!;runtime.continuity.capture(context,[trigger.id]);const packet=runtime.memory.build(context,{request:text},'codex');return{trigger,context,packet}}
async function assign(input:ReturnType<typeof receive>,title:string){const result=await runtime.manager.call({action:'assign',id:'one',revision:runtime.settings.current().revision,requestId:'assign-'+(++seq),text:title},{discussion:'local:topic',trigger:input.trigger,scoped:input.context,manifest:input.packet.manifest});return result.ticketId}
const first=receive('先比较两种展示方法。可以考虑图表，但不要部署。'),mainId=await assign(first,'比较展示方法')
runtime.continuity.command({action:'record',operationId:'quote',kind:'requirement',text:'可以考虑图表，但不要部署。',sourceIds:[first.trigger.id]},first.context,first.packet.manifest)
const previous=runtime.continuity.command({action:'record',operationId:'first-choice',kind:'decision',text:'先比较图表和表格。',sourceIds:[first.trigger.id]},first.context,first.packet.manifest)
const next=receive('改用表格。只分析，不实施。')
await runtime.manager.call({action:'send',ticketId:mainId,revision:runtime.settings.current().revision,requestId:'change-input',text:'改用表格。只分析，不实施。'},{discussion:'local:topic',trigger:next.trigger,scoped:next.context,manifest:next.packet.manifest})
runtime.continuity.command({action:'supersede',operationId:'replace-choice',kind:'decision',text:'改用表格。只分析，不实施。',sourceIds:[next.trigger.id],supersedes:previous.id},next.context,next.packet.manifest)
runtime.continuity.command({action:'record',operationId:'commitment',kind:'commitment',text:'随后整理比较结果。',sourceIds:[next.trigger.id]},next.context,next.packet.manifest)
const unrelated=receive('这是一项独立的笔记整理工作。'),otherId=await assign(unrelated,'整理另一份笔记')
runtime.continuity.command({action:'record',operationId:'unrelated',kind:'decision',text:'仅整理这份独立笔记。',sourceIds:[unrelated.trigger.id]},unrelated.context,unrelated.packet.manifest)

const host=await serve(runtime);clearInterval((runtime as unknown as{timer:ReturnType<typeof setInterval>}).timer)
try{
 const token=readFileSync(host.tokenPath,'utf8').trim(),headers={authorization:'Bearer '+token}
 const path=host.url+'/entry-workspace/task/'+mainId
 if((await fetch(path)).status!==401)throw Error('Unauthenticated task read accepted')
 const before=runtime.store.db.prepare('SELECT total_changes() AS n').get()!.n
 const response=await fetch(path,{headers}),body=await response.json() as any
 if(response.status!==200||body.decisionRecords?.schema!==3)throw Error('Protected history unavailable')
 const row=body.decisionRecords.items.find((v:any)=>v.history.length)
 if(!row||row.confirmation!=='not_recorded'||row.execution!=='not_recorded'||row.history[0].text!=='先比较图表和表格。')throw Error('History or evidence labels incorrect')
 const other=await(await fetch(host.url+'/entry-workspace/task/'+otherId,{headers})).json() as any
 if(JSON.stringify(other.decisionRecords).includes('先比较图表和表格。'))throw Error('Cross-task leak')
 if(before!==runtime.store.db.prepare('SELECT total_changes() AS n').get()!.n)throw Error('Read mutated database')
 const html=await fetch(host.url+'/configure',{headers});if(html.status!==200)throw Error('Configuration app unavailable')
 // Drive the existing production proposal/decision/receipt path with a local-only adapter.
 const source=runtime.config.sources[0]!,owner=runtime.scopes.ownership(mainId)!,assignment=runtime.store.tickets.get(mainId)!.assignments.at(-1)!
 source.capabilities.resources=true;source.capabilities.replies=true;source.options={...source.options,statusTargets:[{key:'local',entryId:owner.originEntry,issueId:'local',teamId:'local'}]}
 const states=[{id:'todo',name:'Todo'},{id:'done',name:'Done'}];let current=states[0]!,writes=0
 const adapter=runtime.sources.get(source.id)!
 adapter.workflowState=async()=>({account:'local',issue:'local',label:'Local fixture',revision:String(writes),current,states})
 adapter.applyWorkflowState=async(_target,_expected,next,valid)=>{if(valid&&!valid())throw Error('revoked');current=states.find(s=>s.id===next)!;writes++;return 'updated'}
 runtime.engine.assignmentStarted(mainId,assignment.id)
 const proposal=await runtime.workflows.request({ticketId:mainId,assignmentId:assignment.id,cwd,sandbox:'read-only',depth:0},{action:'propose',sourceId:source.id,target:'local',stateId:'done',requestId:'local'}) as {id:string}
 const pending=await(await fetch(path,{headers})).json() as any
 if(pending.decisionRecords.operations.items[0]?.confirmation!=='not_recorded'||writes)throw Error('Proposal inferred permission')
 const decided=await fetch(host.url+'/workflow-actions',{method:'POST',headers:{...headers,'content-type':'application/json'},body:JSON.stringify({id:proposal.id,decision:'approve'})})
 if(decided.status!==200)throw Error('Local operator decision rejected: '+decided.status)
 const applied=await(await fetch(path,{headers})).json() as any
 if(applied.decisionRecords.operations.items[0]?.execution!=='applied_readback'||applied.decisionRecords.operations.items[0]?.confirmation!=='approved'||writes!==1)throw Error('Workflow receipts not projected')
 if(applied.decisionRecords.items.some((v:any)=>v.confirmation!=='not_recorded'||v.execution!=='not_recorded'))throw Error('Unlinked journal promoted')
 runtime.engine.report(mainId,{state:'ready',summary:'Local analysis complete'})
 const ended=await(await fetch(path,{headers})).json() as any
 if(ended.decisionRecords?.taskState!=='ended')throw Error('Readable ended history missing')
 source.options.statusTargets=[]
 const revokedTarget=await(await fetch(path,{headers})).json() as any
 if(revokedTarget.decisionRecords.operations.items.length)throw Error('Revoked resource visible')
 runtime.config.sources[0]!.allowedActors=[]
 const revoked=await(await fetch(path,{headers})).json() as any
 if(revoked.decisionRecords)throw Error('Revoked source remains visible')
 if(modelCalls)throw Error('Unexpected model call')
 writeFileSync(join(root,'result.json'),JSON.stringify({passed:true,checks:['unauthenticated 401','protected history/source JSON','suggestion not authorization','cross-task isolation','zero read writes','configuration HTML 200','revoked source hidden','real proposal and operator decision path','local write and readback receipt','unlinked journal remains unknown','ended task history','revoked resource hidden'],modelCalls,externalCalls:0,realPlatform:false,browser:false},null,2))
 console.log('O45 HTTP/SQLite acceptance passed')
}finally{host.server.closeAllConnections();await new Promise<void>(r=>host.server.close(()=>r()));await host.closeRuntime()}
