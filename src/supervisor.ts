import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'

/** Process supervision is outside the agent's model loop. Crash recovery preserves uncertain executions. */
export async function supervise(configFile:string):Promise<void>{
  let stopping=false,failures=0,child:ReturnType<typeof spawn>|undefined
  const stop=()=>{stopping=true;child?.kill('SIGTERM')}
  process.once('SIGINT',stop);process.once('SIGTERM',stop)
  while(!stopping){
    const started=Date.now()
    child=spawn(process.execPath,[...process.execArgv,process.argv[1]!,'serve',configFile],{stdio:'inherit',shell:false})
    await new Promise<void>((resolve,reject)=>{child!.once('error',reject);child!.once('exit',()=>resolve())})
    if(stopping)break
    failures=Date.now()-started>60000?0:failures+1
    await new Promise(resolve=>setTimeout(resolve,Math.min(30000,1000*2**Math.min(failures,5))))
  }
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
