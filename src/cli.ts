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
import {initOffice} from './office.ts'
import {preparePersonalSetup,rememberPersonalPort} from './personal-setup.ts'

const [command, ...args] = process.argv.slice(2)
async function main() {
  if(process.env.AGENTHUB_ENV_FILE)try{process.loadEnvFile(process.env.AGENTHUB_ENV_FILE)}catch{throw Error('Cannot load AGENTHUB_ENV_FILE; check its path and access permissions')}
  if(command==='office'){
    const [action,platform,...options]=args
    const directory=options[0]&&!options[0].startsWith('--')?options[0]:undefined,rest=directory?options.slice(1):options
    if(action!=='init'||!['feishu','wecom'].includes(platform??''))throw Error('Use office init <feishu|wecom> [directory] [--chat ID] [--actor ID]')
    const option=(key:string)=>{const i=rest.indexOf('--'+key);if(i<0)return undefined;const value=rest[i+1];if(!value||value.startsWith('--'))throw Error('Missing value for --'+key);return value}
    console.log(JSON.stringify(initOffice(platform as 'feishu'|'wecom',directory??'.local/office/'+platform,option('chat'),option('actor')),null,2));return
  }
  else if(command==='backends'){
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
  else if (command === 'serve'||command==='setup') {
    if (command==='serve'&&!args[0]) throw new Error('Usage: serve <config.json>')
    const personal=command==='setup'?preparePersonalSetup(args[0]):undefined
    if(personal&&!personal.created&&personal.config.port){
      try{
        const token=readFileSync(personal.config.stateDir+'/access-token','utf8').trim(),response=await fetch('http://127.0.0.1:'+personal.config.port+'/operator-link',{method:'POST',headers:{authorization:'Bearer '+token},signal:AbortSignal.timeout(2000)})
        if(response.ok){console.log(JSON.stringify({...await response.json() as object,reused:true}));return}
      }catch{}
    }
    const host = new Runtime(personal?.config??loadConfig(args[0]!))
    try {
      const result = await serve(host)
      if(personal)rememberPersonalPort(personal.file,Number(new URL(result.url).port))
      process.stdout.write(JSON.stringify({ url: result.operatorUrl, tokenFile: result.tokenPath,connectionFile:result.connectionFile,expiresIn:600 }) + '\n')
      let stopping = false
      const shutdown = async () => {
        if (stopping) return
        stopping = true
        result.server.close()
        await result.closeRuntime()
      }
      process.once('SIGINT', () => { void shutdown() })
      process.once('SIGTERM', () => { void shutdown() })
    } catch (error) { await host.close(); throw error }
  } else if (command === 'mcp') {
    if (!args[0] || !args[1]) throw new Error('Usage: mcp <http://127.0.0.1:port> <token-file>')
    const endpoint = new URL(args[0])
    if (!['127.0.0.1','localhost','[::1]'].includes(endpoint.hostname) || endpoint.protocol !== 'http:') throw new Error('This release accepts a loopback host only')
    const i=args.indexOf('--client'),client=i>=0?args[i+1]:'generic'
    if(!clientIds.includes(client as ClientId))throw Error('Unknown client')
    await startMcp(endpoint.origin, args[1],client)
  } else if(command==='open'){
    const [url,tokenFile]=args;if(!url||!tokenFile)throw Error('Use open <loopback-url> <token-file>')
    const endpoint=new URL(url);if(endpoint.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(endpoint.hostname))throw Error('Use a loopback host origin')
    const response=await fetch(endpoint.origin+'/operator-link',{method:'POST',headers:{authorization:'Bearer '+readFileSync(tokenFile,'utf8').trim()}})
    if(!response.ok)throw Error('Cannot create an operator link');console.log(JSON.stringify(await response.json()))
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
  } else console.log('Commands: setup [private-directory], serve <config>, open <url> <token-file>, mcp <url> <token-file>, request <url> <token-file> <source> <discussion> <request-id> <text>, status <url> <token-file>, action <url> <token-file> <pause|resume|stop|retry|takeover|return> [id]')
}
main().catch(error => { console.error(String(error)); process.exitCode = 1 })
