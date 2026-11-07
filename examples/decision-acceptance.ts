/** Isolated decision API/UI acceptance host. Optional local API URL; no production state. */
import {mkdtempSync,readFileSync,writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createServer} from 'node:http'
import {Runtime} from '../src/runtime.ts'
import {configSchema} from '../src/config.ts'
import {serve} from '../src/server.ts'
const root=mkdtempSync(join(tmpdir(),'roppo-decision-acceptance-'))
const fixture=createServer(async(req,res)=>{const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(chunk);const request=JSON.parse(Buffer.concat(chunks).toString());const input=JSON.parse(request.messages.at(-1).content);res.setHeader('content-type','application/json');res.end(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify({decisions:input.messages.map((m:any)=>({id:m.id,action:'REVIEW'}))})}}],usage:{prompt_tokens:42,completion_tokens:12}}))})
await new Promise<void>(r=>fixture.listen(0,'127.0.0.1',r))
const api=process.argv[2]??'http://127.0.0.1:'+(fixture.address() as any).port+'/v1'
if(!['127.0.0.1','localhost','[::1]'].includes(new URL(api).hostname))throw Error('Acceptance requires a local model endpoint')
const config=configSchema.parse({stateDir:join(root,'state'),port:0,sources:[{id:'local',kind:'local',allowedActors:['operator'],cwd:root}],execution:{router:{mode:'host'}},backends:{cpu:{kind:'openai-chat',baseUrl:api,model:'cpu-judge',outputFormat:'json-schema',chatTokenField:'max_tokens',parameters:{temperature:0,chat_template_kwargs:{enable_thinking:false}}}}})
const runtime=new Runtime(config,{model:{async run(){throw Error('Acceptance host must not execute Router or Worker models')}}}),host=await serve(runtime)
const username='decision-test',password='Isolated-test-passphrase!'
const auth={authorization:'Bearer '+readFileSync(host.tokenPath,'utf8').trim(),'content-type':'application/json'}
const setup=await fetch(host.url+'/account/setup',{method:'POST',headers:auth,body:JSON.stringify({username,password,displayName:'Local test',remember:true})})
if(setup.status!==201)throw Error('Fixture account setup failed')
const info={base:host.url,root,username,password,provider:api,realModel:!!process.argv[2]}
writeFileSync(join(root,'browser.json'),JSON.stringify(info),{mode:0o600});console.log(JSON.stringify(info))
async function close(){fixture.closeAllConnections();await new Promise<void>(r=>fixture.close(()=>r()));host.server.closeAllConnections();await new Promise<void>(r=>host.server.close(()=>r()));await host.closeRuntime()}
process.once('SIGTERM',()=>void close());process.once('SIGINT',()=>void close())
