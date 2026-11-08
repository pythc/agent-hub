import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import {loadConfig} from './config.ts'
import {setTimeout as delay} from 'node:timers/promises'

/** Process supervision is outside the agent's model loop. Crash recovery preserves uncertain executions. */
export async function supervise(configFile:string):Promise<void>{
  const config=loadConfig(configFile),stopSignal=new AbortController()
  let stopping=false,child:ReturnType<typeof spawn>|undefined,watcher:ReturnType<typeof spawn>|undefined,restarting=false,childStarted=0,watchdogEnabled=config.watchdog.enabled
  const terminate=(process:ReturnType<typeof spawn>|undefined)=>{
    if(!process||process.exitCode!==null||process.signalCode)return
    process.kill('SIGTERM')
    const timer=setTimeout(()=>{if(process.exitCode===null&&!process.signalCode)process.kill('SIGKILL')},15000)
    timer.unref();process.once('exit',()=>clearTimeout(timer))
  }
  const stop=()=>{stopping=true;stopSignal.abort();terminate(watcher);terminate(child)}
  process.once('SIGINT',stop);process.once('SIGTERM',stop)
  const loop=async(role:'serve'|'watchdog')=>{
    let failures=0
    while(!stopping){
      const started=Date.now(),p=spawn(process.execPath,[...process.execArgv,process.argv[1]!,role,configFile],{stdio:role==='watchdog'?['inherit','inherit','inherit','ipc']:'inherit',shell:false})
      if(role==='serve'){child=p;restarting=false;childStarted=started}else{
        watcher=p
        p.on('message',(message:any)=>{
          if(message?.kind==='watchdog.setting'&&typeof message.enabled==='boolean')watchdogEnabled=message.enabled
          if(message?.kind==='watchdog.host_unresponsive'&&watchdogEnabled&&!stopping&&!restarting&&child&&Date.now()-childStarted>=Math.max(30000,config.watchdog.staleMs)){restarting=true;terminate(child)}
        })
      }
      await new Promise<void>((resolve,reject)=>{p.once('error',reject);p.once('exit',()=>resolve())})
      if(stopping)break
      failures=Date.now()-started>60000?0:failures+1
      await delay(Math.min(30000,1000*2**Math.min(failures,5)),undefined,{signal:stopSignal.signal}).catch(()=>{})
    }
  }
  try{await Promise.all([loop('serve'),loop('watchdog')])}
  finally{stop();process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop)}
}
export async function watch(url:string,tokenFile:string,once=false):Promise<void>{
  const token=readFileSync(tokenFile,'utf8').trim()
  let stopping=false,lastProblem='',intervalMs=5000
  process.once('SIGINT',()=>{stopping=true});process.once('SIGTERM',()=>{stopping=true})
  do{
    try{
      const response=await fetch(url+'/status',{headers:{authorization:'Bearer '+token},signal:AbortSignal.timeout(5000)})
      if(!response.ok)throw Error('Host returned HTTP '+response.status)
      const state=await response.json() as any
      intervalMs=Math.min(60000,Math.max(1000,state.watchdog?.intervalMs??5000))
      const problems=state.tickets.filter((t:any)=>t.run?.phase==='uncertain').map((t:any)=>t.id)
      const stale=state.stalled??[]
      const key=JSON.stringify({problems,stale})
      if(key!==lastProblem&&(problems.length||stale.length))console.error('Agent work needs reconciliation: '+[...problems,...stale].join(', '))
      lastProblem=key
      await fetch(url+'/watchdog',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({at:Date.now(),uncertain:problems,stalled:stale}),signal:AbortSignal.timeout(5000)})
    }catch(error){const key=String(error);if(key!==lastProblem)console.error('Agent watchdog: '+key);lastProblem=key}
    if(!once&&!stopping)await new Promise(resolve=>setTimeout(resolve,intervalMs))
  }while(!once&&!stopping)
}
