import type {ChatAttachment} from '../../src/chat-attachments.ts'
/** Derive only from this attachment's existing conversation URL, never from a free-form reference link. */
export function attachmentVersionPath(file:ChatAttachment):string|null {
 const ref=file.reference,match=file.url.match(/^\/api\/chat\/conversations\/([a-f0-9-]{36})\/attachments\/([a-f0-9-]{36})$/)
 if(!match||match[2]!==file.id||ref?.kind!=='chat-attachment'||ref.schema!==1||ref.version!==1||typeof ref.sha256!=='string'||!/^[a-f0-9]{64}$/.test(ref.sha256))return null
 return file.url+'/versions/'+ref.sha256
}
