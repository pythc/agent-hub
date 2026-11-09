/** Opt-in real GitHub + real CLI/model acceptance. Creates comments, draft PRs
 * and commit statuses ONLY in an explicitly named dedicated private repository.
 * Usage: AGENTHUB_GITHUB_TOKEN=<private env> tsx examples/plugin-live-github.ts <new-evidence-root> <private-validation-repository>
 * The evidence root must already contain its clone at repository/.
 */
import {readFileSync,writeFileSync,mkdirSync,existsSync,copyFileSync,chmodSync} from 'node:fs'
import {join,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {spawn,execFileSync} from 'node:child_process'
import {createHash} from 'node:crypto'
import {Runtime} from '../src/runtime.ts'
import {buildPluginPackage,readPluginPackage} from '../src/plugin-package.ts'
import {buildBackendPackage} from '../src/backends/plugin-package.ts'
import {configSchema} from '../src/config.ts'

const [destination,repository]=process.argv.slice(2),phase=process.env.AGENTHUB_GITHUB_PHASE
if(!destination||!repository||!/^\w[\w.-]*\/agenthub-github-validation[\w.-]*$/.test(repository))throw Error('An explicit dedicated validation repository is required')
const root=resolve(destination),cwd=join(root,'repository'),sourceRoot=fileURLToPath(new URL('../',import.meta.url))
const nativeBackend=process.env.AGENTHUB_GITHUB_NATIVE==='1'
const save=(name:string,value:unknown)=>writeFileSync(join(root,name),JSON.stringify(value,null,2),{mode:0o600})
const digest=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex')
const implementationFiles=['src/worker-manager.ts','src/router-candidates.ts','src/repository-source.ts','src/delivery.ts','src/goal-verification.ts','src/router-goals.ts','src/merge.ts','src/plugin-package.ts','src/plugin-process.ts','src/plugin-worker.mjs','plugins/github/github.ts','plugins/github/package.ts','plugins/github/manifest.json','src/backends/plugin-process.ts','src/backends/plugin-contract.ts','src/backends/plugin-worker.mjs','plugins/backend-codex/model.ts','plugins/backend-codex/index.ts']
const implementation=Object.fromEntries(implementationFiles.map(p=>[p,digest(readFileSync(join(sourceRoot,p)))]))
// gh is used only by the acceptance controller; the plugin uses its isolated HTTP credential.
const api=(path:string,method='GET',body?:unknown)=>JSON.parse(execFileSync('gh',['api','--method',method,path,...(body===undefined?[]:['--input','-'])],{input:body===undefined?undefined:JSON.stringify(body),encoding:'utf8',timeout:60000,stdio:['pipe','pipe','pipe']}))
const git=(...args:string[])=>execFileSync('git',['-c','core.hooksPath=/dev/null','-c','http.version=HTTP/1.1',...args],{cwd,encoding:'utf8',timeout:60000}).trim()
const expected={rows:3,cents:660,empty:{rows:0,cents:0}}
const tests=`import assert from 'node:assert/strict';\nimport {summarize} from './summary.mjs';\nassert.deepEqual(summarize('name,amount\\nA,1.10\\nB,2.20\\nC,3.30\\n'),{rows:3,cents:660});\nassert.deepEqual(summarize('name,amount\\n'),{rows:0,cents:0});\nassert.deepEqual(summarize(''),{rows:0,cents:0});\nconsole.log('PASS normal, header-only and empty CSV');\n`
const contract={action:'start',operationId:'github-summary-goal',expectedRevision:0,title:'CSV summary with verified GitHub delivery',objective:'Implement summarize(csv) in summary.mjs to return {rows,cents}, summing decimal currency using integer cents. Normal CSV, header-only CSV and empty input must pass the frozen tests.mjs. Publish and update one draft PR in the dedicated validation repository. Produce acceptance.json and report.md with correct supported results. Never merge, deploy, broaden repository scope or change the tests.',authorizationQuote:'Continuously implement and verify the CSV summary, repair failures, and deliver one draft PR',maxParallel:1,maxRepairs:3,maxTurns:40,
 criteria:[{id:'results',description:'acceptance.json contains exactly the specified normal and empty results',check:{kind:'json_equals',path:'acceptance.json',pointer:'',expected}},{id:'tests',description:'tests.log proves the frozen normal, header-only and empty CSV assertions passed',check:{kind:'text_contains',path:'tests.log',text:'PASS normal, header-only and empty CSV'}},{id:'coherence',description:'summary.mjs implements the currency summary correctly and report.md accurately describes the results, tests and draft PR. tests.mjs remains unchanged. The reported result must match the source and evidence.',files:['summary.mjs','tests.mjs','tests.log','acceptance.json','report.md']}],
 nodes:[{id:'implementation',title:'Implement, publish, repair and verify',workerId:'one',criterionIds:['results','tests','coherence'],instruction:`Implement the immutable objective in the isolated Git worktree. Use superagent_publish to create/update ONE draft PR; never git push yourself. Controlled acceptance fault injection, without changing the criteria: (1) On the first attempt (no stage-one.txt), implement normal CSV but deliberately throw on empty/header-only input, run frozen tests.mjs and preserve its failure in tests.log, create stage-one.txt, publish the draft PR, then return waiting with 'Waiting for external CI failure evidence'. Do not repair until a new CI/comment input arrives. (2) On receiving that input, fix summary.mjs, run the unchanged tests into tests.log, and write report.md. For this first ready proposal ONLY (no proposed-once.txt), deliberately put cents=999 in acceptance.json while claiming completion; create proposed-once.txt. This tests the independent host verifier: it must reject the incorrect result. Publish and return ready. (3) On independent rejection, repair acceptance.json to ${JSON.stringify(expected)}, rerun tests, correct report.md, publish the SAME PR and return ready. Never alter tests.mjs or acceptance requirements.`}]}

function aggregate(){
 const plan=JSON.parse(readFileSync(join(root,'plan.json'),'utf8'))
 const phases=[0,1,2,3].map(p=>JSON.parse(readFileSync(join(root,'phase-'+p+'.json'),'utf8'))),final=phases[3],goal=final.goals[0],taskId=goal.taskIds[0],offline=JSON.parse(readFileSync(join(root,'offline-events.json'),'utf8')),pull=api('repos/'+repository+'/pulls/'+final.published.at(-1).number)
 const checks={oneGoal:final.goals.length===1,oneTask:final.tickets.length===1,sameTaskAcrossRestart:phases.every(p=>p.goals[0].taskIds[0]===taskId),goalCompleted:goal.state==='completed',commentRecovered:final.triggers.some((t:any)=>t.meta.eventKind==='comment'&&String(t.meta.nativeId)===String(offline.comment.id)),ciRecovered:final.triggers.some((t:any)=>t.meta.eventKind==='ci-status'&&JSON.parse(t.text).conclusion==='failure'),ciAttached:final.assessments.some((a:any)=>a.assessment?.action==='attach'&&a.assessment.targetTicketId===taskId),falseReadyIntercepted:final.rounds.some((r:any)=>r.state==='failed'),automaticRepair:final.repairs.length>0,independentVerifier:final.sessions.some((s:any)=>s.agentId?.startsWith('goal-verify:')),acceptedBeforeRelease:final.releases.length>0&&final.releases.every((r:any)=>final.rounds.some((v:any)=>!v.nodeId&&v.state==='passed'&&v.finishedAt<=r.at)),testsUnchanged:final.testsSha===digest(tests),sameMandate:phases.every(p=>JSON.stringify(p.tickets[0].mandate)===JSON.stringify(phases[0].tickets[0].mandate)),immutableCriteria:phases.every(p=>JSON.stringify(p.goals[0].criteria)===JSON.stringify(phases[0].goals[0].criteria)),upgraded:phases[2].probe.upgradeCanary===true,rolledBack:!final.probe.upgradeCanary&&final.plugins[0].revision===3,codeOnlyRollback:final.triggers.length>=phases[1].triggers.length,unchangedImplementation:phases.every(p=>JSON.stringify(p.implementation)===JSON.stringify(implementation)),draftNeverMerged:pull.draft&&!pull.merged,realCI:!!final.successStatus&&api('repos/'+repository+'/commits/'+pull.head.sha+'/statuses').some((s:any)=>s.id===final.successStatus.id&&s.state==='success'),noRouterErrors:final.errors.length===0}
 const executionChecks=nativeBackend?{}:{externalBackend:phases.every(p=>p.backendThreads?.length>0&&p.sessions.every((s:any)=>!s.threadId||s.threadId.startsWith('plugin:'))),noUnknownEffects:phases.every(p=>p.backendEffects?.every((e:any)=>e.state==='complete')),nativeWorkerResumed:phases[1].backendThreads?.some((t:any)=>t.id===phases[1].runs[0]?.threadId&&t.id===phases[0].runs[0]?.threadId&&t.nativeId&&phases[0].backendThreads?.some((old:any)=>old.id===t.id&&old.nativeId===t.nativeId&&old.turnId!==t.turnId))===true};Object.assign(checks,executionChecks)
 const evidence={ok:Object.values(checks).every(Boolean),checks,executionBackend:nativeBackend?'native-codex':'codex-cli-plugin',repository,issueUrl:plan.issueUrl,pullUrl:pull.html_url,implementation,goal,versions:phases.map(p=>({phase:p.phase,pid:p.pid,version:p.plugins[0].version,revision:p.plugins[0].revision})),faultInjection:'First commit intentionally fails frozen empty-input tests; first ready proposal intentionally reports cents=999. Neither changes the immutable acceptance criteria.'}
 save('evidence.json',evidence);console.log(JSON.stringify(evidence));if(!evidence.ok)process.exitCode=1
}

if(process.env.AGENTHUB_GITHUB_REPORT_ONLY==='1'){aggregate()}else if(phase===undefined){
 if(existsSync(join(root,'state'))||existsSync(join(root,'plan.json')))throw Error('Use a fresh acceptance state directory')
 const repo=api('repos/'+repository);if(!repo.private)throw Error('Validation repository must be private')
 if(!process.env.AGENTHUB_GITHUB_TOKEN)throw Error('Private GitHub token env is missing')
 mkdirSync(root,{recursive:true,mode:0o700});mkdirSync(join(root,'codex-home'),{recursive:true,mode:0o700})
 copyFileSync(join(process.env.HOME!,'.codex/auth.json'),join(root,'codex-home/auth.json'));chmodSync(join(root,'codex-home/auth.json'),0o600)
 writeFileSync(join(cwd,'summary.mjs'),"export function summarize() { throw new Error('Not implemented'); }\n")
 writeFileSync(join(cwd,'tests.mjs'),tests);writeFileSync(join(cwd,'sample.csv'),'name,amount\nA,1.10\nB,2.20\nC,3.30\n')
 git('add','summary.mjs','tests.mjs','sample.csv');if(git('diff','--cached','--name-only'))git('-c','user.name=AgentHub Validation','-c','user.email=validation@localhost.invalid','commit','-m','Seed immutable CSV acceptance task');git('push','origin','main')
 const manifest=JSON.parse(readFileSync(join(sourceRoot,'plugins/github/manifest.json'),'utf8'))
 const v1=await buildPluginPackage(join(sourceRoot,'plugins/github/package.ts'),manifest,join(root,'github-v1'))
 // Code really differs: v2 adds an informational probe field; state protocol stays 1.
 const wrapper=join(root,'github-v2-entry.ts')
 writeFileSync(wrapper,`import {PackagedGithub} from ${JSON.stringify(join(sourceRoot,'plugins/github/package.ts'))};\nclass Next extends PackagedGithub { async probe(){return {...await super.probe(),version:'1.1.0',upgradeCanary:true}} }\nexport default {create:(c:any,h:any)=>new Next(c,h)};\n`)
 const v2=await buildPluginPackage(wrapper,{...manifest,version:'1.1.0'},join(root,'github-v2'))
 const backend=await buildBackendPackage(join(sourceRoot,'plugins/backend-codex/index.ts'),JSON.parse(readFileSync(join(sourceRoot,'plugins/backend-codex/manifest.json'),'utf8')),join(root,'codex-package'))
 const since=new Date(Date.now()-2000).toISOString(),issue=api('repos/'+repository+'/issues','POST',{title:'CSV summary: live plugin lifecycle acceptance',body:'/agent Continuously implement and verify the CSV summary, repair failures, and deliver one draft PR. Dedicated controlled acceptance task; do not merge or deploy. GoalContract: '+JSON.stringify(contract)})
 save('plan.json',{v1,v2,backend,since,issue:issue.number,issueUrl:issue.html_url,repository,implementation,testsSha:digest(tests),contract})
 for(let p=0;p<4;p++){
  await new Promise<void>((ok,fail)=>{const child=spawn(process.execPath,['--import','tsx',fileURLToPath(import.meta.url),root,repository],{env:{...process.env,AGENTHUB_GITHUB_PHASE:String(p),AGENTHUB_GITHUB_CODEX_HOME:join(root,'codex-home')},stdio:'inherit'});child.on('error',fail);child.on('exit',code=>code===0?ok():fail(Error('GitHub acceptance phase '+p+' exited '+code)))})
  if(p===0){
   const checkpoint=JSON.parse(readFileSync(join(root,'phase-0.json'),'utf8')),published=checkpoint.published.at(-1),run=checkpoint.runs.find((r:any)=>r.ticketId===checkpoint.goals[0].taskIds[0])
   let output='',failed=false;try{output=execFileSync(process.execPath,['tests.mjs'],{cwd:run.cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']})}catch(e:any){failed=true;output=String(e.stdout??'')+String(e.stderr??'')}
   if(!failed)throw Error('Controlled failing commit unexpectedly passed')
   writeFileSync(join(root,'ci-initial.log'),output,{mode:0o600})
   const status=api('repos/'+repository+'/statuses/'+published.sha,'POST',{state:'failure',context:'agenthub-validation/frozen-tests',description:'Actual frozen CSV tests failed; inspect empty input handling'})
   const comment=api('repos/'+repository+'/issues/'+issue.number+'/comments','POST',{body:'Please keep the original requirements: empty CSV and a header-only CSV must both return zero rows and zero cents. The draft PR CI failed on these existing cases; continue the same task and repair it.'})
   save('offline-events.json',{status:{id:status.id,sha:published.sha,context:status.context,state:status.state},comment:{id:comment.id,url:comment.html_url,body:comment.body},hostWasStopped:true})
  }
 }
 aggregate()
}else{
 const plan=JSON.parse(readFileSync(join(root,'plan.json'),'utf8')),pkg=readPluginPackage(phase==='2'?plan.v2.directory:plan.v1.directory),codex=process.env.AGENTHUB_CODEX??'/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex'
 const config=configSchema.parse({stateDir:join(root,'state'),codex,backendPlugins:[{directory:plan.backend.directory,digest:plan.backend.digest}],backends:{external:{kind:'plugin',plugin:'codex-cli',config:{command:codex,args:['-c','project_doc_max_bytes=0']},env:{CODEX_HOME:'AGENTHUB_GITHUB_CODEX_HOME',HTTP_PROXY:'HTTP_PROXY',HTTPS_PROXY:'HTTPS_PROXY'},readPaths:[join(root,'codex-home'),resolve(codex,'..')],writePaths:[join(root,'codex-home')]}},acceptMode:'auto',rules:[{id:'owned-ci-repair',instruction:'Attach failed CI evidence on an existing task owned PR to that same task and repair within its original objective and acceptance. Ignore successful CI and unrelated activity. Never start duplicate work or alter original authority.'}],turnTimeoutMs:600000,work:{sandboxDriver:'seatbelt',network:false},delivery:{workerPublish:true,autoMerge:false,maxDraftLines:500},execution:{backend:'external',router:{mode:'host',backend:'external',model:'gpt-6.1-terra',effort:'medium',prompt:'This is a dedicated GitHub acceptance task. On the initial explicit request start exactly one router_goal using its exact attached GoalContract. Host schedules and verifies its node. Never manually assign new Workers or goals for follow-ups. For admitted CI failure, use worker_manage send on the existing attached task to repair within its unchanged original goal; do not change its reply owner or requirements. On unaddressed Issue comments inspect the existing task and preserve the original goal. Read reports when notified. Reply ACCEPTED only if durable goal state is completed; otherwise an empty reply is fine. Never merge or change host configuration.'},management:{enabled:true,maxWorkers:1},workers:[{id:'one',backend:'external',model:'gpt-6.1-sol',effort:'high',tools:['superagent_shell','superagent_read','superagent_publish'],prompt:'Use only managed tools for file operations and commands. Follow the controlled acceptance stages exactly, preserving the frozen tests and objective. Use foreground commands; no background work. Publication is authorized only to the dedicated task draft PR using superagent_publish. Return waiting after the first intentionally failing publication; return ready only as specified for independent verification. Repair independent rejection on the same task and PR.'}]},sourcePlugins:[{directory:pkg.directory,digest:pkg.digest,replaceBuiltin:true}],sources:[{id:'github-live',kind:'github',repository,cwd,sandbox:'workspace-write',workspace:{mode:'git-worktree'},observed:true,pollSeconds:2,allowedActors:['pythc'],allowedBots:['github-ci'],github:{tokenEnv:'AGENTHUB_GITHUB_TOKEN',receiveAll:false,command:'/agent'},options:{repositories:[repository]}}]})
 save('config-'+phase+'.json',config)
 if(nativeBackend){config.backends.external={kind:'codex',command:codex,args:['-c','project_doc_max_bytes=0'],env:{CODEX_HOME:'AGENTHUB_GITHUB_CODEX_HOME'}};config.backendPlugins=[];save('config-'+phase+'.json',config)}
 const h=await Runtime.create(config);let successStatus:any=phase==='0'?undefined:JSON.parse(readFileSync(join(root,'phase-'+(Number(phase)-1)+'.json'),'utf8')).successStatus
 const snapshot=()=>{const runs=h.store.list<any>('run'),run=runs[0];return {phase:Number(phase),pid:process.pid,at:Date.now(),implementation,goals:h.store.list('router-goal'),rounds:h.store.list('goal-verification'),repairs:h.store.list('goal-repair'),releases:h.store.list('goal-release'),tickets:h.store.tickets.list(),runs,sessions:h.store.list('model-session'),backendThreads:h.store.list('backend-plugin-thread'),backendEffects:h.store.list('backend-plugin-tool'),calls:h.activity.list(),errors:h.store.list('router-error'),deliveries:h.store.deliveries(),triggers:h.store.list('trigger'),assessments:h.store.list('router-admission'),plugins:h.store.list('plugin-installation'),published:h.store.list('pr-delivery'),jobs:h.store.db.prepare('SELECT id,kind,state,error FROM jobs').all(),successStatus,testsSha:run&&existsSync(join(run.cwd,'tests.mjs'))?digest(readFileSync(join(run.cwd,'tests.mjs'))):null}}
 try{
  const probe=await (h.sources.get('github-live') as any).probe();save('probe-'+phase+'.json',probe)
  if(phase==='0'){
   h.scopes.command({action:'scope.put',operationId:'scope',expectedRevision:0,scope:{id:'repo',tenantId:'acceptance',name:'GitHub validation',contextBytes:768000,managers:[JSON.stringify(['github-live','pythc'])],workerIds:['one'],sourceIds:['github-live'],backendIds:['external']}})
   const identity:any=await h.scopeCommand({action:'source.verify',operationId:'verify',expectedRevision:0,sourceId:'github-live'})
   h.scopes.command({action:'entry.bind',operationId:'entry',expectedRevision:0,scopeId:'repo',sourceId:'github-live',accountNamespace:identity.namespace,nativeId:repository,history:'group'})
   h.store.put('source-cursor','github-live',{since:plan.since})
  }
  if(Number(phase)>=2){await h.pollSources();save('phase-'+phase+'.json',{...snapshot(),probe});console.log(JSON.stringify({phase,version:pkg.manifest.version,probe}));}
  else{
   let finished=false,cleanupClosed=false,last=0;const deadline=Date.now()+25*60000
   while(Date.now()<deadline){
    await h.tick();await new Promise(r=>setTimeout(r,150))
    const s=snapshot(),goal=s.goals[0] as any,task=s.tickets[0],run=s.runs[0],published=s.published.at(-1) as any
    if(phase==='0'&&published?.url&&task?.assignments.at(-1)?.report?.state==='waiting'&&run?.phase==='idle'&&!h.activity.list().some(c=>c.state==='running')){finished=true;break}
    if(phase==='1'&&published?.sha&&published.sha!==successStatus?.sha&&run?.phase==='idle'&&existsSync(join(run.cwd,'acceptance.json'))){
     if(digest(readFileSync(join(run.cwd,'tests.mjs')))!==plan.testsSha)throw Error('Frozen tests changed')
     try{const output=execFileSync(process.execPath,['tests.mjs'],{cwd:run.cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']});writeFileSync(join(root,'ci-final.log'),output,{mode:0o600});const status=api('repos/'+repository+'/statuses/'+published.sha,'POST',{state:'success',context:'agenthub-validation/frozen-tests',description:'Actual frozen normal and empty CSV tests passed'});successStatus={id:status.id,sha:published.sha}}catch(e){console.log('CI execution or status confirmation pending: '+String(e).slice(0,200))}
    }
    if(phase==='1'&&s.rounds.some((r:any)=>!r.nodeId&&r.state==='passed')&&s.releases.length&&published?.sha===successStatus?.sha&&!h.activity.list().some(c=>c.state==='running')&&!h.store.deliveries().some(d=>['pending','sending','uncertain','held'].includes(d.status))&&!h.store.db.prepare("SELECT 1 FROM jobs WHERE state IN ('pending','running') LIMIT 1").get()){
     // Existing owned-PR semantics keep the task open until the native PR is
     // closed. Cleanup is performed only after independent overall acceptance.
     if(!cleanupClosed){api('repos/'+repository+'/pulls/'+published.number,'PATCH',{state:'closed'});api('repos/'+repository+'/issues/'+plan.issue,'PATCH',{state:'closed'});cleanupClosed=true}
     await h.pollSources();if(goal?.state==='completed'&&!h.store.tickets.open().length){finished=true;break}
    }
    if(goal?.state==='held')throw Error('Goal held: '+goal.reason)
    if(Date.now()-last>10000){last=Date.now();save('progress.json',s);console.log(JSON.stringify({phase,goal:goal?.state,nodes:goal?.nodes?.map((n:any)=>({state:n.state,repairs:n.repairs})),runs:s.runs.map(r=>({phase:r.phase,error:r.error})),rounds:s.rounds.map((r:any)=>({state:r.state,node:r.nodeId})),published:published?.url,jobs:s.jobs.filter((j:any)=>j.state!=='done').map((j:any)=>({kind:j.kind,state:j.state,error:j.error}))}))}
   }
   if(!finished)throw Error('Live acceptance timed out')
   save('phase-'+phase+'.json',{...snapshot(),probe});console.log('Saved real checkpoint '+phase)
  }
 }catch(error){save('failure-'+phase+'.json',{...snapshot(),error:String(error)});throw error}finally{await h.close()}
}
