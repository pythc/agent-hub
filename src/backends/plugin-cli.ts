import {readFileSync,writeFileSync,existsSync} from 'node:fs'
import {resolve} from 'node:path'
import {loadConfig} from '../config.ts'
import {BackendRegistry} from './registry.ts'
import {buildBackendPackage,readBackendPackage,installBackendPackage} from './plugin-package.ts'

/** Staging creates a new config; activation and drain checks belong to Runtime startup. */
export async function backendPluginCommand(args:string[]){
 const [action,...rest]=args
 if(action==='pack'){
  const [entry,manifest,out]=rest;if(!entry||!manifest||!out)throw Error('Use backend-plugins pack <entry.ts> <manifest.json> <new-package-directory>')
  return buildBackendPackage(entry,JSON.parse(readFileSync(manifest,'utf8')),out)
 }
 if(action==='inspect'){
  if(!rest[0])throw Error('Use backend-plugins inspect <package-directory>')
  return readBackendPackage(rest[0])
 }
 if(action==='probe'){
  const [file,id]=rest;if(!file||!id)throw Error('Use backend-plugins probe <config.json> <backend-id>')
  return new BackendRegistry(loadConfig(file),{get:()=>undefined,put:()=>{}}).probe(id)
 }
 if(action==='stage'){
  const [file,directory,digest,out]=rest
  if(!file||!directory||!digest||!out)throw Error('Use backend-plugins stage <config.json> <package-directory> <reviewed-digest> <new-config.json>')
  if(existsSync(out))throw Error('Staging output must be a new file')
  const config=loadConfig(file),pkg=installBackendPackage(directory,config.stateDir,digest)
  if(!Object.values(config.backends).some(d=>d.kind==='plugin'&&d.plugin===pkg.manifest.id))throw Error('Configure a backend using this plugin first')
  config.backendPlugins=config.backendPlugins.filter(p=>readBackendPackage(p.directory,p.digest).manifest.id!==pkg.manifest.id)
  config.backendPlugins.push({directory:pkg.directory,digest:pkg.digest})
  writeFileSync(resolve(out),JSON.stringify(config,null,2)+'\n',{mode:0o600,flag:'wx'})
  return {staged:resolve(out),plugin:pkg.manifest.id,digest:pkg.digest,activation:'controlled_restart_required',rollback:'Stage the previous package against the latest config. Keep the current task database.'}
 }
 throw Error('Use backend-plugins pack, inspect, stage or probe')
}
