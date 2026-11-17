import {createServer} from 'node:http'
import {randomBytes} from 'node:crypto'
import type {ToolSpec,ToolContent} from '../backend-sdk.ts'

/** Per-turn loopback capability. Native CLIs never receive a host access token. */
export async function toolBridge(tools:ToolSpec[],invoke:(name:string,args:unknown,id:string)=>Promise<{contentItems:ToolContent[];success:boolean}>,fatal:(e:unknown)=>void){
 const token=randomBytes(32).toString('hex'),calls=new Map<string,{fingerprint:string;promise:Promise<unknown>}>()
 let active=true,port=0
 const server=createServer(async(req,res)=>{
  const reply=(status:number,body?:unknown)=>{if(res.destroyed)return;res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(body===undefined?undefined:JSON.stringify(body))}
  if(!active||req.url!=='/mcp'||req.headers.host!=='127.0.0.1:'+port||req.headers.authorization!=='Bearer '+token||req.headers.origin){reply(403);return}
  if(req.method!=='POST'){reply(405);return}
  let id:unknown
  try{
   const chunks:Buffer[]=[];let size=0
   for await(const chunk of req){size+=chunk.length;if(size>1_000_000)throw Error('frame');chunks.push(chunk)}
   const message=JSON.parse(Buffer.concat(chunks).toString('utf8'));id=message.id
   if(message.jsonrpc!=='2.0'||typeof message.method!=='string')throw Error('envelope')
   if(id===undefined){if(message.method!=='notifications/initialized'&&message.method!=='notifications/cancelled')throw Error('notification');reply(202);return}
   if(typeof id!=='string'&&typeof id!=='number')throw Error('id')
   let result:unknown
   if(message.method==='initialize')result={protocolVersion:'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'roppo-managed-tools',version:'1.0.0'}}
   else if(message.method==='ping')result={}
   else if(message.method==='tools/list')result={tools:tools.map(({type,...tool})=>tool)}
   else if(message.method==='tools/call'){
    const {name,arguments:args={}}=message.params??{}
    if(!tools.some(t=>t.name===name))throw Error('tool')
    const key=typeof id+':'+id,fingerprint=JSON.stringify([name,args]),previous=calls.get(key)
    if(previous&&previous.fingerprint!==fingerprint)throw Error('reused id')
    if(!previous){
     if(calls.size>=10000)throw Error('limit')
     // The JSON-RPC ID is stable for retries on this turn's private endpoint.
     const promise=invoke(name,args,key).then(value=>{
      if(value.contentItems.some(c=>c.type!=='inputText'))throw Error('unsupported image result')
      return {content:value.contentItems.map(c=>({type:'text',text:c.text??''})),isError:!value.success}
     });calls.set(key,{fingerprint,promise})
    }
    result=await calls.get(key)!.promise
   }else{reply(200,{jsonrpc:'2.0',id,error:{code:-32601,message:'Unsupported method'}});return}
   reply(200,{jsonrpc:'2.0',id,result})
  }catch(error){reply(200,{jsonrpc:'2.0',id:id??null,error:{code:-32603,message:'Host operation unavailable'}});fatal(error)}
 })
 await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>{port=(server.address() as any).port;resolve()})})
 return {url:'http://127.0.0.1:'+port+'/mcp',token,async close(){active=false;server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()))}}
}
