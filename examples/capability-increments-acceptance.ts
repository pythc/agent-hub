/** Recovered cloud-local acceptance host. Synthetic model/ACP peer; disabled IM. */
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs'
import {resolve,join} from 'node:path'
import {randomUUID} from 'node:crypto'
import {Runtime} from '../src/runtime.ts'
import {BackendPluginError} from '../src/backends/plugin-contract.ts'
import {configSchema} from '../src/config.ts'
import {serve} from '../src/server.ts'
import {buildBackendPackage} from '../src/backends/plugin-package.ts'
import type {Model} from '../src/model.ts'
const root=resolve(process.argv[2]??'.local/recovery/acceptance')
mkdirSync(join(root,'workspace'),{recursive:true,mode:0o700})
const model:Model={async run(request){const threadId=request.threadId??'fixture-session-'+randomUUID(),turnId=randomUUID();request.onThread?.(threadId);request.onTurn?.(turnId);if(request.input.includes('fixture-unknown-effect'))throw new BackendPluginError('outcome_unknown','fixture');request.onProgress?.('Deterministic local fixture; no provider call');return {threadId,turnId,text:JSON.stringify(request.role==='worker'?{state:'ready',summary:'Local fixture completed',reply:'The deterministic acceptance check completed.',question:null,askedBy:null,handbacks:[]}:{reply:'Local fixture ready.'})}}}
const manifest=JSON.parse(readFileSync(resolve('plugins/backend-acp/manifest.json'),'utf8'))
const pkg=await buildBackendPackage(resolve('plugins/backend-acp/index.ts'),manifest,join(root,'acp-package-'+randomUUID()))
const peer=resolve('plugins/backend-acp/fixtures/agent.mjs'),peerState=join(root,'acp-peer-state');mkdirSync(peerState,{recursive:true,mode:0o700})
const config=configSchema.parse({stateDir:join(root,'state'),port:Number(process.env.ROPPO_INCREMENT_PORT??0),work:{sandboxDriver:'bubblewrap',network:false},backendPlugins:[{directory:pkg.directory,digest:pkg.digest}],backends:{acp:{kind:'plugin',plugin:manifest.id,label:'ACP outbound · simulated protocol',config:{command:process.execPath,args:[peer,peerState,'permission'],requestTimeoutMs:2000,permissionTimeoutMs:200,cancelTimeoutMs:100},readPaths:[peer],writePaths:[peerState]}},execution:{router:{mode:'host'},management:{enabled:true,maxWorkers:10},workers:[{id:'research',label:'Research',backend:'codex'},{id:'review',label:'Review',backend:'codex'}]},sources:[{id:'local',kind:'local',label:'Local acceptance',cwd:join(root,'workspace'),allowedActors:['operator']},{id:'feishu-preview',kind:'feishu',label:'Feishu setup preview',enabled:false,cwd:join(root,'workspace'),allowedActors:['operator'],feishu:{chats:['oc_fixture_room'],appIdEnv:'FIXTURE_FEISHU_APP_ID',appSecretEnv:'FIXTURE_FEISHU_APP_SECRET',liveEvents:false}}]})
const runtime=new Runtime(config,{model}),host=await serve(runtime,{createRuntime:next=>new Runtime(next,{model})})
runtime.start()
const token=readFileSync(host.tokenPath,'utf8').trim(),headers={authorization:'Bearer '+token,origin:host.url,'content-type':'application/json'}
const username='increments-preview',password='Local-fixture-'+randomUUID()+'A!'
const response=await fetch(host.url+'/account/setup',{method:'POST',headers,body:JSON.stringify({username,displayName:'Acceptance',password,remember:true})})
if(!response.ok)throw Error('Use a fresh acceptance directory: '+response.status)
const cookie=response.headers.get('set-cookie')!.split(';')[0]!
writeFileSync(join(root,'browser.json'),JSON.stringify({base:host.url,url:host.url+'/configure#worker-templates',cookie,username,password,mode:'deterministic cloud-local fixture',realIm:false,realAcp:false}),{mode:0o600})
writeFileSync(join(root,'fixture-config.json'),JSON.stringify(config,null,2)+'\n',{mode:0o600})
console.log(JSON.stringify({url:host.url+'/configure#worker-templates',info:join(root,'browser.json'),mode:'deterministic fixture; no live provider/IM/ACP calls'}))
async function close(){host.server.closeAllConnections();await new Promise<void>(done=>host.server.close(()=>done()));await host.closeRuntime()}
process.once('SIGTERM',()=>void close());process.once('SIGINT',()=>void close())
