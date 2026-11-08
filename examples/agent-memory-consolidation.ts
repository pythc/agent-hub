/** Real-model consolidation with a process-group crash after the actual model turn starts. */
import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {Runtime} from '../src/runtime.ts'
import {configSchema} from '../src/config.ts'
import type {MemoryFact} from '../src/router-memory.ts'

const root=process.env.MEMORY_CONSOLIDATION_DIR??'/tmp/agenthub-memory-consolidation-'+Date.now(),phase=process.env.MEMORY_CONSOLIDATION_PHASE
const report=(name:string,value:unknown)=>writeFileSync(join(root,name+'.json'),JSON.stringify(value,null,2))
const read=(name:string)=>JSON.parse(readFileSync(join(root,name+'.json'),'utf8'))
if(!phase){
 assert(!existsSync(join(root,'state')),'Fresh directory required');mkdirSync(root,{recursive:true})
 for(const p of ['seed','crash','recover','confirm','forget','verify'])await new Promise<void>((resolve,reject)=>{
  const child=spawn(process.execPath,['--import','tsx',fileURLToPath(import.meta.url)],{env:{...process.env,MEMORY_CONSOLIDATION_DIR:root,MEMORY_CONSOLIDATION_PHASE:p},stdio:'inherit',detached:p==='crash'})
  let killed=false
  const timer=p==='crash'?setInterval(()=>{if(!existsSync(join(root,'inflight.json')))return;clearInterval(timer!);killed=true;process.kill(-child.pid!,'SIGKILL')},30):undefined
  const deadline=setTimeout(()=>{if(timer)clearInterval(timer);if(p==='crash')process.kill(-child.pid!,'SIGTERM');else child.kill('SIGTERM');reject(Error('Phase deadline '+p))},240000)
  child.once('error',reject);child.once('exit',(code,signal)=>{clearTimeout(deadline);if(timer)clearInterval(timer);code===0||p==='crash'&&killed&&signal==='SIGKILL'?resolve():reject(Error(p+' exited '+code+' '+signal))})
 })
 report('evidence',{ok:true,phases:['seed','crash','recover','confirm','forget','verify'],checks:['real consolidation in-flight SIGKILL','automatic rescheduling after restart','candidate-only merge','preserved old active facts','qualifications retained','confirmation after restart','no duplicate proposal','forget and restart'],at:new Date().toISOString()});console.log('MEMORY_CONSOLIDATION_PASS '+root)
}else{
 const h=new Runtime(configSchema.parse({stateDir:join(root,'state'),port:0,codex:process.env.AGENTHUB_CODEX??'codex',acceptMode:'auto',work:{sandboxDriver:'disabled'},execution:{router:{mode:'host',model:'gpt-6.1-terra',effort:'medium'},management:{enabled:true},workers:[{id:'one',backend:'codex'}]},sources:[{id:'local',kind:'local',cwd:root,workspace:{mode:'source'},allowedActors:['operator']}]}))
 const context=(id:string)=>{const t=h.store.triggers.get(id)!;return h.scopes.context(t,'local:'+t.threads[0]!.id)!}
 const send=(id:string,text:string)=>context((h.receive('local','operator',{id,scope:'test',thread:id,addressed:true,text}) as any).triggerId)
 try{
  if(phase==='seed'){
   h.scopes.command({action:'scope.put',operationId:'scope',expectedRevision:0,scope:{id:'team',tenantId:'consolidation',name:'Isolated consolidation',managers:[JSON.stringify(['local','operator'])],workerIds:['one'],sourceIds:['local'],backendIds:['codex']}})
   h.scopes.command({action:'entry.bind',operationId:'entry',expectedRevision:0,scopeId:'team',sourceId:'local',accountNamespace:'local',nativeId:'test',history:'group'})
   const records=[
    ['报告顺序','中文技术报告首先列出结论，然后列出验证证据；尚未验证的内容必须单独标明。','preference'],
    ['报告顺序','技术报告使用中文，按结论、证据的顺序组织；不要把未验证内容写成已验证。','preference'],
    ['请求超时','开发环境的请求超时上限为 30 秒。','fact'],
    ['请求超时','生产环境的请求超时上限为 10 秒。','fact'],
    ['异地备份','数据库每天凌晨三点执行异地备份。','fact'],
    ['代码语言','生产后端服务使用 Go 语言开发。','fact'],
   ]
   const ids=records.map(([subject,content,kind],i)=>{const c=send('fact-'+i,content!);return (h.memory.command(c,{action:'remember',operationId:'manual-'+i,expectedRevision:0,subject,content,kind,sourceIds:[h.memory.ingest(c).id],candidate:false},true) as MemoryFact).id})
   const c=send('anchor','准备检查记忆整理'),contract={objective:'preserve-original-goal',acceptance:['independent verification'],authorization:['local fixture only']}
   h.store.put('router-goal','immutable-fixture',{id:'immutable-fixture',contract})
   h.agentMemory.manage(c,{action:'configure',expectedRevision:0,policy:{writeMode:'auto',delayMs:0,minIntervalMs:0,extractModel:'gpt-6.1-terra'}})
   report('anchor',{triggerId:c.trigger.id,ids,contract})
  }else{
   const anchor=read('anchor'),c=context(anchor.triggerId),space=h.agentMemory.space(c)
   if(phase==='crash'){
    const run=h.model.run.bind(h.model);h.model.run=r=>run({...r,onTurn:id=>{r.onTurn?.(id);report('inflight',{pid:process.pid,turnId:id,consolidation:h.store.get('memory-consolidation',space)})}})
    h.agentMemory.tick();await h.agentMemory.drain();throw Error('Expected actual model turn to be killed')
   }else if(phase==='recover'){
    report('recovered-before',{pid:process.pid,consolidation:h.store.get('memory-consolidation',space)})
    assert.equal(h.store.get<any>('memory-consolidation',space)?.status,'interrupted','crashed consolidation remains stuck running')
    h.agentMemory.tick();await h.agentMemory.drain()
    const items=h.memory.query(c,{candidates:true}).items,proposals=items.filter(f=>f.state==='candidate'),merge=proposals.find(f=>anchor.ids.slice(0,2).every((id:string)=>f.replaces?.some(ref=>ref.id===id)))
    report('proposals',{items,consolidation:h.store.get('memory-consolidation',space),calls:h.activity.list()})
    assert(merge,'real model did not merge equivalent report preferences');assert(anchor.ids.every((id:string)=>h.memory.fact(id)?.state==='active'),'unconfirmed consolidation erased old facts')
    assert(/未验证/.test(merge.content)&&/结论/.test(merge.content)&&/证据/.test(merge.content),'qualification lost from merge')
    for(const f of proposals)if(f.replaces?.some(ref=>anchor.ids.slice(2,4).includes(ref.id)))assert(/开发/.test(f.content)&&/30/.test(f.content)&&/生产/.test(f.content)&&/10/.test(f.content),'environment-specific limits collapsed')
    assert.deepEqual(h.store.get<any>('router-goal','immutable-fixture').contract,anchor.contract)
    report('merge',{id:merge.id,content:merge.content,revision:merge.revision,proposals:proposals.length})
   }else if(phase==='confirm'){
    const merge=read('merge');assert.equal(h.memory.fact(merge.id)?.state,'candidate')
    h.memory.command(c,{action:'confirm',operationId:'confirm-merge',id:merge.id,expectedRevision:merge.revision},true)
    assert(anchor.ids.slice(0,2).every((id:string)=>h.memory.fact(id)?.state==='superseded'));assert.equal(h.memory.fact(merge.id)?.state,'active')
    h.agentMemory.tick();await h.agentMemory.drain();assert.equal(h.store.list<MemoryFact>('memory-fact').filter(f=>f.origin==='consolidated').length,merge.proposals)
   }else if(phase==='forget'){
    const merge=read('merge'),fact=h.memory.fact(merge.id)!;assert.equal(fact.state,'active');h.memory.command(c,{action:'forget',operationId:'forget-merge',id:fact.id,expectedRevision:fact.revision},true)
   }else{
    const merge=read('merge'),ids=[merge.id,...anchor.ids.slice(0,2)]
    assert(!h.agentMemory.authorized(c,true).some(f=>ids.includes(f.id)));assert.deepEqual(h.store.get<any>('router-goal','immutable-fixture').contract,anchor.contract)
   }
  }
  report('phase-'+phase,{ok:true,pid:process.pid,at:new Date().toISOString()});console.log('PASS consolidation '+phase)
 }catch(error){report('failure-'+phase,{error:String(error),stack:error instanceof Error?error.stack:undefined,calls:h.activity.list()});throw error}finally{await h.close()}
}
