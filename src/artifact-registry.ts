import {z} from 'zod'
import type {ArtifactReference,ChatArtifactReference,WorkspaceViewArtifactReference} from './artifact-reference.ts'
import {stableDigest} from './sources.ts'
const hash=z.string().regex(/^[a-f0-9]{64}$/),id=z.string().min(1).max(128).regex(/^[a-zA-Z0-9_-]+$/)
const common={schema:z.literal(1),publication:z.literal('not_tracked'),acceptance:z.literal('not_tracked')}
/** A source locator, not an authorization grant, durable retention promise or registry row. */
export const artifactRegistrationSchema=z.discriminatedUnion('kind',[
 z.object({...common,kind:z.literal('goal-artifact'),domain:z.literal('operator_workspace'),id:hash,version:z.number().int().positive().max(Number.MAX_SAFE_INTEGER),sha256:hash,retention:z.literal('subject_to_history_cleanup')}).strict(),
 z.object({...common,kind:z.literal('workspace-view'),domain:z.literal('operator_workspace'),id:z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/),version:hash,sha256:hash,retention:z.literal('subject_to_plugin_removal')}).strict(),
 z.object({...common,kind:z.literal('chat-attachment'),domain:z.literal('conversation'),conversationId:id,id,referenceId:hash,version:z.literal(1),sha256:hash,retention:z.literal('subject_to_history_cleanup')}).strict(),
]).superRefine((value,ctx)=>{
 if(value.kind==='chat-attachment'&&value.referenceId!==stableDigest(['chat-attachment-version',value.id,value.sha256]))ctx.addIssue({code:'custom',message:'Attachment reference identity mismatch'})
})
export type ArtifactRegistration=z.infer<typeof artifactRegistrationSchema>
/** Call only after the source resolver has checked current access. No lookup or persistence occurs. */
export function operatorArtifactRegistration(reference:ArtifactReference|WorkspaceViewArtifactReference):Extract<ArtifactRegistration,{domain:'operator_workspace'}>{
 if(reference.schema!==1)throw Error('Invalid artifact reference schema')
 const result=artifactRegistrationSchema.parse({schema:1,kind:reference.kind,domain:reference.visibility,id:reference.id,version:reference.version,sha256:reference.sha256,retention:reference.retention,publication:reference.publication,acceptance:'not_tracked'})
 if(result.domain!=='operator_workspace')throw Error('Invalid operator artifact registration')
 return result
}
/** Legacy uploads without a digest have no immutable registration candidate. Never infer owner from a URL. */
export function attachmentArtifactRegistration(reference:ChatArtifactReference,source:{conversationId:string;uploadId:string}):ArtifactRegistration|null{
 if(reference.version!==1||!reference.sha256)return null
 if(reference.schema!==1||reference.id!==stableDigest(['chat-attachment-version',source.uploadId,reference.sha256]))throw Error('Attachment reference identity mismatch')
 return artifactRegistrationSchema.parse({schema:1,kind:reference.kind,domain:reference.visibility,conversationId:source.conversationId,id:source.uploadId,referenceId:reference.id,version:reference.version,sha256:reference.sha256,retention:reference.retention,publication:reference.publication,acceptance:'not_tracked'})
}
