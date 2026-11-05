import {homedir} from 'node:os'
import {join,resolve} from 'node:path'
import {existsSync,mkdirSync,readFileSync,writeFileSync,lstatSync} from 'node:fs'
import {configSchema,loadConfig} from './config.ts'
import {atomicPrivateFile} from './managed-config.ts'

/** A first deployment needs no handwritten config, model protocol, source ID or token. */
export function preparePersonalSetup(directory=join(homedir(),'.agent-hub')){
 const root=resolve(directory),file=join(root,'config.json')
 if(existsSync(file)){
  if(!lstatSync(file).isFile()||lstatSync(file).isSymbolicLink())throw Error('Personal setup config must be a regular file')
  return {file,created:false,config:loadConfig(file)}
 }
 if(existsSync(root)&&lstatSync(root).isSymbolicLink())throw Error('Personal setup directory must not be a symbolic link')
 const stateDir=join(root,'state'),cwd=join(stateDir,'workspace')
 mkdirSync(cwd,{recursive:true,mode:0o700})
 const config=configSchema.parse({stateDir,port:0,work:{sandboxDriver:process.platform==='darwin'?'seatbelt':process.platform==='linux'?'bubblewrap':'disabled',network:false},sources:[{id:'local',kind:'local',cwd,allowedActors:['operator'],sandbox:'read-only',workspace:{mode:'source'}}]})
 writeFileSync(file,JSON.stringify(config,null,2)+'\n',{mode:0o600,flag:'wx'})
 return {file,created:true,config}
}
export function rememberPersonalPort(file:string,port:number){
 const saved=JSON.parse(readFileSync(file,'utf8'))
 if(saved.port!==0)return
 // Only the initial generated file is changed. Subsequent edits remain the deployer's own.
 atomicPrivateFile(file,JSON.stringify({...saved,port},null,2)+'\n')
}
