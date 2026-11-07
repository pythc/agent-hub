import {readFileSync,readdirSync,realpathSync,statSync} from 'node:fs'
import {resolve,relative,sep} from 'node:path'
import type {Runtime} from './runtime.ts'
import type {Source} from './sources.ts'
import {isHostPrivateFile} from './private-files.ts'
import {imageResource} from './resources.ts'

const inside=(root:string,path:string)=>{const name=relative(root,path);return name===''||name!=='..'&&!name.startsWith('..'+sep)&&!name.startsWith(sep)}
/** Admission reads are bounded by the configured source directory, never an ambient working directory. */
export async function repositoryEvidence(host:Runtime,source:Source,resource:string){
 const match=/^repository\/(file|directory|image)\/(.+)$/.exec(resource)
 if(!match)throw Error('Unknown repository evidence resource')
 const [,kind,name]=match,parts=name!.split(/[\\/]/)
 if(parts.some(p=>p==='..'||p.startsWith('.')&&p!=='.'||p==='node_modules'))throw Error('Private repository path')
 if(source.config.kind==='github'){
  if(kind==='image'||!source.read)throw Error('Source does not provide repository images')
  return source.read({resource:'github/'+kind+'/'+name,pageSize:20})
 }
 const root=realpathSync(source.config.cwd),path=realpathSync(resolve(root,name!)),state=realpathSync(host.config.stateDir)
 if(!inside(root,path)||inside(state,path)||isHostPrivateFile(path)||relative(root,path).split(sep).some(p=>p.startsWith('.')||p==='node_modules'))throw Error('Repository evidence is outside the source directory')
 if(kind==='directory')return readdirSync(path,{withFileTypes:true}).filter(e=>!e.name.startsWith('.')&&e.name!=='node_modules'&&!e.isSymbolicLink()).map(e=>({name:e.name,directory:e.isDirectory()}))
 if(!statSync(path).isFile()||statSync(path).size>8000000)throw Error('Repository file unavailable or too large')
 const data=readFileSync(path)
 if(kind==='image')return imageResource(data)
 if(data.includes(0))throw Error('Binary file requires an image resource')
 return data.toString('utf8')
}
