import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterEach,expect,it,vi} from 'vitest'
import {Runtime} from '../src/runtime.ts'
import {configSchema} from '../src/config.ts'
import {bodyDigest,stableDigest} from '../src/sources.ts'
import type {Model,ModelRequest} from '../src/model.ts'
import type {RouterGoal} from '../src/router-goals.ts'
const roots:string[]=[],hosts:Runtime[]=[]
afterEach(async()=>{vi.restoreAllMocks();for(const h of hosts.splice(0))await h.close();for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true})})
function fixture(model:Model={run:vi.fn(async()=>{throw Error('No model execution permitted')})}){
 const root=mkdtempSync(join(tmpdir(),'goal-contract-'));roots.push(root)
 const config=configSchema.parse({stateDir:join(root,'state'),acceptMode:'auto',work:{sandboxDriver:'disabled',autoRecover:false},execution:{router:{mode:'host'},management:{enabled:true,maxWorkers:1},workers:[{id:'one',backend:'codex'}]},sources:[{id:'local',kind:'local',cwd:root,workspace:{mode:'source'},allowedActors:['alice']}]})
 const host=new Runtime(config,{model});hosts.push(host)
 host.scopes.command({action:'scope.put',operationId:'scope',expectedRevision:0,scope:{id:'team',tenantId:'org',name:'Team',managers:[JSON.stringify(['local','alice'])],workerIds:['one'],sourceIds:['local'],backendIds:['codex']}})
 host.scopes.command({action:'entry.bind',operationId:'entry',expectedRevision:0,scopeId:'team',sourceId:'local',accountNamespace:'local',nativeId:'topic',history:'group'})
 let seq=0
 const context=(text:string)=>{const r=host.receive('local','alice',{id:'input-'+(++seq),thread:'topic',scope:'topic',text,addressed:true})as {triggerId:string};return host.scopes.context(host.store.triggers.get(r.triggerId)!,'local:topic')!}
 const original=context('Continuously implement and verify a report. Never deploy.')
 const command={action:'start',operationId:'first',expectedRevision:0,objective:'Implement report',authorizationQuote:'Continuously implement and verify',criteria:[{id:'report',description:'Report exists',files:['report.md']}],nodes:[{id:'work',title:'Implement',instruction:'Implement report',workerId:'one',criterionIds:['report']}]}
 const old=host.goals.command(command,original)as RouterGoal
 const corrected=context('Instead only analyze, do not implement. Use supplied notes. Finish by Friday.')
 const replacement={...command,operationId:'replacement',objective:'Analyze report',authorizationQuote:'only analyze, do not implement',supersedes:{goalId:old.id,expectedRevision:old.revision},details:{nonGoals:['do not implement'],inputs:['Use supplied notes'],deadline:'Finish by Friday'},nodes:[{id:'analyze',title:'Analyze',instruction:'Analyze only',workerId:'one',criterionIds:['report']}]}
 return {host,config,old,original,corrected,command,replacement,context}
}
it('retains immutable contracts, links both versions and replays replacement without another goal',()=>{
 const f=fixture(),digest=stableDigest(f.old.contract),next=f.host.goals.command(f.replacement,f.corrected)as RouterGoal
 expect(next.supersedes).toBe(f.old.id);expect(next.contract?.details).toEqual(f.replacement.details)
 const old=f.host.goals.get(f.old.id)!;expect(old).toMatchObject({state:'cancelled',supersededBy:next.id,revision:f.old.revision+1});expect(stableDigest(old.contract)).toBe(digest)
 expect(f.host.goals.command(f.replacement,f.corrected).id).toBe(next.id);expect(f.host.store.list('router-goal')).toHaveLength(2)
 expect(()=>f.host.goals.command({...f.replacement,objective:'Change replay'},f.corrected)).toThrow('reused')
 expect(()=>f.host.goals.command({...f.replacement,operationId:'another'},f.corrected)).toThrow('already ended')
 expect(()=>f.host.goals.command({action:'resume',id:old.id,operationId:'revive',expectedRevision:old.revision},f.corrected)).toThrow('Ended goal')
})
it('rejects invalid replacement before cancelling the old goal',()=>{
 const f=fixture(),interrupt=vi.spyOn(f.host,'interruptForAutomation')
 for(const change of [{supersedes:{goalId:f.old.id,expectedRevision:0}},{details:{nonGoals:['invented authority']}},{criteria:[]},{nodes:[{id:'x',title:'x',instruction:'x',workerId:'outside',criterionIds:['report']}]}])expect(()=>f.host.goals.command({...f.replacement,...change},f.corrected)).toThrow()
 expect(f.host.goals.get(f.old.id)).toEqual(f.old);expect(interrupt).not.toHaveBeenCalled();expect(f.host.store.list('router-goal')).toHaveLength(1)
 expect(()=>f.host.goals.command({action:'update',id:f.old.id,operationId:'mutate',expectedRevision:f.old.revision,details:{}},f.corrected)).toThrow('new goal')
})
it('cancels old task and approval, fences queued wake and verification, withdraws only matching pending notice',async()=>{
 const f=fixture(),assigned=await f.host.manager.call({action:'assign',id:'one',revision:0,requestId:'worker',text:'Implement report'},{discussion:'local:topic',trigger:f.original.trigger,scoped:f.original})
 const old={...f.old,taskIds:[assigned.ticketId]};f.host.store.put('router-goal',old.id,old)
 const approval=f.host.approvals.request(assigned.ticketId,{id:'approval-request',method:'item/commandExecution/requestApproval',params:{}});const rejected=approval.catch(e=>e.message)
 f.host.store.put('goal-wake','wake',{id:'wake',goalId:old.id,state:'queued'})
 f.host.store.put('goal-verification','review',{id:'review',goalId:old.id,state:'running'})
 f.host.store.put('goal-replan','plan',{id:'plan',goalId:old.id,state:'reviewing'})
 for(const id of ['old-notice','unrelated']){f.host.store.put('router-reply-owner',id,{goalId:id==='old-notice'?old.id:'another'});f.host.store.outbox.send({id,kind:'reply',text:'notice',channel:f.original.trigger.channel!})}
 const next=f.host.goals.command(f.replacement,f.corrected)
 expect(await rejected).toBe('Approval expired');expect(f.host.store.tickets.get(assigned.ticketId)?.ended?.by).toBe('human')
 expect(f.host.store.get<any>('goal-wake','wake').state).toBe('failed');expect(f.host.store.get<any>('goal-verification','review').state).toBe('stale');expect(f.host.store.get<any>('goal-replan','plan').state).toBe('stale')
 expect(f.host.store.deliveries().find(d=>d.id==='old-notice')?.status).toBe('dropped');expect(f.host.store.deliveries().find(d=>d.id==='unrelated')?.status).toBe('pending')
 expect(next.taskIds).toEqual([]);expect(next.finalRoundId).toBeUndefined()
})
it('does not abort old tasks when replacement persistence rolls back',async()=>{
 const f=fixture(),assigned=await f.host.manager.call({action:'assign',id:'one',revision:0,requestId:'worker',text:'Implement report'},{discussion:'local:topic',trigger:f.original.trigger,scoped:f.original})
 const old={...f.old,taskIds:[assigned.ticketId]};f.host.store.put('router-goal',old.id,old)
 const interrupt=vi.spyOn(f.host,'interruptForAutomation'),put=f.host.store.put.bind(f.host.store)
 vi.spyOn(f.host.store,'put').mockImplementation((kind,id,value)=>{if(kind==='goal-receipt')throw Error('injected persistence failure');return put(kind,id,value)})
 expect(()=>f.host.goals.command(f.replacement,f.corrected)).toThrow('injected persistence failure')
 expect(f.host.goals.get(old.id)).toEqual(old);expect(f.host.store.tickets.get(assigned.ticketId)?.ended).toBeUndefined();expect(interrupt).not.toHaveBeenCalled()
})
it('fences the original human turn and queued wake after replacement, including repeated control attempts',()=>{
 const f=fixture(),next=f.host.goals.command(f.replacement,f.corrected)
 expect(f.host.goals.forInput(f.original.trigger.id)?.id).toBe(f.old.id)
 expect(()=>f.host.goals.beforeTurn(f.original.trigger.id)).toThrow('replaced')
 expect(()=>f.host.goals.toolAllowed(f.original.trigger.id,'worker_manage',{action:'assign'})).toThrow('no longer accepts')
 expect(()=>f.host.goals.toolAllowed(f.original.trigger.id,'router_goal',{action:'start'})).toThrow('no longer accepts')
 f.host.goals.finishTurn(f.original.trigger.id)
 expect(f.host.goals.get(f.old.id)?.state).toBe('cancelled');expect(f.host.goals.get(next.id)?.state).toBe('active')
})
it('rejects replacement or descriptive metadata from a nonhuman turn',()=>{
 const f=fixture(),machine={...f.corrected,trigger:{...f.corrected.trigger,human:false}}
 expect(()=>f.host.goals.command(f.replacement,machine)).toThrow()
 expect(()=>f.host.goals.command({...f.command,operationId:'machine',details:{deadline:'Finish by Friday'}},machine)).toThrow()
 expect(f.host.goals.get(f.old.id)?.state).toBe('active')
})
it('durably fences open tasks after a crash between replacement commit and runtime cleanup',async()=>{
 const f=fixture(),assigned=await f.host.manager.call({action:'assign',id:'one',revision:0,requestId:'worker',text:'Implement report'},{discussion:'local:topic',trigger:f.original.trigger,scoped:f.original})
 f.host.store.put('router-goal',f.old.id,{...f.old,taskIds:[assigned.ticketId]})
 const interrupted=vi.spyOn(f.host,'interruptForAutomation').mockImplementation(()=>{throw Error('simulated postcommit crash')})
 expect(()=>f.host.goals.command(f.replacement,f.corrected)).toThrow('simulated postcommit crash')
 expect(f.host.goals.get(f.old.id)?.supersededBy).toBeTruthy();expect(f.host.store.tickets.get(assigned.ticketId)?.ended).toBeUndefined()
 expect(f.host.validWork({ticketId:assigned.ticketId,assignmentId:f.host.store.tickets.get(assigned.ticketId)!.assignments.at(-1)!.id} as any)).toBe(false)
 interrupted.mockRestore();hosts.splice(hosts.indexOf(f.host),1);await f.host.close()
 const reopened=new Runtime(f.config,{model:{run:vi.fn(async()=>{throw Error('Must not execute superseded task')})}});hosts.push(reopened)
 expect(reopened.store.tickets.get(assigned.ticketId)?.ended?.by).toBe('human')
 expect(reopened.store.list<RouterGoal>('router-goal')).toHaveLength(2)
})
it('withdraws old legacy notices but leaves uncertain/sending results unknown without sending again',async()=>{
 const f=fixture()
 for(const status of ['pending','sending','uncertain']){
  const id='goal-notice:'+status
  f.host.store.put('router-reply-owner',id,{discussion:'local:topic',triggerId:f.old.triggerId,inputs:[f.old.triggerId],manifests:[]})
  f.host.store.outbox.send({id,kind:'reply',text:'Old contract notice',channel:f.original.trigger.channel!})
  f.host.store.db.prepare('UPDATE outbox SET status=? WHERE id=?').run(status,id)
 }
 f.host.goals.command(f.replacement,f.corrected)
 await f.host.flush()
 const status=(id:string)=>f.host.store.deliveries().find(d=>d.id==='goal-notice:'+id)?.status
 expect(status('pending')).toBe('dropped');expect(status('sending')).toBe('sending');expect(status('uncertain')).toBe('uncertain')
 expect(f.host.store.deliveries().some(d=>d.status==='sent')).toBe(false)
})
it('retains and stops a late assignment returned after replacement without dispatching the next node',async()=>{
 const f=fixture(),old={...f.old,nodes:[...f.old.nodes!,{...f.old.nodes![0]!,id:'second'}]};f.host.store.put('router-goal',old.id,old)
 let entered!:()=>void,release!:()=>void;const started=new Promise<void>(r=>entered=r),waiting=new Promise<void>(r=>release=r)
 const originalCall=f.host.manager.call.bind(f.host.manager)
 const call=vi.spyOn(f.host.manager,'call').mockImplementation(async(...args)=>{const value=await originalCall(...args);entered();await waiting;return value})
 const advancing=f.host.goals.advance();await started
 const next=f.host.goals.command(f.replacement,f.corrected);release();await advancing
 expect(call).toHaveBeenCalledTimes(1)
 const retained=f.host.goals.get(old.id)!;expect(retained.state).toBe('cancelled');expect(retained.taskIds).toHaveLength(1)
 expect(f.host.store.tickets.get(retained.taskIds[0]!)?.ended?.by).toBe('human');expect(retained.nodes![0]!.state).toBe('held')
 expect(retained.nodes![1]!.ticketId).toBeUndefined();expect(f.host.goals.get(next.id)?.taskIds).toEqual([])
})
it('rejects a late human approval callback from a replaced Worker without creating approval metadata',async()=>{
 let captured:ModelRequest|undefined,release!:()=>void;const gate=new Promise<void>(r=>release=r)
 const f=fixture({async run(r){if(r.role==='worker'){captured=r;await gate}return {threadId:'test-thread',turnId:'test-turn',text:JSON.stringify(r.role==='worker'?{state:'ready',summary:'late',reply:'late',question:null,askedBy:null,handbacks:[]}:{reply:''})}}})
 await f.host.goals.advance()
 for(let i=0;i<100&&!captured;i++){await f.host.tick();await new Promise(r=>setTimeout(r,2))}
 expect(captured).toBeDefined()
 const successor=f.host.goals.command(f.replacement,f.corrected)
 const before=f.host.store.list('approval')
 try{await expect(captured!.onHumanRequest!({id:'late-approval',method:'item/commandExecution/requestApproval',params:{}})).rejects.toThrow()}finally{release()}
 expect(f.host.store.list('approval')).toEqual(before)
 for(let i=0;i<100&&!f.host.store.list<any>('transcript').some(t=>t.status==='stale');i++)await new Promise(r=>setTimeout(r,2))
 const stale=f.host.store.list<any>('transcript').find(t=>t.status==='stale')
 expect(stale).toMatchObject({goalId:f.old.id,reason:'goal_contract_replaced',contractHash:stableDigest(f.old.contract)});expect(stale.text).toContain('late')
 expect(f.host.goals.get(successor.id)?.taskIds).toEqual([])
 expect(f.host.store.deliveries().some(d=>d.text==='late')).toBe(false)
})
it('requires a fresh human input even when the old goal has been resumed from another trigger',()=>{
 const f=fixture();f.host.store.put('router-goal',f.old.id,{...f.old,triggerId:f.corrected.trigger.id})
 expect(()=>f.host.goals.command({...f.replacement,authorizationQuote:'Continuously implement',details:undefined},f.original)).toThrow('new explicit human request')
 expect(()=>f.host.goals.command(f.replacement,f.corrected)).toThrow('new explicit human request')
})
it('recovers orphan dispatch from its committed receipt, not an unverified task ID',async()=>{
 const f=fixture(),requestId='goal-node:'+f.old.id+':'+f.old.nodes![0]!.id
 const assigned=await f.host.manager.call({action:'assign',id:'one',revision:0,requestId,text:'Original dispatch committed before its pointer'},{discussion:'local:topic',trigger:f.original.trigger,scoped:f.original})
 expect(f.host.goals.get(f.old.id)?.taskIds).toEqual([])
 expect(f.host.goals.taskIdsForGoal(f.old)).toEqual([assigned.ticketId])
 const key=bodyDigest(['local:topic',requestId]),receipt=f.host.store.get<any>('worker-command',key)
 f.host.store.put('worker-command',key,{...receipt,scopeId:'unrelated'});expect(f.host.goals.taskIdsForGoal(f.old)).toEqual([])
 f.host.store.put('worker-command',key,receipt)
 f.host.goals.command(f.replacement,f.corrected)
 expect(f.host.goals.get(f.old.id)?.taskIds).toContain(assigned.ticketId);expect(f.host.store.tickets.get(assigned.ticketId)?.ended?.by).toBe('human')
 hosts.splice(hosts.indexOf(f.host),1);await f.host.close()
 const reopened=new Runtime(f.config,{model:{run:vi.fn(async()=>{throw Error('Orphan must not execute')})}});hosts.push(reopened)
 expect(reopened.store.tickets.get(assigned.ticketId)?.ended?.by).toBe('human')
})
it('raises the database barrier only after a replacement commits',()=>{
 const f=fixture(),version=()=>Number(f.host.store.db.prepare('PRAGMA user_version').get()!.user_version),before=version()
 expect(before).toBeLessThan(17)
 const put=f.host.store.put.bind(f.host.store),fail=vi.spyOn(f.host.store,'put').mockImplementation((kind,id,value)=>{if(kind==='goal-receipt')throw Error('rollback');return put(kind,id,value)})
 expect(()=>f.host.goals.command(f.replacement,f.corrected)).toThrow('rollback');expect(version()).toBe(before)
 fail.mockRestore();f.host.goals.command(f.replacement,f.corrected);expect(version()).toBe(17)
})
it('recovers an orphan from a prior resumed anchor only with its retained goal-control receipt',async()=>{
 const f=fixture(),r1=f.context('Resume the original authorized report'),resumed=f.host.goals.command({action:'resume',id:f.old.id,operationId:'resume-1',expectedRevision:f.old.revision},r1)as RouterGoal
 const requestId='goal-node:'+f.old.id+':'+f.old.nodes![0]!.id
 const assigned=await f.host.manager.call({action:'assign',id:'one',revision:0,requestId,text:'Persisted assignment from first resume'},{discussion:'local:topic',trigger:r1.trigger,scoped:r1})
 const r2=f.context('Resume this goal again'),again=f.host.goals.command({action:'resume',id:f.old.id,operationId:'resume-2',expectedRevision:resumed.revision},r2)as RouterGoal
 expect(again.taskIds).toEqual([]);expect(f.host.goals.taskIdsForGoal(again)).toContain(assigned.ticketId)
 const key=stableDigest([r1.route.scopeId,r1.route.entryId,r1.actor,'resume-1']),receipt=f.host.store.get<any>('goal-receipt',key)
 f.host.store.put('goal-receipt',key,{...receipt,entryId:'unrelated'});expect(f.host.goals.taskIdsForGoal(again)).toEqual([])
 f.host.store.put('goal-receipt',key,receipt)
 f.host.goals.command({...f.replacement,supersedes:{goalId:again.id,expectedRevision:again.revision}},f.corrected)
 expect(f.host.store.tickets.get(assigned.ticketId)?.ended?.by).toBe('human')
 expect(f.host.goals.get(again.id)?.taskIds).toContain(assigned.ticketId)
 f.host.store.put('router-reply-owner','late-resume-reply',{discussion:'local:topic',triggerId:r1.trigger.id,inputs:[r1.trigger.id],manifests:[]})
 f.host.store.outbox.send({id:'late-resume-reply',kind:'reply',text:'Must not publish old resume result',channel:r1.trigger.channel!})
 await f.host.flush()
 expect(f.host.store.deliveries().find(d=>d.id==='late-resume-reply')?.status).toBe('dropped')
 expect(()=>f.host.goals.beforeTurn(r1.trigger.id)).toThrow('replaced')
 expect(()=>f.host.goals.toolAllowed(r1.trigger.id,'worker_manage',{action:'assign'})).toThrow('no longer accepts')
})
