import {createServer,request as httpRequest,Agent as HttpAgent} from 'node:http'
import {request as httpsRequest,Agent as HttpsAgent} from 'node:https'
import {randomBytes} from 'node:crypto'
import {BackendAdapterError,type ModelRequest} from '../backend-sdk.ts'
import {checkBudget} from '../../src/context-budget.ts'
import type {CliDriver} from './contract.ts'
import {cliFailure} from './errors.ts'

/** Count the CLI's complete HTTP payload BEFORE forwarding inference. Native
 * transcripts alone omit hidden system prompts, summaries and provider fields.
 * This relay owns neither credentials nor inference; the actual CLI constructs
 * and authenticates every request. Nothing is logged or persisted here.
 */
export async function wireBridge(upstream:string,driver:CliDriver,r:ModelRequest,fatal:(e:unknown)=>void,beforeRequest:()=>void=()=>{}){
 const prefix='/'+randomBytes(32).toString('hex'),target=new URL(upstream)
 const httpAgent=new HttpAgent({proxyEnv:process.env}),httpsAgent=new HttpsAgent({proxyEnv:process.env})
 const pending=new Set<ReturnType<typeof httpRequest>>()
 let latest:unknown,additions:unknown[]=[]
 const check=(phase:string,extra:unknown)=>{if(latest===undefined)throw new BackendAdapterError('unsupported');additions.push(extra);checkBudget({request:latest,additions},r.contextBudget,'api-wire',phase,r.onBudget,true)}
 let port=0,active=true
 const server=createServer(async(req,res)=>{
  const deny=()=>{if(!res.headersSent)res.writeHead(502,{'content-type':'application/json'});res.end('{"error":{"message":"Host model request unavailable"}}')}
  if(!active||req.headers.host!=='127.0.0.1:'+port||!req.url?.startsWith(prefix+'/')||req.headers.origin){res.writeHead(403).end();return}
  try{
   if(req.headers['content-encoding'])throw new BackendAdapterError('unsupported')
   const chunks:Buffer[]=[];let size=0
   for await(const chunk of req){size+=chunk.length;if(size>16_000_000)throw new BackendAdapterError('unsupported');chunks.push(chunk)}
   const bytes=Buffer.concat(chunks),body=bytes.length?JSON.parse(bytes.toString('utf8')):{}
   const payload=body.request??body
   // Opaque provider-side histories cannot prove the complete host budget.
   if(payload.previous_response_id||payload.cachedContent||payload.conversation)throw new BackendAdapterError('unsupported')
   const nativeTools=payload.tools??[]
   if(!Array.isArray(nativeTools))throw new BackendAdapterError('unsupported')
   for(const tool of nativeTools){
    const names=Array.isArray(tool.functionDeclarations)?tool.functionDeclarations.map((f:any)=>f.name):[tool.name??tool.function?.name]
    if(!names.length||names.some((name:unknown)=>typeof name!=='string'||!(driver.id==='claude-code'&&name==='EndConversation')&&!r.tools?.some(t=>t.name===driver.toolName(name))))throw new BackendAdapterError('unsupported')
   }
   checkBudget(body,r.contextBudget,'api-wire','before-native-request',r.onBudget,true)
   beforeRequest()
   latest=body;additions=[]
   if(!active||r.signal?.aborted)throw new BackendAdapterError('cancelled')
   const suffix=req.url.slice(prefix.length),url=new URL(target.href.replace(/\/$/,'')+suffix)
   if(url.origin!==target.origin)throw new BackendAdapterError('configuration_invalid')
   const headers:Record<string,string|string[]|undefined>={...req.headers,'content-length':String(bytes.length),'accept-encoding':'identity'}
   for(const key of ['host','connection','transfer-encoding','proxy-authorization','proxy-connection'])delete headers[key]
   const out=(url.protocol==='https:'?httpsRequest:httpRequest)(url,{method:req.method,headers,agent:url.protocol==='https:'?httpsAgent:httpAgent},response=>{
    // Never leak a credential-bearing redirect or allow an inference request to
    // escape accounting via the CLI's redirect-following behavior.
    if((response.statusCode??500)>=300&&(response.statusCode??500)<400){response.resume();fatal(new BackendAdapterError('provider_rejected'));deny();return}
    if((response.statusCode??500)>=400){
     let errorBody='',finished=false
     const finish=()=>{if(finished)return;finished=true;clearTimeout(timer);fatal(new BackendAdapterError(cliFailure(String(response.statusCode)+' '+errorBody)));deny()}
     const timer=setTimeout(finish,5000);timer.unref()
     response.on('data',chunk=>{errorBody=(errorBody+chunk.toString()).slice(0,64000)})
     response.once('end',finish);response.once('error',finish);response.once('close',finish)
     return
    }
    res.writeHead(response.statusCode??502,response.headers);response.pipe(res)
   })
   pending.add(out);out.once('close',()=>pending.delete(out));out.once('error',()=>{fatal(new BackendAdapterError('process_failed'));deny()})
   res.once('close',()=>{if(!res.writableFinished)out.destroy()});out.end(bytes)
  }catch(error){fatal(error);deny()}
 })
 await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>{port=(server.address() as any).port;resolve()})})
 return {url:'http://127.0.0.1:'+port+prefix,check,async close(){active=false;for(const request of pending)request.destroy();httpAgent.destroy();httpsAgent.destroy();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()))}}
}
