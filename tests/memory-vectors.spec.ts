import {afterEach,it,expect} from 'vitest'
import {createServer,type Server,type RequestListener} from 'node:http'
import {embedMemory} from '../src/memory-vectors.ts'
const servers:Server[]=[]
afterEach(async()=>{delete process.env.AGENTHUB_MEMORY_TEST_KEY;for(const s of servers.splice(0)){s.closeAllConnections();await new Promise<void>(resolve=>s.close(()=>resolve()))}})
async function fixture(handler:RequestListener){const server=createServer(handler);servers.push(server);await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));return 'http://127.0.0.1:'+(server.address() as any).port+'/embeddings'}
it('uses the configured embedding protocol and environment credential without storing it in the policy',async()=>{
 let received:any;process.env.AGENTHUB_MEMORY_TEST_KEY='synthetic-memory-key'
 const url=await fixture(async(req,res)=>{let body='';for await(const part of req)body+=part;received={body:JSON.parse(body),authorization:req.headers.authorization};res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({data:[{index:0,embedding:[.25,.75]}]}))})
 const policy={url,model:'test-embedding',apiKeyEnv:'AGENTHUB_MEMORY_TEST_KEY'}
 expect(await embedMemory('authorized query',policy,AbortSignal.timeout(2000))).toEqual([.25,.75]);expect(received).toEqual({body:{model:'test-embedding',input:'authorized query'},authorization:'Bearer synthetic-memory-key'});expect(JSON.stringify(policy)).not.toContain('synthetic-memory-key')
})
it('does not follow redirects or forward embedding credentials to a second endpoint',async()=>{
 let reached=false;const destination=await fixture((_req,res)=>{reached=true;res.end('{}')}),url=await fixture((_req,res)=>{res.writeHead(302,{location:destination});res.end()})
 await expect(embedMemory('query',{url,model:'test'},AbortSignal.timeout(2000))).rejects.toThrow();expect(reached).toBe(false)
})
it('rejects an oversized streamed response without relying on content-length',async()=>{
 const url=await fixture((_req,res)=>{res.writeHead(200,{'content-type':'application/json'});res.write('x'.repeat(600000));res.end('x'.repeat(600000))})
 await expect(embedMemory('query',{url,model:'test'},AbortSignal.timeout(2000))).rejects.toThrow('embedding_response_too_large')
})
