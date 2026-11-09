/** Build a marketplace artifact. Publishing is performed only by the explicit release workflow. */
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs'
import {resolve,join} from 'node:path'
import {execFileSync} from 'node:child_process'
import {marketCatalogSchema,releaseSchema} from '../src/plugin-market-contract.ts'
import {buildViewPackage} from '../src/workspace-view-package.ts'
import {buildPluginPackage} from '../src/plugin-package.ts'
import {packPluginArchive,packageHash} from '../src/plugin-archive.ts'
import {packagePermissions} from '../src/plugin-market.ts'

const [command,id,destination,assetFile]=process.argv.slice(2)
const catalogPath=resolve('plugins/catalog.json'),catalog=marketCatalogSchema.parse(JSON.parse(readFileSync(catalogPath,'utf8'))),plugin=catalog.plugins.find(p=>p.id===id)
if(!plugin||!destination||!['prepare','index'].includes(command??''))throw Error('Usage: release-plugin.ts prepare|index <catalog-plugin-id> <output-directory> [asset-metadata.json]')
const out=resolve(destination)
if(command==='prepare'){
  const manifest=JSON.parse(readFileSync(join(plugin.directory,'manifest.json'),'utf8'))
  if(manifest.id!==id||catalog.plugins.some(p=>p.id===id&&p.releases.some(r=>r.version===manifest.version)))throw Error('Plugin version is already published or ID does not match')
  mkdirSync(out,{recursive:true})
  const pkg=plugin.category==='workspace-view'?await buildViewPackage(join(plugin.directory,'index.tsx'),manifest,join(out,'package')):await buildPluginPackage(join(plugin.directory,'index.ts'),manifest,join(out,'package'))
  const archive=packPluginArchive(pkg.directory,plugin.category==='workspace-view'?'view.js':'plugin.mjs',readFileSync('LICENSE','utf8'))
  const file=id+'-'+pkg.manifest.version+'.tgz',commit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim()
  const metadata={version:pkg.manifest.version,hostMin:'0.10.0',platforms:plugin.category==='workspace-view'?['darwin','linux','win32']:['darwin','linux'],apiVersion:plugin.category==='workspace-view'?1:2,commit,digest:pkg.digest,sha256:packageHash(archive),size:archive.length,permissions:packagePermissions(pkg.manifest),notes:plugin.description}
  writeFileSync(join(out,file),archive);writeFileSync(join(out,'release.json'),JSON.stringify(metadata,null,2)+'\n');writeFileSync(join(out,'notes.md'),plugin.description.en+'\n\n'+plugin.description['zh-CN']+'\n')
  writeFileSync(join(out,'workflow.json'),JSON.stringify({tag:'plugin-'+id+'-v'+pkg.manifest.version,file,version:pkg.manifest.version}))
  console.log(JSON.stringify({directory:out,file,sha256:metadata.sha256,notPublished:true}))
}else{
  if(!assetFile)throw Error('An uploaded GitHub asset response is required')
  const asset=JSON.parse(readFileSync(assetFile,'utf8')),metadata=JSON.parse(readFileSync(join(out,'release.json'),'utf8'))
  if(asset.state!=='uploaded'||asset.size!==metadata.size||asset.digest!=='sha256:'+metadata.sha256)throw Error('Uploaded asset does not match the built package')
  const release=releaseSchema.parse({...metadata,assetId:asset.id})
  if(plugin.releases.some(r=>r.version===release.version))throw Error('This version is already indexed')
  plugin.releases.push(release);writeFileSync(catalogPath,JSON.stringify(marketCatalogSchema.parse(catalog),null,2)+'\n')
  console.log(JSON.stringify({indexed:id,version:release.version}))
}
