import {BackendRegistry} from './backends/registry.ts'
import {randomUUID} from 'node:crypto'
import {existsSync,mkdirSync,realpathSync,statSync,accessSync,constants} from 'node:fs'
import {isAbsolute,join,relative,resolve,sep,dirname,basename} from 'node:path'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {z} from 'zod'
import {configSchema,type Config} from './config.ts'
import {backendDefinition,type BackendDefinition} from './backend-config.ts'
import type {Runtime} from './runtime.ts'
import {ApiModel} from './backends/api.ts'
import {managedConnections,managedSecrets,prepareManagedConfig} from './managed-config.ts'
import {Store} from './store.ts'
import {cliEnvironment} from './codex.ts'

const exec=promisify(execFile)
export const onboardingPlanSchema=z.object({revision:z.number().int().min(0),connection:z.discriminatedUnion('kind',[
 z.object({kind:z.literal('existing'),id:z.string().min(1).max(64)}).strict(),
 z.object({kind:z.literal('codex')}).strict(),
 z.object({kind:z.literal('api'),protocol:z.enum(['openai-responses','openai-chat','anthropic']),baseUrl:z.string().url(),model:z.string().trim().min(1).max(300),apiKey:z.string().trim().min(1).max(16000).regex(/^[^\x00-\x1f\x7f]+$/).optional()}).strict(),
]),name:z.string().trim().min(1).max(100).optional(),workspace:z.string().min(1).max(4000).optional(),channel:z.enum(['browser','feishu','wecom']).default('browser')}).strict()
type Check={id:string;status:'ok'|'required'|'pending';code:string;detail?:string}
interface Plan {id:string;revision:number;expiresAt:number;connection:{id:string;kind:string;label:string;model?:string};workspace:string;sourceId:string;channel:string;next:Config;keyName?:string;key?:string;credentials?:Record<string,string>;entry?:boolean;backend?:BackendDefinition;lastCheck?:{ok:boolean;checks:Check[];remoteVerified:boolean;preview:boolean}}
export class OnboardingError extends Error {constructor(readonly code:string,message:string,readonly status=400){super(message)}}
const inside=(root:string,path:string)=>{const r=relative(root,path);return !r||r!=='..'&&!r.startsWith('..'+sep)&&!isAbsolute(r)}
function canonical(path:string):string{const p=resolve(path);if(existsSync(p))return realpathSync(p);const parent=dirname(p);return parent===p?p:join(canonical(parent),basename(p))}
export function setupWorkspace(config:Config,input?:string){
 const workspace=canonical(input??join(config.stateDir,'workspace')),state=canonical(config.stateDir),defaultRoot=canonical(join(config.stateDir,'workspace'))
 if(input&&!isAbsolute(input))throw new OnboardingError('workspace_invalid','Choose a full folder path, or use the suggested folder.')
 if(inside(workspace,state)||inside(state,workspace)&&!inside(defaultRoot,workspace))throw new OnboardingError('workspace_private','Choose a dedicated folder rather than the host’s private settings folder.')
 if(existsSync(workspace)&&!statSync(workspace).isDirectory())throw new OnboardingError('workspace_invalid','The selected path is not a folder.')
 if(existsSync(workspace))try{accessSync(workspace,constants.R_OK|constants.X_OK)}catch{throw new OnboardingError('workspace_invalid','This folder cannot be read. Choose another folder.')}
 return workspace
}
const connectionLabel=(definition:BackendDefinition)=>definition.label??(definition.kind==='codex'?'Codex':definition.kind==='plugin'?definition.plugin:new URL(definition.baseUrl).hostname+' · '+definition.model)

/** A minimal first-run flow; machine details remain behind the advanced console. */
export class Onboarding {
 private plans=new Map<string,Plan>()
 constructor(private host:()=>Runtime,private preview=false){}
 info(){const host=this.host();return {completed:!!host.store.get('onboarding','current'),lastSetup:host.store.get('onboarding','current'),defaultWorkspace:resolve(host.config.stateDir,'workspace'),connections:Object.entries({codex:{kind:'codex' as const},...host.config.backends}).map(([id,d])=>({id,kind:d.kind,label:connectionLabel(d),...('model'in d?{model:d.model}:{})})),preview:this.preview}}
 private current(id:string){const plan=this.plans.get(id);if(!plan||plan.expiresAt<Date.now()){this.plans.delete(id);throw new OnboardingError('plan_expired','This setup draft expired. Review the choices again.')}if(this.host().settings.current().revision!==plan.revision)throw new OnboardingError('settings_conflict','Settings changed in another session. Review the latest settings.',409);return plan}
 private view(plan:Plan){return {id:plan.id,revision:plan.revision,expiresAt:plan.expiresAt,connection:plan.connection,workspace:plan.workspace,sourceId:plan.sourceId,channel:plan.channel,restartRequired:true,preview:this.preview}}
 connectionPlan(value:unknown){
  const input=onboardingPlanSchema.pick({revision:true,connection:true,name:true}).extend({select:z.boolean().default(true)}).strict().parse(value),view=this.plan({revision:input.revision,connection:input.connection,name:input.name}),plan=this.plans.get(view.id)!,existing=plan.next.sources.find(s=>s.kind==='local'&&s.id!==plan.sourceId)
  if(!existing){this.plans.delete(view.id);throw new OnboardingError('local_entry_missing','A local operator workspace is required for model setup.')}
  plan.next.sources=plan.next.sources.filter(s=>s.id!==plan.sourceId);plan.sourceId=existing.id;plan.workspace=existing.cwd;plan.entry=true
  if(!input.select){
   plan.next.execution=structuredClone(this.host().config.execution);plan.next.models=structuredClone(this.host().config.models)
   if(input.connection.kind==='codex'){
    const id='service-'+plan.id.slice(0,12),backend:BackendDefinition={kind:'codex',...(input.name?{label:input.name}:{})}
    plan.next.backends[id]=backend;plan.backend=backend;plan.connection={id,kind:'codex',label:input.name??'Codex'}
   }
  }
  return this.view(plan)
 }
 /** Entry setup adds a source while retaining the selected execution backend and all existing conversations. */
 sourcePlan(revision:number,source:Config['sources'][number],credentials:Record<string,string>={}){
  const host=this.host();if(revision!==host.settings.current().revision)throw new OnboardingError('settings_conflict','Settings changed. Refresh the entry setup.',409)
  if(host.config.sources.some(s=>s.id===source.id))throw new OnboardingError('source_conflict','This entry already exists. Use its settings instead of replacing it.',409)
  for(const [id,p]of this.plans)if(p.expiresAt<Date.now())this.plans.delete(id)
  if(this.plans.size>=20)throw new OnboardingError('too_many_plans','Close old setup drafts or try again later.',429)
  const next=configSchema.parse(host.config);next.sources.push(configSchema.shape.sources.element.parse(source))
  const definition=next.backends[next.execution.backend]??{kind:'codex' as const}
  const plan:Plan={id:randomUUID(),revision,expiresAt:Date.now()+600000,connection:{id:next.execution.backend,kind:definition.kind,label:connectionLabel(definition)},workspace:source.cwd,sourceId:source.id,channel:source.kind,next,credentials,entry:true}
  this.plans.set(plan.id,plan);return this.view(plan)
 }
 plan(value:unknown){
  const input=onboardingPlanSchema.parse(value),host=this.host();if(input.revision!==host.settings.current().revision)throw new OnboardingError('settings_conflict','Settings changed in another session. Review the latest settings.',409)
  for(const [id,p]of this.plans)if(p.expiresAt<Date.now())this.plans.delete(id)
  if(this.plans.size>=20)throw new OnboardingError('too_many_plans','Close old setup drafts or try again later.',429)
  const id=randomUUID(),sourceId='assistant-'+id.slice(0,8),next=configSchema.parse(host.config)
  const workspace=setupWorkspace(next,input.workspace)
  let backendId:string,backend:BackendDefinition|undefined,keyName:string|undefined,key:string|undefined
  if(input.connection.kind==='api'){
   backendId='assistant-'+id.slice(0,12);key=input.connection.apiKey;keyName=key?'AGENTHUB_SETUP_'+id.replaceAll('-','').toUpperCase():undefined
   backend=backendDefinition.parse({kind:input.connection.protocol,...(input.name?{label:input.name}:{}),baseUrl:input.connection.baseUrl,model:input.connection.model,...(keyName?{apiKeyEnv:keyName}:{})});next.backends[backendId]=backend
  }else{
   backendId=input.connection.kind==='codex'?'codex':input.connection.id
   if(backendId!=='codex'&&!next.backends[backendId])throw new OnboardingError('connection_missing','Choose an available connection.')
  }
  const definition=next.backends[backendId]??{kind:'codex'}
  next.execution={backend:backendId,roles:{}};next.models={}
  next.sources.push(configSchema.shape.sources.element.parse({id:sourceId,kind:'local',cwd:workspace,allowedActors:['operator'],sandbox:'read-only',workspace:{mode:'source'}}))
  const plan:Plan={id,revision:input.revision,expiresAt:Date.now()+600000,connection:{id:backendId,kind:definition.kind,label:connectionLabel(definition),...('model'in definition?{model:definition.model}:{})},workspace,sourceId,channel:input.channel,next,keyName,key,backend}
  this.plans.set(id,plan);return this.view(plan)
 }
 async check(id:string){
  const plan=this.current(id),host=this.host(),checks:Check[]=[]
  if(this.preview){plan.lastCheck={ok:false,checks:[{id:'connection',status:'pending',code:'preview_not_connected'}],remoteVerified:false,preview:true};return plan.lastCheck}
  const definition=plan.next.backends[plan.connection.id]??{kind:'codex' as const};let remoteVerified=false
  if(definition.kind==='codex'){
   const command=definition.command??host.config.codex
   for(const [name,args]of [['installation',['--version']],['sign-in',['login','status']]] as const){try{await exec(command,[...(definition.args??[]),...args],{env:cliEnvironment(definition.env),timeout:10000,maxBuffer:64000,encoding:'utf8'});checks.push({id:name,status:'ok',code:name==='installation'?'codex_installed':'codex_signed_in'})}catch{checks.push({id:name,status:'required',code:name==='installation'?'codex_not_installed':'codex_sign_in_required'})}}
  }else if(definition.kind==='plugin'){
   try{const result=await new BackendRegistry(plan.next,host.store).probe(plan.connection.id);checks.push({id:'connection',status:result.available&&result.authenticated===true?'ok':'required',code:result.available&&result.authenticated===true?'backend_authenticated':'backend_sign_in_required'})}catch{checks.push({id:'connection',status:'required',code:'backend_unavailable'})}
  }else{
   try{
    const records=new Map<string,unknown>(),memory={get:<T>(kind:string,key:string)=>records.get(kind+':'+key) as T|undefined,put:(kind:string,key:string,value:unknown)=>{records.set(kind+':'+key,value)}}
    const model=new ApiModel(plan.connection.id,{...definition,maxSteps:2,maxToolCalls:1,maxOutputTokens:64,requestTimeoutMs:15000},memory,30000,()=>definition.subscription?host.subscriptions.credential(definition.subscription.account):plan.key??(definition.apiKeyEnv?process.env[definition.apiKeyEnv]:undefined))
    await model.run({cwd:host.config.stateDir,instructions:'Check this text connection. Do not use tools. Return {"ok":true}.',input:'Return {"ok":true}.',schema:{type:'object',properties:{ok:{const:true}},required:['ok'],additionalProperties:false},ephemeral:true,tools:[]})
    remoteVerified=true;checks.push({id:'connection',status:'ok',code:'model_replied'})
   }catch(error){const text=String(error);checks.push({id:'connection',status:'required',code:/Subscription sign-in/.test(text)?'subscription_sign_in_required':/401|403/.test(text)?'api_key_rejected':/environment variable/.test(text)?'api_key_required':/schema|budget|output/.test(text)?'model_reply_invalid':'connection_failed'})}
  }
  plan.lastCheck={ok:checks.every(c=>c.status==='ok'),checks,remoteVerified,preview:false};return plan.lastCheck
 }
 async apply(id:string,rebuild:(config:Config)=>Promise<void>){
  const replay=this.host().store.get<any>('onboarding-deployment',id)?.receipt
  if(replay)return {...replay,replayed:true,paused:this.host().status().paused,ready:replay.ready&&this.host().sources.get(replay.sourceId)?.config.enabled===true}
  const plan=this.current(id),host=this.host(),previous=host.settings.current(),previousSetup=host.store.get('onboarding','current'),connections=managedConnections(host.config.stateDir),secrets=managedSecrets(host.config.stateDir)
  let paused:boolean
  try{paused=await host.pauseForConfiguration()}catch{throw new OnboardingError('configuration_busy','Work is still running. Finish or stop it before applying setup.',409)}
  const additions={...plan.credentials,...(plan.keyName&&plan.key?{[plan.keyName]:plan.key}:{})},env=Object.fromEntries(Object.keys(additions).map(key=>[key,process.env[key]]))
  const receipt={applied:true,revision:previous.revision+1,sourceId:plan.sourceId,workspace:plan.workspace,connection:plan.connection,preview:this.preview,ready:!this.preview&&plan.lastCheck?.ok===true,paused,checks:plan.lastCheck?.checks??[]}
  let files:ReturnType<typeof prepareManagedConfig>|undefined,committed=false
  try{
   if(plan.backend)connections.backends[plan.connection.id]=plan.backend
   if(!connections.sources.some(s=>s.id===plan.sourceId))connections.sources.push(plan.next.sources.find(s=>s.id===plan.sourceId)!)
   Object.assign(secrets,additions)
   mkdirSync(plan.workspace,{recursive:true,mode:0o700})
   files=prepareManagedConfig(host.config.stateDir,plan.id,connections,secrets)
   host.store.atomic(()=>{
    if(host.settings.current().revision!==plan.revision)throw new OnboardingError('settings_conflict','Settings changed while applying setup. Review them again.',409)
    host.store.put('settings-history',String(previous.revision),previous)
    host.store.put('settings','current',{revision:previous.revision+1,at:new Date().toISOString(),config:plan.next})
    host.store.put('onboarding-deployment',plan.id,{revision:previous.revision+1,receipt})
    if(!plan.entry)host.store.put('onboarding','current',{at:Date.now(),sourceId:plan.sourceId,workspace:plan.workspace,connection:plan.connection,channel:plan.channel,checked:plan.lastCheck?.ok===true,remoteVerified:plan.lastCheck?.remoteVerified===true})
   });committed=true
   await rebuild(plan.next);this.host().pause(paused);files.finish();this.plans.delete(id);plan.key=undefined;plan.credentials=undefined
   return receipt
  }catch(error){
   files?.rollback();for(const [key,value]of Object.entries(env)){if(value===undefined)delete process.env[key];else process.env[key]=value}
   if(committed){
    const store=new Store(join(host.config.stateDir,'state.sqlite'))
    try{store.atomic(()=>{store.put('settings','current',previous);store.db.prepare("DELETE FROM records WHERE kind='settings-history' AND id=?").run(String(previous.revision));store.db.prepare("DELETE FROM records WHERE kind='onboarding-deployment' AND id=?").run(plan.id);if(previousSetup)store.put('onboarding','current',previousSetup);else store.db.prepare("DELETE FROM records WHERE kind='onboarding' AND id='current'").run()})}finally{store.close()}
    try{await rebuild(previous.config);this.host().pause(paused)}catch{throw new OnboardingError('setup_recovery_required','Setup was restored, but the host could not restart. Restart it before continuing.',503)}
   }else host.pause(paused)
   if(error instanceof OnboardingError)throw error
   throw new OnboardingError('setup_apply_failed','Setup could not be applied. Previous settings were restored.',503)
  }
 }
}
