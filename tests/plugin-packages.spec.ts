import {mkdtempSync,readFileSync,writeFileSync,rmSync,existsSync} from 'node:fs'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {tmpdir} from 'node:os'
import {it,expect,afterEach} from 'vitest'
import {configSchema,type Config} from '../src/config.ts'
import {Store} from '../src/store.ts'
import {Runtime} from '../src/runtime.ts'
import {buildPluginPackage,readPluginPackage,pluginManifestSchema,type PluginPackage} from '../src/plugin-package.ts'
import {ProcessSource} from '../src/plugin-process.ts'
import {SourceRegistry} from '../src/source-plugins.ts'
import type {Trigger} from '../plugins/sdk.ts'
const root=fileURLToPath(new URL('../',import.meta.url)),roots:string[]=[],sources:ProcessSource[]=[],stores:Store[]=[],hosts:Runtime[]=[]
const quiet={async run(){throw Error('No model expected')}}
afterEach(async()=>{await Promise.allSettled(sources.splice(0).map(s=>s.close()));for(const h of hosts.splice(0))await h.close();for(const s of stores.splice(0))s.close();for(const r of roots.splice(0))rmSync(r,{recursive:true,force:true});delete process.env.AGENTHUB_TEST_AMBIENT_SECRET})
function directory(){const r=mkdtempSync(join(tmpdir(),'plugin-package-'));roots.push(r);return r}
async function pack(r:string,version='1.0.0',stateVersion=1){return buildPluginPackage(join(root,'tests/fixtures/package-source.ts'),pluginManifestSchema.omit({apiVersion:true,entry:true,codeSha256:true}).parse({id:'test-plugin',kind:'example',label:'Third party example',version,stateVersion,scopesPath:'/options/scopes',methods:['start','poll','identity','probe','members','read','deliver'],stateKinds:['plugin-state','source-cursor'],cursorMode:'scope',tools:[{name:'message_read',description:'Read the admitted message',resource:'message',inputSchema:{type:'object',required:['triggerId'],properties:{triggerId:{type:'string'}},additionalProperties:false}}],configSchema:{type:'object'}}),join(r,'package-'+version))}
function config(r:string,pkg:PluginPackage,options:Record<string,unknown>={}){return configSchema.parse({stateDir:join(r,'state'),work:{sandboxDriver:process.platform==='darwin'?'seatbelt':'bubblewrap'},sources:[{id:'example',kind:'example',cwd:r,allowedActors:['alice'],workspace:{mode:'source'},options:{scopes:['room'],...options}}],sourcePlugins:[{directory:pkg.directory,digest:pkg.digest}]})}
async function isolated(c:Config){const registry=await SourceRegistry.load(c),source=registry.create(c.sources[0]!) as ProcessSource,store=new Store(join(c.stateDir,'test.sqlite')),events:Trigger[]=[];sources.push(source);stores.push(store);source.attach(store,()=>c.sources[0]);const context={store,receive:(t:Trigger)=>{events.push(t);store.triggers.save(t)},bind(){throw Error('denied')},closed(){throw Error('denied')}};await source.start(context);return {source,store,context,events}}
it('packs both reference plugins as self-contained bundles and verifies their manifests',async()=>{
 for(const name of ['feishu','slack']){const r=directory(),pkg=await buildPluginPackage(join(root,'plugins',name,name==='feishu'?'package.ts':'index.ts'),JSON.parse(readFileSync(join(root,'plugins',name,'manifest.json'),'utf8')),join(r,'bundle'));expect(pkg.manifest.kind).toBe(name);expect(readPluginPackage(pkg.directory,pkg.digest).digest).toBe(pkg.digest)}
})
it('loads a third-party package through config alone, persists cursors and resumes after a process restart',async()=>{
 const r=directory(),pkg=await pack(r),c=config(r,pkg),f=await isolated(c)
 await f.source.poll(f.context);expect(f.events).toHaveLength(1);expect(f.store.get('source-cursor','example:room')).toEqual({since:'1'})
 await f.source.close();sources.splice(sources.indexOf(f.source),1)
 const second=(await SourceRegistry.load(c)).create(c.sources[0]!) as ProcessSource;sources.push(second);second.attach(f.store);await second.start(f.context);await second.poll(f.context)
 expect(f.store.get('source-cursor','example:room')).toEqual({since:'2'});expect(f.events[1]!.id).toBe(f.events[0]!.id)
})
it('enforces real OS filesystem isolation and an explicit credential environment',async()=>{
 const r=directory(),pkg=await pack(r),secret=join(r,'private.txt');writeFileSync(secret,'do-not-read')
 process.env.AGENTHUB_TEST_AMBIENT_SECRET='do-not-inherit'
 const f=await isolated(config(r,pkg,{privatePath:secret}))
 expect(await f.source.read({resource:'private',pageSize:1})).toBe('denied')
 expect(await f.source.read({resource:'env',pageSize:1})).toMatchObject({present:false})
})
it('rejects out-of-scope events and host state writes atomically',async()=>{
 for(const options of [{scope:'other'},{badWrite:true}]){const r=directory(),pkg=await pack(r),f=await isolated(config(r,pkg,options));await expect(f.source.poll(f.context)).rejects.toThrow('boundary');expect(f.events).toHaveLength(0);expect(f.store.get('plugin-state','example')).toBeUndefined();expect(f.store.get('source-cursor','other:room')).toBeUndefined()}
})
it('restarts a failed process without accepting late results from the old child',async()=>{
 const r=directory(),pkg=await pack(r),f=await isolated(config(r,pkg))
 await expect(f.source.read({resource:'crash',pageSize:1})).rejects.toThrow('stopped')
 expect(await f.source.identity()).toMatchObject({id:'fixture-bot'})
 await f.source.poll(f.context);expect(f.store.get('source-cursor','example:room')).toEqual({since:'1'})
})
it('blocks revoked scope access and turns an ambiguous reply into an uncertain delivery',async()=>{
 const r=directory(),pkg=await pack(r),c=config(r,pkg,{deliveryCrash:true}),f=await isolated(c)
 await expect(f.source.deliver({id:'reply',channel:{source:'example',thread:'room:root',address:{thread:'room:root'}},text:'test'} as any)).rejects.toThrow('outcome unknown')
 c.sources[0]!.listenScopes=[]
 expect(()=>f.source.context('room:root')).rejects.toThrow('unavailable')
 c.sources[0]!.enabled=false;await expect(f.source.identity()).rejects.toThrow('disabled')
})
it('rejects tampered packages before launching code',async()=>{
 const r=directory(),pkg=await pack(r);writeFileSync(join(pkg.directory,'plugin.mjs'),'throw Error("changed")')
 await expect(SourceRegistry.load(config(r,pkg))).rejects.toThrow('checksum')
})
it('upgrades and rolls back code while retaining state, denies incompatible state and keeps failed settings atomic',async()=>{
 const r=directory(),v1=await pack(r),v2=await pack(r,'1.1.0'),v3=await pack(r,'2.0.0',2)
 const start=async(pkg:PluginPackage)=>{const h=await Runtime.create(config(r,pkg),{model:quiet});hosts.push(h);return h}
 const stop=async(h:Runtime)=>{hosts.splice(hosts.indexOf(h),1);await h.close()}
 let h=await start(v1);h.store.put('plugin-state','example',[{id:'saved',value:'keep'}]);const identity={principal:'fixture-bot',revision:7};h.store.put('source-identity','example',identity);await stop(h)
 h=await start(v2);expect(h.store.get<any>('plugin-installation','example').version).toBe('1.1.0');await stop(h)
 h=await start(v1);expect(h.store.get('plugin-state','example')).toEqual([{id:'saved',value:'keep'}]);expect(h.store.get('source-identity','example')).toMatchObject(identity);const saved=h.settings.current();await stop(h)
 await expect(start(v3)).rejects.toThrow('state protocol');expect(existsSync(join(r,'state/host.lock'))).toBe(false)
 const store=new Store(join(r,'state/state.sqlite'));stores.push(store);expect(store.get('settings','current')).toEqual(saved)
})
it('refuses upgrades with unfinished goals or uncertain side effects',async()=>{
 const r=directory(),v1=await pack(r),v2=await pack(r,'1.1.0'),c=config(r,v1)
 const h=await Runtime.create(c,{model:quiet});h.store.put('router-goal','goal',{id:'goal',state:'held'});await h.close()
 await expect(Runtime.create(config(r,v2),{model:quiet})).rejects.toThrow('Drain')
 const s=new Store(join(r,'state/state.sqlite'));s.put('router-goal','goal',{id:'goal',state:'completed'});s.put('tool-receipt','call',{id:'call',state:'uncertain'});s.close()
 await expect(Runtime.create(config(r,v2),{model:quiet})).rejects.toThrow('reconcile')
})
it('exposes plugin tools through existing Worker grants and reached-trigger authorization',async()=>{
 const r=directory(),pkg=await pack(r),c=config(r,pkg)
 const parsed=configSchema.parse({...c,execution:{workers:[{id:'one',backend:'codex',toolConnections:['plugin-docs']}]},toolConnections:{'plugin-docs':{transport:{kind:'plugin',sourceId:'example'},allowedTools:['message_read']}}})
 const model={async run(request:any){return {threadId:request.threadId??'test-thread',turnId:'test-turn',text:JSON.stringify(request.ephemeral?{action:'accept',title:'Read',scope:'Read plugin message',reason:'requested',rules:[]}:{state:'waiting',summary:'waiting',reply:'',question:null,handbacks:[]})}}}
 const h=await Runtime.create(parsed,{model});hosts.push(h)
 h.receive('example','alice',{id:'tool-input',thread:'room:root',scope:'room',text:'Read plugin',addressed:true})
 for(let i=0;i<200;i++){await h.tick();await new Promise(r=>setTimeout(r,3));if(h.status().tickets[0]?.run?.phase==='idle')break}
 const ticket=h.store.tickets.list().find(t=>t.origin.triggerIds.includes('example:tool-input'))!,owner={ticketId:ticket.id,assignmentId:ticket.assignments.at(-1)!.id,cwd:r,sandbox:'read-only' as const,depth:0}
 expect((await h.toolConnections.catalog(owner))[0]!.tools[0]!.name).toBe('message_read')
 const input={connection:'plugin-docs',tool:'message_read',arguments:{triggerId:'example:tool-input'},requestId:'read-once'}
 const result=await h.toolConnections.call(owner,input);expect(result.success).toBe(true);expect(await h.toolConnections.call(owner,input)).toEqual(result)
 expect(()=>h.toolConnections.call(owner,{...input,arguments:{triggerId:'example:not-admitted'},requestId:'denied'})).toThrow('trigger')
 parsed.sources[0]!.listenScopes=[];expect(()=>h.toolConnections.call(owner,input)).toThrow('scope');parsed.sources[0]!.listenScopes=undefined
 const run=h.store.get<any>('run',ticket.id);h.store.put('run',ticket.id,{...run,agentOptions:{...run.agentOptions,toolConnections:[]}})
 expect(()=>h.toolConnections.call(owner,{...input,requestId:'revoked'})).toThrow('not enabled')
})

it('withholds member results if the scope is revoked while the request runs',async()=>{
 const r=directory(),pkg=await pack(r),c=config(r,pkg),f=await isolated(c)
 const result=f.source.members('room');setTimeout(()=>{c.sources[0]!.listenScopes=[]},40)
 await expect(result).rejects.toThrow(/revoked|unavailable/i)
})
it('keeps source operations available after more than 12 MB of durable history',async()=>{
 const r=directory(),pkg=await pack(r),f=await isolated(config(r,pkg))
 for(let i=0;i<150;i++){const t=f.source.trigger({id:'history-'+i,thread:'room:'+i,scope:'room',text:'x'.repeat(90000),addressed:false},'unadmitted');f.store.triggers.save(t)}
 await expect(f.source.identity()).resolves.toMatchObject({id:'fixture-bot'})
 await f.source.poll(f.context);expect(f.events).toHaveLength(1)
 const history=await f.source.read({resource:'history',pageSize:100});expect(history.count).toBe(151);expect(history.pages).toBeGreaterThan(12)
})

it('commits a backlog exceeding ten thousand operations in bounded acknowledged batches',async()=>{
 const r=directory(),pkg=await pack(r),f=await isolated(config(r,pkg,{bulk:6000}))
 await f.source.poll(f.context);expect(f.events).toHaveLength(6000)
 expect(f.store.get<any[]>('plugin-state','example')!.find(x=>x.id==='bulk')!.value).toBe(5999)
})
it('preserves explicitly configured read paths when staging a package upgrade and rollback',async()=>{
 const {pluginCommand}=await import('../src/plugin-cli.ts'),r=directory(),v1=await pack(r),v2=await pack(r,'1.1.0'),c=config(r,v1)
 const path=join(r,'authorized.txt');writeFileSync(path,'test');c.sourcePlugins[0]={...c.sourcePlugins[0]!,readPaths:[path]}
 const initial=join(r,'initial.json'),staged=join(r,'upgrade.json'),back=join(r,'rollback.json');writeFileSync(initial,JSON.stringify(c))
 await pluginCommand(['stage',initial,v2.directory,v2.digest,staged]);await pluginCommand(['stage',staged,v1.directory,v1.digest,back])
 expect(JSON.parse(readFileSync(back,'utf8')).sourcePlugins[0].readPaths).toEqual([path])
})

it('filters paged thread history by the requested scope and refuses foreign source queries',async()=>{
 const r=directory(),pkg=await pack(r),f=await isolated(config(r,pkg,{scopes:['room','other']}))
 for(const scope of ['room','other'])f.store.put('thread','example:'+scope,{ref:{source:'example',id:scope+':root'},subscriptions:['task']})
 expect((await f.source.read({resource:'threads',pageSize:100})).items.map((r:any)=>r.value.ref.id)).toEqual(['room:root'])
 await expect(f.source.read({resource:'foreign',pageSize:1})).rejects.toThrow('boundary')
})
