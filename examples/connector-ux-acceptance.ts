/** Cloud-local IM UI fixture: a unique simulated plugin, real host service, no IM platform calls. */
import {createServer} from 'node:http'
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs'
import {join,resolve} from 'node:path'
import {randomUUID} from 'node:crypto'
import {Runtime} from '../src/runtime.ts'
import {configSchema,type Config} from '../src/config.ts'
import {serve} from '../src/server.ts'
import {SourceRegistry} from '../src/source-plugins.ts'
import {MessageSource} from '../src/sources.ts'
const root=resolve(process.argv[2]??'.local/connector-ux-acceptance'),cwd=join(root,'workspace');mkdirSync(cwd,{recursive:true,mode:0o700})
if(existsSync(join(root,'browser.json')))throw Error('Use a fresh private fixture directory')
const calls={heads:0,identities:0,heldIdentities:0,directories:0,sends:0,events:0,models:0}
let auth:'normal'|'failed'|'limited'|'held'='normal',release:()=>void=()=>{}
const service=createServer((request,response)=>{if(request.method==='HEAD'){calls.heads++;response.writeHead(204).end()}else response.writeHead(405).end()})
await new Promise<void>(done=>service.listen(0,'127.0.0.1',done))
const address=service.address();if(!address||typeof address==='string')throw Error('Local fixture service unavailable')
const serviceUrl='http://127.0.0.1:'+address.port+'/'
class LocalTestSource extends MessageSource{
 async poll(){/* No incoming events are created by this test source. */}
 async identity(){calls.identities++;if(auth==='held'){calls.heldIdentities++;await new Promise<void>(done=>{release=done})};if(auth==='failed'||auth==='limited')throw Error('DO_NOT_RENDER secret-token raw-stderr '+(auth==='limited'?'429':'authentication'));return {id:'local-test-bot',type:'fixture',verified:true}}
 async members(){calls.directories++;return [{id:'fixture-member',bot:false}]}
 async deliver(){calls.sends++;throw Error('This local fixture never sends messages')}
 async close(){release()}
}
function registry(){
 const sources=new SourceRegistry()
 sources.register({apiVersion:1,kind:'local-im-test',label:'Local IM test / 本地 IM 测试',create:config=>new LocalTestSource(config),scopes:config=>config.options.rooms as string[],connection:{scopesPath:'/options/rooms',credentials:{TOKEN:'/options/tokenEnv'},validate:config=>{if(!Array.isArray(config.options.rooms)||!config.options.rooms.length)throw Error('Room IDs required')},setup:{description:'Local test app. This fixture does not connect to an IM platform.',serviceUrl,fields:[{name:'rooms',label:'Room IDs',path:'/options/rooms',input:'tags',required:true,secret:false,help:'Use the room IDs supplied by this local test.'},{name:'token',label:'App secret',path:'/options/tokenEnv',required:true,secret:true,help:'Stored on the host; not returned in connection records.'}]}}})
 return sources
}
process.env.IM_UX_TEST_TOKEN='fixture-only-not-a-real-credential'
const config=configSchema.parse({stateDir:join(root,'state'),port:0,work:{sandboxDriver:'disabled',network:false,autoRecover:false},sources:[{id:'local',kind:'local',cwd,allowedActors:['operator']},{id:'local-im-fixture',kind:'local-im-test',label:'Local IM test / 本地 IM 测试',enabled:false,cwd,allowedActors:['fixture-member'],options:{rooms:['fixture-room'],tokenEnv:'IM_UX_TEST_TOKEN'}}]})
const createRuntime=(next:Config)=>new Runtime(next,{sourceRegistry:registry(),model:{async run(){calls.models++;throw Error('No provider calls permitted in this fixture')}}})
const runtime=createRuntime(config);runtime.pause(true)
const host=await serve(runtime,{createRuntime}),token=readFileSync(host.tokenPath,'utf8').trim()
const account=await fetch(host.url+'/account/setup',{method:'POST',headers:{authorization:'Bearer '+token,origin:host.url,'content-type':'application/json'},body:JSON.stringify({username:'im-ui-preview',displayName:'Local IM UI test',password:'Local-'+randomUUID()+'A!',remember:true})})
if(!account.ok)throw Error('Isolated fixture account setup failed')
writeFileSync(join(root,'browser.json'),JSON.stringify({base:host.url,url:host.url+'/configure#connectors',cookie:account.headers.get('set-cookie')!.split(';')[0]!,fixtureKind:'local-im-test',fixtureSourceId:'local-im-fixture',mode:'actual local host, unique local test plugin and loopback HEAD service; identity/member methods are simulations, no real IM or provider'}),{mode:0o600})
function evidence(){const active=host.runtime;return {mode:'local test methods only; no real platform verification',calls:{...calls},revision:active.settings.current().revision,sources:active.config.sources.filter(source=>source.kind!=='local').map(source=>({kind:source.kind,label:source.label,enabled:source.enabled,actors:[...source.allowedActors]})),workerToolConnections:Object.keys(active.config.toolConnections).length}}
let previous='',busy=false,closing=false
const controls=setInterval(()=>{if(busy||closing)return;void(async()=>{try{
 const path=join(root,'control.json');if(!existsSync(path))return
 const raw=readFileSync(path,'utf8');if(raw===previous||raw.length>1024)return;previous=raw
 const command=JSON.parse(raw);if(typeof command.id!=='string'||!/^[a-f0-9-]{36}$/.test(command.id)||!['normal','failed','limited','held','bump_and_release','stats'].includes(command.action))return
 busy=true
 if(['normal','failed','limited','held'].includes(command.action))auth=command.action
 if(command.action==='bump_and_release'){const active=host.runtime;active.updateSettings(active.settings.current().revision,{sources:active.config.sources});auth='normal';release()}
 const snapshot=evidence();writeFileSync(join(root,'fixture-evidence.json'),JSON.stringify(snapshot,null,2),{mode:0o600});writeFileSync(join(root,'control-result.json'),JSON.stringify({id:command.id,result:'ok',...snapshot}),{mode:0o600})
 }catch{writeFileSync(join(root,'control-failed.json'),'{"result":"fixture_control_failed"}',{mode:0o600})}finally{busy=false}})()},50)
console.log(JSON.stringify({url:host.url+'/configure#connectors',mode:'local test only; no real IM'}))
async function close(){if(closing)return;closing=true;clearInterval(controls);release();host.server.closeAllConnections();await new Promise<void>(done=>host.server.close(()=>done()));await host.closeRuntime();await new Promise<void>(done=>service.close(()=>done()));delete process.env.IM_UX_TEST_TOKEN}
process.once('SIGTERM',()=>void close());process.once('SIGINT',()=>void close())
