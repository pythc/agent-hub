import {mkdirSync,mkdtempSync,writeFileSync,readFileSync} from 'node:fs'
import {join,resolve} from 'node:path'
import {Runtime} from '../src/runtime.ts'
import {configSchema} from '../src/config.ts'
import {serve} from '../src/server.ts'
mkdirSync(resolve('validation'),{recursive:true})
mkdirSync(resolve('.local'),{recursive:true})
const root=mkdtempSync(resolve('validation/managed-native-'))
writeFileSync(join(root,'input.txt'),'subagent-evidence-20261104\n')
const config=configSchema.parse({stateDir:join(root,'state'),port:0,codex:process.env.CODEX_BINARY??'codex',model:'gpt-6.1-terra',effort:'high',concurrency:1,turnTimeoutMs:180000,sources:[{id:'local',kind:'local',allowedActors:['operator'],cwd:root,sandbox:'read-only'}]})
const host=new Runtime(config),server=await serve(host)
try{
 host.receive('local','operator',{id:'native-managed',thread:'managed-work',addressed:true,text:'执行本机合成验收。只使用 superagent_shell 运行 sleep 2; printf shell-evidence-20261104，yieldMs=0。再使用 superagent_spawn 启动一个子代理，让它通过资源工具读取 input.txt 并报告其原文。主任务不要自行读取 input.txt 来替代子代理。无需等待长命令；有后台作业时可以先报告 waiting。两者完成后读取作业结果，最终回复必须包含 shell-evidence-20261104 和子代理读取的内容。全程只读，不联系外部系统。'})
 const until=Date.now()+360000
 while(Date.now()<until){
  await new Promise(r=>setTimeout(r,500))
  const t=host.store.tickets.list()[0]
  if(t?.ended){
   const state=host.status(),work=host.work.list(t.id),run=state.tickets[0]!.run
   if(!work.some(w=>w.kind==='shell'&&w.state==='completed')||!work.some(w=>w.kind==='agent'&&w.state==='completed')||!run?.result?.includes('shell-evidence-20261104')||!run.result.includes('subagent-evidence-20261104'))throw Error('Native lifecycle acceptance failed: '+JSON.stringify(state))
   const evidence={at:new Date().toISOString(),ticket:t.id,thread:run.threadId,result:run.result,work,deliveries:state.deliveries,sourceFile:readFileSync(join(root,'input.txt'),'utf8')}
   writeFileSync('validation/native-managed-work.json',JSON.stringify(evidence,null,2)+'\n')
   console.log(JSON.stringify({passed:true,ticket:t.id,thread:run.threadId,work:work.map(w=>({id:w.id,kind:w.kind,state:w.state})),result:run.result}));break
  }
  if(host.status().approvals.some((a:any)=>a.status==='pending'))throw Error('Unexpected native approval in read-only acceptance')
  if(host.store.list<any>('run').some(r=>r.phase==='uncertain'))throw Error('Native execution uncertain: '+JSON.stringify(host.status().tickets.map(t=>({run:t.run,attention:t.attention}))))
 }
 if(!host.store.tickets.list()[0]?.ended)throw Error('Native acceptance deadline exceeded')
}finally{await new Promise<void>(r=>server.server.close(()=>r()));await host.close()}
