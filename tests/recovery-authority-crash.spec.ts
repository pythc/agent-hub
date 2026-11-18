import {it,expect} from 'vitest'
import {fork} from 'node:child_process'
import {mkdtempSync,rmSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {fileURLToPath} from 'node:url'

function launch(root:string,mode:'create'|'reopen'){
 const child=fork(fileURLToPath(new URL('./fixtures/recovery-authority-host.ts',import.meta.url)),[root,mode],{execArgv:['--import','tsx'],stdio:['ignore','pipe','pipe','ipc']})
 const messages:any[]=[],waiters:{type:string;resolve:(value:any)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}[]=[]
 let output=''
 child.stdout?.on('data',b=>{output=(output+String(b)).slice(-4000)});child.stderr?.on('data',b=>{output=(output+String(b)).slice(-4000)})
 const closed=new Promise<void>(resolve=>child.once('close',()=>{for(const w of waiters.splice(0)){clearTimeout(w.timer);w.reject(Error('Host exited before '+w.type+': '+output))}resolve()}))
 child.on('error',error=>{messages.push({type:'error',value:String(error)});for(const w of waiters.splice(0)){clearTimeout(w.timer);w.reject(error)}})
 child.on('message',(message:any)=>{
  if(message.type==='error'){for(const w of waiters.splice(0)){clearTimeout(w.timer);w.reject(Error(message.value))}messages.push(message);return}
  const index=waiters.findIndex(w=>w.type===message.type)
  if(index<0)messages.push(message)
  else{const w=waiters.splice(index,1)[0]!;clearTimeout(w.timer);w.resolve(message.value)}
 })
 const wait=(type:string)=>new Promise<any>((resolve,reject)=>{
  const error=messages.find(m=>m.type==='error');if(error){reject(Error(error.value));return}
  const index=messages.findIndex(m=>m.type===type);if(index>=0){resolve(messages.splice(index,1)[0].value);return}
  if(child.exitCode!==null||child.signalCode){reject(Error('Host already exited: '+output));return}
  const waiter={type,resolve,reject,timer:setTimeout(()=>{const i=waiters.indexOf(waiter);if(i>=0)waiters.splice(i,1);reject(Error('Host barrier timed out: '+type+' '+output))},20000)}
  waiters.push(waiter)
 })
 return {child,closed,wait,async kill(){if(child.exitCode===null&&!child.signalCode)child.kill('SIGKILL');await closed}}
}

function command(task:any,requestId:string){return {ticketId:task.id,revision:task.revision,observed:task.observed,action:'resume_session',requestId}}
function executionState(snapshot:any){return {assignments:snapshot.assignments,jobs:snapshot.jobs,effects:snapshot.effects,modelCalls:snapshot.modelCalls,commands:snapshot.commands}}
it.each(['permission','mandate','evidence'] as const)('rejects stale recovery after durable %s change and real SIGKILL',{timeout:60000},async kind=>{
 const root=mkdtempSync(join(tmpdir(),'recovery-authority-')),children:ReturnType<typeof launch>[]=[]
 try{
  const first=launch(root,'create');children.push(first);const initial=await first.wait('ready')
  expect(initial.task.actions).toContain('resume_session');const stale=command(initial.task,'before-crash')
  first.child.send({type:'mutate',kind});const mutated=await first.wait('mutated')
  expect(mutated.task.actions).not.toContain('resume_session')
  await first.kill();expect(first.child.signalCode).toBe('SIGKILL')
  const second=launch(root,'reopen');children.push(second);const ready=await second.wait('ready')
  expect(ready.task.actions).not.toContain('resume_session');expect(ready.modelCalls).toBe(0)
  second.child.send({type:'recover',value:stale});const rejected=await second.wait('recovered')
  expect(rejected.error).toBe(kind==='permission'?'trace_settings_conflict':'trace_changed')
  expect(rejected.result).toBeUndefined();expect(executionState(rejected)).toEqual(executionState(ready))
  // A refreshed observation cannot reinstate withdrawn authority or resolve unknown effects.
  second.child.send({type:'recover',value:command(rejected.task,'fresh-but-unauthorized')});const fresh=await second.wait('recovered')
  expect(fresh.error).toBe(kind==='evidence'?'trace_reconcile_required':'trace_action_unavailable')
  expect(executionState(fresh)).toEqual(executionState(ready))
 }finally{await Promise.all(children.map(child=>child.kill()));rmSync(root,{recursive:true,force:true})}
})
it('requires explicit fresh resume after SIGKILL and queues exactly one assignment without inference',{timeout:60000},async()=>{
 const root=mkdtempSync(join(tmpdir(),'recovery-authority-control-')),children:ReturnType<typeof launch>[]=[]
 try{
  const first=launch(root,'create');children.push(first);const initial=await first.wait('ready')
  expect(initial.task.actions).toContain('resume_session');await first.kill()
  const second=launch(root,'reopen');children.push(second);const ready=await second.wait('ready')
  expect(ready.assignments).toEqual(initial.assignments);expect(ready.modelCalls).toBe(0);expect(ready.commands).toEqual([])
  expect(ready.task.actions).toContain('resume_session');const fresh=command(ready.task,'explicit-resume')
  second.child.send({type:'recover',value:fresh});const resumed=await second.wait('recovered')
  expect(resumed.error).toBeUndefined();expect(resumed.result).toMatchObject({status:'resumed',replayed:false})
  expect(resumed.assignments).toHaveLength(ready.assignments.length+1);expect(resumed.modelCalls).toBe(0);expect(resumed.effects).toEqual(ready.effects)
  second.child.send({type:'recover',value:fresh});const replay=await second.wait('recovered')
  expect(replay.result).toEqual(resumed.result);expect(executionState(replay)).toEqual(executionState(resumed))
 }finally{await Promise.all(children.map(child=>child.kill()));rmSync(root,{recursive:true,force:true})}
})
