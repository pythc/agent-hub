import {resolve,dirname} from 'node:path'
import {mkdirSync,writeFileSync} from 'node:fs'
import {Client} from '@modelcontextprotocol/sdk/client/index.js'
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js'
import {clientIds,clientConfig} from '../src/clients.ts'
const [url,tokenFile,output='.local/client-profiles.json']=process.argv.slice(2)
if(!url||!tokenFile)throw Error('Usage: client-profile-acceptance.ts <loopback host URL> <token file> [report file]')
const profiles=[]
for(const clientId of clientIds){
 const generated=clientConfig({client:clientId,url,tokenFile}),definition=generated.definition as any
 const command=clientId==='opencode'?definition.command[0]:definition.command,args=clientId==='opencode'?definition.command.slice(1):definition.args
 const client=new Client({name:'client-profile-fixture',version:'0.5.0'}),transport=new StdioClientTransport({command,args,stderr:'pipe'})
 try{
  await client.connect(transport);const tools=await client.listTools()
  if(tools.tools.length!==20)throw Error(clientId+' profile tool mismatch')
  for(const [name,args] of [['agent_status',{}],['agent_read',{resource:'catalog'}]] as const){if((await client.callTool({name,arguments:args})).isError)throw Error(clientId+' '+name+' failed')}
  profiles.push({client:clientId,tools:20,protocolPassed:true,productUiTested:false})
 }finally{await client.close()}
}
mkdirSync(dirname(resolve(output)),{recursive:true});writeFileSync(output,JSON.stringify({at:new Date().toISOString(),profiles},null,2)+'\n')
console.log(JSON.stringify(profiles))
