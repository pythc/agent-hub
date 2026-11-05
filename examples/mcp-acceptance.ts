import {Client} from '@modelcontextprotocol/sdk/client/index.js'
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js'
import {mkdirSync,writeFileSync} from 'node:fs'
import {resolve} from 'node:path'
mkdirSync(resolve('validation'),{recursive:true})
mkdirSync(resolve('.local'),{recursive:true})
const client=new Client({name:'protocol-acceptance',version:'0.5.0'}),transport=new StdioClientTransport({command:process.execPath,args:['--import',resolve('node_modules/tsx/dist/loader.mjs'),resolve('src/cli.ts'),'mcp','http://127.0.0.1:4325',resolve('.local/panel-v4/state/access-token')],stderr:'pipe'})
try{
 await client.connect(transport);const listed=await client.listTools()
 if(listed.tools.length!==21)throw Error('Expected 21 operator tools')
 const catalog:any=await client.callTool({name:'agent_read',arguments:{resource:'catalog'}})
 if(catalog.isError||!JSON.stringify(catalog).includes('prompt-preview/<id>'))throw Error('Catalog missing')
 const status:any=await client.callTool({name:'agent_status',arguments:{}}),state=JSON.parse(status.content[0].text),ticket=state.tickets[0]
 const file:any=await client.callTool({name:'agent_read',arguments:{resource:'files/sample.txt',ticketId:ticket.id}})
 if(!JSON.stringify(file).includes('panel-resource-evidence'))throw Error('Scoped file missing')
 const preview:any=await client.callTool({name:'agent_prompt_preview',arguments:{role:'worker'}})
 if(preview.isError||!JSON.stringify(preview).includes('prompt-preview/'))throw Error('Prompt preview failed')
 const unauthorized:any=await client.callTool({name:'agent_merge_authorize',arguments:{id:ticket.id,source:'local',number:7,head:'a'.repeat(40)}})
 if(!unauthorized.isError)throw Error('Wrong-source merge allowed')
 const evidence={at:new Date().toISOString(),passed:true,tools:listed.tools.map(t=>({name:t.name,annotations:t.annotations})),catalog:true,scopedRead:true,promptPreview:true,wrongMergeSourceRejected:true}
 writeFileSync('validation/mcp-v4-protocol.json',JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify(evidence))
}finally{await client.close()}
