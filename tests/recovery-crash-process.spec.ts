import {it,expect} from 'vitest'
import {fork} from 'node:child_process'
import {createServer} from 'node:http'
import {mkdtempSync,openSync,writeSync,fsyncSync,closeSync,readFileSync,rmSync,existsSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {fileURLToPath} from 'node:url'
import {Server} from '@modelcontextprotocol/sdk/server/index.js'
import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import {ListToolsRequestSchema,CallToolRequestSchema} from '@modelcontextprotocol/sdk/types.js'

function launch(root:string,url:string,mode:'create'|'reopen'){
 const child=fork(fileURLToPath(new URL('./fixtures/recovery-crash-host.ts',import.meta.url)),[root,url,mode],{execArgv:['--import','tsx'],stdio:['ignore','pipe','pipe','ipc']})
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

it.each(['before-call','unacknowledged','completed','result-saved'] as const)('preserves %s tool outcome across real host SIGKILL without replay',{timeout:60000},async mode=>{
 const root=mkdtempSync(join(tmpdir(),'recovery-process-')),effectPath=join(root,'effects.jsonl'),instances:Server[]=[],children:ReturnType<typeof launch>[]=[]
 let effectResolve!:()=>void
 const effect=new Promise<void>(resolve=>{effectResolve=resolve})
 let release!:()=>void
 const held=new Promise<void>(resolve=>{release=resolve})
 let requests=0
 const http=createServer(async(req,res)=>{
  const server=new Server({name:'local-crash-fixture',version:'1'},{capabilities:{tools:{}}});instances.push(server)
  server.setRequestHandler(ListToolsRequestSchema,async()=>({tools:[{name:'write',inputSchema:{type:'object',properties:{text:{type:'string'}},required:['text'],additionalProperties:false}}]}))
  server.setRequestHandler(CallToolRequestSchema,async()=>{
   requests++
   const fd=openSync(effectPath,'a',0o600)
   try{writeSync(fd,JSON.stringify({effect:requests})+'\n');fsyncSync(fd)}finally{closeSync(fd)}
   effectResolve()
   if(mode==='unacknowledged')await held
   return {content:[{type:'text',text:'fixture result'}]}
  })
  try{const transport=new StreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});await server.connect(transport);res.on('close',()=>{void server.close()});await transport.handleRequest(req,res)}catch{res.destroy()}
 })
 try{
  await new Promise<void>((resolve,reject)=>{http.once('error',reject);http.listen(0,'127.0.0.1',resolve)})
  const url='http://127.0.0.1:'+(http.address() as {port:number}).port
  const first=launch(root,url,'create');children.push(first);await first.wait('ready')
  if(mode==='before-call'){
   first.child.send('before-call');const checkpoint=await first.wait('before-call')
   expect(checkpoint.receipts).toEqual([]);expect(requests).toBe(0);expect(existsSync(effectPath)).toBe(false)
   await first.kill();expect(first.child.signalCode).toBe('SIGKILL')
   for(let restart=0;restart<2;restart++){
    const reopened=launch(root,url,'reopen');children.push(reopened);const ready=await reopened.wait('ready')
    expect(ready.receipts).toEqual([]);expect(ready.task.recovery.replayAllowed).toBe(false)
    expect(ready.task.recovery.checkpoints.some((c:any)=>c.stage==='tool')).toBe(false)
    reopened.child.send('inspect');await reopened.wait('snapshot')
    expect(requests).toBe(0);expect(existsSync(effectPath)).toBe(false);expect(existsSync(join(root,'model-calls.jsonl'))).toBe(false)
    await reopened.kill()
   }
   // A fresh explicit release proves the before-call barrier leads to the real
   // tool path; none of the reopen operations above released it automatically.
   const control=launch(root,url,'reopen');children.push(control);await control.wait('ready')
   control.child.send('before-call');await control.wait('before-call');expect(requests).toBe(0)
   control.child.send('release-before-call');const result=await control.wait('result')
   expect(result.receipts[0].state).toBe('complete');expect(requests).toBe(1)
   await control.kill();return
  }
  first.child.send('call')
  // Parent owns the tool: this barrier certifies the side effect, not a guessed delay.
  let timer:ReturnType<typeof setTimeout>|undefined
  try{await Promise.race([effect,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('Tool effect barrier timed out')),20000)})])}finally{clearTimeout(timer)}
  let before:any
  if(mode!=='unacknowledged')before=await first.wait('result')
  else{first.child.send('inspect');before=await first.wait('snapshot')}
  expect(before.receipts).toHaveLength(1);expect(before.receipts[0].state).toBe(mode==='unacknowledged'?'running':'complete')
  const originalToolEvent=before.events.filter((e:any)=>e.entity==='tool-receipt').at(-1)
  expect(originalToolEvent).toBeDefined()
  if(mode==='result-saved'){
   first.child.send('execute');before=await first.wait('executed')
   expect(before.task.hasResult,JSON.stringify(before.run)).toBe(true);expect(before.task.status.acceptance.state).toBe('not_recorded')
   expect(before.task.acceptance).toBeNull()
   expect(readFileSync(join(root,'model-calls.jsonl'),'utf8').trim().split('\n')).toHaveLength(1)
  }
  await first.kill();expect(first.child.signalCode).toBe('SIGKILL')
  let recoveredToolEvents:unknown
  for(let restart=0;restart<2;restart++){
   const reopened=launch(root,url,'reopen');children.push(reopened);const ready=await reopened.wait('ready')
   expect(ready.receipts).toHaveLength(1);expect(ready.receipts[0].state).toBe(mode==='unacknowledged'?'uncertain':'complete')
   expect(ready.task.recovery.replayAllowed).toBe(false)
   expect(ready.events).toContainEqual(originalToolEvent)
   const toolEvents=ready.events.filter((event:any)=>event.stage==='tool'),last=toolEvents.at(-1)
   const receiptEvents=toolEvents.filter((event:any)=>event.entity==='tool-receipt')
   expect(receiptEvents.at(-1).state).toBe(mode==='unacknowledged'?'uncertain':'complete')
   expect(ready.task.recovery.checkpoints).toContainEqual({stage:'tool',cursor:last.cursor,origin:last.baseline?'baseline':'transition'})
   if(restart===0)recoveredToolEvents=receiptEvents
   else expect(receiptEvents).toEqual(recoveredToolEvents)
   if(mode==='unacknowledged'){
    expect(ready.task.unknownEffects).toBe(true);expect(ready.task.recovery.nextSafeAction).toBe('reconcile_effects');expect(ready.task.actions).not.toContain('resume_session')
   }
   if(mode==='result-saved'){
    expect(ready.task.hasResult).toBe(true);expect(ready.task.status.acceptance.state).toBe('not_recorded');expect(ready.task.acceptance).toBeNull()
    expect(ready.events.some((e:any)=>e.stage==='acceptance'&&e.state==='passed')).toBe(false)
    reopened.child.send('inspect');await reopened.wait('snapshot')
    expect(requests).toBe(1);expect(readFileSync(effectPath,'utf8').trim().split('\n')).toEqual(['{"effect":1}'])
    expect(readFileSync(join(root,'model-calls.jsonl'),'utf8').trim().split('\n')).toHaveLength(1)
    await reopened.kill();continue
   }
   reopened.child.send('call');const replay=await reopened.wait('result')
   if(mode==='completed')expect(replay.result).toEqual(before.result)
   else{expect(replay.result.success).toBe(false);expect(JSON.stringify(replay.result)).toContain('uncertain')}
   expect(requests).toBe(1);expect(readFileSync(effectPath,'utf8').trim().split('\n')).toEqual(['{"effect":1}'])
   await reopened.kill()
  }
 }finally{
  await Promise.all(children.map(c=>c.kill()));release()
  http.closeAllConnections();await Promise.allSettled(instances.map(s=>s.close()))
  await new Promise<void>(resolve=>http.close(()=>resolve()));rmSync(root,{recursive:true,force:true})
 }
})
