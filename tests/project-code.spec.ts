import {afterEach,expect,it} from 'vitest'
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,existsSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {execFileSync} from 'node:child_process'
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

const git=(cwd:string,...args:string[])=>execFileSync('git',['-c','core.hooksPath=/dev/null',...args],{cwd,encoding:'utf8'}).trim()
const cleanups:(()=>Promise<void>|void)[]=[]
afterEach(async()=>{for(const fn of cleanups.splice(0).reverse())await fn()})
const realSandbox=it.skipIf(!['darwin','linux'].includes(process.platform)||process.platform==='linux'&&!process.env.PATH?.split(':').some(p=>existsSync(join(p,'bwrap'))))
function project(chain=false){
 const root=mkdtempSync(join(tmpdir(),'roppo-project-test-')),repo=join(root,'source'),stateDir=join(root,'state')
 cleanups.push(()=>rmSync(root,{recursive:true,force:true}));mkdirSync(repo)
 git(repo,'init','-q');git(repo,'config','user.email','project@example.com');git(repo,'config','user.name','Project')
 writeFileSync(join(repo,'mode.txt'),'base\n')
 writeFileSync(join(repo,'verify.sh'),'set -e\ngrep -Fx both mode.txt\ntest -f one.txt && test -f two.txt\necho integrated-passed\n')
 git(repo,'add','.');git(repo,'commit','-qm','Initial project')
 const base=git(repo,'rev-parse','HEAD'),now=Date.now()
 const config=configSchema.parse({port:0,stateDir,acceptMode:'auto',work:{network:false,sandboxDriver:process.platform==='darwin'?'seatbelt':'bubblewrap'},execution:{router:{mode:'host'},management:{enabled:true,maxWorkers:2},workers:[{id:'one',backend:'codex'},{id:'two',backend:'codex'}]},sources:[{id:'local',kind:'local',cwd:repo,workspace:{mode:'directory',project:{testCommand:'sh verify.sh',budget:{maxMinutes:10}}},sandbox:'workspace-write',allowedActors:['alice','bob']}]})
 let h:Runtime,clock=now,seq=0,conflicts=0
 const workerDirectories=new Set<string>()
 const model:Model={async run(r){
  const threadId=r.threadId??'native-'+(++seq),turnId='turn-'+(++seq)
  r.onThread?.(threadId);r.onTurn?.(turnId);r.onUsage?.({id:turnId,inputTokens:20,outputTokens:10})
  const input=JSON.parse(r.input);let output:any={reply:''}
  if(input.kind==='goal_verification'){
   for(const e of input.evidence)await r.onTool!('goal_evidence',{id:e.id},e.id)
   output={checks:input.criteria.map((cr:any)=>({criterionId:cr.id,verdict:'passed',explanation:'Read the retained commit, tests and declared files.',evidenceIds:input.evidence.filter((e:any)=>cr.id==='__goal__'||e.criterionIds.includes(cr.id)).map((e:any)=>e.id)}))}
  }else if(r.role==='worker'){
   const ticketId=r.activity!.ticketId!,g=h.goals.forTask(ticketId)!,node=g.nodes!.find(n=>n.ticketId===ticketId)!
   workerDirectories.add(r.cwd)
   const run=async(command:string)=>{
    const raw=await r.onTool!('superagent_shell',{command,requestId:'shell-'+turnId,yieldMs:10000},turnId)
    const value=JSON.parse(raw.contentItems[0]!.text!)
    if(!raw.success||value.state!=='completed'||value.exitCode!==0)throw Error('Managed git command failed: '+JSON.stringify(value))
    return value
   }
   if(node.id==='one'||node.id==='two'){
    if(chain&&node.id==='two'){
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
 h!.scopes.command({action:'scope.put',operationId:'scope',expectedRevision:0,scope:{id:'team',tenantId:'org',name:'Team',contextBytes:128000,managers:[JSON.stringify(['local','alice'])],workerIds:['one','two'],sourceIds:['local'],backendIds:['codex']}})
 for(const entry of ['test','elsewhere'])h!.scopes.command({action:'entry.bind',operationId:'bind-'+entry,expectedRevision:0,scopeId:'team',sourceId:'local',accountNamespace:'local',nativeId:entry,history:'group'})
 const receive=(id:string,text:string,actor='alice',thread='test')=>h.receive('local',actor,{id,thread,scope:thread,text,addressed:true}) as {triggerId:string}
 const original=receive('original','Please fix the repository together and bring me the tested commit.')
 const trigger=h!.store.triggers.get(original.triggerId)!,context=h!.scopes.context(trigger,'local:test')!
 const g:RouterGoal=h!.goals.command({action:'start',operationId:'project',expectedRevision:0,authorizationQuote:'fix the repository together',objective:'Integrate both edits and pass the repository test.',criteria:['one','two'].map(id=>({id,description:'Deliver '+id+'.txt',check:{kind:'file_exists',path:id+'.txt'}})),nodes:['one','two'].map(id=>({id,workerId:id,title:id,instruction:'Implement '+id,dependsOn:chain&&id==='two'?['one']:[],criterionIds:[id]}))},context)
 const goal=()=>h.goals.get(g.id)!
 async function until(predicate:()=>boolean){
  const end=Date.now()+55000
  while(Date.now()<end){await h.tick();if(predicate())return;const current=goal();if(current.state==='held')throw Error('Project held: '+current.reason);await new Promise(res=>setTimeout(res,15))}
  throw Error('Project timeout: '+JSON.stringify({goal:goal(),receipts:h.store.list('project-commit'),runs:h.store.list<any>('run').map(r=>[r.phase,r.error,r.result]),rounds:h.store.list<VerificationRound>('goal-verification').map(r=>[r.state,r.error])}))
 }
 return {get h(){return h},config,repo,base,goal,receive,until,workerDirectories,get conflicts(){return conflicts},advance:(ms:number)=>{clock+=ms},restart:async()=>{await h.close();open()}}
}

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
  expect((await fetch(server.url+path,{method:'POST',headers:{...auth,'content-type':'application/json'},body:JSON.stringify({decision:'approve'})})).status).toBe(200)
  await f.until(()=>f.goal().state==='completed')
  expect(f.goal().project!.review).toMatchObject({head:second.head,state:'approved',by:'operator:local-operator'})
  expect(f.goal().taskIds.every(id=>!!f.h.store.tickets.get(id)?.ended)).toBe(true)
  expect(git(f.repo,'rev-parse','HEAD')).toBe(f.base)
 }finally{server.server.closeAllConnections();await new Promise<void>(done=>server.server.close(()=>done()))}
},120000)

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
