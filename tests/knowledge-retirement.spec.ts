import {afterEach,expect,it,vi} from 'vitest'
import {mkdtempSync,readFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {Store} from '../src/store.ts'
import {retireWikiData} from '../src/knowledge-retirement.ts'
import {knowledgeCommandSchema,knowledgeSpecs} from '../src/knowledge.ts'
import {workerDefinitions} from '../src/worker-tools.ts'

const roots:string[]=[],stores:Store[]=[]
afterEach(()=>{vi.restoreAllMocks();for(const s of stores.splice(0))s.close();for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true})})
function fixture(){
 const root=mkdtempSync(join(tmpdir(),'wiki-retirement-'));roots.push(root)
 const path=join(root,'state.sqlite'),store=new Store(path);stores.push(store)
 const index=(id:string,body:string)=>store.db.prepare('INSERT INTO memory_search(id,body) VALUES(?,?)').run(id,body)
 const document=(id:string,kind='wiki',revision=1,deleted=false)=>{
  const d={id,kind,revision,deleted,title:'Title',content:deleted?'':kind==='wiki'?'WIKI_ERASE_795':'KEEP_DOCUMENT_532',slug:'old/page',links:['related'],citations:[]}
  store.put('knowledge-document',id,d)
  store.put('knowledge-chunk',id+':'+revision+':0',{id:id+':'+revision+':0',documentId:id,revision,content:d.content})
  index(id+':'+revision+':0',d.content)
  store.put('knowledge-receipt','receipt-'+id,{documentId:id,result:d,fingerprint:'legacy'})
  return d
 }
 return {store,path,index,document}
}

it('removes live and deleted Wiki documents, all their versions, receipts and orphaned FTS rows',()=>{
 const f=fixture(),{store}=f
 const page=f.document('page:with:colon','wiki',3),deleted=f.document('deleted','wiki',2,true)
 for(const d of [page,deleted])store.put('knowledge-version',d.id+':1',{...d,revision:1,deleted:false,content:'WIKI_ERASE_795'})
 store.put('knowledge-version','page:with:colon:2',{...page,kind:'document',revision:2})
 f.index('page:with:colon:1:8','WIKI_ERASE_795 orphan')
 const ordinary=f.document('page:with:colon:child','document');ordinary.content='KEEP_DOCUMENT_532';store.put('knowledge-document',ordinary.id,ordinary)
 store.put('memory-fact','fact',{content:'KEEP_MEMORY_921',revision:7});f.index('fact','KEEP_MEMORY_921')
 const protectedRows=store.db.prepare("SELECT kind,id,body FROM records WHERE id IN (?,?,?) ORDER BY kind,id").all(ordinary.id,'receipt-'+ordinary.id,'fact')
 const result=retireWikiData(store)
 expect(result).toEqual({documents:2,versions:3,chunks:2,indexEntries:3,receipts:2,tombstones:2})
 expect(store.list('knowledge-document')).toEqual([ordinary]);expect(store.list('knowledge-version')).toEqual([])
 expect(store.list('knowledge-chunk')).toHaveLength(1);expect(store.list('knowledge-receipt')).toHaveLength(1)
 expect(store.list('knowledge-retired')).toEqual(expect.arrayContaining([{id:page.id,reason:'wiki-removed'},{id:deleted.id,reason:'wiki-removed'}]));expect(store.list('knowledge-retired')).toHaveLength(2)
 expect(store.db.prepare('SELECT kind,id,body FROM records WHERE id IN (?,?,?) ORDER BY kind,id').all(ordinary.id,'receipt-'+ordinary.id,'fact')).toEqual(protectedRows)
 expect(store.db.prepare("SELECT id FROM memory_search WHERE memory_search MATCH 'KEEP_MEMORY_921'").all()).toHaveLength(1)
 expect(store.db.prepare('SELECT id FROM memory_search').all().filter(row=>String(row.id).startsWith('page:with:colon:'))).toEqual([{id:ordinary.id+':1:0'}])
})

it('keeps current ordinary documents while erasing their former Wiki revisions and receipts',()=>{
 const f=fixture(),{store}=f,d=f.document('converted','document',3)
 store.put('knowledge-version','converted:1',{...d,kind:'wiki',revision:1})
 store.put('knowledge-version','converted:2',{...d,revision:2})
 store.put('knowledge-receipt','old-write',{documentId:d.id,result:{...d,kind:'wiki',revision:1}})
 f.index('converted:1:5','old Wiki')
 expect(retireWikiData(store)).toMatchObject({documents:0,versions:1,indexEntries:1,receipts:1,tombstones:0})
 expect(store.get('knowledge-document',d.id)).toEqual(d)
 expect(store.list<any>('knowledge-version').map(v=>v.revision)).toEqual([2])
 expect(store.list('knowledge-receipt')).toHaveLength(1)
})

it('cleans orphan-only Wiki versions and receipts and never reuses retired IDs after a restore',()=>{
 const f=fixture(),{store}=f
 store.put('knowledge-version','orphan:1',{id:'orphan',kind:'wiki',revision:1,content:'old body'})
 store.put('knowledge-receipt','orphan-receipt',{documentId:'receipt-only',result:{id:'receipt-only',kind:'wiki',revision:2}})
 f.index('receipt-only:2:9','orphan index')
 retireWikiData(store)
 expect(store.list('knowledge-version')).toEqual([]);expect(store.list('knowledge-receipt')).toEqual([])
 expect(store.db.prepare('SELECT id FROM memory_search').all()).toEqual([])
 const marker=store.get('knowledge-retirement','wiki-v1')
 expect(Object.values(retireWikiData(store)).every(n=>n===0)).toBe(true)
 expect(store.get('knowledge-retirement','wiki-v1')).toEqual(marker)
 f.document('orphan','document',2)
 retireWikiData(store)
 expect(store.get('knowledge-document','orphan')).toBeUndefined()
 expect(store.list('knowledge-retired')).toHaveLength(2)
})

it('rolls back records, ID reservations and FTS together on failure, then safely retries',()=>{
 const f=fixture(),{store}=f;f.document('rollback')
 const before=store.db.prepare('SELECT * FROM records ORDER BY kind,id').all(),index=store.db.prepare('SELECT * FROM memory_search').all()
 const put=store.put.bind(store)
 vi.spyOn(store,'put').mockImplementation((kind,id,value)=>{if(kind==='knowledge-retirement')throw Error('injected migration failure');put(kind,id,value)})
 expect(()=>retireWikiData(store)).toThrow('injected migration failure')
 expect(store.db.prepare('SELECT * FROM records ORDER BY kind,id').all()).toEqual(before)
 expect(store.db.prepare('SELECT * FROM memory_search').all()).toEqual(index)
 expect(store.db.prepare("SELECT id FROM memory_search WHERE memory_search MATCH 'WIKI_ERASE_795'").all()).toHaveLength(1)
 vi.restoreAllMocks()
 expect(retireWikiData(store).documents).toBe(1)
 expect(store.db.prepare("SELECT id FROM memory_search WHERE memory_search MATCH 'WIKI_ERASE_795'").all()).toEqual([])
 stores.splice(stores.indexOf(store),1);store.close()
 expect(readFileSync(f.path).includes(Buffer.from('WIKI_ERASE_795'))).toBe(false)
 const reopened=new Store(f.path);stores.push(reopened)
 expect(Object.values(retireWikiData(reopened)).every(n=>n===0)).toBe(true)
})

it('rejects removed Wiki commands in both Router and Worker contracts',()=>{
 const worker=workerDefinitions.find(d=>d.name==='superagent_knowledge')!
 for(const input of [{action:'links',id:'old'},{action:'list',kind:'wiki'},{action:'put',title:'old',content:'body',slug:'old'}]){
  expect(knowledgeCommandSchema.safeParse(input).success).toBe(false)
  expect(worker.validator.safeParse(input).success).toBe(false)
 }
 expect(knowledgeCommandSchema.safeParse({action:'put',kind:'document',title:'new',content:'[[literal text]]'}).success).toBe(true)
 for(const schema of [knowledgeSpecs[0]!.inputSchema,worker.schema]){
  const value=schema as any
  expect(value.properties.action.enum).not.toContain('links')
  expect(value.properties.kind.enum).toEqual(['document'])
  expect(value.properties.slug).toBeUndefined()
 }
})
