import {readFileSync,writeFileSync,linkSync,rmSync,existsSync} from 'node:fs'
import {resolve,dirname,join} from 'node:path'
import {randomUUID} from 'node:crypto'
import {buildPluginPackage,readPluginPackage,installPluginPackage} from './plugin-package.ts'
import {loadConfig,configSchema} from './config.ts'
import {SourceRegistry} from './source-plugins.ts'
import {ProcessSource} from './plugin-process.ts'
import {buildViewPackage,readViewPackage,installViewPackage} from './workspace-view-package.ts'
function isView(directory:string){return JSON.parse(readFileSync(join(directory,'manifest.json'),'utf8')).category==='workspace-view'}
function stageConfig(output:string,config:unknown){
  const target=resolve(output),temp=join(dirname(target),'.plugin-config-'+randomUUID())
  try{
    writeFileSync(temp,JSON.stringify(config,null,2)+'\n',{mode:0o600,flag:'wx'})
    // Publish only complete bytes, and never replace a concurrently-created configuration.
    linkSync(temp,target)
  }finally{rmSync(temp,{force:true})}
}
/** Package operations never import developer code into the host. Config activation occurs on a controlled restart. */
export async function pluginCommand(args:string[]){
  const [action,...rest]=args
  if(action==='pack'){
    const [entry,manifest,out]=rest;if(!entry||!manifest||!out)throw Error('Use plugins pack <entry.ts> <manifest.json> <new-output-directory>')
    const input=JSON.parse(readFileSync(manifest,'utf8'))
    const pkg=await (input.category==='workspace-view'?buildViewPackage:buildPluginPackage)(entry,input,out)
    return {directory:pkg.directory,digest:pkg.digest,manifest:pkg.manifest}
  }
  if(action==='inspect'){
    if(!rest[0])throw Error('Use plugins inspect <package-directory>')
    const pkg=isView(rest[0])?readViewPackage(rest[0]):readPluginPackage(rest[0])
    return {directory:pkg.directory,digest:pkg.digest,manifest:pkg.manifest}
  }
  if(action==='probe'){
    const [file,id]=rest;if(!file||!id)throw Error('Use plugins probe <config.json> <source-id>')
    const config=loadConfig(file),registry=await SourceRegistry.load(config),source=config.sources.find(s=>s.id===id)
    if(!source)throw Error('Unknown connection')
    const adapter=registry.create(source)
    if(!(adapter instanceof ProcessSource))throw Error('Probe requires a v2 plugin package')
    try{return await adapter.probe()}finally{await adapter.close()}
  }
  if(action==='stage'){
    const [file,directory,expected,output]=rest
    if(!file||!directory||!expected||!output)throw Error('Use plugins stage <config.json> <package-directory> <reviewed-digest> <new-config.json>')
    if(existsSync(output))throw Error('Staging output must be a new file')
    const config=loadConfig(file)
    if(isView(directory)){
      const pkg=installViewPackage(directory,config.stateDir,expected)
      config.viewPlugins=config.viewPlugins.filter(p=>p.id!==pkg.manifest.id)
      config.viewPlugins.push({id:pkg.manifest.id,directory:pkg.directory,digest:pkg.digest,enabled:true})
      configSchema.parse(config)
      stageConfig(output,config)
      return {staged:resolve(output),plugin:pkg.manifest.id,version:pkg.manifest.version,digest:pkg.digest,activation:'controlled_restart_required',rollback:'Stage the previous digest against the latest configuration; task state is never restored.'}
    }
    const pkg=installPluginPackage(directory,config.stateDir,expected)
    if(!config.sources.some(s=>s.kind===pkg.manifest.kind))throw Error('Configure a source connection of this package kind first')
    const previous=config.sourcePlugins.filter(p=>'directory'in p&&readPluginPackage(p.directory,p.digest).manifest.kind===pkg.manifest.kind)
    config.sourcePlugins=config.sourcePlugins.filter(p=>!previous.includes(p))
    config.sourcePlugins.push({directory:pkg.directory,digest:pkg.digest,replaceBuiltin:['local','webhook','github','wecom','feishu'].includes(pkg.manifest.kind),readPaths:previous.flatMap(p=>'directory'in p?p.readPaths:[])})
    stageConfig(output,config)
    return {staged:resolve(output),plugin:pkg.manifest.id,version:pkg.manifest.version,digest:pkg.digest,activation:'controlled_restart_required',rollback:'Stage the previous immutable package digest against the latest configuration; never restore task state.'}
  }
  throw Error('Use plugins pack, inspect, probe or stage')
}
