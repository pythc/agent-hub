import {mkdtempSync,rmSync,writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterEach,expect,it} from 'vitest'
import {Runtime} from '../src/runtime.ts'
import {configSchema} from '../src/config.ts'
import type {Model} from '../src/model.ts'
import type {RouterGoal} from '../src/router-goals.ts'
import type {VerificationRound} from '../src/goal-verification.ts'
import {previewTaskAssignment,validateTaskAssignment} from '../src/task-assignment-contract.ts'
import {stableDigest} from '../src/sources.ts'

const roots:string[]=[],hosts:Runtime[]=[]
afterEach(async()=>{for(const h of hosts.splice(0))await h.close();for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true})})

it('dispatches against real independent acceptance and refuses the dependency after its evidence changes',async()=>{
 const root=mkdtempSync(join(tmpdir(),'assignment-dependency-'));roots.push(root)
 let serial=0,verified=0,workers=0
 const model:Model={async run(r){
  const threadId=r.threadId??'dependency-thread-'+(++serial),turnId='dependency-turn-'+(++serial)
  r.onThread?.(threadId);r.onTurn?.(turnId)
  const input=JSON.parse(r.input)
  let output:unknown
  if(input.kind==='goal_verification'){
   // Exercise the real verifier protocol and evidence-read gate. No round or
   // node state is written by this fixture.
   for(const evidence of input.evidence)await r.onTool!('goal_evidence',{id:evidence.id},'read-'+evidence.id)
   verified++
   output={checks:input.criteria.map((criterion:any)=>({criterionId:criterion.id,verdict:'passed',explanation:'Read the independently retained evidence',evidenceIds:input.evidence.filter((e:any)=>criterion.id==='__goal__'||e.criterionIds.includes(criterion.id)).map((e:any)=>e.id)}))}
  }else if(r.role==='worker'){
   workers++;writeFileSync(join(r.cwd,'interface.json'),'{"version":1}')
   output={state:'ready',summary:'Interface prepared',reply:'Interface prepared',question:null,askedBy:null,handbacks:[]}
  }else output={reply:''}
  return {threadId,turnId,text:JSON.stringify(output)}
 }}
 const config=configSchema.parse({stateDir:join(root,'state'),acceptMode:'auto',work:{sandboxDriver:'disabled',autoRecover:false},execution:{router:{mode:'host'},management:{enabled:true,maxWorkers:2},workers:[{id:'producer',backend:'codex'},{id:'consumer',backend:'codex'}]},sources:[{id:'local',kind:'local',cwd:root,workspace:{mode:'source'},allowedActors:['alice']}]})
 const host=new Runtime(config,{model});hosts.push(host)
 host.scopes.command({action:'scope.put',operationId:'scope',expectedRevision:0,scope:{id:'team',tenantId:'org',name:'Team',contextBytes:128000,managers:[JSON.stringify(['local','alice'])],workerIds:['producer','consumer'],sourceIds:['local'],backendIds:['codex']}})
 host.scopes.command({action:'entry.bind',operationId:'entry',expectedRevision:0,scopeId:'team',sourceId:'local',accountNamespace:'local',nativeId:'topic',history:'group'})
 const received=host.receive('local','alice',{id:'request',thread:'topic',scope:'topic',text:'Continuously prepare and independently verify an interface, then analyze its compatibility. Never deploy.',addressed:true}) as {triggerId:string}
 const context=host.scopes.context(host.store.triggers.get(received.triggerId)!,'local:topic')!
 const initial=host.goals.command({action:'start',operationId:'goal',expectedRevision:0,objective:'Prepare the interface',authorizationQuote:'Continuously prepare and independently verify',maxReplans:0,criteria:[{id:'interface',description:'Interface version is 1',check:{kind:'json_equals',path:'interface.json',pointer:'/version',expected:1}}],nodes:[{id:'produce',title:'Produce interface',instruction:'Prepare interface.json with version 1',workerId:'producer',criterionIds:['interface']}]},context) as RouterGoal
 for(let i=0;i<1000&&host.goals.get(initial.id)?.state!=='completed';i++){await host.tick();await new Promise(r=>setTimeout(r,2))}
 const goal=host.goals.get(initial.id)!
 expect(goal.state).toBe('completed');expect(workers).toBe(1);expect(verified).toBeGreaterThan(0)
 const node=goal.nodes![0]!,ticket=host.store.tickets.get(node.ticketId!)!,assignmentId=ticket.assignments.at(-1)!.id
 const round=host.store.get<VerificationRound>('goal-verification',node.roundId!)!
 expect(node.state).toBe('passed');expect(round.state).toBe('passed');expect(host.verification.current(round,goal,{readOnly:true})).toBe(true)
 const spec={dependsOn:[{ticketId:ticket.id,assignmentId}]},routerContext={discussion:'local:topic',trigger:context.trigger,scoped:context}
 const preview=previewTaskAssignment(host,'consumer',routerContext,spec)
 expect(preview.dependencies).toEqual([{ticketId:ticket.id,assignmentId,roundId:round.id,digest:stableDigest(round)}])
 const dispatched=await host.manager.call({action:'assign',id:'consumer',requestId:'dependent',revision:host.settings.current().revision,text:'Analyze the independently accepted interface',assignment:spec},routerContext)
 expect(validateTaskAssignment(host,dispatched.ticketId)?.dependencies).toEqual(preview.dependencies)
 expect(host.store.jobs().some(j=>(j.payload as any).ticketId===dispatched.ticketId)).toBe(true)
 // Alter the actual artifact, not the saved verdict. The passed historical
 // round stays intact while its current-evidence validity becomes false.
 writeFileSync(join(root,'interface.json'),'{"version":2}')
 expect(host.store.get<VerificationRound>('goal-verification',round.id)?.state).toBe('passed')
 expect(host.verification.current(round,goal,{readOnly:true})).toBe(false)
 expect(()=>previewTaskAssignment(host,'consumer',routerContext,spec)).toThrow('dependency_not_independently_accepted')
 expect(()=>validateTaskAssignment(host,dispatched.ticketId)).toThrow('dependency_not_independently_accepted')
 const count=host.store.tickets.list().length
 await expect(host.manager.call({action:'assign',id:'consumer',requestId:'invalid-dependent',revision:host.settings.current().revision,text:'Must not dispatch stale dependency',assignment:spec},routerContext)).rejects.toThrow('dependency_not_independently_accepted')
 expect(host.store.tickets.list()).toHaveLength(count)
})
