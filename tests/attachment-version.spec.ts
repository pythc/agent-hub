import {expect,it} from 'vitest'
import {attachmentVersionPath} from '../web/chat/attachment-version.ts'
import type {ChatAttachment} from '../src/chat-attachments.ts'
const file:ChatAttachment={id:'a'.repeat(36),name:'file',mimeType:'text/plain',bytes:1,url:'/api/chat/conversations/'+'b'.repeat(36)+'/attachments/'+'a'.repeat(36),reference:{schema:1,kind:'chat-attachment',id:'c'.repeat(64),version:1,sha256:'d'.repeat(64),visibility:'conversation',retention:'subject_to_history_cleanup',publication:'not_tracked'}}
it('derives pinned paths only from matching conversation attachment routes with recorded digests',()=>{
 expect(attachmentVersionPath(file)).toBe(file.url+'/versions/'+'d'.repeat(64))
 for(const url of ['https://other.test'+file.url,'//other.test'+file.url,file.url+'?preview=1',file.url+'/../else','/goal-artifacts/a'])expect(attachmentVersionPath({...file,url})).toBeNull()
 expect(attachmentVersionPath({...file,id:'wrong'})).toBeNull()
 expect(attachmentVersionPath({...file,reference:undefined})).toBeNull()
 expect(attachmentVersionPath({...file,reference:{...file.reference!,version:null,sha256:null}})).toBeNull()
 expect(attachmentVersionPath({...file,reference:{...file.reference!,sha256:'../other'}})).toBeNull()
})
