/** Actual protected cloud-local Runtime; only synthetic local reference material. */
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs'
import {join,resolve} from 'node:path'
import {randomUUID} from 'node:crypto'
import {Runtime} from '../src/runtime.ts'
import {configSchema,type Config} from '../src/config.ts'
import {serve} from '../src/server.ts'
import {SourceRegistry} from '../src/source-plugins.ts'
import {MessageSource} from '../src/sources.ts'
import {CredentialReferences} from '../src/credential-references.ts'
const root=resolve(process.argv[2]??'.local/credential-information-acceptance'),cwd=join(root,'workspace')
mkdirSync(cwd,{recursive:true,mode:0o700})
if(existsSync(join(root,'browser.json')))throw Error('Use a fresh private acceptance directory')
const found='O18_BROWSER_FOUND',missing='O18_BROWSER_MISSING',material='SYNTHETIC_LOCAL_ONLY_NO_PROVIDER_TOKEN'
process.env[found]=material;delete process.env[missing]
const calls={models:0,identity:0,members:0,sends:0,events:0,toolCatalog:0,toolCalls:0,localValidations:0,credentialGets:0}
class LocalSource extends MessageSource {
 async poll(){}
 async identity():Promise<never>{calls.identity++;throw Error('Forbidden fixture authentication')}
 async members():Promise<never>{calls.members++;throw Error('Forbidden fixture directory')}
 async deliver():Promise<never>{calls.sends++;throw Error('Forbidden fixture delivery')}
}
function registry(){
 const value=new SourceRegistry(),rooms={name:'rooms',label:'Room IDs',path:'/options/rooms',input:'tags' as const,secret:false,required:true,help:'Synthetic room identifier for this local fixture.'}
 value.register({apiVersion:1,kind:'local-information',label:'Local information fixture',create:config=>new LocalSource(config),scopes:config=>config.options.rooms as string[],connection:{credentials:{TOKEN:'/options/tokenEnv'},scopesPath:'/options/rooms',validate:config=>{calls.localValidations++;if(!Array.isArray(config.options.rooms)||!config.options.rooms.length)throw Error('Missing synthetic room')},setup:{description:'Synthetic local information only. No platform authentication.',fields:[rooms,{name:'token',label:'App secret',path:'/options/tokenEnv',secret:true,required:true}]}}})
 value.register({apiVersion:1,kind:'local-empty-information',label:'Local fixture without references',create:config=>new LocalSource(config),connection:{credentials:{},setup:{description:'Synthetic fixture with no explicit references.',fields:[rooms]}}})
 value.register({apiVersion:1,kind:'local-unknown-information',label:'Local fixture with implicit information',create:config=>new LocalSource(config)})
 return value
}
const config=configSchema.parse({stateDir:join(root,'state'),port:0,watchdog:{enabled:false},work:{sandboxDriver:'disabled',network:false,autoRecover:false},sources:[{id:'local',kind:'local',cwd,allowedActors:['operator']},{id:'app-present',kind:'local-information',label:'应用 A · App A',cwd,enabled:false,allowedActors:['operator'],options:{rooms:['room-a'],tokenEnv:found}},{id:'app-missing',kind:'local-information',label:'应用 B · App B',cwd,enabled:false,allowedActors:['operator'],options:{rooms:['room-b'],tokenEnv:missing}},{id:'app-unknown',kind:'local-unknown-information',label:'应用 C · App C',cwd,enabled:false,allowedActors:['operator']},{id:'app-empty',kind:'local-empty-information',label:'应用 D · App D',cwd,enabled:false,allowedActors:['operator'],options:{rooms:['room-d']}}],toolConnections:{'tool-present':{label:'工具 A · Tool A',enabled:false,transport:{kind:'stdio',command:'/fixture-never-start',env:{LOCAL_SLOT:found}},allowedTools:['local_read']},'tool-missing':{label:'工具 B · Tool B',enabled:false,transport:{kind:'http',url:'http://127.0.0.1:1/never-call',headerEnv:{Authorization:missing}},allowedTools:['local_read']},'tool-unknown':{label:'工具 C · Tool C',enabled:false,transport:{kind:'plugin',sourceId:'app-unknown'},allowedTools:['local_read']},'tool-empty':{label:'工具 D · Tool D',enabled:false,transport:{kind:'http',url:'http://127.0.0.1:1/never-call'},allowedTools:['local_read']}}})
function createRuntime(next:Config){
 const runtime=new Runtime(next,{sourceRegistry:registry(),model:{async run(){calls.models++;throw Error('No model calls permitted')}}})
 runtime.pause(true)
 const receive=runtime.receive.bind(runtime);runtime.receive=(...args)=>{calls.events++;return receive(...args)}
 runtime.toolConnections.catalog=async()=>{calls.toolCatalog++;throw Error('No tool discovery permitted')}
 runtime.toolConnections.call=async()=>{calls.toolCalls++;throw Error('No tool calls permitted')}
 return runtime
}
const host=await serve(createRuntime(config),{createRuntime})
host.server.on('request',request=>{if(new URL(request.url??'/',host.url).pathname==='/api/credential-references')calls.credentialGets++})
const token=readFileSync(host.tokenPath,'utf8').trim(),account=await fetch(host.url+'/account/setup',{method:'POST',headers:{authorization:'Bearer '+token,origin:host.url,'content-type':'application/json'},body:JSON.stringify({username:'information-preview',displayName:'Local information test',password:'Local-'+randomUUID()+'A!',remember:true})})
if(!account.ok)throw Error('Local fixture account setup failed')
const mode='Actual protected single Runtime and existing local source/tool configuration; synthetic local environment only; browser fault/context simulations reported separately'
function evidence(){
 const value=new CredentialReferences(()=>host.runtime).snapshot(),rows=(kind:string)=>Object.fromEntries(value.connections.filter(row=>row.kind===kind).map(({id,state})=>[id,state]))
 return {mode,realProviders:false,calls:{...calls},settingsRevision:value.settingsRevision,sourceStates:rows('source'),toolStates:rows('tool'),savedSources:host.runtime.config.sources.filter(source=>source.kind!=='local').map(source=>({id:source.id,label:source.label,enabled:source.enabled,allowedActorCount:source.allowedActors.length})),workerGrants:(host.runtime.config.execution.workers??[]).reduce((total,worker)=>total+(worker.toolConnections?.length??0),0)}
}
writeFileSync(join(root,'browser.json'),JSON.stringify({base:host.url,url:host.url+'/configure#connectors',cookie:account.headers.get('set-cookie')!.split(';')[0]!,fixtureKind:'local-information',mode}),{mode:0o600})
let previous='',busy=false,closing=false
const timer=setInterval(()=>{if(busy||closing)return;try{
 const path=join(root,'control.json');if(!existsSync(path))return
 const raw=readFileSync(path,'utf8');if(raw===previous||raw.length>1024)return;previous=raw
 const input=JSON.parse(raw);if(typeof input.id!=='string'||!/^[a-f0-9-]{36}$/.test(input.id)||!['stats','missing','restore'].includes(input.action))return
 busy=true
 if(input.action==='missing')delete process.env[found]
 if(input.action==='restore')process.env[found]=material
 const result={id:input.id,result:'ok',...evidence()};writeFileSync(join(root,'runtime-evidence.json'),JSON.stringify(result,null,2),{mode:0o600});writeFileSync(join(root,'control-result.json'),JSON.stringify(result),{mode:0o600})
 }catch{writeFileSync(join(root,'control-failed.json'),'{"result":"fixture_control_failed"}',{mode:0o600})}finally{busy=false}},40)
console.log(JSON.stringify({ready:true,mode}))
async function close(){if(closing)return;closing=true;clearInterval(timer);host.server.closeAllConnections();await new Promise<void>(done=>host.server.close(()=>done()));await host.closeRuntime();delete process.env[found];delete process.env[missing]}
process.once('SIGTERM',()=>void close());process.once('SIGINT',()=>void close())
