import {it,expect} from 'vitest'
import {spawn,type ChildProcess} from 'node:child_process'
import {mkdtempSync,writeFileSync,readFileSync,rmSync,existsSync} from 'node:fs'
import {join,resolve} from 'node:path'
import {tmpdir} from 'node:os'
import {setTimeout as delay} from 'node:timers/promises'

async function until<T>(read:()=>Promise<T>|T,accept:(value:T)=>boolean,timeout=20000):Promise<T>{
 const end=Date.now()+timeout;let last:unknown
 while(Date.now()<end){try{const value=await read();if(accept(value))return value}catch(error){last=error}await delay(100)}
 throw Error('Timed out: '+String(last))
}
it('supervises separate host/watchdog processes, repairs a live but frozen host, and respects supervisor shutdown',async()=>{
 const root=mkdtempSync(join(tmpdir(),'watchdog-process-')),state=join(root,'state'),config=join(root,'config.json')
 writeFileSync(config,JSON.stringify({stateDir:state,port:0,watchdog:{staleMs:1000,intervalMs:1000},sources:[{id:'local',kind:'local',cwd:root,allowedActors:['alice']}]}))
 const parent=spawn(process.execPath,['--import','tsx',resolve('src/cli.ts'),'supervise',config],{stdio:['ignore','pipe','pipe']})
 let logs='',hostPid=0,watchPid=0
 parent.stdout?.on('data',b=>{logs=(logs+String(b)).slice(-12000)});parent.stderr?.on('data',b=>{logs=(logs+String(b)).slice(-12000)})
 const connection=()=>JSON.parse(readFileSync(join(state,'connection.json'),'utf8')) as {url:string;accessToken:string}
 const status=async()=>{const c=connection(),r=await fetch(c.url+'/status',{headers:{authorization:'Bearer '+c.accessToken},signal:AbortSignal.timeout(1000)});if(!r.ok)throw Error('status '+r.status);return await r.json() as any}
 const host=async()=>{const s=await status();return s.health.find((h:any)=>h.pid)?.pid as number}
 const watch=()=>Number(readFileSync(join(state,'watchdog','daemon.lock'),'utf8'))
 const waitExit=(p:ChildProcess)=>p.exitCode!==null||p.signalCode?Promise.resolve():new Promise<void>(r=>p.once('exit',()=>r()))
 try{
  hostPid=await until(host,p=>!!p);watchPid=await until(watch,p=>p>0)
  await until(status,s=>s.health.some((h:any)=>h.instanceId&&h.receivedAt))
  const c=connection(),denied=await fetch(c.url+'/watchdog/snapshot',{headers:{authorization:'Bearer '+c.accessToken}})
  expect(denied.status).toBe(401)
  const wdToken=readFileSync(join(state,'watchdog-access-token'),'utf8').trim()
  expect((await fetch(c.url+'/status',{headers:{authorization:'Bearer '+wdToken}})).status).toBe(401)
  // Killing the observer must not kill or restart the independently healthy host.
  process.kill(watchPid,'SIGKILL');const oldWatch=watchPid
  watchPid=await until(watch,p=>p!==oldWatch);expect(await host()).toBe(hostPid)
  // Wait through the supervisor's startup grace, then freeze the actual host process.
  await delay(30000)
  const oldHost=hostPid;process.kill(hostPid,'SIGSTOP')
  hostPid=await until(host,p=>p>0&&p!==oldHost,45000)
  expect(watch()).toBe(watchPid)
  await until(status,s=>s.health.some((h:any)=>h.instanceId&&h.receivedAt))
  parent.kill('SIGTERM');await waitExit(parent)
  await until(()=>{try{process.kill(hostPid,0);return false}catch{return true}},v=>v)
  await until(()=>!existsSync(join(state,'watchdog','daemon.lock')),v=>v)
 }catch(error){throw Error(String(error)+'\n'+logs)}
 finally{
  if(hostPid)try{process.kill(hostPid,'SIGCONT')}catch{}
  parent.kill('SIGTERM');await Promise.race([waitExit(parent),delay(18000)])
  if(parent.exitCode===null&&!parent.signalCode)parent.kill('SIGKILL')
  for(const pid of [hostPid,watchPid])if(pid)try{process.kill(pid,'SIGKILL')}catch{}
  rmSync(root,{recursive:true,force:true})
 }
},100000)
