import {it,expect} from 'vitest'
import {artifactRegistrationSchema,operatorArtifactRegistration,attachmentArtifactRegistration} from '../src/artifact-registry.ts'
import {stableDigest} from '../src/sources.ts'
const sha256='b'.repeat(64),file={schema:1 as const,kind:'goal-artifact' as const,id:'a'.repeat(64),version:2,sha256,name:'report.pdf',mediaType:'application/pdf',bytes:1,category:'document' as const,visibility:'operator_workspace' as const,retention:'subject_to_history_cleanup' as const,publication:'not_tracked' as const,availability:'retained' as const,downloadPath:'/goal-artifacts/'+'a'.repeat(64)}
const view={schema:1 as const,kind:'workspace-view' as const,id:'board',version:'c'.repeat(64),sha256,visibility:'operator_workspace' as const,retention:'subject_to_plugin_removal' as const,publication:'not_tracked' as const}
const attachment={schema:1 as const,kind:'chat-attachment' as const,id:stableDigest(['chat-attachment-version','upload-1',sha256]),version:1 as const,sha256,visibility:'conversation' as const,retention:'subject_to_history_cleanup' as const,publication:'not_tracked' as const}
it('projects workspace source identity without names, URLs, paths or invented acceptance',()=>{
 for(const reference of [file,view]){const registration=operatorArtifactRegistration(reference);expect(registration).toEqual({schema:1,kind:reference.kind,domain:'operator_workspace',id:reference.id,version:reference.version,sha256,retention:reference.retention,publication:'not_tracked',acceptance:'not_tracked'});expect(Object.keys(registration)).not.toContain('downloadPath')}
 expect(operatorArtifactRegistration({...file,name:'renamed',availability:'unavailable',downloadPath:null})).toEqual(operatorArtifactRegistration(file))
 expect(operatorArtifactRegistration({...view,version:'d'.repeat(64)})).not.toEqual(operatorArtifactRegistration(view))
})
it('requires explicit conversation/upload provenance and preserves its distinct domain',()=>{
 const registration=attachmentArtifactRegistration(attachment,{conversationId:'conversation-1',uploadId:'upload-1'})!
 expect(registration).toMatchObject({kind:'chat-attachment',domain:'conversation',conversationId:'conversation-1',id:'upload-1',referenceId:attachment.id})
 expect(attachmentArtifactRegistration(attachment,{conversationId:'conversation-2',uploadId:'upload-1'})).not.toEqual(registration)
 expect(()=>attachmentArtifactRegistration(attachment,{conversationId:'conversation-1',uploadId:'wrong-upload'})).toThrow()
 expect(attachmentArtifactRegistration({...attachment,version:null,sha256:null},{conversationId:'conversation-1',uploadId:'upload-1'})).toBeNull()
 expect(()=>operatorArtifactRegistration(attachment as any)).toThrow()
})
it('fails closed on future schema, cross-domain, mismatched retention, forged identity and added authority fields',()=>{
 const fileRegistration=operatorArtifactRegistration(file),viewRegistration=operatorArtifactRegistration(view),chatRegistration=attachmentArtifactRegistration(attachment,{conversationId:'conversation-1',uploadId:'upload-1'})!
 for(const candidate of [{...fileRegistration,schema:2},{...fileRegistration,domain:'conversation'},{...fileRegistration,version:1.1},{...fileRegistration,retention:'subject_to_plugin_removal'},{...viewRegistration,id:'../board'},{...viewRegistration,sha256:'wrong'},{...fileRegistration,acceptance:'accepted'},{...fileRegistration,publication:'published'},{...fileRegistration,authorized:true},{...chatRegistration,domain:'operator_workspace'},{...chatRegistration,conversationId:''},{...chatRegistration,referenceId:'0'.repeat(64)}])expect(artifactRegistrationSchema.safeParse(candidate).success).toBe(false)
 expect(()=>operatorArtifactRegistration({...file,schema:2} as any)).toThrow()
})
