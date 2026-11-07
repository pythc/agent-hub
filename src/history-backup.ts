import type {DatabaseSync} from 'node:sqlite'
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs'
import {join} from 'node:path'
import {stableDigest} from './sources.ts'
import {BackendRegistry} from './backends/registry.ts'
import type {Config} from './config.ts'
export interface HistoryReference {threadId:string;cwd:string;backendId:string}
export type HistoryReader=(ref:HistoryReference)=>Promise<unknown>
export function historyReferences(db:DatabaseSync){
 const rows=db.prepare('SELECT kind,id,body FROM records').all().map(r=>({kind:String(r.kind),id:String(r.id),body:JSON.parse(String(r.body))})),refs=new Map<string,HistoryReference>(),required=new Set<string>()
 for(const r of rows)if(['run','work','model-session','router-session','context-handoff','worker-migration'].includes(r.kind)&&!r.body.ephemeral){
  const v=r.body,run=rows.find(x=>x.kind==='run'&&x.id===v.ticketId)?.body
  for(const threadId of [v.threadId,v.previousThread,v.from?.threadId])if(typeof threadId==='string'){
   if(rows.some(x=>['backend-deleted','backend-delete-pending','context-session-fence'].includes(x.kind)&&x.id===threadId))continue
   required.add(threadId)
   const binding=rows.find(x=>x.kind==='backend-binding'&&x.id===threadId)?.body
   const session=rows.find(x=>x.kind==='model-session'&&x.body.threadId===threadId)?.body,sourceId=v.source??session?.sourceId
   const original=threadId===v.from?.threadId?v.from:v
   const cwd=session?.cwd??original.cwd??run?.cwd??rows.find(x=>x.kind==='settings'&&x.id==='current')?.body.config?.sources?.find((s:any)=>s.id===sourceId)?.cwd??refs.get(threadId)?.cwd
   if(!cwd)continue // A model-session or run may supply the directory on a later row.
   refs.set(threadId,{threadId,cwd,backendId:binding?.id??original.backendId??run?.backendId??'codex'})
  }
 }
 const missing=[...required].filter(threadId=>!refs.has(threadId))
 if(missing.length)throw Error('History reference lacks a verified working directory')
 return [...refs.values()].sort((a,b)=>a.threadId.localeCompare(b.threadId))
}
export function configuredHistoryReader(config:Config,db:DatabaseSync):HistoryReader{
 const registry=new BackendRegistry(config,{get:<T>(kind:string,id:string)=>{const row=db.prepare('SELECT body FROM records WHERE kind=? AND id=?').get(kind,id);return row?JSON.parse(String(row.body)) as T:undefined},put:()=>{throw Error('History verification must be read-only')}})
 return ref=>registry.history(ref.threadId,ref.cwd)
}
export async function exportHistoryIndex(db:DatabaseSync,directory:string,reader?:HistoryReader){
 const references=historyReferences(db),items=[]
 for(const ref of references){
  if(!reader){items.push({...ref,state:'reference_only'});continue}
  const history=await reader(ref)
  if(!history||typeof history!=='object'||(history as any).id!==ref.threadId)throw Error('Native history identity mismatch: '+ref.threadId)
  const file=stableDigest(ref.threadId)+'.json',path=join(directory,'history',file)
  mkdirSync(join(directory,'history'),{recursive:true,mode:0o700});writeFileSync(path,JSON.stringify(history),{mode:0o600})
  items.push({...ref,state:'exported',file,sha256:stableDigest(history)})
 }
 const index={version:1,items};writeFileSync(join(directory,'history-index.json'),JSON.stringify(index),{mode:0o600});return {sha256:stableDigest(index),status:items.every(i=>i.state==='exported')?'verified':'reference_only',count:items.length}
}
export function verifyHistoryIndex(directory:string,expected:{sha256:string;status:string;count:number}){
 const index=JSON.parse(readFileSync(join(directory,'history-index.json'),'utf8'))
 if(stableDigest(index)!==expected.sha256||index.version!==1||index.items.length!==expected.count)throw Error('History index checksum mismatch')
 const seen=new Set<string>()
 for(const item of index.items){
  if(seen.has(item.threadId))throw Error('Duplicate history reference');seen.add(item.threadId)
  if(item.state!=='exported'){if(expected.status==='verified')throw Error('History export unavailable');continue}
  if(!/^[a-f0-9]{64}\.json$/.test(item.file))throw Error('Invalid history export path')
  const history=JSON.parse(readFileSync(join(directory,'history',item.file),'utf8'))
  if(history.id!==item.threadId||stableDigest(history)!==item.sha256)throw Error('History export checksum or identity mismatch')
 }
 return index
}
