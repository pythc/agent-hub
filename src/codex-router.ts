import {spawn} from 'node:child_process'
import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {configSchema,type Config} from './config.ts'
import {clientConfig} from './clients.ts'
import {cliEnvironment} from './codex.ts'

export interface RouterLaunch {url:string;tokenFile:string;prompt:string;resume?:string;json?:boolean;output?:string}
/** Per-invocation native approval review. Never rewrites the user's Codex configuration. */
export function codexRouterCommand(config:Config,launch:RouterLaunch){
 if(config.execution.router?.mode!=='client')throw Error('Select execution.router.mode=client before starting a CLI Router')
 if(!config.execution.management?.enabled)throw Error('Enable execution.management before starting a CLI Router')
 if(!launch.prompt.trim())throw Error('Router message required')
 if(launch.resume&&!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(launch.resume))throw Error('Resume requires the exact Router session UUID')
 const profile=config.execution.router,id=profile.backend??config.execution.roles.router??config.execution.backend
 const definition=config.backends[id]??(id==='codex'?{kind:'codex' as const}:undefined)
 if(!definition||definition.kind!=='codex')throw Error('The Codex CLI Router requires a Codex connection')
 const source=config.sources.find(s=>s.kind==='local'&&s.enabled)
 if(!source)throw Error('An enabled local operator source is required')
 const model=profile.model??config.models.router??definition.model??config.model
 if(!model)throw Error('Select an explicit Router model')
 const effort=profile.effort??definition.defaults?.effort??config.effort
 // Native exec has its own configuration surface. Do not silently drop app-server-only options.
 for(const p of [definition.defaults,profile])if(p){
  if(p.parameters&&Object.keys(p.parameters).length||p.maxSteps!==undefined||p.maxToolCalls!==undefined||p.maxOutputTokens!==undefined||p.timeoutMs!==undefined)throw Error('CLI Router supports model, effort and prompt; use the native CLI configuration for other frontend parameters')
  if(p.tools&&(p.tools.length!==1||p.tools[0]!=='worker_manage'))throw Error('CLI Router supports only worker_manage in its allowed tools')
 }
 const bridge=clientConfig({client:'codex',url:launch.url,tokenFile:launch.tokenFile,name:'agenthub-router',tagged:true})
 const args=[...(definition.args??[]),'exec','--ignore-user-config','--skip-git-repo-check','--approve-for-me','--model',model]
 const set=(key:string,value:unknown)=>args.push('-c',key+'='+JSON.stringify(value))
 set('model_reasoning_effort',effort);set('approval_policy','on-request');set('approvals_reviewer','auto_review')
 set('mcp_servers.agenthub-router.command',bridge.server.command);set('mcp_servers.agenthub-router.args',bridge.server.args)
 set('mcp_servers.agenthub-router.enabled_tools',['worker_manage']);set('mcp_servers.agenthub-router.required',true)
 set('mcp_servers.agenthub-router.tools.worker_manage.approval_mode','prompt')
 set('developer_instructions',[
  'You are the sole user-facing Router in this Codex CLI conversation. Use only AgentHub worker_manage to delegate work and inspect actual results. Start with list for the current revision and existing Workers. Use one stable discussion ID for this conversation and retain ticket IDs for follow-ups. All Workers report internally to you. Ask the user yourself when needed, and summarize verified Worker evidence in this conversation. Queued is not completed. result can wait up to 5000 ms. Do not call agent_request, start a second Router, or contact Workers through native chats. Do not use local shell, native subagents, other MCP servers or external messaging. Respect approval decisions; report a denial without attempting an alternate route.',
  definition.defaults?.prompt,profile.prompt,
 ].filter(Boolean).join('\n\n'))
 for(const feature of ['shell_tool','unified_exec','multi_agent','apps','browser_use','computer_use'])args.push('--disable',feature)
 if(launch.json)args.push('--json')
 if(launch.output)args.push('--output-last-message',resolve(launch.output))
 if(launch.resume)args.push('resume',launch.resume)
 args.push(launch.prompt)
 return {binary:definition.command??config.codex,args,cwd:source.cwd,env:cliEnvironment(definition.env),model,effort}
}

export async function runCodexRouter(launch:RouterLaunch){
 const url=new URL(launch.url)
 if(url.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||url.pathname!=='/'||url.username||url.password||url.search||url.hash)throw Error('Use a loopback host origin')
 const response=await fetch(url.origin+'/settings',{headers:{authorization:'Bearer '+readFileSync(launch.tokenFile,'utf8').trim()},signal:AbortSignal.timeout(10000)})
 if(!response.ok)throw Error('Cannot read AgentHub settings: HTTP '+response.status)
 const settings=await response.json() as any,command=codexRouterCommand(configSchema.parse(settings.current.config),launch)
 const child=spawn(command.binary,command.args,{cwd:command.cwd,env:command.env,stdio:'inherit',shell:false})
 const stop=()=>child.kill('SIGTERM'),interrupt=()=>child.kill('SIGINT');process.once('SIGTERM',stop);process.once('SIGINT',interrupt)
 try{return await new Promise<number>((resolve,reject)=>{child.once('error',reject);child.once('close',code=>resolve(code??1))})}
 finally{process.removeListener('SIGTERM',stop);process.removeListener('SIGINT',interrupt)}
}
