/** Metadata only: a retained local version is not proof of acceptance or publication. */
export interface ArtifactReference {
 schema:1
 kind:'goal-artifact'
 id:string
 version:number
 sha256:string
 name:string
 mediaType:string
 bytes:number
 category:'spreadsheet'|'document'|'image'|'video'|'file'
 visibility:'operator_workspace'
 retention:'subject_to_history_cleanup'
 availability:'retained'|'unavailable'
 publication:'not_tracked'
 downloadPath:string|null
}

/** Conversation-scoped upload identity; legacy uploads have no recorded digest. */
export interface ChatArtifactReference {
 schema:1
 kind:'chat-attachment'
 id:string
 version:1|null
 sha256:string|null
 visibility:'conversation'
 retention:'subject_to_history_cleanup'
 publication:'not_tracked'
}
/** Verified package identity, not a frozen runtime snapshot or authorization grant. */
export interface WorkspaceViewArtifactReference {
 schema:1
 kind:'workspace-view'
 id:string
 /** Manifest digest pins the complete package, including its code checksum. */
 version:string
 sha256:string
 visibility:'operator_workspace'
 retention:'subject_to_plugin_removal'
 publication:'not_tracked'
}
export type VersionedArtifactReference=ArtifactReference|ChatArtifactReference|WorkspaceViewArtifactReference
