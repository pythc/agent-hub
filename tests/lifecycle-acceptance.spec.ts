import {it,expect} from 'vitest'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {Runtime} from '../src/runtime.ts'
import {configSchema} from '../src/config.ts'
import {previewScopeMigration,applyScopeMigration} from '../src/scope-migration.ts'
import {SourceIdentities} from '../src/source-identity.ts'
import {MessageSource} from '../src/sources.ts'

it('G13 migrates valid Engine state and replays old source, command and inbox identities without new work',async()=>{
 const root=mkdtempSync(join(tmpdir(),'migration-replay-'))
 const config=configSchema.parse({stateDir:join(root,'state'),work:{sandboxDriver:'disabled'},execution:{router:{mode:'host'},workers:[{id:'one',backend:'codex'}],management:{enabled:true}},sources:[{id:'local',kind:'local',allowedActors:['alice'],cwd:root,workspace:{mode:'source'}}]})
 let calls=0,host:Runtime|undefined
 const model={run:async(r:any)=>{calls++;return {threadId:'fixture-'+calls,turnId:'turn-'+calls,text:JSON.stringify(r.role==='worker'?{state:'ready',summary:'done',reply:'2',handbacks:[],question:null,askedBy:null}:{reply:'Router result'})}}}
 const input={id:'once',thread:'topic',scope:'group',text:'Calculate 1+1',addressed:true},command={action:'assign',id:'one',text:'Calculate 1+1',requestId:'once',revision:0}
 try{
  host=new Runtime(config,{model});host.receive('local','alice',input)
  const trigger=host.store.triggers.get('local:once')!,context={discussion:'local:topic',trigger},task=await host.manager.call(command,context)
  for(let i=0;i<100;i++){await host.tick();await new Promise(r=>setTimeout(r,2));if(host.store.tickets.get(task.ticketId)?.ended&&!host.status().active&&!host.store.jobs().length)break}
  await host.flush()
  const before={tasks:host.store.tickets.list().length,deliveries:host.store.deliveries(),inbox:host.store.list<any>('router-inbox'),calls}
  await host.close();host=undefined
  const spec={operationId:'migration-replay',commands:[{action:'scope.put',operationId:'scope',expectedRevision:0,scope:{id:'team',tenantId:'tenant',name:'Team',managers:[JSON.stringify(['local','alice'])],workerIds:['one'],sourceIds:['local'],backendIds:['codex']}},{action:'entry.bind',operationId:'bind',expectedRevision:0,scopeId:'team',sourceId:'local',accountNamespace:'operator',nativeId:'group'}]}
  const plan=previewScopeMigration(config,spec);expect(plan.items.filter(i=>i.status==='held')).toHaveLength(0)
  await applyScopeMigration(config,spec,plan.fingerprint,{historyReader:async ref=>({id:ref.threadId,turns:[]})})
  host=new Runtime(config,{model});await host.scopeCommand({action:'migration.activate',operationId:'activate',expectedRevision:1});host.pause(false)
  expect(host.receive('local','alice',input)).toMatchObject({disposition:'duplicate'})
  const scoped=host.scopes.context(trigger,context.discussion)!
  expect(await host.manager.call(command,{...context,scoped})).toEqual(task)
  for(const m of before.inbox){host.store.put('router-inbox',m.id,m);host.store.enqueue('router:result:'+m.id,'router',{discussion:context.discussion,triggerId:trigger.id,messageId:m.id})}
  for(let i=0;i<10;i++){await host.tick();await new Promise(r=>setTimeout(r,2))}
  expect(host.store.tickets.list()).toHaveLength(before.tasks);expect(calls).toBe(before.calls);expect(host.store.deliveries()).toEqual(before.deliveries)
 }finally{await host?.close();rmSync(root,{recursive:true,force:true})}
})
it('R11 verifies cross-source actors with the same display identity without sharing their permissions',async()=>{
 const root=mkdtempSync(join(tmpdir(),'identity-link-')),config=configSchema.parse({stateDir:join(root,'state'),sources:['first','second'].map(id=>({id,kind:'local',allowedActors:['alice'],cwd:root}))})
 const h=new Runtime(config,{model:{run:async()=>{throw Error('unused')}}})
 try{
  h.scopes.command({action:'scope.put',operationId:'scope',expectedRevision:0,scope:{id:'team',tenantId:'tenant',name:'Team',managers:[JSON.stringify(['first','alice'])],workerIds:[],sourceIds:['first','second'],backendIds:['codex']}})
  const sources=new Map(config.sources.map(c=>[c.id,Object.assign(new MessageSource(c),{identity:async()=>({id:'account-'+c.id,type:'bot',verified:true})})])),identities=new SourceIdentities(h.store,h.scopes,sources)
  const actors=[]
  for(const id of ['first','second']){const identity=await identities.command({action:'source.verify',sourceId:id,operationId:id,expectedRevision:0});const entry:any=h.scopes.command({action:'entry.bind',operationId:'bind-'+id,expectedRevision:0,scopeId:'team',sourceId:id,accountNamespace:identity.namespace,nativeId:'same-native-id'});actors.push({sourceId:id,actorId:'alice',entryId:entry.id})}
  const challenge=await identities.command({action:'identity.challenge',operationId:'challenge',expectedRevision:0,actors}),triggerIds=[]
  for(const a of actors){const t=sources.get(a.sourceId)!.trigger({id:'proof',thread:'same-native-id',text:challenge.command,addressed:true},a.actorId);h.store.triggers.save(t);identities.recordNative(t);triggerIds.push(t.id)}
  const result=await identities.command({action:'identity.link',operationId:'link',expectedRevision:1,challengeId:challenge.id,triggerIds})
  expect(result.active).toBe(true);expect(h.scopes.scope('team').managers).toEqual([JSON.stringify(['first','alice'])]);expect(h.scopes.actor(h.store.triggers.get(triggerIds[0]!)!)).not.toEqual(h.scopes.actor(h.store.triggers.get(triggerIds[1]!)!))
 }finally{await h.close();rmSync(root,{recursive:true,force:true})}
})
