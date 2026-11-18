import {expect,it} from 'vitest'
import {createProjectOwnership} from '../src/project-ownership.ts'
import {projectIntegrationSummary,projectIntegrationForTask} from '../src/project-integration-summary.ts'
const head='a'.repeat(40),policy={testCommand:'test',sharedFiles:['schema.json'],stages:{buildCommand:'build',businessCommand:'business',startCheck:{command:'exec start',url:'http://127.0.0.1:8123/',timeoutMs:1000}}}
function fixture(){
 const localPolicy=structuredClone(policy),ownership=createProjectOwnership(head,'final','worker',localPolicy,localPolicy.sharedFiles)
 const g:any={id:'goal',nodes:[{id:'final',workerId:'worker',ticketId:'ticket'}],project:{base:head,integration:'final',integrationWorkerId:'worker',policy:localPolicy,ownership}}
 const code:any={id:'delivery',goalId:'goal',ticketId:'ticket',head,parents:[head],ownership:{status:'checked',digest:ownership.digest,head,nodeId:'final',workerId:'worker',ticketId:'ticket',checkedPaths:['schema.json']},test:{exit:0,command:'test',output:'PRIVATE'},stages:['build','start','business'].map(kind=>({kind,command:kind==='start'?'exec start':kind,head,policyDigest:ownership.policyDigest,startedAt:1,finishedAt:2,exit:0,ready:kind==='start'?true:undefined,output:'PRIVATE'}))}
 return {g,code}
}
it('projects only recorded matching same-SHA phases without paths, output or mutation',()=>{
 const {g,code}=fixture(),before=JSON.stringify({g,code}),value=projectIntegrationSummary(g,'ticket',code,()=>{})!
 expect(value).toMatchObject({schema:1,role:'integration',ownership:'checked',sharedFileCount:1,defaultLockfiles:true,head,complete:true})
 expect(value.checks.map(c=>c.state)).toEqual(['passed','passed','passed']);expect(JSON.stringify(value)).not.toMatch(/schema.json|PRIVATE|command|cwd/);expect(JSON.stringify({g,code})).toBe(before)
})
it('does not upgrade legacy comprehensive tests into staged acceptance',()=>{
 const {g,code}=fixture();delete g.project.ownership;delete g.project.integrationWorkerId
 expect(projectIntegrationSummary(g,'ticket',code,()=>{})).toMatchObject({ownership:'legacy_unknown',complete:false,legacyTest:'passed',defaultLockfiles:false,sharedFileCount:0})
 expect(projectIntegrationSummary(g,'ticket',code,()=>{})!.checks.every(c=>c.state==='unverified')).toBe(true)
})
it.each(['missing','other_head','other_policy','duplicate','failed','not_ready','invalid_time','snapshot','wrong_ticket','not_configured'])('does not mark %s evidence complete',kind=>{
 const {g,code}=fixture()
 if(kind==='missing')code.stages.pop()
 if(kind==='other_head')code.stages[0].head='b'.repeat(40)
 if(kind==='other_policy')code.stages[0].policyDigest='wrong'
 if(kind==='duplicate')code.stages.push(code.stages[0])
 if(kind==='failed')code.stages[0].exit=1
 if(kind==='not_ready')code.stages[1].ready=false
 if(kind==='invalid_time')code.stages[0].finishedAt=0
 if(kind==='snapshot')g.project.ownership.sharedFiles=[]
 if(kind==='wrong_ticket')code.ticketId='other'
 if(kind==='not_configured'){delete g.project.policy.stages;g.project.ownership=createProjectOwnership(head,'final','worker',g.project.policy,policy.sharedFiles);code.ownership.digest=g.project.ownership.digest}
 expect(projectIntegrationSummary(g,'ticket',code,()=>{})!.complete).toBe(false)
})

it('does not downgrade a damaged new responsibility snapshot into legacy',()=>{
 const {g,code}=fixture();delete g.project.ownership
 expect(projectIntegrationSummary(g,'ticket',code,()=>{})).toMatchObject({ownership:'unverified',complete:false})
})

it('refuses complete UI evidence when the canonical receipt validator rejects changed parents or phases',()=>{
 const {g,code}=fixture()
 for(const reason of ['parents changed','phase order','extra phase'])expect(projectIntegrationSummary(g,'ticket',code,()=>{throw Error(reason)})).toMatchObject({ownership:'unverified',complete:false,legacyTest:'unverified'})
 expect(projectIntegrationSummary(g,'ticket',code)).toMatchObject({ownership:'unverified',complete:false})
})
it('retains completed project evidence only for a unique authorized task association',()=>{
 const {g,code}=fixture();g.state='completed';g.taskIds=['ticket']
 const host:any={store:{list:()=>[g],get:()=>({id:'delivery'})},goals:{context:()=>({}),list:()=>[g]},projectCode:{receipt:()=>code,validateReceipt:()=>{}}}
 expect(projectIntegrationForTask(host,'ticket')).toMatchObject({complete:true})
 host.store.list=()=>[g,{...g,id:'duplicate'}];expect(projectIntegrationForTask(host,'ticket')).toBeUndefined()
 host.store.list=()=>[g];host.goals.list=()=>[{...g,project:undefined}];expect(projectIntegrationForTask(host,'ticket')).toBeUndefined()
})
