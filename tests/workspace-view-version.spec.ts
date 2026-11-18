import {mkdtempSync,writeFileSync,readFileSync,rmSync,renameSync,symlinkSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {afterEach,it,expect} from 'vitest'
import {buildViewPackage,installViewPackage,viewArtifactReference,viewVersion} from '../src/workspace-view-package.ts'
import {boardRuntime} from './fixtures/agent-board-runtime.ts'
import {serve} from '../src/server.ts'
import type {Runtime} from '../src/runtime.ts'

const roots:string[]=[],hosts:Runtime[]=[],closers:(()=>Promise<void>)[]=[]
afterEach(async()=>{for(const close of closers.splice(0))await close();for(const host of hosts.splice(0))await host.close();for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true})})
function fixture(){const root=mkdtempSync(join(tmpdir(),'view-version-'));roots.push(root);const host=boardRuntime(root);hosts.push(host);return {root,host}}
async function pack(root:string,version:string,id='example-view'){
 const entry=join(root,id+'-'+version+'.ts');writeFileSync(entry,'document.body.textContent="'+version+'";')
 return buildViewPackage(entry,{category:'workspace-view',id,version,label:{en:version,'zh-CN':version},capabilities:['workspace.runtime.read']},join(root,id+'-'+version))
}
function mount(host:Runtime,pkg:Awaited<ReturnType<typeof pack>>){host.config.viewPlugins=[{id:pkg.manifest.id,directory:pkg.directory,digest:pkg.digest,enabled:true}]}
async function versions(){
 const {root,host}=fixture(),original=await pack(root,'1.0.0')
 const v1=installViewPackage(original.directory,host.config.stateDir,original.digest),v2=await pack(root,'2.0.0')
 mount(host,v2);return {root,host,v1,v2}
}

it('resolves exact retained metadata after upgrade and rollback without exposing code or paths',async()=>{
 const {host,v1,v2}=await versions()
 const old=viewVersion(host.config,v1.manifest.id,v1.digest)
 expect(old).toEqual({reference:viewArtifactReference(v1),label:v1.manifest.label,packageVersion:'1.0.0',current:false})
 expect(JSON.stringify(old)).not.toContain('document.body');expect(old).not.toHaveProperty('directory');expect(old).not.toHaveProperty('capabilities')
 expect(viewVersion(host.config,v2.manifest.id,v2.digest).current).toBe(true)
 mount(host,v1);expect(viewVersion(host.config,v1.manifest.id,v1.digest).current).toBe(true)
 expect(()=>viewVersion(host.config,v2.manifest.id,v2.digest)).toThrow() // not retained in the object store
})
it('rechecks current access and rejects missing, changed, removed and wrong-ID objects',async()=>{
 const {root,host,v1,v2}=await versions()
 for(const version of ['0'.repeat(64),'../'+v1.digest,'',v1.digest.toUpperCase()])expect(()=>viewVersion(host.config,v1.manifest.id,version)).toThrow()
 const other=await pack(root,'1.0.0','other-view');installViewPackage(other.directory,host.config.stateDir,other.digest)
 expect(()=>viewVersion(host.config,v1.manifest.id,other.digest)).toThrow()
 host.config.viewPlugins[0]!.enabled=false;expect(()=>viewVersion(host.config,v1.manifest.id,v1.digest)).toThrow()
 host.config.viewPlugins=[];expect(()=>viewVersion(host.config,v1.manifest.id,v1.digest)).toThrow()
 mount(host,v2);writeFileSync(join(v2.directory,'view.js'),'changed');expect(()=>viewVersion(host.config,v1.manifest.id,v1.digest)).toThrow()
 writeFileSync(join(v2.directory,'view.js'),v2.code);writeFileSync(join(v1.directory,'view.js'),'changed');expect(()=>viewVersion(host.config,v1.manifest.id,v1.digest)).toThrow()
 rmSync(v1.directory,{recursive:true});expect(()=>viewVersion(host.config,v1.manifest.id,v1.digest)).toThrow()
})
it('does not follow historical object directory symlinks or search another workspace',async()=>{
 const {host,v1,v2}=await versions(),other=fixture();mount(other.host,v2)
 expect(()=>viewVersion(other.host.config,v1.manifest.id,v1.digest)).toThrow()
 const original=v1.directory+'-moved';renameSync(v1.directory,original);symlinkSync(original,v1.directory)
 expect(()=>viewVersion(host.config,v1.manifest.id,v1.digest)).toThrow()
 rmSync(v1.directory);renameSync(original,v1.directory)
 const objects=join(host.config.stateDir,'plugins','objects');renameSync(objects,objects+'-moved');symlinkSync(objects+'-moved',objects)
 expect(()=>viewVersion(host.config,v1.manifest.id,v1.digest)).toThrow()
})
it('requires operator auth, rejects ambiguous queries, and leaves historical execution unavailable',async()=>{
 const {host,v1,v2}=await versions(),server=await serve(host)
 closers.push(()=>new Promise<void>(resolve=>{server.server.closeAllConnections();server.server.close(()=>resolve())}))
 const base=server.url+'/api/workspace-views/example-view',path=base+'/versions/'+v1.digest,headers={authorization:'Bearer '+readFileSync(server.tokenPath,'utf8').trim()}
 expect((await fetch(path)).status).toBe(401)
 const response=await fetch(path,{headers});expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toBe('no-store')
 expect(await response.json()).toEqual({reference:viewArtifactReference(v1),label:v1.manifest.label,packageVersion:'1.0.0',current:false})
 expect((await fetch(path,{headers,method:'POST'})).status).toBe(405)
 expect((await fetch(path+'?digest='+v2.digest,{headers})).status).toBe(400)
 expect((await fetch(base+'/versions/not-a-digest',{headers})).status).toBe(404)
 for(const action of ['bundle','runtime'])expect((await fetch(base+'/'+action+'?digest='+v1.digest,{headers})).status).toBe(404)
 expect((await fetch(base+'/bundle?digest='+v2.digest,{headers})).status).toBe(200)
 host.config.viewPlugins=[]
 expect((await fetch(path,{headers})).status).toBe(404)
})

it('rejects retained manifest tampering and a symlinked plugins parent',async()=>{
 const {host,v1}=await versions(),manifest=join(v1.directory,'manifest.json'),original=readFileSync(manifest,'utf8')
 writeFileSync(manifest,JSON.stringify({...JSON.parse(original),version:'9.0.0'}))
 expect(()=>viewVersion(host.config,v1.manifest.id,v1.digest)).toThrow()
 writeFileSync(manifest,original)
 const plugins=join(host.config.stateDir,'plugins');renameSync(plugins,plugins+'-moved');symlinkSync(plugins+'-moved',plugins)
 expect(()=>viewVersion(host.config,v1.manifest.id,v1.digest)).toThrow()
})
