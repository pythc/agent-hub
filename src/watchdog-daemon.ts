import {readFileSync,mkdirSync,openSync,writeFileSync,closeSync,unlinkSync} from 'node:fs'
import {join} from 'node:path'
import {setTimeout as delay} from 'node:timers/promises'
import {loadConfig,type Config} from './config.ts'
import {managedSecrets} from './managed-config.ts'
import {Store} from './store.ts'
import {BackendRegistry} from './backends/registry.ts'
import {WatchdogMonitor,StaleWatchdogDirective,watchdogInstructions,watchdogOutputSchema} from './watchdog-monitor.ts'
import type {WatchdogSnapshot,WatchdogJudgment} from './watchdog-contract.ts'
import type {Model} from './model.ts'
import {randomUUID} from 'node:crypto'
import {UsageLedger} from './usage-ledger.ts'
export interface WatchdogDaemonOptions {signal?:AbortSignal;modelFactory?:(config:Config,store:Store)=>Model;health?:(value:unknown)=>void}

export function watchdogEndpoint(raw:string){
 const url=new URL(raw)
 if(url.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||url.username||url.password)throw Error('Watchdog requires a loopback HTTP endpoint')
 return url.origin
}

/** Launched as its own process. No Runtime, host lock, or host database connection. */
export async function runWatchdog(configFile:string,once=false,options:WatchdogDaemonOptions={}){
 const config=loadConfig(configFile)
 const directory=join(config.stateDir,'watchdog');mkdirSync(directory,{recursive:true,mode:0o700})
 const lock=join(directory,'daemon.lock')
 try{const fd=openSync(lock,'wx',0o600);try{writeFileSync(fd,String(process.pid))}finally{closeSync(fd)}}
 catch(error:any){
  if(error.code!=='EEXIST')throw error
  const pid=Number(readFileSync(lock,'utf8'));if(!Number.isSafeInteger(pid)||pid<=0)throw Error('Invalid watchdog lock')
  try{process.kill(pid,0);throw Error('A watchdog already owns this state directory')}
  catch(e:any){if(e.code!=='ESRCH')throw e}
  unlinkSync(lock);const fd=openSync(lock,'wx',0o600);try{writeFileSync(fd,String(process.pid))}finally{closeSync(fd)}
 }
 const store=new Store(join(directory,'state.sqlite')),monitor=new WatchdogMonitor(store),usage=new UsageLedger(store),stop=new AbortController()
 const shutdown=()=>stop.abort();process.once('SIGTERM',shutdown);process.once('SIGINT',shutdown)
 options.signal?.addEventListener('abort',shutdown,{once:true});if(options.signal?.aborted)shutdown()
 const health=(value:unknown)=>{process.send?.(value as any);options.health?.(value)}
 let failureSince:number|undefined,lastError='',interval=config.watchdog.intervalMs,monitorEnabled=config.watchdog.enabled,staleMs=config.watchdog.staleMs
 let reviewTask:Promise<void>|undefined
 const judging=new Map<string,{fence:string;controller:AbortController}>()
 try{
  do{
   try{
    const connection=JSON.parse(readFileSync(join(config.stateDir,'connection.json'),'utf8')),url=watchdogEndpoint(connection.url)
    const token=readFileSync(join(config.stateDir,'watchdog-access-token'),'utf8').trim()
    const request=async(path:string,value?:unknown)=>{
     const r=await fetch(url+path,{method:value?'POST':'GET',redirect:'error',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:value?JSON.stringify(value):undefined,signal:AbortSignal.any([stop.signal,AbortSignal.timeout(5000)])})
     if(!r.ok){if(r.status>=400&&r.status<500)throw new StaleWatchdogDirective('Watchdog request rejected: '+r.status);throw Error('Watchdog host returned '+r.status)}
     return await r.json()
    }
    const snapshot=await request('/watchdog/snapshot') as WatchdogSnapshot
    interval=Math.min(60000,snapshot.config.intervalMs)
    monitorEnabled=snapshot.config.enabled;staleMs=snapshot.config.staleMs
    for(const [id,active] of judging){const current=snapshot.targets.find(t=>t.id===id);if(!monitorEnabled||snapshot.paused||!current||current.fence!==active.fence)active.controller.abort(Error('Observation revoked or changed'))}
    // A responsive HTTP server does not prove the scheduling loop is making progress.
    health({kind:'watchdog.setting',enabled:monitorEnabled})
    if(monitorEnabled&&!snapshot.paused&&Date.now()-snapshot.tickAt>staleMs)throw Error('Host scheduling heartbeat expired')
    failureSince=undefined;lastError=''
    health({kind:'watchdog.host_healthy',instanceId:snapshot.instanceId})
    // Health polling never waits for model latency. Only one semantic batch runs at a time.
    if(!reviewTask&&monitorEnabled&&!snapshot.paused)reviewTask=monitor.step(snapshot,async(target,history)=>{
     const fresh=await request('/watchdog/snapshot') as WatchdogSnapshot
     const current=fresh.targets.find(t=>t.id===target.id)
     if(!fresh.config.enabled||fresh.paused||!current||current.fence!==target.fence)throw new StaleWatchdogDirective('Observation changed before inference')
     const latest=loadConfig(configFile)
     latest.backends={[current.backendId]:current.inference.backend}
     for(const [key,value] of Object.entries(managedSecrets(latest.stateDir)))process.env[key]=value
     latest.execution={...latest.execution,backend:current.backendId,roles:{router:current.backendId,worker:current.backendId,subagent:current.backendId},workers:undefined,management:undefined,router:{...latest.execution.router,backend:current.backendId,model:current.inference.model}}
     const model=options.modelFactory?.(latest,store)??new BackendRegistry(latest,store)
     if(!current.backendIds.includes(current.backendId))throw Error('Watchdog model is outside authorized backends')
     const {inference,...evidenceTarget}=current
     const input=JSON.stringify({kind:'watchdog_review',target:evidenceTarget,history})
     if(Buffer.byteLength(input)>current.contextBytes)throw Error('Watchdog evidence exceeds authorized context budget')
     const controller=new AbortController();judging.set(current.id,{fence:current.fence,controller})
     const call='watchdog:'+randomUUID(),signal=AbortSignal.any([stop.signal,controller.signal,AbortSignal.timeout(fresh.config.modelTimeoutMs)])
     // Numeric metadata only; do not persist the target, objective, evidence or judgment.
     usage.begin(call,'subagent',{sourceId:current.principal.source},'watchdog')
     try{
      const result=await model.run({role:'router',backendId:current.backendId,model:inference.model,principal:current.principal,cwd:directory,privateState:directory,managed:true,ephemeral:true,archiveOnComplete:true,sandbox:'read-only',tools:[],options:{...inference.options,tools:[],prompt:'',timeoutMs:fresh.config.modelTimeoutMs},signal,onUsage:value=>usage.record(call,0,value),onBackend:backend=>usage.update(call,{backend}),onModel:model=>usage.update(call,{model}),instructions:watchdogInstructions,input,schema:watchdogOutputSchema})
      usage.finish(call,'completed')
      return JSON.parse(result.text) as WatchdogJudgment
     }catch(error){usage.finish(call,signal.aborted?'interrupted':'failed');throw error}finally{judging.delete(current.id)}
    },d=>request('/watchdog/recover',d)).catch(()=>{store.put('watchdog-health','review',{at:Date.now(),state:'review_unavailable'})}).finally(()=>{reviewTask=undefined})
    store.put('watchdog-health','daemon',{at:Date.now(),state:'healthy'})
    await request('/watchdog/heartbeat',{at:Date.now(),instanceId:snapshot.instanceId,observed:snapshot.targets.length,unavailable:snapshot.unavailable.length,reviews:store.list('watchdog-review').length,pending:store.list<{state:string}>('watchdog-directive').filter(d=>d.state==='pending').length})
    if(once)await reviewTask
   }catch(error){
    if(stop.signal.aborted)break
    const now=Date.now();failureSince??=now
    // The supervisor can restart only its own child, and only after repeated independent probes.
    if(monitorEnabled&&now-failureSince>=staleMs)health({kind:'watchdog.host_unresponsive',since:failureSince})
    const message=String(error).slice(0,500)
    store.put('watchdog-health','daemon',{at:now,state:'error',since:failureSince,error:message})
    if(message!==lastError){console.error('AgentHub watchdog: '+message);lastError=message}
   }
   if(!once&&!stop.signal.aborted)await delay(interval,undefined,{signal:stop.signal}).catch(()=>{})
  }while(!once&&!stop.signal.aborted)
 }finally{stop.abort();await reviewTask;options.signal?.removeEventListener('abort',shutdown);process.removeListener('SIGTERM',shutdown);process.removeListener('SIGINT',shutdown);store.close();unlinkSync(lock)}
}
