import {expect,it} from 'vitest'
import {artifactReference,artifactDownload,artifactIdValid} from '../web/chat/artifact-result-model.ts'
const id='a'.repeat(64),value={schema:1,kind:'goal-artifact',id,version:2,sha256:'b'.repeat(64),name:'report.pdf',mediaType:'application/pdf',bytes:123,category:'document',visibility:'operator_workspace',retention:'subject_to_history_cleanup',availability:'retained',publication:'not_tracked',downloadPath:'/goal-artifacts/'+id}
const context={state:'ready' as const,managed:true,activeId:'team',epoch:1,accountId:'user',sessionIsolation:'session',code:null}
it('accepts only matching fixed version descriptors and scopes downloads to the current workspace',()=>{
 expect(artifactReference(value,id)).toEqual(value)
 expect(artifactDownload(id,context)).toBe('/workspaces/team/goal-artifacts/'+id)
 expect(artifactDownload(id,{...context,managed:false})).toBe('/goal-artifacts/'+id)
 expect(artifactReference({...value,availability:'unavailable',downloadPath:null},id)?.downloadPath).toBeNull()
})
it('rejects mixed versions, future schemas, unsafe metadata and invented publication claims',()=>{
 for(const patch of [{id:'c'.repeat(64)},{schema:2},{version:0},{bytes:-1},{sha256:'bad'},{category:'unknown'},{visibility:'public'},{publication:'published'},{downloadPath:'https://evil.test/'},{downloadPath:'/goal-artifacts/other'},{availability:'unavailable'},{name:undefined}])expect(artifactReference({...value,...patch},id)).toBeNull()
 expect(artifactReference(null,id)).toBeNull()
})
it('fails closed on invalid identifiers or unavailable workspace contexts',()=>{
 for(const bad of ['../private','a?token=x','', 'a'.repeat(65)]){expect(artifactIdValid(bad)).toBe(false);expect(artifactDownload(bad,context)).toBeNull()}
 expect(artifactDownload(id,{...context,state:'blocked'})).toBeNull()
 expect(artifactDownload(id,{...context,activeId:'../other'})).toBeNull()
})
it('wires fixed-version pages through the shared workspace owner and preserves workspace selection',async()=>{
 const {readFileSync}=await import('node:fs')
 const main=readFileSync(new URL('../web/chat/main.tsx',import.meta.url),'utf8'),legacy=readFileSync(new URL('../src/ui/operator-workspace.js',import.meta.url),'utf8'),config=readFileSync(new URL('../web/chat/configuration.tsx',import.meta.url),'utf8')
 expect(main).toContain('||artifactRoute')
 expect(main).toContain('<ArtifactResult key={hash} id={hash.slice(9)}')
 expect(config).toContain("!location.hash.startsWith('#artifact/')")
 expect(legacy).toContain("'/configure#artifact/'+encodeURIComponent(file.id)")
 expect(legacy).toContain("url.searchParams.set('workspace',workspaceContext.activeId)")
})
