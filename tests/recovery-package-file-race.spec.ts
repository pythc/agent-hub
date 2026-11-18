import {it,expect,vi,afterEach} from 'vitest'
const fault=vi.hoisted(()=>({mode:'' as 'metadata'|'growth'|'',stats:0,reads:0,closes:0,path:''}))
vi.mock('node:fs',async importOriginal=>{
 const fs=await importOriginal<typeof import('node:fs')>()
 return {...fs,fstatSync:(...args:Parameters<typeof fs.fstatSync>)=>{
  const value=fs.fstatSync(...args)
  if(++fault.stats===2&&fault.mode==='metadata')return {...value,mtimeMs:Number(value.mtimeMs)+1}
  return value
 },readSync:(...args:Parameters<typeof fs.readSync>)=>{
  const count=fs.readSync(...args)
  if(++fault.reads===1&&fault.mode==='growth')fs.appendFileSync(fault.path,' '.repeat(17000))
  return count
 },closeSync:(fd:number)=>{fault.closes++;return fs.closeSync(fd)}}
})
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {createRecoveryPackage} from '../src/recovery-package.ts'
import {readRecoveryPackageFile} from '../src/recovery-package-cli.ts'
const roots:string[]=[]
afterEach(()=>{fault.mode='';for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true})})
it.each(['metadata','growth'] as const)('rejects deterministic %s change during single-descriptor reading and closes the descriptor',mode=>{
 const root=mkdtempSync(join(tmpdir(),'recovery-read-race-'));roots.push(root)
 const path=join(root,'diagnostic.json'),value=createRecoveryPackage({state:'uncertain',unknownEffects:true,status:{effects:{state:'unknown'},delivery:{state:'uncertain'}},recovery:{session:'unavailable',nextSafeAction:'reconcile_effects',checkpoints:[]}} as any)
 writeFileSync(path,JSON.stringify(value));Object.assign(fault,{mode,stats:0,reads:0,closes:0,path})
 expect(()=>readRecoveryPackageFile(path)).toThrow('Invalid or unreadable recovery diagnostic package')
 expect(fault.closes).toBe(1)
})
