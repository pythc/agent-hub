import {it,expect} from 'vitest'
import {fork} from 'node:child_process'
import {mkdtempSync,openSync,writeSync,fsyncSync,closeSync,readFileSync,rmSync,existsSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {fileURLToPath} from 'node:url'

function launch(root:string,mode:'create'|'reopen',effect:(id:string)=>void,acknowledge:boolean){
 const child=fork(fileURLToPath(new URL('./fixtures/recovery-delivery-host.ts',import.meta.url)),[root,mode],{execArgv:['--import','tsx'],stdio:['ignore','pipe','pipe','ipc']})
 const messages:any[]=[],waiters:{type:string;resolve:(value:any)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}[]=[]
 let output=''
 child.stdout?.on('data',b=>{output=(output+String(b)).slice(-4000)});child.stderr?.on('data',b=>{output=(output+String(b)).slice(-4000)})
 const closed=new Promise<void>(resolve=>child.once('close',()=>{for(const w of waiters.splice(0)){clearTimeout(w.timer);w.reject(Error('Host exited before '+w.type+': '+output))}resolve()}))
 child.on('error',error=>{messages.push({type:'error',value:String(error)});for(const w of waiters.splice(0)){clearTimeout(w.timer);w.reject(error)}})
 child.on('message',(message:any)=>{
  if(message.type==='effect'){
   try{effect(message.value.id);if(acknowledge)child.send('ack')}catch(error){message={type:'error',value:String(error)}}
  }
  if(message.type==='error'){for(const w of waiters.splice(0)){clearTimeout(w.timer);w.reject(Error(message.value))}messages.push(message);return}
  const index=waiters.findIndex(w=>w.type===message.type)
  if(index<0)messages.push(message)
  else{const w=waiters.splice(index,1)[0]!;clearTimeout(w.timer);w.resolve(message.value)}
 })
 const wait=(type:string)=>new Promise<any>((resolve,reject)=>{
  const error=messages.find(m=>m.type==='error');if(error){reject(Error(error.value));return}
  const index=messages.findIndex(m=>m.type===type);if(index>=0){resolve(messages.splice(index,1)[0].value);return}
  if(child.exitCode!==null||child.signalCode){reject(Error('Host already exited: '+output));return}
  const waiter={type,resolve,reject,timer:setTimeout(()=>{const i=waiters.indexOf(waiter);if(i>=0)waiters.splice(i,1);reject(Error('Host barrier timed out: '+type+' '+output))},20000)};waiters.push(waiter)
 })
 return {child,wait,async kill(){if(child.exitCode===null&&!child.signalCode)child.kill('SIGKILL');await closed}}
}

it.each(['pending','sending'] as const)('recovers %s delivery across real host SIGKILL without blind replay',{timeout:60000},async phase=>{
 const root=mkdtempSync(join(tmpdir(),'recovery-delivery-')),ledger=join(root,'destination.jsonl'),children:ReturnType<typeof launch>[]=[]
 const effects=()=>existsSync(ledger)?readFileSync(ledger,'utf8').trim().split('\n'):[]
 const record=(id:string)=>{const fd=openSync(ledger,'a',0o600);try{writeSync(fd,JSON.stringify({id})+'\n');fsyncSync(fd)}finally{closeSync(fd)}}
 try{
  const first=launch(root,'create',record,false);children.push(first)
  const initial=await first.wait('ready');expect(initial.modelCalls).toBe(0);expect(initial.delivery.status).toBe('pending');expect(effects()).toEqual([])
  let before=initial
  if(phase==='sending'){
   first.child.send('flush');await first.wait('effect')
   // Destination ledger is fsynced, but deliver has not returned to Runtime.
   first.child.send('inspect');before=await first.wait('snapshot')
   expect(before.delivery.status).toBe('sending');expect(effects()).toEqual(['{"id":"crash-delivery"}'])
  }
  await first.kill();expect(first.child.signalCode).toBe('SIGKILL')
  for(let restart=0;restart<2;restart++){
   const reopened=launch(root,'reopen',record,true);children.push(reopened)
   const ready=await reopened.wait('ready');expect(ready.modelCalls).toBe(0)
   expect(ready.delivery.status).toBe(phase==='sending'?'uncertain':restart===0?'pending':'sent')
   expect(ready.task.recovery.replayAllowed).toBe(false)
   if(phase==='sending'){
    expect(ready.task.unknownEffects).toBe(true);expect(ready.task.recovery.nextSafeAction).toBe('reconcile_effects');expect(ready.task.actions).not.toContain('resume_session')
   }else if(restart===0){expect(effects()).toEqual([]);expect(ready.task.status.delivery.state).toBe('pending');expect(ready.task.recovery.nextSafeAction).not.toBe('reconcile_effects')}
   reopened.child.send('flush');const flushed=await reopened.wait('flushed')
   expect(flushed.delivery.status).toBe(phase==='sending'?'uncertain':'sent')
   expect(effects()).toEqual(['{"id":"crash-delivery"}'])
   reopened.child.send('flush');const repeated=await reopened.wait('flushed')
   expect(repeated.modelCalls).toBe(0);expect(repeated.delivery).toEqual(flushed.delivery);expect(effects()).toEqual(['{"id":"crash-delivery"}'])
   const event=repeated.events.filter((e:any)=>e.stage==='delivery').at(-1)
   expect(event).toBeDefined()
   expect(repeated.task.recovery.checkpoints).toContainEqual({stage:'delivery',cursor:event.cursor,origin:event.baseline?'baseline':'transition'})
   await reopened.kill()
  }
 }finally{await Promise.all(children.map(c=>c.kill()));rmSync(root,{recursive:true,force:true})}
})
