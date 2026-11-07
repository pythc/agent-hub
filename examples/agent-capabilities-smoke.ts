/** Isolated native acceptance; never edits a running deployment. */
import {mkdtempSync,mkdirSync,writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {configSchema} from '../src/config.ts'
import {Runtime} from '../src/runtime.ts'
const root=process.env.AGENTHUB_SMOKE_DIR?resolve(process.env.AGENTHUB_SMOKE_DIR):mkdtempSync(join(tmpdir(),'agent-capabilities-'))
mkdirSync(join(root,'workspace'),{recursive:true})
const host=new Runtime(configSchema.parse({stateDir:join(root,'state'),codex:process.env.AGENTHUB_CODEX??'codex',turnTimeoutMs:120000,work:{sandboxDriver:'disabled'},execution:{router:{mode:'host',model:'gpt-6.1-terra',effort:'medium',prompt:'This is a bounded smoke test. Use each of the four configured Workers exactly once, then collect their results. Do not create, edit or destroy Workers. You can call worker_manage repeatedly within one turn. After receiving all four results, reply exactly VERIFIED 2 4 6 8. Until then return an empty reply.'},management:{enabled:true,maxWorkers:4,backends:['codex']},workers:Array.from({length:4},(_,i)=>({id:'worker-'+(i+1),backend:'codex',model:'gpt-6.1-sol',effort:'high',tools:[],prompt:'Do only the tiny arithmetic task. Do not use tools. Return a ready report with the arithmetic result as reply.'}))},sources:[{id:'local',kind:'local',allowedActors:['operator'],cwd:join(root,'workspace'),workspace:{mode:'source'}}]}))
try{
 host.receive('local','operator',{id:'smoke',thread:'native-pilot',text:'Verify the four configured Workers. Assign worker-1 to compute 1+1, worker-2 2+2, worker-3 3+3 and worker-4 4+4. Every assignment must be separate. Collect all four results and reply VERIFIED 2 4 6 8. Do not touch files or contact anyone.',addressed:true})
 const deadline=Date.now()+240000
 let seen=0,ok=false
 while(Date.now()<deadline){await host.tick();const calls=host.activity.list();if(calls.length!==seen){seen=calls.length;console.log(JSON.stringify({calls:calls.map(c=>({role:c.kind,worker:c.workerId,model:c.model,state:c.state})),tasks:host.store.tickets.list().length}))}
  const delivered=host.store.deliveries().find(d=>!d.channel.address.routerInbox&&d.text.trim()==='VERIFIED 2 4 6 8'&&d.status==='sent')
  if(delivered&&host.store.list<any>('worker-assignment').length===4&&host.store.tickets.list().every(t=>!!t.ended)&&host.status().active===0&&!host.store.jobs().some(j=>j.kind==='router')){ok=true;break}
  if(host.store.list<any>('run').some(r=>r.phase==='uncertain')&&host.status().active===0)break
  if(host.store.list('router-result').length&&host.store.tickets.list().length===0&&host.status().active===0)break
  await new Promise(r=>setTimeout(r,200))
 }
 const evidence={ok,root,calls:host.activity.list(),configurations:host.store.list('agent-configuration'),runs:host.store.list('run'),results:host.store.list('router-result'),delegations:host.store.list('worker-assignment'),deliveries:host.store.deliveries(),audit:host.store.db.prepare('SELECT body FROM audit ORDER BY seq DESC LIMIT 15').all().map(r=>JSON.parse(String(r.body)))}
 writeFileSync(join(root,'evidence.json'),JSON.stringify(evidence,null,2)+'\n')
 console.log(JSON.stringify({ok,evidence:join(root,'evidence.json')}))
 if(!ok)process.exitCode=1
}finally{await host.close()}
