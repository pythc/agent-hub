import {mkdtempSync,rmSync,readFileSync,writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {randomUUID} from 'node:crypto'
import {gzipSync,gunzipSync} from 'node:zlib'
import {it,expect,afterEach} from 'vitest'
import {Runtime} from '../src/runtime.ts'
import {configSchema} from '../src/config.ts'
import {PluginMarket} from '../src/plugin-market.ts'
import {marketState,recoverMarket,loadMarketConfig} from '../src/plugin-market-state.ts'
import {compareVersion,latestCompatible} from '../src/plugin-market-contract.ts'
import {PluginGitHub,githubLocation} from '../src/plugin-github.ts'
import {extractPluginArchive} from '../src/plugin-archive.ts'
import {marketFixture} from './fixtures/plugin-market.ts'
import {serve} from '../src/server.ts'
import {backupState,verifyBackup,restoreState} from '../src/backup.ts'
const roots:string[]=[],hosts:Runtime[]=[],closers:(()=>Promise<void>)[]=[]
const model={async run(){throw Error('No model calls in marketplace tests')}}
afterEach(async()=>{for(const close of closers.splice(0))await close();for(const h of hosts.splice(0))if(h.store.db.isOpen)await h.close();for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true})})
async function fixture(){
  const root=mkdtempSync(join(tmpdir(),'roppo-market-'));roots.push(root)
  const config=configSchema.parse({stateDir:join(root,'state'),port:0,sources:[{id:'local',kind:'local',cwd:root,allowedActors:['operator']}]})
  let host=new Runtime(configSchema.parse(config),{model});hosts.push(host)
  const github=await marketFixture(root),market=new PluginMarket(()=>host,github.github)
  await market.catalogs({url:'https://github.com/acme/plugins'})
  const catalog=()=>marketState(host.store).catalogs.find(c=>c.origin?.repositoryId===42)!
  const rebuild=async(next:any,id?:string)=>{if(host.store.db.isOpen)await host.close();host=await Runtime.create(next,{model,pluginActivation:id});hosts.push(host)}
  const execute=async(action:any,id='agent-board',version?:string)=>{const plan=market.plan({action,pluginId:id,catalogId:catalog().id,version,revision:market.snapshot().revision});return market.execute(plan.id,randomUUID(),rebuild)}
  return {root,config,host:()=>host,market,github,catalog,rebuild,execute}
}
it('installs, upgrades and rolls back a view, survives restart, and never changes task state',async()=>{
  const f=await fixture();f.host().store.put('sentinel','task',{receipt:'uncertain'})
  await f.execute('install');expect(f.host().config.viewPlugins[0]?.digest).toBe(f.github.one.pkg.digest)
  const v2=await f.github.add('workspace-view','1.1.0');f.github.changed();await f.market.catalogs({url:f.catalog().url})
  expect(f.market.snapshot().installed[0]?.update?.version).toBe('1.1.0')
  await f.execute('install');expect(f.host().config.viewPlugins[0]?.digest).toBe(v2.pkg.digest)
  await f.execute('rollback');expect(f.host().config.viewPlugins[0]?.digest).toBe(f.github.one.pkg.digest)
  await f.rebuild(configSchema.parse(f.config));expect(f.host().config.viewPlugins[0]?.digest).toBe(f.github.one.pkg.digest)
  expect(f.host().store.get('sentinel','task')).toEqual({receipt:'uncertain'})
  await f.execute('disable');expect(f.host().config.viewPlugins).toEqual([])
  await f.execute('enable');expect(f.host().config.viewPlugins).toHaveLength(1)
  await f.execute('uninstall');await f.rebuild(configSchema.parse(f.config));expect(f.host().config.viewPlugins).toEqual([])
})
it('locks plans to settings and catalog revisions, and replays a completed request without downloading twice',async()=>{
  const f=await fixture(),plan=f.market.plan({action:'install',pluginId:'agent-board',catalogId:f.catalog().id,revision:f.market.snapshot().revision}),id=randomUUID()
  const result=await f.market.execute(plan.id,id,f.rebuild),count=f.github.requests.length
  expect(await f.market.execute(plan.id,id,f.rebuild)).toEqual(result);expect(f.github.requests).toHaveLength(count)
  await expect(f.market.execute(randomUUID(),id,f.rebuild)).rejects.toThrow('another operation')
  const stale=f.market.plan({action:'disable',pluginId:'agent-board',revision:f.market.snapshot().revision})
  f.host().settings.save(f.host().settings.current().revision,{effort:'medium'})
  await expect(f.market.execute(stale.id,randomUUID(),f.rebuild)).rejects.toThrow('Configuration changed')
})
it('retains installed plugins and cached catalogs offline, and rejects changed bytes for the same version',async()=>{
  const f=await fixture();await f.execute('install');f.github.offline(true)
  await f.market.catalogs({url:f.catalog().url});expect(f.catalog().plugins).toHaveLength(2);expect(f.catalog().error).toContain('unavailable');expect(f.market.snapshot().installed[0]?.enabled).toBe(true)
  f.github.offline(false);f.github.one.plugin.releases[0]!.sha256='0'.repeat(64);f.github.changed()
  await f.market.catalogs({url:f.catalog().url});expect(f.catalog().error).toContain('changed bytes');expect(f.catalog().plugins[0]!.releases[0]!.sha256).not.toBe('0'.repeat(64))
})
it('rejects archive tampering and permission changes without replacing the active view',async()=>{
  const f=await fixture();await f.execute('install');const v2=await f.github.add('workspace-view','1.1.0');f.github.changed();await f.market.catalogs({url:f.catalog().url})
  f.github.files.set(v2.release.assetId,Buffer.from('tampered'))
  await expect(f.execute('install')).rejects.toThrow('checksum mismatch');expect(f.host().config.viewPlugins[0]?.digest).toBe(f.github.one.pkg.digest)
  f.github.files.set(v2.release.assetId,v2.archive);v2.release.permissions=[];f.github.changed();await f.market.catalogs({url:f.catalog().url})
  await expect(f.execute('install')).rejects.toThrow('permissions differ');expect(f.host().config.viewPlugins[0]?.digest).toBe(f.github.one.pkg.digest)
})
it('downloads source updates separately, blocks activation on unfinished work and prevents uninstall with connections',async()=>{
  const f=await fixture();await f.execute('install','test-connector');expect(f.host().config.sourcePlugins).toHaveLength(0)
  f.host().store.put('router-goal','busy',{state:'running'})
  await expect(f.execute('activate','test-connector')).rejects.toThrow('waiting for');expect(f.host().config.sourcePlugins).toHaveLength(0)
  f.host().store.put('router-goal','busy',{state:'completed'});await f.execute('activate','test-connector')
  expect(f.host().sourceRegistry.catalog().some(p=>p.kind==='markettest')).toBe(true)
  f.host().config.sources.push(configSchema.shape.sources.element.parse({id:'test',kind:'markettest',cwd:f.root,options:{channels:['one']}}))
  expect(()=>f.market.plan({action:'uninstall',pluginId:'test-connector',revision:f.market.snapshot().revision})).toThrow('configured connections')
})
it('restores references and source installation records after failed or interrupted activation',async()=>{
  const f=await fixture();await f.execute('install','test-connector');const old=marketState(f.host().store),settings=f.host().settings.current()
  const plan=f.market.plan({action:'activate',pluginId:'test-connector',revision:old.revision})
  let calls=0;await expect(f.market.execute(plan.id,randomUUID(),async(c,id)=>{calls++;if(calls===1){await f.host().close();throw Error('Restart failure')}await f.rebuild(c,id)})).rejects.toThrow('Restart failure')
  expect(f.host().config.sourcePlugins).toHaveLength(0);expect(f.host().store.get('plugin-market-activation','current')).toBeUndefined()
  const state=marketState(f.host().store);state.installed[0]!.active=state.installed[0]!.selected;state.installed[0]!.enabled=true
  f.host().store.put('plugin-market','current',state);f.host().store.put('plugin-market-activation','current',{id:'interrupted',previous:old,settings,paused:false,installations:[]})
  const boot=configSchema.parse(f.config);loadMarketConfig(boot);expect(boot.sourcePlugins).toHaveLength(0)
  recoverMarket(f.host().store);expect(marketState(f.host().store).installed[0]?.enabled).toBe(false)
})
it('rejects path traversal, links, duplicate archive entries and invalid tar checksums',async()=>{
  const f=await fixture(),raw=gunzipSync(f.github.one.archive)
  for(const kind of ['path','link','checksum']){
    const bytes=Buffer.from(raw);if(kind==='path'){bytes.fill(0,0,100);bytes.write('../manifest.json')}if(kind==='link')bytes.write('2',156)
    if(kind!=='checksum'){bytes.fill(32,148,156);bytes.write([...bytes.subarray(0,512)].reduce((a,b)=>a+b,0).toString(8).padStart(6,'0')+'\0 ',148)}else bytes[200]=5
    expect(()=>extractPluginArchive(gzipSync(bytes),join(f.root,'bad-'+kind))).toThrow()
  }
})
it('uses compatible stable semver, accepts directory URLs and never forwards GitHub credentials to asset hosts',async()=>{
  expect(compareVersion('1.0.0-rc.10','1.0.0-rc.2')).toBe(1);expect(compareVersion('1.0.0','1.0.0-rc.2')).toBe(1)
  expect(githubLocation('https://github.com/acme/plugins/tree/main/plugins/board')).toMatchObject({repository:'acme/plugins',ref:'main',path:'plugins/board/catalog.json'})
  expect(()=>githubLocation('https://github.com@localhost/a/b')).toThrow()
  const f=await fixture();f.github.one.plugin.releases.push({...f.github.one.release,version:'2.0.0',hostMin:'9.0.0'},{...f.github.one.release,version:'3.0.0-rc.1'})
  expect(latestCompatible(f.github.one.plugin)?.version).toBe('1.0.0')
  process.env.ROPPO_MARKET_TEST_TOKEN='test-secret'
  try{await f.github.github.download(f.catalog().origin!,f.github.one.release,'ROPPO_MARKET_TEST_TOKEN');expect(f.github.requests.find(r=>r.url.includes('release-assets'))!.headers.has('authorization')).toBe(false)}finally{delete process.env.ROPPO_MARKET_TEST_TOKEN}
})
it('protects marketplace routes with operator authentication and origin checks, and serves a real installed bundle',async()=>{
  const f=await fixture(),server=await serve(f.host(),{pluginGitHub:f.github.github});closers.push(async()=>{server.server.closeAllConnections();await new Promise<void>(r=>server.server.close(()=>r()));await server.closeRuntime()})
  expect((await fetch(server.url+'/api/plugin-market')).status).toBe(401)
  const headers={authorization:'Bearer '+readFileSync(server.tokenPath,'utf8').trim(),'content-type':'application/json'}
  expect((await fetch(server.url+'/api/plugin-market/catalogs',{method:'POST',headers:{...headers,origin:'https://other.test'},body:'{}'})).status).toBe(403)
  const snapshot=await (await fetch(server.url+'/api/plugin-market',{headers})).json();expect(snapshot.platform).toBe(process.platform)
  await f.execute('install')
  const bundle=await fetch(server.url+'/api/workspace-views/agent-board/bundle?digest='+f.github.one.pkg.digest,{headers});expect(bundle.status).toBe(200);expect((await bundle.json()).code).toContain('Installed view')
})
it('includes retained plugin versions in verified backups and restores to a different state directory',async()=>{
  const f=await fixture();await f.execute('install');const backup=join(f.root,'backup')
  await backupState(f.host().config,backup);expect(verifyBackup(backup).format).toBe(1)
  const destination=configSchema.parse({...f.config,stateDir:join(f.root,'restored')})
  await restoreState(destination,backup)
  const restored=await Runtime.create(destination,{model});hosts.push(restored)
  expect(restored.config.viewPlugins[0]?.directory).toContain('/restored/plugins/objects/')
  expect(restored.config.viewPlugins[0]?.digest).toBe(f.github.one.pkg.digest)
  writeFileSync(join(backup,'plugins','objects',f.github.one.pkg.digest,'view.js'),'tampered')
  expect(()=>verifyBackup(backup)).toThrow('checksum')
})
it('updates and rolls back a connector shared by two sources without rewinding cursors or delivery receipts',async()=>{
  const f=await fixture();await f.execute('install','test-connector');await f.execute('activate','test-connector')
  const config=configSchema.parse(f.host().config)
  for(const id of ['alpha','beta'])config.sources.push(configSchema.shape.sources.element.parse({id,kind:'markettest',cwd:f.root,options:{channels:[id]}}))
  await f.rebuild(config)
  f.host().store.put('source-cursor','alpha:alpha',{cursor:'2026-11-09T12:00:00Z'});f.host().store.put('source-cursor','beta:beta',{cursor:'later'});f.host().store.put('tool-receipt','sent',{state:'completed',effectId:'keep'})
  await f.github.add('source','1.1.0');f.github.changed();await f.market.catalogs({url:f.catalog().url})
  await f.execute('install','test-connector');expect(f.host().sourceRegistry.packages[0]?.manifest.version).toBe('1.0.0')
  await f.execute('activate','test-connector');expect(f.host().sourceRegistry.packages[0]?.manifest.version).toBe('1.1.0')
  await f.execute('rollback','test-connector');expect(f.host().sourceRegistry.packages[0]?.manifest.version).toBe('1.0.0')
  expect(f.host().store.get('source-cursor','alpha:alpha')).toEqual({cursor:'2026-11-09T12:00:00Z'})
  expect(f.host().store.get('tool-receipt','sent')).toEqual({state:'completed',effectId:'keep'})
  expect(f.host().store.list('plugin-installation')).toHaveLength(2)
})
it('does not allow a second repository to take over an installed ID or a manual configuration',async()=>{
  const f=await fixture();await f.execute('install');const state=marketState(f.host().store),other={...f.catalog(),id:'other',origin:{...f.catalog().origin!,repositoryId:99}}
  state.catalogs.push(other);f.host().store.put('plugin-market','current',state)
  expect(()=>f.market.plan({action:'install',pluginId:'agent-board',catalogId:'other',revision:state.revision})).toThrow('different repository')
  await f.execute('uninstall');f.host().config.viewPlugins.push({id:'agent-board',directory:f.github.one.pkg.directory,digest:f.github.one.pkg.digest,enabled:true})
  expect(()=>f.market.plan({action:'install',pluginId:'agent-board',catalogId:f.catalog().id,revision:f.market.snapshot().revision})).toThrow('startup configuration')
})
it('serializes downloads and rejects configuration changes made while network I/O was pending',async()=>{
  const f=await fixture(),download=f.github.github.download.bind(f.github.github)
  let release!:()=>void,started!:()=>void
  const began=new Promise<void>(r=>{started=r}),gate=new Promise<void>(r=>{release=r})
  f.github.github.download=async(...args)=>{started();await gate;return download(...args)}
  const plan=f.market.plan({action:'install',pluginId:'agent-board',catalogId:f.catalog().id,revision:f.market.snapshot().revision})
  const request=f.market.execute(plan.id,randomUUID(),f.rebuild);await began
  expect(()=>f.market.plan({action:'install',pluginId:'agent-board',catalogId:f.catalog().id,revision:f.market.snapshot().revision})).toThrow('operation is running')
  f.host().settings.save(f.host().settings.current().revision,{effort:'low'});release()
  await expect(request).rejects.toThrow('Configuration changed');expect(f.market.snapshot().installed).toHaveLength(0)
})
it('keeps GET inventory free of network effects and obeys GitHub ETag and rate limit responses',async()=>{
  const f=await fixture(),count=f.github.requests.length;f.market.snapshot();f.market.snapshot();expect(f.github.requests).toHaveLength(count)
  await f.market.catalogs({url:f.catalog().url});expect(f.github.requests.some(r=>r.headers.has('if-none-match'))).toBe(true)
  let calls=0;const github=new PluginGitHub(async()=>{calls++;return new Response('{}',{status:429,headers:{'retry-after':'60'}})})
  await expect(github.catalog({url:'https://github.com/acme/plugins'})).rejects.toThrow('429')
  await expect(github.catalog({url:'https://github.com/acme/plugins'})).rejects.toThrow('rate limit');expect(calls).toBe(1)
})
