import {createHash,randomUUID} from 'node:crypto'
import {readFileSync,writeFileSync,mkdirSync,existsSync,realpathSync,statSync,renameSync,rmSync} from 'node:fs'
import {join,resolve} from 'node:path'
import {stableDigest} from './sources.ts'

export interface ArtifactManifest {entry:'plugin.mjs';codeSha256:string}
export interface PluginArtifact<M extends ArtifactManifest> {directory:string;manifest:M;digest:string}
export interface ManifestParser<M> {parse(value:unknown):M}
const sha=(value:Uint8Array)=>createHash('sha256').update(value).digest('hex')

/** Shared immutable package format. Each plugin category owns its own protocol/schema. */
export function readArtifact<M extends ArtifactManifest>(directory:string,parser:ManifestParser<M>,expectedDigest?:string):PluginArtifact<M>{
 directory=realpathSync(directory)
 for(const name of ['manifest.json','plugin.mjs']){
  const path=join(directory,name)
  if(realpathSync(path)!==path||!statSync(path).isFile()||statSync(path).size>16_000_000)throw Error('Invalid plugin package file')
 }
 const manifest=parser.parse(JSON.parse(readFileSync(join(directory,'manifest.json'),'utf8')))
 if(sha(readFileSync(join(directory,'plugin.mjs')))!==manifest.codeSha256)throw Error('Plugin bundle checksum mismatch')
 const digest=stableDigest(manifest)
 if(expectedDigest&&digest!==expectedDigest)throw Error('Plugin package digest changed')
 return {directory,manifest,digest}
}

export async function buildArtifact<M extends ArtifactManifest>(entry:string,manifest:Record<string,unknown>,destination:string,parser:ManifestParser<M>){
 if(existsSync(destination))throw Error('Package destination already exists')
 const {build}=await import('esbuild')
 const result=await build({entryPoints:[resolve(entry)],bundle:true,write:false,format:'esm',platform:'node',target:'node22',packages:'bundle',legalComments:'inline',banner:{js:'import {createRequire as __pluginCreateRequire} from "node:module";const require=__pluginCreateRequire(import.meta.url);'}})
 const code=result.outputFiles[0]!.contents
 const parsed=parser.parse({...manifest,entry:'plugin.mjs',codeSha256:sha(code)})
 mkdirSync(destination,{recursive:true,mode:0o700})
 writeFileSync(join(destination,'plugin.mjs'),code,{mode:0o600,flag:'wx'})
 writeFileSync(join(destination,'manifest.json'),JSON.stringify(parsed,null,2)+'\n',{mode:0o600,flag:'wx'})
 return readArtifact(destination,parser)
}

export function installArtifact<M extends ArtifactManifest>(directory:string,objects:string,digest:string,parser:ManifestParser<M>){
 const pkg=readArtifact(directory,parser,digest),target=join(objects,digest)
 mkdirSync(objects,{recursive:true,mode:0o700})
 if(existsSync(target))return readArtifact(target,parser,digest)
 const temp=join(objects,'.install-'+process.pid+'-'+randomUUID());mkdirSync(temp,{mode:0o700})
 try{
  for(const name of ['manifest.json','plugin.mjs'])writeFileSync(join(temp,name),readFileSync(join(pkg.directory,name)),{mode:0o600,flag:'wx'})
  readArtifact(temp,parser,digest)
  try{renameSync(temp,target)}catch(error){if(!existsSync(target))throw error;readArtifact(target,parser,digest)}
 }finally{rmSync(temp,{recursive:true,force:true})}
 return readArtifact(target,parser,digest)
}
