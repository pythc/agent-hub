import {expect,it,vi} from 'vitest'
import {artifactCatalog} from '../src/artifact-catalog.ts'
import {parseArtifactCatalog} from '../web/chat/artifact-catalog-model.ts'
import type {Runtime} from '../src/runtime.ts'
const ref=(id:string)=>({schema:1 as const,kind:'goal-artifact' as const,id,version:1,sha256:'b'.repeat(64),name:'report.pdf',mediaType:'application/pdf',bytes:1,category:'document' as const,visibility:'operator_workspace' as const,retention:'subject_to_history_cleanup' as const,availability:'retained' as const,publication:'not_tracked' as const,downloadPath:'/goal-artifacts/'+id})
it('bounds responses after access filtering without exposing excluded identities or counts',()=>{
 const rows=Array.from({length:202},(_,i)=>({id:i.toString(16).padStart(64,'0')})),describe=vi.fn((id:string)=>{if(id===rows[0]!.id)throw Error('private');return ref(id)})
 const result=artifactCatalog({store:{list:()=>rows},artifacts:{describe},config:{viewPlugins:[]}} as unknown as Runtime)
 expect(result.items).toHaveLength(200);expect(result.truncated).toBe(true);expect(result.items.some(x=>x.reference.id===rows[0]!.id)).toBe(false);expect(parseArtifactCatalog(result)).toEqual(result)
})
it('rejects malformed, duplicate, conversation and unsafe navigation identities',()=>{
 const item={label:{en:'report','zh-CN':'报告'},reference:ref('a'.repeat(64))},catalog={schema:1,items:[item],truncated:false}
 expect(parseArtifactCatalog(catalog)).toEqual(catalog)
 expect(parseArtifactCatalog({...catalog,items:[item,item]})).toBeNull()
 for(const override of [{kind:'chat-attachment'},{id:'../x'},{downloadPath:'https://evil.test'}])expect(parseArtifactCatalog({...catalog,items:[{...item,reference:{...item.reference,...override}}]})).toBeNull()
 const view={schema:1,kind:'workspace-view',id:'board',version:'a'.repeat(64),sha256:'b'.repeat(64),visibility:'operator_workspace',retention:'subject_to_plugin_removal',publication:'not_tracked'}
 expect(parseArtifactCatalog({...catalog,items:[{...item,reference:view}]})).not.toBeNull()
 expect(parseArtifactCatalog({...catalog,items:[{...item,reference:{...view,id:'../board'}}]})).toBeNull()
})
