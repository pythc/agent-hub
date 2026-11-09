import {z} from 'zod'

export const marketId=z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/)
export const sha256=z.string().regex(/^[a-f0-9]{64}$/)
export const semver=z.string().regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/)
const text=z.object({en:z.string().min(1).max(4000),'zh-CN':z.string().min(1).max(4000)}).strict()
export const releaseSchema=z.object({
  version:semver,hostMin:semver,hostMax:semver.optional(),
  platforms:z.array(z.enum(['darwin','linux','win32'])).min(1).max(3),
  apiVersion:z.union([z.literal(1),z.literal(2)]),commit:z.string().regex(/^[a-f0-9]{40}$/),
  digest:sha256,sha256,size:z.number().int().min(1).max(20_000_000),
  assetId:z.number().int().positive(),notes:text,
  permissions:z.array(z.string().min(1).max(200)).max(120),
}).strict()
export const catalogPluginSchema=z.object({
  id:marketId,category:z.enum(['workspace-view','source']),name:text,description:text,
  directory:z.string().regex(/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/),
  license:z.string().min(1).max(80),maintainer:z.string().min(1).max(80),
  screenshots:z.array(z.string().regex(/^(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.(?:png|webp|jpg|jpeg)$/)).max(4).default([]),
  releases:z.array(releaseSchema).max(100),
}).strict().superRefine((p,ctx)=>{
  if(new Set(p.releases.map(r=>r.version)).size!==p.releases.length)ctx.addIssue({code:'custom',message:'Duplicate release version'})
  if(p.releases.some(r=>r.apiVersion!==(p.category==='source'?2:1)))ctx.addIssue({code:'custom',message:'Plugin API does not match category'})
})
export const marketCatalogSchema=z.object({format:z.literal(1),plugins:z.array(catalogPluginSchema).max(100)}).strict().refine(c=>new Set(c.plugins.map(p=>p.id)).size===c.plugins.length,'Duplicate plugin id')
export type CatalogPlugin=z.infer<typeof catalogPluginSchema>
export type MarketRelease=z.infer<typeof releaseSchema>
export interface MarketOrigin {repository:string;repositoryId:number;ref:string;path:string;commit:string}
export interface MarketCatalog {id:string;url:string;tokenEnv?:string;origin?:MarketOrigin;plugins:CatalogPlugin[];checkedAt?:number;attemptedAt?:number;error?:string}
export interface InstalledPlugin {
  id:string;category:CatalogPlugin['category'];name:CatalogPlugin['name'];origin:MarketOrigin;
  selected:MarketRelease;active?:MarketRelease;previous?:MarketRelease;enabled:boolean;
  directory:string;kind?:string;stateVersion?:number;ignoredVersion?:string;
}
export interface MarketState {format:1;revision:number;catalogs:MarketCatalog[];installed:InstalledPlugin[]}
export type MarketAction='install'|'activate'|'disable'|'enable'|'rollback'|'uninstall'|'ignore'
export interface MarketPlan {
  id:string;action:MarketAction;pluginId:string;catalogId?:string;revision:number;settingsRevision:number;expiresAt:number;
  plugin?:CatalogPlugin;origin?:MarketOrigin;target?:MarketRelease;permissionsAdded:string[];restart:boolean;connections:string[];
}
export interface MarketOperation {id:string;planId:string;pluginId:string;action:MarketAction;state:'downloading'|'verifying'|'installed'|'activating'|'complete'|'failed'|'interrupted';at:number;error?:string}
export const HOST_VERSION='0.10.0'
export function compareVersion(a:string,b:string){
  const parse=(v:string)=>{const [core,...rest]=v.split('-');return {core:core!.split('.').map(Number),pre:rest.join('-')}}
  const x=parse(a),y=parse(b)
  for(let i=0;i<3;i++){const n=x.core[i]!-y.core[i]!;if(n)return n>0?1:-1}
  if(x.pre===y.pre)return 0
  if(!x.pre||!y.pre)return x.pre?-1:1
  const aa=x.pre.split('.'),bb=y.pre.split('.')
  for(let i=0;i<Math.max(aa.length,bb.length);i++){
    if(aa[i]===undefined)return -1;if(bb[i]===undefined)return 1
    if(aa[i]===bb[i])continue
    const an=/^\d+$/.test(aa[i]!),bn=/^\d+$/.test(bb[i]!)
    if(an&&bn)return Number(aa[i])>Number(bb[i])?1:-1
    if(an!==bn)return an?-1:1
    return aa[i]!>bb[i]!?1:-1
  }
  return 0
}
export function compatible(r:MarketRelease,platform:string=process.platform){return compareVersion(HOST_VERSION,r.hostMin)>=0&&(!r.hostMax||compareVersion(HOST_VERSION,r.hostMax)<=0)&&r.platforms.includes(platform as 'darwin')}
export function latestCompatible(plugin:CatalogPlugin,platform:string=process.platform){return plugin.releases.filter(r=>!r.version.includes('-')&&compatible(r,platform)).sort((a,b)=>compareVersion(b.version,a.version))[0]}
