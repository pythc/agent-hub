/** Optional real-model acceptance; no canned vectors or production state.
 * MEMORY_EMBEDDING_PYTHON and MEMORY_EMBEDDING_SNAPSHOT select an interpreter
 * and a pre-downloaded snapshot. MEMORY_EMBEDDING_ENGINE selects model2vec
 * (default) or transformers (BGE CLS pooling); MEMORY_EMBEDDING_MODEL labels it.
 */
import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {createHash} from 'node:crypto'
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {Runtime} from '../src/runtime.ts'
import {configSchema} from '../src/config.ts'
import type {ScopeContext} from '../src/router-scope.ts'
import type {MemoryFact} from '../src/router-memory.ts'
import {lexicalScore} from '../src/memory-policy.ts'

// Fixed before inference. Report accuracy honestly; these examples are not a benchmark.
const corpus=[
 {key:'database',subject:'数据存储',content:'生产订单持久化到 PostgreSQL 关系型数据库。',query:'线上交易记录存放在什么系统里？'},
 {key:'deployment',subject:'部署策略',content:'应用部署采用蓝绿发布，先启动新环境再切换流量。',query:'升级时如何做到用户请求不中断？'},
 {key:'backup',subject:'灾难恢复',content:'每天凌晨三点把数据库快照备份到异地。',query:'故障以后靠什么恢复丢失的数据？'},
 {key:'queue',subject:'任务队列',content:'异步任务通过 Redis 队列处理。',query:'后台作业由哪种中间件排队？'},
 {key:'api',subject:'接口文档',content:'项目接口说明使用 OpenAPI 格式编写。',query:'HTTP API 的契约用哪套规范表示？'},
 {key:'report',subject:'报告顺序',content:'技术汇报先列结论，再补充证明和限制条件。',query:'说明结果时我希望先说什么？'},
 {key:'language',subject:'开发语言',content:'后端服务主要使用 Go 语言编写。',query:'服务器程序用哪种编程语言实现？'},
 {key:'acceptance',subject:'验收流程',content:'正式发布前必须由独立验证器核对验收标准。',query:'上线之前由谁检查工作是否达标？'},
 {key:'timezone',subject:'团队时区',content:'团队开会统一采用北京时间。',query:'会议日程按哪个时区安排？'},
 {key:'vegetarian',subject:'饮食偏好',content:'我是素食者，不吃肉类和鱼。',query:'聚餐选菜需要避开什么食材？'},
 {key:'travel',subject:'差旅习惯',content:'短途出差优先乘坐高铁。',query:'附近城市的商务旅行喜欢什么交通方式？'},
 {key:'design',subject:'界面风格',content:'管理后台默认采用暗色主题。',query:'控制面板的默认外观是深色还是浅色？'},
]
const negatives=['火星表面平均温度是多少？','唐代诗人李白出生在哪一年？','怎么制作草莓蛋糕？','量子纠缠的贝尔不等式是什么？']
const root=process.env.MEMORY_SEMANTIC_DIR??'/tmp/agenthub-memory-semantic-'+Date.now()
const modelName=process.env.MEMORY_EMBEDDING_MODEL??'minishlab/potion-multilingual-128M'
const phase=process.env.MEMORY_SEMANTIC_PHASE
const report=(name:string,value:unknown)=>writeFileSync(join(root,name+'.json'),JSON.stringify(value,null,2))
const read=(name:string)=>JSON.parse(readFileSync(join(root,name+'.json'),'utf8'))
if(!phase){
 assert(!existsSync(join(root,'state')),'Fresh acceptance directory required')
 const python=process.env.MEMORY_EMBEDDING_PYTHON,snapshot=process.env.MEMORY_EMBEDDING_SNAPSHOT
 assert(python&&snapshot,'Set MEMORY_EMBEDDING_PYTHON and MEMORY_EMBEDDING_SNAPSHOT')
 mkdirSync(root,{recursive:true});report('dataset',{corpus,negatives,sha256:createHash('sha256').update(JSON.stringify({corpus,negatives})).digest('hex')})
 const server=spawn(python,[fileURLToPath(new URL('./memory-embedding-server.py',import.meta.url)),'--snapshot',snapshot,'--engine',process.env.MEMORY_EMBEDDING_ENGINE??'model2vec'],{stdio:['ignore','pipe','inherit'],env:{...process.env,HF_HUB_OFFLINE:'1',TOKENIZERS_PARALLELISM:'false'}})
 try{
  const ready=await new Promise<any>((resolve,reject)=>{let data='';const timer=setTimeout(()=>reject(Error('Embedding adapter startup timeout')),60000);const fail=(error:unknown)=>{clearTimeout(timer);reject(error)};server.once('error',fail);server.once('exit',code=>fail(Error('Adapter exited '+code)));server.stdout.on('data',chunk=>{data+=chunk.toString();if(data.includes('\n')){clearTimeout(timer);try{resolve(JSON.parse(data.split('\n')[0]!))}catch(error){fail(error)}}})})
  ready.model=modelName;report('provider',ready)
  for(const p of ['seed','restart','failures','forget','late-clear','verify'])await new Promise<void>((resolve,reject)=>{
   const child=spawn(process.execPath,['--import','tsx',fileURLToPath(import.meta.url)],{env:{...process.env,MEMORY_SEMANTIC_DIR:root,MEMORY_SEMANTIC_PHASE:p,MEMORY_EMBEDDING_URL:ready.url},stdio:'inherit'})
   const timer=setTimeout(()=>{child.kill('SIGTERM');reject(Error('Phase deadline '+p))},120000)
   child.once('error',reject);child.once('exit',code=>{clearTimeout(timer);code===0?resolve():reject(Error(p+' exited '+code))})
  })
  report('provider-calls',await(await fetch(ready.url+'/stats')).json())
  report('evidence',{ok:true,provider:ready,phases:['seed','restart','failures','forget','late-clear','verify'],quality:read('seed').quality,checks:['real HTTP inference','persisted vector reuse in a new process','entry and actor isolation','provider failure and timeout fallback','personal pause','source revocation','forget and restart','clear during real inference','clear and restart'],at:new Date().toISOString()})
  console.log('MEMORY_SEMANTIC_PASS '+root)
 }finally{server.kill('SIGTERM');if(server.exitCode===null)await new Promise<void>(resolve=>server.once('exit',()=>resolve()))}
}else{
 const url=process.env.MEMORY_EMBEDDING_URL!,config=configSchema.parse({stateDir:join(root,'state'),port:0,acceptMode:'auto',work:{sandboxDriver:'disabled'},execution:{router:{mode:'host'},management:{enabled:true},workers:[{id:'one',backend:'codex'}]},sources:[{id:'local',kind:'local',cwd:root,workspace:{mode:'source'},allowedActors:['alice','bob']}]})
 const h=new Runtime(config);let seq=0
 const context=(id:string)=>{const t=h.store.triggers.get(id)!;return h.scopes.context(t,'local:'+t.threads[0]!.id)!}
 const send=(text:string,actor='alice',group='g1')=>context((h.receive('local',actor,{id:phase+'-'+(++seq),scope:group,thread:phase+'-'+seq,addressed:true,text}) as any).triggerId)
 const remember=(c:ScopeContext,subject:string,content:string,kind='fact')=>h.memory.command(c,{action:'remember',operationId:'manual-'+phase+'-'+(++seq),expectedRevision:0,subject,content,kind,candidate:false,sourceIds:[h.memory.ingest(c).id]},true) as MemoryFact
 const stats=async()=>(await(await fetch(url+'/stats')).json() as any).calls as any[]
 const control=async(value:unknown)=>{await fetch(url+'/control',{method:'POST',body:JSON.stringify(value)})}
 const waitInferred=async(input:string)=>{const deadline=Date.now()+10000;while(Date.now()<deadline){if((await stats()).some(r=>r.input===input&&r.state==='inferred'))return;await new Promise(r=>setTimeout(r,20))}throw Error('No real in-flight inference observed')}
 try{
  if(phase==='seed'){
   h.scopes.command({action:'scope.put',operationId:'scope',expectedRevision:0,scope:{id:'team',tenantId:'semantic',name:'Semantic acceptance',managers:[JSON.stringify(['local','alice'])],workerIds:['one'],sourceIds:['local'],backendIds:['codex']}})
   for(const name of ['g1','g2'])h.scopes.command({action:'entry.bind',operationId:name,expectedRevision:0,scopeId:'team',sourceId:'local',accountNamespace:'local',nativeId:name,history:'group'})
   const c=send('Setup'),facts=corpus.map(row=>remember(send(row.content),row.subject,row.content)),byId=new Map(facts.map((f,i)=>[f.id,corpus[i]!.key]))
   const lexical=await Promise.all(corpus.map(row=>h.agentMemory.search(c,row.query,5)))
   const hidden=remember(send('Bob private preference','bob'),'私人偏好','秘密标识 Orchid-937；我偏好雪山徒步。','preference')
   const other=remember(send('Other entry','alice','g2'),'另一入口','秘密标识 Cobalt-418；迁移后使用远程对象存储。')
   const bob=send('Bob context','bob'),g2=send('Other context','alice','g2')
   h.agentMemory.manage(c,{action:'configure',expectedRevision:0,policy:{embedding:{url:url+'/embeddings',model:modelName}}})
   for(const ctx of [c,bob,g2])await h.agentMemory.index(ctx,new AbortController().signal)
   const vectors=h.store.list<any>('memory-vector');assert.equal(vectors.length,facts.length+2);assert(vectors.every(v=>v.vector.length===read('provider').dimensions&&v.vector.every(Number.isFinite)))
   const results=[]
   for(const [i,row] of corpus.entries()){
    const hybrid=await h.agentMemory.search(c,row.query,5);assert.equal(hybrid.mode,'hybrid')
    results.push({key:row.key,query:row.query,lexicalScore:lexicalScore(row.query,row.subject+' '+row.content),lexical:lexical[i]!.items.map(f=>byId.get(f.id)),hybrid:hybrid.items.map(f=>byId.get(f.id))})
   }
   const unrelated=[];for(const query of negatives)unrelated.push({query,items:(await h.agentMemory.search(c,query,5)).items.map(f=>byId.get(f.id))})
   const acl=[];for(const query of ['Orchid-937 雪山徒步','Cobalt-418 远程对象存储']){const r=await h.agentMemory.search(c,query);assert(!r.items.some(f=>[hidden.id,other.id].includes(f.id)));acl.push({query,returned:r.items.map(f=>f.id)})}
   const quality={count:corpus.length,lexicalTop1:results.filter(r=>r.lexical[0]===r.key).length,hybridTop1:results.filter(r=>r.hybrid[0]===r.key).length,lexicalRecall5:results.filter(r=>r.lexical.includes(r.key)).length,hybridRecall5:results.filter(r=>r.hybrid.includes(r.key)).length,zeroLexical:results.filter(r=>r.lexicalScore===0).length,zeroLexicalRecovered:results.filter(r=>r.lexicalScore===0&&r.hybrid.includes(r.key)).length,negativeQueries:negatives.length,negativeQueriesWithResults:unrelated.filter(r=>r.items.length).length}
   report('anchor',{triggerId:c.trigger.id,factIds:facts.map(f=>f.id),hiddenId:hidden.id,otherId:other.id})
   report(phase,{pid:process.pid,quality,results,unrelated,acl,vectors:vectors.length});console.log(JSON.stringify(quality))
  }else{
   const anchor=read('anchor'),c=context(anchor.triggerId)
   if(phase==='restart'){
    const before=(await stats()).length;await h.agentMemory.index(c,new AbortController().signal);assert.equal((await stats()).length,before,'restart re-embedded unchanged facts')
    const result=await h.agentMemory.search(c,corpus[0]!.query);assert.equal(result.mode,'hybrid');assert.equal((await stats()).length,before+1)
    report(phase,{ok:true,pid:process.pid,reusedVectors:h.store.list('memory-vector').length,queryInferenceCalls:1})
   }else if(phase==='failures'){
    const offline='PostgreSQL unavailable test',slow='Go language slow test'
    await control({[offline]:{fail:true},[slow]:{delayMs:3000}})
    const a=await h.agentMemory.search(c,offline);assert.equal(a.status,'partial');assert.equal(a.mode,'embedding_unavailable');assert(a.items.some(f=>f.id===anchor.factIds[0]))
    const start=Date.now(),b=await h.agentMemory.search(c,slow),elapsed=Date.now()-start;assert.equal(b.status,'partial');assert.equal(b.mode,'embedding_unavailable');assert(elapsed>=1800&&elapsed<2800);assert(b.items.some(f=>f.id===anchor.factIds[6]))
    const before=(await stats()).length,sensitive=await h.agentMemory.search(c,'password: synthetic-only-value');assert.equal(sensitive.mode,'embedding_skipped_sensitive');assert.equal((await stats()).length,before)
    h.agentMemory.manage(c,{action:'personal',enabled:false});assert.equal((await h.agentMemory.search(c,'PostgreSQL')).status,'unavailable');assert.equal((await stats()).length,before);h.agentMemory.manage(c,{action:'personal',enabled:true})
    report(phase,{ok:true,pid:process.pid,offline:a.mode,timeout:b.mode,timeoutMs:elapsed,sensitive:sensitive.mode});await control({})
   }else if(phase==='forget'){
    const target=h.memory.fact(anchor.factIds[0])!;h.memory.command(c,{action:'forget',operationId:'forget-database',id:target.id,expectedRevision:target.revision},true)
    const current=context(anchor.triggerId)
    assert(!(await h.agentMemory.search(current,corpus[0]!.query)).items.some(f=>f.id===target.id));assert(!h.store.list<any>('memory-vector').some(v=>v.factId===target.id))
    const revoked=h.memory.fact(anchor.factIds[1])!,source=h.memory.evidence(revoked.sources[0]!.id)!;h.store.put('memory-evidence',source.id,{...source,revoked:true,version:source.version+1,text:''});h.agentMemory.reconcile()
    assert(!(await h.agentMemory.search(current,corpus[1]!.query)).items.some(f=>f.id===revoked.id));assert(!h.store.list<any>('memory-vector').some(v=>v.factId===revoked.id))
    report(phase,{ok:true,pid:process.pid,forgotten:target.id,revoked:revoked.id})
   }else if(phase==='late-clear'){
    assert(!h.agentMemory.authorized(c).some(f=>anchor.factIds.slice(0,2).includes(f.id)),'forgotten/revoked fact returned after restart')
    const query='清空过程中的真实向量请求';await control({[query]:{delayMs:1000}})
    const pending=h.agentMemory.search(c,query).then(value=>({value}),error=>({error:String(error)}));await waitInferred(query)
    h.memory.command(c,{action:'clear',operationId:'clear-during-inference',expectedRevision:h.memory.generation(c.route.scopeId)},true)
    const late=await pending;assert('error' in late||late.value.items.length===0);assert.equal(h.store.list('memory-vector').length,0)
    report(phase,{ok:true,pid:process.pid,observedRealInference:true,late});await control({})
   }else{
    const current=send('Fresh context after clear');assert.equal(h.agentMemory.authorized(current,true).length,0);assert.equal(h.store.list('memory-vector').length,0);assert.equal((await h.agentMemory.search(current,'PostgreSQL Go Redis')).items.length,0)
    report(phase,{ok:true,pid:process.pid,facts:0,vectors:0})
   }
  }
  console.log('PASS semantic '+phase)
 }catch(error){report('failure-'+phase,{error:String(error),stack:error instanceof Error?error.stack:undefined});throw error}finally{await h.close()}
}
