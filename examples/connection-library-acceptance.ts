/** Isolated UI acceptance: local HTTP model, synthetic account and CLI. No external model calls. */
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs'
import {join,resolve} from 'node:path'
import {createServer} from 'node:http'
import {Runtime} from '../src/runtime.ts'
import {configSchema,type Config} from '../src/config.ts'
import {serve} from '../src/server.ts'

const root=resolve(process.argv[2]??'.local/connection-library-browser')
mkdirSync(join(root,'workspace'),{recursive:true})
const cli=join(root,'fixture-codex')
writeFileSync(cli,'#!'+process.execPath+'\nconsole.log("fixture tool ready")\n',{mode:0o700})
const provider=createServer(async(req,res)=>{
 const chunks:Buffer[]=[];for await(const c of req)chunks.push(Buffer.from(c))
 if(req.headers.authorization!=='Bearer demo-connection-key'){res.writeHead(401,{'content-type':'application/json'});res.end(JSON.stringify({error:{code:'invalid_api_key'}}));return}
 res.writeHead(200,{'content-type':'application/json'})
 if(req.url==='/v1/models'){res.end(JSON.stringify({data:[{id:'fixture-model'},{id:'fixture-reasoner'}]}));return}
 const body=JSON.parse(Buffer.concat(chunks).toString()),text=JSON.stringify({ok:true})
 res.end(JSON.stringify(req.url==='/v1/responses'?{status:'completed',output:[{type:'message',content:[{type:'output_text',text}]}]}:{choices:[{message:{content:text}}]}))
})
await new Promise<void>(r=>provider.listen(0,'127.0.0.1',r))
const baseUrl='http://127.0.0.1:'+(provider.address() as any).port+'/v1'
process.env.ROPPO_LIBRARY_FIXTURE_KEY='demo-connection-key'
const config=configSchema.parse({stateDir:join(root,'state'),port:0,codex:cli,work:{sandboxDriver:'disabled',network:false},
 backends:{deepseek:{kind:'openai-chat',label:'DeepSeek',baseUrl:'https://api.deepseek.com',model:'deepseek-chat'},localapi:{kind:'openai-chat',label:'Local test API',baseUrl,model:'fixture-model',apiKeyEnv:'ROPPO_LIBRARY_FIXTURE_KEY'}},
 execution:{workers:[{id:'worker-1',label:'Research',backend:'codex'}],router:{backend:'codex'}},
 sources:[{id:'local',kind:'local',cwd:join(root,'workspace'),allowedActors:['operator']}]})
const createRuntime=(cfg:Config)=>{
 const runtime=new Runtime(cfg)
 runtime.subscriptions.list=()=>[{id:'demo-account',email:'alex@example.test',subject:'synthetic',signedIn:true,expiresAt:undefined,usage:'unknown'}]
 runtime.subscriptions.models=async()=>({data:[{id:'fixture-subscription-model'}]})
 // Explicitly refuse external subscription inference in this fixture.
 runtime.subscriptions.credential=async()=>{throw Error('Subscription sign-in required: fixture does not call an external provider')}
 return runtime
}
const runtime=createRuntime(config),host=await serve(runtime,{createRuntime})
const token=readFileSync(host.tokenPath,'utf8').trim(),username='library-preview',password='Roppo-library-preview-2026!'
const status=await fetch(host.url+'/account/status').then(r=>r.json()) as {configured:boolean}
const response=await fetch(host.url+(status.configured?'/account/login':'/account/setup'),{method:'POST',headers:{authorization:'Bearer '+token,origin:host.url,'content-type':'application/json'},body:JSON.stringify({username,password,remember:true,...(!status.configured?{displayName:'Alex'}:{})})})
if(!response.ok)throw Error('Fixture account setup failed')
writeFileSync(join(root,'browser.json'),JSON.stringify({base:host.url,url:host.url+'/configure#models',cookie:response.headers.get('set-cookie')!.split(';')[0],provider:baseUrl,cli}),{mode:0o600})
console.log(JSON.stringify({url:host.url+'/configure#models',info:join(root,'browser.json')}))
async function close(){host.server.closeAllConnections();provider.closeAllConnections();await new Promise<void>(r=>host.server.close(()=>r()));await host.closeRuntime();await new Promise<void>(r=>provider.close(()=>r()))}
process.once('SIGTERM',()=>void close());process.once('SIGINT',()=>void close())
