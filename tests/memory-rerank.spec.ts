import {afterEach,it,expect} from 'vitest'
import {createServer,type Server,type RequestListener} from 'node:http'
import {memoryCandidates,rerankMemory,validateMemoryRelevance} from '../src/memory-rerank.ts'
const servers:Server[]=[]
afterEach(async()=>{delete process.env.AGENTHUB_RERANK_TEST_KEY;for(const s of servers.splice(0)){s.closeAllConnections();await new Promise<void>(resolve=>s.close(()=>resolve()))}})
async function fixture(handler:RequestListener){const server=createServer(handler);servers.push(server);await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));return 'http://127.0.0.1:'+(server.address() as any).port+'/rerank'}
it('reserves dense candidates despite a large pool of lexical distractors',()=>{
 const dense=Array.from({length:30},(_,i)=>({id:'dense-'+i})),lexical=Array.from({length:100},(_,i)=>({id:'lex-'+i})),items=memoryCandidates(dense,lexical,20)
 expect(items).toHaveLength(20);expect(items.filter(f=>f.id.startsWith('dense'))).toHaveLength(10);expect(items[0]?.id).toBe('dense-0');expect(memoryCandidates(dense,dense,20)).toHaveLength(20)
})
it.each([
 [{index:0,relevance_score:.5},{index:0,relevance_score:.8}],
 [{index:0,relevance_score:.5}],
 [{index:0,relevance_score:.5},{index:2,relevance_score:.8}],
 [{index:0,relevance_score:.5},{index:1,relevance_score:NaN}],
 [{index:0,relevance_score:.5},{index:1,relevance_score:1.01}],
 [{index:0,relevance_score:.5},{index:1,relevance_score:'0.8'}],
].map(value=>({value})))('rejects invalid score mapping %#',({value})=>expect(()=>validateMemoryRelevance(value,2)).toThrow('invalid_rerank_results'))
it('uses complete indexed scores and explicit environment credentials',async()=>{
 let received:any;process.env.AGENTHUB_RERANK_TEST_KEY='synthetic-rerank-key'
 const url=await fixture(async(req,res)=>{let body='';for await(const part of req)body+=part;received={body:JSON.parse(body),authorization:req.headers.authorization};res.end(JSON.stringify({results:[{index:1,relevance_score:.9},{index:0,relevance_score:.1}]}))})
 expect(await rerankMemory('question',['a','b'],{url,model:'rerank-test',apiKeyEnv:'AGENTHUB_RERANK_TEST_KEY',minScore:.5,candidateLimit:20},AbortSignal.timeout(2000))).toEqual([{index:1,score:.9},{index:0,score:.1}]);expect(received).toEqual({body:{model:'rerank-test',query:'question',documents:['a','b'],top_n:2},authorization:'Bearer synthetic-rerank-key'})
})
it('rejects redirect, excessive input, oversized response and aborts slow providers',async()=>{
 let reached=false;const destination=await fixture((_q,r)=>{reached=true;r.end('{}')}),redirect=await fixture((_q,r)=>{r.writeHead(302,{location:destination});r.end()})
 const policy=(url:string)=>({url,model:'test',minScore:.5,candidateLimit:20})
 await expect(rerankMemory('q',['a'],policy(redirect),AbortSignal.timeout(2000))).rejects.toThrow();expect(reached).toBe(false)
 await expect(rerankMemory('q',['x'.repeat(256000)],policy(destination),AbortSignal.timeout(2000))).rejects.toThrow('rerank_request_too_large');expect(reached).toBe(false)
 const huge=await fixture((_q,r)=>{r.write('x'.repeat(600000));r.end('x'.repeat(600000))});await expect(rerankMemory('q',['a'],policy(huge),AbortSignal.timeout(2000))).rejects.toThrow('rerank_response_too_large')
 const slow=await fixture(()=>{});await expect(rerankMemory('q',['a'],policy(slow),AbortSignal.timeout(30))).rejects.toThrow()
})
