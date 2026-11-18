import {afterEach,expect,it,vi} from 'vitest'
import {mkdtempSync,writeFileSync,rmSync,symlinkSync,renameSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {spawnSync} from 'node:child_process'
import {buildViewPackage,readViewPackage} from '../src/workspace-view-package.ts'
const hooks=vi.hoisted(()=>({afterRead:null as null|(()=>void),beforeRead:null as null|(()=>void)}))
vi.mock('node:fs',async importOriginal=>{
 const fs=await importOriginal<typeof import('node:fs')>()
 return {...fs,openSync(...args:Parameters<typeof fs.openSync>){hooks.beforeRead?.();hooks.beforeRead=null;return fs.openSync(...args)},readSync(...args:any[]){const count=(fs.readSync as any)(...args);hooks.afterRead?.();hooks.afterRead=null;return count}}
})
const roots:string[]=[]
afterEach(()=>{hooks.afterRead=null;hooks.beforeRead=null;for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true})})
async function fixture(){const root=mkdtempSync(join(tmpdir(),'view-files-'));roots.push(root);const entry=join(root,'entry.ts');writeFileSync(entry,'document.body.textContent="verified"');const pkg=await buildViewPackage(entry,{category:'workspace-view',id:'board',version:'1.0.0',label:{en:'Board','zh-CN':'看板'},capabilities:[]},join(root,'package'));return {root,pkg}}
it('reads verified packages and refuses symlink files and oversized manifests',async()=>{
 const {root,pkg}=await fixture();expect(readViewPackage(pkg.directory,pkg.digest).code).toBe(pkg.code)
 const manifest=join(pkg.directory,'manifest.json'),saved=join(root,'saved.json');renameSync(manifest,saved);symlinkSync(saved,manifest);expect(()=>readViewPackage(pkg.directory,pkg.digest)).toThrow();rmSync(manifest);writeFileSync(manifest,' '.repeat(16385));expect(()=>readViewPackage(pkg.directory,pkg.digest)).toThrow()
})
it('refuses FIFO package files without waiting for a writer',{timeout:5000},async()=>{
 if(process.platform==='win32')return
 const {pkg}=await fixture(),manifest=join(pkg.directory,'manifest.json');rmSync(manifest)
 const result=spawnSync('mkfifo',[manifest]);expect(result.status).toBe(0)
 expect(()=>readViewPackage(pkg.directory,pkg.digest)).toThrow()
})
it('rejects a file substituted with a symlink immediately before opening',async()=>{
 const {root,pkg}=await fixture(),manifest=join(pkg.directory,'manifest.json'),saved=join(root,'saved.json')
 hooks.beforeRead=()=>{renameSync(manifest,saved);symlinkSync(saved,manifest)}
 expect(()=>readViewPackage(pkg.directory,pkg.digest)).toThrow()
})
it('rejects bytes changed while the descriptor is being read',async()=>{
 const {pkg}=await fixture(),manifest=join(pkg.directory,'manifest.json')
 hooks.afterRead=()=>writeFileSync(manifest,'{}')
 expect(()=>readViewPackage(pkg.directory,pkg.digest)).toThrow('changed')
})
