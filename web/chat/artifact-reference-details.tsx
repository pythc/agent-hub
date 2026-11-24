import type {ArtifactRegistrationState,VersionedArtifactReference} from '../../src/artifact-reference.ts'
import './artifact-reference-details.css'

type Localize=(en:string,zh:string)=>string
/** Presentation only. Neither a resolver nor evidence of current authorization. */
export function ArtifactReferenceDetails({reference,current='unchecked',registrationState,L}:{reference?:VersionedArtifactReference;registrationState?:ArtifactRegistrationState;current?:'available'|'unavailable'|'unchecked';L:Localize}){
 const kind=reference?.kind
 return <details className="artifact-reference-details"><summary>{L('Version information','版本信息')}</summary>
  <dl>
   <div><dt>{L('Kind','类型')}</dt><dd>{kind==='goal-artifact'?L('Task file','任务文件'):kind==='chat-attachment'?L('Conversation attachment','会话附件'):kind==='workspace-view'?L('Workspace view package','工作区视图包'):L('Not recorded','未记录')}</dd></div>
   <div><dt>{L('Current access','当前访问')}</dt><dd>{current==='available'?L('Available through the existing entry; access is checked again on use.','可通过原有入口访问；使用时仍会重新检查权限。'):current==='unavailable'?L('Unavailable in this context.','在当前上下文中不可用。'):L('Not checked. The existing entry may no longer be available.','尚未检查，原有入口可能已不可用。')}</dd></div>
   <div><dt>ID</dt><dd>{reference?.id??L('Not recorded','未记录')}</dd></div>
   <div><dt>{L('Version','版本')}</dt><dd>{reference?.version??L('Not recorded','未记录')}</dd></div>
   <div><dt>SHA-256</dt><dd>{reference?.sha256??L('Not recorded','未记录')}</dd></div>
   {registrationState?<div><dt>{L('Registration','登记')}</dt><dd>{registrationState==='recorded'?L('Recorded by the source','来源已登记'):L('Source reference only','仅有来源引用')}</dd></div>:null}
   <div><dt>{L('Access scope','访问范围')}</dt><dd>{reference?.visibility==='conversation'?L('This conversation','当前会话'):reference?.visibility==='operator_workspace'?L('Authorized workspace operators','工作区获授权的操作者'):L('Not recorded','未记录')}</dd></div>
  </dl>
  <p>{kind==='goal-artifact'?L('The file entry selects retained bytes for this version. History cleanup can remove them.','文件入口选择此版本保留的内容，历史清理可能将其删除。'):kind==='workspace-view'?L('This digest identifies a verified package, not a runtime snapshot. Retained metadata can be inspected through a fixed-version entry. Historical execution is not supported; removal or cleanup may make it unavailable.','此摘要标识已校验的视图包，不是运行时快照。可通过固定版本入口查看保留的元数据，不支持执行历史包；移除或清理可能使其不可用。'):!kind?L('No version identity was recorded. Historical version opening is not supported.','未记录版本身份，不支持打开历史版本。'):reference?.sha256?L('When offered, Download recorded version checks retained bytes against this digest and rechecks conversation access. Removed or changed versions are unavailable, never replaced by newer bytes. The ordinary attachment entry is not version-pinned.','如有“下载记录的版本”入口，会核对保留内容与此摘要并重新检查会话权限。已删除或已变更的版本不可用，不会替换成新内容。普通附件入口不绑定固定版本。'):L('No digest was recorded for this attachment. Fixed-version downloading is unavailable; the ordinary entry is not version-pinned.','此附件未记录摘要，无法下载固定版本；普通入口不绑定版本。')}</p>
  <p>{L('Version metadata does not grant access or establish acceptance, sending or publication.','版本信息不授予访问权限，也不表示已验收、发送或发布。')}</p>
 </details>
}
