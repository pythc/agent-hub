import {providerDefaults, guideApiFormats} from '../model-provider-presets.ts'
import {byName} from './list-order.ts'
import {createInterface} from 'node:readline/promises'
import {Writable} from 'node:stream'
import {spawn} from 'node:child_process'
import {existsSync,readFileSync,mkdirSync,openSync,closeSync} from 'node:fs'
import {join,dirname} from 'node:path'
import {fileURLToPath} from 'node:url'
import {homedir} from 'node:os'
import {setTimeout as delay} from 'node:timers/promises'
import {TerminalClient,CliError,clean} from './client.ts'
import {setupAccountSchema} from '../personal-account.ts'
import {preparePersonalSetup} from '../personal-setup.ts'
import type {terminalSetupInfo} from './setup-host.ts'

export interface SetupUI {
 text(message:string,options?:{secret?:boolean;initial?:string}):Promise<string>
 choose(message:string,choices:string[],preview?:(index:number)=>string):Promise<number>
 note(message:string):void
}
export class SetupCancelled extends Error {constructor(){super('Setup cancelled.')}}
export function terminalSetupUI():SetupUI {
 const text=async(message:string,options:{secret?:boolean;initial?:string}={})=>{
  let muted=false
  const output=new Writable({write(chunk,_encoding,done){if(!muted)process.stderr.write(chunk);done()}})
  const rl=createInterface({input:process.stdin,output,terminal:true}),abort=new AbortController()
  rl.once('SIGINT',()=>abort.abort());rl.once('close',()=>abort.abort())
  try{
   const answer=rl.question(clean(message)+(options.initial?' ['+clean(options.initial)+']':'')+': ',{signal:abort.signal})
   muted=!!options.secret
   const value=await answer
   if(options.secret)process.stderr.write('\n')
   return options.secret ? value : value.trim()||options.initial||''
  }catch(error){if(abort.signal.aborted)throw new SetupCancelled();throw error}finally{rl.close();output.end()}
 }
 return {text,note:message=>process.stderr.write(clean(message)+'\n'),choose:async(message,choices,preview)=>{
  const ordered=byName(choices.map((label,index)=>({label,index})),choice=>choice.label)
  process.stderr.write('\n'+clean(message)+'\n'+ordered.map((choice,i)=>'  '+(i+1)+'. '+clean(choice.label)+(preview ? "  "+preview(choice.index) : "")).join('\n')+'\n')
  for(;;){const input=await text('Choose a number',{initial:'1'}),index=Number(input)-1;if(Number.isInteger(index)&&index>=0&&index<ordered.length)return ordered[index]!.index;process.stderr.write('Choose one of the numbers above.\n')}
 }}
}
export async function setupClient(host:string|undefined,dialog:SetupUI){
 let client:TerminalClient|undefined
 try{client=new TerminalClient(host);await client.request('/health',undefined,{native:true});return client}
 catch(error){if(!(error instanceof CliError)||!['host_not_found','host_unavailable'].includes(error.code)||host||process.env.ROPPO_HOST||process.env.ROPPO_CONNECTION_FILE)throw error}
 const personal=preparePersonalSetup(process.env.ROPPO_HOME??join(homedir(),'.agent-hub'))
 if(client&&personal.config.port&&client.base!=='http://127.0.0.1:'+personal.config.port)throw new CliError('The selected service is offline. Start it before reconnecting.')
 dialog.note('Starting your local Roppo service…')
 const logs=join(dirname(personal.file),'logs');mkdirSync(logs,{recursive:true,mode:0o700})
 const log=openSync(join(logs,'terminal-service.log'),'a',0o600)
 const child=spawn(process.env.ROPPO_NODE??process.execPath,['--import',fileURLToPath(new URL('../../node_modules/tsx/dist/loader.mjs',import.meta.url)),fileURLToPath(new URL('../cli.ts',import.meta.url)),'setup',dirname(personal.file),'--no-open'],{detached:true,stdio:['ignore',log,log]})
 closeSync(log);let failure:Error|undefined;child.once('error',error=>{failure=error});child.unref()
 const file=join(personal.config.stateDir,'connection.json')
 for(let i=0;i<120;i++){
  if(failure)throw failure
  if(child.exitCode!==null)break
  if(existsSync(file)){
   const value=JSON.parse(readFileSync(file,'utf8'));const candidate=new TerminalClient(value.url)
   try{await candidate.request('/health',undefined,{native:true});return candidate}catch(error){if(!(error instanceof CliError)||error.code!=='host_unavailable')throw error}
  }
  await delay(250)
 }
 throw new CliError('Service did not start. See '+join(logs,'terminal-service.log'))
}
export async function accountSetup(client:TerminalClient,dialog:SetupUI){
 if(client.signedIn)return
 const status=await client.request<{configured:boolean}>('/account/status',undefined,{native:true})
 dialog.note(status.configured?'\nSign in to your local Roppo account.':'\nCreate your local Roppo account (shared with the web).')
 let token:string|undefined
 if(!status.configured){
  const info=await client.request<{connectionFile:string}>('/connect-info',undefined,{native:true})
  const connection=JSON.parse(readFileSync(info.connectionFile,'utf8'))
  if(connection.url!==client.base)throw new CliError('The local setup file belongs to another service.')
  token=readFileSync(join(dirname(info.connectionFile),'access-token'),'utf8').trim()
 }
 for(;;){
  let username:string,displayName:string|undefined,password:string
  if(token){
   const fields=setupAccountSchema.shape
   for(;;){
    username=await dialog.text('Username (3–40 characters)')
    if(fields.username.safeParse(username).success)break
    dialog.note('Use 3–40 characters. Start with a letter or digit and use only A–Z, a–z, 0–9, dot, underscore or hyphen.')
   }
   for(;;){
    displayName=await dialog.text('What should Roppo call you?',{initial:username})
    if(fields.displayName.safeParse(displayName).success)break
    dialog.note('Use a display name of 1–60 characters.')
   }
   for(;;){
    password=await dialog.text('Create a password (12–128 characters, hidden)',{secret:true})
    if(!fields.password.safeParse(password).success){
     dialog.note('Use a password of 12–128 characters.')
     continue
    }
    const confirmation=await dialog.text('Repeat password',{secret:true})
    if(password===confirmation)break
    dialog.note('Passwords do not match.')
   }
  }else{
   username=await dialog.text('Username')
   password=await dialog.text('Password (hidden)',{secret:true})
  }
  try{
   const result=await client.loginWithPassword({username,password,...(displayName?{displayName}:{})},token)
   if(result.recoveryCode){dialog.note('Save this account recovery code somewhere private: '+result.recoveryCode);await dialog.text('Press Enter after saving it')}
   return
  }catch(error){if(!(error instanceof CliError))throw error;dialog.note(error.message);if(await dialog.choose('Sign-in did not complete',['Try again','Cancel'])===1)throw new SetupCancelled()}
 }
}
export async function configureConnection(client:TerminalClient,dialog:SetupUI){
 const request=<T>(body:unknown)=>client.request<T>('/api/terminal/setup',body,{timeoutMs:120_000})
 for(;;){
  const info=await client.request<ReturnType<typeof terminalSetupInfo>>('/api/terminal/setup')
  const tools = info.connections.filter(c => c.kind === 'codex' || c.kind === 'plugin')
  const choices = ['API key / compatible endpoint','ChatGPT account (OAuth)','Use an existing connection','Cancel']
  if (tools.length) choices.push('Local CLI tool')
  const choice=await dialog.choose('How would you like to connect a model?',choices)
  if(choice===3)throw new SetupCancelled()
  let connection:Record<string,unknown>,name:string|undefined
  if(choice===0){
   const providers = Object.values(providerDefaults)
   const index = await dialog.choose('API provider',[...providers.map(p => p.label),'Custom API / local model'])
   const preset = providers[index]
   let protocol = preset?.protocol
   if (!preset) {
    const formats = Object.entries(guideApiFormats)
    protocol = formats[await dialog.choose('API format', formats.map(([,label]) => label))]![0]
   }
   const baseUrl = await dialog.text('API base URL',{initial:preset?.endpoint ?? 'http://127.0.0.1:11434/v1'})
   const apiKey=await dialog.text('API key (hidden; Enter if none is required)',{secret:true})
   connection={kind:'api',protocol,baseUrl,...(apiKey?{apiKey}:{})}
   let models:string[]=[]
   try{dialog.note('Loading available models…');models=(await request<{models:string[]}>({action:'models',connection})).models}catch(error){dialog.note('Model discovery unavailable; enter the model ID manually.')}
   const selected=models.length?await dialog.choose('Model',[...models,'Enter a model ID']):0
   connection.model=models[selected]??await dialog.text('Model ID')
   name=await dialog.text('Connection name',{initial:preset?.label ?? 'Custom API'})
  }else if(choice===1){
   const accounts=info.accounts.filter(a=>a.signedIn)
   const selected=await dialog.choose('Choose an account',[...accounts.map(a=>a.email??a.id),'Sign in with a new account'])
   let account=accounts[selected]?.id
   if(!account){
    const auth=await request<{account:string;url:string;attempt:string}>({action:'oauth.start'})
    dialog.note('Open this official sign-in link in your browser:\n'+auth.url)
    for(;;){
     if(await dialog.choose('Return here after browser sign-in',['I have signed in','Cancel'])===1)throw new SetupCancelled()
     const result=await request<{status:string}>({action:'oauth.status',attempt:auth.attempt})
     if(result.status==='completed'){account=auth.account;break}
     if(result.status==='failed')throw new CliError('Sign-in failed or expired. Run setup again.')
     dialog.note('Waiting for the provider to finish sign-in.')
    }
   }
   if(await dialog.choose('Allow Roppo background tasks to use this account?',['Allow','Cancel'])===1)throw new SetupCancelled()
   const owners=info.owners;const owner=owners.defaultOwner??owners.choices[await dialog.choose('Account access identity',owners.choices.map(c=>c.label))]!
   let models:string[]=[]
   try {
    type ModelList = (string | {id:string})[]
    const catalog=await request<ModelList | {data?:ModelList;models?:ModelList}>({action:'oauth.models',account})
    const entries=Array.isArray(catalog) ? catalog : catalog.data ?? catalog.models ?? []
    models=entries.map(entry => typeof entry === 'string' ? entry : entry.id)
   } catch {
    dialog.note('Could not load account models. Enter an available model ID.')
   }
   const selectedModel=models.length?await dialog.choose('Model',[...models,'Enter a model ID']):0
   connection={kind:'subscription',account,model:models[selectedModel]??await dialog.text('Model ID'),owner:{source:owner.source,actor:owner.actor},backgroundAuthorized:true}
   name=await dialog.text('Connection name',{initial:'ChatGPT'})
  }else{
   const available = choice === 4 ? tools : info.connections
   if(!available.length){dialog.note('No saved connections yet.');continue}
   const selected=await dialog.choose(choice === 4 ? 'Installed tool connection' : 'Saved connections',available.map(c=>c.label+(c.model?' · '+c.model:'')))
   connection={kind:'existing',id:available[selected]!.id}
  }
  const target=info.initial?'router':await dialog.choose('Use this connection for…',['Router (existing Workers keep their settings)','Save to library; choose an agent later'])===0?'router':'library'
  try{
   const plan=await request<{id:string;connection:{kind:string;label:string;model?:string}}>({action:'plan',value:{revision:info.revision,connection,name,target}})
   dialog.note(['codex','plugin'].includes(plan.connection.kind) ? 'Checking tool installation and sign-in…' : 'Testing the connection (one small model request may use credits)…')
   const check=await request<{ok:boolean;remoteVerified:boolean;checks:{code:string;detail?:string}[]}>({action:'check',id:plan.id})
   if(!check.ok){dialog.note(check.checks.map(c=>c.code+(c.detail?' · '+c.detail:'')).join('\n'));if(await dialog.choose('Connection check failed',['Edit connection and retry','Cancel'])===1)throw new SetupCancelled();continue}
   dialog.note(check.remoteVerified?'The model replied successfully.':'Local CLI installation and sign-in checked; no model request was sent.')
   const summary=plan.connection.label+(plan.connection.model?' · '+plan.connection.model:'')+(info.initial?'\nSet up the Router and one initial Worker. Memory stays enabled.':target==='router'?'\nUse for future Router turns.':'\nSave in the connection library.')
   if(await dialog.choose(summary,['Save and finish','Cancel'])===1)throw new SetupCancelled()
   await request({action:'apply',id:plan.id});dialog.note('Connection saved. You are ready to chat.');return
  }catch(error){if(error instanceof SetupCancelled)throw error;dialog.note((error as Error).message);if(await dialog.choose('Setup did not finish',['Try again','Cancel'])===1)throw new SetupCancelled()}
 }
}
