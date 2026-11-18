import {spawnSync} from 'node:child_process'
import {serve} from '../src/server.ts'
import {planChatHistory} from '../src/history-cleanup.ts'
import {afterEach,expect,it} from 'vitest'
import {mkdtempSync,rmSync,readFileSync,writeFileSync,symlinkSync} from 'node:fs'
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
 expect(reused.registration?.referenceId).not.toBe(file.registration?.referenceId)
})
it('preserves recorded identity after restart and represents legacy digests as unknown without backfill',async()=>{
 const {h,config,model}=fixture(),c=h.chat.create('owner'),id=randomUUID()
 const file=await h.chat.uploads.upload(c.id,'owner',id,{name:'old.txt',mimeType:'text/plain'},Readable.from([Buffer.from('original')]))
 hosts.splice(hosts.indexOf(h),1);await h.close()
 const reopened=new Runtime(config,{model});hosts.push(reopened)
 expect(reopened.chat.uploads.drafts(c.id,'owner')[0]?.reference).toEqual(file.reference)
 expect(reopened.chat.uploads.drafts(c.id,'owner')[0]?.registration).toEqual(file.registration)
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

it('opens the exact retained attachment version across rename/restart and rejects ID reuse, altered bytes and legacy records',async()=>{
 const {h,config,model}=fixture(),c=h.chat.create('owner'),id=randomUUID(),original=Buffer.from('original bytes')
 const file=await h.chat.uploads.upload(c.id,'owner',id,{name:'before.txt',mimeType:'text/plain'},Readable.from([original])),digest=file.reference!.sha256!
 const row=h.store.get<any>('asset',id);h.store.put('asset',id,{...row,name:'after.txt'})
 const before=h.store.db.prepare('SELECT total_changes() AS n').get()!.n
 expect(h.chat.uploads.downloadVersion(c.id,'owner',id,digest)).toMatchObject({file:{name:'after.txt'},content:original})
 expect(h.store.db.prepare('SELECT total_changes() AS n').get()!.n).toBe(before)
 await h.chat.uploads.upload(c.id,'owner',randomUUID(),{name:'after.txt',mimeType:'text/plain'},Readable.from([Buffer.from('newer')]))
 expect(h.chat.uploads.downloadVersion(c.id,'owner',id,digest).content).toEqual(original)
 expect(()=>h.chat.uploads.downloadVersion(c.id,'other',id,digest)).toThrow('unavailable')
 expect(()=>h.chat.uploads.downloadVersion(c.id,'owner',id,'a'.repeat(64))).toThrow('unavailable')
 hosts.splice(hosts.indexOf(h),1);await h.close();const reopened=new Runtime(config,{model});hosts.push(reopened)
 expect(reopened.chat.uploads.downloadVersion(c.id,'owner',id,digest).content).toEqual(original)
 const path=reopened.chat.uploads.download(c.id,'owner',id).path
 writeFileSync(path,Buffer.from('tampered bytes'));expect(()=>reopened.chat.uploads.downloadVersion(c.id,'owner',id,digest)).toThrow('unavailable')
 writeFileSync(path,original);const saved=reopened.store.get<any>('asset',id);delete saved.sha256;reopened.store.put('asset',id,saved)
 expect(()=>reopened.chat.uploads.downloadVersion(c.id,'owner',id,digest)).toThrow('unavailable')
 reopened.chat.uploads.remove(c.id,'owner',id)
 await reopened.chat.uploads.upload(c.id,'owner',id,{name:'reuse.txt',mimeType:'text/plain'},Readable.from([Buffer.from('replacement')]))
 expect(()=>reopened.chat.uploads.downloadVersion(c.id,'owner',id,digest)).toThrow('unavailable')
})
it('rejects symlink, deleted and cleanup-blocked pinned bytes without creating new retention',async()=>{
 const {h}=fixture(),c=h.chat.create('owner'),id=randomUUID()
 const file=await h.chat.uploads.upload(c.id,'owner',id,{name:'file.txt',mimeType:'text/plain'},Readable.from([Buffer.from('bytes')])),digest=file.reference!.sha256!,path=h.chat.uploads.download(c.id,'owner',id).path
 const alternate=path+'.other';writeFileSync(alternate,'bytes');rmSync(path);symlinkSync(alternate,path)
 expect(()=>h.chat.uploads.downloadVersion(c.id,'owner',id,digest)).toThrow('unavailable')
 rmSync(path);expect(()=>h.chat.uploads.downloadVersion(c.id,'owner',id,digest)).toThrow('unavailable')
 if(process.platform!=='win32'){expect(spawnSync('mkfifo',[path]).status).toBe(0);expect(()=>h.chat.uploads.downloadVersion(c.id,'owner',id,digest)).toThrow('unavailable');rmSync(path)}
 writeFileSync(path,'bytes')
 h.memory.cleanup.apply(planChatHistory(h.store,h.config.stateDir,'@chat:'+stableDigest('owner'),'version-clear',Date.now(),[c.id]))
 expect(()=>h.chat.uploads.downloadVersion(c.id,'owner',id,digest)).toThrow('unavailable')
})
it('serves pinned downloads and HEAD only behind current HTTP authorization and does not fall back to live bytes',async()=>{
 const {h}=fixture(),c=h.chat.create('local-operator'),id=randomUUID(),content=Buffer.from('HTTP bytes')
 const file=await h.chat.uploads.upload(c.id,'local-operator',id,{name:'http.txt',mimeType:'text/plain'},Readable.from([content]))
 const http=await serve(h),headers={authorization:'Bearer '+readFileSync(http.tokenPath,'utf8').trim(),connection:'close'},url=http.url+file.url+'/versions/'+file.reference!.sha256
 try{
  expect((await fetch(url)).status).toBe(401)
  const response=await fetch(url,{headers});expect(response.status).toBe(200);expect(Buffer.from(await response.arrayBuffer())).toEqual(content);expect(response.headers.get('cache-control')).toBe('no-store');expect(response.headers.get('x-content-type-options')).toBe('nosniff');expect(response.headers.get('content-disposition')).toContain('attachment')
  const head=await fetch(url,{headers,method:'HEAD'});expect(head.status).toBe(200);expect(await head.text()).toBe('');expect(head.headers.get('content-length')).toBe(String(content.length))
  expect((await fetch(url,{headers,method:'POST'})).status).toBe(405)
  const other=h.chat.create('other'),wrong=http.url+'/api/chat/conversations/'+other.id+'/attachments/'+id+'/versions/'+file.reference!.sha256
  expect((await fetch(wrong,{headers})).status).toBe(404)
  writeFileSync(h.chat.uploads.download(c.id,'local-operator',id).path,'changed')
  const denied=await fetch(url,{headers});expect(denied.status).toBe(404);expect(await denied.json()).toMatchObject({code:'attachment_version_unavailable'})
  expect((await fetch(url,{headers,method:'HEAD'})).status).toBe(404)
 }finally{http.server.closeAllConnections();await new Promise<void>(r=>http.server.close(()=>r()))}
})

it('projects draft registration from authorized source rows without persisting or globally enumerating it',async()=>{
 const {h}=fixture(),c=h.chat.create('owner'),other=h.chat.create('other'),id=randomUUID()
 const file=await h.chat.uploads.upload(c.id,'owner',id,{name:'draft.txt',mimeType:'text/plain'},Readable.from([Buffer.from('draft bytes')]))
 const expected={schema:1,kind:'chat-attachment',domain:'conversation',conversationId:c.id,id,referenceId:file.reference!.id,version:1,sha256:file.reference!.sha256,retention:'subject_to_history_cleanup',publication:'not_tracked',acceptance:'not_tracked'}
 expect(file.registration).toEqual(expected)
 const before=h.store.get<any>('asset',id)
 expect(before).not.toHaveProperty('registration')
 expect(h.chat.uploads.drafts(c.id,'owner')[0]!.registration).toEqual(expected)
 expect(h.store.get('asset',id)).toEqual(before)
 expect(()=>h.chat.uploads.drafts(c.id,'other')).toThrow()
 expect(h.chat.uploads.drafts(other.id,'other')).toEqual([])
 expect(h.chat.uploads.resolve(c.id,'owner',[id])[0]).not.toHaveProperty('registration')
 const renamed={...before,name:'renamed.txt'};h.store.put('asset',id,renamed)
 expect(h.chat.uploads.drafts(c.id,'owner')[0]!.registration).toEqual(expected)
 h.chat.uploads.bind([id],'trigger-test')
 expect(h.chat.uploads.drafts(c.id,'owner')).toEqual([])
 expect(h.store.get<any>('asset',id)).not.toHaveProperty('registration')
})
it('omits legacy candidates and rechecks cleanup before draft metadata projection',async()=>{
 const {h}=fixture(),c=h.chat.create('owner'),id=randomUUID()
 await h.chat.uploads.upload(c.id,'owner',id,{name:'old.txt',mimeType:'text/plain'},Readable.from([Buffer.from('old')]))
 const row=h.store.get<any>('asset',id);delete row.sha256;h.store.put('asset',id,row)
 expect(h.chat.uploads.drafts(c.id,'owner')[0]).not.toHaveProperty('registration')
 h.memory.cleanup.apply(planChatHistory(h.store,h.config.stateDir,'@chat:'+stableDigest('owner'),'registration-clear',Date.now(),[c.id]))
 expect(()=>h.chat.uploads.drafts(c.id,'owner')).toThrow()
})
it('exposes draft candidates only through the existing authenticated conversation HTTP list',async()=>{
 const {h}=fixture(),c=h.chat.create('local-operator'),other=h.chat.create('other'),id=randomUUID()
 const file=await h.chat.uploads.upload(c.id,'local-operator',id,{name:'draft.txt',mimeType:'text/plain'},Readable.from([Buffer.from('bytes')]))
 const http=await serve(h),headers={authorization:'Bearer '+readFileSync(http.tokenPath,'utf8').trim(),connection:'close'},url=http.url+'/api/chat/conversations/'+c.id+'/attachments'
 try{
  expect((await fetch(url)).status).toBe(401)
  const response=await fetch(url,{headers});expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toBe('no-store')
  expect((await response.json()).attachments[0].registration).toEqual(file.registration)
  expect((await fetch(http.url+'/api/chat/conversations/'+other.id+'/attachments',{headers})).status).toBe(404)
  const catalog=await (await fetch(http.url+'/artifact-catalog',{headers})).json()
  expect(JSON.stringify(catalog)).not.toContain(id);expect(JSON.stringify(catalog)).not.toContain(c.id)
  h.chat.uploads.remove(c.id,'local-operator',id)
  expect((await (await fetch(url,{headers})).json()).attachments).toEqual([])
 }finally{http.server.closeAllConnections();await new Promise<void>(r=>http.server.close(()=>r()))}
})
