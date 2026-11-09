import {marketCatalogSchema,type MarketCatalog,type MarketOrigin,type MarketRelease} from './plugin-market-contract.ts'
import {packageHash} from './plugin-archive.ts'

export interface GitHubLocation {repository:string;ref?:string;path:string}
export function githubLocation(value:string):GitHubLocation {
  const url=new URL(value)
  if(url.protocol!=='https:'||url.hostname!=='github.com'||url.username||url.password||url.port||url.search||url.hash)throw Error('Use a github.com repository or directory URL without credentials')
  const parts=url.pathname.replace(/\/$/,'').slice(1).split('/').map(decodeURIComponent)
  if(parts.length<2||parts.some(p=>!p||p==='.'||p==='..'||! /^[\w.@-]+$/.test(p)))throw Error('Invalid GitHub repository path')
  const repository=parts.slice(0,2).join('/').replace(/\.git$/,'')
  if(parts.length===2)return {repository,path:'plugins/catalog.json'}
  if(!['tree','blob'].includes(parts[2]!)||parts.length<4)throw Error('Use a GitHub repository, tree or catalog file URL')
  const path=parts.slice(4).join('/')
  return {repository,ref:parts[3],path:path.endsWith('.json')?path:(path?path+'/':'')+'catalog.json'}
}
async function bounded(response:Response,limit:number){
  if(Number(response.headers.get('content-length')??0)>limit){await response.body?.cancel();throw Error('GitHub response exceeds size limit')}
  const reader=response.body?.getReader();if(!reader)throw Error('GitHub returned no body')
  const chunks:Uint8Array[]=[];let size=0
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit)throw Error('GitHub response exceeds size limit');chunks.push(value)}}finally{await reader.cancel()}
  return Buffer.concat(chunks)
}
class GitHubError extends Error {constructor(readonly status:number,message:string){super(message)}}
/** All URLs are constructed from reviewed GitHub coordinates; tokens never follow asset redirects. */
export class PluginGitHub {
  private cache=new Map<string,{etag?:string;body:any}>()
  private blockedUntil=0
  constructor(private fetcher:typeof fetch=fetch){}
  private headers(tokenEnv?:string){
    if(tokenEnv&&!/^[A-Za-z_][A-Za-z0-9_]*$/.test(tokenEnv))throw Error('Invalid GitHub credential environment name')
    const token=tokenEnv?process.env[tokenEnv]:undefined
    if(tokenEnv&&!token)throw Error('GitHub credential environment variable is not available on this host')
    return {'User-Agent':'Roppo-plugin-market','X-GitHub-Api-Version':'2022-11-28',...(token?{Authorization:'Bearer '+token}:{})}
  }
  private async json(path:string,tokenEnv?:string){
    if(Date.now()<this.blockedUntil)throw Error('GitHub rate limit reached. Retry after '+new Date(this.blockedUntil).toISOString())
    const url='https://api.github.com'+path,key=url+'|'+(tokenEnv??''),cached=this.cache.get(key)
    const response=await this.fetcher(url,{headers:{...this.headers(tokenEnv),Accept:'application/vnd.github+json',...(cached?.etag?{'If-None-Match':cached.etag}:{})},redirect:'error',signal:AbortSignal.timeout(15000)})
    if(response.status===304&&cached)return cached.body
    if(response.status===403||response.status===429){
      const delay=Number(response.headers.get('retry-after')??0)*1000,reset=Number(response.headers.get('x-ratelimit-reset')??0)*1000
      this.blockedUntil=Math.max(Date.now()+Math.max(delay,60000),Math.min(reset,Date.now()+3600000))
    }
    if(!response.ok){await response.body?.cancel();throw new GitHubError(response.status,response.status===404?'GitHub path not found or private. Check the URL and read access.':`GitHub request failed (${response.status}). Retry later.`)}
    const body=JSON.parse((await bounded(response,2_000_000)).toString('utf8'))
    if(this.cache.size>128)this.cache.clear()
    this.cache.set(key,{etag:response.headers.get('etag')??undefined,body});return body
  }
  async catalog(source:Pick<MarketCatalog,'url'|'tokenEnv'|'origin'>){
    const location=githubLocation(source.url),repo=await this.json('/repos/'+location.repository,source.tokenEnv)
    if(!Number.isSafeInteger(repo.id)||typeof repo.default_branch!=='string')throw Error('Invalid GitHub repository response')
    if(source.origin&&source.origin.repositoryId!==repo.id)throw Error('Repository identity changed; add it as a new source after review')
    const ref=location.ref??repo.default_branch,commit=await this.json('/repos/'+location.repository+'/commits/'+encodeURIComponent(ref),source.tokenEnv)
    if(!/^[a-f0-9]{40}$/.test(commit.sha))throw Error('Invalid GitHub commit response')
    let path=location.path,content:any,filter:string|undefined
    try{content=await this.json('/repos/'+location.repository+'/contents/'+path+'?ref='+commit.sha,source.tokenEnv)}
    catch(error){
      // A plugin directory may use the catalog in its immediate parent.
      if(!(error instanceof GitHubError)||error.status!==404||!path.endsWith('/catalog.json')||path.split('/').length<3)throw error
      filter=path.slice(0,-'/catalog.json'.length);path=filter.slice(0,filter.lastIndexOf('/'))+'/catalog.json'
      content=await this.json('/repos/'+location.repository+'/contents/'+path+'?ref='+commit.sha,source.tokenEnv)
    }
    if(content.type!=='file'||content.encoding!=='base64'||typeof content.content!=='string'||content.size>1_000_000)throw Error('This directory has no supported Roppo plugin catalog')
    const catalog=marketCatalogSchema.parse(JSON.parse(Buffer.from(content.content,'base64').toString('utf8')))
    if(filter)catalog.plugins=catalog.plugins.filter(p=>p.directory===filter)
    if(filter&&!catalog.plugins.length)throw Error('This directory is not listed as an installable Roppo plugin')
    const origin:MarketOrigin={repository:location.repository,repositoryId:repo.id,ref,path,commit:commit.sha}
    return {origin,plugins:catalog.plugins,checkedAt:Date.now()}
  }
  async download(origin:MarketOrigin,release:MarketRelease,tokenEnv?:string){
    const repo=await this.json('/repos/'+origin.repository,tokenEnv)
    if(repo.id!==origin.repositoryId)throw Error('Repository identity changed')
    const path='/repos/'+origin.repository+'/releases/assets/'+release.assetId
    const asset=await this.json(path,tokenEnv)
    if(asset.id!==release.assetId||asset.size!==release.size||asset.state!=='uploaded'||asset.digest&&asset.digest!=='sha256:'+release.sha256)throw Error('Release asset metadata does not match the reviewed version')
    let url='https://api.github.com'+path,response:Response|undefined
    for(let redirects=0;redirects<=4;redirects++){
      const parsed=new URL(url)
      if(parsed.protocol!=='https:'||parsed.username||parsed.password||parsed.port||!['api.github.com','github.com','release-assets.githubusercontent.com','objects.githubusercontent.com'].includes(parsed.hostname))throw Error('Unsupported release asset redirect')
      response=await this.fetcher(url,{headers:{...(parsed.hostname==='api.github.com'?this.headers(tokenEnv):{'User-Agent':'Roppo-plugin-market'}),Accept:'application/octet-stream'},redirect:'manual',signal:AbortSignal.timeout(60000)})
      if([301,302,303,307,308].includes(response.status)){const location=response.headers.get('location');await response.body?.cancel();if(!location)throw Error('Missing release asset redirect');url=new URL(location,url).href;continue}
      break
    }
    if(!response?.ok)throw Error('Could not download the GitHub release asset')
    const bytes=await bounded(response,release.size)
    if(bytes.length!==release.size||packageHash(bytes)!==release.sha256)throw Error('Release archive checksum mismatch; the active version was not changed')
    return bytes
  }
  async preview(origin:MarketOrigin,path:string,tokenEnv?:string){
    const content=await this.json('/repos/'+origin.repository+'/contents/'+path+'?ref='+origin.commit,tokenEnv)
    if(content.type!=='file'||content.encoding!=='base64'||content.size>1_400_000||typeof content.content!=='string')throw Error('Preview unavailable')
    const bytes=Buffer.from(content.content,'base64')
    const type=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'image/png':bytes[0]===255&&bytes[1]===216&&bytes[2]===255?'image/jpeg':bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP'?'image/webp':undefined
    if(!type||bytes.length>1_400_000)throw Error('Unsupported preview image')
    return {bytes,type}
  }
}
