import {upgradeWebhooks} from './webhook-upgrade.ts'
import {pluginCommand} from './plugin-cli.ts'
import {clientIds,clientConfig,installClient,restoreClient,type ClientId} from './clients.ts'
import { readFileSync } from 'node:fs'
import { loadConfig } from './config.ts'
import { supervise, watch } from './supervisor.ts'
import {runWatchdog} from './watchdog-daemon.ts'
import { Runtime } from './runtime.ts'
import { serve } from './server.ts'
import { startMcp } from './mcp.ts'
import {startWorkerMcp} from './worker-mcp.ts'
import {backupState,verifyBackup,restoreState} from './backup.ts'
import {BackendRegistry} from './backends/registry.ts'
import {initOffice} from './office.ts'
import {preparePersonalSetup,rememberPersonalPort} from './personal-setup.ts'
import {previewScopeMigration,applyScopeMigration,rollbackScopeMigration} from './scope-migration.ts'
import {runCodexRouter} from './codex-router.ts'
import {announceLaunch,parseLauncherArgs} from './personal-launch.ts'

const args = process.argv.slice(2)
const command = args[0]==='--help'||args[0]==='-h'
  ? 'help'
  : !args.length || args[0]?.startsWith('--') ? 'setup' : args.shift()!
async function main() {
  if(process.env.AGENTHUB_ENV_FILE)try{process.loadEnvFile(process.env.AGENTHUB_ENV_FILE)}catch{throw Error('Cannot load AGENTHUB_ENV_FILE; check its path and access permissions')}
  if(command==='webhooks'){if(args[0]!=='upgrade'||!args[1]||!args[2])throw Error('Use webhooks upgrade <config.json> <new backup directory>; stop the host first');console.log(JSON.stringify(await upgradeWebhooks(loadConfig(args[1]),args[2]),null,2));return}
  if(command==='plugins'){console.log(JSON.stringify(await pluginCommand(args),null,2));return}
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
  else if(command==='router'){
    const [url,tokenFile,...rest]=args
    const value=(flag:string)=>{const i=rest.indexOf(flag);return i<0?undefined:rest[i+1]}
    const prompt=value('--prompt');if(!url||!tokenFile||!prompt)throw Error('Use router <url> <token-file> --prompt <message> [--resume <Router session UUID>] [--json]')
    process.exitCode=await runCodexRouter({url,tokenFile,prompt,resume:value('--resume'),json:rest.includes('--json')})
  }
  else if(command==='check'){if(!args[0])throw Error('Config required');const host=await Runtime.create(loadConfig(args[0]));try{const result=await host.setup.check();console.log(JSON.stringify(result,null,2));if(result.status!=='ok')process.exitCode=3}finally{await host.close()}}
  else if(command==='worker-mcp'){if(!args[0]||!args[1])throw Error('Worker host and grant file required');await startWorkerMcp(args[0],args[1])}
  else if(command==='scope-migration'){
    const [action,path,specFile,expected]=args;if(!path||!specFile)throw Error('Use scope-migration preview|apply <config.json> <plan.json> [preview fingerprint]')
    const config=loadConfig(path)
    if(action==='rollback'){console.log(JSON.stringify(await rollbackScopeMigration(config,specFile),null,2));return}
    const spec=JSON.parse(readFileSync(specFile,'utf8'))
    if(action==='preview')console.log(JSON.stringify(previewScopeMigration(config,spec),null,2))
    else if(action==='apply'&&expected)console.log(JSON.stringify(await applyScopeMigration(config,spec,expected),null,2))
    else throw Error('Apply requires the reviewed preview fingerprint')
  }
  else if(command==='backup'||command==='restore'){
    if(!args[0]||!args[1])throw Error('Config file and backup directory required')
    console.log(JSON.stringify(await (command==='backup'?backupState:restoreState)(loadConfig(args[0]),args[1]),null,2))
  }
  else if(command==='verify-backup'){if(!args[0])throw Error('Backup directory required');console.log(JSON.stringify(verifyBackup(args[0]),null,2))}
  else if(command==='supervise'){if(!args[0])throw Error('Config file required');await supervise(args[0])}
  else if(command==='watchdog'){if(!args[0])throw Error('Config file required');await runWatchdog(args[0],args.includes('--once'))}
  else if(command==='watch'){if(!args[0]||!args[1])throw Error('Host URL and token file required');await watch(args[0],args[1],args.includes('--once'))}
  else if (command === 'serve'||command==='setup') {
    const launch=parseLauncherArgs(args,1),file=launch.values[0]
    if (command==='serve'&&!file) throw new Error('Usage: serve <config.json>')
    const personal=command==='setup'?preparePersonalSetup(file):undefined
    if(personal&&!personal.created&&personal.config.port){
      try{
        const token=readFileSync(personal.config.stateDir+'/access-token','utf8').trim(),response=await fetch('http://127.0.0.1:'+personal.config.port+'/operator-link',{method:'POST',headers:{authorization:'Bearer '+token},signal:AbortSignal.timeout(2000)})
        if(response.ok){await announceLaunch({...await response.json() as {url:string},reused:true},launch.open);return}
      }catch{}
    }
    const host = await Runtime.create(personal?.config??loadConfig(file!))
    try {
      const result = await serve(host)
      if(personal)rememberPersonalPort(personal.file,Number(new URL(result.url).port))
      let stopping = false
      const shutdown = async () => {
        if (stopping) return
        stopping = true
        result.server.close()
        await result.closeRuntime()
      }
      process.once('SIGINT', () => { void shutdown() })
      process.once('SIGTERM', () => { void shutdown() })
      await announceLaunch({ url: result.operatorUrl, tokenFile: result.tokenPath,connectionFile:result.connectionFile,expiresIn:600 },command==='setup'&&launch.open)
    } catch (error) { await host.close(); throw error }
  } else if (command === 'mcp') {
    if (!args[0] || !args[1]) throw new Error('Usage: mcp <http://127.0.0.1:port> <token-file>')
    const endpoint = new URL(args[0])
    if (!['127.0.0.1','localhost','[::1]'].includes(endpoint.hostname) || endpoint.protocol !== 'http:') throw new Error('This release accepts a loopback host only')
    const i=args.indexOf('--client'),client=i>=0?args[i+1]:'generic'
    if(!clientIds.includes(client as ClientId))throw Error('Unknown client')
    await startMcp(endpoint.origin, args[1],client)
  } else if(command==='open'){
    const launch=parseLauncherArgs(args,2),[url,tokenFile]=launch.values;if(!url||!tokenFile)throw Error('Use open <loopback-url> <token-file> [--no-open]')
    const endpoint=new URL(url);if(endpoint.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(endpoint.hostname))throw Error('Use a loopback host origin')
    const response=await fetch(endpoint.origin+'/operator-link',{method:'POST',headers:{authorization:'Bearer '+readFileSync(tokenFile,'utf8').trim()},signal:AbortSignal.timeout(5000)})
    if(!response.ok)throw Error('Cannot create an operator link');await announceLaunch(await response.json() as {url:string},launch.open)
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
  } else console.log('Commands: setup [private-directory] [--no-open] (default), serve <config>, supervise <config>, watchdog <config> [--once], watch <url> <token-file> [--once], open <url> <token-file> [--no-open], mcp <url> <token-file>, router <url> <token-file> --prompt <message> [--resume <UUID>] [--json], request <url> <token-file> <source> <discussion> <request-id> <text>, status <url> <token-file>, action <url> <token-file> <pause|resume|stop|retry|takeover|return> [id]')
}
main().catch(error => { console.error(String(error)); process.exitCode = 1 })
