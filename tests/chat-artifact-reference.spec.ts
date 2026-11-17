import {afterEach,expect,it} from 'vitest'
import {mkdtempSync,rmSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createHash,randomUUID} from 'node:crypto'
import {Readable} from 'node:stream'
import {stableDigest} from '../src/sources.ts'
import {Runtime} from '../src/runtime.ts'
import {configSchema} from '../src/config.ts'
const hosts:Runtime[]=[],roots:string[]=[]
afterEach(async()=>{for(const h of hosts.splice(0))await h.close();for(const p of roots.splice(0))rmSync(p,{recursive:true,force:true})})
function fixture(){
 const root=mkdtempSync(join(tmpdir(),'chat-reference-'));roots.push(root)
 const config=configSchema.parse({stateDir:join(root,'state'),port:0,work:{sandboxDriver:'disabled'},execution:{router:{mode:'host',model:'router-one',effort:'medium'},management:{enabled:true},workers:[{id:'research',label:'Research',backend:'codex'}]},sources:[{id:'local',kind:'local',cwd:root,allowedActors:['operator']}]})
 const model={async run(){throw Error('No model calls')}}
 const h=new Runtime(config,{model});hosts.push(h)
 return {h,config,model}
}
it('records exact streamed bytes as a conversation-scoped version without changing access',async()=>{
 const {h}=fixture(),c=h.chat.create('owner'),other=h.chat.create('other')
 const chunks=[Buffer.from('A😀'),Buffer.from('\0B')],bytes=Buffer.concat(chunks),id=randomUUID()
 const file=await h.chat.uploads.upload(c.id,'owner',id,{name:'notes.txt',mimeType:'text/plain'},Readable.from(chunks))
 expect(file.reference).toEqual({schema:1,kind:'chat-attachment',id:stableDigest(['chat-attachment-version',id,createHash('sha256').update(bytes).digest('hex')]),version:1,sha256:createHash('sha256').update(bytes).digest('hex'),visibility:'conversation',retention:'subject_to_history_cleanup',publication:'not_tracked'})
 expect(readFileSync(h.chat.uploads.download(c.id,'owner',id).path)).toEqual(bytes)
 expect(h.chat.uploads.resolve(c.id,'owner',[id])[0]?.reference).toEqual(file.reference)
 expect(()=>h.chat.uploads.download(c.id,'other',id)).toThrow()
 expect(()=>h.chat.uploads.resolve(other.id,'other',[id])).toThrow()
 await expect(h.chat.uploads.upload(c.id,'owner',id,{name:'changed.txt',mimeType:'text/plain'},Readable.from([Buffer.from('new')]))).rejects.toThrow('identity already exists')
 const next=await h.chat.uploads.upload(c.id,'owner',randomUUID(),{name:'notes.txt',mimeType:'text/plain'},Readable.from([Buffer.from('new')]))
 expect(next.reference?.id).not.toBe(id);expect(next.reference?.sha256).not.toBe(file.reference?.sha256)
 h.chat.uploads.remove(c.id,'owner',id)
 const reused=await h.chat.uploads.upload(c.id,'owner',id,{name:'notes.txt',mimeType:'text/plain'},Readable.from([Buffer.from('replacement')]))
 expect(reused.id).toBe(file.id);expect(reused.reference?.id).not.toBe(file.reference?.id)
})
it('preserves recorded identity after restart and represents legacy digests as unknown without backfill',async()=>{
 const {h,config,model}=fixture(),c=h.chat.create('owner'),id=randomUUID()
 const file=await h.chat.uploads.upload(c.id,'owner',id,{name:'old.txt',mimeType:'text/plain'},Readable.from([Buffer.from('original')]))
 hosts.splice(hosts.indexOf(h),1);await h.close()
 const reopened=new Runtime(config,{model});hosts.push(reopened)
 expect(reopened.chat.uploads.drafts(c.id,'owner')[0]?.reference).toEqual(file.reference)
 const row=reopened.store.get<any>('asset',id);delete row.sha256;row.name='renamed.txt';reopened.store.put('asset',id,row)
 const before=reopened.store.get<any>('asset',id)
 expect(reopened.chat.uploads.drafts(c.id,'owner')[0]).toMatchObject({id,name:'renamed.txt',reference:{id,version:null,sha256:null}})
 expect(reopened.store.get('asset',id)).toEqual(before)
 reopened.chat.uploads.remove(c.id,'owner',id)
 expect(reopened.chat.uploads.drafts(c.id,'owner')).toEqual([])
 expect(()=>reopened.chat.uploads.download(c.id,'owner',id)).toThrow()
})
it('does not publish partial hashes when a stream fails or authorization is revoked',async()=>{
 const {h}=fixture(),c=h.chat.create('owner'),id=randomUUID()
 async function* broken(){yield Buffer.from('partial');throw Error('stream failed')}
 await expect(h.chat.uploads.upload(c.id,'owner',id,{name:'bad',mimeType:'text/plain'},broken())).rejects.toThrow('stream failed')
 expect(h.store.get('asset',id)).toBeUndefined()
 const denied=randomUUID()
 await expect(h.chat.uploads.upload(c.id,'owner',denied,{name:'bad',mimeType:'text/plain'},Readable.from([Buffer.from('done')]),()=>{throw Error('revoked')})).rejects.toThrow('revoked')
 expect(h.store.get('asset',denied)).toBeUndefined();expect(h.chat.uploads.drafts(c.id,'owner')).toEqual([])
})
