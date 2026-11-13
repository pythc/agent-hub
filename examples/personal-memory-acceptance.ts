/** Real provider checks. Uses isolated local fixtures; does not contact chat recipients. */
import {mkdirSync,writeFileSync,readFileSync,mkdtempSync} from 'node:fs'
import {join,resolve} from 'node:path'
import {tmpdir} from 'node:os'
import {execFileSync} from 'node:child_process'
import {Runtime} from '../src/runtime.ts'
import {configSchema} from '../src/config.ts'
import {builtins} from '../src/prompts.ts'
import type {RouterGoal} from '../src/router-goals.ts'

const root=process.argv[2]?resolve(process.argv[2]):mkdtempSync(join(tmpdir(),'roppo-personal-memory-'))
mkdirSync(root,{recursive:true})
const model=process.env.ROPPO_EVAL_MODEL??'gpt-6.1-terra'
const check=(ok:unknown,message:string)=>{if(!ok)throw Error(message);console.log('PASS '+message)}
function fixture(name:string){
 const directory=join(root,name),cwd=join(directory,'workspace');mkdirSync(cwd,{recursive:true})
 const config=configSchema.parse({stateDir:join(directory,'state'),port:0,acceptMode:'auto',model,effort:'medium',turnTimeoutMs:240000,
  work:{sandboxDriver:process.platform==='darwin'?'seatbelt':'bubblewrap',network:false},
  execution:{router:{mode:'host',model,effort:'medium'},management:{enabled:true,maxWorkers:2},workers:['one','two'].map(id=>({id,backend:'codex',model,effort:'medium'}))},
  sources:[{id:'local',kind:'local',cwd,sandbox:'workspace-write',workspace:{mode:'source'},allowedActors:['operator']}]})
 let host=new Runtime(config)
 host.scopes.command({action:'scope.put',operationId:'scope',expectedRevision:0,scope:{id:'test',tenantId:'test',name:'Personal memory acceptance',managers:[JSON.stringify(['local','operator'])],workerIds:['one','two'],sourceIds:['local'],backendIds:['codex']}})
 host.scopes.command({action:'entry.bind',operationId:'entry',expectedRevision:0,scopeId:'test',sourceId:'local',accountNamespace:'local',nativeId:'test',history:'group'})
 const send=(id:string,text:string)=>{const result=host.receive('local','operator',{id,scope:'test',thread:id,addressed:true,text}) as {triggerId:string};const trigger=host.store.triggers.get(result.triggerId)!;return host.scopes.context(trigger,'local:'+id)!}
 host.store.put('memory-policy','test',{revision:1,value:{writeMode:'adaptive',delayMs:0,minIntervalMs:0,extractModel:model}})
 return {get host(){return host},cwd,send,restart:async()=>{await host.close();host=new Runtime(config)}}
}

const learning=fixture('learning')
try{
 const first=learning.send('first','以后技术报告按这个顺序：先给结论，再给验证证据，最后列未验证项。这是我的长期偏好。')
 check(JSON.parse(learning.host.memory.build(first,{},'test').input).memory.learning.coldStart,'cold start reported without a questionnaire')
 learning.host.agentMemory.tick();await learning.host.agentMemory.drain()
 const initial=learning.host.agentMemory.applicable(first).filter(f=>f.kind==='preference')
 check(initial.length>0&&initial.every(f=>f.state==='active'&&!f.learning?.inferred),'stated preferences activate without confirmation')
 const temporary=learning.send('temporary','只在这次讨论里，技术报告先列验证证据，再给结论和未验证项；以后仍按长期偏好。')
 learning.host.agentMemory.tick();await learning.host.agentMemory.drain()
 check(learning.host.agentMemory.applicable(temporary).some(f=>f.learning?.discussion===temporary.route.discussion),'temporary exception is discussion scoped')
 const correction=learning.send('correction','修改我的长期技术报告偏好：以后先列未验证项，再给结论，最后给验证证据，替换之前的顺序。')
 learning.host.agentMemory.tick();await learning.host.agentMemory.drain()
 check(learning.host.agentMemory.applicable(correction).every(f=>!f.learning?.discussion),'temporary exception does not leak to another session')
 check(initial.some(f=>learning.host.memory.fact(f.id)?.state==='superseded'),'explicit correction supersedes prior preference')
 await learning.restart()
 const last=learning.send('delivery','请按我的习惯汇报这次修复。')
 const packet=learning.host.memory.build(last,{request:last.trigger.text,evidence:{conclusion:'摘要截断已修复',verified:'Unicode 回归测试通过',unverified:'尚未部署'}},'acceptance')
 const response=await learning.host.model.run({cwd:learning.cwd,role:'router',managed:true,ephemeral:true,archiveOnComplete:true,sandbox:'read-only',tools:[],model,
  instructions:builtins['runtime/personalization']+' Return JSON with sections, an array of {title,body}, containing the actual delivery report. Use the supplied evidence.',input:packet.input,
  schema:{type:'object',properties:{sections:{type:'array',items:{type:'object',properties:{title:{type:'string'},body:{type:'string'}},required:['title','body'],additionalProperties:false}}},required:['sections'],additionalProperties:false}})
 const sections=JSON.parse(response.text).sections
 check(sections.length===3&&/未验证/.test(sections[0].title)&&/结论/.test(sections[1].title)&&/证据|验证/.test(sections[2].title),'real model follows corrected report order after restart')
 writeFileSync(join(root,'learning.json'),JSON.stringify({ok:true,model,sections,items:learning.host.agentMemory.authorized(last,true),observations:learning.host.agentMemory.observations(),usage:learning.host.usage.summary()},null,2))
}finally{await learning.host.close()}

const flow=fixture('bug-flow')
try{
 mkdirSync(join(flow.cwd,'tests'),{recursive:true})
 writeFileSync(join(flow.cwd,'brief.mjs'),'export function brief(text, limit) { return text.slice(0, limit) }\n')
 writeFileSync(join(flow.cwd,'tests/reader-brief.test.mjs'),"import {test} from 'node:test'; import assert from 'node:assert/strict'; import {brief} from '../brief.mjs'; test('Unicode code points',()=>{assert.equal(brief('A😀B',2),'A😀');assert.equal(brief('A😀B',3),'A😀B');assert.equal(brief('中文',1),'中');assert.equal(brief('abc',0),'')});\n")
 writeFileSync(join(flow.cwd,'README.md'),'Local acceptance fixture. Run node --test tests/reader-brief.test.mjs. Keep the fix small and report the actual verification.\n')
 execFileSync('git',['init','-b','main'],{cwd:flow.cwd,stdio:'pipe'})
 execFileSync('git',['add','.'],{cwd:flow.cwd,stdio:'pipe'})
 execFileSync('git',['-c','user.name=Roppo Acceptance','-c','user.email=acceptance@example.invalid','-c','commit.gpgsign=false','-c','core.hooksPath=/dev/null','commit','-m','Reproduce Unicode truncation bug'],{cwd:flow.cwd,stdio:'pipe'})
 let failed=false;try{execFileSync(process.execPath,['--test','tests/reader-brief.test.mjs'],{cwd:flow.cwd,stdio:'pipe'})}catch{failed=true}
 check(failed,'bug reproduces before the agent runs')
 flow.send('bug','摘要遇到 emoji 会截坏，A😀B 限两个字符时应该保留 A😀。帮我修好并验证。以后这种交付我习惯先看结论再看验证证据，普通实现和测试你自己决定就好。')
 const started=Date.now();let lastLog=0
 while(Date.now()-started<10*60000){
  await flow.host.tick()
  const goals=flow.host.store.list<RouterGoal>('router-goal')
  if(goals.some(g=>['held','needs_input','cancelled'].includes(g.state)))throw Error('Bug flow stopped: '+JSON.stringify(goals.map(g=>({state:g.state,reason:g.reason}))))
  const busy=flow.host.activeExecutions>0||flow.host.activity.list().some(a=>a.state==='running')||!!flow.host.store.db.prepare("SELECT 1 FROM jobs WHERE state IN ('pending','running') LIMIT 1").get()
  if(goals.some(g=>g.state==='completed')&&!busy&&!flow.host.agentMemory.observations().some(o=>['pending','running'].includes(o.state)))break
  if(Date.now()-lastLog>10000){lastLog=Date.now();console.log(JSON.stringify({seconds:Math.round((lastLog-started)/1000),goals:goals.map(g=>({state:g.state,tasks:g.taskIds.length})),memory:flow.host.agentMemory.observations().map(o=>({kind:o.kind,state:o.state,error:o.error}))}))}
  await new Promise(r=>setTimeout(r,100))
 }
 const goals=flow.host.store.list<RouterGoal>('router-goal'),methods=flow.host.store.list<any>('memory-fact').filter(f=>f.origin==='experience'&&f.state==='active')
 check(goals.length===1&&goals[0]!.state==='completed','unsplit bug request reaches independent final acceptance')
 check(goals[0]!.taskIds.length===1,'one Worker owns the cohesive bug task')
 const tests=execFileSync(process.execPath,['--test','tests/reader-brief.test.mjs'],{cwd:flow.cwd,encoding:'utf8'})
 check(methods.length>0,'accepted execution produces reusable working experience')
 writeFileSync(join(root,'bug-flow.json'),JSON.stringify({ok:true,model,goals,methods,tests,code:readFileSync(join(flow.cwd,'brief.mjs'),'utf8'),observations:flow.host.agentMemory.observations(),usage:flow.host.usage.summary()},null,2))
}catch(error){writeFileSync(join(root,'bug-flow-failure.json'),JSON.stringify({error:String(error),goals:flow.host.store.list('router-goal'),observations:flow.host.agentMemory.observations(),errors:flow.host.store.list('router-error'),activity:flow.host.activity.list()},null,2));throw error}
finally{await flow.host.close()}
console.log('PERSONAL_MEMORY_ACCEPTANCE_PASS '+root)
