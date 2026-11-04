import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { configSchema } from '../src/config.ts'
import { Runtime } from '../src/runtime.ts'
const root = mkdtempSync(resolve('examples/code-run-'))
const git=(...args:string[])=>execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim()
git('init')
writeFileSync(join(root,'sum.mjs'),'export function sum(a,b) { return a - b }\n')
writeFileSync(join(root,'sum.test.mjs'),"import { test } from 'node:test'; import assert from 'node:assert/strict'; import { sum } from './sum.mjs'; test('sums values',()=>{assert.equal(sum(2,3),5);assert.equal(sum(-2,3),1)})\n")
git('add','sum.mjs','sum.test.mjs')
git('-c','user.name=Superagent Fixture','-c','user.email=fixture@localhost','-c','commit.gpgsign=false','commit','-m','test fixture')
const config=configSchema.parse({stateDir:join(root,'state'),model:'gpt-6.1-terra',effort:'high',turnTimeoutMs:180_000,sources:[{id:'local',kind:'local',allowedActors:['operator'],cwd:root,sandbox:'workspace-write'}]})
const runtime=new Runtime(config)
runtime.start()
try{
 runtime.receive('local','operator',{id:'fix-sum',thread:'sum',addressed:true,text:'Fix the bug in sum.mjs so sum adds two numbers. Run node --test sum.test.mjs to verify, and report the actual result. Keep the test assertions. Do not commit or publish.'})
 const deadline=Date.now()+210_000
 while(Date.now()<deadline){
  const status=runtime.status(), ticket=status.tickets[0]
  if(ticket?.attention)throw Error(JSON.stringify(ticket.attention))
  if(status.deliveries.some(d=>d.status==='sent')){
   const cwd=ticket!.run!.cwd
   const tests=execFileSync(process.execPath,['--test','sum.test.mjs'],{cwd,encoding:'utf8'})
   if(readFileSync(join(root,'sum.mjs'),'utf8')!=='export function sum(a,b) { return a - b }\n')throw Error('Original checkout was modified')
   const evidence={root,worktree:cwd,threadId:ticket!.run!.threadId,tests,status}
   writeFileSync(join(root,'evidence.json'),JSON.stringify(evidence,null,2))
   console.log(JSON.stringify({root,worktree:cwd,threadId:ticket!.run!.threadId,tests,reply:ticket!.run!.result},null,2))
   break
  }
  await new Promise(resolve=>setTimeout(resolve,500))
 }
 if(!runtime.store.deliveries().some(d=>d.status==='sent'))throw Error('Native code validation timed out')
}finally{await runtime.close()}
