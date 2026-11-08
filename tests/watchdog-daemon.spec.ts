import {it,expect} from 'vitest'
import {createServer} from 'node:http'
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {setTimeout as delay} from 'node:timers/promises'
import {DatabaseSync} from 'node:sqlite'
import {runWatchdog} from '../src/watchdog-daemon.ts'
import {configSchema,type Config} from '../src/config.ts'
import {backendsSchema} from '../src/backend-config.ts'
import type {WatchdogTarget} from '../src/watchdog-contract.ts'
import type {Model,ModelRequest} from '../src/model.ts'

async function until(fn:()=>boolean,ms=7000){const end=Date.now()+ms;while(!fn()){if(Date.now()>end)throw Error('Timed out');await delay(25)}}
async function fixture(modelFactory:(c:Config)=>Model){
 const root=mkdtempSync(join(tmpdir(),'watchdog-daemon-')),state=join(root,'state');mkdirSync(state)
 const config=configSchema.parse({stateDir:state,watchdog:{staleMs:1000,intervalMs:1000,reviewIntervalMs:1000},sources:[{id:'local',kind:'local',cwd:root,allowedActors:['alice']}]})
 const path=join(root,'config.json');writeFileSync(path,JSON.stringify(config));writeFileSync(join(state,'watchdog-access-token'),'test-capability')
 const target:WatchdogTarget={id:'goal:node',goalId:'goal',nodeId:'node',ticketId:'ticket',assignmentId:'assignment',goalRevision:1,contractHash:'contract',fence:'fence',basisHash:'basis',objective:'Private goal',criteria:[],principal:{source:'local',actor:'alice'},backendId:'live',backendIds:['live'],contextBytes:16000,inference:{backend:backendsSchema.parse({live:{kind:'openai-chat',baseUrl:'https://current-provider.invalid/v1',model:'current-model',headers:{'X-Test-Secret':'CONTROL-PLANE-SECRET'}}}).live!,options:{},model:'current-model'},phase:'running',activityAt:0,progressHash:'no-progress',verifiedHash:'no-milestone',evidence:[{id:'calls',kind:'host_execution',value:[]}]}
 const stateful={targets:[target],enabled:true,fail:false,gets:0},events:any[]=[]
 const server=createServer((req,res)=>{
  if(req.headers.authorization!=='Bearer test-capability'){res.writeHead(401);res.end();return}
  res.setHeader('content-type','application/json')
  if(req.url==='/watchdog/snapshot'){
   stateful.gets++;if(stateful.fail){res.writeHead(503);res.end('{}');return}
   res.end(JSON.stringify({instanceId:'host',at:Date.now(),tickAt:Date.now(),paused:false,config:{...config.watchdog,enabled:stateful.enabled},targets:stateful.targets,unavailable:[]}))
  }else{req.resume();res.end('{}')}
 })
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const address=server.address() as {port:number}
 writeFileSync(join(state,'connection.json'),JSON.stringify({url:'http://127.0.0.1:'+address.port}))
 const stop=new AbortController(),task=runWatchdog(path,false,{signal:stop.signal,modelFactory,health:value=>events.push(value)})
 return {state,stateful,target,events,async close(){stop.abort();await task;await new Promise<void>(r=>server.close(()=>r()));rmSync(root,{recursive:true,force:true})}}
}

it('keeps probing during slow inference, uses host-current config, excludes credentials, and aborts revoked inference',async()=>{
 let request:ModelRequest|undefined,definition:Config|undefined,aborted=false
 const f=await fixture(c=>{definition=c;return {async run(r){request=r;await new Promise<void>((_,reject)=>r.signal!.addEventListener('abort',()=>{aborted=true;reject(Error('PRIVATE-MODEL-ERROR'))},{once:true}));throw Error('unreachable')}}})
 try{
  await until(()=>!!request)
  expect(definition!.backends.live).toMatchObject({baseUrl:'https://current-provider.invalid/v1',model:'current-model'})
  expect(request!.input).not.toContain('CONTROL-PLANE-SECRET');expect(request!.input).not.toContain('current-provider.invalid')
  expect(request!.options?.tools).toEqual([])
  const gets=f.stateful.gets;await delay(2200);expect(f.stateful.gets).toBeGreaterThanOrEqual(gets+2)
  f.stateful.targets=[];await until(()=>aborted)
  await delay(100)
  const db=new DatabaseSync(join(f.state,'watchdog','state.sqlite'),{readOnly:true})
  try{const text=JSON.stringify(db.prepare('SELECT body FROM records').all());expect(text).not.toContain('PRIVATE-MODEL-ERROR');expect(text).not.toContain('Private goal');expect(text).not.toContain('CONTROL-PLANE-SECRET')}finally{db.close()}
 }finally{await f.close()}
},15000)

it('refreshes queued target authority before starting its model call',async()=>{
 let release!:()=>void,calls=0;const ids:string[]=[]
 const f=await fixture(()=>({async run(r){calls++;ids.push(JSON.parse(r.input).target.id);if(calls===1)await new Promise<void>(resolve=>{release=resolve;r.signal?.addEventListener('abort',()=>resolve(),{once:true})});return {threadId:'t',turnId:'t',text:JSON.stringify({verdict:'progressing',reason:'Reviewed host evidence',evidenceIds:['calls']})}}}))
 f.stateful.targets.push({...f.target,id:'second',ticketId:'second',fence:'second'})
 try{await until(()=>calls===1);f.stateful.targets=[f.target];release();await delay(1400);expect(ids).not.toContain('second')}finally{release?.();await f.close()}
},10000)

it('honors a live disable during host probe failures and permits live re-enable',async()=>{
 const f=await fixture(()=>({async run(){return {threadId:'t',turnId:'t',text:JSON.stringify({verdict:'uncertain',reason:'Insufficient evidence',evidenceIds:['calls']})}}}))
 try{
  f.stateful.enabled=false;await until(()=>f.events.some(e=>e.kind==='watchdog.setting'&&!e.enabled))
  f.stateful.fail=true;await delay(3300)
  expect(f.events.some(e=>e.kind==='watchdog.host_unresponsive')).toBe(false)
  f.stateful.fail=false;f.stateful.enabled=true;await until(()=>f.events.some(e=>e.kind==='watchdog.setting'&&e.enabled))
 }finally{await f.close()}
},10000)
