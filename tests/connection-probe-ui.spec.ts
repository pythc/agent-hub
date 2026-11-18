import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
import {it,expect} from 'vitest'
function fixture(){
 const calls:any[]=[],context:any={S:{snap:{current:{revision:7}},base:{revision:7}},connectionStudio:{backendProbes:{}},workspaceContext:{activeId:'one'},L:(en:string)=>en,api:async(path:string,input:any)=>{calls.push({path,input});return {revision:7,available:true,authenticated:false,checkedAt:1}},snapshot:async()=>({}),adopt:()=>{}}
 runInNewContext(readFileSync('src/ui/connection-library.js','utf8')+'\nglobalThis.exports={connectionRunCheck,connectionProtocolProbe,connectionCheckStatus}',context)
 return {context,calls,...context.exports}
}
it('preserves protocol-only checks and revision/workspace-fenced results in the redesigned library',async()=>{
 const f=fixture(),service={id:'acp',kind:'plugin'}
 expect(f.connectionCheckStatus(service).text).toBe('Protocol untested')
 await f.connectionRunCheck(service)
 expect(f.calls).toEqual([{path:'/api/execution-backends/probe',input:{id:'acp',revision:7}}])
 expect(f.connectionCheckStatus(service)).toMatchObject({text:'Protocol reachable',result:null})
 f.context.S.snap.current.revision=8
 expect(f.connectionProtocolProbe(service)).toBeNull()
 f.context.S.snap.current.revision=7;f.context.workspaceContext.activeId='two'
 expect(f.connectionProtocolProbe(service)).toBeNull()
})
it('does not relabel a delayed protocol response as evidence for a newly selected workspace',async()=>{
 const f=fixture(),service={id:'acp',kind:'plugin'};let finish!:(x:any)=>void
 f.context.api=()=>new Promise(r=>finish=r)
 const pending=f.connectionRunCheck(service);f.context.workspaceContext.activeId='two'
 finish({revision:7,available:true});await pending
 expect(f.context.connectionStudio.backendProbes.acp.workspaceId).toBe('one')
 expect(f.connectionProtocolProbe(service)).toBeNull()
})
it('retains normal model tests for API services',async()=>{
 const f=fixture();await f.connectionRunCheck({id:'api',kind:'openai-chat'})
 expect(f.calls).toEqual([{path:'/model-connections/check',input:{id:'api',revision:7}}])
})
