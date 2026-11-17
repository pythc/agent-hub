import {join} from 'node:path'
import {createCliPlugin} from '../cli-shared/backend.ts'
import {BackendAdapterError} from '../backend-sdk.ts'
import {privateFile,readJson,digest,endpoint} from '../cli-shared/files.ts'
import {isolatedEnvironment} from '../cli-shared/environment.ts'
import type {CliDriver} from '../cli-shared/contract.ts'
export const geminiDriver:CliDriver={
 id:'gemini-cli',version:'0.67.0',credentialEnvs:['GEMINI_API_KEY','GOOGLE_API_KEY'],
 upstream:config=>config.baseUrl??(process.env.GEMINI_API_KEY||process.env.GOOGLE_API_KEY?'https://generativelanguage.googleapis.com':'https://cloudcode-pa.googleapis.com'),
 auth(directory){
  const source=join(directory,'oauth_creds.json'),credential=readJson(source),accounts=readJson(join(directory,'google_accounts.json'))
  if(!credential?.refresh_token)return
  return {identity:digest(JSON.stringify(['gemini',accounts?.active??credential.refresh_token])),files:[{source,target:'home/.gemini/oauth_creds.json'},...(accounts?[{source:join(directory,'google_accounts.json'),target:'home/.gemini/google_accounts.json'}]:[])]}
 },
 prepare({config,root,nativeId,newId,request,mcp,prompt}){
  if(request.options?.effort)throw new BackendAdapterError('unsupported')
  const env={...isolatedEnvironment(root),GEMINI_CLI_HOME:join(root,'home'),GEMINI_CLI_SYSTEM_SETTINGS_PATH:join(root,'absent-system-settings.json'),GEMINI_SYSTEM_MD:join(root,'instructions.md'),NO_BROWSER:'true',...(config.baseUrl?{GOOGLE_GEMINI_BASE_URL:endpoint(config.baseUrl)!,CODE_ASSIST_ENDPOINT:endpoint(config.baseUrl)!}:{})}
  privateFile(join(root,'instructions.md'),request.instructions)
  privateFile(join(root,'home','.gemini','settings.json'),JSON.stringify({security:{auth:{selectedType:process.env.GEMINI_API_KEY||process.env.GOOGLE_API_KEY?'gemini-api-key':'oauth-personal'},enablePermanentToolApproval:false},tools:{core:['__roppo_no_native_tools__']},mcp:{allowed:['roppo']},mcpServers:{roppo:{httpUrl:mcp.url,headers:{Authorization:'Bearer '+mcp.token},trust:true,includeTools:(request.tools??[]).map(t=>t.name)}},hooks:{},general:{enableAutoUpdate:false,enablePromptCompletion:false},privacy:{usageStatisticsEnabled:false},telemetry:{enabled:false},experimental:{enableAgents:false,enableAutoMemory:false},context:{fileName:'ROPPODOESNOTEXIST.md'},model:{maxSessionTurns:request.options?.maxSteps??64}}))
  // An explicit admin allowlist outranks native/default/user policy rules.
  privateFile(join(root,'policy.toml'),'[[rule]]\ntoolName = "*"\ndecision = "deny"\npriority = 1\n\n[[rule]]\nmcpName = "roppo"\ntoolName = "*"\ndecision = "allow"\npriority = 2\n')
  const args=['--prompt','','--output-format','stream-json','--skip-trust','--extensions','','--allowed-mcp-server-names','roppo','--admin-policy',join(root,'policy.toml'),...(nativeId?['--resume',nativeId]:['--session-id',newId])]
  if(request.model??config.model)args.push('--model',(request.model??config.model)!)
  return {args,env,stdin:prompt}
 },
 event(value){
  if(value.type==='init')return {session:value.session_id,model:value.model}
  if(value.type==='message'&&value.role==='assistant')return {text:value.content}
  if(value.type==='tool_use')return {tool:value.tool_name}
  if(value.type==='error'&&value.severity!=='warning')return {error:JSON.stringify(value)}
  if(value.type==='result')return value.status==='success'?{done:true}:{error:JSON.stringify(value)}
  return {}
 },
 toolName:name=>name.startsWith('mcp_roppo_')?name.slice('mcp_roppo_'.length):name.startsWith('roppo__')?name.slice('roppo__'.length):name,
}
export default createCliPlugin(geminiDriver)
