import {createServer} from 'node:http'
import {randomBytes,randomUUID,timingSafeEqual} from 'node:crypto'
import {Server} from '@modelcontextprotocol/sdk/server/index.js'
import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import {CallToolRequestSchema,ListToolsRequestSchema} from '@modelcontextprotocol/sdk/types.js'
import type {ModelRequest,ToolSpec} from './model.ts'

/** Native dynamic tools are fixed when a thread starts. A resumed Router gets
 * this activation's tools over MCP, retaining its original thread and history. */
export async function codexToolBridge(tools:ToolSpec[],invoke:NonNullable<ModelRequest['onTool']>,signal?:AbortSignal){
 const name='roppo-router',secret=Buffer.from('Bearer '+randomBytes(32).toString('hex'))
 const available=new Map(tools.map(tool=>[tool.name,tool])),servers=new Set<Server>()
 let closed=false,origin=''
 const http=createServer((req,res)=>{void (async()=>{
  const auth=Buffer.from(req.headers.authorization??'')
  if(closed||signal?.aborted||auth.length!==secret.length||!timingSafeEqual(auth,secret)){res.writeHead(401).end();return}
  if(req.url!=='/mcp'||req.headers.host!==new URL(origin).host||req.headers.origin&&req.headers.origin!==origin){res.writeHead(403).end();return}
  if(req.method!=='POST'){res.writeHead(405).end();return}
  const chunks:Buffer[]=[];let bytes=0
  for await(const part of req){bytes+=part.length;if(bytes>256000){res.writeHead(413).end();return}chunks.push(part)}
  let body:unknown
  try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'))}catch{res.writeHead(400).end();return}
  const server=new Server({name,version:'0.10.0'},{capabilities:{tools:{}}})
  const transport=new StreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true})
  servers.add(server)
  res.once('close',()=>{servers.delete(server);void server.close().catch(()=>{})})
  server.setRequestHandler(ListToolsRequestSchema,async()=>({tools:[...available.values()].map(({type,...tool})=>tool)}))
  server.setRequestHandler(CallToolRequestSchema,async request=>{
   if(closed||signal?.aborted||!available.has(request.params.name))throw Error('Tool is unavailable in this Router activation')
   const result=await invoke(request.params.name,request.params.arguments??{},randomUUID())
   return {isError:!result.success,content:result.contentItems.map(item=>{
    if(item.type==='inputImage'){
     const match=/^data:([^;,]+);base64,([\s\S]+)$/.exec(item.imageUrl??'')
     if(!match)throw Error('Unsupported tool image')
     return {type:'image' as const,mimeType:match[1]!,data:match[2]!}
    }
    return {type:'text' as const,text:item.text??''}
   })}
  })
  await server.connect(transport)
  await transport.handleRequest(req,res,body)
 })().catch(()=>{if(!res.headersSent)res.writeHead(500);res.end()})})
 http.requestTimeout=30000
 await new Promise<void>((resolve,reject)=>{http.once('error',reject);http.listen(0,'127.0.0.1',resolve)})
 origin='http://127.0.0.1:'+(http.address() as {port:number}).port
 return {name,config:{url:origin+'/mcp',http_headers:{Authorization:secret.toString()},enabled:true,required:true,default_tools_approval_mode:'approve'},async close(){
  if(closed)return;closed=true
  await Promise.allSettled([...servers].map(server=>server.close()))
  http.closeAllConnections()
  await new Promise<void>(resolve=>http.close(()=>resolve()))
 }}
}
