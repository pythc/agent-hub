import * as viewPackages from '../src/workspace-view-package.ts'
import {DatabaseSync} from 'node:sqlite'
import {expect,it,vi} from 'vitest'
import {artifactCatalog} from '../src/artifact-catalog.ts'
import {parseArtifactCatalog} from '../web/chat/artifact-catalog-model.ts'
import type {Runtime} from '../src/runtime.ts'
const ref=(id:string)=>({schema:1 as const,kind:'goal-artifact' as const,id,version:1,sha256:'b'.repeat(64),name:'report.pdf',mediaType:'application/pdf',bytes:1,category:'document' as const,visibility:'operator_workspace' as const,retention:'subject_to_history_cleanup' as const,availability:'retained' as const,publication:'not_tracked' as const,downloadPath:'/goal-artifacts/'+id})
function fixture(count=250){
 const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE records(kind TEXT,id TEXT,body TEXT,PRIMARY KEY(kind,id))')
 const rows=Array.from({length:count},(_,i)=>({id:i.toString(16).padStart(64,'0')}))
 for(const row of rows)db.prepare('INSERT INTO records VALUES(?,?,?)').run('goal-artifact',row.id,'{}')
 const denied=new Set<string>(),describe=vi.fn((id:string)=>{if(denied.has(id))throw Error('private');return ref(id)})
 const host={store:{db},artifacts:{describe},config:{viewPlugins:[]}} as unknown as Runtime
 return {db,rows,denied,describe,host}
}
it('keyset-pages beyond the old cap, rechecks access on replay and never exposes hidden IDs in cursors',()=>{
 const f=fixture()
 try{
  f.denied.add(f.rows[0]!.id)
  let page=artifactCatalog(f.host),seen=page.items.map(i=>i.reference.id)
  expect(page.items).toHaveLength(100);expect(page.nextCursor).toMatch(/^[a-f0-9-]{36}$/);expect(page.nextCursor).not.toContain(f.rows[0]!.id)
  expect(parseArtifactCatalog(page)).toEqual(page)
  const cursor=page.nextCursor!
  while(page.nextCursor){page=artifactCatalog(f.host,page.nextCursor);expect(page.items.length).toBeLessThanOrEqual(100);seen.push(...page.items.map(i=>i.reference.id))}
  expect(seen).toEqual(f.rows.slice(1).map(r=>r.id));expect(page.truncated).toBe(false)
  f.denied.add(f.rows[101]!.id);expect(artifactCatalog(f.host,cursor).items.some(i=>i.reference.id===f.rows[101]!.id)).toBe(false)
 }finally{f.db.close()}
})
it('bounds scans even for inaccessible rows and keeps cursor lifetime/workspace/cache bounded',()=>{
 const f=fixture(450),other=fixture(0)
 try{
  for(const row of f.rows)f.denied.add(row.id)
  const first=artifactCatalog(f.host);expect(first.items).toEqual([]);expect(f.describe).toHaveBeenCalledTimes(200);expect(first.nextCursor).not.toBeNull()
  expect(()=>artifactCatalog(other.host,first.nextCursor!)).toThrow('catalog_cursor_expired')
  expect(()=>artifactCatalog(f.host,'invalid')).toThrow('catalog_cursor_expired')
  const second=artifactCatalog(f.host,first.nextCursor!);expect(f.describe).toHaveBeenCalledTimes(400);expect(second.nextCursor).not.toBeNull()
  expect(artifactCatalog(f.host,second.nextCursor!).nextCursor).toBeNull()
  for(let i=0;i<257;i++)artifactCatalog(f.host)
  expect(()=>artifactCatalog(f.host,first.nextCursor!)).toThrow('catalog_cursor_expired')
  const timed=artifactCatalog(f.host).nextCursor!
  const now=vi.spyOn(Date,'now').mockReturnValue(Date.now()+600001)
  try{expect(()=>artifactCatalog(f.host,timed)).toThrow('catalog_cursor_expired')}finally{now.mockRestore()}
 }finally{f.db.close();other.db.close()}
})
it('rejects malformed, duplicate, conversation and unsafe navigation identities',()=>{
 const item={label:{en:'report','zh-CN':'报告'},reference:ref('a'.repeat(64))},catalog={schema:1,items:[item],truncated:false,nextCursor:null}
 expect(parseArtifactCatalog(catalog)).toEqual(catalog)
 expect(parseArtifactCatalog({...catalog,nextCursor:'bad'})).toBeNull()
 expect(parseArtifactCatalog({...catalog,truncated:true})).toBeNull()
 expect(parseArtifactCatalog({...catalog,items:[item,item]})).toBeNull()
 for(const override of [{kind:'chat-attachment'},{id:'../x'},{downloadPath:'https://evil.test'}])expect(parseArtifactCatalog({...catalog,items:[{...item,reference:{...item.reference,...override}}]})).toBeNull()
 const view={schema:1,kind:'workspace-view',id:'board',version:'a'.repeat(64),sha256:'b'.repeat(64),visibility:'operator_workspace',retention:'subject_to_plugin_removal',publication:'not_tracked'}
 expect(parseArtifactCatalog({...catalog,items:[{...item,reference:view}]})).not.toBeNull()
 expect(parseArtifactCatalog({...catalog,items:[{...item,reference:{...view,id:'../board'}}]})).toBeNull()
})

it('continues from task versions into view packages with bounded verification and no duplicates',()=>{
 const f=fixture(98),refs=Array.from({length:205},(_,i)=>({id:'view-'+String(i).padStart(3,'0'),enabled:true,directory:'unused',digest:'a'.repeat(64)}))
 f.host.config.viewPlugins=refs
 const verify=vi.spyOn(viewPackages,'enabledView').mockImplementation((_config,id)=>({digest:'a'.repeat(64),manifest:{id,label:{en:id,'zh-CN':id},codeSha256:'b'.repeat(64)}} as ReturnType<typeof viewPackages.enabledView>))
 try{
  let page=artifactCatalog(f.host),items=[...page.items]
  expect(page.items).toHaveLength(100);expect(verify).toHaveBeenCalledTimes(2)
  while(page.nextCursor){page=artifactCatalog(f.host,page.nextCursor);items.push(...page.items)}
  expect(items).toHaveLength(303);expect(new Set(items.map(i=>i.reference.kind+':'+i.reference.id)).size).toBe(303)
  verify.mockImplementation(()=>{throw Error('unavailable')});verify.mockClear()
  const other=fixture(0);other.host.config.viewPlugins=refs
  try{const hidden=artifactCatalog(other.host);expect(hidden.items).toEqual([]);expect(verify).toHaveBeenCalledTimes(200);expect(hidden.nextCursor).not.toBeNull();expect(artifactCatalog(other.host,hidden.nextCursor!).nextCursor).toBeNull();expect(verify).toHaveBeenCalledTimes(205)}finally{other.db.close()}
 }finally{verify.mockRestore();f.db.close()}
})

it('projects source-owned registration only after authorization and validates optional provenance',()=>{
 const f=fixture(2)
 try{
  f.denied.add(f.rows[1]!.id)
  const before=f.db.prepare('SELECT * FROM records ORDER BY id').all(),page=artifactCatalog(f.host),item=page.items[0]!
  expect(page.items).toHaveLength(1)
  expect(item.registration).toEqual({schema:1,kind:'goal-artifact',domain:'operator_workspace',id:item.reference.id,version:1,sha256:'b'.repeat(64),retention:'subject_to_history_cleanup',publication:'not_tracked',acceptance:'not_tracked'})
  expect(parseArtifactCatalog(page)).toEqual(page)
  for(const patch of [{domain:'conversation'},{id:f.rows[1]!.id},{version:2},{acceptance:'accepted'},{authorized:true}])expect(parseArtifactCatalog({...page,items:[{...item,registration:{...item.registration,...patch}}]})).toBeNull()
  expect(f.db.prepare('SELECT * FROM records ORDER BY id').all()).toEqual(before)
 }finally{f.db.close()}
})
