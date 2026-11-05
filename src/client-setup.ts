import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {homedir} from 'node:os'
import {join,resolve} from 'node:path'
import {existsSync,lstatSync,readFileSync,writeFileSync,mkdirSync,statSync} from 'node:fs'
import {randomUUID,createHash} from 'node:crypto'
import {parse,type ParseError} from 'jsonc-parser'
import {isDeepStrictEqual} from 'node:util'
import {clientConfig,clientInfo,installClient,type ClientOptions} from './clients.ts'

const exec=promisify(execFile),hash=(value:string)=>createHash('sha256').update(value).digest('hex')
type Runner=(binary:string,args:string[])=>Promise<string>
const run:Runner=async(binary,args)=>(await exec(binary,args,{encoding:'utf8',timeout:15000,maxBuffer:1000000})).stdout
const bridge=(command:unknown,args:unknown)=>({command,args:Array.isArray(args)?args.filter((_value,index)=>args[index-1]!=='--client'&&args[index]!=='--client'):args})
export function clientPath(options:ClientOptions){return options.client==='codex'?join(options.home??process.env.CODEX_HOME??join(homedir(),'.codex'),'config.toml'):join(options.home??homedir(),clientInfo[options.client].file)}
export async function inspectClient(options:ClientOptions,binary='codex',runner:Runner=run){
 const c=clientConfig(options),path=clientPath(options)
 if(options.client==='generic')return {installed:false,available:true,canInstall:false,reason:'manual_client',configPath:path}
 if(options.client==='codex'){
  try{const list=JSON.parse(await runner(binary,['mcp','list','--json'])),existing=list.find((item:any)=>item.name===c.name)
   const matches=!!existing&&isDeepStrictEqual(bridge(existing.transport?.command,existing.transport?.args),bridge(c.server.command,c.server.args))
   return {installed:matches&&existing.enabled!==false,available:true,canInstall:true,conflict:!!existing&&(!matches||existing.enabled===false),configPath:path}
  }catch{return {installed:false,available:false,canInstall:false,reason:'codex_unavailable',configPath:path}}
 }
 if(process.platform!=='darwin'&&!options.home)return {installed:false,available:false,canInstall:false,reason:'choose_official_config',configPath:path}
 try{
  if(existsSync(path)){
   if(!lstatSync(path).isFile()||lstatSync(path).isSymbolicLink())throw Error('unsafe')
   const errors:ParseError[]=[],config=parse(readFileSync(path,'utf8'),errors,{allowTrailingComma:true})
   if(errors.length||!config||typeof config!=='object'||Array.isArray(config))throw Error('invalid')
   const existing=config[c.info.root]?.[c.name]
   const definition=c.definition as any,matches=existing&&(options.client==='opencode'?isDeepStrictEqual(bridge(existing.command?.[0],existing.command?.slice(1)),bridge(definition.command[0],definition.command.slice(1))):isDeepStrictEqual(bridge(existing.command,existing.args),bridge(c.server.command,c.server.args)))
   const enabled=existing?.disabled!==true&&existing?.enabled!==false
   return {installed:!!matches&&enabled,available:true,canInstall:true,conflict:existing!==undefined&&(!matches||!enabled),configPath:path}
  }
  return {installed:false,available:false,canInstall:true,reason:'client_not_detected',configPath:path}
 }catch{return {installed:false,available:true,canInstall:false,reason:'configuration_needs_review',configPath:path}}
}
/** Codex owns TOML edits. Do not implement an independent TOML rewriter. */
export async function installEntryClient(options:ClientOptions&{backupDir:string},binary='codex',runner:Runner=run){
 if(options.client!=='codex')return installClient(options)
 const c=clientConfig(options),inspection=await inspectClient(options,binary,runner)
 if(!inspection.available)throw Error('codex_unavailable')
 if(inspection.conflict)throw Error('client_conflict')
 if(inspection.installed)return {changed:false,path:inspection.configPath,name:c.name}
 const path=inspection.configPath,existed=existsSync(path)
 if(existed&&(!lstatSync(path).isFile()||lstatSync(path).isSymbolicLink()))throw Error('configuration_needs_review')
 const before=existed?readFileSync(path,'utf8'):'',mode=existed?statSync(path).mode&0o777:0o600,id=randomUUID()
 mkdirSync(options.backupDir,{recursive:true,mode:0o700})
 writeFileSync(join(options.backupDir,id+'.before'),before,{mode:0o600,flag:'wx'})
 // The recovery record exists even if the official command fails or this process exits.
 const record={id,path,before:hash(before),after:'pending',existed,mode,at:new Date().toISOString()}
 writeFileSync(join(options.backupDir,id+'.json'),JSON.stringify(record),{mode:0o600,flag:'wx'})
 try{await runner(binary,['mcp','add',c.name,'--',c.server.command,...c.server.args])}catch{throw Error('codex_install_failed; inspect the private client backup before retrying')}
 const after=readFileSync(path,'utf8');writeFileSync(join(options.backupDir,id+'.json'),JSON.stringify({...record,after:hash(after)}),{mode:0o600})
 const verified=await inspectClient(options,binary,runner)
 if(!verified.installed)throw Error('codex_install_unverified')
 return {changed:true,path,name:c.name,backupId:id,backupDir:resolve(options.backupDir)}
}
