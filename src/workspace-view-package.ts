import {z} from 'zod'
import {createHash,randomUUID} from 'node:crypto'
import {readFileSync,writeFileSync,mkdirSync,existsSync,realpathSync,lstatSync,renameSync,rmSync} from 'node:fs'
import {join,resolve} from 'node:path'
import {stableDigest} from './sources.ts'
import type {Config} from './config.ts'

const identifier=z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/)
const digest=z.string().regex(/^[a-f0-9]{64}$/)
export const viewPluginsSchema=z.array(z.object({id:identifier,directory:z.string().min(1),digest,enabled:z.boolean().default(true)}).strict()).max(16).default([]).refine(items=>new Set(items.map(p=>p.id)).size===items.length,'Duplicate workspace view id')
export const viewManifestSchema=z.object({
  category:z.literal('workspace-view'),apiVersion:z.literal(1),id:identifier,
  version:z.string().regex(/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/),
  label:z.object({en:z.string().min(1).max(60),'zh-CN':z.string().min(1).max(60)}).strict(),
  entry:z.literal('view.js'),codeSha256:digest,
  capabilities:z.array(z.literal('workspace.runtime.read')).max(1),
}).strict()
export type ViewManifest=z.infer<typeof viewManifestSchema>
const sha=(code:Uint8Array)=>createHash('sha256').update(code).digest('hex')
function file(directory:string,name:string,limit:number){
  const path=join(directory,name),stat=lstatSync(path)
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size>limit)throw Error('Invalid workspace view package file')
  const bytes=readFileSync(path)
  if(bytes.length>limit)throw Error('Workspace view package too large')
  return bytes
}
/** The same bytes that passed the checksum are returned; never re-read executable bytes later. */
export function readViewPackage(directory:string,expected?:string){
  directory=realpathSync(directory)
  const manifest=viewManifestSchema.parse(JSON.parse(file(directory,'manifest.json',16_384).toString('utf8')))
  const bytes=file(directory,manifest.entry,2_000_000)
  if(sha(bytes)!==manifest.codeSha256)throw Error('Workspace view checksum mismatch')
  const digest=stableDigest(manifest)
  if(expected&&expected!==digest)throw Error('Workspace view digest changed')
  return {directory,manifest,digest,code:bytes.toString('utf8')}
}
export async function buildViewPackage(entry:string,manifest:unknown,destination:string){
  if(existsSync(destination))throw Error('Package destination already exists')
  const {build}=await import('esbuild')
  const result=await build({entryPoints:[resolve(entry)],bundle:true,write:false,format:'iife',platform:'browser',target:'es2022',minify:true,legalComments:'inline',define:{'process.env.NODE_ENV':'"production"'},jsx:'automatic'})
  if(result.outputFiles.length!==1)throw Error('Workspace views require a single self-contained bundle')
  const bytes=result.outputFiles[0]!.contents
  const parsed=viewManifestSchema.parse({...manifest as object,apiVersion:1,entry:'view.js',codeSha256:sha(bytes)})
  if(bytes.length>2_000_000)throw Error('Workspace view bundle too large')
  mkdirSync(destination,{recursive:true,mode:0o700})
  writeFileSync(join(destination,'view.js'),bytes,{mode:0o600,flag:'wx'})
  writeFileSync(join(destination,'manifest.json'),JSON.stringify(parsed,null,2)+'\n',{mode:0o600,flag:'wx'})
  return readViewPackage(destination)
}
export function installViewPackage(directory:string,stateDir:string,expected:string){
  const pkg=readViewPackage(directory,expected),objects=join(stateDir,'plugins','objects'),target=join(objects,pkg.digest)
  mkdirSync(objects,{recursive:true,mode:0o700})
  if(existsSync(target))return readViewPackage(target,pkg.digest)
  const temp=join(objects,'.view-'+randomUUID())
  mkdirSync(temp,{mode:0o700})
  try{
    writeFileSync(join(temp,'manifest.json'),JSON.stringify(pkg.manifest),{mode:0o600,flag:'wx'})
    writeFileSync(join(temp,'view.js'),pkg.code,{mode:0o600,flag:'wx'})
    if(existsSync(join(pkg.directory,'LICENSE')))writeFileSync(join(temp,'LICENSE'),file(pkg.directory,'LICENSE',1000000),{mode:0o600,flag:'wx'})
    readViewPackage(temp,pkg.digest);renameSync(temp,target)
  }finally{rmSync(temp,{recursive:true,force:true})}
  return readViewPackage(target,pkg.digest)
}
export function enabledView(config:Config,id:string,expected?:string){
  const ref=config.viewPlugins.find(p=>p.id===id&&p.enabled)
  if(!ref||expected&&ref.digest!==expected)throw Error('Workspace view unavailable')
  const pkg=readViewPackage(ref.directory,ref.digest)
  if(pkg.manifest.id!==id)throw Error('Workspace view id mismatch')
  return pkg
}
export function viewCatalog(config:Config){
  return config.viewPlugins.filter(p=>p.enabled).map(ref=>{
    try{const {manifest,digest}=enabledView(config,ref.id);return {id:manifest.id,label:manifest.label,version:manifest.version,digest,capabilities:manifest.capabilities,available:true}}
    catch{return {id:ref.id,label:{en:ref.id,'zh-CN':ref.id},version:null,digest:ref.digest,capabilities:[],available:false}}
  })
}
