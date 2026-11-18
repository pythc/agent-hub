import {mkdtempSync,rmSync,mkdirSync,renameSync,symlinkSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterEach,expect,it,vi} from 'vitest'
import {Runtime} from '../src/runtime.ts'
import {configSchema} from '../src/config.ts'
import {currentTaskAssignment,reviseTaskAssignment,commitTaskAssignment,assertAssignmentLeaseCapability,previewTaskAssignment,validateTaskAssignment,bindTaskAssignmentLease,validateAssignmentLease,restrictAssignmentExecution,assertAssignmentTool,assignmentContractView} from '../src/task-assignment-contract.ts'
import type {AssignmentSpec} from '../src/task-assignment-contract.ts'
const cleanups:(()=>Promise<void>)[]=[]
afterEach(async()=>{for(const close of cleanups.splice(0).reverse())await close()})
function fixture(scoped=true){
 const root=mkdtempSync(join(tmpdir(),'assignment-contract-'))
 const config=configSchema.parse({stateDir:join(root,'state'),acceptMode:'auto',work:{sandboxDriver:'disabled',autoRecover:false},execution:{router:{mode:'host'},management:{enabled:true,maxWorkers:2},workers:[{id:'one',backend:'codex'},{id:'two',backend:'codex'}]},sources:[{id:'local',kind:'local',cwd:root,workspace:{mode:'source'},allowedActors:['alice']}]})
 const model={run:vi.fn(async()=>{throw Error('Unit fixture never runs inference')})},host=new Runtime(config,{model})
 cleanups.push(async()=>{await host.close();rmSync(root,{recursive:true,force:true})})
 if(scoped)host.scopes.command({action:'scope.put',operationId:'scope',expectedRevision:0,scope:{id:'team',tenantId:'org',name:'Team',managers:[JSON.stringify(['local','alice'])],workerIds:['one','two'],sourceIds:['local'],backendIds:['codex']}})
 if(scoped)host.scopes.command({action:'entry.bind',operationId:'entry',expectedRevision:0,scopeId:'team',sourceId:'local',accountNamespace:'local',nativeId:'topic',history:'group'})
 const received=host.receive('local','alice',{id:'human',thread:'topic',scope:'topic',text:'Analyze the supplied material and prepare compatible summaries. Never deploy.',addressed:true}) as {triggerId:string}
 const trigger=host.store.triggers.get(received.triggerId)!,context={discussion:'local:topic',trigger,scoped:host.scopes.context(trigger,'local:topic')!}
 const assign=(requestId:string,assignment?:AssignmentSpec,id='one')=>host.manager.call({action:'assign',id,revision:0,requestId,text:'Analyze supplied material',assignment},context)
 return {root,host,context,assign,model}
}
const shared={key:'summary',version:1,inputs:['supplied material'],outputs:['summary'],acceptance:['supported by supplied evidence']}
it('previews without writes and commits two Workers to the same immutable interface version',async()=>{
 const f=fixture(),before=f.host.store.db.prepare('SELECT * FROM records ORDER BY kind,id').all()
 const p=previewTaskAssignment(f.host,'one',f.context,{interface:shared})
 expect(f.host.store.db.prepare('SELECT * FROM records ORDER BY kind,id').all()).toEqual(before)
 const a=await f.assign('one',{interface:shared}),b=await f.assign('two',{interface:{id:p.interface!.id,digest:p.interface!.digest}},'two')
 const ac=validateTaskAssignment(f.host,a.ticketId)!,bc=validateTaskAssignment(f.host,b.ticketId)!
 expect(ac.interface).toEqual(bc.interface);expect(ac.authority.parentTrigger).toBe(f.context.trigger.id)
 expect(f.host.store.list('assignment-interface')).toHaveLength(1);expect(f.model.run).not.toHaveBeenCalled()
})
it('rejects same-version mutation, supersedes old version without changing its retained contract',async()=>{
 const f=fixture(),a=await f.assign('one',{interface:shared}),old=validateTaskAssignment(f.host,a.ticketId)!
 expect(()=>previewTaskAssignment(f.host,'two',f.context,{interface:{...shared,outputs:['changed']}})).toThrow('interface_version_conflict')
 await f.assign('two',{interface:{...shared,version:2,outputs:['new summary']}},'two')
 expect(()=>validateTaskAssignment(f.host,a.ticketId)).toThrow('interface_superseded')
 expect(assignmentContractView(f.host,a.ticketId)).toMatchObject({contract:old,blocker:'assignment_contract_interface_superseded'})
})
it.each([{paths:[]},{paths:['file.txt']}])('rejects unsupported path constraints even for %j',({paths})=>{
 const f=fixture();expect(()=>previewTaskAssignment(f.host,'one',f.context,{workspace:{mode:'read-only',writePaths:paths}})).toThrow('path_constraints_unsupported')
})
it('rejects workspace, tool, connection and unsupported budget escalation',()=>{
 const f=fixture()
 for(const [spec,error] of [[{workspace:{mode:'workspace-write'}},'workspace_escalation'],[{allowedTools:['superagent_shell']},'tool_escalation'],[{requiredTools:['invented']},'required_tool_unavailable'],[{allowedConnections:['secret']},'connection_escalation'],[{limits:{maxToolCalls:2}},'budget_unsupported']] as const)expect(()=>previewTaskAssignment(f.host,'one',f.context,spec)).toThrow(error)
})
it('never treats ready executor completion as independent acceptance',async()=>{
 const f=fixture(),a=await f.assign('one'),task=f.host.store.tickets.get(a.ticketId)!,assignmentId=task.assignments.at(-1)!.id
 f.host.engine.assignmentStarted(task.id,assignmentId);f.host.engine.report(task.id,{state:'ready',summary:'self report'})
 expect(()=>previewTaskAssignment(f.host,'two',f.context,{dependsOn:[{ticketId:task.id,assignmentId}]})).toThrow('dependency_not_independently_accepted')
})
it('binds an actual canonical workspace lease and refuses wrong owners and unauthorized tools',async()=>{
 const f=fixture(),a=await f.assign('one',{allowedTools:['superagent_progress'],limits:{timeoutMs:2000}}),task=f.host.store.tickets.get(a.ticketId)!,assignmentId=task.assignments.at(-1)!.id
 f.host.engine.assignmentStarted(task.id,assignmentId)
 f.host.store.put('run',task.id,{ticketId:task.id,assignmentId,cwd:f.root,phase:'running',backendId:'codex'})
 const owner={ticketId:task.id,assignmentId,cwd:f.root,sandbox:'read-only' as const,network:true,depth:0,leaseId:undefined as string|undefined}
 const execution=restrictAssignmentExecution(f.host,task.id,{backendId:'codex',tools:f.host.availableWorkerSpecs().map(t=>t.name),options:{},sandbox:'read-only',network:true})
 expect(execution.tools).toEqual(['superagent_progress']);expect(execution.options.timeoutMs).toBe(2000)
 expect(validateAssignmentLease(f.host,owner)).toBe(false)
 const lease=bindTaskAssignmentLease(f.host,owner,execution)!;owner.leaseId=lease.id
 expect(validateAssignmentLease(f.host,owner)).toBe(true)
 expect(validateAssignmentLease(f.host,{...owner,assignmentId:'other'})).toBe(false)
 expect(validateAssignmentLease(f.host,{...owner,sandbox:'workspace-write'})).toBe(false)
 expect(()=>assertAssignmentTool(f.host,task.id,'superagent_read')).toThrow('tool_not_allowed')
 expect(()=>assertAssignmentTool(f.host,task.id,'superagent_progress')).not.toThrow()
})
it('retains a frozen ceiling when profile gains tools but blocks when required tools are revoked',async()=>{
 const f=fixture(),a=await f.assign('one',{allowedTools:['superagent_progress'],requiredTools:['superagent_progress']})
 f.host.config.execution.workers![0]!.tools=['superagent_progress','superagent_read']
 expect(restrictAssignmentExecution(f.host,a.ticketId,{backendId:'codex',tools:['superagent_read','superagent_progress'],options:{},sandbox:'read-only',network:true}).tools).toEqual(['superagent_progress'])
 f.host.config.execution.workers![0]!.tools=[]
 expect(()=>validateTaskAssignment(f.host,a.ticketId)).toThrow()
})

it('records local operator provenance without inventing a human trigger and rejects backend substitution',async()=>{
 const f=fixture(false),result=await f.host.manager.call({action:'assign',id:'one',revision:0,requestId:'operator',discussion:'operator',text:'Analyze material'})
 expect(validateTaskAssignment(f.host,result.ticketId)?.authority).toMatchObject({provenance:'local_operator',parentTrigger:null,mandateDigest:null})
 expect(()=>restrictAssignmentExecution(f.host,result.ticketId,{backendId:'other',tools:[],options:{},sandbox:'read-only',network:true})).toThrow('backend_changed')
 f.host.config.sources[0]!.allowedActors=['bob']
 expect(()=>validateTaskAssignment(f.host,result.ticketId)).toThrow('basis_changed')
})
it('rolls back schema floor, interface and task contract when atomic persistence fails',async()=>{
 const f=fixture(),before=f.host.store.db.prepare('PRAGMA user_version').get()!.user_version,put=f.host.store.put.bind(f.host.store)
 const spy=vi.spyOn(f.host.store,'put').mockImplementation((kind,id,value)=>{if(kind==='task-assignment-contract')throw Error('injected write');return put(kind,id,value)})
 await expect(f.assign('failed',{interface:shared})).rejects.toThrow('injected write');spy.mockRestore()
 expect(f.host.store.db.prepare('PRAGMA user_version').get()!.user_version).toBe(before)
 expect(f.host.store.list('assignment-interface')).toEqual([]);expect(f.host.store.list('task-assignment-contract')).toEqual([])
 await f.assign('success',{interface:shared});expect(f.host.store.db.prepare('PRAGMA user_version').get()!.user_version).toBe(19)
})
it('rejects forged interface hashes and references from another actual discussion',async()=>{
 const f=fixture(),a=await f.assign('one',{interface:shared}),c=validateTaskAssignment(f.host,a.ticketId)!
 expect(()=>previewTaskAssignment(f.host,'two',f.context,{interface:{id:c.interface!.id,digest:'0'.repeat(64)}})).toThrow('interface_unavailable')
 const received=f.host.receive('local','alice',{id:'other',thread:'other',scope:'topic',text:'Analyze other material',addressed:true}) as {triggerId:string},trigger=f.host.store.triggers.get(received.triggerId)!
 expect(()=>previewTaskAssignment(f.host,'two',{trigger,discussion:'local:other'},{interface:{id:c.interface!.id,digest:c.interface!.digest}})).toThrow()
})
it('uses permission-only leases, isolates subagent pointers and revokes old leases after narrowing',async()=>{
 const f=fixture();f.host.config.toolConnections.demo={enabled:true,transport:{kind:'http',url:'https://example.com/mcp',headerEnv:{}},allowedTools:['read'],timeoutMs:1000};f.host.config.execution.workers![0]!.toolConnections=['demo']
 const a=await f.assign('lease'),task=f.host.store.tickets.get(a.ticketId)!,assignmentId=task.assignments.at(-1)!.id
 f.host.engine.assignmentStarted(task.id,assignmentId);f.host.store.put('run',task.id,{ticketId:task.id,assignmentId,cwd:f.root,phase:'running',backendId:'codex'})
 const owner={ticketId:task.id,assignmentId,cwd:f.root,sandbox:'read-only' as const,network:true,depth:0,leaseId:undefined as string|undefined},effective={backendId:'codex',tools:['superagent_progress','superagent_read'],options:{prompt:'PRIVATE PROMPT',tools:['superagent_progress','superagent_read'],toolConnections:['demo']}}
 const root=bindTaskAssignmentLease(f.host,owner,effective)!;owner.leaseId=root.id
 expect(JSON.stringify(root)).not.toContain('PRIVATE PROMPT')
 expect(bindTaskAssignmentLease(f.host,owner,{...effective,options:{...effective.options,prompt:'changed'}})?.id).toBe(root.id)
 const child={...owner,agentId:'child',depth:1},childLease=bindTaskAssignmentLease(f.host,child,{...effective,tools:['superagent_progress'],options:{tools:['superagent_progress']}})!
 child.leaseId=childLease.id
 expect(()=>assertAssignmentLeaseCapability(f.host,child,'superagent_read')).toThrow('lease_tool_not_allowed')
 expect(()=>assertAssignmentLeaseCapability(f.host,child,undefined,'demo')).toThrow('lease_connection_not_allowed')
 expect(()=>assertAssignmentLeaseCapability(f.host,owner,undefined,'demo')).not.toThrow()
 expect(()=>assertAssignmentLeaseCapability(f.host,child,'superagent_progress')).not.toThrow()
 expect(validateAssignmentLease(f.host,owner)).toBe(true);expect(validateAssignmentLease(f.host,child)).toBe(true)
 const grandchild={...child,agentId:'grandchild',depth:2},grandchildLease=bindTaskAssignmentLease(f.host,grandchild,{...effective,tools:['superagent_progress'],options:{tools:['superagent_progress']}})!
 grandchild.leaseId=grandchildLease.id;expect(validateAssignmentLease(f.host,grandchild)).toBe(true)
 const narrowed=bindTaskAssignmentLease(f.host,owner,{...effective,tools:['superagent_progress'],options:{tools:['superagent_progress']}})!
 expect(validateAssignmentLease(f.host,owner)).toBe(false);expect(validateAssignmentLease(f.host,child)).toBe(false);expect(validateAssignmentLease(f.host,grandchild)).toBe(false)
 owner.leaseId=narrowed.id;expect(validateAssignmentLease(f.host,owner)).toBe(true)
 expect(()=>bindTaskAssignmentLease(f.host,owner,effective)).toThrow('lease_superseded')
})
it('allows later inputs but detects edits to fixed dispatch inputs and safely hides cleanup tombstones',async()=>{
 const f=fixture(),a=await f.assign('inputs'),before=validateTaskAssignment(f.host,a.ticketId)!
 f.host.engine.note(a.ticketId,'Later supplemental input')
 expect(validateTaskAssignment(f.host,a.ticketId)?.inputDigests).toEqual(before.inputDigests)
 const task=f.host.store.tickets.get(a.ticketId)!,trigger=f.host.store.triggers.get(task.origin.triggerId)!
 // Host retained source corruption must fail closed, unlike appending a new input.
 f.host.store.triggers.save({...trigger,text:'Changed original material'})
 expect(()=>validateTaskAssignment(f.host,a.ticketId)).toThrow('initial_input_changed')
 f.host.store.put('task-assignment-contract',a.ticketId,{ticketId:a.ticketId,redacted:true})
 expect(assignmentContractView(f.host,a.ticketId)).toBeUndefined()
})

it('fences replacement of the canonical workspace directory and rejects symlink roots',async()=>{
 const f=fixture(),a=await f.assign('directory'),task=f.host.store.tickets.get(a.ticketId)!,assignmentId=task.assignments.at(-1)!.id,cwd=join(f.root,'workspace')
 mkdirSync(cwd);f.host.engine.assignmentStarted(task.id,assignmentId);f.host.store.put('run',task.id,{ticketId:task.id,assignmentId,cwd,phase:'running',backendId:'codex'})
 const owner={ticketId:task.id,assignmentId,cwd,sandbox:'read-only' as const,network:true,depth:0,leaseId:undefined as string|undefined},effective={backendId:'codex',tools:[],options:{}}
 owner.leaseId=bindTaskAssignmentLease(f.host,owner,effective)!.id
 renameSync(cwd,cwd+'-old');mkdirSync(cwd)
 expect(validateAssignmentLease(f.host,owner)).toBe(false)
 expect(()=>bindTaskAssignmentLease(f.host,owner,effective)).toThrow('workspace_identity_changed')
 rmSync(cwd,{recursive:true});symlinkSync(cwd+'-old',cwd,'dir')
 expect(validateAssignmentLease(f.host,owner)).toBe(false)
 expect(()=>bindTaskAssignmentLease(f.host,owner,effective)).toThrow('workspace_symlink')
})

it('keeps frozen trigger input valid after actual delivery/read lifecycle but detects semantic edits',async()=>{
 const f=fixture(),a=await f.assign('delivery'),task=f.host.store.tickets.get(a.ticketId)!,assignmentId=task.assignments.at(-1)!.id
 // Build a pre-existing input before the unit-level contract capture, then exercise Engine bookkeeping.
 f.host.store.db.prepare('DELETE FROM records WHERE kind=? AND id=?').run('task-assignment-contract',task.id)
 const trigger=f.context.trigger,input={id:'initial-input',kind:'trigger' as const,triggerId:trigger.id,at:trigger.at,human:true as const}
 f.host.store.tickets.save({...task,inputs:[input],undelivered:[input.id]})
 commitTaskAssignment(f.host,task.id,'one',f.context)
 f.host.engine.assignmentStarted(task.id,assignmentId);f.host.engine.inputsDelivered(task.id,assignmentId,[input.id]);f.host.engine.inputsRead(task.id,[input.id])
 expect(()=>validateTaskAssignment(f.host,task.id)).not.toThrow()
 const updated=f.host.store.tickets.get(task.id)!
 expect(updated.inputs.find(i=>i.id===input.id)).toMatchObject({deliveredTo:assignmentId,readAt:expect.any(String)})
 f.host.store.tickets.save({...updated,inputs:updated.inputs.map(i=>i.id===input.id?{...i,note:'changed meaning'}:i)})
 expect(()=>validateTaskAssignment(f.host,task.id)).toThrow('initial_input_changed')
})

it('withholds historical contract text after permission rebuild or original source revocation',async()=>{
 const f=fixture(),a=await f.assign('private',{interface:shared})
 expect(assignmentContractView(f.host,a.ticketId)?.contract.interface).toBeTruthy()
 f.host.store.put('task-continuation',a.ticketId,{ticketId:a.ticketId,triggerId:f.context.trigger.id,discussion:f.context.discussion,text:'Fresh permission context',inputIds:[],priorAssignments:[],priorReports:[],priorJobs:[],priorMessages:[],priorToolCalls:[],workspaceReviewed:true,at:Date.now()})
 expect(assignmentContractView(f.host,a.ticketId)).toBeUndefined()
 f.host.store.db.prepare('DELETE FROM records WHERE kind=? AND id=?').run('task-continuation',a.ticketId)
 f.host.config.sources[0]!.enabled=false
 expect(assignmentContractView(f.host,a.ticketId)).toBeUndefined()
})

it('adds an immutable migration revision with the old ceiling and rejects stale revisions or expansion',async()=>{
 const f=fixture(),a=await f.assign('revision',{allowedTools:['superagent_progress'],interface:shared}),old=currentTaskAssignment(f.host,a.ticketId)!,raw=f.host.store.get('task-assignment-contract',a.ticketId)
 const next=reviseTaskAssignment(f.host,a.ticketId,'one',f.context,{kind:'migration',commandId:'migration-1',fingerprint:'actual-command-fingerprint',expectedDigest:old.digest})
 expect(next).toMatchObject({revision:2,previousDigest:old.digest,interface:old.interface,effective:{tools:['superagent_progress']}})
 expect(currentTaskAssignment(f.host,a.ticketId)?.digest).toBe(next.digest)
 expect(f.host.store.get('task-assignment-contract',a.ticketId)).toEqual(raw)
 expect(()=>validateTaskAssignment(f.host,a.ticketId)).not.toThrow()
 expect(()=>reviseTaskAssignment(f.host,a.ticketId,'one',f.context,{kind:'migration',commandId:'stale',fingerprint:'x',expectedDigest:old.digest})).toThrow('revision_conflict')
 expect(()=>reviseTaskAssignment(f.host,a.ticketId,'one',f.context,{kind:'migration',commandId:'escalate',fingerprint:'x',expectedDigest:next.digest,spec:{allowedTools:['superagent_read']}})).toThrow('revision_escalation')
})
it('creates a clean rebuild revision without old interface, dependencies or objective text',async()=>{
 const f=fixture(),a=await f.assign('rebuild',{interface:shared,allowedTools:['superagent_progress']}),old=currentTaskAssignment(f.host,a.ticketId)!
 const continuation={ticketId:a.ticketId,triggerId:f.context.trigger.id,discussion:f.context.discussion,text:'Fresh permission-reviewed task only',inputIds:[],priorAssignments:[],priorReports:[],priorJobs:[],priorMessages:[],priorToolCalls:[],workspaceReviewed:true,at:Date.now()}
 f.host.store.put('task-continuation',a.ticketId,continuation)
 f.host.store.put('context-rebuild',a.ticketId,{reason:'context_permissions_changed'})
 const next=reviseTaskAssignment(f.host,a.ticketId,'one',f.context,{kind:'rebuild',commandId:'rebuild-1',fingerprint:'actual-rebuild-fingerprint',expectedDigest:old.digest})
 expect(next.objective).toBe(continuation.text);expect(next.interface).toBeUndefined();expect(next.dependencies).toEqual([])
 expect(next.effective.tools).toEqual(['superagent_progress']);expect(f.host.store.get('task-assignment-contract',a.ticketId)).toEqual(old)
 expect(validateTaskAssignment(f.host,a.ticketId)?.digest).toBe(next.digest)
 expect(assignmentContractView(f.host,a.ticketId)?.contract.objective).toBe(continuation.text)
})

it('preserves business interfaces during budget-only rebuild and fails closed on missing revision rows',async()=>{
 const f=fixture(),a=await f.assign('budget-rebuild',{interface:shared}),old=currentTaskAssignment(f.host,a.ticketId)!
 f.host.store.put('context-rebuild',a.ticketId,{reason:'context_budget_exceeded'})
 const next=reviseTaskAssignment(f.host,a.ticketId,'one',f.context,{kind:'rebuild',commandId:'budget-1',fingerprint:'budget-command',expectedDigest:old.digest})
 expect(next.interface).toEqual(old.interface);expect(next.objective).toBe(old.objective)
 f.host.store.db.prepare('DELETE FROM records WHERE kind=? AND id=?').run('task-assignment-revision',next.digest)
 expect(()=>currentTaskAssignment(f.host,a.ticketId)).toThrow('revision_pointer_corrupt')
 expect(assignmentContractView(f.host,a.ticketId)).toBeUndefined()
})
it('rolls back a revision and its current pointer if persistence fails',async()=>{
 const f=fixture(),a=await f.assign('revision-rollback'),old=currentTaskAssignment(f.host,a.ticketId)!,put=f.host.store.put.bind(f.host.store)
 const spy=vi.spyOn(f.host.store,'put').mockImplementation((kind,id,value)=>{if(kind==='task-assignment-current')throw Error('pointer write failed');return put(kind,id,value)})
 expect(()=>reviseTaskAssignment(f.host,a.ticketId,'one',f.context,{kind:'migration',commandId:'rollback',fingerprint:'rollback-command',expectedDigest:old.digest})).toThrow('pointer write failed');spy.mockRestore()
 expect(currentTaskAssignment(f.host,a.ticketId)).toEqual(old);expect(f.host.store.list('task-assignment-revision')).toEqual([])
})
it('redacts shared interface/current/revision text through actual history cleanup and cannot revive it',async()=>{
 const f=fixture(),spec={interface:{...shared,inputs:['PRIVATE_INTERFACE_INPUT'],outputs:['PRIVATE_INTERFACE_OUTPUT'],acceptance:['PRIVATE_INTERFACE_CRITERIA']}}
 const a=await f.assign('cleanup-first',spec),first=currentTaskAssignment(f.host,a.ticketId)!,iface=first.interface!
 const b=await f.assign('cleanup-second',{interface:{id:iface.id,digest:iface.digest}},'two')
 reviseTaskAssignment(f.host,a.ticketId,'one',f.context,{kind:'migration',commandId:'cleanup-revision',fingerprint:'cleanup-revision-command',expectedDigest:first.digest})
 expect(f.host.store.get<any>('assignment-interface-reference',iface.id).ticketIds.sort()).toEqual([a.ticketId,b.ticketId].sort())
 f.host.memory.command(f.context.scoped!,{action:'history.delete',operationId:'delete-assignment-history',expectedRevision:0})
 await f.host.memory.cleanup.process({run:async()=>{throw Error('No inference')},purge:async()=>({local:'verified',provider:'not_managed'})},async()=>true)
 const records=f.host.store.db.prepare("SELECT kind,body FROM records WHERE kind LIKE 'assignment-interface%' OR kind LIKE 'task-assignment%'").all()
 expect(JSON.stringify(records)).not.toMatch(/PRIVATE_INTERFACE_INPUT|PRIVATE_INTERFACE_OUTPUT|PRIVATE_INTERFACE_CRITERIA/)
 expect(assignmentContractView(f.host,a.ticketId)).toBeUndefined();expect(assignmentContractView(f.host,b.ticketId)).toBeUndefined()
 expect(()=>previewTaskAssignment(f.host,'one',f.context,spec)).toThrow()
 expect(()=>validateTaskAssignment(f.host,b.ticketId)).toThrow()
})
it('drains an already assigned retiring Worker without admitting new assignments',async()=>{
 const f=fixture(),a=await f.assign('drain')
 f.host.config.execution.workers![0]!.state='retiring'
 expect(()=>validateTaskAssignment(f.host,a.ticketId)).not.toThrow()
 expect(()=>previewTaskAssignment(f.host,'one',f.context)).toThrow('worker_unavailable')
})
