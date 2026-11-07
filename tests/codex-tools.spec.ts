import {it,expect} from 'vitest'
import {Client} from '@modelcontextprotocol/sdk/client/index.js'
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import {codexToolBridge} from '../src/codex-tools.ts'

it('serves only activation tools through authenticated MCP and revokes them on close',async()=>{
 const calls:any[]=[],bridge=await codexToolBridge([{type:'function',name:'orchestrator_followup_stop',description:'Stop this inbox task',inputSchema:{type:'object',properties:{ticketId:{type:'string'}},required:['ticketId']}}],async(name,args)=>{calls.push({name,args});return {success:true,contentItems:[{type:'inputText',text:'stopped'}]}})
 const client=new Client({name:'fixture',version:'1'})
 try{
  expect((await fetch(bridge.config.url,{method:'POST',body:'{}'})).status).toBe(401)
  expect((await fetch(bridge.config.url,{method:'POST',headers:{...bridge.config.http_headers,origin:'https://unrelated.invalid'},body:'{}'})).status).toBe(403)
  await client.connect(new StreamableHTTPClientTransport(new URL(bridge.config.url),{requestInit:{headers:bridge.config.http_headers}}))
  expect((await client.listTools()).tools.map(t=>t.name)).toEqual(['orchestrator_followup_stop'])
  expect(await client.callTool({name:'orchestrator_followup_stop',arguments:{ticketId:'owned'}})).toMatchObject({isError:false,content:[{type:'text',text:'stopped'}]})
  await expect(client.callTool({name:'worker_manage',arguments:{action:'assign'}})).rejects.toThrow('unavailable')
  expect(calls).toEqual([{name:'orchestrator_followup_stop',args:{ticketId:'owned'}}])
 }finally{await client.close();await bridge.close()}
 await expect(fetch(bridge.config.url,{headers:bridge.config.http_headers})).rejects.toThrow()
})

it('preserves images and tool failure results and refuses an aborted activation',async()=>{
 const controller=new AbortController(),bridge=await codexToolBridge([{type:'function',name:'read',description:'Read',inputSchema:{type:'object'}}],async()=>({success:false,contentItems:[{type:'inputText',text:'missing evidence'},{type:'inputImage',imageUrl:'data:image/png;base64,aW1hZ2U='}]}),controller.signal)
 const client=new Client({name:'fixture',version:'1'})
 try{
  await client.connect(new StreamableHTTPClientTransport(new URL(bridge.config.url),{requestInit:{headers:bridge.config.http_headers}}))
  expect(await client.callTool({name:'read',arguments:{}})).toMatchObject({isError:true,content:[{type:'text',text:'missing evidence'},{type:'image',mimeType:'image/png',data:'aW1hZ2U='}]})
  controller.abort()
  expect((await fetch(bridge.config.url,{method:'POST',headers:bridge.config.http_headers,body:'{}'})).status).toBe(401)
 }finally{await client.close();await bridge.close()}
})
