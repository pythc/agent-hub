import {join,isAbsolute} from 'node:path'
import {Ajv2020} from 'ajv/dist/2020.js'
import {backendManifestSchema,type BackendManifest} from './plugin-contract.ts'
import {readArtifact,buildArtifact,installArtifact,type PluginArtifact} from '../plugin-artifact.ts'
import type {Config} from '../config.ts'
import type {Store} from '../store.ts'
import {stableDigest} from '../sources.ts'
export type BackendPackage=PluginArtifact<BackendManifest>
export const readBackendPackage=(directory:string,digest?:string)=>readArtifact(directory,backendManifestSchema,digest)
export const buildBackendPackage=(entry:string,manifest:Record<string,unknown>,destination:string)=>buildArtifact(entry,{...manifest,apiVersion:1,type:'execution-backend'},destination,backendManifestSchema)
export const backendObjects=(stateDir:string)=>join(stateDir,'plugins','backends','objects')
export const installBackendPackage=(directory:string,stateDir:string,digest:string)=>installArtifact(directory,backendObjects(stateDir),digest,backendManifestSchema)
export function backendPackages(config:Pick<Config,'backendPlugins'>){
 const packages=new Map<string,BackendPackage>()
 for(const ref of config.backendPlugins){
  if(!isAbsolute(ref.directory))throw Error('Backend plugin directory must be absolute; loadConfig resolves configuration paths')
  const pkg=readBackendPackage(ref.directory,ref.digest)
  if(packages.has(pkg.manifest.id))throw Error('Duplicate execution backend plugin')
  packages.set(pkg.manifest.id,pkg)
 }
 return packages
}
export function validatePluginValue(schema:Record<string,unknown>,value:unknown,label:string){
 const validate=new Ajv2020({strict:false,validateFormats:false}).compile(schema)
 if(!validate(value))throw Error('Invalid execution backend '+label)
}
/** Startup transaction. Code revisions never restore a task DB or silently migrate native sessions. */
export function activateBackendPackages(store:Store,config:Config){
 const packages=backendPackages(config)
 for(const backend of Object.values(config.backends))if(backend.kind==='plugin'&&!packages.has(backend.plugin))throw Error('Unknown execution backend plugin: '+backend.plugin)
 const unfinished=()=>store.tickets.open().length>0||store.list<any>('router-goal').some(g=>!['completed','cancelled'].includes(g.state))||store.deliveries().some(d=>['pending','sending','uncertain','held'].includes(d.status))||store.list<any>('tool-receipt').some(r=>['running','uncertain'].includes(r.state))||store.list<any>('backend-plugin-tool').some(r=>r.state==='running')||store.list<any>('backend-plugin-thread').some(r=>r.state==='running')||store.db.prepare("SELECT 1 FROM jobs WHERE state IN ('pending','running') LIMIT 1").get()
 for(const [id,definition] of Object.entries(config.backends))if(definition.kind==='plugin'){
  const {label,model,defaults,...deployment}=definition,identity=stableDigest(deployment),old=store.get<{identity:string}>('backend-plugin-deployment',id)
  if(old&&old.identity!==identity&&unfinished())throw Error('Drain tasks before changing execution backend credentials or filesystem grants')
  store.put('backend-plugin-deployment',id,{id,identity})
 }
 for(const [id,pkg] of packages){
  const old=store.get<any>('backend-plugin-installation',id)
  if(old&&old.digest!==pkg.digest){
   if(old.stateVersion!==pkg.manifest.stateVersion)throw Error('Execution backend state protocol changed; explicit migration required')
   if(unfinished())throw Error('Drain tasks and reconcile effects before upgrading or rolling back an execution backend')
  }
  installBackendPackage(pkg.directory,config.stateDir,pkg.digest)
  if(!old||old.digest!==pkg.digest)store.put('backend-plugin-installation',id,{id,digest:pkg.digest,version:pkg.manifest.version,stateVersion:pkg.manifest.stateVersion,revision:(old?.revision??0)+1,previousDigest:old?.digest})
 }
 for(const old of store.list<any>('backend-plugin-installation'))if(!packages.has(old.id))throw Error('Installed execution backend cannot be silently removed; retain its package for existing histories')
}
