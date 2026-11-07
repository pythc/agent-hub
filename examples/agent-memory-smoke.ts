import {mkdirSync,writeFileSync,readFileSync,existsSync} from 'node:fs'
import {join} from 'node:path'
import {spawn} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {Runtime} from '../src/runtime.ts'
import {configSchema} from '../src/config.ts'
const root=process.env.MEMORY_ACCEPTANCE_DIR??'/tmp/agenthub-memory-'+Date.now(),phase=process.env.MEMORY_ACCEPTANCE_PHASE
const report=(name:string,value:any)=>writeFileSync(join(root,name+'.json'),JSON.stringify(value,null,2))
if(!phase){
 if(existsSync(join(root,'state')))throw Error('Fresh directory required');mkdirSync(root,{recursive:true})
 for(const p of ['queue','crash','extract','update','verify'])await new Promise<void>((resolve,reject)=>{
 const child=spawn(process.execPath,['--import','tsx',fileURLToPath(import.meta.url)],{env:{...process.env,MEMORY_ACCEPTANCE_PHASE:p,MEMORY_ACCEPTANCE_DIR:root},stdio:'inherit',detached:p==='crash'})
 let killed=false
 const timer=p==='crash'?setInterval(()=>{if(!existsSync(join(root,'inflight.json')))return;clearInterval(timer!);killed=true;process.kill(-child.pid!,'SIGKILL')},30):undefined
 const deadline=setTimeout(()=>{if(timer)clearInterval(timer);child.kill('SIGTERM');reject(Error('Phase deadline '+p))},300000)
 child.on('error',reject);child.on('exit',(code,signal)=>{clearTimeout(deadline);if(timer)clearInterval(timer);if(code===0||p==='crash'&&killed&&signal==='SIGKILL')resolve();else reject(Error(p+' exited '+code+' '+signal))})
 })
 report('evidence',{ok:true,phases:['queue','crash','extract','update','verify'],checks:['real native extraction','pending restart','actual in-flight process-group kill and lease recovery','confirmation','active old fact during pending update','second native extraction','new process recalls latest confirmed preference','clear and restart fence'],at:new Date().toISOString()});console.log('MEMORY_NATIVE_PASS');
}else{
 const config=configSchema.parse({stateDir:join(root,'state'),port:0,codex:process.env.AGENTHUB_CODEX??'codex',acceptMode:'auto',work:{sandboxDriver:'disabled'},execution:{router:{mode:'host',model:'gpt-6.1-terra',effort:'medium'},management:{enabled:true},workers:[{id:'one',backend:'codex'}]},sources:[{id:'local',kind:'local',cwd:root,workspace:{mode:'source'},allowedActors:['operator']}]})
 let h=new Runtime(config)
 const context=(id:string)=>{const t=h.store.triggers.get(id)!;return h.scopes.context(t,'local:'+t.threads[0]!.id)!}
 const send=(id:string,text:string)=>context((h.receive('local','operator',{id,scope:'test',thread:id,addressed:true,text}) as any).triggerId)
 const check=(value:any,message:string)=>{if(!value)throw Error(message)}
 try{
 if(phase==='queue'){
 h.scopes.command({action:'scope.put',operationId:'scope',expectedRevision:0,scope:{id:'team',tenantId:'acceptance',name:'Isolated memory acceptance',managers:[JSON.stringify(['local','operator'])],workerIds:['one'],sourceIds:['local'],backendIds:['codex']}})
 h.scopes.command({action:'entry.bind',operationId:'entry',expectedRevision:0,scopeId:'team',sourceId:'local',accountNamespace:'local',nativeId:'test',history:'group'})
 const setup=send('setup','准备本地记忆测试')
 h.agentMemory.manage(setup,{action:'configure',expectedRevision:0,policy:{writeMode:'auto',delayMs:0,minIntervalMs:0,extractModel:'gpt-6.1-terra'}})
 const c=send('session-one','我的长期工作偏好是技术报告先给结论，再给证据，最后列未验证项。这个偏好适用于以后所有技术报告。')
 check(h.agentMemory.observations().length===1,'ingress not queued');report('anchor',{id:c.trigger.id});
 }else if(phase==='crash'){
 const run=h.model.run.bind(h.model)
 h.model.run=r=>run({...r,onTurn:id=>{r.onTurn?.(id);report('inflight',{pid:process.pid,turnId:id,observations:h.agentMemory.observations()})}})
 h.agentMemory.tick();await h.agentMemory.drain();throw Error('Expected parent to terminate the in-flight process group')
 }else if(phase==='extract'){
 const c=context(JSON.parse(readFileSync(join(root,'anchor.json'),'utf8')).id);check(h.agentMemory.observations()[0]?.state==='pending','running lease not recovered');h.agentMemory.tick();await h.agentMemory.drain()
 const rows=h.memory.query(c,{candidates:true}).items;report('extract-result',{observations:h.agentMemory.observations(),items:rows,calls:h.activity.list()});check(rows.some(f=>f.kind==='preference'),'native extraction returned no preference');check(rows.every(f=>f.state==='candidate'),'automatic activation');
 for(const f of rows)h.memory.command(c,{action:'confirm',operationId:'confirm-'+f.id,id:f.id,expectedRevision:f.revision},true)
 report('confirmed',{ids:rows.map(f=>f.id)});
 }else if(phase==='update'){
 const c=send('session-two','我之前的技术报告偏好现在有明确修正：以后技术报告先列未验证项，再给结论，最后给证据。请将以前“先给结论”的同一偏好替换为这个顺序，不要同时保留两个相冲突的版本。')
 const before=h.memory.query(c,{}).items;h.agentMemory.tick();await h.agentMemory.drain()
 const rows=h.memory.query(c,{candidates:true}).items,update=rows.find(f=>f.state==='candidate'&&f.replaces?.length)
 report('update-result',{observations:h.agentMemory.observations(),items:rows,calls:h.activity.list()});check(update,'native model did not propose a sourced update');check(before.every(f=>h.memory.fact(f.id)?.state==='active'),'pending update erased original');
 h.memory.command(c,{action:'confirm',operationId:'confirm-update',id:update!.id,expectedRevision:update!.revision},true);report('updated',{id:update!.id,triggerId:c.trigger.id,content:update!.content});
 }else{
 const prior=JSON.parse(readFileSync(join(root,'updated.json'),'utf8')),c=send('session-three','请按我的长期技术报告偏好说明本次验证结果。')
 const packet=h.memory.build(c,{},'native-verification'),payload=JSON.parse(packet.input);check(payload.memory.facts.some((f:any)=>f.content===prior.content),'restarted context missing update');check(!payload.memory.facts.some((f:any)=>JSON.parse(readFileSync(join(root,'confirmed.json'),'utf8')).ids.includes(f.id)),'superseded old facts recalled');
 const result=await h.model.run({cwd:root,role:'router',managed:true,ephemeral:true,tools:[],model:'gpt-6.1-terra',sandbox:'read-only',instructions:'Use the supplied sourced memory as background. Return exactly JSON with order (array of three labels). What section order does the user now prefer for technical reports? Do not execute tools.',input:packet.input,schema:{type:'object',properties:{order:{type:'array',items:{type:'string'}}},required:['order'],additionalProperties:false}})
 const order=JSON.parse(result.text).order;report('model-recall',{order,manifest:packet.manifest});check(order?.length===3&&/未验证/.test(order[0])&&/结论/.test(order[1])&&/证据/.test(order[2]),'real model did not apply latest preference');
 h.memory.command(c,{action:'clear',operationId:'clear-native',expectedRevision:h.memory.generation(c.route.scopeId)},true);await h.close();h=new Runtime(config);check(h.memory.query(context(c.trigger.id),{candidates:true}).items.length===0,'clear revived after process reconstruction');
 }
 report('phase-'+phase,{ok:true,pid:process.pid,at:new Date().toISOString()});console.log('PASS '+phase)
 }catch(error){report('failure-'+phase,{error:String(error),observations:h.agentMemory.observations(),calls:h.activity.list()});throw error}finally{await h.close()}
}
