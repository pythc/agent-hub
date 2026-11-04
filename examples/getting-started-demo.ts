import {mkdirSync} from 'node:fs'
import {join,resolve} from 'node:path'
import {configSchema} from '../src/config.ts'
import {Runtime} from '../src/runtime.ts'
import {serve} from '../src/server.ts'

// A real local assistant using the existing Codex login. No office integrations.
const root=resolve(process.argv[2]??'.local/getting-started-demo'),stateDir=join(root,'state'),cwd=join(stateDir,'workspace')
mkdirSync(cwd,{recursive:true,mode:0o700})
const config=configSchema.parse({stateDir,port:4335,model:'gpt-6.1-terra',effort:'high',work:{sandboxDriver:process.platform==='darwin'?'seatbelt':process.platform==='linux'?'bubblewrap':'disabled',network:false},sources:[{id:'local',kind:'local',cwd,allowedActors:['operator'],sandbox:'read-only',workspace:{mode:'source'}}]})
const runtime=new Runtime(config),host=await serve(runtime)
console.log(JSON.stringify({url:host.url+'/configure',connectionFile:host.connectionFile,workspace:cwd,realModelCalls:true,officeIntegrations:false}))
let stopping=false
for(const signal of ['SIGINT','SIGTERM']as const)process.once(signal,()=>{if(stopping)return;stopping=true;host.server.close();void host.closeRuntime()})
