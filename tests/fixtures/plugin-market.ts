import {join} from 'node:path'
import {writeFileSync,readFileSync} from 'node:fs'
import {buildViewPackage} from '../../src/workspace-view-package.ts'
import {buildPluginPackage} from '../../src/plugin-package.ts'
import {packPluginArchive,packageHash} from '../../src/plugin-archive.ts'
import {packagePermissions} from '../../src/plugin-market.ts'
import {PluginGitHub} from '../../src/plugin-github.ts'
import type {CatalogPlugin,MarketRelease} from '../../src/plugin-market-contract.ts'
export async function marketFixture(root:string,board=false){
  const files=new Map<number,Buffer>(),plugins:CatalogPlugin[]=[],assetMetadata=new Map<number,any>()
  const add=async(category:'workspace-view'|'source',version:string)=>{
    const entry=join(root,category+'-'+version+'.ts')
    writeFileSync(entry,category==='workspace-view'?'document.body.textContent="Installed view '+version+'";':'export default {apiVersion:2};')
    const pkg=category==='workspace-view'?await buildViewPackage(board?'plugins/agent-board/index.tsx':entry,{category,id:'agent-board',version,label:{en:'Agent board','zh-CN':'Agent 看板'},capabilities:['workspace.runtime.read']},join(root,'pack-'+category+'-'+version)):await buildPluginPackage(entry,{id:'test-connector',kind:'markettest',label:'Test connector',version,stateVersion:1,scopesPath:'/options/channels',methods:['read','close'],configSchema:{type:'object',required:['options'],properties:{options:{type:'object',required:['channels'],properties:{channels:{type:'array',items:{type:'string'},minItems:1}}}}}} as any,join(root,'pack-'+category+'-'+version))
    const archive=packPluginArchive(pkg.directory,category==='workspace-view'?'view.js':'plugin.mjs',readFileSync('LICENSE','utf8')),assetId=files.size+1
    const release:MarketRelease={version,hostMin:'0.10.0',platforms:['darwin','linux','win32'],apiVersion:category==='source'?2:1,commit:'a'.repeat(40),assetId,sha256:packageHash(archive),size:archive.length,digest:pkg.digest,permissions:packagePermissions(pkg.manifest),notes:{en:'A verified package for isolated marketplace acceptance.','zh-CN':'用于隔离环境插件市场验收的版本。'}}
    files.set(assetId,archive);assetMetadata.set(assetId,{id:assetId,size:archive.length,state:'uploaded',digest:'sha256:'+release.sha256})
    let plugin=plugins.find(p=>p.id===pkg.manifest.id)
    if(!plugin){plugin={id:pkg.manifest.id,category,name:{en:category==='source'?'Test connector':'Agent board','zh-CN':category==='source'?'测试连接器':'Agent 看板'},description:{en:category==='source'?'An isolated connector package for testing lifecycle and connection setup.':'Follow your team, tasks, tool calls and listening decisions in one workspace.','zh-CN':category==='source'?'用于验证生命周期与连接配置的隔离测试插件。':'在一个工作区跟进团队、任务、工具调用与监听决策。'},directory:'plugins/'+pkg.manifest.id,maintainer:'Roppo acceptance',license:'Apache-2.0',screenshots:board&&category==='workspace-view'?['plugins/agent-board/preview.png']:[],releases:[]};plugins.push(plugin)}
    plugin.releases.push(release);return {pkg,release,archive,plugin}
  }
  const one=await add('workspace-view','1.0.0'),source=await add('source','1.0.0')
  let offline=false,etag='"one"';const requests:{url:string;headers:Headers}[]=[]
  const fetcher:typeof fetch=async(input,init)=>{
    const url=String(input),headers=new Headers(init?.headers);requests.push({url,headers})
    if(offline)throw Error('Fixture network unavailable')
    const parsed=new URL(url),path=parsed.pathname
    if(path==='/repos/acme/plugins')return Response.json({id:42,default_branch:'main'})
    if(path==='/repos/acme/plugins/commits/main')return Response.json({sha:'b'.repeat(40)})
    if(path==='/repos/acme/plugins/contents/plugins/catalog.json'){
      if(headers.get('if-none-match')===etag)return new Response(null,{status:304})
      return Response.json({type:'file',encoding:'base64',size:200,content:Buffer.from(JSON.stringify({format:1,plugins})).toString('base64')},{headers:{etag}})
    }
    if(path==='/repos/acme/plugins/contents/plugins/agent-board/preview.png'){const bytes=readFileSync('plugins/agent-board/preview.png');return Response.json({type:'file',encoding:'base64',size:bytes.length,content:bytes.toString('base64')})}
    const match=path.match(/\/releases\/assets\/(\d+)$/)
    if(match){const id=Number(match[1]);if(headers.get('accept')==='application/octet-stream')return new Response(null,{status:302,headers:{location:'https://release-assets.githubusercontent.com/test/'+id}});return Response.json(assetMetadata.get(id))}
    if(parsed.hostname==='release-assets.githubusercontent.com')return new Response(new Uint8Array(files.get(Number(path.split('/').at(-1)))!))
    return new Response('{}',{status:404})
  }
  return {github:new PluginGitHub(fetcher),fetcher,one,source,files,plugins,requests,assetMetadata,add,offline:(value:boolean)=>{offline=value},changed:()=>{etag='"'+Date.now()+'-'+Math.random()+'"'}}
}
