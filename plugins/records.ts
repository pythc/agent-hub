import type {RecordQuery,RecordPage} from '../src/sources.ts'
type RecordsContext={records?:(kind:string,query?:RecordQuery)=>Promise<RecordPage>;store:Pick<import('../src/store.ts').Store,'get'>&Partial<Pick<import('../src/store.ts').Store,'db'>>}
/** The same adapter works in legacy host mode and with the bounded v2 broker. */
export async function records<T=any>(ctx:RecordsContext,kind:string,query:RecordQuery={}):Promise<RecordPage<T>>{
  if(ctx.records)return ctx.records(kind,query)
  const rows=query.ids?[...new Set(query.ids)].flatMap(id=>{const value=ctx.store.get<T>(kind,id);return value===undefined?[]:[{id,value}]}):ctx.store.db!.prepare('SELECT id,body FROM records WHERE kind=? ORDER BY id').all(kind).map(r=>({id:String(r.id),value:JSON.parse(String(r.body))}))
  rows.sort((a,b)=>Buffer.compare(Buffer.from(a.id),Buffer.from(b.id)))
  const filtered=rows.filter(({id,value:v})=>(!query.cursor||id>query.cursor)&&(!query.sourceId||((v.source??v.ref?.source??v.sourceId)===query.sourceId||id===query.sourceId||id.startsWith(query.sourceId+':')))&&(!query.scope||(kind==='thread'?v.ref?.id===query.scope||v.ref?.id?.startsWith(query.scope+':'):(v.meta?.scope??v.meta?.chat??v.scope??v.chat)===query.scope))&&(!query.messageIds||query.messageIds.includes(v.meta?.messageId??v.messageId))&&(!query.subscribed||v.subscriptions?.length))
  const items=filtered.slice(0,query.limit??100)
  return {items,...(filtered.length>items.length?{next:items.at(-1)!.id}:{})}
}
export async function record<T=any>(ctx:RecordsContext,kind:string,id:string):Promise<T|undefined>{return (await records<T>(ctx,kind,{ids:[id]})).items[0]?.value}
export async function* recordPages<T=any>(ctx:RecordsContext,kind:string,query:RecordQuery={}){
  let cursor=query.cursor
  do{const page=await records<T>(ctx,kind,{...query,cursor});yield page.items.map(r=>r.value);cursor=page.next}while(cursor)
}
