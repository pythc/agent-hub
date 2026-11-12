import {afterEach,expect,it} from 'vitest'
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,existsSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {request} from 'node:http'
import {execFileSync} from 'node:child_process'
import {randomBytes} from 'node:crypto'
import {Runtime} from '../src/runtime.ts'
import {configSchema} from '../src/config.ts'
import type {Model} from '../src/model.ts'
import type {RouterGoal} from '../src/router-goals.ts'
import type {VerificationRound} from '../src/goal-verification.ts'
import type {CodeReceipt} from '../src/project-code.ts'
import {operatorWorkspace} from '../src/operator-workspace.ts'
import {serve} from '../src/server.ts'
import {backupState,verifyBackup,restoreState} from '../src/backup.ts'
import {projectBudget} from '../src/project-budget.ts'
import {stableDigest} from '../src/sources.ts'
import {secretFromEnv,signWebhook} from '../src/webhook-protocol.ts'

const git=(cwd:string,...args:string[])=>execFileSync('git',['-c','core.hooksPath=/dev/null',...args],{cwd,encoding:'utf8'}).trim()
const cleanups:(()=>Promise<void>|void)[]=[]
afterEach(async()=>{for(const fn of cleanups.splice(0).reverse())await fn()})
const realSandbox=it.skipIf(!['darwin','linux'].includes(process.platform)||process.platform==='linux'&&!process.env.PATH?.split(':').some(p=>existsSync(join(p,'bwrap'))))
function project(chain=false,testCommand='sh verify.sh',onWorker?:(r:Parameters<Model['run']>[0])=>Promise<void>,semanticFile=false){
 const root=mkdtempSync(join(tmpdir(),'roppo-project-test-')),repo=join(root,'source'),stateDir=join(root,'state')
 cleanups.push(()=>rmSync(root,{recursive:true,force:true}));mkdirSync(repo)
 git(repo,'init','-q');git(repo,'config','user.email','project@example.com');git(repo,'config','user.name','Project')
 writeFileSync(join(repo,'mode.txt'),'base\n')
 writeFileSync(join(repo,'verify.sh'),'set -e\ngrep -Fx both mode.txt\ntest -f one.txt && test -f two.txt\necho integrated-passed\n')
 git(repo,'add','.');git(repo,'commit','-qm','Initial project')
 const base=git(repo,'rev-parse','HEAD'),now=Date.now()
 const config=configSchema.parse({port:0,stateDir,acceptMode:'auto',work:{network:false,sandboxDriver:process.platform==='darwin'?'seatbelt':'bubblewrap'},execution:{router:{mode:'host'},management:{enabled:true,maxWorkers:2},workers:[{id:'one',backend:'codex'},{id:'two',backend:'codex'}]},sources:[{id:'local',kind:'local',cwd:repo,workspace:{mode:'directory',project:{testCommand,budget:{maxMinutes:10}}},sandbox:'workspace-write',allowedActors:['alice','bob']}]})
 let h:Runtime,clock=now,seq=0,conflicts=0
 const workerDirectories=new Set<string>()
 const model:Model={async run(r){
  const threadId=r.threadId??'native-'+(++seq),turnId='turn-'+(++seq)
  r.onThread?.(threadId);r.onTurn?.(turnId);r.onUsage?.({id:turnId,inputTokens:20,outputTokens:10})
  const input=JSON.parse(r.input);let output:any={reply:''}
  if(input.kind==='goal_verification'){
   let finalFile:string|undefined
   for(const e of input.evidence){
    const result=await r.onTool!('goal_evidence',{id:e.id},e.id)
    if(semanticFile&&input.stage.finalCommit&&e.commit===input.stage.finalCommit&&e.key==='one.txt')finalFile=JSON.parse(result.contentItems[0]!.text!).content
   }
   output={checks:input.criteria.map((cr:any)=>({criterionId:cr.id,verdict:semanticFile&&input.stage.kind==='overall'&&cr.id==='one'&&finalFile!=='published\n'?'failed':'passed',explanation:'Read the retained commit, tests and declared files.',evidenceIds:input.evidence.filter((e:any)=>cr.id==='__goal__'||e.criterionIds.includes(cr.id)).map((e:any)=>e.id)}))}
  }else if(r.role==='worker'){
   const ticketId=r.activity!.ticketId!,g=h.goals.forTask(ticketId)!,node=g.nodes!.find(n=>n.ticketId===ticketId)!
   workerDirectories.add(r.cwd)
   await onWorker?.(r)
   const run=async(command:string)=>{
    const raw=await r.onTool!('superagent_shell',{command,requestId:'shell-'+turnId,yieldMs:10000},turnId)
    const value=JSON.parse(raw.contentItems[0]!.text!)
    if(!raw.success||value.state!=='completed'||value.exitCode!==0)throw Error('Managed git command failed: '+JSON.stringify(value))
    return value
   }
   if(node.id==='one'||node.id==='two'){
    if(semanticFile){
     const edit=node.id==='one'||node.repairs>=2?'echo published > one.txt':node.repairs===0?'echo replaced > one.txt':'rm one.txt'
     await run('set -e; '+edit+'; touch '+node.id+'.txt; git add -A; git commit -qm edit')
    }else if(chain&&node.id==='two'){
     await run('set -e; test -f one.txt; git merge-base --is-ancestor refs/project/'+h.projectCode.parents(g,node).at(-1)+' HEAD; printf "both\\\\n" > mode.txt; touch two.txt; git add .; git commit -qm two')
    }else await run('set -e; printf "%s\\n" '+node.id+' > mode.txt; touch '+node.id+'.txt; git add .; git commit -qm '+node.id)
   }else{
    if(existsSync(join(r.cwd,'.git','MERGE_HEAD'))){
     conflicts++;await run('set -e; test -n "$(git ls-files -u)"; printf "wrong\\n" > mode.txt; git add mode.txt; git commit -qm resolve')
    }else if(node.repairs===1){
     await run('set -e; printf "both\\n" > mode.txt; git add mode.txt; git commit -qm fix-test')
    }else if(node.repairs>=2){
     await run('set -e; printf "reviewed\\n" > release-note; git add release-note; git commit -qm human-feedback')
    }
   }
   output={state:'ready',summary:'Changes committed on '+node.id,reply:'Ready for independent verification.',question:null,askedBy:null,handbacks:[]}
  }
  return {threadId,turnId,text:JSON.stringify(output)}
 }}
 const open=()=>{h=new Runtime(config,{model,clock:()=>clock})}
 open();cleanups.push(async()=>{await h.close()})
 h!.scopes.command({action:'scope.put',operationId:'scope',expectedRevision:0,scope:{id:'team',tenantId:'org',name:'Team',contextBytes:128000,managers:['alice','bob'].map(id=>JSON.stringify(['local',id])),workerIds:['one','two'],sourceIds:['local'],backendIds:['codex']}})
 for(const entry of ['test','elsewhere'])h!.scopes.command({action:'entry.bind',operationId:'bind-'+entry,expectedRevision:0,scopeId:'team',sourceId:'local',accountNamespace:'local',nativeId:entry,history:'group'})
 const receive=(id:string,text:string,actor='alice',thread='test',scope=thread)=>h.receive('local',actor,{id,thread,scope,text,addressed:true}) as {triggerId:string}
 const original=receive('original','Please fix the repository together and bring me the tested commit.')
 const trigger=h!.store.triggers.get(original.triggerId)!,context=h!.scopes.context(trigger,'local:test')!
 const criteria=['one','two'].map(id=>semanticFile&&id==='one'?{id,description:'one.txt must contain published',files:['one.txt']}:{id,description:'Deliver '+id+'.txt',check:{kind:'file_exists',path:id+'.txt'}})
 const g:RouterGoal=h!.goals.command({action:'start',operationId:'project',expectedRevision:0,authorizationQuote:'fix the repository together',objective:'Integrate both edits and pass the repository test.',criteria,nodes:['one','two'].map(id=>({id,workerId:id,title:id,instruction:'Implement '+id,dependsOn:chain&&id==='two'?['one']:[],criterionIds:[id]}))},context)
 const goal=()=>h.goals.get(g.id)!
 async function until(predicate:()=>boolean){
  const end=Date.now()+55000
  while(Date.now()<end){await h.tick();if(predicate())return;const current=goal();if(current.state==='held')throw Error('Project held: '+current.reason);await new Promise(res=>setTimeout(res,15))}
  throw Error('Project timeout: '+JSON.stringify({goal:goal(),receipts:h.store.list('project-commit'),runs:h.store.list<any>('run').map(r=>[r.phase,r.error,r.result]),rounds:h.store.list<VerificationRound>('goal-verification').map(r=>[r.state,r.error])}))
 }
 return {get h(){return h},config,repo,base,goal,receive,until,workerDirectories,get conflicts(){return conflicts},advance:(ms:number)=>{clock+=ms},restart:async()=>{await h.close();open()}}
}

realSandbox('keeps project ownership and acceptance instructions when a running task refreshes prompts',async()=>{
 let checked=false
 const f=project(true,'sh verify.sh',async r=>{
  if(checked)return
  checked=true
  expect(r.instructions).toContain('merge every listed prerequisite SHA locally')
  expect(r.instructions).toContain('independent host acceptance')
  let refreshed=''
  r.onActive?.({interrupt:async()=>{},steer:async()=>{},refresh:async text=>{refreshed=text}})
  const current=f.h.settings.current()
  f.h.settings.save(current.revision,{prompts:{...f.config.prompts,shared:'Live updated team instructions'}})
  const run=f.h.store.get<import('../src/store.ts').Run>('run',r.activity!.ticketId!)!
  await f.h.refreshWork({ticketId:run.ticketId,assignmentId:run.assignmentId,cwd:run.cwd,sandbox:'workspace-write',depth:0})
  expect(refreshed).toContain('Live updated team instructions')
  expect(refreshed).toContain('merge every listed prerequisite SHA locally')
  expect(refreshed).toContain('independent host acceptance')
  expect(refreshed).toContain('"testCommand":"sh verify.sh"')
  expect(refreshed).toContain('Router-delegated subtask')
 })
 await f.until(()=>f.goal().state==='needs_input')
 expect(checked).toBe(true)
},90000)

realSandbox('rechecks changed and deleted upstream files at the final commit and repairs the integration worker',async()=>{
 const f=project(true,'test -f two.txt',undefined,true)
 await f.until(()=>f.goal().state==='needs_input')
 const g=f.goal(),review=g.project!.review!
 expect(g.nodes!.map(n=>n.repairs)).toEqual([0,2])
 const rounds=f.h.store.list<VerificationRound>('goal-verification').filter(r=>!r.nodeId)
 const [changed,deleted,accepted]=rounds
 expect(rounds.map(r=>r.state)).toEqual(['failed','failed','passed'])
 expect(changed!.snapshot.evidence.filter(e=>e.key==='one.txt').map(e=>e.content.trim())).toEqual(['published','replaced'])
 expect(changed!.checks.find(c=>c.criterionId==='one')).toMatchObject({verdict:'failed',method:'agent'})
 expect(deleted!.checks.find(c=>c.criterionId==='one')).toMatchObject({verdict:'failed',method:'program'})
 expect(accepted!.snapshot.finalCommit).toBe(review.head)
 expect(f.h.projectCode.blob(g,review.head,'one.txt',100)?.toString()).toBe('published\n')
},90000)

realSandbox('hands off actual commits, repairs a merge and failed clean test, and releases only the reviewed revision',async()=>{
 const f=project()
 await f.until(()=>f.goal().state==='needs_input')
 const g=f.goal(),p=g.project!,first=p.review!,node=g.nodes!.find(n=>n.id===p.integration)!
 const code=f.h.projectCode.receipt(first.deliveryId)!
 expect(f.conflicts).toBe(1);expect(f.workerDirectories.size).toBe(3)
 expect(code.parents).toHaveLength(3);expect(code.test).toMatchObject({exit:0,output:expect.stringContaining('integrated-passed')})
 expect(f.h.store.list<CodeReceipt>('project-commit').some(c=>c.test?.exit===1)).toBe(true)
 expect(g.taskIds.every(id=>!f.h.store.tickets.get(id)?.ended)).toBe(true)
 expect(operatorWorkspace(f.h).projectReviews.map(r=>r.id)).toEqual([first.id])
 expect(git(f.repo,'rev-parse','HEAD')).toBe(f.base)
 const before=f.h.goals.budget(g)!.elapsedMs
 f.advance(20*60000);await f.restart()
 expect(f.h.goals.budget(f.goal())!.elapsedMs).toBe(before)
 f.receive('wrong-actor','验收通过 '+first.id,'bob');f.receive('wrong-thread','验收通过 '+first.id,'alice','elsewhere')
 expect(f.goal().project!.review!.state).toBe('pending')
 f.receive('return','退回 '+first.id+' Please add a release note.')
 expect(f.goal().nodes!.find(n=>n.id===node.id)!.ticketId).toBe(node.ticketId)
 await f.until(()=>f.goal().project!.review?.state==='pending')
 const second=f.goal().project!.review!
 expect(second.id).not.toBe(first.id);expect(second.head).not.toBe(first.head)
 f.receive('stale','验收通过 '+first.id)
 expect(f.goal().state).toBe('needs_input')
 const server=await serve(f.h)
 try{
  const path='/project-reviews/'+second.id,auth={authorization:'Bearer '+readFileSync(server.tokenPath,'utf8').trim()}
  const download=await fetch(server.url+path+'/patch',{headers:auth})
  expect(await download.text()).toContain('release-note')
  const bundle=await fetch(server.url+path+'/bundle',{headers:auth}),file=join(f.repo,'candidate.bundle')
  writeFileSync(file,Buffer.from(await bundle.arrayBuffer()))
  git(f.repo,'fetch',file,'refs/heads/commits/'+second.head)
  expect(git(f.repo,'show','FETCH_HEAD:mode.txt')).toBe('both')
  expect(git(f.repo,'show','FETCH_HEAD:release-note')).toBe('reviewed')
  const signup=await fetch(server.url+'/account/setup',{method:'POST',headers:{...auth,origin:server.url,'content-type':'application/json'},body:JSON.stringify({username:'project-owner',displayName:'Owner',password:'project review fixture password'})})
  expect(signup.status).toBe(201)
  const cookie=signup.headers.get('set-cookie')!.split(';')[0]!
  const received=new Promise<void>(resolve=>server.server.once('request',()=>resolve()))
  const pending=request(server.url+path,{method:'POST',headers:{origin:server.url,cookie,'content-type':'application/json'}})
  const reply=new Promise<number>((resolve,reject)=>{
   pending.once('response',res=>{res.resume();resolve(res.statusCode!)})
   pending.once('error',reject)
  })
  pending.write('{"decision":')
  await received
  expect((await fetch(server.url+'/account/logout',{method:'POST',headers:{origin:server.url,cookie}})).status).toBe(200)
  pending.end('"approve"}')
  expect(await reply).toBe(401)
  expect(f.goal().project!.review!.state).toBe('pending')
  expect((await fetch(server.url+path,{method:'POST',headers:{...auth,'content-type':'application/json'},body:JSON.stringify({decision:'approve'})})).status).toBe(200)
  await f.until(()=>f.goal().state==='completed')
  expect(f.goal().project!.review).toMatchObject({head:second.head,state:'approved',by:'operator:local-operator'})
  expect(f.goal().taskIds.every(id=>!!f.h.store.tickets.get(id)?.ended)).toBe(true)
  expect(git(f.repo,'rev-parse','HEAD')).toBe(f.base)
 }finally{server.server.closeAllConnections();await new Promise<void>(done=>server.server.close(()=>done()))}
},120000)

realSandbox('recovers a missing pending review notice after restart without duplicating it or resetting the human wait',async()=>{
 const f=project(true)
 f.h.goals.notice=()=>{}
 await f.until(()=>f.goal().project?.review?.state==='pending')
 const review=structuredClone(f.goal().project!.review!)
 expect(f.h.store.deliveries().some(d=>d.text.includes('验收通过 '+review.id))).toBe(false)
 f.advance(60000)
 await f.restart()
 await f.until(()=>f.h.store.deliveries().some(d=>d.text.includes('验收通过 '+review.id)&&d.status==='sent'))
 await f.h.goals.advance();await f.h.flush()
 expect(f.h.store.deliveries().filter(d=>d.text.includes('验收通过 '+review.id))).toHaveLength(1)
 expect(f.goal().project!.review).toEqual(review)
},90000)

realSandbox('delivers goal notices after task input advances while retaining ownership checks',async()=>{
 const f=project(true)
 await f.until(()=>f.goal().project?.review?.state==='pending')
 const g=f.goal(),context=f.h.goals.context(g),ticketId=g.taskIds[0]!
 const {manifest}=f.h.memory.build(context,{},'codex')
 const owner=f.h.scopes.ownership(ticketId)!
 manifest.taskOwners=[{id:ticketId,epoch:owner.ownerEpoch,dataRevision:owner.dataRevision??1}]
 f.h.store.put('context-manifest',manifest.id,manifest)
 g.contextIds=[...(g.contextIds??[]),manifest.id]
 f.h.store.put('router-goal',g.id,g)
 f.h.scopes.noteInput(ticketId,context)
 expect(()=>f.h.memory.validate(manifest)).toThrow('Task input changed')
 f.h.goals.notice(g,'Review the retained commit',true)
 const notice=()=>f.h.store.deliveries().find(d=>d.text==='Review the retained commit')
 expect(notice()?.status).toBe('pending')
 await f.h.flush()
 expect(notice()?.status).toBe('sent')
 expect(f.h.store.get<any>('context-manifest',manifest.id).taskOwners[0].dataRevision).toBe(1)
 f.h.store.put('task-ownership',ticketId,{...f.h.scopes.ownership(ticketId)!,ownerEpoch:owner.ownerEpoch+1})
 f.h.goals.notice(g,'Ownership changed',true)
 expect(f.h.store.deliveries().some(d=>d.text==='Ownership changed')).toBe(false)
},90000)

realSandbox('returns scheduled and webhook project reviews to the person and thread that authorized them',async()=>{
 const f=project(true),initial=f.goal()
 await f.until(()=>f.goal().project?.review?.state==='pending')
 f.receive('approve-original','验收通过 '+f.goal().project!.review!.id)
 await f.until(()=>f.goal().state==='completed')
 const draft=f.h.skills.command({action:'draft',goalId:initial.id})
 const saved=f.h.skills.command({action:'save',goalId:initial.id,expectedVersion:0,template:draft.template}),skill={id:saved.id,version:saved.version}
 const prompt='Repeat this repository fix and send me the tested commit.'
 const {triggerId}=f.receive('authorize',prompt,'alice','request','test')
 f.h.proactive.command({action:'schedule.put',scopeId:'team',operationId:'schedule',expectedRevision:0,schedule:{id:'code',name:'Code',triggerId,prompt,skill,timing:{kind:'once',startAt:new Date(Date.now()+86400000).toISOString(),timezone:'UTC'},mode:'standalone',notification:'always'}})
 const run=f.h.proactive.command({action:'schedule.run',scopeId:'team',operationId:'run',expectedRevision:1,id:'code'}) as {id:string}
 f.h.proactive.runSkill(run.id)
 const scheduled=f.h.store.get<{goalId:string}>('router-schedule-run',run.id)!.goalId

 const suffix=randomBytes(5).toString('hex'),inKey='CODE_IN_'+suffix,outKey='CODE_OUT_'+suffix
 for(const name of [inKey,outKey])process.env[name]='whsec_'+randomBytes(32).toString('base64')
 cleanups.push(()=>{delete process.env[inKey];delete process.env[outKey]})
 const origin='http://127.0.0.1:18086'
 f.config.webhooks={port:0,loopbackCallbackOrigins:[origin]}
 const grant=f.h.webhooks.create({operationId:'hook',triggerId,authorizationQuote:prompt,namespace:'code',eventSource:origin,eventTypes:['code.request'],secretEnvs:[inKey],parameters:{},template:saved.template,expiresAt:Date.now()+86400000,maxEvents:1,callback:{url:origin+'/callback',secretEnv:outKey,idempotent:true}})
 f.h.webhooks.control({id:grant.id,action:'pause_delivery',operationId:'pause-callback'})
 const body=Buffer.from(JSON.stringify({specversion:'1.0',id:'build',source:origin,type:'code.request',data:{}})),timestamp=String(Math.floor(Date.now()/1000))
 const receipt=f.h.webhooks.receive(grant.id,{'webhook-id':'build','webhook-timestamp':timestamp,'webhook-signature':signWebhook(secretFromEnv(inKey),'build',timestamp,body)},body)
 f.h.webhooks.dispatch()
 const webhook=f.h.webhooks.receipt(receipt.receiptId)!.goalId!
 for(const goalId of [scheduled,webhook]){
  const goal=()=>f.h.goals.get(goalId)!
  expect(goal().project?.base).toBe(f.base)
  expect(goal().project?.policy.budget?.maxMinutes).toBe(10)
  await f.until(()=>goal().project?.review?.state==='pending')
  const review=goal().project!.review!,command='验收通过 '+review.id
  await f.until(()=>f.h.store.deliveries().some(d=>d.text.includes(command)&&d.channel.thread==='request'&&d.status==='sent'))
  f.receive(goalId+'-wrong-person',command,'bob','request','test')
  f.receive(goalId+'-wrong-thread',command,'alice','unrelated','test')
  expect(goal().project!.review!.state).toBe('pending')
  f.receive(goalId+'-owner',command,'alice','request','test')
  await f.until(()=>goal().state==='completed')
  expect(goal().project?.review).toMatchObject({state:'approved',by:JSON.stringify(['local','alice'])})
 }
 const finished=f.h.goals.get(webhook)!,reviewId=finished.project!.review!.id
 f.h.goals.notice(finished,'Delayed project notice',true)
 const notice=()=>f.h.store.deliveries().find(d=>d.text==='Delayed project notice')
 expect(notice()?.status).toBe('pending')
 f.h.webhooks.control({id:grant.id,action:'revoke',operationId:'revoke'})
 await f.h.flush()
 expect(notice()?.status).toBe('dropped')
 const replay=f.receive('revoked-grant','验收通过 '+reviewId,'alice','request','test')
 expect(f.h.store.deliveries().find(d=>d.id==='project-review-input:'+replay.triggerId)?.text).toContain('automation_grant_revoked_or_expired')
},120000)

realSandbox('refreshes pending legacy review evidence after upgrading without charging the human wait',async()=>{
 const f=project(true)
 await f.until(()=>f.goal().project?.review?.state==='pending')
 const g=f.goal(),review=g.project!.review!,round=f.h.store.get<VerificationRound>('goal-verification',g.finalRoundId!)!
 const snapshot={...round.snapshot,evidence:round.snapshot.evidence.map(({commit,...e})=>e)}
 delete snapshot.finalCommit
 const roundId='verify-'+stableDigest([g.id,'goal',snapshot]),reviewId=stableDigest([g.id,roundId,review.deliveryId,review.head]).slice(0,16)
 f.h.store.put('goal-verification',roundId,{...round,id:roundId,snapshot})
 f.h.store.db.prepare("DELETE FROM records WHERE kind='goal-verification' AND id=?").run(round.id)
 g.finalRoundId=roundId;g.project!.review={...review,id:reviewId,roundId}
 f.h.store.put('router-goal',g.id,g);f.h.store.put('project-review',reviewId,{goalId:g.id,...g.project!.review})
 expect(()=>f.h.goals.decideOperator(reviewId,'approve','reviewer')).toThrow(/evidence changed/)
 const elapsed=f.h.goals.budget(g)!.elapsedMs
 f.advance(20*60000)
 await f.restart()
 await f.h.goals.advance()
 expect(f.goal().state).toBe('active')
 expect(f.h.goals.budget(f.goal())!.elapsedMs).toBe(elapsed)
 await f.until(()=>f.goal().project?.review?.state==='pending')
 const fresh=f.goal().project!.review!
 expect(fresh.id).not.toBe(reviewId)
 expect(fresh.head).toBe(review.head)
 expect(f.h.store.get<VerificationRound>('goal-verification',fresh.roundId)!.snapshot.finalCommit).toBe(fresh.head)
 expect(()=>f.h.goals.decideOperator(reviewId,'approve','reviewer')).toThrow(/unavailable/)
 f.receive('approve-upgrade','验收通过 '+fresh.id)
 await f.until(()=>f.goal().state==='completed')
},90000)

realSandbox('preserves a sequential handoff and approved Git artifacts through backup and restore',async()=>{
 const f=project(true)
 await f.until(()=>!!f.h.store.get('project-base',f.goal().id))
 expect(f.h.store.list('project-commit')).toHaveLength(0)
 const early=join(f.repo,'baseline-backup')
 await backupState(f.config,early)
 expect(Object.keys(verifyBackup(early).projectFiles)).toEqual([expect.stringContaining(f.base+'.bundle')])
 await f.until(()=>f.goal().state==='needs_input')
 const goal=f.goal(),review=goal.project!.review!
 expect(goal.nodes!.map(n=>n.id)).toEqual(['one','two'])
 const parents=f.h.projectCode.receipt(review.deliveryId)!.parents
 expect(parents).toHaveLength(2)
 expect(f.h.projectCode.blob(goal,review.head,'one.txt',100)).toEqual(Buffer.alloc(0))
 expect(f.h.projectCode.blob(goal,review.head,'ignored-local-file',100)).toBeUndefined()
 const originalFile=join(f.h.projectCode.workspace(goal.nodes![1]!.ticketId!),'two.txt')
 writeFileSync(originalFile,'local edit after submission')
 f.receive('approve','验收通过 '+review.id)
 await f.until(()=>f.goal().state==='completed')
 expect(f.goal().project?.review?.by).toBe(JSON.stringify(['local','alice']))
 const elapsed=f.h.goals.budget(f.goal())!.elapsedMs
 f.advance(60000)
 expect(f.h.goals.budget(f.goal())!.elapsedMs).toBe(elapsed)
 const archive=join(f.repo,'backup'),copy=join(f.repo,'restored')
 await backupState(f.config,archive)
 const manifest=verifyBackup(archive)
 expect(manifest.schema).toBe(13);expect(Object.keys(manifest.projectFiles)).toHaveLength(4)
 await restoreState({...f.config,stateDir:copy},archive)
 const clone=new Runtime({...f.config,stateDir:copy})
 try{
  const restored=clone.goals.operatorReview(review.id)
  expect(clone.projectCode.blob(restored,review.head,'two.txt',100)).toEqual(Buffer.alloc(0))
  expect(readFileSync(clone.projectCode.file(restored,'patch'),'utf8')).toContain('two.txt')
 }finally{await clone.close()}
 const patch=Object.keys(manifest.projectFiles).find(file=>file.endsWith('.patch'))!
 writeFileSync(join(archive,patch),'broken')
 expect(()=>verifyBackup(archive)).toThrow('checksum mismatch')
},90000)

realSandbox('compares the tested files against trusted Git metadata even if the test changes its index',async()=>{
 const f=project(true,[
  'set -e','sh verify.sh','git update-index --assume-unchanged mode.txt',
  'printf "evil\\n" > mode.txt','git diff --quiet HEAD --','grep -Fx evil mode.txt',
 ].join('\n'))
 await f.until(()=>f.h.store.list<CodeReceipt>('project-commit').some(r=>r.error?.includes('The test changed tracked code')))
 expect(f.goal().project?.review).toBeUndefined()
},90000)

realSandbox.each([false,true])('resumes a project paused during a Worker turn on the same retained task, legacy %s',async legacy=>{
 let calls=0,ticketId=''
 const f=project(true,'sh verify.sh',async r=>{
  if(calls++>0)return
  ticketId=r.activity!.ticketId!
  await new Promise<void>((_,reject)=>r.signal!.addEventListener('abort',()=>reject(r.signal!.reason),{once:true}))
 })
 const command=(action:'pause'|'resume')=>{
  const g=f.goal(),receipt=f.receive(action,'Please '+action+' this project.')
  const context=f.h.scopes.context(f.h.store.triggers.get(receipt.triggerId)!,'local:test')!
  return f.h.goals.command({action,id:g.id,operationId:action,expectedRevision:g.revision},context)
 }
 await f.until(()=>!!ticketId)
 const assignment=f.h.store.tickets.get(ticketId)!.assignments.at(-1)!.id
 command('pause')
 await f.until(()=>f.h.store.get<{phase:string}>('run',ticketId)?.phase==='idle')
 if(legacy){const g=f.goal();for(const node of g.nodes!)delete node.pausedAssignment;f.h.store.put('router-goal',g.id,g)}
 await f.restart()
 command('resume')
 await expect.poll(async()=>{await f.h.tick();return calls},{timeout:4000}).toBeGreaterThan(1)
 await f.until(()=>f.goal().project?.review?.state==='pending')
 expect(f.goal().nodes!.find(n=>n.id==='one')?.ticketId).toBe(ticketId)
 expect(f.h.store.tickets.get(ticketId)!.assignments.at(-1)!.id).toBe(assignment)
},90000)

it('charges only project activity, counts reported tokens once and stops before starting work past either limit',async()=>{
 const f=project(),g=f.goal(),policy=g.project!.policy
 policy.budget={maxMinutes:1,cost:{maxUsd:0.01,inputUsdPerMillion:10,outputUsdPerMillion:20}}
 const ledger=f.h.usage,triggerId=g.triggerId
 ledger.begin('other','router',{triggerId:'unrelated'});ledger.finish('other','completed')
 ledger.begin('model','router',{triggerId});ledger.attempt('model',0,'running')
 for(const outputTokens of [20,200])ledger.record('model',0,{id:'step',inputTokens:800,outputTokens,cachedInputTokens:300,reasoningOutputTokens:10})
 ledger.finish('model','completed')
 expect(projectBudget(f.h.store,g,g.at)).toMatchObject({estimatedUsd:0.012,unknownCalls:0,reason:expect.stringContaining('费用')})
 policy.budget.cost!.maxUsd=1;ledger.begin('missing','subagent',{triggerId});ledger.finish('missing','completed')
 expect(projectBudget(f.h.store,g,g.at)?.unknownCalls).toBe(1)
 delete policy.budget.cost
 f.h.store.put('router-goal',g.id,g);f.advance(61000);await f.h.tick()
 expect(f.goal()).toMatchObject({state:'held',reason:expect.stringContaining('时间预算'),taskIds:[]})
})
