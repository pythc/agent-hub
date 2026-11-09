import {createServer,type IncomingMessage,type ServerResponse} from 'node:http'
import {z} from 'zod'
import type {Runtime} from './runtime.ts'
import {WebhookError} from './webhook-protocol.ts'

/** Only signed event ingress is served here. Never mount the operator API on it. */
export async function serveWebhooks(runtime:()=>Runtime,port:number,available:()=>boolean=()=>true){
 const send=(res:ServerResponse,status:number,value:unknown)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store',...(status===429||status===503?{'retry-after':'5'}:{})});res.end(JSON.stringify(value))}
 const handle=async(req:IncomingMessage,res:ServerResponse)=>{
  const match=/^\/webhooks\/(hook_[a-f0-9]{32})$/.exec(req.url??'')
  if(req.method!=='POST'||!match){send(res,404,{code:'not_found'});return}
  if(!available()||runtime().shuttingDown||!runtime().config.webhooks)throw new WebhookError(503,'host_unavailable')
  if(!['application/json','application/cloudevents+json'].includes((req.headers['content-type']??'').split(';')[0]!.trim())||req.headers['content-encoding']&&req.headers['content-encoding']!=='identity')throw new WebhookError(415,'unsupported_encoding')
  const headers:Record<string,string|undefined>={}
  for(const name of runtime().webhooks.requiredHeaders(match[1]!)){
   if(req.rawHeaders.filter((h,i)=>i%2===0&&h.toLowerCase()===name).length!==1)throw new WebhookError(401,'invalid_signature_headers')
   const value=req.headers[name];if(typeof value!=='string')throw new WebhookError(401,'invalid_signature_headers');headers[name]=value
  }
  if(Number(req.headers['content-length']??0)>64000)throw new WebhookError(413,'event_too_large')
  const chunks:Buffer[]=[];let bytes=0
  for await(const chunk of req){bytes+=chunk.length;if(bytes>64000)throw new WebhookError(413,'event_too_large');chunks.push(Buffer.from(chunk))}
  send(res,202,await runtime().webhooks.ingest(match[1]!,headers,Buffer.concat(chunks)))
 }
 const server=createServer({requestTimeout:10000,headersTimeout:10000,maxHeaderSize:8192},(req,res)=>{void handle(req,res).catch(error=>{
  if(res.headersSent){res.end();return}
  const status=error instanceof WebhookError?error.status:error instanceof z.ZodError?400:503
  send(res,status,{code:error instanceof WebhookError?error.code:error instanceof z.ZodError?'invalid_event':'storage_unavailable'})
 })})
 server.maxConnections=100
 await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve)})
 const address=server.address();if(!address||typeof address==='string')throw Error('Webhook listener unavailable')
 return {server,url:'http://127.0.0.1:'+address.port,close:async()=>{server.closeIdleConnections();await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()))}}
}
