/** Synthetic external process acceptance through the real immutable plugin/sandbox path. */
import {mkdirSync,readFileSync,writeFileSync,existsSync} from 'node:fs'
import {resolve,join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {configSchema} from '../src/config.ts'
import {Store} from '../src/store.ts'
import {BackendRegistry} from '../src/backends/registry.ts'
import {buildBackendPackage,activateBackendPackages} from '../src/backends/plugin-package.ts'
const root=resolve(process.argv[2]??'.local/acp-outbound-acceptance')
if(existsSync(root))throw Error('Use a new acceptance directory')
mkdirSync(join(root,'workspace'),{recursive:true,mode:0o700});mkdirSync(join(root,'peer'),{mode:0o700})
const entry=fileURLToPath(new URL('../plugins/backend-acp/index.ts',import.meta.url)),peer=fileURLToPath(new URL('../plugins/backend-acp/fixtures/agent.mjs',import.meta.url))
const manifest=JSON.parse(readFileSync(new URL('../plugins/backend-acp/manifest.json',import.meta.url),'utf8'))
const pkg=await buildBackendPackage(entry,manifest,join(root,'package'))
const config=configSchema.parse({stateDir:join(root,'host'),turnTimeoutMs:10000,work:{sandboxDriver:process.platform==='darwin'?'seatbelt':'bubblewrap'},backendPlugins:[{directory:pkg.directory,digest:pkg.digest}],backends:{acp:{kind:'plugin',plugin:'acp-outbound',config:{command:process.execPath,args:[peer,join(root,'peer'),'permission']},readPaths:[peer],writePaths:[join(root,'peer')]}},execution:{backend:'acp'},sources:[{id:'local',kind:'local',cwd:join(root,'workspace'),allowedActors:['operator']}]})
writeFileSync(join(root,'config.json'),JSON.stringify(config,null,2),{mode:0o600})
let store=new Store(join(config.stateDir,'state.sqlite'))
const output:unknown[]=[],evidence:Record<string,unknown>={kind:'deterministic ACP fixture; not real external Agent acceptance',protocolVersion:1,packageDigest:pkg.digest,sandbox:config.work.sandboxDriver,managedWorkerEligible:false}
try{
 activateBackendPackages(store,config)
 let registry=new BackendRegistry(config,store)
 evidence.probe=await registry.probe('acp')
 const request={cwd:join(root,'workspace'),instructions:'Return the synthetic fixture result.',input:'First synthetic turn',schema:{},backendId:'acp',managed:false,onOutput:(event:unknown)=>output.push(event)}
 const first=await registry.run(request)
 evidence.first={threadId:first.threadId,text:first.text}
 store.close();store=new Store(join(config.stateDir,'state.sqlite'));registry=new BackendRegistry(config,store)
 const second=await registry.run({...request,input:'Second synthetic turn',threadId:first.threadId})
 evidence.resumed={sameHostThread:second.threadId===first.threadId,text:second.text}
 evidence.permission=JSON.parse(readFileSync(join(root,'peer','permission-outcome.json'),'utf8'))
 try{await registry.run({...request,managed:true});throw Error('Managed admission unexpectedly allowed')}catch(error:any){if(error.code!=='unsupported')throw error;evidence.managedAdmission='rejected: unsupported'}
 if(JSON.stringify(output).includes('Synthetic internal thought'))throw Error('Internal thought escaped public output')
 evidence.reasoningHidden=true;evidence.ok=true
}finally{store.close();writeFileSync(join(root,'evidence.json'),JSON.stringify(evidence,null,2),{mode:0o600})}
console.log(JSON.stringify({ok:true,root,report:join(root,'evidence.json'),package:pkg.directory,digest:pkg.digest}))
