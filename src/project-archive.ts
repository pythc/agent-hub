import {execFileSync} from 'node:child_process'
import type {DatabaseSync} from 'node:sqlite'
import {closeSync,copyFileSync,existsSync,mkdirSync,openSync,readSync,renameSync,rmSync} from 'node:fs'
import {dirname,join} from 'node:path'
import {createHash,randomUUID} from 'node:crypto'
import {stableDigest} from './sources.ts'
import type {RouterGoal} from './router-goals.ts'
import type {CodeReceipt} from './project-code.ts'

function files(db:DatabaseSync){
 const paths=new Set<string>()
 const add=(goalId:string,head:string,ext:string)=>{
  if(!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(head))throw Error('Invalid retained project commit')
  paths.add(join('code-projects',stableDigest(goalId),head+'.'+ext))
 }
 for(const row of db.prepare("SELECT b.id,json_extract(b.body,'$.head') AS head FROM records b JOIN records g ON g.kind='router-goal' AND g.id=b.id WHERE b.kind='project-base' AND json_extract(g.body,'$.project.base')=json_extract(b.body,'$.head')").all())add(String(row.id),String(row.head),'bundle')
 for(const row of db.prepare("SELECT c.body AS receipt,g.body AS goal FROM records c JOIN records g ON g.kind='router-goal' AND g.id=json_extract(c.body,'$.goalId') WHERE c.kind='project-commit' AND json_extract(g.body,'$.project.base') IS NOT NULL").all()){
  const g=JSON.parse(String(row.goal)) as RouterGoal,code=JSON.parse(String(row.receipt)) as CodeReceipt
  if(!code.head)continue
  add(g.id,g.project!.base,'bundle');add(g.id,code.head,'bundle')
  if(code.test?.exit===0&&!code.error)add(g.id,code.head,'patch')
 }
 return [...paths].sort()
}
function checksum(file:string){
 const hash=createHash('sha256'),fd=openSync(file,'r'),buf=Buffer.alloc(1024*1024)
 try{for(let n;(n=readSync(fd,buf,0,buf.length,null))>0;)hash.update(buf.subarray(0,n))}finally{closeSync(fd)}
 return hash.digest('hex')
}
function copy(source:string,dest:string){
 mkdirSync(dirname(dest),{recursive:true,mode:0o700})
 const temp=dest+'.'+randomUUID()
 try{copyFileSync(source,temp);renameSync(temp,dest)}finally{rmSync(temp,{force:true})}
}
export function backupProjectFiles(db:DatabaseSync,state:string,directory:string){
 const hashes:Record<string,string>={}
 for(const name of files(db)){const dest=join(directory,name);copy(join(state,name),dest);hashes[name]=checksum(dest)}
 return Object.keys(hashes).length?hashes:undefined
}
export function verifyProjectFiles(db:DatabaseSync,directory:string,hashes:Record<string,string>={}){
 const names=files(db)
 if(JSON.stringify(Object.keys(hashes).sort())!==JSON.stringify(names))throw Error('Backup is missing its retained code project manifest')
 for(const name of names)if(checksum(join(directory,name))!==hashes[name])throw Error('Code project backup checksum mismatch')
}
export function restoreProjectFiles(db:DatabaseSync,directory:string,state:string,hashes:Record<string,string>={}){
 // These names were derived from the verified database and immutable commit IDs.
 for(const [name,hash] of Object.entries(hashes)){
  const dest=join(state,name)
  if(existsSync(dest)&&checksum(dest)===hash)continue
  copy(join(directory,name),dest)
 }
 for(const row of db.prepare("SELECT id,json_extract(body,'$.project.base') AS base FROM records WHERE kind='router-goal' AND json_extract(body,'$.project.base') IS NOT NULL").all()){
  const base=String(row.base),folder=join('code-projects',stableDigest(String(row.id))),baseFile=join(folder,base+'.bundle')
  if(!hashes[baseFile])continue
  const cwd=join(state,folder,'objects.git')
  mkdirSync(cwd,{recursive:true,mode:0o700})
  const git=(args:string[])=>execFileSync('git',['-c','core.hooksPath=/dev/null',...args],{cwd,stdio:'pipe',timeout:120000,env:{PATH:process.env.PATH,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1'}})
  git(['init','--bare','--template=',...(base.length===64?['--object-format=sha256']:[])])
  const others=Object.keys(hashes).filter(name=>dirname(name)===folder&&name.endsWith('.bundle')&&name!==baseFile)
  for(const file of [baseFile,...others])git(['fetch','--no-tags',join(state,file),'refs/heads/commits/*:refs/heads/commits/*'])
 }
}
