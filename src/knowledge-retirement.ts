import type {Store} from './store.ts'

interface LegacyDocument {id:string;kind:string;revision:number}
interface Row {kind:string;id:string;body:any}

/** Retire Wiki data before exposing the library. Run on every startup so restoring
 * an old database cannot silently re-enable it. Ordinary documents are retained,
 * including documents whose earlier revisions used to be Wiki pages.
 */
export function retireWikiData(store:Store){
 return store.atomic(()=>{
  const rows=store.db.prepare("SELECT kind,id,body FROM records WHERE kind IN ('knowledge-document','knowledge-version','knowledge-chunk','knowledge-receipt','knowledge-retired')").all().map(r=>({kind:String(r.kind),id:String(r.id),body:JSON.parse(String(r.body))} satisfies Row))
  const current=new Map(rows.filter(r=>r.kind==='knowledge-document').map(r=>[r.body.id,r.body as LegacyDocument]))
  const retired=new Set<string>(rows.filter(r=>r.kind==='knowledge-retired').map(r=>r.id))
  const versions=new Set<string>(),wikiIds=new Set<string>()
  const versionKey=(id:string,revision:number)=>JSON.stringify([id,revision])
  for(const r of rows){
   const d=r.kind==='knowledge-receipt'?r.body.result:r.body
   if(d?.kind==='wiki'&&['knowledge-document','knowledge-version','knowledge-receipt'].includes(r.kind)){
    const id=r.kind==='knowledge-receipt'?r.body.documentId:d.id
    wikiIds.add(id);versions.add(versionKey(id,d.revision))
   }
  }
  for(const id of wikiIds)if(current.get(id)?.kind!=='document')retired.add(id)
  const removedVersion=(id:string,revision:number)=>retired.has(id)||versions.has(versionKey(id,revision))
  const counts={documents:0,versions:0,chunks:0,indexEntries:0,receipts:0,tombstones:0}
  const chunkIds=new Set<string>()
  const erase=store.db.prepare('DELETE FROM records WHERE kind=? AND id=?')
  for(const r of rows){
   const d=r.body
   if(r.kind==='knowledge-document'&&retired.has(d.id)){erase.run(r.kind,r.id);counts.documents++}
   if(r.kind==='knowledge-version'&&removedVersion(d.id,d.revision)){erase.run(r.kind,r.id);counts.versions++}
   if(r.kind==='knowledge-chunk'&&removedVersion(d.documentId,d.revision)){chunkIds.add(r.id);erase.run(r.kind,r.id);counts.chunks++}
   if(r.kind==='knowledge-receipt'&&removedVersion(d.documentId,d.result?.revision)){erase.run(r.kind,r.id);counts.receipts++}
  }
  // Also remove orphaned index rows: chunk keys have two numeric suffixes.
  // Parse from the right so a document ID containing ':' cannot overlap another.
  const deleteIndex=store.db.prepare('DELETE FROM memory_search WHERE id=?')
  for(const row of store.db.prepare('SELECT DISTINCT id FROM memory_search').all()){
   const id=String(row.id),match=/^(.*):(\d+):(\d+)$/u.exec(id)
   if(chunkIds.has(id)||match&&removedVersion(match[1]!,Number(match[2])))counts.indexEntries+=Number(deleteIndex.run(id).changes)
  }
  for(const id of retired)if(!store.get('knowledge-retired',id)){
   // No title, body, slug, links or source text survives in this ID reservation.
   store.put('knowledge-retired',id,{id,reason:'wiki-removed'});counts.tombstones++
  }
  if(Object.values(counts).some(n=>n>0)){
   // FTS deletion alone can retain obsolete terms in its internal segments.
   store.db.exec("INSERT INTO memory_search(memory_search) VALUES('rebuild')")
   store.put('knowledge-retirement','wiki-v1',{version:1,at:Date.now(),...counts})
  }
  return counts
 })
}
