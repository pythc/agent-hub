import {expect,it} from 'vitest'
import {createProjectOwnership,validateProjectOwnership,checkProjectOwnership,validSharedPath} from '../src/project-ownership.ts'
const policy={testCommand:'true',sharedFiles:['schema.json']}
const snapshot=createProjectOwnership('a'.repeat(40),'integration','owner',policy,policy.sharedFiles)
const tree=(value?:string)=>new Map(value?[['nested/package-lock.json',value]]:[])
const check=(current:ReturnType<typeof tree>,parents:ReturnType<typeof tree>[],node='worker',worker='other')=>checkProjectOwnership(snapshot,node,worker,'ticket','b'.repeat(40),current,parents)
it('freezes canonical shared paths, policy, baseline and integration identity',()=>{
 expect(validateProjectOwnership(snapshot,snapshot.base,'integration','owner',policy,policy.sharedFiles)).toEqual(snapshot)
 for(const field of ['digest','base','integrationWorkerId'] as const)expect(()=>validateProjectOwnership({...snapshot,[field]:'changed'},snapshot.base,'integration','owner',policy,policy.sharedFiles)).toThrow()
 expect(()=>validateProjectOwnership(snapshot,snapshot.base,'integration','other',policy,policy.sharedFiles)).toThrow()
 expect(()=>validateProjectOwnership(snapshot,snapshot.base,'integration','owner',{...policy,testCommand:'new'},policy.sharedFiles)).toThrow()
})
it('rejects ambiguous and non-relative policy paths',()=>{
 for(const path of ['/x','../x','a/../x','a//x','a\\x','./x','C:/x','a\nx',''])expect(validSharedPath(path)).toBe(false)
 expect(validSharedPath('schemas/api.json')).toBe(true)
})
it('checks nested lockfile object identity including mode, deletion and addition',()=>{
 expect(check(tree('100644 blob aaa'),[tree('100644 blob aaa')]).status).toBe('checked')
 for(const next of [undefined,'100755 blob aaa','120000 blob aaa','100644 blob bbb'])expect(()=>check(tree(next),[tree('100644 blob aaa')])).toThrow()
 expect(()=>check(tree('100644 blob aaa'),[tree()])).toThrow()
})
it('does not permit a nonowner to choose either disagreeing parent, including absence',()=>{
 expect(()=>check(tree('100644 blob aaa'),[tree('100644 blob aaa'),tree('100644 blob bbb')])).toThrow()
 expect(()=>check(tree('100644 blob aaa'),[tree('100644 blob aaa'),tree()])).toThrow()
 expect(check(tree('100644 blob ccc'),[tree('100644 blob aaa'),tree('100644 blob bbb')],'integration','owner').checkedPaths).toEqual(['nested/package-lock.json','schema.json'])
 expect(()=>check(tree('100644 blob ccc'),[tree('100644 blob aaa')],'integration','other')).toThrow()
})
it('protects explicit schema but does not pretend unspecified files are protected',()=>{
 expect(()=>check(new Map([['schema.json','a']]),[new Map()])).toThrow()
 expect(check(new Map([['other.json','a']]),[new Map()]).status).toBe('checked')
})
it('marks legacy evidence unknown rather than inventing a responsibility gate',()=>{
 expect(checkProjectOwnership(undefined,'n','w','t','head',tree('new'),[tree('old')])).toMatchObject({status:'legacy_unknown',checkedPaths:[]})
})

import {configSchema} from '../src/config.ts'
import {ProjectCode} from '../src/project-code.ts'
import type {RouterGoal} from '../src/router-goals.ts'
import type {CodeReceipt} from '../src/project-code.ts'
it('requires a complete three-stage policy and literal loopback URL',()=>{
 const parse=(stages:unknown)=>configSchema.parse({sources:[{id:'local',kind:'local',cwd:'/tmp',sandbox:'workspace-write',allowedActors:['alice'],workspace:{mode:'directory',project:{testCommand:'true',stages}}}]})
 const stages={buildCommand:'true',businessCommand:'true',startCheck:{command:'exec node server.js',url:'http://127.0.0.1:9000/ready',timeoutMs:1000}}
 expect(()=>parse(stages)).not.toThrow()
 expect(()=>parse({...stages,businessCommand:undefined})).toThrow()
 for(const url of ['https://127.0.0.1','http://localhost','http://127.0.0.1.evil','http://user@127.0.0.1'])expect(()=>parse({...stages,startCheck:{...stages.startCheck,url}})).toThrow()
})
it('validates persisted receipt identities, responsibility and complete stage binding without effects',()=>{
 const stages={buildCommand:'true',businessCommand:'true',startCheck:{command:'exec node server.js',url:'http://127.0.0.1:9000/ready',timeoutMs:1000}},policy={testCommand:'true',stages}
 const own=createProjectOwnership('a'.repeat(40),'integration','owner',policy)
 const n={id:'integration',workerId:'owner',ticketId:'t',dependsOn:[]}
 const g={id:'g',nodes:[n],project:{base:own.base,integration:'integration',integrationWorkerId:'owner',ownership:own,policy}} as unknown as RouterGoal
 const code=new ProjectCode({} as never,{get:()=>undefined} as never)
 const r:CodeReceipt={id:'r',goalId:'g',ticketId:'t',head:'b'.repeat(40),parents:[own.base],test:{command:'true',exit:0,output:''},ownership:{status:'checked',digest:own.digest,head:'b'.repeat(40),nodeId:'integration',workerId:'owner',ticketId:'t',checkedPaths:[]},stages:['build','start','business'].map((kind,index)=>({kind:kind as 'build'|'start'|'business',command:kind==='start'?'exec node server.js':'true',head:'b'.repeat(40),policyDigest:own.policyDigest,startedAt:index*2,finishedAt:index*2+1,exit:0,output:'',...(kind==='start'?{ready:true}:{})}))}
 expect(()=>code.validateReceipt(g,g.nodes![0]!,r)).not.toThrow()
 for(const patch of [{stages:r.stages!.map(s=>({...s,startedAt:NaN}))},{stages:r.stages!.map(s=>({...s,command:'other'}))},{ticketId:'other'},{parents:[]},{ownership:{...r.ownership!,workerId:'other'}},{stages:r.stages!.slice(0,2)},{stages:r.stages!.map(s=>({...s,policyDigest:'old'}))}])expect(()=>code.validateReceipt(g,g.nodes![0]!,{...r,...patch})).toThrow()
})

import {mkdtempSync,mkdirSync,writeFileSync,rmSync,symlinkSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {execFileSync} from 'node:child_process'
import {startCodeProject} from '../src/project-code.ts'
it('rejects an explicit shared-file directory against the actual baseline Git tree',()=>{
 const cwd=mkdtempSync(join(tmpdir(),'project-ownership-git-'))
 const git=(...args:string[])=>execFileSync('git',args,{cwd,stdio:'pipe'})
 try{
  git('init','-q');git('config','user.name','Test');git('config','user.email','test@example.com');mkdirSync(join(cwd,'schema'));writeFileSync(join(cwd,'schema','a.json'),'{}');git('add','.');git('commit','-qm','base')
  const source=configSchema.parse({sources:[{id:'local',kind:'local',cwd,sandbox:'workspace-write',allowedActors:['alice'],workspace:{mode:'directory',project:{testCommand:'true',sharedFiles:['schema']}}}]}).sources[0]!
  const g={triggerId:'t',nodes:[{id:'one',workerId:'w',dependsOn:[]}],criteria:[]} as unknown as RouterGoal
  expect(()=>startCodeProject(source,g)).toThrow('not directories or links')
  symlinkSync('schema/a.json',join(cwd,'schema-link.json'));git('add','.');git('commit','-qm','link');source.workspace!.project!.sharedFiles=['schema-link.json']
  expect(()=>startCodeProject(source,g)).toThrow('not directories or links')
 }finally{rmSync(cwd,{recursive:true,force:true})}
})

it('requires regular protected files and reserves inherited nonregular repair for integration',()=>{
 for(const object of ['120000 blob aaa','160000 commit aaa','040000 tree aaa']){
  expect(()=>check(tree(object),[tree(object)])).toThrow('regular Git file')
  expect(()=>check(tree('100644 blob aaa'),[tree(object)])).toThrow('integration repair')
  expect(check(tree('100644 blob aaa'),[tree(object)],'integration','owner').status).toBe('checked')
  expect(check(tree(),[tree(object)],'integration','owner').status).toBe('checked')
  expect(()=>check(tree(object),[tree(object)],'integration','owner')).toThrow('regular Git file')
 }
})
it('rejects hidden explicit descendants behind any non-tree ancestor in current or parent trees',()=>{
 const p={testCommand:'true',sharedFiles:['schema/api.json']},o=createProjectOwnership('a','integration','owner',p,p.sharedFiles)
 for(const object of ['120000 blob aaa','160000 commit aaa','100644 blob aaa']){
  const tree=new Map([['schema',object],['real/api.json','100644 blob bbb']])
  for(const [current,parents] of [[tree,[tree]],[new Map(),[tree]]] as const)expect(()=>checkProjectOwnership(o,'worker','w','t','head',current,[...parents])).toThrow('ancestor')
 }
})
it('rejects a real Git directory symlink hiding an explicit shared file baseline',()=>{
 const cwd=mkdtempSync(join(tmpdir(),'project-prefix-link-')),git=(...args:string[])=>execFileSync('git',args,{cwd,stdio:'pipe'})
 try{
  git('init','-q');git('config','user.name','Test');git('config','user.email','test@example.com');mkdirSync(join(cwd,'real'));writeFileSync(join(cwd,'real','api.json'),'{}');symlinkSync('real',join(cwd,'schema'));git('add','.');git('commit','-qm','base')
  const source=configSchema.parse({sources:[{id:'local',kind:'local',cwd,sandbox:'workspace-write',allowedActors:['alice'],workspace:{mode:'directory',project:{testCommand:'true',sharedFiles:['schema/api.json']}}}]}).sources[0]!
  const g={triggerId:'t',nodes:[{id:'one',workerId:'w',dependsOn:[]}],criteria:[]} as unknown as RouterGoal
  expect(()=>startCodeProject(source,g)).toThrow('ancestor must be a Git directory')
 }finally{rmSync(cwd,{recursive:true,force:true})}
})
it('refuses case and Unicode aliases for explicit paths and matches default lockfiles case-insensitively',()=>{
 for(const [declared,actual] of [['schema/api.json','Schema/api.json'],['caf\u00e9.json','cafe\u0301.json']]){
  const policy={testCommand:'true',sharedFiles:[declared!]};const o=createProjectOwnership('base','integration','owner',policy,policy.sharedFiles)
  const t=new Map([[actual!,'100644 blob aaa'],...(actual!.includes('/')?[['Schema','040000 tree aaa'] as [string,string]]:[])])
  expect(()=>checkProjectOwnership(o,'worker','worker','ticket','head',t,[new Map()])).toThrow('alias')
 }
 expect(()=>check(new Map([['nested/PACKAGE-LOCK.JSON','100644 blob aaa']]),[new Map([['nested/package-lock.json','100644 blob aaa']])])).toThrow()
})
