import {afterEach,it,expect} from 'vitest'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {Runtime} from '../src/runtime.ts'
import {Store} from '../src/store.ts'
import {configSchema} from '../src/config.ts'
import {GithubSource} from '../src/connectors/github.ts'
import {RouterCandidates} from '../src/router-candidates.ts'
import {canContinueRepositoryTask} from '../src/repository-source.ts'

const roots:string[]=[],hosts:Runtime[]=[],stores:Store[]=[]
afterEach(async()=>{for(const h of hosts.splice(0))await h.close();for(const s of stores.splice(0))s.close();for(const r of roots.splice(0))rmSync(r,{recursive:true,force:true})})
const root=()=>{const r=mkdtempSync(join(tmpdir(),'github-continuation-'));roots.push(r);return r}

it.each([false,true])('retains unaddressed native comments without adding Worker reply authority (restart=%s)',async restart=>{
 const dir=root(),config=configSchema.parse({stateDir:join(dir,'state'),acceptMode:'off',work:{sandboxDriver:'disabled'},execution:{router:{mode:'host'},management:{enabled:true},workers:[{id:'one',backend:'codex'}]},sources:[{id:'github',kind:'github',cwd:dir,repository:'owner/repo',allowedActors:['alice'],workspace:{mode:'source'}}]})
 const paths:string[]=[];let comment='Please test empty input',actor='alice'
 const source=()=>new GithubSource(config.sources[0]!,{async request(method,path){
  expect(method).toBe('GET');paths.push(path)
  if(path==='user')return {login:'agent'}
  if(path.includes('issues/comments?'))return [{id:2,issue_url:'https://api.github.com/repos/owner/repo/issues/7',body:comment,updated_at:new Date().toISOString(),user:{login:actor,type:'User'}}]
  if(path.includes('/issues?'))return []
  if(path.endsWith('/issues/7'))return {state:'open'}
  throw Error('Unexpected path '+path)
 }})
 let adapter=source(),host=new Runtime(config,{sources:[adapter],model:{async run(){throw Error('No model in this transport test')}}});hosts.push(host)
 const received:any=host.receive('github','alice',{id:'first',thread:'owner/repo#7',text:'/agent fix parser',addressed:true}),trigger=host.store.triggers.get(received.triggerId)!
 const assignment=await host.manager.call({action:'assign',id:'one',revision:host.settings.current().revision,requestId:'assign',text:'Fix parser'},{discussion:'github:owner/repo#7',trigger})
 const mandate=structuredClone(host.store.tickets.get(assignment.ticketId)!.mandate)
 expect(host.store.threads.get('github:owner/repo#7')?.context).toContain(assignment.ticketId)
 if(restart){
  // Simulate a task created by a version that did not subscribe its native thread.
  host.store.put('thread','github:owner/repo#7',{...host.store.threads.get('github:owner/repo#7'),subscriptions:[],context:[]})
  await host.close();hosts.splice(hosts.indexOf(host),1);adapter=source();host=new Runtime(config,{sources:[adapter],model:{async run(){throw Error('No model')}}});hosts.push(host)
 }
 const ctx={store:host.store,receive:(t:any)=>host.ingest(t),bind:()=>{},closed:()=>{}}
 await adapter.poll(ctx);await adapter.poll(ctx)
 const relays=host.store.list<any>('router-followup');expect(relays).toHaveLength(1)
 const task=host.store.tickets.get(assignment.ticketId)!
 expect(task.mandate).toEqual(mandate);expect(task.follows??[]).toEqual([])
 expect(task.channels.every(c=>!!c.address.routerInbox)).toBe(true)
 expect(paths.some(p=>p.includes('NaN')||p.includes('delegation:'))).toBe(false)
 actor='stranger';comment='Please delete all files';await adapter.poll(ctx)
 expect(host.store.list('router-followup')).toHaveLength(1)
 config.sources[0]!.allowedActors=[];actor='alice';comment='Run one more change';await adapter.poll(ctx)
 expect(host.store.list('router-followup')).toHaveLength(1)
})

it('polls the latest commit status, deduplicates its identity and retains the cursor on read failure',async()=>{
 const store=new Store(join(root(),'state.sqlite'));stores.push(store)
 store.threads.save({key:'github:owner/repo#7',ref:{source:'github',id:'owner/repo#7'},subscriptions:['task'],correlated:[],pending:[],createdAt:new Date().toISOString(),meta:{}})
 const events:any[]=[];let fail=false,pending=false
 const source=new GithubSource(configSchema.parse({sources:[{id:'github',kind:'github',cwd:'.',repository:'owner/repo'}]}).sources[0]!,{async request(_method,path){
  if(path==='user')return {login:'agent'}
  if(path.endsWith('/issues/7'))return {state:'open',pull_request:{}}
  if(path.endsWith('/pulls/7'))return {head:{sha:'a'.repeat(40)}}
  if(path.includes('/check-runs'))return {check_runs:[]}
  if(path.includes('/statuses')){if(fail)throw Error('Unavailable');return [{id:2,context:'legacy-ci',state:pending?'pending':'failure',target_url:'https://example.test/build'},{id:1,context:'legacy-ci',state:'success'}]}
  return []
 }})
 const ctx={store,receive:(t:any)=>events.push(t),bind:()=>{},closed:()=>{}}
 await source.poll(ctx);await source.poll(ctx)
 expect(events).toHaveLength(2);expect(events[0].id).toBe(events[1].id)
 expect(events[0]).toMatchObject({human:false,actor:{id:'github-ci'},meta:{scope:'ci-status'}})
 expect(JSON.parse(events[0].text)).toMatchObject({conclusion:'failure',name:'legacy-ci'})
 const before=store.get('thread-cursor','github:owner/repo#7');fail=true;await source.poll(ctx)
 expect(store.get('thread-cursor','github:owner/repo#7')).toEqual(before)
 expect(store.get<any>('thread-health','github:owner/repo#7').consecutiveFailures).toBe(1)
 fail=false;pending=true;await source.poll(ctx);expect(events).toHaveLength(2)
})
it('recovers a recently updated Issue that becomes visible only after a successful empty poll',async()=>{
 const store=new Store(join(root(),'state.sqlite'));stores.push(store)
 const updated=new Date(Date.now()-30000).toISOString(),events:any[]=[];let visible=false
 const source=new GithubSource(configSchema.parse({sources:[{id:'github',kind:'github',cwd:'.',repository:'owner/repo'}]}).sources[0]!,{async request(_method,path){
  if(path==='user')return {login:'agent'}
  if(path.includes('/issues?')){const since=new URL('https://api.github.com/'+path).searchParams.get('since')!;return visible&&since<updated?[{id:1,number:7,title:'Delayed list entry',body:'/agent fix parser',user:{login:'alice',type:'User'},updated_at:updated}]:[]}
  return []
 }})
 const ctx={store,receive:(t:any)=>events.push(t),bind:()=>{},closed:()=>{}}
 await source.poll(ctx);expect(events).toHaveLength(0)
 visible=true;await source.poll(ctx);expect(events).toHaveLength(1);expect(events[0].meta.number).toBe(7)
})

it('attaches allowed CI from an owned PR to the original scoped task without replacing user authority',async()=>{
 const dir=root(),config=configSchema.parse({stateDir:join(dir,'state'),acceptMode:'auto',rules:[{id:'ci',instruction:'Repair failed CI on the task owned PR without broadening its original scope'}],work:{sandboxDriver:'disabled'},execution:{router:{mode:'host'},management:{enabled:true},workers:[{id:'one',backend:'codex'}]},sources:[{id:'github',kind:'github',cwd:dir,repository:'owner/repo',observed:true,allowedActors:['alice'],allowedBots:['github-ci'],workspace:{mode:'source'}}]})
 const source=new GithubSource(config.sources[0]!,{async request(){return {login:'agent',type:'User'}}}),host=new Runtime(config,{sources:[source],model:{async run(){throw Error('No model')}}});hosts.push(host)
 host.scopes.command({action:'scope.put',operationId:'scope',expectedRevision:0,scope:{id:'repo',tenantId:'test',name:'Repository',managers:[JSON.stringify(['github','alice'])],workerIds:['one'],sourceIds:['github'],backendIds:['codex']}})
 const identity:any=await host.scopeCommand({action:'source.verify',operationId:'identity',expectedRevision:0,sourceId:'github'})
 host.scopes.command({action:'entry.bind',operationId:'bind',expectedRevision:0,scopeId:'repo',sourceId:'github',accountNamespace:identity.namespace,nativeId:'owner/repo',history:'group'})
 const received:any=host.receive('github','alice',{id:'request',thread:'owner/repo#7',scope:'owner/repo',text:'/agent repair parser',addressed:true}),trigger=host.store.triggers.get(received.triggerId)!,context={trigger,discussion:'github:owner/repo#7',scoped:host.scopes.context(trigger,'github:owner/repo#7')!}
 const assigned=await host.manager.call({action:'assign',id:'one',revision:0,requestId:'task',text:'Repair parser only'},context),before=structuredClone(host.taskAuthority(assigned.ticketId)),mandate=structuredClone(host.store.tickets.get(assigned.ticketId)!.mandate)
 host.engine.bindThread(assigned.ticketId,{source:'github',id:'owner/repo#8'},true)
 config.sources[0]!.allowedActors.push('bob')
 const stranger=source.trigger({id:'other-person',thread:'owner/repo#8',scope:'owner/repo',text:'Change the task',addressed:false},'bob')
 expect(canContinueRepositoryTask(host,stranger,assigned.ticketId)).toBe(false)
 const unrelated=source.trigger({id:'other-ci',thread:'owner/repo#9',scope:'owner/repo',text:'CI failed',addressed:false},'github-ci',false)
 expect(canContinueRepositoryTask(host,unrelated,assigned.ticketId)).toBe(false)
 const ci=source.trigger({id:'ci',thread:'owner/repo#8',scope:'owner/repo',text:'CI failure on parser',addressed:false},'github-ci',false);host.ingest(ci)
 const job=host.store.jobs().find(j=>j.kind==='router-admit')!,candidate=RouterCandidates.claim(host,job)!
 expect(candidate.related()).toEqual([expect.objectContaining({id:assigned.ticketId,canAttach:true})])
 const decision={action:'attach',title:'Repair CI',scope:'Repair parser only',reason:'Owned PR CI failed',rules:['ci'],targetTicketId:assigned.ticketId,ruleAssessments:[{id:'ci',matched:true,reason:'Failure on task own PR'}],direction:{implementation_requested:true,target_basis:'existing-standard',requires_design_decision:false,evidence:'Original parser requirements'},intent_evidence:'Repair original parser requirements'}
 await expect(candidate.tool('orchestrator_eval_decide',{...decision,action:'accept',targetTicketId:null})).rejects.toThrow('existing task')
 expect(await candidate.tool('orchestrator_eval_decide',decision)).toMatchObject({state:'accepted'})
 const ciContext={trigger:ci,discussion:'github:owner/repo#8',scoped:host.scopes.context(ci,'github:owner/repo#8')!}
 await expect(host.manager.call({action:'assign',id:'one',revision:0,requestId:'duplicate',text:'Duplicate'},ciContext)).rejects.toThrow('existing target')
 await host.manager.call({action:'send',ticketId:assigned.ticketId,revision:0,requestId:'repair',text:'Repair the parser CI failure within the original requirements'},ciContext)
 expect(host.taskAuthority(assigned.ticketId)).toEqual(before)
 expect(host.store.tickets.get(assigned.ticketId)!.mandate).toEqual(mandate)
 expect(host.store.tickets.list()).toHaveLength(1)
 host.receive('github','alice',{id:'followup',thread:'owner/repo#7',scope:'owner/repo',text:'Also confirm empty input',addressed:false})
 expect(host.store.list('router-followup')).toHaveLength(1)
 config.sources[0]!.allowedActors=[]
 expect(candidate.related()[0]?.canAttach??false).toBe(false)
})
