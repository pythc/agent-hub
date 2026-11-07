import {mkdtempSync,rmSync,appendFileSync,writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterEach,it,expect} from 'vitest'
import {configSchema} from '../src/config.ts'
import {Store} from '../src/store.ts'
import {backupState,verifyBackup,restoreState} from '../src/backup.ts'
const roots:string[]=[]
afterEach(()=>{for(const r of roots.splice(0))rmSync(r,{recursive:true,force:true})})
it('backs up WAL state, verifies integrity and refuses restoring under a live host',async()=>{
 const root=mkdtempSync(join(tmpdir(),'agent-backup-'));roots.push(root)
 const config=configSchema.parse({stateDir:join(root,'state'),sources:[{id:'local',kind:'local',allowedActors:['operator'],cwd:root}]})
 const store=new Store(join(config.stateDir,'state.sqlite'));store.put('sample','a',{value:1})
 try{
  await backupState(config,join(root,'backup'))
  expect(verifyBackup(join(root,'backup')).schema).toBe(6)
  writeFileSync(join(config.stateDir,'host.lock'),String(process.pid))
  await expect(restoreState(config,join(root,'backup'))).rejects.toThrow('Stop the host')
  appendFileSync(join(root,'backup','state.sqlite'),'tampered')
  expect(()=>verifyBackup(join(root,'backup'))).toThrow('checksum')
 }finally{store.close()}
})
it('restores offline state and retains a backup of the previous database',async()=>{
 const root=mkdtempSync(join(tmpdir(),'agent-restore-'));roots.push(root)
 const config=configSchema.parse({stateDir:join(root,'state'),sources:[{id:'local',kind:'local',allowedActors:['operator'],cwd:root}]})
 const first=new Store(join(config.stateDir,'state.sqlite'));first.put('sample','a',{value:1});first.close()
 await backupState(config,join(root,'backup'))
 const second=new Store(join(config.stateDir,'state.sqlite'));second.put('sample','a',{value:2});second.close()
 const result=await restoreState(config,join(root,'backup'))
 expect(verifyBackup(result.previous).schema).toBe(6)
 const restored=new Store(join(config.stateDir,'state.sqlite'))
 try{expect(restored.get('sample','a')).toEqual({value:1})}finally{restored.close()}
})
