import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {randomUUID} from 'node:crypto'
import type {Runtime} from './runtime.ts'
import {BackendRegistry} from './backends/registry.ts'
import {existsSync,accessSync,constants} from 'node:fs'
import {resolve,delimiter} from 'node:path'
const exec=promisify(execFile)
export class Setup {
 constructor(private host:Runtime){}
 async check(){
  const checks:any[]=[]
  const check=async(id:string,fn:()=>Promise<unknown>,repair:string)=>{try{checks.push({id,status:'ok',result:await fn()})}catch(error){checks.push({id,status:'required',error:String(error).slice(0,300),repair})}}
  await check('node',async()=>{const [major,minor]=process.versions.node.split('.').map(Number);if(major!<22||major===22&&minor!<19)throw Error('Node >=22.19 required');return process.versions.node},'Use Node 22.19 or newer')
  const registry=this.host.model instanceof BackendRegistry?this.host.model:undefined
  const ids=registry?[...new Set(['router','worker','subagent'].map(role=>registry.selected(role as 'router')))]:['codex']
  for(const id of ids){
   const d=registry?.definition(id)??{kind:'codex' as const},binary=d.kind==='codex'?d.command??this.host.config.codex:undefined
   if(binary){
    await check(id,async()=>(await exec(binary,['--version'],{encoding:'utf8',timeout:10000})).stdout.trim(),'Configure an installed Codex CLI binary')
    await check(id+'-auth',async()=>{const r=await exec(binary,['login','status'],{encoding:'utf8',timeout:10000});return (r.stdout+r.stderr).trim()},'Run codex login with the configured CLI')
   }else if(d.kind!=='codex')await check('backend:'+id,async()=>{if(d.apiKeyEnv&&!process.env[d.apiKeyEnv]?.trim())throw Error('Missing environment variable '+d.apiKeyEnv);return {kind:d.kind,model:d.model,credential:d.apiKeyEnv?'present':'not-required',remoteVerified:false}},'Set the configured API credential environment variable; secrets are never stored in settings')
  }
  await check('command-sandbox',async()=>{
   const driver=this.host.config.work.sandboxDriver
   if(driver==='disabled')return {driver,commandsEnabled:false}
   if(driver==='seatbelt'&&process.platform!=='darwin'||driver==='bubblewrap'&&process.platform!=='linux')throw Error('Sandbox is unavailable on this platform')
   const command=driver==='seatbelt'?'/usr/bin/sandbox-exec':driver==='bubblewrap'?'bwrap':this.host.config.codex
   const path=command.includes('/')?command:(process.env.PATH??'').split(delimiter).map(p=>resolve(p,command)).find(existsSync)
   if(!path)throw Error('Configured sandbox executable is missing');accessSync(path,constants.X_OK);return {driver,commandsEnabled:true}
  },'Install the selected sandbox, or explicitly disable shell commands. No unsandboxed fallback is used.')
  for(const source of this.host.sources.values()){
   if(!source.config.enabled)continue
   if(source.identity)await check('identity:'+source.config.id,async()=>{const identity=await source.identity!();if(!identity.id)throw Error('Source identity is missing');if(source.config.feishu?.mentionId&&identity.id!==source.config.feishu.mentionId)throw Error('Bot identity does not match mentionId');return identity},'Check the configured source CLI and account; Feishu always uses bot identity')
   if(!source.config.allowedActors.length)checks.push({id:'admission:'+source.config.id,status:'required',repair:'Add allowed actors or configure a deliberate admission policy'})
   if(source.config.feishu&&(source.config.feishu.otherChats==='mentions'||source.config.feishu.directMessages)&&!source.config.feishu.liveEvents)checks.push({id:'discovery:'+source.config.id,status:'required',repair:'Enable Feishu liveEvents for mentions from other chats'})
  }
  const result={at:Date.now(),status:checks.some(c=>c.status==='required')?'setup-required':'ok',checks}
  this.host.store.put('setup','current',result);return result
 }
 async previewMembers(sourceId:string,scope?:string){
  const source=this.host.sources.get(sourceId);if(!source?.members)throw Error('Source has no member directory')
  const members=await source.members(scope),ids=[...new Set(members.filter(m=>!m.bot).map(m=>m.id))].sort()
  if(!ids.length)throw Error('Empty member directory; allowed list was retained')
  const snapshot={id:randomUUID(),source:sourceId,scope,members,ids,revision:this.host.settings.current().revision,expires:Date.now()+600000}
  this.host.store.put('member-preview',snapshot.id,snapshot);return snapshot
 }
 applyMembers(id:string){
  const preview=this.host.store.get<any>('member-preview',id)
  if(!preview||preview.expires<Date.now())throw Error('Unknown or expired member preview')
  const source=this.host.sources.get(preview.source);if(!source)throw Error('Source removed')
  if(this.host.settings.current().revision!==preview.revision)throw Error('Settings conflict. Preview members again.')
  if(JSON.stringify([...source.config.allowedActors].sort())===JSON.stringify(preview.ids))return this.host.settings.current()
  const result=this.host.updateSettings(preview.revision,{sources:this.host.config.sources.map(s=>s.id===preview.source?{...s,allowedActors:preview.ids}:s)})
  this.host.store.audit({type:'members.synced',source:preview.source,preview:id,count:preview.ids.length,revision:result.revision})
  return result
 }
}
