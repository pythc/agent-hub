import {mkdirSync,mkdtempSync,writeFileSync,readFileSync,existsSync} from 'node:fs'
import {join,resolve} from 'node:path'
import {spawn,type ChildProcessWithoutNullStreams} from 'node:child_process'
import {createInterface} from 'node:readline'
mkdirSync(resolve('validation'),{recursive:true})
mkdirSync(resolve('.local'),{recursive:true})
const root=mkdtempSync(resolve('validation/managed-native-crash-')),configFile=join(root,'config.json'),stateDir=join(root,'state')
writeFileSync(configFile,JSON.stringify({stateDir,port:0,codex:process.env.CODEX_BINARY??'codex',model:'gpt-6.1-terra',effort:'high',turnTimeoutMs:180000,sources:[{id:'local',kind:'local',allowedActors:['operator'],cwd:root,sandbox:'workspace-write',workspace:{mode:'source'}}]}))
async function start(){
 const child=spawn(process.execPath,['--import',resolve('node_modules/tsx/dist/loader.mjs'),resolve('src/cli.ts'),'serve',configFile],{stdio:['pipe','pipe','pipe']})
 child.stderr.resume()
 const url=await new Promise<string>((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Host start deadline')),15000);createInterface({input:child.stdout}).on('line',line=>{try{const d=JSON.parse(line);if(d.url){clearTimeout(timer);resolve(d.url)}}catch{}});child.once('exit',code=>{clearTimeout(timer);reject(Error('Host exited '+code))})})
 const token=readFileSync(join(stateDir,'access-token'),'utf8')
 const api=async(path:string,body?:any)=>{const response=await fetch(url+path,{method:body?'POST':'GET',headers:{authorization:'Bearer '+token,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});if(!response.ok)throw Error('Host HTTP '+response.status);return response.json() as Promise<any>}
 return {child,api}
}
async function until(api:(p:string)=>Promise<any>,fn:(s:any)=>boolean,ms:number){const end=Date.now()+ms;while(Date.now()<end){const s=await api('/status');if(s.tickets.some((t:any)=>t.run?.phase==='uncertain'))throw Error(JSON.stringify(s.tickets.map((t:any)=>t.run)));if(fn(s))return s;await new Promise(r=>setTimeout(r,150))}throw Error('Acceptance deadline')}
let first:Awaited<ReturnType<typeof start>>|undefined,second:Awaited<ReturnType<typeof start>>|undefined
try{
 first=await start()
 await first.api('/send',{source:'local',event:{id:'crash-test',thread:'crash',addressed:true,text:'合成重启恢复验收。首次执行仅调用一次 superagent_shell，requestId=once，command 为 printf started\\n >> marker.txt; sleep 60; printf should-not-complete >> late.txt，yieldMs=0。启动后立刻返回 waiting，不要继续等待或查询作业，宿主稍后会重启。如果收到宿主恢复说明，禁止再次运行该命令；只调用 superagent_read 读取 jobs 和 files/marker.txt 资源，不要用 shell 读取，确认旧作业已 interrupted，并最终 reply 包含 recovery-ok 和标记文件原文。禁止子代理和外部联络。'}})
 const before=await until(first.api,s=>s.tickets[0]?.run?.phase==='background'&&s.work.some((w:any)=>w.kind==='shell'&&w.state==='running'),180000),original=before.tickets[0].run.threadId,job=before.work.find((w:any)=>w.kind==='shell')
 await new Promise<void>(r=>{first!.child.once('close',()=>r());first!.child.kill('SIGKILL')})
 second=await start()
 const after=await until(second.api,s=>!!s.tickets[0]?.ended,240000),run=after.tickets[0].run
 const marker=readFileSync(join(root,'marker.txt'),'utf8')
 if(run.threadId!==original||!run.result.includes('recovery-ok')||after.work.filter((w:any)=>w.command?.includes('printf started')).length!==1||after.work[0].state!=='interrupted'||existsSync(join(root,'late.txt'))||(marker.match(/started/g)??[]).length!==1)throw Error('Crash recovery checks failed '+JSON.stringify({run,work:after.work,marker}))
 let oldPidAlive=false;try{process.kill(job.pid,0);oldPidAlive=true}catch{}
 if(oldPidAlive)throw Error('Old managed runner survived host crash')
 const evidence={at:new Date().toISOString(),passed:true,thread:original,resumedThread:run.threadId,result:run.result,marker,oldRunnerExited:true,work:after.work,assignments:after.tickets[0].assignments}
 writeFileSync('validation/native-crash-recovery.json',JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify(evidence))
}finally{for(const instance of [first,second])if(instance&&instance.child.exitCode===null&&instance.child.signalCode===null)await new Promise<void>(r=>{instance.child.once('close',()=>r());instance.child.kill('SIGTERM')})}
