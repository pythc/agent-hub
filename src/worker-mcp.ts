import {readFileSync} from 'node:fs'
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js'
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js'
import {workerDefinitions} from './worker-tools.ts'
export async function startWorkerMcp(url:string,grantFile:string){
 const token=readFileSync(grantFile,'utf8').trim(),server=new McpServer({name:'superagent-worker',version:'0.6.0'})
 for(const d of workerDefinitions)server.registerTool(d.name,{description:d.description,inputSchema:d.validator.shape as any,annotations:{readOnlyHint:d.name==='superagent_read',openWorldHint:false}},async(args:any)=>{
  try{
   const response=await fetch(url+'/worker',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({name:d.name,args}),signal:AbortSignal.timeout(90000)})
   const data=await response.json() as any
   if(!response.ok)return {isError:true,content:[{type:'text' as const,text:data.error??'Worker request rejected'}]}
   return {isError:!data.success,content:data.contentItems.map((c:any)=>c.type==='inputImage'?{type:'image',mimeType:c.imageUrl.slice(5,c.imageUrl.indexOf(';')),data:c.imageUrl.slice(c.imageUrl.indexOf(',')+1)}:{type:'text',text:c.text??''})}
  }catch{return {isError:true,content:[{type:'text' as const,text:'Worker host is unavailable'}]}}
 })
 await server.connect(new StdioServerTransport())
}
