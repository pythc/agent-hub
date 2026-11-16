/** Recovered integration regressions; all participants are local synthetic fixtures. */
import {afterEach,expect,it,vi} from 'vitest'
import {mkdtempSync,readFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {randomUUID} from 'node:crypto'
import {request as httpRequest} from 'node:http'
import {Runtime} from '../src/runtime.ts'
import {configSchema} from '../src/config.ts'
import {serve} from '../src/server.ts'
import type {Model} from '../src/model.ts'
const cleanup:(()=>Promise<void>)[]=[]
afterEach(async()=>{for(const close of cleanup.splice(0))await close()})
async function fixture(){
 const root=mkdtempSync(join(tmpdir(),'capability-integration-'))
 const model:Model={async run(r){const threadId=r.threadId??'fixture:'+randomUUID(),turnId=randomUUID();r.onThread?.(threadId);r.onTurn?.(turnId);return {threadId,turnId,text:JSON.stringify(r.role==='worker'?{state:'ready',summary:'Fixture result',reply:'Local evidence ready',question:null,askedBy:null,handbacks:[]}:{reply:'Fixture reply'})}}}
 let runtime=new Runtime(configSchema.parse({stateDir:join(root,'state'),port:0,work:{sandboxDriver:'disabled',network:false},execution:{management:{enabled:true,maxWorkers:8},workers:[{id:'existing',backend:'codex'}]},sources:[{id:'local',kind:'local',cwd:root,allowedActors:['operator']}]}),{model})
 const host=await serve(runtime,{createRuntime:config=>{runtime=new Runtime(config,{model});return runtime}})
 const token=readFileSync(host.tokenPath,'utf8').trim(),headers={authorization:'Bearer '+token,origin:host.url,'content-type':'application/json'}
 cleanup.push(async()=>{host.server.closeAllConnections();await new Promise<void>(done=>host.server.close(()=>done()));await host.closeRuntime();rmSync(root,{recursive:true,force:true});for(const key of Object.keys(process.env))if(key.startsWith('AGENTHUB_SETUP_CONNECTOR_'))delete process.env[key]})
 async function api(path:string,body?:unknown){const response=await fetch(host.url+path,{headers,...(body===undefined?{}:{method:'POST',body:JSON.stringify(body)})});return {status:response.status,body:await response.json() as any}}
 return {host,headers,api,get runtime(){return runtime}}
}
it('protects feature inventories and mutations with operator and same-origin checks',async()=>{
 const f=await fixture()
 for(const path of ['/api/worker-templates','/api/connectors','/api/execution-trace','/api/execution-trace/events'])expect((await fetch(f.host.url+path)).status).toBe(401)
 expect((await fetch(f.host.url+'/api/worker-templates/install',{method:'POST',headers:{'content-type':'application/json'},body:'{}'})).status).toBe(401)
 expect((await fetch(f.host.url+'/api/connectors/plan',{method:'POST',headers:{...f.headers,origin:'https://another-origin.invalid'},body:'{}'})).status).toBe(403)
 const invalid=await f.api('/api/connectors/plan',{credentials:{secret:'PRIVATE_CREDENTIAL_SENTINEL'}})
 expect(invalid.status).toBe(400);expect(JSON.stringify(invalid.body)).not.toContain('PRIVATE_CREDENTIAL_SENTINEL')
})
it('integrates recipe, existing onboarding, explicit Worker activation and persistent trace',async()=>{
 const f=await fixture(),library=(await f.api('/api/worker-templates')).body,manifest=library.starters[0]
 expect((await f.api('/api/worker-templates/preview',{manifest})).body.grants).toEqual([])
 expect((await f.api('/api/worker-templates/install',{manifest,digest:manifest.digest,revision:library.revision,requestId:randomUUID()})).status).toBe(200)
 const installed=(await f.api('/api/worker-templates')).body
 const created=await f.api('/api/worker-templates/create',{id:manifest.id,version:manifest.version,digest:manifest.digest,revision:installed.revision,settingsRevision:installed.settingsRevision,requestId:randomUUID(),workerId:'from-recipe',label:'Recipe Worker',backend:'codex'})
 expect(created.status).toBe(200);expect(created.body.started).toBe(false);expect(created.body.grants).toEqual([])
 let workers=(await f.api('/workers')).body
 expect(workers.workers.find((w:any)=>w.id==='from-recipe')).toMatchObject({state:'paused',tools:[],toolConnections:[]})
 const secret='PRIVATE_IM_CREDENTIAL_SENTINEL'
 const plan=await f.api('/api/connectors/plan',{revision:workers.revision,kind:'feishu',label:'Isolated IM',actors:['operator'],fields:{chats:['oc_isolated']},credentials:{'app-id':'cli_fixture','app-secret':secret}})
 expect(plan.status).toBe(200);expect(JSON.stringify(plan.body)).not.toContain(secret)
 expect((await f.api('/api/plugin-market/connection/apply',{id:plan.body.id})).status).toBe(200)
 const connectors=(await f.api('/api/connectors')).body,instance=connectors.instances.find((c:any)=>c.label==='Isolated IM')
 expect(instance).toMatchObject({enabled:false,realCall:{status:'not_tested'}});expect(JSON.stringify(connectors)).not.toContain(secret)
 expect((await f.api('/api/connectors/probe',{sourceId:instance.id,revision:connectors.revision,level:'configuration',requestId:randomUUID()})).body).toMatchObject({status:'passed',realCall:false})
 expect((await f.api('/api/connectors/probe',{sourceId:instance.id,revision:connectors.revision,level:'authentication',requestId:randomUUID()})).body.code).toBe('connector_disabled')
 workers=(await f.api('/workers')).body
 expect((await f.api('/workers',{action:'resume',id:'from-recipe',revision:workers.revision,requestId:randomUUID()})).status).toBe(200)
 workers=(await f.api('/workers')).body
 const assigned=await f.api('/workers',{action:'assign',id:'from-recipe',revision:workers.revision,requestId:randomUUID(),discussion:'integration-fixture',text:'Perform the local deterministic acceptance check.'})
 expect(assigned.status).toBe(200)
 await vi.waitFor(()=>expect(f.runtime.store.get<any>('run',assigned.body.ticketId)?.result).toBeTruthy(),{timeout:10000,interval:50})
 const trace=(await f.api('/api/execution-trace?ticketId='+encodeURIComponent(assigned.body.ticketId))).body
 expect(trace.tasks).toHaveLength(1);expect(trace.tasks[0].hasResult).toBe(true)
 expect(trace.tasks[0].evidence).toMatchObject({commit:'unverified',tests:'unverified',deployment:'unverified'})
 const events=(await f.api('/api/execution-trace/events?ticketId='+encodeURIComponent(assigned.body.ticketId))).body
 expect(events.events.some((e:any)=>e.stage==='assignment')).toBe(true);expect(events.events.some((e:any)=>e.stage==='run')).toBe(true)
 // A result can be retained before the job/outbox finishes. Newer delivery
 // events are valid catch-up; a cursor must exclude already observed events.
 const catchup=(await f.api('/api/execution-trace/events?cursor='+events.cursor)).body
 expect(catchup.cursor).toBeGreaterThanOrEqual(events.cursor)
 expect(catchup.events.every((event:any)=>event.cursor>events.cursor)).toBe(true)
 const seen=new Set(events.events.map((event:any)=>event.id))
 expect(catchup.events.some((event:any)=>seen.has(event.id))).toBe(false)
 expect(JSON.stringify(events)).not.toContain(secret);expect(JSON.stringify(events)).not.toContain(manifest.instructions)
 const current=(await f.api('/api/worker-templates')).body
 expect((await f.api('/api/worker-templates/remove',{id:manifest.id,version:manifest.version,revision:current.revision,requestId:randomUUID()})).body.historyRetained).toBe(true)
 expect((await f.api('/workers')).body.workers.some((w:any)=>w.id==='from-recipe')).toBe(true)
 expect((await f.api('/api/execution-trace?ticketId='+encodeURIComponent(assigned.body.ticketId))).body.tasks).toHaveLength(1)
},20000)
it('retains unknown effects across refresh and rejects stale or unsafe recovery',async()=>{
 const f=await fixture();f.runtime.pause(true)
 // This test seeds a durable unknown outcome; an unrelated successful model run
 // must not replace it or advance the observation while the HTTP fence is checked.
 const modelRun=vi.spyOn(f.runtime.model,'run'),workers=(await f.api('/workers')).body
 const assigned=await f.api('/workers',{action:'assign',id:'existing',revision:workers.revision,requestId:randomUUID(),discussion:'unknown-fixture',text:'Inspect unknown effect fixture.'})
 expect(assigned.status).toBe(200)
 f.runtime.store.put('run',assigned.body.ticketId,{ticketId:assigned.body.ticketId,assignmentId:'fixture',cwd:f.runtime.config.sources[0]!.cwd,phase:'uncertain',threadId:'fixture-session',error:'PRIVATE_RAW_PROVIDER_ERROR'})
 const snapshot=(await f.api('/api/execution-trace')).body,task=snapshot.tasks.find((t:any)=>t.id===assigned.body.ticketId)
 expect(task.unknownEffects).toBe(true);expect(task.next).toBe('reconcile');expect(task.actions).not.toContain('resume_session')
 const input={ticketId:task.id,revision:task.revision,observed:task.observed,requestId:randomUUID(),action:'resume_session'}
 expect((await f.api('/api/execution-trace/recover',input)).body.code).toBe('trace_reconcile_required')
 expect((await f.api('/api/execution-trace/recover',{...input,requestId:randomUUID(),action:'inspect',revision:task.revision+1})).body.code).toBe('trace_settings_conflict')
 expect(JSON.stringify((await f.api('/api/execution-trace')).body)).not.toContain('PRIVATE_RAW_PROVIDER_ERROR')
 expect((await f.api('/api/execution-trace?ticketId='+encodeURIComponent(task.id))).body.tasks[0].observed).toBe(task.observed)
 expect(modelRun).not.toHaveBeenCalled()
})

it('rechecks the operator after a slow onboarding apply body completes',async()=>{
 const f=await fixture(),password='Synthetic-password-2026!'
 const setup=await fetch(f.host.url+'/account/setup',{method:'POST',headers:f.headers,body:JSON.stringify({username:'slow-body',displayName:'Synthetic',password,remember:true})})
 expect(setup.status).toBe(201)
 const cookie=setup.headers.get('set-cookie')!.split(';')[0]!
 const current=(await f.api('/api/connectors')).body
 const plan=await f.api('/api/connectors/plan',{revision:current.revision,kind:'feishu',label:'Never applied',actors:['operator'],credentialMode:'environment',fields:{chats:['oc_fixture']},credentials:{'app-id':'FIXTURE_ID','app-secret':'FIXTURE_SECRET'}})
 expect(plan.status).toBe(200)
 const body=JSON.stringify({id:plan.body.id})
 const entered=new Promise<void>(resolve=>f.host.server.on('request',req=>{if(req.url==='/api/plugin-market/connection/apply')resolve()}))
 let req:ReturnType<typeof httpRequest>
 const result=new Promise<number>((resolve,reject)=>{req=httpRequest(f.host.url+'/api/plugin-market/connection/apply',{method:'POST',headers:{cookie,origin:f.host.url,'content-type':'application/json','content-length':Buffer.byteLength(body)}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode!))});req.on('error',reject);req.write(body.slice(0,5))})
 await entered
 const logout=await fetch(f.host.url+'/account/logout-all',{method:'POST',headers:{cookie,origin:f.host.url,'content-type':'application/json'},body:'{}'})
 expect(logout.status).toBe(200)
 req!.end(body.slice(5));expect(await result).toBe(401)
 expect((await f.api('/api/connectors')).body.revision).toBe(current.revision)
 expect((await f.api('/api/connectors')).body.instances).toHaveLength(0)
})
