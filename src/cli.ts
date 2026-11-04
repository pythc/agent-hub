import {clientIds,clientConfig,installClient,restoreClient,type ClientId} from './clients.ts'
import { readFileSync } from 'node:fs'
import { loadConfig } from './config.ts'
import { supervise, watch } from './supervisor.ts'
import { Runtime } from './runtime.ts'
import { serve } from './server.ts'
import { startMcp } from './mcp.ts'
import {startWorkerMcp} from './worker-mcp.ts'
import {backupState,verifyBackup,restoreState} from './backup.ts'
import {BackendRegistry} from './backends/registry.ts'

const [command, ...args] = process.argv.slice(2)
async function main() {
  if(command==='backends'){
    if(args[0]!=='list')throw Error('Use backends list [config.json]')
    if(!args[1]){console.log(JSON.stringify({supported:['codex','openai-responses','openai-chat','anthropic']}));return}
    const config=loadConfig(args[1]),registry=new BackendRegistry(config,{get:()=>undefined,put:()=>{}})
    console.log(JSON.stringify({roles:config.execution,backends:registry.configured(),sandboxDriver:config.work.sandboxDriver},null,2));return
  }
  else if(command==='clients'){
    const [action,client,...rest]=args
    const option=(key:string)=>{const i=rest.indexOf('--'+key);if(i<0)return undefined;const value=rest[i+1];if(!value||value.startsWith('--'))throw Error('Missing value for --'+key);return value}
    if(action==='list'){console.log(JSON.stringify(clientIds));return}
    if(action==='restore'){if(!client||!rest[0])throw Error('Backup directory and id required');console.log(JSON.stringify(restoreClient(client,rest[0])));return}
    if(!client||!clientIds.includes(client as ClientId))throw Error('Select a supported client')
    const options={client:client as ClientId,url:option('url'),tokenFile:option('token-file'),name:option('name'),workspace:option('workspace'),file:option('file'),replace:rest.includes('--replace')}
    if(action==='config')console.log(clientConfig(options).text)
    else if(action==='install')console.log(JSON.stringify(installClient(options)))
    else throw Error('Use clients list, config, install or restore')
  }
  else if(command==='check'){if(!args[0])throw Error('Config required');const host=new Runtime(loadConfig(args[0]));try{const result=await host.setup.check();console.log(JSON.stringify(result,null,2));if(result.status!=='ok')process.exitCode=3}finally{await host.close()}}
  else if(command==='worker-mcp'){if(!args[0]||!args[1])throw Error('Worker host and grant file required');await startWorkerMcp(args[0],args[1])}
  else if(command==='backup'||command==='restore'){
    if(!args[0]||!args[1])throw Error('Config file and backup directory required')
    console.log(JSON.stringify(await (command==='backup'?backupState:restoreState)(loadConfig(args[0]),args[1]),null,2))
  }
  else if(command==='verify-backup'){if(!args[0])throw Error('Backup directory required');console.log(JSON.stringify(verifyBackup(args[0]),null,2))}
  else if(command==='supervise'){if(!args[0])throw Error('Config file required');await supervise(args[0])}
  else if(command==='watch'){if(!args[0]||!args[1])throw Error('Host URL and token file required');await watch(args[0],args[1],args.includes('--once'))}
  else if (command === 'serve') {
    if (!args[0]) throw new Error('Usage: serve <config.json>')
    const host = new Runtime(loadConfig(args[0]))
    try {
      const result = await serve(host)
      process.stdout.write(JSON.stringify({ url: result.url, tokenFile: result.tokenPath }) + '\n')
      let stopping = false
      const shutdown = async () => {
        if (stopping) return
        stopping = true
        result.server.close()
        await host.close()
      }
      process.once('SIGINT', () => { void shutdown() })
      process.once('SIGTERM', () => { void shutdown() })
    } catch (error) { await host.close(); throw error }
  } else if (command === 'mcp') {
    if (!args[0] || !args[1]) throw new Error('Usage: mcp <http://127.0.0.1:port> <token-file>')
    const endpoint = new URL(args[0])
    if (!['127.0.0.1','localhost','[::1]'].includes(endpoint.hostname) || endpoint.protocol !== 'http:') throw new Error('This release accepts a loopback host only')
    await startMcp(endpoint.origin, args[1])
  } else if (command === 'request' || command === 'status' || command === 'action') {
    const [url, tokenFile, ...rest] = args
    if (!url || !tokenFile) throw new Error('Usage: ' + command + ' <host-url> <token-file> [arguments]')
    const token = readFileSync(tokenFile, 'utf8').trim()
    let value: unknown
    if (command === 'request') {
      const [source, discussion, requestId, ...message] = rest
      value = { source, event: { id: requestId, thread: discussion, text: message.join(' '), addressed: true } }
    } else if (command === 'action') value = { action: rest[0], ...(rest[1] ? { id: rest[1] } : {}) }
    const response = await fetch(url + (command === 'request' ? '/send' : '/' + command), {
      method: value ? 'POST' : 'GET', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
      ...(value ? { body: JSON.stringify(value) } : {}), signal: AbortSignal.timeout(30_000),
    })
    console.log(JSON.stringify(await response.json(), null, 2))
    if (!response.ok) process.exitCode = 1
  } else console.log('Commands: serve <config>, mcp <url> <token-file>, request <url> <token-file> <source> <discussion> <request-id> <text>, status <url> <token-file>, action <url> <token-file> <pause|resume|stop|retry|takeover|return> [id]')
}
main().catch(error => { console.error(String(error)); process.exitCode = 1 })
