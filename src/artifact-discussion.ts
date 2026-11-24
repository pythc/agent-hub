import {createHash} from 'node:crypto'
import {z} from 'zod'
import {stableDigest} from './sources.ts'
import {viewVersion} from './workspace-view-package.ts'
import type {Runtime} from './runtime.ts'

const uuid='[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}'
const sha='[a-f0-9]{64}'
const goalPattern=new RegExp('^file/('+sha+')/([1-9][0-9]{0,14})/('+sha+')$')
const attachmentPattern=new RegExp('^attachment/('+uuid+')/('+uuid+')/('+sha+')$')
const viewPattern=new RegExp('^view/([a-z][a-z0-9_-]{0,63})/('+sha+')$')
const position=z.number().int().min(1).max(1_000_000)
const selectionSchema=z.discriminatedUnion('kind',[
 z.object({kind:z.literal('page'),page:position}).strict(),
 z.object({kind:z.literal('lines'),start:position,end:position}).strict(),
]).refine(s=>s.kind!=='lines'||s.start<=s.end,'Invalid line range')
const appendSchema=z.object({
 sourceSnapshot:z.string().regex(/^[a-f0-9]{64}$/),
 operationId:z.string().uuid(),kind:z.enum(['comment','proposed-change']),
 text:z.string().trim().min(1).max(4000),selection:selectionSchema.optional(),
}).strict()
export type ArtifactDiscussionAppend=z.infer<typeof appendSchema>
type DiscussionEntry=Omit<ArtifactDiscussionAppend,'sourceSnapshot'|'operationId'>&{id:string;at:number}
type CanonicalSource=
 |{kind:'goal-artifact';id:string;version:number;digest:string;goalId:string;ticketId:string}
 |{kind:'chat-attachment';id:string;version:1;digest:string;conversationId:string;uploadId:string;triggerId:string|null}
 |{kind:'workspace-view';id:string;version:string;digest:string}
type StoredDiscussion={owner:string;source:CanonicalSource;entries:DiscussionEntry[]}
const recordKind='artifact-discussion'
const commentLimit=100

export class ArtifactDiscussionError extends Error {
 constructor(readonly code:string,readonly status:number){super(code)}
}
const unavailable=()=>new ArtifactDiscussionError('artifact_discussion_unavailable',404)

/** Keep locators—not excerpts or fetched source bytes—with a fixed artifact version. */
export class ArtifactDiscussion {
 constructor(private host:Runtime){}
 private source(path:string,owner:string):CanonicalSource {
  try{return this.host.scopes.readOnly(()=>this.host.memory.readOnly(()=>{
   const goal=goalPattern.exec(path)
   if(goal){
    const [,id,version,digest]=goal
    const {artifact,bytes}=this.host.artifacts.download(id!)
    if(this.host.memory.cleanup.blocked('goal-artifact',id!,artifact)||artifact.id!==id||artifact.version!==Number(version)||artifact.sha256!==digest||bytes.length!==artifact.size||createHash('sha256').update(bytes).digest('hex')!==digest)throw unavailable()
    return {kind:'goal-artifact',id:artifact.id,version:artifact.version,digest:artifact.sha256,goalId:artifact.goalId,ticketId:artifact.ticketId}
   }
   const attachment=attachmentPattern.exec(path)
   if(attachment){
    const [,conversationId,uploadId,digest]=attachment
    const {file}=this.host.chat.uploads.downloadVersion(conversationId!,owner,uploadId!,digest!)
    // Only a sent attachment is an appropriate source for durable discussion.
    if(!file.triggerId)throw unavailable()
    this.host.chat.uploads.authorize(uploadId!,{chatTriggerId:file.triggerId})
    return {kind:'chat-attachment',id:stableDigest(['chat-attachment-version',uploadId,digest]),version:1,digest:digest!,conversationId:conversationId!,uploadId:uploadId!,triggerId:file.triggerId}
   }
   const view=viewPattern.exec(path)
   if(view){
    const {reference}=viewVersion(this.host.config,view[1]!,view[2]!)
    return {kind:'workspace-view',id:reference.id,version:reference.version,digest:reference.sha256}
   }
   throw unavailable()
  }))}catch{throw unavailable()}
 }
 private current(path:string,owner:string){
  const source=this.source(path,owner),sourceSnapshot=stableDigest(['artifact-discussion-source',source])
  const id=stableDigest(['artifact-discussion',owner,sourceSnapshot])
  const stored=this.host.store.get<StoredDiscussion>(recordKind,id)
  if(this.host.memory.cleanup.blocked(recordKind,id,stored??{owner,source})||
   stored&&(stored.owner!==owner||stableDigest(['artifact-discussion-source',stored.source])!==sourceSnapshot||!Array.isArray(stored.entries)))throw unavailable()
  return {id,source,sourceSnapshot,entries:stored?.entries??[]}
 }
 private response(current:ReturnType<ArtifactDiscussion['current']>){
  const {source,sourceSnapshot,entries}=current
  return {source:{kind:source.kind,id:source.id,version:source.version,digest:source.digest},sourceSnapshot,entries,limit:commentLimit}
 }
 read(path:string,owner:string){return this.response(this.current(path,owner))}
 append(path:string,owner:string,raw:unknown){
  const input=appendSchema.parse(raw)
  return this.host.store.atomic(()=>{
   const current=this.current(path,owner)
   if(input.sourceSnapshot!==current.sourceSnapshot)throw new ArtifactDiscussionError('artifact_discussion_snapshot_changed',409)
   const {operationId,kind,text,selection}=input
   const data={kind,text,...(selection?{selection}:{})}
   const existing=current.entries.find(entry=>entry.id===operationId)
   if(existing){
    if(stableDigest({kind:existing.kind,text:existing.text,...(existing.selection?{selection:existing.selection}:{})})!==stableDigest(data))throw new ArtifactDiscussionError('artifact_discussion_operation_conflict',409)
    return this.response(current)
   }
   if(current.entries.length>=commentLimit)throw new ArtifactDiscussionError('artifact_discussion_full',409)
   const entries=[...current.entries,{...data,id:operationId,at:Date.now()}]
   this.host.store.put(recordKind,current.id,{owner,source:current.source,entries} satisfies StoredDiscussion)
   return this.response({...current,entries})
  })
 }
}
