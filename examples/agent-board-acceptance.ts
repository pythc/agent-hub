/** Isolated fixture for plugin/browser acceptance; never opens a production database. */
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs'
import {resolve,join} from 'node:path'
import {randomUUID} from 'node:crypto'
import {buildViewPackage,installViewPackage} from '../src/workspace-view-package.ts'
import {serve} from '../src/server.ts'
import {boardRuntime,seedBoard} from '../tests/fixtures/agent-board-runtime.ts'
const root=resolve(process.argv[2]??'.local/agent-board-acceptance-'+Date.now())
mkdirSync(root,{recursive:true,mode:0o700})
const built=await buildViewPackage('plugins/agent-board/index.tsx',JSON.parse(readFileSync('plugins/agent-board/manifest.json','utf8')),join(root,'package-'+randomUUID()))
const runtime=boardRuntime(root),pkg=installViewPackage(built.directory,runtime.config.stateDir,built.digest)
runtime.config.viewPlugins=[{id:pkg.manifest.id,directory:pkg.directory,digest:pkg.digest,enabled:true}]
seedBoard(runtime)
const host=await serve(runtime),token=readFileSync(host.tokenPath,'utf8').trim(),password=randomUUID()+'A!'
const response=await fetch(host.url+'/account/setup',{method:'POST',headers:{authorization:'Bearer '+token,origin:host.url,'content-type':'application/json'},body:JSON.stringify({username:'board-preview',displayName:'Alex',password,remember:true})})
if(!response.ok)throw Error('Use a new isolated acceptance directory: '+response.status)
const cookie=response.headers.get('set-cookie')!.split(';')[0]!
writeFileSync(join(root,'browser.json'),JSON.stringify({base:host.url,cookie,url:host.url+'/configure#plugin/agent-board'}),{mode:0o600})
console.log(JSON.stringify({url:host.url+'/configure#plugin/agent-board',fixture:true,info:join(root,'browser.json')}))
async function close(){host.server.closeAllConnections();await new Promise<void>(r=>host.server.close(()=>r()));await host.closeRuntime()}
process.once('SIGTERM',()=>void close());process.once('SIGINT',()=>void close())
