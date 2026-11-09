import {createServer,type IncomingMessage,type ServerResponse} from 'node:http'
import type {Delegations} from './manager.ts'
import {DelegationError} from './contract.ts'

/** Separate loopback service. Operator bearer tokens and browser sessions are never accepted. */
export async function serveDelegation(manager:Delegations,port:number){
 const server=createServer((req,res)=>{void handle(req,res)})
 async function handle(req:IncomingMessage,res:ServerResponse){
  res.setHeader('cache-control','no-store')
  res.setHeader('x-content-type-options','nosniff')
  if(req.headers.origin||req.method!=='POST'||req.url!=='/delegation/v1'){
   res.writeHead(403,{'content-type':'application/json'});res.end('{"error":"service_request_required"}');return
  }
  let value:any
  try{
   const chunks:Buffer[]=[];let size=0
   for await(const chunk of req){size+=chunk.length;if(size>256000)throw new DelegationError('request_too_large',413);chunks.push(chunk)}
   value=JSON.parse(Buffer.concat(chunks).toString('utf8'))
   const result=await manager.receive(value)
   res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(manager.response(value.issuer,value.operation,result,value.nonce)))
  }catch(e){
   const status=e instanceof DelegationError?e.status:400,error=e instanceof DelegationError?e.code:'invalid_service_request'
   res.writeHead(status,{'content-type':'application/json'})
   // The caller also verifies the response signature; unsigned/malformed errors never become remote task facts.
   try{res.end(JSON.stringify(manager.response(value.issuer,value.operation,{error},value.nonce)))}catch{res.end('{"error":"invalid_service_request"}')}
  }
 }
 server.requestTimeout=10000;server.headersTimeout=10000;server.maxRequestsPerSocket=100
 await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(port||manager.preferredPort,'127.0.0.1',resolve)})
 manager.bindEndpoint('http://127.0.0.1:'+(server.address() as {port:number}).port)
 return {server,async close(){server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()))}}
}
