import {afterEach,expect,it} from 'vitest'
import {Ajv} from 'ajv'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {randomUUID} from 'node:crypto'
import {Runtime} from '../src/runtime.ts'
import {configSchema} from '../src/config.ts'
import {managementSpecs,workerCommandSchema,type RouterContext} from '../src/worker-manager.ts'
import type {ModelRequest} from '../src/model.ts'

const roots:string[]=[],hosts:Runtime[]=[]
afterEach(async()=>{for(const h of hosts.splice(0))await h.close();for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true})})
function fixture(scopes=true,customChat=false){
 const root=mkdtempSync(join(tmpdir(),'worker-management-'));roots.push(root)
 const calls:ModelRequest[]=[],config=configSchema.parse({stateDir:join(root,'state'),work:{sandboxDriver:'disabled'},
  backends:{deepseek:{kind:'openai-chat',label:'DeepSeek',baseUrl:'http://127.0.0.1:9/private-endpoint',apiKeyEnv:'PRIVATE_KEY_NAME',headers:{'X-Private':'private-header'},model:'deepseek-test'},anthropic:{kind:'anthropic',baseUrl:'http://127.0.0.1:9',model:'claude-test'}},
  execution:{router:{mode:'host',backend:'deepseek'},management:{enabled:true,maxWorkers:10,backends:['codex']},workers:[{id:'shared',backend:'codex',state:'paused',prompt:'Keep the external role'},{id:'local',backend:'deepseek',effort:'high'}]},
  sources:[{id:'local',kind:'local',cwd:root,allowedActors:['operator']}]})
 const h=new Runtime(config,{model:{async run(r){
  calls.push(r);const id=r.threadId??randomUUID();r.onThread?.(id)
  return {threadId:id,turnId:randomUUID(),text:JSON.stringify(r.role==='router'?{reply:'Reviewed'}:{state:'ready',summary:'Verified',reply:'Worker result',question:null,askedBy:null,handbacks:[]})}
 }}});hosts.push(h)
 if(scopes)h.scopes.command({action:'scope.put',operationId:'external-scope',expectedRevision:0,scope:{id:'external',tenantId:'external',name:'External',managers:[JSON.stringify(['local','operator'])],workerIds:['shared'],backendIds:['codex'],sourceIds:['local']}})
 const conversation=h.chat.create('owner')
 if(customChat)h.scopes.command({action:'entry.bind',operationId:'custom-chat',expectedRevision:0,scopeId:'external',sourceId:'local',accountNamespace:'local',nativeId:'chat:'+conversation.id,history:'group'})
 const sent=h.chat.send(conversation.id,'owner',{clientMessageId:randomUUID(),text:'Complete the task using the right model and tools'}),trigger=h.store.triggers.get(sent.runId)!,discussion='local:chat:'+conversation.id
 const context:RouterContext={trigger,discussion,scoped:h.scopes.context(trigger,discussion)}
 return {h,config,context,conversation,calls}
}

it.each([true,false])('lets personal Chat discover and use a configured API despite a legacy external allowlist (scopes=%s)',async(scopes)=>{
 const {h,context,conversation,calls}=fixture(scopes),before=h.chat.view(conversation.id,'owner').messages
 const external=scopes?structuredClone(h.scopes.scope('external')):undefined
 const list=h.manager.list(context)
 expect(list.policy).toMatchObject({backends:['codex','deepseek','anthropic'],connectionScope:'personal_chat'})
 expect(list.connections.find(c=>c.id==='deepseek')).toMatchObject({label:'DeepSeek',model:'deepseek-test',options:expect.arrayContaining(['effort','parameters','maxSteps','tools','browser'])})
 expect(list.connections.find(c=>c.id==='codex')?.unsupportedOptions).toEqual(['maxOutputTokens','maxSteps','maxToolCalls'])
 expect(list.connections.find(c=>c.id==='anthropic')).toMatchObject({options:expect.not.arrayContaining(['effort'])})
 expect(JSON.stringify(list)).not.toMatch(/private-header|PRIVATE_KEY_NAME|private-endpoint/)
 const profile={id:'dedicated',label:'Researcher',backend:'deepseek',model:'deepseek-test',effort:'low' as const,prompt:'Own the whole task',parameters:{temperature:0.2},maxOutputTokens:1200,maxSteps:8,maxToolCalls:12,timeoutMs:10000,tools:['superagent_read'],toolConnections:[],browser:{enabled:true,maxTabs:3}}
 await h.manager.call({action:'create',requestId:'create',revision:list.revision,profile},context)
 await h.manager.call({action:'set_prompt',requestId:'prompt',revision:1,id:'dedicated',prompt:'Investigate, implement and verify'},context)
 const task=await h.manager.call({action:'assign',requestId:'task',revision:2,id:'dedicated',text:'Produce a verified result'},context)
 for(let i=0;i<300&&!h.store.tickets.get(task.ticketId)?.ended;i++){await h.tick();await new Promise(r=>setTimeout(r,2))}
 expect(h.store.tickets.get(task.ticketId)?.ended).toBeTruthy()
 expect(calls.find(c=>c.role==='worker')).toMatchObject({backendId:'deepseek',model:'deepseek-test',options:{effort:'low',maxOutputTokens:1200,maxSteps:8,maxToolCalls:12,timeoutMs:10000,parameters:{temperature:0.2},tools:['superagent_read'],browser:{enabled:true,maxTabs:3}}})
 expect(h.chat.view(conversation.id,'owner').messages.slice(0,before.length)).toEqual(before)
 expect(h.config.execution.management?.backends).toEqual(['codex'])
 if(scopes)expect(h.scopes.scope('external')).toEqual(external)
})

it('keeps an explicitly assigned Chat scope and external Router connection restrictions',async()=>{
 const {h,context}=fixture(true,true),list=h.manager.list(context)
 expect(h.chat.personalManagement(context)).toBe(false)
 expect(list.policy.backends).toEqual(['codex']);expect(list.connections.map(c=>c.id)).toEqual(['codex'])
 await expect(h.manager.call({action:'create',revision:0,requestId:'blocked',profile:{id:'new',backend:'deepseek'}},context)).rejects.toThrow('outside Router management policy')
 expect(h.manager.list(context).workers).toHaveLength(1)
 expect(h.chat.personalManagement({...context,scoped:undefined})).toBe(false)
})

it('allows a shared Worker to be cloned and configured without modifying its other scope or original profile',async()=>{
 const {h,context}=fixture(true,true),external=structuredClone(h.scopes.scope('external')),original=structuredClone(h.config.execution.workers![0])
 h.store.put('management-scope','other',{...external,id:'other'})
 expect(h.manager.list(context).workers.find(w=>w.id==='shared')).toMatchObject({shared:true,canConfigure:false})
 await expect(h.manager.call({action:'configure',requestId:'shared-edit',revision:0,id:'shared',patch:{backend:'deepseek'}},context)).rejects.toThrow('Shared Worker')
 await expect(h.manager.call({action:'destroy',requestId:'shared-destroy',revision:0,id:'shared'},context)).rejects.toThrow('Shared Worker')
 const clone={action:'clone',requestId:'clone',revision:0,from:'shared',id:'private',patch:{backend:'codex',label:'Private colleague',effort:'low'}}
 const created=await h.manager.call(clone,context);expect(await h.manager.call(clone,context)).toEqual(created)
 expect(created.worker).toMatchObject({id:'private',backend:'codex',state:'enabled'})
 await h.manager.call({action:'configure',revision:1,requestId:'tune',id:'private',patch:{maxSteps:10,parameters:{temperature:0.3}}},context)
 expect(h.manager.list(context).workers.find(w=>w.id==='private')).toMatchObject({canConfigure:true,canAssign:true,shared:false,maxSteps:10})
 expect(h.config.execution.workers![0]).toEqual(original);expect(h.scopes.scope('other')).toEqual({...external,id:'other'})
})

it('lets personal Chat configure existing shared Workers while external scopes still need a private clone',async()=>{
 const {h,context}=fixture(),external=structuredClone(h.scopes.scope('external'))
 const change={action:'configure',requestId:'shared-edit',revision:0,id:'shared',patch:{backend:'deepseek',effort:'minimal',prompt:'Own the complete task'}}
 const result=await h.manager.call(change,context)
 expect(await h.manager.call(change,context)).toEqual(result)
 expect(result.worker).toMatchObject({id:'shared',backend:'deepseek',effort:'minimal',prompt:'Own the complete task'})
 expect(h.config.execution.workers).toHaveLength(2)
 expect(h.scopes.scope('external')).toEqual(external)
 // The same signed-in actor through an explicitly scoped entry has no host-owner profile privilege.
 const other=h.chat.create('owner')
 h.scopes.command({action:'entry.bind',operationId:'external-chat',expectedRevision:0,scopeId:'external',sourceId:'local',accountNamespace:'local',nativeId:'chat:'+other.id,history:'group'})
 const sent=h.chat.send(other.id,'owner',{clientMessageId:randomUUID(),text:'Change the shared Worker'}),trigger=h.store.triggers.get(sent.runId)!,discussion='local:chat:'+other.id
 const restricted={trigger,discussion,scoped:h.scopes.context(trigger,discussion)}
 expect(h.manager.list(restricted).workers[0]).toMatchObject({shared:true,canConfigure:false,canAssign:false})
 await expect(h.manager.call({...change,requestId:'external-edit',revision:1,patch:{effort:'high'}},restricted)).rejects.toThrow('Shared Worker')
 expect(h.config.execution.workers![0]!.effort).toBe('minimal')
})

it('uses the configured Worker limit above ten, independently of subagents, and preserves the pool when lowered',async()=>{
 const {h,context,config}=fixture()
 h.updateSettings(0,{execution:{...h.config.execution,management:{...h.config.execution.management!,maxWorkers:12}},work:{...h.config.work,maxAgents:1}})
 for(let i=3;i<=12;i++)await h.manager.call({action:'create',requestId:'worker-'+i,revision:h.settings.current().revision,profile:{id:'worker-'+i,backend:'deepseek'}},context)
 expect(h.config.concurrency).toBe(12)
 expect(h.manager.list(context)).toMatchObject({canCreate:false,policy:{maxWorkers:12}})
 await expect(h.manager.call({action:'create',requestId:'over-limit',revision:h.settings.current().revision,profile:{id:'overflow',backend:'deepseek'}},context)).rejects.toThrow('Worker limit reached')
 h.updateSettings(h.settings.current().revision,{execution:{...h.config.execution,management:{...h.config.execution.management!,maxWorkers:6}}})
 expect(h.config.execution.workers).toHaveLength(12)
 expect(h.manager.list(context)).toMatchObject({canCreate:false,policy:{maxWorkers:6}})
 expect(()=>h.updateSettings(h.settings.current().revision,{execution:{...h.config.execution,workers:[...h.config.execution.workers!,{id:'manual-extra',backend:'deepseek'}]}})).toThrow('Worker limit reached')
 await h.close();hosts.splice(hosts.indexOf(h),1)
 const restored=new Runtime(config,{model:{async run(){throw Error('No model needed')}}});hosts.push(restored)
 expect(restored.config.execution.workers).toHaveLength(12)
 expect(restored.config.execution.management!.maxWorkers).toBe(6)
 expect(restored.config.work.maxAgents).toBe(1)
})

it('discovers newly added connections on the next message without replacing history or external scopes',async()=>{
 const {h,context,conversation}=fixture(),external=structuredClone(h.scopes.scope('external'))
 for(let i=0;i<300&&h.chat.view(conversation.id,'owner').run?.state!=='completed';i++){await h.tick();await new Promise(r=>setTimeout(r,2))}
 expect(h.chat.view(conversation.id,'owner').run?.state).toBe('completed')
 const before=h.chat.view(conversation.id,'owner').messages
 const evidence=h.memory.ingest(context.scoped!)
 h.memory.command(context.scoped!,{action:'remember',operationId:'retain-memory',expectedRevision:0,subject:'Working preference',content:'Prefer concise reports',sourceIds:[evidence.id],candidate:false},true)
 const memory=h.memory.query(context.scoped!,{})
 h.updateSettings(0,{backends:{...h.config.backends,newmodel:{kind:'openai-chat',label:'New connection',baseUrl:'http://127.0.0.1:9',model:'new-model'}}})
 const sent=h.chat.send(conversation.id,'owner',{clientMessageId:randomUUID(),text:'Use the new connection'}),trigger=h.store.triggers.get(sent.runId)!,next={trigger,discussion:context.discussion,scoped:h.scopes.context(trigger,context.discussion)}
 expect(h.manager.list(next).connections.map(c=>c.id)).toContain('newmodel')
 expect(h.chat.view(conversation.id,'owner').messages.slice(0,before.length)).toEqual(before)
 expect(h.memory.query(next.scoped!,{})).toEqual(memory)
 expect(h.scopes.scope('external')).toEqual(external)
})

it('shows external Workers their inherited tool connections without listing unrelated connections',()=>{
 const {h,context}=fixture(true,true)
 h.config.toolConnections=configSchema.shape.toolConnections.parse({docs:{allowedTools:['read'],transport:{kind:'http',url:'http://127.0.0.1:9/mcp'}},unrelated:{allowedTools:['read'],transport:{kind:'http',url:'http://127.0.0.1:9/mcp'}}})
 h.config.backends.codex={kind:'codex',defaults:{toolConnections:['docs']}}
 expect(h.manager.list(context).connections.find(c=>c.id==='codex')).toMatchObject({model:h.config.model,parameterSupport:{namespaces:{thread:expect.arrayContaining(['serviceTier']),config:expect.arrayContaining(['model_verbosity'])}}})
 expect(h.manager.list(context).toolConnections.map(c=>c.id)).toEqual(['docs'])
 h.config.execution.workers![0]!.toolConnections=[]
 expect(h.manager.list(context).toolConnections).toEqual([])
})

it('keeps management disabled and the host Worker limit effective in personal Chat',async()=>{
 const {h,context}=fixture()
 h.updateSettings(0,{execution:{...h.config.execution,management:{enabled:false,maxWorkers:2,backends:['codex']}}})
 expect(h.manager.list(context)).toMatchObject({canCreate:false,workers:expect.arrayContaining([expect.objectContaining({canConfigure:false,canAssign:false})])})
 await expect(h.manager.call({action:'create',revision:1,requestId:'disabled',profile:{id:'new',backend:'deepseek'}},context)).rejects.toThrow('management is disabled')
 h.updateSettings(1,{execution:{...h.config.execution,management:{...h.config.execution.management!,enabled:true}}})
 expect(h.manager.list(context).canCreate).toBe(false)
 await expect(h.manager.call({action:'create',revision:2,requestId:'limit',profile:{id:'new',backend:'deepseek'}},context)).rejects.toThrow('Worker limit reached')
})

it('requires the actual personal Chat identity and binding to broaden connection discovery',()=>{
 const {h,context}=fixture()
 expect(h.chat.personalManagement({...context,discussion:'another-chat'})).toBe(false)
 expect(h.chat.personalManagement({...context,trigger:{...context.trigger!,actor:{...context.trigger!.actor,id:'another-actor'}}})).toBe(false)
 expect(h.manager.list().policy.backends).toEqual(['codex'])
 const route=context.scoped!.route,entry=h.scopes.binding(route.entryId)
 h.store.put('entry-binding',route.entryId,{...entry,privateActor:undefined})
 expect(h.chat.personalManagement(context)).toBe(false)
 expect(h.manager.list(context).policy.backends).toEqual(['codex'])
})

it('publishes the same nested Worker options and constraints used by runtime validation',()=>{
 const schema=managementSpecs[0]!.inputSchema as any,validate=new Ajv({strict:false}).compile(schema)
 for(const action of ['create','configure']){
  const key=action==='create'?'profile':'patch',profile={id:'test',backend:'deepseek',label:'Writer',effort:'high',parameters:{temperature:0.2},tools:['superagent_read'],toolConnections:['docs'],browser:{enabled:true,maxTabs:4},maxOutputTokens:2048,maxSteps:4,maxToolCalls:10,timeoutMs:20000},command={action,[key]:profile}
  expect(validate(command)).toBe(true);expect(workerCommandSchema.safeParse(command).success).toBe(true)
  expect(validate({...command,[key]:{...profile,apiKey:'not-a-worker-option'}})).toBe(false)
  expect(validate({...command,[key]:{...profile,maxSteps:257}})).toBe(false)
 }
 expect(schema.properties.profile.properties.browser.properties.maxTabs.maximum).toBe(20)
 expect(schema.properties.patch.properties.effort.enum).toContain('high')
})


it('lets the personal owner manage shared Workers and delete the last one with replay and restart safety',async()=>{
 const {h,config,context}=fixture()
 expect(h.manager.list(context).workers.find(w=>w.id==='shared')).toMatchObject({shared:true,canConfigure:true,canDestroy:true})
 await h.manager.call({action:'configure',requestId:'edit-shared',revision:0,id:'shared',patch:{label:'My worker'}},context)
 const command={action:'destroy',requestId:'delete-shared',revision:1,id:'shared'}
 const deleted=await h.manager.call(command,context)
 expect(deleted.status).toBe('destroyed');expect(await h.manager.call(command,context)).toEqual(deleted)
 expect(h.scopes.scope('external').workerIds).toEqual([])
 expect(h.scopes.scope(context.scoped!.route.scopeId).workerIds).toEqual(['local'])
 await h.manager.call({action:'destroy',requestId:'delete-last',revision:h.settings.current().revision,id:'local'},context)
 expect(h.manager.list(context).workers).toEqual([]);expect(h.config.concurrency).toBe(0)
 expect(h.chat.readiness().ready).toBe(true)
 await h.close();hosts.splice(hosts.indexOf(h),1)
 const restored=new Runtime(config,{model:{async run(){throw Error('No model call expected')}}});hosts.push(restored)
 expect(restored.manager.list().workers).toEqual([])
 await expect(restored.manager.call({action:'create',requestId:'reuse',revision:restored.settings.current().revision,profile:{id:'shared',backend:'codex'}})).rejects.toThrow('identity cannot be reused')
 await restored.manager.call({action:'create',requestId:'new-worker',revision:restored.settings.current().revision,profile:{id:'fresh',backend:'codex'}})
 expect(restored.manager.list().workers.map(w=>w.id)).toEqual(['fresh'])
})


it('does not let personal deletion silently cancel shared work in another scope',async()=>{
 const {h,context}=fixture(true,true)
 h.updateSettings(0,{execution:{...h.config.execution,workers:h.config.execution.workers!.map(w=>({...w,state:'enabled'}))}})
 const task=await h.manager.call({action:'assign',revision:1,requestId:'external-work',id:'shared',text:'External task'},context)
 const conversation=h.chat.create('owner'),sent=h.chat.send(conversation.id,'owner',{clientMessageId:randomUUID(),text:'Remove the shared Worker'})
 const trigger=h.store.triggers.get(sent.runId)!,discussion='local:chat:'+conversation.id,personal={trigger,discussion,scoped:h.scopes.context(trigger,discussion)}
 await expect(h.manager.call({action:'destroy',requestId:'no-cancel',revision:1,id:'shared'},personal)).rejects.toThrow('cancelRunning required')
 expect(h.store.tickets.get(task.ticketId)?.ended).toBeFalsy()
 await h.manager.call({action:'destroy',requestId:'with-cancel',revision:1,id:'shared',cancelRunning:true},personal)
 expect(h.store.tickets.get(task.ticketId)?.ended).toBeTruthy()
 expect(h.scopes.scope('external').workerIds).toEqual([])
})
