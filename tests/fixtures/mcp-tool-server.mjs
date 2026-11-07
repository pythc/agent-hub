import {appendFileSync} from 'node:fs'
import {Server} from '@modelcontextprotocol/sdk/server/index.js'
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js'
import {ListToolsRequestSchema,CallToolRequestSchema} from '@modelcontextprotocol/sdk/types.js'

const server=new Server({name:'connector-contract-fixture',version:'1'},{capabilities:{tools:{}}})
const schema={type:'object',properties:{text:{type:'string'}},required:['text'],additionalProperties:false}
server.setRequestHandler(ListToolsRequestSchema,async()=>({tools:['echo','write','crash','hang','fail','image','hidden','constrained'].map(name=>({name,inputSchema:name==='constrained'?{$schema:'https://json-schema.org/draft/2020-12/schema',type:'object',allOf:[{properties:{text:{type:'string'}}}],required:['text'],unevaluatedProperties:false}:schema}))}))
server.setRequestHandler(CallToolRequestSchema,async(request,extra)=>{
  appendFileSync(process.argv[2],JSON.stringify(request.params)+'\n')
  if(request.params.name==='crash')process.exit(0)
  if(request.params.name==='hang')await new Promise(resolve=>extra.signal.addEventListener('abort',resolve,{once:true}))
  if(request.params.name==='image')return {content:[{type:'image',mimeType:'image/png',data:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+yR5cAAAAASUVORK5CYII='}]}
  return {isError:request.params.name==='fail',content:[{type:'text',text:String(request.params.arguments.text)}],structuredContent:{text:request.params.arguments.text}}
})
await server.connect(new StdioServerTransport())
