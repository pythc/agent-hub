/** Frozen-dataset acceptance against a real local embedding/rerank HTTP server.
 * An optional checkout path runs the exact historical Runtime for comparison.
 * The dataset and scores are never used to adjust application thresholds here.
 */
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs'
import {join,resolve} from 'node:path'
import {fileURLToPath,pathToFileURL} from 'node:url'
const checkout=process.env.MEMORY_RETRIEVAL_CHECKOUT??fileURLToPath(new URL('..',import.meta.url))
const {Runtime}=await import(pathToFileURL(join(checkout,'src/runtime.ts')).href)
const {configSchema}=await import(pathToFileURL(join(checkout,'src/config.ts')).href)
const mode=process.env.MEMORY_RETRIEVAL_MODE??'rerank',url=process.env.MEMORY_RETRIEVAL_URL
assert(url&&new URL(url).hostname==='127.0.0.1','Use the isolated loopback acceptance adapter')
const root=process.env.MEMORY_RETRIEVAL_DIR??'/tmp/memory-retrieval-'+Date.now(),dataset=resolve(process.env.MEMORY_RETRIEVAL_DATASET??'tests/fixtures/memory-retrieval-regression.json'),bytes=readFileSync(dataset),data=JSON.parse(bytes.toString())
assert(!existsSync(join(root,'state')),'Fresh state directory required');mkdirSync(root,{recursive:true})
const report=(name:string,value:unknown)=>writeFileSync(join(root,name+'.json'),JSON.stringify(value,null,2))
report('fixture',{dataset,sha256:createHash('sha256').update(bytes).digest('hex'),mode,checkout})
const config=configSchema.parse({stateDir:join(root,'state'),port:0,acceptMode:'auto',work:{sandboxDriver:'disabled'},execution:{router:{mode:'host'},management:{enabled:true},workers:[{id:'one',backend:'codex'}]},sources:[{id:'local',kind:'local',cwd:root,workspace:{mode:'source'},allowedActors:['alice','bob']}]})
let h=new Runtime(config),seq=0
const context=(id:string)=>{const t=h.store.triggers.get(id)!;return h.scopes.context(t,'local:'+t.threads[0]!.id)!}
const send=(text:string,actor='alice',group='g1')=>context(h.receive('local',actor,{id:'input-'+(++seq),scope:group,thread:'thread-'+seq,addressed:true,text}).triggerId)
const remember=(c:any,subject:string,content:string,kind='fact',candidate=false)=>h.memory.command(c,{action:'remember',operationId:'manual-'+(++seq),expectedRevision:0,subject,content,kind,candidate,sourceIds:[h.memory.ingest(c).id]},true)
try{
 h.scopes.command({action:'scope.put',operationId:'scope',expectedRevision:0,scope:{id:'team',tenantId:'retrieval',name:'Retrieval acceptance',managers:[JSON.stringify(['local','alice'])],workerIds:['one'],sourceIds:['local'],backendIds:['codex']}})
 for(const group of ['g1','g2'])h.scopes.command({action:'entry.bind',operationId:group,expectedRevision:0,scopeId:'team',sourceId:'local',accountNamespace:'local',nativeId:group,history:'group'})
 const facts=data.records.map((row:any)=>remember(send(row.content),row.subject,row.content)),byId=new Map<string,string>(facts.map((f:any,i:number)=>[f.id,data.records[i].key]))
 const c=send('Acceptance context'),triggerId=c.trigger.id
 remember(send('Bob private preference','bob'),'hidden','DENIED_ACTOR_MARKER_73','preference')
 remember(send('Other entry','alice','g2'),'hidden','DENIED_ENTRY_MARKER_91')
 remember(c,'unconfirmed','DENIED_CANDIDATE_MARKER_64','fact',true)
 const rerankerModel=process.env.MEMORY_RERANK_MODEL??'BAAI/bge-reranker-v2-m3',minScore=Number(process.env.MEMORY_RERANK_MIN_SCORE??.5)
 assert(Number.isFinite(minScore)&&minScore>=0&&minScore<=1)
 const policy={embedding:{url:url+'/embeddings',model:'BAAI/bge-small-zh-v1.5'},...(mode==='rerank'?{reranker:{url:url+'/rerank',model:rerankerModel,minScore,candidateLimit:20}}:{})}
 h.agentMemory.manage(c,{action:'configure',expectedRevision:0,policy})
 for(let pass=0;pass<Math.ceil(facts.length/20);pass++)await h.agentMemory.index(c,new AbortController().signal)
 assert.equal(h.store.list('memory-vector').length,facts.length)
 const before=await(await fetch(url+'/stats')).json() as any,firstCall=before.calls.length
 const results:any[]=[]
 for(const row of data.records)for(const query of row.queries){
  const start=Date.now(),result=await h.agentMemory.search(c,query,5)
  results.push({query,expected:row.key,actual:result.items.map((f:any)=>byId.get(f.id)??f.id),mode:result.mode,status:result.status,ms:Date.now()-start})
 }
 for(const query of data.negativeQueries){const start=Date.now(),result=await h.agentMemory.search(c,query,5);results.push({query,expected:null,actual:result.items.map((f:any)=>byId.get(f.id)??f.id),mode:result.mode,status:result.status,ms:Date.now()-start})}
 const positives=results.filter(r=>r.expected!==null),negatives=results.filter(r=>r.expected===null),latencies=results.map(r=>r.ms).sort((a,b)=>a-b)
 const quality={positives:positives.length,top1:positives.filter(r=>r.actual[0]===r.expected).length,recall5:positives.filter(r=>r.actual.includes(r.expected)).length,negatives:negatives.length,negativeEmpty:negatives.filter(r=>r.actual.length===0).length,partial:results.filter(r=>r.status!=='complete').length,p50Ms:latencies[Math.floor(latencies.length*.5)],p95Ms:latencies[Math.min(latencies.length-1,Math.floor(latencies.length*.95))]}
 report('results',{quality,results});console.log(JSON.stringify(quality))
 const calls=(await(await fetch(url+'/stats')).json() as any).calls.slice(firstCall)
 assert(!JSON.stringify(calls.map((call:any)=>call.documents)).includes('DENIED_'),'Unauthorized text reached reranker')
 report('calls',{calls})
 await h.close();h=new Runtime(config)
 const restored=context(triggerId),count=(await(await fetch(url+'/stats')).json() as any).calls.length
 await h.agentMemory.index(restored,new AbortController().signal);assert.equal((await(await fetch(url+'/stats')).json() as any).calls.length,count,'Vectors re-embedded on restart')
 const repeated=await h.agentMemory.search(restored,data.records[0].queries[0],5);assert.deepEqual(repeated.items.map((f:any)=>byId.get(f.id)),results[0].actual)
 const acceptance=data.acceptance?{top1:quality.top1/quality.positives>=data.acceptance.minimumTop1,recall5:quality.recall5/quality.positives>=data.acceptance.minimumRecall5,negativeEmpty:quality.negativeEmpty/quality.negatives>=data.acceptance.minimumNegativeEmpty}:undefined
 report('evidence',{functionalChecksPassed:true,qualityStatus:acceptance?(Object.values(acceptance).every(Boolean)?'passed':'failed'):'not_specified',policy,quality,acceptance,checks:['actual HTTP inference','authorized candidate egress','same corpus and fixed thresholds','Runtime reconstructed over SQLite: vector reuse and ranking repeat'],at:new Date().toISOString()})
 console.log('RETRIEVAL_EVALUATION_COMPLETE '+root)
}catch(error){report('failure',{error:String(error),stack:error instanceof Error?error.stack:undefined});throw error}finally{await h.close()}
