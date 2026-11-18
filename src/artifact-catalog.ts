import type {Runtime} from './runtime.ts'
import type {ArtifactReference,WorkspaceViewArtifactReference} from './artifact-reference.ts'
import {viewCatalog} from './workspace-view-package.ts'
export type ArtifactCatalogEntry={reference:ArtifactReference|WorkspaceViewArtifactReference;label:{en:string;'zh-CN':string}}
export interface ArtifactCatalog {schema:1;items:ArtifactCatalogEntry[];truncated:boolean}
/** Operator-only projection. Conversation attachments are deliberately not enumerated. */
export function artifactCatalog(host:Runtime):ArtifactCatalog {
 const items:ArtifactCatalogEntry[]=[]
 for(const row of host.store.list<{id:string}>('goal-artifact')){
  try{const reference=host.artifacts.describe(row.id);items.push({reference,label:{en:reference.name,'zh-CN':reference.name}})}catch{}
 }
 for(const view of viewCatalog(host.config))if(view.available&&view.reference)items.push({reference:view.reference,label:view.label})
 items.sort((a,b)=>a.reference.kind.localeCompare(b.reference.kind)||a.reference.id.localeCompare(b.reference.id))
 return {schema:1,items:items.slice(0,200),truncated:items.length>200}
}
