import {randomUUID} from 'node:crypto'
import {readFileSync,writeFileSync,mkdirSync,existsSync,realpathSync,statSync,renameSync,rmSync} from 'node:fs'
import {z} from 'zod'
import {join} from 'node:path'
import {readArtifact,buildArtifact} from './plugin-artifact.ts'
import type {Store} from './store.ts'
import type {Config} from './config.ts'

const identifier=z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/)
export const pluginManifestSchema=z.object({
  apiVersion:z.literal(2),id:identifier,kind:identifier,label:z.string().min(1).max(100),
  version:z.string().regex(/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/),
  stateVersion:z.number().int().min(1),entry:z.literal('plugin.mjs'),
  codeSha256:z.string().regex(/^[a-f0-9]{64}$/),
  configSchema:z.record(z.string(),z.unknown()),
  scopesPath:z.string().regex(/^\/(?:[a-zA-Z][a-zA-Z0-9_-]*\/?)+$/),
  methods:z.array(z.enum(['poll','start','close','identity','members','read','context','deliver','probe','invoke','repositoryPull','mergeSnapshot','reviewGraph','resolveReview','draft','mergeIdentity','merge'])),
  threadSeparator:z.enum([':','#']).optional(),
  observedPath:z.string().regex(/^\/(?:[a-zA-Z][a-zA-Z0-9_-]*\/?)+$/).optional(),
  repository:z.object({idPath:z.string().regex(/^\/(?:[a-zA-Z][a-zA-Z0-9_-]*\/?)+$/),remoteTemplates:z.array(z.string().min(1).max(500).refine(s=>s.split('{repository}').length===2&&!/[\r\n]/.test(s),'One repository placeholder is required')).min(1).max(10),pushCredentialPath:z.string().regex(/^\/(?:[a-zA-Z][a-zA-Z0-9_-]*\/?)+$/),pushUsername:z.string().regex(/^[a-zA-Z0-9_-]+$/).max(100)}).strict().optional(),
  commandPath:z.string().regex(/^\/(?:[a-zA-Z][a-zA-Z0-9_-]*\/?)+$/).optional(),
  cursorEncoding:z.enum(['iso','unix-seconds']).default('iso'),
  cursorMode:z.enum(['scope','source','none']).default('none'),
  stateKinds:z.array(identifier).max(30).default([]),
  credentials:z.record(z.string().regex(/^[A-Z][A-Z0-9_]*$/),z.string().regex(/^\/(?:[a-zA-Z][a-zA-Z0-9_-]*\/?)+$/)).default({}),
  network:z.boolean().default(false),
  tools:z.array(z.object({name:identifier,description:z.string().min(1).max(2000),resource:identifier,inputSchema:z.record(z.string(),z.unknown())}).strict()).max(100).default([]),
  setup:z.object({description:z.string().max(4000),fields:z.array(z.object({name:identifier,label:z.string(),secret:z.boolean().default(false),required:z.boolean().default(false)}).strict()).max(30)}).strict().optional(),
}).strict()
export type PluginManifest=z.infer<typeof pluginManifestSchema>
export interface PluginPackage {directory:string;manifest:PluginManifest;digest:string}
export function pointer(value:unknown,path:string):unknown {
  return path.slice(1).split('/').reduce((v:any,k)=>v&&Object.hasOwn(v,k)?v[k]:undefined,value)
}
/** Source packages share immutable storage with other categories, not execution authority. */
export function readPluginPackage(directory:string,expectedDigest?:string):PluginPackage{return readArtifact(directory,pluginManifestSchema,expectedDigest)}
export async function buildPluginPackage(entry:string,manifest:Omit<PluginManifest,'codeSha256'|'entry'|'apiVersion'>,destination:string){
  return buildArtifact(entry,{...manifest,apiVersion:2},destination,pluginManifestSchema)
}
export function installPluginPackage(directory:string,stateDir:string,expectedDigest:string){
  const pkg=readPluginPackage(directory,expectedDigest),objects=join(stateDir,'plugins','objects'),target=join(objects,pkg.digest)
  mkdirSync(objects,{recursive:true,mode:0o700})
  if(existsSync(target))return readPluginPackage(target,pkg.digest)
  const temp=join(objects,'.install-'+process.pid+'-'+randomUUID())
  mkdirSync(temp,{mode:0o700})
  try{
    for(const name of ['manifest.json','plugin.mjs'])writeFileSync(join(temp,name),readFileSync(join(pkg.directory,name)),{mode:0o600,flag:'wx'})
    const license=join(pkg.directory,'LICENSE');if(existsSync(license)&&realpathSync(license)===license&&statSync(license).isFile()&&statSync(license).size<=1000000)writeFileSync(join(temp,'LICENSE'),readFileSync(license),{mode:0o600,flag:'wx'})
    readPluginPackage(temp,pkg.digest);renameSync(temp,target)
  }finally{if(existsSync(temp))rmSync(temp,{recursive:true})}
  return readPluginPackage(target,pkg.digest)
}
/** Never roll back task state or an uncertain external effect with plugin code. */
export function activatePluginPackages(store:Store,config:Config,packages:PluginPackage[],previous?:Config){
  store.atomic(()=>{
    for(const old of store.list<any>('plugin-installation'))if(!config.sources.some(s=>s.id===old.sourceId))throw Error('Installed plugin source must be disabled, not silently removed')
    const unfinished=()=>store.tickets.open().length>0||store.list<any>('router-goal').some(g=>!['completed','cancelled'].includes(g.state))||store.deliveries().some(d=>['pending','sending','uncertain','held'].includes(d.status))||store.list<any>('tool-receipt').some(r=>['running','uncertain'].includes(r.state))||store.list<any>('pr-delivery').some(r=>['pushing','creating','uncertain'].includes(r.phase))||store.list<any>('merge-attempt').some(r=>['submitting','uncertain'].includes(r.phase))||store.list<any>('review-action').some(r=>r.phase==='pending')||store.db.prepare("SELECT 1 FROM jobs WHERE state IN ('pending','running') LIMIT 1").get()
    for(const source of config.sources){
      const pkg=packages.find(p=>p.manifest.kind===source.kind),old=store.get<any>('plugin-installation',source.id)
      if(!pkg){if(old)throw Error('Installed plugin source cannot silently revert to a legacy adapter');continue}
      const current={sourceId:source.id,pluginId:pkg.manifest.id,version:pkg.manifest.version,digest:pkg.digest,stateVersion:pkg.manifest.stateVersion}
      const changed=old?old.digest!==pkg.digest:previous?.sources.some(s=>s.id===source.id)
      if(changed){
        if(old&&(old.pluginId!==current.pluginId||old.stateVersion!==current.stateVersion))throw Error('Plugin state protocol changed; explicit migration required')
        // Cross-source goals and granted tools can retain this package too. Require a quiescent host.
        if(unfinished())throw Error('Drain tasks, goals and jobs and reconcile external effects before changing plugin version')
      }
      if(!old||old.digest!==pkg.digest){store.put('plugin-installation',source.id,{...current,revision:(old?.revision??0)+1});store.audit({type:'plugin.activate',...current,previousDigest:old?.digest})}
    }
  })
}
