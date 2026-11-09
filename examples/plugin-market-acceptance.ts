/** Real host and package lifecycle; only GitHub transport is an isolated fixture. */
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs'
import {resolve,join} from 'node:path'
import {randomUUID} from 'node:crypto'
import {Runtime} from '../src/runtime.ts'
import {configSchema} from '../src/config.ts'
import {serve} from '../src/server.ts'
import {marketFixture} from '../tests/fixtures/plugin-market.ts'
import {boardRuntime} from '../tests/fixtures/agent-board-runtime.ts'
const root=resolve(process.argv[2]??'.local/plugin-market-acceptance-'+Date.now());mkdirSync(root,{recursive:true,mode:0o700})
const fixture=await marketFixture(root,true);await fixture.add('workspace-view','1.1.0');fixture.changed()
const runtime=boardRuntime(root),host=await serve(runtime,{pluginGitHub:fixture.github,createRuntime:(config,id)=>Runtime.create(config,{pluginActivation:id,model:{async run(){throw Error('Acceptance must not call a model')}}})})
const token=readFileSync(host.tokenPath,'utf8').trim(),headers={authorization:'Bearer '+token,origin:host.url,'content-type':'application/json'}
await fetch(host.url+'/api/plugin-market/catalogs',{method:'POST',headers,body:JSON.stringify({url:'https://github.com/acme/plugins'})})
const response=await fetch(host.url+'/account/setup',{method:'POST',headers,body:JSON.stringify({username:'market-preview',displayName:'Alex',password:randomUUID()+'A!',remember:true})})
if(!response.ok)throw Error('Use a new acceptance directory: '+response.status)
const cookie=response.headers.get('set-cookie')!.split(';')[0]!
writeFileSync(join(root,'browser.json'),JSON.stringify({base:host.url,cookie,url:host.url+'/configure#integrations/market'}),{mode:0o600})
console.log(JSON.stringify({url:host.url+'/configure#integrations/market',fixture:true,info:join(root,'browser.json')}))
async function close(){host.server.closeAllConnections();await new Promise<void>(r=>host.server.close(()=>r()));await host.closeRuntime()}
process.once('SIGTERM',()=>void close());process.once('SIGINT',()=>void close())
