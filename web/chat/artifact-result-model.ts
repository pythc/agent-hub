import type {ArtifactReference} from '../../src/artifact-reference.ts'
import type {WorkspaceTransportContext} from './workspace-transport.ts'
export const artifactIdValid=(id:string)=>/^[a-f0-9]{64}$/.test(id)
/** Fail closed on stale/mismatched or future descriptor shapes. Never trust a supplied URL. */
export function artifactReference(value:unknown,id:string):ArtifactReference|null{
 const v=value as ArtifactReference
 if(!v||!artifactIdValid(id)||v.id!==id||v.schema!==1||v.kind!=='goal-artifact'||!Number.isSafeInteger(v.version)||v.version<1||!Number.isSafeInteger(v.bytes)||v.bytes<0||!artifactIdValid(v.sha256)||typeof v.name!=='string'||!v.name||v.name.length>1024||typeof v.mediaType!=='string'||v.mediaType.length>256||!['spreadsheet','document','image','video','file'].includes(v.category)||v.visibility!=='operator_workspace'||v.retention!=='subject_to_history_cleanup'||v.publication!=='not_tracked'||!['retained','unavailable'].includes(v.availability))return null
 if(v.downloadPath!==(v.availability==='retained'?'/goal-artifacts/'+id:null))return null
 return v
}
export function artifactDownload(id:string,context:WorkspaceTransportContext){
 if(!artifactIdValid(id)||context.state!=='ready'||(context.managed&&!/^[a-zA-Z0-9_-]{1,80}$/.test(context.activeId)))return null
 return (context.managed?'/workspaces/'+encodeURIComponent(context.activeId):'')+'/goal-artifacts/'+id
}
