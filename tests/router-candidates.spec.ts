import {afterEach,expect,it} from 'vitest'
import {mkdtempSync,rmSync,writeFileSync,symlinkSync,mkdirSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {randomUUID} from 'node:crypto'
import {Runtime} from '../src/runtime.ts'
import {configSchema} from '../src/config.ts'
import type {ModelRequest,Model} from '../src/model.ts'
import {MessageSource,bodyDigest} from '../src/sources.ts'
import {RouterCandidates} from '../src/router-candidates.ts'
import {returnRouterFollowup,RouterFollowupBatch,reconsiderRouterFollowups} from '../src/router-followups.ts'

const roots:string[]=[],hosts:Runtime[]=[]
afterEach(async()=>{for(const h of hosts.splice(0))await h.close();for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true})})
const accepted={action:'accept',title:'Fix typo',scope:'Correct the documented typo',reason:'Settled small correction',rules:['typo'],targetTicketId:null,ruleAssessments:[{id:'typo',matched:true,reason:'Agreed correction to existing copy'}],direction:{implementation_requested:true,target_basis:'existing-standard',requires_design_decision:false,evidence:'Correct this typo to match the existing label'},intent_evidence:'Change the erroneous label in settings to match the agreed existing spelling'}
const workerReport={state:'ready',summary:'Checked fixture',reply:'',question:null,handbacks:[]}
function fixture(run?:(r:ModelRequest,h:Runtime)=>Promise<unknown>,mode:'auto'|'observe'|'off'='auto'){
 const root=mkdtempSync(join(tmpdir(),'router-candidates-'));roots.push(root)
 const config=configSchema.parse({stateDir:join(root,'state'),port:0,acceptMode:mode,rules:[{id:'typo',instruction:'Fix an agreed typo using existing copy'}],work:{sandboxDriver:'disabled'},execution:{router:{mode:'host'},management:{enabled:true},workers:[{id:'one',backend:'codex'},{id:'two',backend:'codex'}]},sources:[{id:'group',kind:'local',observed:true,allowedActors:['alice','bob'],cwd:root}]})
 const source=new MessageSource(config.sources[0]!),calls:ModelRequest[]=[]
 const model:Model={async run(r:ModelRequest){calls.push(r);const threadId=r.threadId??randomUUID(),turnId=randomUUID();r.onThread?.(threadId);r.onTurn?.(turnId);const value=run?await run(r,h):{reply:''};return {threadId,turnId,text:JSON.stringify(value)}}}
 const h:Runtime=new Runtime(config,{model,sources:[source]});hosts.push(h)
 return {h,config,source,calls,model}
}
const send=(h:Runtime,id:string,text='Please correct this typo',actor='alice',addressed=false)=>h.receive('group',actor,{id,thread:'topic',text,addressed})
const tool=(r:ModelRequest,name:string,args:unknown={})=>r.onTool!(name,args,randomUUID())
const body=(result:Awaited<ReturnType<typeof tool>>)=>JSON.parse(result.contentItems[0]!.text!)
async function settle(h:Runtime,done:()=>boolean){for(let i=0;i<400;i++){await h.tick();await new Promise(r=>setTimeout(r,2));if(done())return}throw Error('Did not settle: '+JSON.stringify(h.store.db.prepare('SELECT id,state,error FROM jobs').all()))}
const finished=(h:Runtime,n=1)=>h.store.list<any>('router-candidate').filter(b=>['complete','failed'].includes(b.phase)).length>=n

it('batches queued candidates in a persistent Router and fast-ignores without fetching context',async()=>{
 const f=fixture(async r=>{expect(r.ephemeral).not.toBe(true);const input=JSON.parse(r.input);expect(input.candidates).toHaveLength(3);expect(input.candidates[0].text.length).toBeLessThanOrEqual(161);expect(r.tools?.map(t=>t.name)).toContain('orchestrator_eval');expect((await tool(r,'worker_manage',{action:'list'})).success).toBe(false);expect((await tool(r,'orchestrator_route',{reason:'Casual conversation'})).success).toBe(true);return {reply:'This must never be sent'}})
 send(f.h,'1','Hello'.repeat(100));send(f.h,'2','Lunch?');send(f.h,'3','Yes')
 await settle(f.h,()=>finished(f.h));expect(f.calls).toHaveLength(1);expect(f.h.store.tickets.list()).toHaveLength(0);expect(f.h.store.deliveries()).toHaveLength(0)
 expect(f.h.store.list<any>('router-admission').every(a=>a.state==='ignored')).toBe(true)
})

it('evaluates and delegates in the same Router turn, then resumes that Router for Worker results',async()=>{
 const f=fixture(async r=>{
  if(r.role==='worker')return {...workerReport,reply:'Fixture evidence'}
  const input=JSON.parse(r.input)
  if(input.kind==='proactive_candidates'){
   expect((await tool(r,'orchestrator_eval')).success).toBe(true)
   expect(body(await tool(r,'orchestrator_eval_decide',accepted)).state).toBe('accepted')
   expect((await tool(r,'worker_manage',{action:'assign',revision:0,requestId:'fix',id:'one',text:accepted.scope})).success).toBe(true)
   return {reply:''}
  }
  expect(input.kind).toBe('worker_result');return {reply:'Router checked the result'}
 })
 send(f.h,'1');await settle(f.h,()=>f.h.store.deliveries().some(d=>d.text==='Router checked the result'))
 expect(f.calls.map(r=>r.role)).toEqual(['router','worker','router']);expect(f.calls[2]!.threadId).toBe(f.h.store.list<any>('router-session')[0].threadId)
 expect(f.h.store.tickets.list()).toHaveLength(1);expect(f.h.store.deliveries().filter(d=>!d.channel.address.routerInbox).map(d=>d.text)).toEqual(['Router checked the result'])
})

it.each(['observe','off'] as const)('%s never delegates or replies to unmentioned chatter',async mode=>{
 const f=fixture(async r=>{expect(body(await tool(r,'orchestrator_eval_decide',accepted)).state).toBe('observed');expect((await tool(r,'worker_manage',{action:'assign',id:'one',revision:0,requestId:'no',text:'Do work'})).success).toBe(false);return {reply:'I will take over'}},mode)
 send(f.h,'1');if(mode==='off'){await f.h.tick();expect(f.calls).toHaveLength(0)}else await settle(f.h,()=>finished(f.h))
 expect(f.h.store.tickets.list()).toHaveLength(0);expect(f.h.store.deliveries()).toHaveLength(0)
})

it.each([{implementation_requested:false},{target_basis:'undetermined'},{requires_design_decision:true}])('keeps unsettled intent quiet: %j',async patch=>{
 const f=fixture(async r=>{expect(body(await tool(r,'orchestrator_eval_decide',{...accepted,direction:{...accepted.direction,...patch}})).state).toBe('ignored');return {reply:'Should I take over?'}})
 send(f.h,'1');await settle(f.h,()=>finished(f.h));expect(f.h.routerIngress.get('group:1')?.reason).toBe('implementationIntentUnsettled');expect(f.h.store.deliveries()).toHaveLength(0)
})

it('fails closed on missing direction evidence or incomplete rule coverage',async()=>{
 const f=fixture(async r=>{
  const {direction,...missing}=accepted
  expect((await tool(r,'orchestrator_eval_decide',missing)).success).toBe(false)
  expect((await tool(r,'orchestrator_eval_decide',{...accepted,ruleAssessments:[]})).success).toBe(false)
  return {reply:'Done'}
 })
 send(f.h,'1');await settle(f.h,()=>finished(f.h));expect(f.h.routerIngress.get('group:1')?.state).toBe('unavailable');expect(f.h.store.tickets.list()).toHaveLength(0);expect(f.h.store.deliveries()).toHaveLength(0)
})

it('retains multiple participants as bounded evidence without mixing their invocation identities',async()=>{
 const f=fixture(async r=>{
  const input=JSON.parse(r.input),context=body(await tool(r,'orchestrator_eval'))
  expect(new Set(input.candidates.map((c:any)=>c.actor.id)).size).toBe(1)
  expect(new Set([...context.triggers,...context.window].map((t:any)=>t.actor.id))).toEqual(new Set(['alice','bob']))
  expect(JSON.stringify(context).length).toBeLessThan(12000)
  await tool(r,'orchestrator_route',{reason:'Still discussing'});return {reply:''}
 })
 send(f.h,'1','Problem '.repeat(3000),'alice');send(f.h,'2','Proposal '.repeat(3000),'bob')
 await settle(f.h,()=>finished(f.h,2));expect(f.calls).toHaveLength(2);expect(f.calls[1]!.threadId).toBe(f.h.store.list<any>('router-session')[0].threadId)
 expect(f.calls.map(r=>r.principal?.actor)).toEqual(['alice','bob'])
})

it('pages full evidence and sends actual source images, with one read per resource',async()=>{
 let reads=0
 const f=fixture(async r=>{
  const first=body(await tool(r,'orchestrator_eval_read',{resource:'message',limit:100}));expect(first.nextOffset).toBe(100)
  const rest=body(await tool(r,'orchestrator_eval_read',{resource:'message',offset:100,limit:100}));expect(rest.offset).toBe(100)
  for(let i=0;i<2;i++){const image=await tool(r,'orchestrator_eval_read',{resource:'image/img_fixture'});expect(image.contentItems).toEqual([{type:'inputImage',imageUrl:'data:image/png;base64,aW1hZ2U='}])}
  await tool(r,'orchestrator_route',{reason:'No change requested'});return {reply:''}
 })
 ;(f.source as any).read=async()=>{reads++;return {kind:'image',mimeType:'image/png',data:'aW1hZ2U='}}
 send(f.h,'1','Screenshot '.repeat(100));await settle(f.h,()=>finished(f.h));expect(reads).toBe(1)
})

it('cannot turn failed evidence into an ignore decision or read outside the discussion',async()=>{
 const f=fixture(async r=>{
  expect((await tool(r,'orchestrator_eval_read',{triggerId:'group:other'})).success).toBe(false)
  expect((await tool(r,'orchestrator_eval_read',{resource:'settings'})).success).toBe(false)
  expect((await tool(r,'orchestrator_eval_read',{resource:'image/missing'})).success).toBe(false)
  expect((await tool(r,'orchestrator_route',{reason:'Could not see image'})).success).toBe(false)
  return {reply:''}
 })
 ;(f.source as any).read=async()=>{throw Error('Source unavailable')}
 send(f.h,'1');await settle(f.h,()=>finished(f.h));expect(f.h.routerIngress.get('group:1')?.state).toBe('unavailable')
})

it('does not promote later unmentioned chatter to explicit authority merely because a Router session exists',async()=>{
 const f=fixture(async r=>{if(JSON.parse(r.input).kind==='proactive_candidates')await tool(r,'orchestrator_route',{reason:'Unrelated chatter'});return {reply:''}})
 send(f.h,'1','Hello','alice',true);await settle(f.h,()=>f.h.store.list('router-result').length===1)
 send(f.h,'2','Maybe redesign it someday');expect(f.h.routerIngress.get('group:2')?.state).toBe('pending')
 await settle(f.h,()=>finished(f.h));expect(f.calls[1]!.threadId).toBe(f.h.store.list<any>('router-session')[0].threadId)
})

it('reads configured repository evidence with paging and rejects state, hidden files and symlink escapes',async()=>{
 const f=fixture(async r=>{
  const file=body(await tool(r,'orchestrator_eval_read',{resource:'repository/file/label.txt',limit:8}));expect(file.text).toBe('Existing');expect(file.nextOffset).toBe(8)
  for(const resource of ['repository/file/../outside','repository/file/.env','repository/file/escape','repository/file/state/secret'])expect((await tool(r,'orchestrator_eval_read',{resource})).success).toBe(false)
  return {reply:''}
 })
 writeFileSync(join(f.source.config.cwd,'label.txt'),'Existing correct label');writeFileSync(join(f.config.stateDir,'secret'),'private');writeFileSync(join(f.source.config.cwd,'.env'),'private');symlinkSync(join(f.config.stateDir,'secret'),join(f.source.config.cwd,'escape'))
 send(f.h,'1');await settle(f.h,()=>finished(f.h));expect(f.h.store.deliveries()).toHaveLength(0)
})

it('queues arrivals during an active turn and batches them into the next turn without concurrent writers',async()=>{
 let release!:()=>void,entered=false,active=0,max=0
 const wait=new Promise<void>(r=>{release=r})
 const f=fixture(async r=>{max=Math.max(max,++active);if(!entered){entered=true;await wait}else expect(JSON.parse(r.input).candidates).toHaveLength(2);await tool(r,'orchestrator_route',{reason:'Chatter'});active--;return {reply:''}})
 send(f.h,'1');await settle(f.h,()=>entered);send(f.h,'2');send(f.h,'3');await f.h.tick();expect(f.calls).toHaveLength(1);release()
 await settle(f.h,()=>finished(f.h,2));expect(max).toBe(1);expect(f.calls).toHaveLength(2)
})

it('cancels a whole active candidate batch when any member is cancelled',async()=>{
 let entered=false
 const f=fixture(async r=>{entered=true;await new Promise<void>(resolve=>r.signal!.addEventListener('abort',()=>resolve(),{once:true}));expect((await tool(r,'orchestrator_eval_decide',accepted)).success).toBe(false);return {reply:'Late reply'}})
 send(f.h,'1');send(f.h,'2');await settle(f.h,()=>entered);await f.h.cancelRouter('group:2','group:topic')
 expect(f.h.store.tickets.list()).toHaveLength(0);expect(f.h.store.deliveries()).toHaveLength(0);expect(f.h.store.db.prepare("SELECT state FROM jobs WHERE kind='router-admit'").all().every(j=>j.state==='cancelled')).toBe(true)
})

it('invalidates in-flight policy snapshots and reassesses under the new mode',async()=>{
 let changed=false
 const f=fixture(async(r,h)=>{if(!changed){changed=true;h.config.acceptMode='observe';expect((await tool(r,'orchestrator_eval_decide',accepted)).success).toBe(false)}else expect(body(await tool(r,'orchestrator_eval_decide',accepted)).state).toBe('observed');return {reply:'Not publishable'}})
 send(f.h,'1');await settle(f.h,()=>f.h.routerIngress.get('group:1')?.state==='observed'&&finished(f.h,2));expect(f.h.store.deliveries()).toHaveLength(0)
})

it('recovers a claimed old job after restart without a temporary assessor or duplicate admission job',async()=>{
 const f=fixture(async r=>{await tool(r,'orchestrator_route',{reason:'Recovered chatter'});return {reply:''}})
 send(f.h,'1');send(f.h,'2');const job=f.h.store.jobs().find(j=>j.kind==='router-admit')!;RouterCandidates.claim(f.h,job)
 hosts.splice(hosts.indexOf(f.h),1);await f.h.close()
 const restored=new Runtime(f.config,{model:f.model});hosts.push(restored)
 await settle(restored,()=>finished(restored));expect(f.calls).toHaveLength(1);expect(restored.store.db.prepare("SELECT state FROM jobs WHERE kind='router-admit'").all().every(j=>j.state==='done')).toBe(true)
})

async function delegated(f:ReturnType<typeof fixture>,requestId:string,worker='one'){
 if(!f.h.routerIngress.get('group:root')){send(f.h,'root','Fix the typo','alice',true);f.h.store.jobState('router:group:root','done')}
 const t=f.h.store.triggers.get('group:root')!
 return f.h.manager.call({action:'assign',id:worker,revision:0,requestId,text:'Fix only the typo'},{discussion:'group:topic',trigger:t})
}
it('delivers task-owned follow-ups once, keeps the original mandate and never adds a public Worker channel',async()=>{
 const f=fixture(),task=await delegated(f,'existing')
 send(f.h,'follow','The correct spelling is Roppo');send(f.h,'follow','The correct spelling is Roppo')
 const ticket=f.h.store.tickets.get(task.ticketId)!,reached=ticket.inputs.filter(i=>i.kind==='trigger'&&i.triggerId.startsWith('router-context:'))
 expect(reached).toHaveLength(1);expect(ticket.mandate.scope).toBe('Fix only the typo');expect(ticket.channels.every(c=>c.address.routerInbox==='group:topic')).toBe(true)
 expect(f.h.routerIngress.get('group:follow')?.reason).toBe('workerOwnedFollowup');expect(f.h.store.tickets.list()).toHaveLength(1);expect(f.h.store.list<any>('router-followup-notice')).toHaveLength(1)
})

it('reassesses a handed-back request only after all its task owners return it',async()=>{
 const f=fixture(),one=await delegated(f,'one'),two=await delegated(f,'two','two')
 send(f.h,'follow','Also build a new checkout flow')
 const relays=f.h.store.list<any>('router-followup')
 returnRouterFollowup(f.h,one.ticketId,relays.find(r=>r.ticketId===one.ticketId).id,'Outside typo fix')
 expect(f.h.routerIngress.get('group:follow')?.state).toBe('ignored')
 returnRouterFollowup(f.h,two.ticketId,relays.find(r=>r.ticketId===two.ticketId).id,'Requires new product decision')
 expect(f.h.routerIngress.get('group:follow')?.state).toBe('pending');expect(f.h.routerIngress.get('group:follow')?.revision).toBe(2)
 expect(()=>returnRouterFollowup(f.h,one.ticketId,'group:root','Not a reached follow-up')).toThrow('not a reached')
})

it('does not relay another actor, bots, revoked authorization, or human-stopped tasks',async()=>{
 const f=fixture(),task=await delegated(f,'one')
 send(f.h,'bob','New request','bob');expect(f.h.store.list('router-followup')).toHaveLength(0)
 f.h.ingest(f.source.trigger({id:'bot',thread:'topic',text:'Bot event',addressed:false},'alice',false));expect(f.h.store.list('router-followup')).toHaveLength(0)
 f.h.config.sources[0]!.allowedActors=[];send(f.h,'revoked');expect(f.h.store.list('router-followup')).toHaveLength(0)
 f.h.config.sources[0]!.allowedActors=['alice'];f.h.engine.stopTicket(task.ticketId,'Stopped by person');send(f.h,'stopped');expect(f.h.store.list('router-followup')).toHaveLength(0)
})

it('keeps unavailable evidence fenced across a restart until the resource is read successfully',async()=>{
 const f=fixture(async r=>{expect((await tool(r,'orchestrator_route',{reason:'Ignore without retry'})).success).toBe(false);expect((await tool(r,'orchestrator_eval_read',{resource:'root'})).success).toBe(true);expect((await tool(r,'orchestrator_route',{reason:'No change requested'})).success).toBe(true);return {reply:''}})
 ;(f.source as any).read=async()=>{throw Error('Temporary failure')}
 send(f.h,'1');const batch=RouterCandidates.claim(f.h,f.h.store.jobs().find(j=>j.kind==='router-admit')!)!
 await expect(batch.tool('orchestrator_eval_read',{resource:'root'})).rejects.toThrow('Temporary')
 hosts.splice(hosts.indexOf(f.h),1);await f.h.close();(f.source as any).read=async()=>({message:'Discussion root'})
 const restored=new Runtime(f.config,{model:f.model,sources:[f.source]});hosts.push(restored)
 await settle(restored,()=>finished(restored));expect(restored.routerIngress.get('group:1')?.state).toBe('ignored')
})

it('reads personal setup workspace files while still excluding adjacent host state',async()=>{
 const f=fixture(async r=>{expect(body(await tool(r,'orchestrator_eval_read',{resource:'repository/file/readme.txt'})).text).toBe('Project evidence');expect((await tool(r,'orchestrator_eval_read',{resource:'repository/file/escape'})).success).toBe(false);return {reply:''}})
 const workspace=join(f.config.stateDir,'workspace');mkdirSync(workspace);f.source.config.cwd=workspace
 writeFileSync(join(workspace,'readme.txt'),'Project evidence');writeFileSync(join(f.config.stateDir,'secret'),'private');symlinkSync(join(f.config.stateDir,'secret'),join(workspace,'escape'))
 send(f.h,'1');await settle(f.h,()=>finished(f.h))
})

it('keeps a normal Router continuation job after accepted admission for crash or older-host recovery',async()=>{
 const f=fixture();send(f.h,'1');send(f.h,'2')
 const batch=RouterCandidates.claim(f.h,f.h.store.jobs().find(j=>j.kind==='router-admit')!)!
 await batch.tool('orchestrator_eval_decide',accepted)
 const continuation=f.h.store.jobs().filter(j=>j.kind==='router')
 expect(continuation).toHaveLength(1);expect(continuation[0]!.payload).toMatchObject({triggerId:'group:2',discussion:'group:topic'})
 batch.finish();expect(f.h.store.jobs().filter(j=>j.kind==='router')).toHaveLength(0)
})

it('cancels primary-owned work when an earlier member of a completed batch is cancelled',async()=>{
 const f=fixture();send(f.h,'1');send(f.h,'2');const batch=RouterCandidates.claim(f.h,f.h.store.jobs().find(j=>j.kind==='router-admit')!)!
 await batch.tool('orchestrator_eval_decide',accepted)
 const task=await f.h.manager.call({action:'assign',id:'one',revision:0,requestId:'batch-task',text:accepted.scope},{discussion:'group:topic',trigger:f.h.store.triggers.get('group:2')!})
 batch.finish();await f.h.cancelRouter('group:1','group:topic')
 expect(f.h.store.tickets.get(task.ticketId)?.ended?.by).toBe('human');expect(()=>f.h.routerIngress.authority('group:2')).toThrow('cancelled')
})

it('stops an inferred task on an unmentioned human follow-up through the same persistent Router',async()=>{
 let taskId=''
 const f=fixture(async r=>{
  if(r.role==='worker'){await new Promise<void>(resolve=>{if(r.signal?.aborted)resolve();else r.signal?.addEventListener('abort',()=>resolve(),{once:true})});return workerReport}
  const input=JSON.parse(r.input)
  if(input.kind==='proactive_candidates'){await tool(r,'orchestrator_eval_decide',accepted);taskId=body(await tool(r,'worker_manage',{action:'assign',revision:0,requestId:'work',id:'one',text:accepted.scope})).ticketId}
  else if(input.kind==='task_followups'){
   expect(r.threadId).toBeTruthy();expect(r.ephemeral).not.toBe(true);expect((await tool(r,'worker_manage',{action:'assign'})).success).toBe(false)
   expect((await tool(r,'orchestrator_followup_stop',{triggerId:'group:stop',ticketId:taskId,explicit_stop_requested:true,evidence:'Please stop '+taskId})).success).toBe(true)
   return {reply:'Stopped the requested task'}
  }
  return {reply:''}
 })
 send(f.h,'1');await settle(f.h,()=>finished(f.h)&&!!taskId)
 send(f.h,'stop','Please stop '+taskId);await settle(f.h,()=>f.h.store.tickets.get(taskId)?.ended?.by==='human'&&f.h.store.deliveries().some(d=>d.text==='Stopped the requested task'))
 const assignments=f.h.store.tickets.get(taskId)!.assignments.length
 send(f.h,'later','Another detail');expect(f.h.store.tickets.get(taskId)!.assignments).toHaveLength(assignments);expect(f.h.store.list<any>('router-followup').filter(x=>x.triggerId==='group:later')).toHaveLength(0)
})

it('batches ordinary owned follow-ups for stop classification without new work or unsolicited replies',async()=>{
 const f=fixture(async r=>{if(r.role==='worker')return workerReport;expect(JSON.parse(r.input).kind).toBe('task_followups');expect(JSON.parse(r.input).followups).toHaveLength(2);return {reply:'Unsolicited answer'}})
 await delegated(f,'one');send(f.h,'one','Spelling detail');send(f.h,'two','More context')
 await settle(f.h,()=>f.h.store.list<any>('router-followup-notice').every(n=>n.read))
 expect(f.h.store.tickets.list()).toHaveLength(1);expect(f.h.store.deliveries().filter(d=>!d.channel.address.routerInbox)).toHaveLength(0)
})

it('can report a validated stop request that the host cannot perform without claiming it stopped',async()=>{
 let taskId=''
 const f=fixture(async r=>{const result=await tool(r,'orchestrator_followup_stop',{triggerId:'group:stop',ticketId:taskId,explicit_stop_requested:true,evidence:'Please stop '+taskId});expect(result.success).toBe(false);expect(result.contentItems[0]!.text).toContain('merge has been submitted');return {reply:'Cannot stop while the submitted merge is being reconciled'}})
 taskId=(await delegated(f,'merging')).ticketId
 f.h.store.put('run',taskId,{ticketId:taskId,assignmentId:f.h.store.tickets.get(taskId)!.assignments.at(-1)!.id,cwd:f.source.config.cwd,phase:'merging'})
 send(f.h,'stop','Please stop '+taskId)
 await settle(f.h,()=>f.h.store.deliveries().some(d=>d.text==='Cannot stop while the submitted merge is being reconciled'))
 expect(f.h.store.tickets.get(taskId)?.ended).toBeUndefined();expect(f.h.store.list('router-followup-stopped')).toHaveLength(0)
})

it.each([true,false])('releases stopped follow-up owners before or after handback (stop first: %s)',async stopFirst=>{
 const f=fixture(),one=await delegated(f,'one'),two=await delegated(f,'two','two');f.h.pause(true)
 send(f.h,'follow','A separate new project');const relay=f.h.store.list<any>('router-followup').find(r=>r.ticketId===one.ticketId)
 if(stopFirst)await f.h.stop(two.ticketId)
 returnRouterFollowup(f.h,one.ticketId,relay.id,'Outside this task')
 if(!stopFirst){expect(f.h.routerIngress.get('group:follow')?.state).toBe('ignored');await f.h.stop(two.ticketId);await f.h.tick()}
 expect(f.h.routerIngress.get('group:follow')?.state).toBe('pending');expect(f.h.routerIngress.get('group:follow')?.revision).toBe(2);expect(f.h.store.tickets.get(two.ticketId)?.ended?.by).toBe('human')
 await f.h.tick();expect(f.h.routerIngress.get('group:follow')?.revision).toBe(2)
})

it.each(['old','current'] as const)('checks current continuation ownership after %s admission is cancelled',async revoked=>{
 const f=fixture(),one=await delegated(f,'one'),two=await delegated(f,'two','two')
 send(f.h,'follow','A separate new project')
 const relays=f.h.store.list<any>('router-followup'),first=relays.find(r=>r.ticketId===one.ticketId),second=relays.find(r=>r.ticketId===two.ticketId)
 send(f.h,'continue','Continue the typo correction','alice',true)
 await f.h.manager.call({action:'send',revision:0,requestId:'continue',ticketId:one.ticketId,text:'Continue only the typo correction'},{discussion:'group:topic',trigger:f.h.store.triggers.get('group:continue')!})
 f.h.routerIngress.cancel(revoked==='old'?'group:root':'group:continue')
 returnRouterFollowup(f.h,two.ticketId,second.id,'Outside this task')
 if(revoked==='old'){
  expect(f.h.routerIngress.get('group:follow')?.state).toBe('ignored')
  returnRouterFollowup(f.h,one.ticketId,first.id,'Outside this task too')
 }
 expect(f.h.routerIngress.get('group:follow')?.state).toBe('pending')
 reconsiderRouterFollowups(f.h);expect(f.h.routerIngress.get('group:follow')?.revision).toBe(2)
 expect(f.h.store.tickets.get(one.ticketId)?.mandate.scope).toBe('Fix only the typo')
})

it('uses current continuation authority to honor an older reached stop request',async()=>{
 const f=fixture(),task=await delegated(f,'one')
 send(f.h,'stop','Please stop this typo task')
 send(f.h,'continue','Continue the typo correction','alice',true)
 await f.h.manager.call({action:'send',revision:0,requestId:'continue',ticketId:task.ticketId,text:'Continue only the typo correction'},{discussion:'group:topic',trigger:f.h.store.triggers.get('group:continue')!})
 f.h.routerIngress.cancel('group:root')
 const batch=new RouterFollowupBatch(f.h,f.h.store.jobs().find(j=>j.kind==='router-followup')!)
 expect(await batch.tool('orchestrator_followup_stop',{triggerId:'group:stop',ticketId:task.ticketId,explicit_stop_requested:true,evidence:'Please stop this typo task'})).toEqual({stopped:true})
 expect(f.h.store.tickets.get(task.ticketId)?.ended?.by).toBe('human')
})

it('reports the actual completed outcome when work finishes before a follow-up stop takes effect',async()=>{
 const f=fixture(),task=await delegated(f,'one')
 send(f.h,'stop','Please stop this typo task')
 const batch=new RouterFollowupBatch(f.h,f.h.store.jobs().find(j=>j.kind==='router-followup')!)
 f.h.engine.report(task.ticketId,{state:'ready',summary:'Finished before the stop'})
 const ended=f.h.store.tickets.get(task.ticketId)!.ended
 expect(await batch.tool('orchestrator_followup_stop',{triggerId:'group:stop',ticketId:task.ticketId,explicit_stop_requested:true,evidence:'Please stop this typo task'})).toEqual({stopped:false,alreadyEnded:true,ended})
 expect(f.h.store.tickets.get(task.ticketId)?.ended).toEqual(ended)
 expect(f.h.store.list('router-followup-stopped')).toHaveLength(0);expect(batch.replied).toBe(true)
 // Old hosts could save an incorrect success before crashing; replay must not repeat that claim.
 f.h.store.put('router-followup-stopped',bodyDigest(['group:stop',task.ticketId]),{triggerId:'group:stop',ticketId:task.ticketId})
 expect(await batch.tool('orchestrator_followup_stop',{triggerId:'group:stop',ticketId:task.ticketId,explicit_stop_requested:true,evidence:'Please stop this typo task'})).toEqual({stopped:false,replayed:true,alreadyEnded:true,ended})
})

it('shows shared discussion task summaries for deduplication without granting another actor task control',async()=>{
 let taskId=''
 const f=fixture(async r=>{if(r.role==='worker')return workerReport;const context=body(await tool(r,'orchestrator_eval'));expect(context.related.find((t:any)=>t.id===taskId)?.canAttach).toBe(false);expect((await tool(r,'orchestrator_eval_decide',{...accepted,action:'attach',targetTicketId:taskId})).success).toBe(false);await tool(r,'orchestrator_route',{reason:'Already handled in the existing task'});return {reply:''}})
 taskId=(await delegated(f,'shared')).ticketId;send(f.h,'bob','Yes, fix that same typo','bob')
 await settle(f.h,()=>finished(f.h));expect(f.h.store.tickets.list()).toHaveLength(1)
})
