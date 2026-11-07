import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterEach,expect,it} from 'vitest'
import {Runtime} from '../src/runtime.ts'
import {configSchema} from '../src/config.ts'
import {MessageSource} from '../src/sources.ts'
import {GithubSource} from '../src/connectors/github.ts'
import type {ModelRequest} from '../src/model.ts'
import type {OutboundMessage} from '../src/vendor/dsh-core/index.ts'

const roots:string[]=[],hosts:Runtime[]=[]
afterEach(async()=>{for(const h of hosts.splice(0))await h.close();for(const p of roots.splice(0))rmSync(p,{recursive:true,force:true})})
const report=(state='ready',reply='Finished',question:string|null=null,askedBy:string|null=null)=>({state,summary:state,reply,question,askedBy,handbacks:[]})
function deferred(){let resolve!:()=>void;const promise=new Promise<void>(r=>{resolve=r});return {promise,resolve}}
async function until(promise:Promise<void>,r:ModelRequest){
  let stop!:()=>void
  try{await Promise.race([promise,new Promise<never>((_resolve,reject)=>{stop=()=>reject(Error('Stopped'));r.signal?.addEventListener('abort',stop,{once:true});if(r.signal?.aborted)stop()})])}
  finally{r.signal?.removeEventListener('abort',stop)}
}
class Source extends MessageSource {
  sent:OutboundMessage[]=[]
  async deliver(message:OutboundMessage){this.sent.push(message)}
}
function host(worker:(r:ModelRequest,data:any)=>Promise<any>,github?:boolean){
  const root=mkdtempSync(join(tmpdir(),'agenthub-parity-'));roots.push(root)
  const config=configSchema.parse({stateDir:join(root,'state'),port:0,work:{sandboxDriver:'disabled'},sources:[{id:'local',kind:github===undefined?'local':'github',allowedActors:['alice'],cwd:root,...(github===undefined?{}:{repository:'test/repo',sandbox:'workspace-write',workspace:{mode:'directory'}})}]})
  const source=new Source(config.sources[0]!),requests:ModelRequest[]=[]
  if(github!==undefined){
    const githubSource=new GithubSource(config.sources[0]!,{async request(){return {number:7,state:'open',...(github?{pull_request:{}}:{})}}})
    Object.assign(source,{isPullRequest:githubSource.isPullRequest.bind(githubSource)})
  }
  const runtime=new Runtime(config,{sources:[source],model:{async run(r){
    requests.push(r);const turnId='turn-'+requests.length,threadId=r.threadId??'thread-'+requests.length
    r.onThread?.(threadId);r.onTurn?.(turnId)
    const data=JSON.parse(r.input)
    const decision={action:data.trigger?'ignore':data.triggers?.[0]?.text.startsWith('Attach ')?'attach':'accept',title:'Document comparison',scope:'Read and compare documents',reason:'Requested',rules:[],ruleAssessments:[],targetTicketId:data.triggers?.[0]?.text.startsWith('Attach ')?data.existing[0].id:null}
    return {threadId,turnId,text:JSON.stringify(r.ephemeral?decision:await worker(r,data))}
  }}});hosts.push(runtime)
  return {runtime,source,requests,config}
}
async function settle(h:Runtime,predicate:()=>boolean){
  for(let n=0;n<300;n++){await h.tick();await new Promise(r=>setTimeout(r,2));if(predicate())return}
  throw Error('Host did not settle: '+JSON.stringify(h.status().tickets))
}
const receive=(h:Runtime,id:string,thread='origin',text='Compare the documents')=>h.receive('local','alice',{id,thread,text,addressed:true})

it.each(['blocked','failed'])('delivers an honest %s explanation once, including after restart',async state=>{
  const {runtime:h,source,config}=host(async()=>report(state,'Cannot finish: the document is unreadable.'))
  receive(h,'request')
  await settle(h,()=>source.sent.some(m=>m.kind==='reply'))
  expect(source.sent.filter(m=>m.kind==='reply').map(m=>m.text)).toEqual(['Cannot finish: the document is unreadable.'])
  expect(h.status().tickets[0]!.assignments.at(-1)!.report!.state).toBe(state)
  expect(h.status().tickets[0]!.ended).toBeUndefined()
  await h.flush();expect(source.sent).toHaveLength(2)
  hosts.splice(hosts.indexOf(h),1);await h.close()
  const restored=new Runtime(config,{sources:[source],model:{async run(){throw Error('Must not wake on restart')}}});hosts.push(restored)
  await restored.tick();expect(source.sent).toHaveLength(2)
})

it('sends the structured recovery question when execution throws',async()=>{
  const {runtime:h,source}=host(async()=>{throw Error('Execution failed')})
  receive(h,'request');await settle(h,()=>source.sent.some(m=>m.kind==='reply'))
  const ticket=h.status().tickets[0]!
  expect(ticket.run!.phase).toBe('uncertain')
  expect(source.sent.filter(m=>m.kind==='reply').map(m=>m.text)).toEqual([ticket.attention!.question])
  await h.flush();expect(source.sent).toHaveLength(2)
})

it('retains an already-sent recovery question and its asker across host restarts',async()=>{
  let turns=0
  const {runtime:h,source,config}=host(async()=>{if(++turns===1)return report('waiting','');throw Error('Execution failed')})
  receive(h,'first');await settle(h,()=>h.status().tickets[0]?.run?.phase==='idle')
  receive(h,'followup','second-conversation','Attach '+h.status().tickets[0]!.id+' and compare')
  await settle(h,()=>source.sent.some(m=>m.kind==='reply'))
  const before=h.status().tickets[0]!,attention=before.attention
  expect(attention!.triggerId).toBe('local:followup')
  hosts.splice(hosts.indexOf(h),1);await h.close()
  const restored=new Runtime(config,{sources:[source],model:{async run(){throw Error('Must wait for reconciliation')}}});hosts.push(restored)
  await restored.tick()
  expect(restored.store.tickets.get(before.id)!.attention).toEqual(attention)
  expect(source.sent.filter(m=>m.kind==='reply').map(m=>m.channel.thread)).toEqual(['second-conversation'])
})

it('delivers a failure explanation even while an unread follow-up is queued',async()=>{
  const finish=deferred();let turns=0
  const {runtime:h,source}=host(async r=>{
    if(++turns===1){await until(finish.promise,r);return report('failed','Document A cannot be read.')}
    return report('ready','Document B was compared.')
  })
  receive(h,'first');await settle(h,()=>turns===1)
  receive(h,'correction','origin','Use B');finish.resolve()
  await settle(h,()=>source.sent.some(m=>m.text==='Document B was compared.'))
  expect(source.sent.filter(m=>m.kind==='reply').map(m=>m.text)).toEqual(['Document A cannot be read.','Document B was compared.'])
})

it.each([false,true])('notifies on restart only when human reconciliation is required (autoRecover=%s)',async autoRecover=>{
  const {runtime:h,source,config}=host(async()=>report('waiting',''))
  receive(h,'first');await settle(h,()=>h.status().tickets[0]?.run?.phase==='idle')
  const before=h.status().tickets[0]!,run=before.run!
  h.store.put('run',before.id,{...run,phase:'running'})
  h.settings.save(h.settings.current().revision,{work:{...config.work,autoRecover}})
  hosts.splice(hosts.indexOf(h),1);await h.close()
  const restored=new Runtime(config,{sources:[source],model:{async run(r){
    expect(r.threadId).toBe(run.threadId);expect(r.input).toContain('Host restarted')
    r.onThread?.(run.threadId!);r.onTurn?.('recovered')
    return {threadId:run.threadId!,turnId:'recovered',text:JSON.stringify(report())}
  }}});hosts.push(restored)
  if(autoRecover){
    expect(restored.store.tickets.get(before.id)!.attention).toBeUndefined()
    await settle(restored,()=>source.sent.some(m=>m.text==='Finished'))
    expect(source.sent.filter(m=>m.kind==='reply').map(m=>m.text)).toEqual(['Finished'])
  }else{
    await restored.flush()
    expect(source.sent.filter(m=>m.kind==='reply').map(m=>m.text)).toEqual([restored.store.tickets.get(before.id)!.attention!.question])
    expect(restored.status().active).toBe(0)
  }
})

it.each(['waiting','dropped'])('keeps ordinary %s reports quiet',async state=>{
  const {runtime:h,source}=host(async()=>report(state,'Internal update'))
  receive(h,'request');await settle(h,()=>h.status().tickets[0]?.run?.phase==='idle')
  expect(source.sent.filter(m=>m.kind==='reply')).toEqual([])
})

it('routes the same question to the explicit new asker, replacing a previous attention',async()=>{
  let count=0
  const {runtime:h,source}=host(async()=>report('blocked','','Which version?',++count===1?'local:first':'local:followup'))
  receive(h,'first');await settle(h,()=>source.sent.some(m=>m.kind==='reply'))
  receive(h,'followup','second-conversation','Attach '+h.status().tickets[0]!.id+' and compare this version')
  await settle(h,()=>source.sent.filter(m=>m.kind==='reply').length===2)
  expect(source.sent.filter(m=>m.kind==='reply').map(m=>m.channel.thread)).toEqual(['origin','second-conversation'])
  expect(h.status().tickets[0]!.attention!.triggerId).toBe('local:followup')
})

it('uses the specified asker rather than the last of several pending human inputs',async()=>{
  let count=0
  const {runtime:h,source}=host(async()=>++count===1?report('waiting',''):report('blocked','','Which version?','local:question'))
  receive(h,'first');await settle(h,()=>h.status().tickets[0]?.run?.phase==='idle')
  const id=h.status().tickets[0]!.id
  h.pause(true)
  receive(h,'question','question-thread');h.engine.attach(id,'local:question')
  receive(h,'later','other-thread');h.engine.attach(id,'local:later')
  h.pause(false);await settle(h,()=>source.sent.some(m=>m.kind==='reply'))
  expect(source.sent.find(m=>m.kind==='reply')!.channel.thread).toBe('question-thread')
})

it('injects follow-ups into the same active turn and consumes them only after the history receipt',async()=>{
  const finish=deferred(),offered:{text:string;read?:()=>void}[]=[];let request:ModelRequest|undefined,turns=0
  const {runtime:h,source}=host(async r=>{
    turns++;request=r;r.onActive?.({interrupt:async()=>{},steer:async(text,read)=>{offered.push({text,read})}})
    await until(finish.promise,r);return report('ready','Compared B')
  })
  receive(h,'first');await settle(h,()=>!!request)
  receive(h,'correction','origin','Correction: compare B instead of A')
  await request!.onTool!('superagent_progress',{summary:'Next step'},'step')
  expect(offered).toHaveLength(1)
  expect(JSON.parse(offered[0]!.text).inputs[0].event.text).toContain('compare B')
  let ticket=h.status().tickets[0]!
  const input=ticket.inputs.find(i=>i.kind==='trigger'&&i.triggerId==='local:correction')!
  expect(ticket.undelivered).toContain(input.id)
  await h.deliverLiveInputs(ticket.id);expect(offered).toHaveLength(1)
  offered[0]!.read!();offered[0]!.read!()
  ticket=h.status().tickets[0]!
  expect(ticket.undelivered).not.toContain(input.id)
  expect(ticket.inputs.find(i=>i.id===input.id)).toHaveProperty('readAt',expect.any(String))
  finish.resolve();await settle(h,()=>source.sent.some(m=>m.text==='Compared B'))
  expect(turns).toBe(1);expect(h.status().tickets[0]!.ended!.outcome).toBe('completed')
})

it('retains an offered but unread correction when the old turn finishes',async()=>{
  const finish=deferred();let receipt:(()=>void)|undefined,turns=0
  const seen:any[]=[]
  const {runtime:h,source}=host(async(r,data)=>{
    seen.push(data);turns++
    if(turns===1){r.onActive?.({interrupt:async()=>{},steer:async(_text,read)=>{receipt=read}});await until(finish.promise,r);return report('ready','Stale result')}
    receipt?.();return report('ready','Corrected result')
  })
  receive(h,'first');await settle(h,()=>turns===1)
  receive(h,'correction','origin','Use B');await settle(h,()=>!!receipt)
  finish.resolve();await settle(h,()=>source.sent.some(m=>m.text==='Corrected result'))
  expect(turns).toBe(2);expect(seen[1].inputs.some((i:any)=>i.event?.id==='local:correction')).toBe(true)
  expect(source.sent.some(m=>m.text==='Stale result')).toBe(false)
})

it('does not inject while paused or consume a late receipt after a human stop',async()=>{
  let active=false,receipt:(()=>void)|undefined
  const {runtime:h}=host(async r=>{
    r.onActive?.({interrupt:async()=>{},steer:async(_text,read)=>{receipt=read}});active=true
    await new Promise((_resolve,reject)=>r.signal!.addEventListener('abort',()=>reject(Error('Stopped')),{once:true}))
    return report()
  })
  receive(h,'first');await settle(h,()=>active)
  h.pause(true);receive(h,'correction','origin','Use B');await h.tick()
  await h.deliverLiveInputs(h.status().tickets[0]!.id);expect(receipt).toBeUndefined()
  h.pause(false);await settle(h,()=>!!receipt)
  const id=h.status().tickets[0]!.id
  await h.stop(id);receipt!()
  const ticket=h.status().tickets[0]!
  expect(ticket.ended!.by).toBe('human')
  expect(ticket.inputs.find(i=>i.kind==='trigger'&&i.triggerId==='local:correction')).not.toHaveProperty('readAt',expect.any(String))
})

it('isolates uncertain replies by ticket and does not resend the uncertain message',async()=>{
  const {runtime:h,source}=host(async()=>report())
  const channel={source:'local',thread:'shared',address:{thread:'shared'}}
  h.store.outbox.send({id:'uncertain',ticketId:'a',channel,kind:'reply',text:'A'})
  h.store.deliveryFailed('uncertain',1,'Unknown outcome',true)
  for(const [id,ticketId] of [['same','a'],['other','b']] as const)h.store.outbox.send({id,ticketId,channel,kind:'reply',text:id})
  await h.flush();await h.flush()
  expect(source.sent.map(m=>m.id)).toEqual(['other'])
  expect(h.store.deliveries().find(m=>m.id==='uncertain')!.status).toBe('uncertain')
})

it('preserves ack ordering until three confirmed failures, without blocking other tickets',async()=>{
  const {runtime:h,source}=host(async()=>report())
  const channel={source:'local',thread:'shared',address:{thread:'shared'}}
  h.store.outbox.send({id:'ack',ticketId:'a',channel,kind:'acknowledgement',text:'A'})
  h.store.deliveryFailed('ack',2,'Not sent')
  h.store.outbox.send({id:'answer',ticketId:'a',channel,kind:'reply',text:'Answer'})
  h.store.outbox.send({id:'other',ticketId:'b',channel,kind:'reply',text:'Other'})
  await h.flush();expect(source.sent.map(m=>m.id)).toEqual(['other'])
  const deliver=source.deliver.bind(source)
  source.deliver=async m=>{if(m.id==='ack')throw Error('Not sent');await deliver(m)}
  h.store.db.prepare("UPDATE outbox SET next_at=0 WHERE id='ack'").run()
  await h.flush();expect(source.sent.map(m=>m.id)).toEqual(['other','answer'])
})

it.each([false,true])('binds only confirmed PRs, keeping ordinary Issue completion and resumption (PR=%s)',async isPR=>{
  const {runtime:h,source,requests}=host(async()=>report(),isPR)
  receive(h,'first','test/repo#7');await settle(h,()=>source.sent.some(m=>m.kind==='reply'))
  const first=h.status().tickets[0]!
  if(isPR){expect(first.ended).toBeUndefined();expect(first.stage).toEqual({stage:'person',action:'review'});expect(first.follows).toHaveLength(1)}
  else{
    expect(first.ended!.outcome).toBe('completed');expect(first.follows).toBeUndefined()
    receive(h,'followup','test/repo#7','Explain the conclusion')
    await settle(h,()=>source.sent.filter(m=>m.kind==='reply').length===2)
    expect(h.status().tickets).toHaveLength(1)
    expect(requests.filter(r=>!r.ephemeral).map(r=>r.threadId)).toEqual([undefined,first.run!.threadId])
  }
})

it('finishes the start job without executing if a task is stopped during PR classification',async()=>{
  const classification=deferred();let requested=false,workers=0
  const {runtime:h,source}=host(async()=>{workers++;return report()},true)
  Object.assign(source,{isPullRequest:async()=>{requested=true;await classification.promise;return true}})
  receive(h,'first','test/repo#7');await settle(h,()=>requested)
  const ticket=h.status().tickets[0]!,stopped=h.stop(ticket.id)
  classification.resolve();await stopped
  await settle(h,()=>h.store.db.prepare('SELECT state FROM jobs WHERE id=?').get('start:'+ticket.assignments[0]!.id)?.state==='done')
  expect(workers).toBe(0);expect(h.store.tickets.get(ticket.id)!.follows).toBeUndefined()
})
