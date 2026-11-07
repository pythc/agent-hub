import {readFileSync,readdirSync,realpathSync,statSync} from 'node:fs'
import {resolve,relative,sep} from 'node:path'
import type {Runtime} from './runtime.ts'
import type {Source} from './sources.ts'
import {isHostPrivateFile} from './private-files.ts'
import {imageResource} from './resources.ts'
import type {Trigger} from './vendor/dsh-core/index.ts'

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
 const personalWorkspace=resolve(state,'workspace'),inPersonalWorkspace=inside(personalWorkspace,root)
 if(!inside(root,path)||inside(state,path)&&!inPersonalWorkspace||isHostPrivateFile(path)||relative(root,path).split(sep).some(p=>p.startsWith('.')||p==='node_modules'))throw Error('Repository evidence is outside the source directory')
 if(kind==='directory')return readdirSync(path,{withFileTypes:true}).filter(e=>!e.name.startsWith('.')&&e.name!=='node_modules'&&!e.isSymbolicLink()).map(e=>({name:e.name,directory:e.isDirectory()}))
 if(!statSync(path).isFile()||statSync(path).size>8000000)throw Error('Repository file unavailable or too large')
 const data=readFileSync(path)
 if(kind==='image')return imageResource(data)
 if(data.includes(0))throw Error('Binary file requires an image resource')
 return data.toString('utf8')
}

export async function sourceEvidence(source:Source,trigger:Trigger,resource:string){
 if(!source.read)throw Error('Source does not provide this evidence resource')
 let request=resource
 if(source.config.kind==='github'){
  const number=trigger.threads[0]?.id.split('#').at(-1)
  if(!number||!/^\d+$/.test(number)||source.validThread&&!source.validThread(trigger.threads[0]!.id))throw Error('Unknown GitHub discussion')
  if(resource==='root')request='github/issues/'+number
  if(resource==='thread')request='github/issues/'+number+'/comments/1'
  const match=/^github\/(issues|pulls)\/(\d+)(?:\/(comments|reviews|checks|thread)(?:\/(\d+))?)?$/.exec(request)
  if(!match||match[2]!==number)throw Error('GitHub evidence is outside this discussion')
 }else if(!/^(root|parent|around|thread(?:\/[^\s]+)?|(?:image|file)\/[^\s/]+)$/.test(request))throw Error('Unsupported anchored evidence resource')
 const value=await source.read({resource:request,trigger,pageSize:20})
 // Adapter cursors may use the public resource grammar; return a directly usable, still-anchored cursor.
 const prefix=source.config.kind+'/'+trigger.id+'/'
 return value&&typeof value.next_resource==='string'&&value.next_resource.startsWith(prefix)?{...value,next_resource:value.next_resource.slice(prefix.length)}:value
}
