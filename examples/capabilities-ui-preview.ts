import {mkdtempSync,writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {Runtime} from '../src/runtime.ts'
import {configSchema} from '../src/config.ts'
import {serve} from '../src/server.ts'
const root=process.env.AGENTHUB_PREVIEW_ROOT??mkdtempSync(join(tmpdir(),'agent-capabilities-ui-'))
const host=new Runtime(configSchema.parse({stateDir:join(root,'state'),port:Number(process.env.AGENTHUB_PREVIEW_PORT??0),sources:[{id:'local',kind:'local',cwd:root,allowedActors:['operator'],workspace:{mode:'source'}}]}),{model:{async run(){throw Error('UI preview must not call models')}}})
host.pause(true)
const server=await serve(host,{configurationPreview:true}),file=process.env.AGENTHUB_PREVIEW_INFO??join(root,'preview.json')
writeFileSync(file,JSON.stringify({url:server.operatorUrl,root}),{mode:0o600})
console.log(JSON.stringify({preview:server.url,info:file}))
process.once('SIGTERM',()=>{server.server.close();void server.closeRuntime()})
