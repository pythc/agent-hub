import {stableDigest} from './sources.ts'

/** Basenames protected at every depth; arbitrary schemas require explicit sharedFiles. */
export const projectLockfiles=['package-lock.json','npm-shrinkwrap.json','yarn.lock','pnpm-lock.yaml','bun.lock','bun.lockb','Cargo.lock','poetry.lock','uv.lock','Pipfile.lock','composer.lock','Gemfile.lock','go.sum'] as const
export const validSharedPath=(path:string)=>path.length>0&&path.length<=1024&&!/[\\\x00-\x1f\x7f]/.test(path)&&!path.startsWith('/')&&!/^[A-Za-z]:/.test(path)&&path.split('/').every(p=>p!==''&&p!=='.'&&p!=='..'&&p.toLowerCase()!=='.git')
export interface ProjectOwnership {version:1;base:string;integration:string;integrationWorkerId:string;sharedFiles:string[];lockfiles:string[];policyDigest:string;digest:string}
export function createProjectOwnership(base:string,integration:string,integrationWorkerId:string,policy:unknown,sharedFiles:string[]=[]):ProjectOwnership{
 if(!integrationWorkerId||sharedFiles.some(p=>!validSharedPath(p)))throw Error('Invalid project shared-file responsibility')
 const body={version:1 as const,base,integration,integrationWorkerId,sharedFiles:[...new Set(sharedFiles)].sort(),lockfiles:[...projectLockfiles],policyDigest:stableDigest(policy)}
 return {...body,digest:stableDigest(body)}
}
export function validateProjectOwnership(snapshot:ProjectOwnership|undefined,base:string,integration:string,workerId:string|undefined,policy:unknown,sharedFiles:string[]=[]){
 if(!snapshot)return
 const expected=createProjectOwnership(base,integration,workerId??'',policy,sharedFiles)
 if(stableDigest(snapshot)!==stableDigest(expected))throw Error('Project responsibility changed; create a new project')
 return expected
}
export type ProjectTree=Map<string,string> // Git mode + object type + object ID; missing is meaningful.
const aliasKey=(path:string)=>path.normalize('NFD').toUpperCase().toLowerCase()
/** Refuse ambiguous spellings rather than pretending a platform alias is absent. */
export function validateSharedFilePaths(paths:string[],trees:ProjectTree[]){
 for(const path of paths){
  const parts=path.split('/')
  for(let i=1;i<=parts.length;i++){
   const candidate=parts.slice(0,i).join('/'),key=aliasKey(candidate)
   for(const tree of trees){
    for(const actual of tree.keys())if(actual!==candidate&&aliasKey(actual)===key)throw Error('Shared-file path has a case or Unicode alias: '+candidate)
    if(i<parts.length){const object=tree.get(candidate);if(object!==undefined&&!/^040000 tree [a-f0-9]+$/.test(object))throw Error('Shared-file ancestor must be a Git directory: '+candidate)}
   }
  }
 }
}
export interface ProjectOwnershipEvidence {status:'checked'|'legacy_unknown';digest?:string;head:string;nodeId:string;workerId?:string;ticketId:string;checkedPaths:string[]}
export function checkProjectOwnership(snapshot:ProjectOwnership|undefined,nodeId:string,workerId:string|undefined,ticketId:string,head:string,current:ProjectTree,parents:ProjectTree[]):ProjectOwnershipEvidence{
 const receipt:ProjectOwnershipEvidence={status:snapshot?'checked':'legacy_unknown',digest:snapshot?.digest,head,nodeId,workerId,ticketId,checkedPaths:[]}
 if(!snapshot)return receipt
 if(!parents.length)throw Error('Project responsibility requires accepted parent trees')
 validateSharedFilePaths(snapshot.sharedFiles,[current,...parents])
 const paths=[...new Set([...current.keys(),...parents.flatMap(p=>[...p.keys()]),...snapshot.sharedFiles])].filter(path=>snapshot.sharedFiles.includes(path)||snapshot.lockfiles.some(name=>aliasKey(name)===aliasKey(path.split('/').at(-1)!))).sort()
 receipt.checkedPaths=paths
 // Protected content must be a regular Git file: symbolic links and gitlinks do not
 // bind the referenced bytes. Integration may repair an inherited nonregular object
 // only by replacing it with a regular file or deleting it.
 const regular=(object:string|undefined)=>object===undefined||/^100(?:644|755) blob [a-f0-9]+$/.test(object)
 for(const path of paths){
  if(!regular(current.get(path)))throw Error('Protected shared file must be a regular Git file: '+path)
  if(nodeId!==snapshot.integration&&parents.some(parent=>!regular(parent.get(path))))throw Error('Nonregular protected parent requires integration repair: '+path)
 }
 if(nodeId===snapshot.integration){if(workerId!==snapshot.integrationWorkerId)throw Error('Integration Worker changed');return receipt}
 for(const path of paths){
  const versions=new Set(parents.map(p=>p.get(path)))
  if(versions.size!==1||!versions.has(current.get(path)))throw Error('Shared file '+path+' belongs to integration node '+snapshot.integration)
 }
 return receipt
}
