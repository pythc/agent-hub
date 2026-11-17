import {join} from 'node:path'
import {existsSync} from 'node:fs'
import {createCliPlugin} from '../cli-shared/backend.ts'
import {privateFile,readJson,digest,endpoint} from '../cli-shared/files.ts'
import {isolatedEnvironment} from '../cli-shared/environment.ts'
import type {CliDriver} from '../cli-shared/contract.ts'
import {BackendAdapterError} from '../backend-sdk.ts'

export const claudeDriver:CliDriver={
 id:'claude-code',version:'2.1.319',credentialEnvs:['ANTHROPIC_API_KEY','CLAUDE_CODE_OAUTH_TOKEN'],
 upstream:config=>config.baseUrl??'https://api.anthropic.com',
 auth(directory){
  const source=join(directory,'.credentials.json'),credential=readJson(source)?.claudeAiOauth
  if(!credential?.refreshToken||!credential?.accessToken)return
  return {identity:digest(JSON.stringify(['claude',credential.subscriptionType,credential.refreshToken])),files:[{source,target:'home/.claude/.credentials.json'},...(existsSync(join(directory,'.claude.json'))?[{source:join(directory,'.claude.json'),target:'home/.claude/.claude.json'}]:[])]}
 },
 prepare({config,root,nativeId,newId,request,mcp,prompt}){
  const effort=request.options?.parameters?.effort??request.options?.effort
  if(effort&&!['low','medium','high','xhigh','max'].includes(String(effort))||request.options?.effort&&request.options?.parameters?.effort&&request.options.effort!==request.options.parameters.effort)throw new BackendAdapterError('unsupported')
  const env={...isolatedEnvironment(root),CLAUDE_CODE_TMPDIR:join(root,'tmp'),CLAUDE_CONFIG_DIR:join(root,'home','.claude'),CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1',DISABLE_AUTOUPDATER:'1',DISABLE_TELEMETRY:'1',...(config.baseUrl?{ANTHROPIC_BASE_URL:endpoint(config.baseUrl)!}:{})}
  privateFile(join(root,'mcp.json'),JSON.stringify({mcpServers:{roppo:{type:'http',url:mcp.url,headers:{Authorization:'Bearer '+mcp.token}}}}))
  privateFile(join(root,'instructions.txt'),request.instructions)
  const args=['--print','--verbose','--output-format','stream-json','--tools','','--strict-mcp-config','--mcp-config',join(root,'mcp.json'),'--disable-slash-commands','--setting-sources','','--settings',JSON.stringify({disableAllHooks:true,autoMemoryEnabled:false,enabledPlugins:{}}),'--permission-mode','dontAsk','--allowedTools','mcp__roppo__*','--system-prompt-file',join(root,'instructions.txt'),'--system-prompt-snapshot','off',...(nativeId?['--resume',nativeId]:['--session-id',newId])]
  if(process.env.ANTHROPIC_API_KEY)args.push('--bare')
  if(request.model??config.model)args.push('--model',(request.model??config.model)!)
  if(effort)args.push('--effort',String(effort))
  if(request.options?.maxSteps)args.push('--max-turns',String(request.options.maxSteps))
  return {args,env,stdin:prompt}
 },
 event(value){
  if(value.type==='system'&&value.subtype==='init')return {session:value.session_id,model:value.model}
  if(value.type==='assistant')return {text:value.message?.content?.filter((p:any)=>p.type==='text').map((p:any)=>p.text).join(''),tool:value.message?.content?.find((p:any)=>p.type==='tool_use'&&p.name!=='EndConversation')?.name}
  if(value.type==='result')return value.is_error?{error:JSON.stringify(value.errors??value.result)}:{session:value.session_id,final:value.result,done:true}
  return {}
 },
 toolName:name=>name.startsWith('mcp__roppo__')?name.slice('mcp__roppo__'.length):undefined,
}
export default createCliPlugin(claudeDriver)
