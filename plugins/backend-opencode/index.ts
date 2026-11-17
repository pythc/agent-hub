import {join} from 'node:path'
import {existsSync,realpathSync} from 'node:fs'
import {DatabaseSync} from 'node:sqlite'
import {createCliPlugin} from '../cli-shared/backend.ts'
import {BackendAdapterError} from '../backend-sdk.ts'
import {privateFile,readJson,digest,endpoint} from '../cli-shared/files.ts'
import {isolatedEnvironment} from '../cli-shared/environment.ts'
import type {CliDriver} from '../cli-shared/contract.ts'
export const opencodeDriver:CliDriver={
 id:'opencode-cli',version:'1.19.5',credentialEnvs:['ANTHROPIC_API_KEY','OPENAI_API_KEY','GEMINI_API_KEY','OPENCODE_API_KEY'],
 anonymous:config=>config.authMode==='anonymous'&&!config.baseUrl&&/^opencode\/(?:[a-z0-9.-]+-free|big-pickle)$/.test(config.model??''),
 credentialKeys(config){const provider=config.provider??config.model?.split('/')[0];return ({anthropic:['ANTHROPIC_API_KEY'],openai:['OPENAI_API_KEY'],google:['GEMINI_API_KEY'],opencode:['OPENCODE_API_KEY']} as Record<string,string[]>)[provider??'']??[]},
 upstream(config,model){
  if(config.baseUrl)return config.baseUrl
  const provider=config.provider??(model??config.model)?.split('/')[0],urls:Record<string,string>={anthropic:'https://api.anthropic.com/v1',openai:'https://api.openai.com/v1',google:'https://generativelanguage.googleapis.com/v1beta',opencode:'https://opencode.ai/zen/v1'}
  if(!provider||!urls[provider])throw new BackendAdapterError('configuration_invalid')
  return urls[provider]!
 },
 discoverSession(root){
  const path=join(root,'data','opencode','opencode.db');if(!existsSync(path))return
  const db=new DatabaseSync(path,{readOnly:true})
  try{
   const sessions=db.prepare('SELECT id,directory FROM session WHERE parent_id IS NULL').all()
   if(sessions.length!==1||realpathSync(String(sessions[0]!.directory))!==realpathSync(join(root,'work')))throw new BackendAdapterError('invalid_output')
   return String(sessions[0]!.id)
  }finally{db.close()}
 },
 auth(directory,config){
  const source=join(directory,'auth.json'),credential=readJson(source)
  const provider=config.provider??config.model?.split('/')[0],account=provider?credential?.[provider]:undefined
  if(!account?.key&&!account?.refresh)return
  return {identity:digest(JSON.stringify([provider,account.type,account.key??account.accountId??account.refresh])),files:[{source,target:'data/opencode/auth.json'}]}
 },
 prepare({config,root,nativeId,request,mcp,prompt}){
  if(request.options?.effort)throw new BackendAdapterError('unsupported')
  const model=request.model??config.model;if(!model||!model.includes('/'))throw new BackendAdapterError('configuration_invalid')
  const provider=config.provider??config.model?.split('/')[0]??model.split('/')[0]!
  if(provider!==model.split('/')[0])throw new BackendAdapterError('configuration_invalid')
  const settings={model,small_model:model,enabled_providers:[provider],default_agent:'roppo',autoupdate:false,share:'disabled',plugin:[],instructions:[],compaction:{auto:false},watcher:{ignore:['**']},permission:{'*':'deny','roppo_*':'allow'},agent:{roppo:{mode:'primary',prompt:request.instructions,steps:request.options?.maxSteps??64,tools:{'*':false,'roppo_*':true},permission:{'*':'deny','roppo_*':'allow'}}},mcp:{roppo:{type:'remote',url:mcp.url,headers:{Authorization:'Bearer '+mcp.token},oauth:false,enabled:true}},...(config.baseUrl?{provider:{[provider]:{options:{baseURL:endpoint(config.baseUrl)}}}}:{})}
  privateFile(join(root,'opencode.json'),JSON.stringify(settings))
  const env={...isolatedEnvironment(root),OPENCODE_CONFIG:join(root,'opencode.json'),OPENCODE_CONFIG_CONTENT:JSON.stringify(settings),OPENCODE_DISABLE_PROJECT_CONFIG:'1',OPENCODE_DISABLE_AUTOUPDATE:'1',OPENCODE_DISABLE_CLAUDE_CODE:'1',OPENCODE_DISABLE_EXTERNAL_SKILLS:'1'}
  const args=['run','--pure','--format','json','--dir',join(root,'work'),'--agent','roppo','--model',model,...(nativeId?['--session',nativeId]:[])]
  const variant=request.options?.parameters?.variant;if(variant)args.push('--variant',String(variant))
  return {args,env,stdin:prompt}
 },
 event(value){
  if(value.type==='error')return {error:JSON.stringify(value.error)}
  return {session:value.sessionID,...(value.type==='text'?{text:value.part?.text}:{}),...(value.type==='tool_use'?{tool:value.part?.tool}:{}),...(value.type==='step_finish'&&value.part?.reason==='stop'?{done:true}:{})}
 },
 toolName:name=>name.startsWith('roppo_')?name.slice('roppo_'.length):undefined,
}
export default createCliPlugin(opencodeDriver)
