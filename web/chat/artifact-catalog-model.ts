import type {ArtifactCatalog} from '../../src/artifact-catalog.ts'
import {artifactReference} from './artifact-result-model.ts'
export function parseArtifactCatalog(input:unknown):ArtifactCatalog|null{
 const data=input as ArtifactCatalog
 if(!data||data.schema!==1||typeof data.truncated!=='boolean'||!Array.isArray(data.items)||data.items.length>100)return null
 if(data.nextCursor!==null&&(typeof data.nextCursor!=='string'||!/^[a-f0-9-]{36}$/.test(data.nextCursor)))return null
 if(data.truncated!==(data.nextCursor!==null))return null
 const seen=new Set<string>()
 for(const item of data.items){
  if(!item||!item.label||typeof item.label.en!=='string'||typeof item.label['zh-CN']!=='string')return null
  const ref=item.reference
  if(!ref)return null
  if(ref.kind==='goal-artifact'){if(!artifactReference(ref,ref.id))return null}
  else if(ref.kind==='workspace-view'){
   if(ref.schema!==1||!/^[a-z][a-z0-9_-]{0,63}$/.test(ref.id)||!/^[a-f0-9]{64}$/.test(ref.version)||!/^[a-f0-9]{64}$/.test(ref.sha256)||ref.visibility!=='operator_workspace'||ref.retention!=='subject_to_plugin_removal'||ref.publication!=='not_tracked')return null
  }else return null
  // Optional for compatibility with older servers. Never treat supplied provenance as authority.
  const registration=item.registration
  if(registration!==undefined&&(!registration||Object.keys(registration).length!==9||registration.schema!==1||registration.kind!==ref.kind||registration.domain!=='operator_workspace'||registration.id!==ref.id||registration.version!==ref.version||registration.sha256!==ref.sha256||registration.retention!==ref.retention||registration.publication!=='not_tracked'||registration.acceptance!=='not_tracked'))return null
  const key=ref.kind+':'+ref.id
  if(seen.has(key))return null
  seen.add(key)
 }
 return data
}
