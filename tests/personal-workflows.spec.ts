import {afterEach,expect,it} from 'vitest'
import {createHmac,randomBytes,randomUUID} from 'node:crypto'
import {createServer} from 'node:http'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {serve} from '../src/server.ts'
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {configSchema} from '../src/config.ts'
import {buildPluginPackage} from '../src/plugin-package.ts'
import {Runtime} from '../src/runtime.ts'
import {stableDigest} from '../src/sources.ts'
import {FeishuSource} from '../plugins/feishu/feishu.ts'
import {operatorWorkspace} from '../src/operator-workspace.ts'
import type {Model} from '../src/model.ts'
import {serveWebhooks} from '../src/webhook-http.ts'

const clean:(()=>Promise<void>)[]=[]
afterEach(async()=>{for(const stop of clean.splice(0).reverse())await stop()})
const uuid=(n:number)=>'00000000-0000-4000-a000-'+String(n).padStart(12,'0')
const issue=uuid(1),team=uuid(2),workspace=uuid(3),bot=uuid(4)
const todo={id:uuid(5),name:'Todo'},started={id:uuid(6),name:'Investigating'}
async function scenario(){
  const root=mkdtempSync(join(tmpdir(),'roppo-personal-')),secretEnv='ROPPO_TEST_'+randomUUID().replaceAll('-','')
  process.env[secretEnv]='whsec_'+randomBytes(32).toString('base64')
  const callbackEnv=secretEnv+'_OUT';process.env[callbackEnv]='whsec_'+randomBytes(32).toString('base64')
  clean.push(async()=>{delete process.env[secretEnv];delete process.env[callbackEnv];rmSync(root,{recursive:true,force:true})})
  let now=Date.now(),state=todo,version=1,writes=0,loseReply=false
  const provider=createServer(async(req,res)=>{
    let text='';for await(const chunk of req)text+=chunk
    if(req.url==='/callback'){res.writeHead(204);res.end();return}
    const {query,variables}=JSON.parse(text);let data
    const revision=()=>new Date(1700000000000+version*1000).toISOString()
    if(query.includes('AgentHubIdentity'))data={viewer:{id:bot,active:true,app:true},organization:{id:workspace}}
    else if(query.includes('AgentHubWorkflowState'))data={issue:{id:issue,identifier:'OPS-7',title:'Broken CI',updatedAt:revision(),team:{id:team},state},team:{id:team,states:{nodes:[todo,started]}}}
    else if(query.includes('AgentHubWorkflowUpdate')){
      if(variables.id!==issue||variables.input.stateId!==started.id)throw Error('Unexpected mutation')
      state=started;version++;writes++
      if(loseReply){res.destroy();return}
      data={issueUpdate:{success:true,issue:{id:issue,state}}}
    }else data={issues:{nodes:[],pageInfo:{hasNextPage:false}},comments:{nodes:[],pageInfo:{hasNextPage:false}}}
    res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({data}))
  })
  await new Promise<void>(r=>provider.listen(0,'127.0.0.1',r))
  clean.push(async()=>{provider.closeAllConnections();await new Promise<void>(r=>provider.close(()=>r()))})
  const url='http://127.0.0.1:'+String((provider.address() as {port:number}).port)
  const pkg=await buildPluginPackage(fileURLToPath(new URL('../plugins/linear/index.ts',import.meta.url)),JSON.parse(readFileSync(new URL('../plugins/linear/manifest.json',import.meta.url),'utf8')),join(root,'plugin'))
  const accountNamespace='feishu:bot:ou_test',entryId=stableDigest(['test','feishu',accountNamespace,'oc_ci'])
  const incoming=new Map<string,string>(),messages:{text:string}[]=[]
  const config=configSchema.parse({port:0,stateDir:join(root,'state'),webhooks:{port:0,loopbackCallbackOrigins:[url]},work:{sandboxDriver:process.platform==='darwin'?'seatbelt':'bubblewrap'},execution:{router:{mode:'host'},management:{enabled:true,maxWorkers:1},workers:[{id:'diagnosis',backend:'codex'}]},
    sourcePlugins:[{directory:pkg.directory,digest:pkg.digest}],sources:[
      {id:'chat',kind:'feishu',cwd:root,workspace:{mode:'source'},allowedActors:['alice'],admission:{oc_ci:{listedUnaddressed:'ignore'}},feishu:{cli:'lark-cli',chats:['oc_ci'],command:'/ci'}},
      {id:'tracker',kind:'linear',cwd:root,options:{workspaceId:workspace,teams:[team],tokenEnv:secretEnv,issueIds:[issue],command:'/agent',apiBase:url+'/graphql',statusTargets:[{key:'ci-issue',entryId,issueId:issue,teamId:team}]}}]})
  const chat=new FeishuSource(config.sources[0]!,async(method,path,body)=>{
    if(path==='bot/v3/info')return {bot:{open_id:'ou_test'}}
    if(method==='POST'&&path.endsWith('/reply')){messages.push(JSON.parse((body as {content:string}).content));return {}}
    const messageId=path.split('/').at(-1)!,text=incoming.get(messageId)
    return {items:text?[{chat_id:'oc_ci',message_id:messageId,root_id:'om_authorize',sender:{id:'alice',sender_type:'user'},body:{content:JSON.stringify({text})}}]:[]}
  })
  let host:Runtime,turn=0
  const model:Model={async run(r){
    const input=JSON.parse(r.input),threadId=r.threadId??randomUUID(),turnId=String(++turn)
    r.onThread?.(threadId);r.onTurn?.(turnId)
    let output:any={reply:''}
    if(r.role==='worker'){
      const result=await r.onTool!('superagent_workflow',{action:'propose',sourceId:'tracker',target:'ci-issue',stateId:started.id,requestId:'investigate'},'status')
      const proposal=JSON.parse((result.contentItems[0] as any).text),done=['applied','observed'].includes(proposal.state)
      if(done)writeFileSync(join(r.cwd,'result.json'),JSON.stringify(proposal.receipt))
      output={state:'ready',summary:done?'CI diagnosis and Linear receipt retained':'Waiting for a status decision',question:null,reply:'',askedBy:null,handbacks:[]}
    }else if(input.kind==='goal_verification'){
      for(const e of input.evidence)await r.onTool!('goal_evidence',{id:e.id},e.id)
      output={checks:input.criteria.map((c:any)=>({criterionId:c.id,verdict:'passed',explanation:'Read the stored provider receipt',evidenceIds:input.evidence.filter((e:any)=>c.id==='__goal__'||e.criterionIds.includes(c.id)).map((e:any)=>e.id)}))}
    }
    return {threadId,turnId,text:JSON.stringify(output)}
  }}
  const open=async()=>{host=await Runtime.create(config,{model,sources:[chat],clock:()=>now})};await open()
  clean.push(async()=>{await host.close()})
  host!.scopes.command({action:'scope.put',operationId:'team',expectedRevision:0,scope:{id:'team',tenantId:'test',name:'CI',managers:[JSON.stringify(['chat','alice'])],workerIds:['diagnosis'],sourceIds:['chat','tracker'],backendIds:['codex']}})
  await host!.scopeCommand({action:'source.verify',operationId:'account',expectedRevision:0,sourceId:'chat'})
  host!.scopes.command({action:'entry.bind',operationId:'chat',expectedRevision:0,scopeId:'team',sourceId:'chat',accountNamespace,nativeId:'oc_ci',history:'group'})
  const say=async(id:string,text:string)=>{
    const messageId='om_'+id
    incoming.set(messageId,text)
    let triggerId:string|undefined
    await chat.receiveEvent({type:'im.message.receive_v1',chat_id:'oc_ci',chat_type:'group',message_id:messageId},{store:host.store,receive(t){triggerId=t.id;return host.ingest(t)},bind(){},closed(){}})
    if(!triggerId)throw Error('Feishu message was not received')
    return triggerId
  }
  const triggerId=await say('authorize','/ci Authorize this CI diagnosis workflow. Propose changes to the linked issue.')
  const repository='test/ci',spec={protocolVersion:2,operationId:'ci-grant',triggerId,authorizationQuote:'Authorize this CI diagnosis workflow',namespace:'ci',eventSource:'https://github.com/'+repository,eventTypes:['github.workflow_run.completed.failure'],transport:{kind:'github-workflow',repositoryId:123,repository},secretEnvs:[secretEnv],parameters:{repository:{type:'string'},runId:{type:'string'},attempt:{type:'number',min:1,max:100},sha:{type:'string'},conclusion:{type:'string'},status:{type:'string'}},
    template:{title:'CI diagnosis',objective:'Diagnose CI and record the verified issue state',criteria:[{id:'state',description:'Retain the confirmed Linear state',check:{kind:'json_equals',path:'result.json',pointer:'/state',expected:started.id}}],nodes:[{id:'diagnose',title:'Diagnose',instruction:'Diagnose CI and propose the status change',workerId:'diagnosis',criterionIds:['state']}]},expiresAt:now+7*86400000,maxEvents:10,callback:{url:url+'/callback',secretEnv:callbackEnv,idempotent:true}}
  const grant=host!.webhooks.create(spec)
  const listener=await serveWebhooks(()=>host,0);clean.push(()=>listener.close())
  const event=JSON.stringify({action:'completed',repository:{id:123,full_name:repository},workflow_run:{id:777,run_attempt:1,head_sha:'a'.repeat(40),status:'completed',conclusion:'failure',updated_at:new Date(now).toISOString()}})
  const send=()=>fetch(listener.url+'/webhooks/'+grant.id,{method:'POST',headers:{'content-type':'application/json','x-github-delivery':'ci-777','x-github-event':'workflow_run','x-hub-signature-256':'sha256='+createHmac('sha256',process.env[secretEnv]!).update(event).digest('hex')},body:event})
  const until=async(predicate:()=>boolean)=>{for(let i=0;i<700;i++){await host.tick();await new Promise(r=>setTimeout(r,5));if(predicate())return}throw Error(JSON.stringify({jobs:host.store.db.prepare("SELECT kind,state,error FROM jobs WHERE state!='done'").all(),goals:host.goals.snapshot().map(g=>[g.state,g.reason]),actions:host.workflows.list().map(a=>a.state)}))}
  return {get h(){return host},get writes(){return writes},get messages(){return messages},started,send,until,say,spec,entryId,
    restart:async()=>{now+=86400000;await host.close();await open()},
    changeIssue:()=>{version++},loseResponse:()=>{loseReply=true},revoke:()=>{config.sources[1]!.options!.statusTargets=[]}}
}

it.skipIf(!process.env.ROPPO_BROWSER_PYTHON)('approves from the real operator workspace and shows the confirmed receipt',async()=>{
 const f=await scenario()
 expect((await f.send()).ok).toBe(true)
 await f.until(()=>f.h.workflows.list()[0]?.state==='pending')
 await f.restart()
 const app=await serve(f.h)
 try{
  await promisify(execFile)(process.env.ROPPO_BROWSER_PYTHON!,['tests/browser/workflow_approval.py',app.url,app.tokenPath],{timeout:45000})
  expect(f.writes).toBe(1)
  expect(f.h.workflows.list()[0]).toMatchObject({state:'applied',decision:{via:'operator'},receipt:{issue,state:started.id}})
 }finally{app.server.closeAllConnections();await new Promise<void>(r=>app.server.close(()=>r()))}
},60000)

it.each(['approved','concurrent','declined','interrupted','stale','uncertain','revoked'] as const)('runs a signed CI event to a durable Linear decision, outcome %s',async mode=>{
 const f=await scenario()
 expect((await f.send()).ok).toBe(true);expect((await f.send()).ok).toBe(true)
 await f.until(()=>f.h.workflows.list().length===1&&f.messages.some(m=>m.text.includes('待确认')))
 const p=f.h.workflows.list()[0]!
 if(mode==='approved')await f.until(()=>f.h.store.tickets.get(p.ticketId)?.assignments.at(-1)?.report?.state==='waiting')
 expect(f.h.goals.snapshot()[0]?.state).not.toBe('completed')
 expect(f.writes).toBe(0);expect(operatorWorkspace(f.h).workflowActions[0]?.view.label).toContain('OPS-7')
 await f.restart();expect(f.h.workflows.list()[0]?.state).toBe('pending')
 const decide=()=>f.h.workflows.decide({id:p.id,decision:'approve'})
 const instructions=f.messages.find(m=>m.text.includes('待确认'))!.text
 const reply=(verb:string)=>instructions.match(new RegExp('「([^」]*'+verb+' [a-f0-9]{16})」'))![1]!
 if(mode==='declined'){
   await f.say('no',reply('拒绝'))
   await f.until(()=>f.h.workflows.list()[0]?.state==='declined')
   expect((await decide()).state).toBe('declined');expect(f.writes).toBe(0);return
 }
 if(mode==='interrupted'){
   // The process stopped after its durable pre-write checkpoint. The remote is still at Todo.
   f.h.store.put('workflow-action',p.id,{...p,state:'applying'})
   await f.restart();expect(f.h.workflows.list()[0]?.state).toBe('uncertain')
   expect((await decide()).state).toBe('uncertain')
   expect((await f.h.workflows.decide({id:p.id,decision:'reconcile'})).state).toBe('uncertain')
   expect(f.writes).toBe(0);return
 }
 if(mode==='revoked'){f.revoke();await expect(decide()).rejects.toThrow(/unavailable|permissions_changed/);expect(f.writes).toBe(0);return}
 if(mode==='stale'){f.changeIssue();expect((await decide()).state).toBe('stale');expect(f.writes).toBe(0);return}
 if(mode==='uncertain'){
   f.loseResponse()
   expect((await decide()).state).toBe('uncertain');await decide()
   expect((await f.h.workflows.decide({id:p.id,decision:'reconcile'})).state).toBe('observed');expect(f.writes).toBe(1);return
 }
 let decisionId:string|undefined
 if(mode==='concurrent')await Promise.all([decide(),decide()])
 else{
   const ignored=await f.say('bare','批准 '+p.id.slice(0,16))
   expect(f.h.routerIngress.get(ignored)?.state).toBe('ignored')
   decisionId=await f.say('decision',reply('批准'));await f.say('decision',reply('批准'))
 }
 await f.until(()=>f.h.goals.snapshot().some(g=>g.state==='completed'))
 await Promise.all([decide(),decide()])
 expect(f.h.workflows.list()[0]).toMatchObject({state:'applied',receipt:{issue,state:started.id}})
 expect(f.h.workflows.list()[0]?.decision).toMatchObject(mode==='approved'?{kind:'approve',via:'conversation',actorId:'alice',triggerId:decisionId}:{kind:'approve',via:'operator'})
 expect(f.writes).toBe(1);expect(f.h.store.tickets.list()).toHaveLength(1)
 expect(f.messages.filter(m=>m.text.includes('已写入并回读'))).toHaveLength(1)
 const goal=f.h.goals.snapshot()[0]!,draft=f.h.skills.command({action:'draft',goalId:goal.id})
 const saved=f.h.skills.command({action:'save',goalId:goal.id,template:draft.template,expectedVersion:0})
 const ref={id:saved.id,version:saved.version}
 expect(f.h.webhooks.create({...f.spec,operationId:'saved-ci',namespace:'next-ci',skill:ref,template:saved.template}).skill).toEqual(ref)
},30000)
