import {afterEach,expect,it,vi} from 'vitest'
import {mkdtempSync,rmSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {Runtime} from '../src/runtime.ts'
import {configSchema} from '../src/config.ts'
import {taskDecisionsView} from '../src/task-decisions-view.ts'
import {serve} from '../src/server.ts'
import {operatorTask} from '../src/operator-workspace.ts'
const roots:string[]=[],hosts:Runtime[]=[],servers:Awaited<ReturnType<typeof serve>>[]=[]
afterEach(async()=>{vi.restoreAllMocks();for(const s of servers.splice(0)){s.server.closeAllConnections();await new Promise<void>(r=>s.server.close(()=>r()))}for(const h of hosts.splice(0))await h.close();for(const path of roots.splice(0))rmSync(path,{force:true,recursive:true})})
async function fixture(secondManager=false){
 const root=mkdtempSync(join(tmpdir(),'task-decisions-'));roots.push(root)
 const model={run:vi.fn(async()=>{throw Error('No model call allowed')}),history:vi.fn(async()=>{throw Error('No history call allowed')})}
 const h=new Runtime(configSchema.parse({stateDir:join(root,'state'),port:0,watchdog:{enabled:false},work:{sandboxDriver:'disabled',network:false,autoRecover:false},execution:{router:{mode:'host'},management:{enabled:true,maxWorkers:1},workers:[{id:'one',backend:'codex'}]},sources:[{id:'local',kind:'local',cwd:root,workspace:{mode:'source'},allowedActors:['alice','bob']}]}),{model});hosts.push(h);h.pause(true)
 h.scopes.command({action:'scope.put',operationId:'scope',expectedRevision:0,scope:{id:'team',tenantId:'local',name:'Team',managers:[JSON.stringify(['local','alice']),...(secondManager?[JSON.stringify(['local','bob'])]:[])],workerIds:['one'],sourceIds:['local'],backendIds:['codex']}})
 for(const nativeId of ['topic','other'])h.scopes.command({action:'entry.bind',operationId:nativeId,expectedRevision:0,scopeId:'team',sourceId:'local',accountNamespace:'local',nativeId,history:'group'})
 let sequence=0
 function receive(text:string,actor='alice',thread='topic'){
  const result=h.receive('local',actor,{id:'request-'+(++sequence),thread,scope:thread,text,addressed:true})as{triggerId:string},trigger=h.store.triggers.get(result.triggerId)!,context=h.scopes.context(trigger,'local:'+thread)!
  h.continuity.capture(context,[trigger.id]);const packet=h.memory.build(context,{request:text},'codex');return{trigger,context,packet}
 }
 const initial=receive('Please analyze the local note. You could consider adding a chart; do not deploy.')
 const assigned=await h.manager.call({action:'assign',id:'one',revision:h.settings.current().revision,requestId:'assign',text:'Analyze the local note'},{discussion:initial.context.route.discussion,trigger:initial.trigger,scoped:initial.context,manifest:initial.packet.manifest})
 const id=assigned.ticketId
 function record(kind:'requirement'|'decision'|'commitment',text:string,input=initial,op='record-'+(++sequence)){
  return h.continuity.command({action:'record',operationId:op,kind,text,sourceIds:[input.trigger.id]},input.context,input.packet.manifest)
 }
 const requirement=record('requirement','You could consider adding a chart; do not deploy.'),decision=record('decision','Compare two chart options before making a recommendation.')
 return{h,model,root,id,initial,requirement,decision,receive,record,read:()=>taskDecisionsView(h,id,1234)}
}
function db(h:Runtime){return JSON.stringify(h.store.db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(row=>{const name=String(row.name);return[name,h.store.db.prepare('SELECT * FROM "'+name.replaceAll('"','""')+'"').all()]}))}
it('shows current records through the real admitted-input/capture/build/manager.assign path without promoting a suggestion',async()=>{
 const f=await fixture(),view=f.read()!
 expect(view).toMatchObject({schema:3,readOnly:true,subject:{kind:'task',id:f.id},observedAt:1234,more:false})
 expect(view.items).toHaveLength(2)
 for(const item of view.items){expect(item.confirmation).toBe('not_recorded');expect(item.sources).toEqual([{speaker:'user',text:f.initial.trigger.text,recordedAt:expect.any(Number)}]);expect(item).not.toHaveProperty('executed');expect(item).not.toHaveProperty('approved')}
 expect(view.items.find(item=>item.kind==='requirement')?.text).toContain('could consider')
 const text=JSON.stringify(view);for(const hidden of ['triggerIds','eventIds','scopeId','contextId','assignmentId','actor','supersededBy','operationId'])expect(text).not.toContain('"'+hidden+'"')
 expect(f.model.run).not.toHaveBeenCalled();expect(f.model.history).not.toHaveBeenCalled()
})
it('keeps explicit replacement and original words after a real same-task manager.send input revision',async()=>{
 const f=await fixture(),next=f.receive('Use a table instead of a chart. Still do not deploy.')
 await f.h.manager.call({action:'send',ticketId:f.id,revision:f.h.settings.current().revision,requestId:'followup',text:'Use a table instead of a chart.'},{discussion:next.context.route.discussion,trigger:next.trigger,scoped:next.context,manifest:next.packet.manifest})
 f.h.continuity.command({action:'supersede',operationId:'replace',kind:'decision',text:'Use a table instead of a chart.',sourceIds:[next.trigger.id],supersedes:f.decision.id},next.context,next.packet.manifest)
 const view=f.read()!,item=view.items.find(item=>item.kind==='decision')!
 expect(item.text).toBe('Use a table instead of a chart.');expect(item.previous?.text).toBe(f.decision.text);expect(item.previous?.sources[0]?.text).toBe(f.initial.trigger.text);expect(item.sources[0]?.text).toBe(next.trigger.text);expect(item.confirmation).toBe('not_recorded')
 expect(view.items.some(item=>item.text===f.decision.text)).toBe(false)
})
it('leaves all tables, total_changes and existing pending approvals unchanged on repeated reads',async()=>{
 const f=await fixture();void f.h.approvals.request(f.id,{id:'request',method:'item/commandExecution/requestApproval',params:{command:'Local only'}}).catch(()=>{})
 const before=db(f.h),changes=f.h.store.db.prepare('SELECT total_changes() AS n').get()!.n,pending=[...(f.h.approvals as any).pending]
 expect(f.read()!.items).toHaveLength(2);expect(f.read()!.items).toHaveLength(2)
 expect(db(f.h)).toBe(before);expect(f.h.store.db.prepare('SELECT total_changes() AS n').get()!.n).toBe(changes);expect([...(f.h.approvals as any).pending]).toEqual(pending);expect(f.model.run).not.toHaveBeenCalled()
})
it.each(['missing route','stale binding','stale epoch','held owner','foreign owner subject','stale owner epoch','stale data revision','foreign context actor','foreign context key','missing context','missing global context','source disabled','actor revoked','private entry','continuation','changed routing','foreign ticket key','cancelled parent'])('hides %s without repairing records or granting permission',async mutation=>{
 const f=await fixture(),s=f.h.store,owner=f.h.scopes.ownership(f.id)!,context=s.get<any>('task-context',f.id),route=s.get<any>('router-route',f.initial.trigger.id)
 if(mutation==='missing route')s.db.prepare("DELETE FROM records WHERE kind='router-route' AND id=?").run(f.initial.trigger.id)
 if(mutation==='stale binding')s.put('router-route',f.initial.trigger.id,{...route,bindingRevision:999})
 if(mutation==='stale epoch')s.put('router-route',f.initial.trigger.id,{...route,epoch:999})
 if(mutation==='held owner')s.put('task-ownership',f.id,{...owner,state:'held'})
 if(mutation==='foreign owner subject')s.put('task-ownership',f.id,{...owner,ticketId:'another'})
 if(mutation==='stale owner epoch')s.put('task-ownership',f.id,{...owner,ownerEpoch:owner.ownerEpoch+1})
 if(mutation==='stale data revision')s.put('task-ownership',f.id,{...owner,dataRevision:99})
 if(mutation==='foreign context actor')s.put('task-context',f.id,{manifest:{...context.manifest,actor:'another'}})
 if(mutation==='foreign context key')s.put('context-manifest',context.manifest.id,{...s.get<any>('context-manifest',context.manifest.id),id:'another'})
 if(mutation==='missing context')s.db.prepare("DELETE FROM records WHERE kind='task-context' AND id=?").run(f.id)
 if(mutation==='missing global context')s.db.prepare("DELETE FROM records WHERE kind='context-manifest' AND id=?").run(context.manifest.id)
 if(mutation==='source disabled')f.h.config.sources[0]!.enabled=false
 if(mutation==='actor revoked')f.h.config.sources[0]!.allowedActors=[]
 if(mutation==='private entry')s.put('entry-binding',owner.originEntry,{...f.h.scopes.binding(owner.originEntry),privateActor:'alice'})
 if(mutation==='continuation')s.put('task-continuation',f.id,{triggerId:f.initial.trigger.id,discussion:'local:topic'})
 if(mutation==='changed routing')s.put('task-routing',f.id,{discussion:'other'})
 if(mutation==='foreign ticket key')s.put('ticket',f.id,{...s.tickets.get(f.id),id:'another'})
 if(mutation==='cancelled parent')s.put('router-cancelled',f.initial.trigger.id,{at:1})
 const before=db(f.h),changes=s.db.prepare('SELECT total_changes() AS n').get()!.n
 expect(f.read()).toBeUndefined();expect(db(f.h)).toBe(before);expect(s.db.prepare('SELECT total_changes() AS n').get()!.n).toBe(changes);expect(f.model.run).not.toHaveBeenCalled()
})
it.each(['forged user text','foreign event key','foreign commitment key','forged receipt','missing receipt','missing derived context','secret quote','source cleanup'])('omits invalid derived text for %s rather than falling back to a summary',async mutation=>{
 const f=await fixture(),s=f.h.store,event=s.list<any>('router-journal')[0],decision=f.decision
 if(mutation==='forged user text')s.put('router-journal',event.id,{...event,text:'FORGED_UNSEEN_SOURCE'})
 if(mutation==='foreign event key')s.put('router-journal',event.id,{...event,id:'another'})
 if(mutation==='foreign commitment key')s.put('router-commitment',decision.id,{...decision,id:'another'})
 if(mutation==='forged receipt')s.put('journal-receipt',decision.id.slice('commitment:'.length),{result:{...decision,text:'different'}})
 if(mutation==='missing receipt')s.db.prepare("DELETE FROM records WHERE kind='journal-receipt' AND id=?").run(decision.id.slice('commitment:'.length))
 if(mutation==='missing derived context'){
  const v={...decision};delete v.contextId;s.put('router-commitment',v.id,v);s.put('journal-receipt',v.id.slice('commitment:'.length),{result:v})
 }
 if(mutation==='secret quote'){
  const t=s.triggers.get(f.initial.trigger.id)!;s.triggers.save({...t,text:'password=synthetic-secret-value'});s.put('router-journal',event.id,{...event,text:'password=synthetic-secret-value'})
 }
 if(mutation==='source cleanup')s.put('history-plan','synthetic-cleanup',{id:'synthetic-cleanup',roots:[f.initial.trigger.id],records:[['trigger',f.initial.trigger.id]]})
 const before=db(f.h),value=f.read();expect(value?.items.some(item=>item.text===decision.text)).not.toBe(true);expect(JSON.stringify(value??null)).not.toContain('FORGED_UNSEEN_SOURCE');expect(db(f.h)).toBe(before)
})
it('does not attach unrelated same-conversation, other-actor or other-entry records to this task',async()=>{
 const f=await fixture()
 for(const [actor,thread]of [['alice','topic'],['bob','topic'],['alice','other']]){const input=f.receive('Unrelated private note for '+actor+' '+thread,actor,thread);f.record('decision','UNRELATED_RECORD_'+actor+'_'+thread,input)}
 expect(f.read()!.items).toHaveLength(2);expect(JSON.stringify(f.read())).not.toContain('UNRELATED_RECORD')
})
it('limits only validated related records and keeps the more flag independent of hidden rows',async()=>{
 const f=await fixture();for(let i=0;i<5;i++)f.record('decision','Related choice '+i)
 const view=f.read()!;expect(view.items).toHaveLength(5);expect(view.more).toBe(true)
 const foreign=f.receive('Different entry','alice','other');for(let i=0;i<20;i++)f.record('decision','HIDDEN_RECORD_'+i,foreign)
 expect(f.read()).toEqual(view)
})
it('requires the original receipt and visible predecessor for an exact replacement edge',async()=>{
 const f=await fixture(),next=f.receive('Use a table instead of a chart.')
 const current=f.h.continuity.command({action:'supersede',operationId:'replace',kind:'decision',text:'Use a table.',sourceIds:[next.trigger.id],supersedes:f.decision.id},next.context,next.packet.manifest)
 expect(f.read()!.items.find(item=>item.text===current.text)?.previous?.text).toBe(f.decision.text)
 const old=f.h.store.get<any>('router-commitment',f.decision.id)!;f.h.store.put('router-commitment',old.id,{...old,actor:'foreign-actor'})
 // The current item has no direct task anchor here; an unverifiable edge cannot attach it.
 expect(f.read()!.items.some(item=>item.text===current.text)).toBe(false)
})
it('shows an assistant source only after the actual Router job/result/reply-owner path and hides it when owner provenance is removed',async()=>{
 const f=await fixture()
 f.model.run.mockImplementation(async(request?:any)=>{request?.onThread?.('local-router-session');return{threadId:'local-router-session',turnId:'local-router-turn',text:JSON.stringify({reply:'Compare the local chart options first.'})}as never})
 f.h.store.db.prepare("UPDATE jobs SET state='done' WHERE kind='execute'").run();f.h.pause(false)
 for(let i=0;i<100&&!f.h.store.list('router-result').length;i++){await f.h.tick();await new Promise(r=>setTimeout(r,2))}
 f.h.pause(true)
 const event=f.h.store.list<any>('router-journal').find(e=>e.kind==='router')!;expect(event).toBeDefined()
 f.h.continuity.command({action:'record',operationId:'assistant-derived',kind:'decision',text:'The assistant proposed comparing local options.',sourceIds:[event.id]},f.initial.context,f.initial.packet.manifest)
 expect(f.read()!.items.find(item=>item.text==='The assistant proposed comparing local options.')?.sources).toEqual([{speaker:'assistant',text:event.text,recordedAt:event.at}])
 f.h.store.db.prepare("DELETE FROM records WHERE kind='router-reply-owner'").run()
 expect(f.read()!.items.some(item=>item.text==='The assistant proposed comparing local options.')).toBe(false)
 expect(f.model.run).toHaveBeenCalledTimes(1)
})
it('keeps protected task GET authorization, nested read-only fences and original action flags',async()=>{
 const f=await fixture(),server=await serve(f.h);servers.push(server);clearInterval((f.h as any).timer)
 const path=server.url+'/entry-workspace/task/'+encodeURIComponent(f.id),headers={authorization:'Bearer '+readFileSync(server.tokenPath,'utf8').trim()}
 expect((await fetch(path)).status).toBe(401)
 const baseline=operatorTask(f.h,f.id)!,before=db(f.h),changes=f.h.store.db.prepare('SELECT total_changes() AS n').get()!.n
 for(let i=0;i<2;i++){const response=await fetch(path,{headers});expect(response.status).toBe(200);const task=await response.json()as any;expect(task.decisionRecords.items).toHaveLength(2);expect(task.canStop).toBe(baseline.canStop);expect(task.canRetry).toBe(baseline.canRetry)}
 expect(db(f.h)).toBe(before);expect(f.h.store.db.prepare('SELECT total_changes() AS n').get()!.n).toBe(changes);expect(f.model.run).not.toHaveBeenCalled()
})
it('rejects a changed original association even when a later valid routing record exists',async()=>{
 const f=await fixture(),next=f.receive('Continue analyzing locally.')
 await f.h.manager.call({action:'send',ticketId:f.id,revision:f.h.settings.current().revision,requestId:'followup',text:'Continue local analysis.'},{discussion:next.context.route.discussion,trigger:next.trigger,scoped:next.context,manifest:next.packet.manifest})
 expect(f.read()).toBeDefined()
 const other=f.receive('An unrelated task in the same conversation.'),association=f.h.store.get<any>('worker-assignment',f.id)
 f.h.store.put('worker-assignment',f.id,{...association,parentTrigger:other.trigger.id})
 const before=db(f.h);expect(f.read()).toBeUndefined();expect(db(f.h)).toBe(before)
})
it('rejects original-parent redirection to an unrelated canonical same-conversation input before any routing exists',async()=>{
 const f=await fixture(),other=f.receive('Unrelated topic in the same conversation.')
 f.record('decision','UNRELATED_REDIRECTED_RECORD',other)
 const association=f.h.store.get<any>('worker-assignment',f.id)
 f.h.store.put('worker-assignment',f.id,{...association,parentTrigger:other.trigger.id})
 const before=db(f.h);expect(f.read()).toBeUndefined();expect(db(f.h)).toBe(before)
})
it('keeps a three-version replacement history and original suggestions without inferring approval or execution',async()=>{
 const f=await fixture();let prior=f.decision
 for(const [i,words]of ['Use a table, not a chart.','Only analyze the table; do not implement.'].entries()){
  const next=f.receive(words)
  await f.h.manager.call({action:'send',ticketId:f.id,revision:f.h.settings.current().revision,requestId:'history-'+i,text:words},{discussion:next.context.route.discussion,trigger:next.trigger,scoped:next.context,manifest:next.packet.manifest})
  prior=f.h.continuity.command({action:'supersede',operationId:'history-'+i,kind:'decision',text:words,sourceIds:[next.trigger.id],supersedes:prior.id},next.context,next.packet.manifest)
 }
 const row=f.read()!.items.find(v=>v.text===prior.text)!
 expect(row.history.map(v=>v.text)).toEqual(['Use a table, not a chart.',f.decision.text]);expect(row.historyMore).toBe(false)
 expect(row.history[1]!.sources[0]!.text).toContain('could consider');expect(row.confirmation).toBe('not_recorded');expect(row.execution).toBe('not_recorded')
 const server=await serve(f.h);servers.push(server);clearInterval((f.h as any).timer)
 const response=await fetch(server.url+'/entry-workspace/task/'+f.id,{headers:{authorization:'Bearer '+readFileSync(server.tokenPath,'utf8').trim()}})
 expect(response.status).toBe(200);expect((await response.json()as any).decisionRecords.items.find((v:any)=>v.text===prior.text).history).toEqual(row.history)
 // Removing an original source removes that historical body, without resurrecting it from a newer summary.
 const event=f.h.store.list<any>('router-journal').find(v=>v.triggerIds.includes(f.initial.trigger.id))!
 f.h.store.db.prepare("DELETE FROM records WHERE kind='router-journal' AND id=?").run(event.id)
 expect(JSON.stringify(f.read())).not.toContain('could consider')
 expect(f.model.run).not.toHaveBeenCalled()
})
it('does not turn a forged mutable predecessor pointer into a replacement receipt or task association',async()=>{
 const f=await fixture(),other=f.receive('A different task in this conversation.'),unrelated=f.record('decision','UNRELATED_REDIRECTED_HISTORY',other)
 f.h.store.put('router-commitment',f.decision.id,{...f.decision,active:false,supersededBy:unrelated.id})
 expect(JSON.stringify(f.read())).not.toContain('UNRELATED_REDIRECTED_HISTORY')
})
it('does not infer legacy replacement edges without their atomic command receipt',async()=>{
 const f=await fixture(),next=f.receive('Use the new choice.')
 await f.h.manager.call({action:'send',ticketId:f.id,revision:f.h.settings.current().revision,requestId:'legacy-followup',text:'Use the new choice.'},{discussion:next.context.route.discussion,trigger:next.trigger,scoped:next.context,manifest:next.packet.manifest})
 const item=f.h.continuity.command({action:'supersede',operationId:'legacy-replacement',kind:'decision',text:'New choice.',sourceIds:[next.trigger.id],supersedes:f.decision.id},next.context,next.packet.manifest)
 const key=item.id.slice('commitment:'.length),receipt=f.h.store.get<any>('journal-receipt',key);delete receipt.supersedes;f.h.store.put('journal-receipt',key,receipt)
 const current=f.read()!.items.find(v=>v.text===item.text)!;expect(current.history).toEqual([]);expect(current.previous).toBeUndefined();expect(current.historyMore).toBe(true)
})

it('retains ended task history under unchanged current permissions and hides it after revocation',async()=>{
 const f=await fixture(),assignment=f.h.store.tickets.get(f.id)!.assignments.at(-1)!
 f.h.engine.assignmentStarted(f.id,assignment.id)
 f.h.engine.report(f.id,{state:'ready',summary:'Local analysis finished'})
 expect(f.h.store.tickets.get(f.id)!.ended).toBeDefined()
 const before=db(f.h),view=f.read()!
 expect(view.taskState).toBe('ended');expect(view.items).toHaveLength(2);expect(db(f.h)).toBe(before)
 f.h.config.sources[0]!.allowedActors=[];expect(f.read()).toBeUndefined()
})
async function workflowFixture(){
 const f=await fixture(true),source=f.h.config.sources[0]!,owner=f.h.scopes.ownership(f.id)!,assignment=f.h.store.tickets.get(f.id)!.assignments.at(-1)!
 const target={key:'local-issue',entryId:owner.originEntry,teamId:'local',issueId:'local-issue'}
 source.capabilities.resources=true;source.capabilities.replies=true;source.options={...source.options,statusTargets:[target]}
 const states=[{id:'todo',name:'Todo'},{id:'done',name:'Done'}];let current=states[0]!,revision=1,writes=0,loseReply=false
 const adapter=f.h.sources.get(source.id)!
 adapter.workflowState=async()=>({account:'local',issue:'local-issue',label:'Local fixture issue',revision:String(revision),current,states})
 adapter.applyWorkflowState=async(_target,_view,next,valid)=>{if(valid&&!valid())throw Error('revoked');writes++;current=states.find(s=>s.id===next)!;revision++;if(loseReply)throw Error('fixture response lost');return 'updated'}
 f.h.engine.assignmentStarted(f.id,assignment.id)
 const proposal=await f.h.workflows.request({ticketId:f.id,assignmentId:assignment.id,cwd:f.root,sandbox:'read-only',depth:0},{action:'propose',sourceId:'local',target:target.key,stateId:'done',requestId:'local-only'}) as any
 return{...f,proposal,get writes(){return writes},loseReply(){loseReply=true}}
}
it('projects real local workflow proposal, explicit operator decision and readback separately without promoting journal records',async()=>{
 const f=await workflowFixture()
 expect(f.read()!.operations.items).toMatchObject([{confirmation:'not_recorded',execution:'not_recorded',from:'Todo',to:'Done'}]);expect(f.writes).toBe(0)
 await f.h.workflows.decide({id:f.proposal.id,decision:'approve'},{operatorId:'local-operator',authorize:()=>{}})
 const before=db(f.h),view=f.read()!
 expect(view.operations.items).toMatchObject([{confirmation:'approved',execution:'applied_readback'}]);expect(f.writes).toBe(1);expect(db(f.h)).toBe(before)
 expect(view.items.every(i=>i.confirmation==='not_recorded'&&i.execution==='not_recorded')).toBe(true)
 f.h.config.sources[0]!.options!.statusTargets=[]
 expect(f.read()!.operations.items).toEqual([])
})
it('keeps response-loss unknown and later readback distinct from proof of who applied the change',async()=>{
 const f=await workflowFixture();f.loseReply()
 await f.h.workflows.decide({id:f.proposal.id,decision:'approve'},{operatorId:'local-operator',authorize:()=>{}})
 expect(f.read()!.operations.items).toMatchObject([{confirmation:'approved',execution:'unknown'}]);expect(f.writes).toBe(1)
 await f.h.workflows.decide({id:f.proposal.id,decision:'reconcile'},{operatorId:'local-operator',authorize:()=>{}})
 expect(f.read()!.operations.items).toMatchObject([{confirmation:'approved',execution:'observed_only'}]);expect(f.writes).toBe(1)
})
it('keeps declined proposals separate from execution and rejects missing or foreign evidence',async()=>{
 const f=await workflowFixture()
 await f.h.workflows.decide({id:f.proposal.id,decision:'decline'},{operatorId:'local-operator',authorize:()=>{}})
 expect(f.read()!.operations.items).toMatchObject([{confirmation:'declined',execution:'not_applied'}]);expect(f.writes).toBe(0)
 const value=f.h.store.get<any>('workflow-action',f.proposal.id)
 f.h.store.put('workflow-action',value.id,{...value,state:'applied',decision:{...value.decision,kind:'approve'}})
 expect(f.read()!.operations.items[0]!.execution).toBe('unknown')
 f.h.store.put('workflow-action',value.id,{...value,target:{...value.target,entryId:'foreign'}})
 expect(f.read()!.operations.items).toEqual([])
})

it('retains actual same-entry manager confirmation rather than requiring the task requester',async()=>{
 const f=await workflowFixture(),reply=f.receive('approve '+f.proposal.id.slice(0,16),'bob')
 await f.h.workflows.decideReply(reply.trigger.id)
 expect(f.read()!.operations.items).toMatchObject([{confirmation:'approved',execution:'applied_readback'}]);expect(f.writes).toBe(1)
 f.h.config.sources[0]!.allowedActors=['alice'];expect(f.read()!.operations.items).toEqual([])
})
it.each(['nonmanager','wrong thread','missing notification','wrong reply','source cleanup'])('omits conversational confirmation with invalid %s provenance',async mutation=>{
 const f=await workflowFixture(),reply=f.receive('approve '+f.proposal.id.slice(0,16),'bob')
 await f.h.workflows.decideReply(reply.trigger.id)
 expect(f.read()!.operations.items[0]!.confirmation).toBe('approved')
 if(mutation==='nonmanager'){
  const scope=f.h.store.get<any>('management-scope','team');
  // Scope record key is independent of the command revision; changing only the
  // manager list models lost administrator membership without granting anything.
  if(scope)f.h.store.put('management-scope','team',{...scope,managers:[JSON.stringify(['local','alice'])]})
  else throw Error('fixture scope missing')
 }
 if(mutation==='wrong thread'){const trigger=f.h.store.triggers.get(reply.trigger.id)!;f.h.store.triggers.save({...trigger,channel:{...trigger.channel!,thread:'another-thread'}})}
 if(mutation==='missing notification')f.h.store.put('workflow-action',f.proposal.id,{...f.h.store.get<any>('workflow-action',f.proposal.id),notificationTriggerId:'missing'})
 if(mutation==='wrong reply'){const trigger=f.h.store.triggers.get(reply.trigger.id)!;f.h.store.triggers.save({...trigger,text:'approve '+'0'.repeat(16)})}
 if(mutation==='source cleanup')f.h.store.put('history-plan','synthetic-cleanup',{id:'synthetic-cleanup',roots:[reply.trigger.id],records:[['trigger',reply.trigger.id]]})
 expect(f.read()?.operations.items??[]).toEqual([])
})
it('hides readback with an impossible finish time rather than attributing an earlier effect',async()=>{
 const f=await workflowFixture();await f.h.workflows.decide({id:f.proposal.id,decision:'approve'},{operatorId:'local-operator',authorize:()=>{}})
 const action=f.h.store.get<any>('workflow-action',f.proposal.id)
 f.h.store.put('workflow-action',action.id,{...action,state:'observed',decision:undefined,finishedAt:action.at-1})
 expect(f.read()!.operations.items).toEqual([])
})
