import {mkdtempSync,readFileSync,writeFileSync,rmSync,symlinkSync,renameSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {afterEach,it,expect} from 'vitest'
import {buildViewPackage,readViewPackage,installViewPackage,viewCatalog,enabledView} from '../src/workspace-view-package.ts'
import {configSchema,loadConfig} from '../src/config.ts'
import {workspaceViewData} from '../src/workspace-view-data.ts'
import {pluginCommand} from '../src/plugin-cli.ts'
import {serve} from '../src/server.ts'
import {boardRuntime,seedBoard} from './fixtures/agent-board-runtime.ts'
import {Settings} from '../src/settings.ts'
import type {Runtime} from '../src/runtime.ts'
import {parseViewCommand,viewDestination,viewDocument} from '../web/chat/workspace-view-bridge.ts'

const roots:string[]=[],hosts:Runtime[]=[],servers:(()=>Promise<void>)[]=[]
afterEach(async()=>{for(const close of servers.splice(0))await close();for(const host of hosts.splice(0))await host.close();for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true})})
const directory=()=>{const root=mkdtempSync(join(tmpdir(),'roppo-view-'));roots.push(root);return root}
const manifest={category:'workspace-view',id:'example-view',version:'1.0.0',label:{en:'Example view','zh-CN':'示例视图'},capabilities:['workspace.runtime.read']}
async function pack(root:string,version='1.0.0',capabilities=['workspace.runtime.read']){
  const entry=join(root,'entry-'+version+'.ts');writeFileSync(entry,'document.body.textContent="View";')
  return buildViewPackage(entry,{...manifest,version,capabilities},join(root,'package-'+version))
}
function fixture(root=directory()){const host=boardRuntime(root);hosts.push(host);return host}
it('packs a browser-only view, independently installs immutable bytes, and dispatches inspect',async()=>{
  const root=directory(),pkg=await pack(root),installed=installViewPackage(pkg.directory,join(root,'state'),pkg.digest)
  expect(installed.directory).toContain('/plugins/objects/'+pkg.digest)
  expect(installed.code).toContain('document.body.textContent')
  expect(await pluginCommand(['inspect',installed.directory])).toMatchObject({digest:pkg.digest,manifest:{category:'workspace-view',apiVersion:1}})
  expect(await pluginCommand(['inspect',installed.directory])).not.toHaveProperty('code')
  expect(installViewPackage(pkg.directory,join(root,'state'),pkg.digest).directory).toBe(installed.directory)
})
it('refuses changed bytes, manifest digests, symlinks and unknown capabilities',async()=>{
  const root=directory(),pkg=await pack(root),path=join(pkg.directory,'view.js')
  writeFileSync(path,pkg.code+'//tampered');expect(()=>readViewPackage(pkg.directory,pkg.digest)).toThrow('checksum')
  writeFileSync(path,pkg.code);expect(()=>readViewPackage(pkg.directory,'0'.repeat(64))).toThrow('digest')
  renameSync(path,path+'.real');symlinkSync(path+'.real',path);expect(()=>readViewPackage(pkg.directory)).toThrow('file')
  await expect(pack(root,'1.1.0',['filesystem.read'])).rejects.toThrow()
})
it('validates package size, duplicate references and resolved paths without loading disabled packages',async()=>{
  const root=directory(),host=fixture(root),ref={id:'example-view',directory:'missing',digest:'0'.repeat(64),enabled:false}
  host.config.viewPlugins=[ref];expect(viewCatalog(host.config)).toEqual([])
  expect(()=>enabledView(host.config,ref.id)).toThrow('unavailable')
  expect(()=>configSchema.parse({...host.config,viewPlugins:[ref,ref]})).toThrow('Duplicate')
  const file=join(root,'config.json');writeFileSync(file,JSON.stringify(host.config));expect(loadConfig(file).viewPlugins[0]!.directory).toBe(join(root,'missing'))
  const pkg=await pack(root);writeFileSync(join(pkg.directory,'view.js'),' '.repeat(2_000_001));expect(()=>readViewPackage(pkg.directory)).toThrow('file')
})
it('stages upgrade and rollback against latest config while preserving settings, source references and task state',async()=>{
  const root=directory(),host=fixture(root),v1=await pack(root),v2=await pack(root,'1.1.0'),initial=join(root,'initial.json'),up=join(root,'up.json'),back=join(root,'back.json')
  host.config.sourcePlugins=[{module:join(root,'source.ts')}]
  writeFileSync(initial,JSON.stringify(host.config));host.store.put('sentinel','task',{state:'running',receipt:'uncertain'})
  host.settings.save(0,{effort:'high'})
  await pluginCommand(['stage',initial,v2.directory,v2.digest,up])
  const latest=loadConfig(up);latest.model='latest-config-model';writeFileSync(up,JSON.stringify(latest))
  await pluginCommand(['stage',up,v1.directory,v1.digest,back])
  const restored=loadConfig(back)
  expect(restored.model).toBe('latest-config-model');expect(restored.sourcePlugins).toEqual(host.config.sourcePlugins)
  expect(restored.viewPlugins[0]!.digest).toBe(v1.digest)
  const settings=new Settings(host.store,restored)
  expect(settings.current().revision).toBe(1);expect(settings.current().config.effort).toBe('high');expect(settings.current().config.viewPlugins[0]!.digest).toBe(v1.digest)
  expect(host.store.get('sentinel','task')).toEqual({state:'running',receipt:'uncertain'})
  await expect(pluginCommand(['stage',up,v1.directory,v1.digest,back])).rejects.toThrow('new file')
})
it('provides bounded sanitized projection with true source filtering and pagination',()=>{
  const host=fixture();seedBoard(host,130)
  const snapshot=workspaceViewData(host,{})
  expect(snapshot.tasks).toMatchObject({total:130,offset:0,limit:25,more:true});expect(snapshot.tasks.items).toHaveLength(25)
  expect(snapshot.listening.admissions).toHaveLength(100);expect(snapshot.listening.batches.length).toBeLessThanOrEqual(50)
  expect(JSON.stringify(snapshot)).not.toMatch(/PRIVATE_|\/private\/fixture|agentOptions|instructions|credentials/)
  const filtered=workspaceViewData(host,{source:'personal',offset:25});expect(filtered.tasks.items.every(t=>t.sourceId==='personal')).toBe(true);expect(filtered.tasks.total).toBe(44);expect(filtered.tasks.items).toHaveLength(19)
  expect(filtered.counts.running).toBe(1);expect(filtered.team.workers[1]!.active).toBe(0)
  expect(filtered.listening.admissions.every(a=>a.sourceId==='personal')).toBe(true)
  expect(workspaceViewData(host,{state:'attention',search:'onboarding'}).tasks.total).toBe(1)
  expect(()=>workspaceViewData(host,{source:'unknown'})).toThrow('Unknown')
})
it('keeps failure evidence after recovery and separates real active execution, task state and paused host',()=>{
  const host=fixture();seedBoard(host)
  const snapshot=workspaceViewData(host,{})
  expect(snapshot.calls.items.filter(c=>c.name==='read_document').map(c=>c.state).sort()).toEqual(['completed','failed'])
  expect(snapshot.counts).toMatchObject({running:2,attention:2,queued:2,closed:26})
  expect(snapshot.team.router.active).toBe(1);expect(snapshot.team.workers[0]!.active).toBe(1)
  host.pause(true);expect(workspaceViewData(host,{}).paused).toBe(true)
  const task=host.store.tickets.get('board-task-0')!;host.store.put('run',task.id,{phase:'interrupted',workerId:'retired-worker',ticketId:task.id})
  expect(workspaceViewData(host,{}).tasks.items.find(t=>t.id===task.id)!.workerId).toBe('retired-worker')
  expect(workspaceViewData(host,{}).team.workers[0]!.active).toBe(0)
})
it('reports partial auxiliary usage, excludes probes and never attributes global usage to one source',()=>{
  const host=fixture();seedBoard(host)
  expect(workspaceViewData(host,{source:'personal'}).decision).toMatchObject({scope:'workspace',retained:2,probesExcluded:1,inputTokens:360,outputTokens:18,inputReported:1,outputReported:1})
  host.store.db.prepare("DELETE FROM records WHERE kind='decision-call'").run()
  expect(workspaceViewData(host,{}).decision).toMatchObject({retained:0,inputTokens:null,outputTokens:null,inputReported:0})
})
it('requires operator auth and current capability/digest, denying tampered or disabled mounted packages',async()=>{
  const root=directory(),host=fixture(root),pkg=await pack(root)
  host.config.viewPlugins=[{id:pkg.manifest.id,directory:pkg.directory,digest:pkg.digest,enabled:true}]
  const server=await serve(host);servers.push(()=>new Promise<void>(resolve=>{server.server.closeAllConnections();server.server.close(()=>resolve())}))
  const headers={authorization:'Bearer '+readFileSync(server.tokenPath,'utf8').trim()},base=server.url+'/api/workspace-views',path='/example-view/runtime?digest='+pkg.digest
  expect((await fetch(base)).status).toBe(401);expect((await fetch(base+path)).status).toBe(401)
  expect(await (await fetch(base,{headers})).json()).toMatchObject({views:[{id:'example-view',available:true}]})
  expect((await fetch(base+path,{headers})).status).toBe(200)
  expect((await fetch(base+path+'&offset=-1',{headers})).status).toBe(400)
  expect((await fetch(base+path+'&unknown=1',{headers})).status).toBe(400)
  expect((await fetch(base+path+'&source=unknown',{headers})).status).toBe(400)
  expect((await fetch(base+'/example-view/runtime',{headers})).status).toBe(400)
  expect((await fetch(base+path,{method:'POST',headers})).status).toBe(405)
  writeFileSync(join(pkg.directory,'view.js'),pkg.code+'//changed');expect((await fetch(base+path,{headers})).status).toBe(404)
  expect(await (await fetch(base,{headers})).json()).toMatchObject({views:[{available:false}]})
  writeFileSync(join(pkg.directory,'view.js'),pkg.code);host.config.viewPlugins[0]!.enabled=false
  expect((await fetch(base+path,{headers})).status).toBe(404);expect(await (await fetch(base,{headers})).json()).toEqual({views:[]})
  const noRead=await pack(root,'1.1.0',[]);host.config.viewPlugins=[{id:noRead.manifest.id,directory:noRead.directory,digest:noRead.digest,enabled:true}]
  expect((await fetch(base+path,{headers})).status).toBe(404)
  expect((await fetch(base+'/example-view/runtime?digest='+noRead.digest,{headers})).status).toBe(403)
})
it('only accepts closed bridge commands and protects iframe bootstrap from markup escape',()=>{
  for(const value of [null,[],{type:'refresh',url:'evil'},{type:'navigate',destination:'javascript:alert(1)'},{type:'query',query:{state:['queued']}},{type:'query',query:{offset:-1}},{type:'query',query:{method:'execute'}},{type:'query',query:{search:'x'.repeat(101)}}])expect(parseViewCommand(value)).toBeUndefined()
  expect(parseViewCommand({type:'query',query:{source:'personal',offset:25,state:'running'}})).toEqual({type:'query',query:{source:'personal',offset:25,state:'running'}})
  expect(viewDestination('constructor')).toBeUndefined();expect(viewDestination('team')).toBe('/configure#execution/configuration')
  const document=viewDocument('const x="</ScRiPt><script>alert(1)</script>"','nonce')
  expect(document.match(/<\/script>/gi)).toHaveLength(1);expect(document).toContain("connect-src 'none'");expect(document).toContain("form-action 'none'")
})
