import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, it, expect } from 'vitest'
import { configSchema } from '../src/config.ts'
import { Runtime } from '../src/runtime.ts'
import type { Model, ModelRequest } from '../src/codex.ts'

const roots: string[] = []
const hosts: Runtime[] = []
function configuration() {
  const root = mkdtempSync(join(tmpdir(), 'superagent-test-'))
  roots.push(root)
  return configSchema.parse({ stateDir: join(root, 'state'), port: 0, sources: [{ id: 'local', kind: 'local', allowedActors: ['alice'], cwd: root }] })
}
class FixtureModel implements Model {
  requests: ModelRequest[] = []
  async run(request: ModelRequest) {
    this.requests.push(request)
    const router = request.instructions.startsWith('Classify')
    const data = JSON.parse(request.input)
    const text = data.trigger ? {action:'ignore',title:'',scope:'',reason:'Worker handles follow-up',rules:[],ruleAssessments:[],targetTicketId:null} : router ? {
      action: data.triggers[0].text === 'chatter' ? 'ignore' : 'accept', title: 'Compare documents', scope: 'Read and compare documents', reason: 'requested', rules: [],
    } : { state: 'ready', summary: 'Compared', reply: 'Version two adds an explicit acceptance condition.', question: null, handbacks: [] }
    const threadId = request.threadId ?? 'native-' + this.requests.length
    request.onThread?.(threadId); request.onTurn?.('turn-' + this.requests.length)
    return { threadId, turnId: 'turn-' + this.requests.length, text: JSON.stringify(text) }
  }
}
function host(model: Model = new FixtureModel()) {
  const result = new Runtime(configuration(), { model }); hosts.push(result); return result
}
async function settle(runtime: Runtime, done: () => boolean) {
  for (let n = 0; n < 100; n++) {
    await runtime.tick()
    await new Promise(resolve => setTimeout(resolve, 2))
    if (done()) return
  }
  throw new Error('Host did not settle: ' + JSON.stringify({ tickets: runtime.status().tickets.map(t => ({id:t.id,ended:t.ended,assignments:t.assignments,inputs:t.inputs,undelivered:t.undelivered,run:t.run})),deliveries:runtime.status().deliveries }))
}
afterEach(async () => {
  for (const runtime of hosts.splice(0)) await runtime.close()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})
describe('source-independent host', () => {
  it('recognizes only the exact operator-generated short connectivity phrase, keeping original text and authorization',async()=>{
    const model=new FixtureModel(),runtime=host(model),createdAt=Date.now()-1000
    runtime.store.put('entry-verification','check',{sourceId:'local',code:'AGH-SYNTHETIC',createdAt})
    runtime.receive('local','alice',{id:'short',thread:'check',text:'AGH-SYNTHETIC',addressed:true})
    await settle(runtime,()=>runtime.store.deliveries().some(d=>d.kind==='reply'&&d.status==='sent'))
    expect(JSON.parse(model.requests[0]!.input).connectionCheck).toMatchObject({code:'AGH-SYNTHETIC',purpose:'entry-connectivity'})
    expect(JSON.parse(model.requests[1]!.input).connectionCheck).toMatchObject({code:'AGH-SYNTHETIC'})
    expect(runtime.store.triggers.get('local:short')?.text).toBe('AGH-SYNTHETIC')
    runtime.receive('local','guest',{id:'guest',thread:'other',text:'AGH-SYNTHETIC',addressed:true})
    await settle(runtime,()=>runtime.store.decisions.byThread('local:other').length>0);expect(runtime.store.decisions.byThread('local:other')[0]?.kind).toBe('ignore')
    runtime.receive('local','alice',{id:'ordinary',thread:'normal',text:'Explain the report mentioning AGH-SYNTHETIC',addressed:true})
    await settle(runtime,()=>runtime.store.tickets.list().length===2)
    expect(JSON.parse(model.requests.filter(r=>r.ephemeral).at(-1)!.input).connectionCheck).toBeUndefined()
  })
  it('accepts scoped trigger resource references for acknowledgement without granting access to unrelated requests',async()=>{
    const fixture=new FixtureModel();let ack:any
    const model:Model={async run(request){if(request.ephemeral)return fixture.run(request);request.onThread?.('ack-thread');request.onTurn?.('ack-turn');ack=await request.onTool!('superagent_ack',{triggerId:'trigger/local:ack',text:'Acknowledged'},'ack-call');await expect(request.onTool!('superagent_ack',{triggerId:'trigger/local:foreign',text:'Forbidden'},'foreign-call')).rejects.toThrow();return {threadId:'ack-thread',turnId:'ack-turn',text:JSON.stringify({state:'ready',summary:'done',reply:'done',question:null,handbacks:[]})}}},runtime=host(model)
    const source=runtime.sources.get('local')!;runtime.store.put('trigger','local:foreign',source.trigger({id:'foreign',thread:'elsewhere',text:'Other work',addressed:true},'alice'))
    runtime.receive('local','alice',{id:'ack',thread:'acknowledge',text:'Acknowledge this',addressed:true})
    await settle(runtime,()=>runtime.store.deliveries().some(d=>d.kind==='reply'&&d.status==='sent'));expect(ack.success).toBe(true);expect(runtime.store.deliveries().filter(d=>d.kind==='acknowledgement')).toHaveLength(1)
  })
  it('delivers the current clarification question once instead of quarantining a valid blocked report',async()=>{
    const fixture=new FixtureModel(),model:Model={async run(request){if(request.ephemeral)return fixture.run(request);request.onThread?.('question-thread');request.onTurn?.('question-turn');return {threadId:'question-thread',turnId:'question-turn',text:JSON.stringify({state:'blocked',summary:'Need the input document',reply:'',question:'Which document should I compare?',handbacks:[]})}}},runtime=host(model)
    runtime.receive('local','alice',{id:'question',thread:'docs',text:'Compare the document',addressed:true})
    await settle(runtime,()=>runtime.store.deliveries().some(d=>d.kind==='reply'&&d.status==='sent'))
    const ticket=runtime.store.tickets.list()[0]!,run=runtime.store.get<any>('run',ticket.id)
    expect(run.phase).toBe('idle');expect(run.error).toBeUndefined();expect(ticket.attention?.question).toBe('Which document should I compare?')
    expect(runtime.store.deliveries().filter(d=>d.kind==='reply').map(d=>d.text)).toEqual(['Which document should I compare?'])
  })
  it('handles an answer and follow-up without Git, preserving the native thread', async () => {
    const model = new FixtureModel()
    const runtime = host(model)
    runtime.receive('local', 'alice', { id: '1', thread: 'docs', text: 'Compare two documents', addressed: true })
    await settle(runtime, () => runtime.store.deliveries().some(d => d.kind==='reply' && d.status === 'sent'))
    const first = runtime.store.tickets.list()[0]!
    expect(first.ended?.outcome).toBe('completed')
    runtime.receive('local', 'alice', { id: '2', thread: 'docs', text: 'Explain the acceptance condition', addressed: true })
    await settle(runtime, () => runtime.store.deliveries().filter(d=>d.kind==='reply').length === 2 && runtime.store.deliveries().every(d => d.status === 'sent'))
    expect(runtime.store.tickets.list()).toHaveLength(1)
    expect(model.requests.filter(r => !r.ephemeral).map(r => r.threadId)).toEqual([undefined, 'native-2'])
  })
  it('rejects altered idempotency retries and ignores unauthorized new requests', async () => {
    const runtime = host()
    const event = { id: '1', thread: 'docs', text: 'Compare', addressed: true }
    runtime.receive('local', 'alice', event)
    expect(runtime.receive('local', 'alice', event)).toMatchObject({ disposition: 'duplicate' })
    expect(() => runtime.receive('local', 'alice', { ...event, text: 'Different request' })).toThrow('reused')
    runtime.receive('local', 'guest', { ...event, id: '2', thread: 'other' })
    await settle(runtime, () => runtime.store.decisions.byThread('local:other').length > 0)
    expect(runtime.store.decisions.byThread('local:other')[0]?.kind).toBe('ignore')
  })
  it('does not execute a router-classified casual message', async () => {
    const model = new FixtureModel(), runtime = host(model)
    runtime.receive('local', 'alice', { id: '1', thread: 'chat', text: 'chatter', addressed: true })
    await settle(runtime, () => runtime.store.decisions.byThread('local:chat').length > 0)
    expect(runtime.store.tickets.list()).toEqual([])
    expect(model.requests).toHaveLength(1)
  })
  it('keeps read/write intents and their effects in one rollback boundary', () => {
    const runtime = host()
    expect(() => runtime.store.atomic(() => {
      runtime.store.put('test', 'x', { value: 1 })
      runtime.store.enqueue('never', 'start', {})
      runtime.store.outbox.send({ id: 'never', channel: { source: 'local', thread: 'x', address: {} }, kind: 'reply', text: 'no' })
      throw new Error('rollback')
    })).toThrow('rollback')
    expect(runtime.store.get('test', 'x')).toBeUndefined()
    expect(runtime.store.jobs()).toEqual([])
    expect(runtime.store.deliveries().filter(d=>d.kind==='reply')).toEqual([])
  })
  it('prevents a second host from writing the same state directory', () => {
    const runtime = host()
    expect(() => new Runtime(runtime.config)).toThrow('owned by a live host')
  })
  it('persists completed work and routes a follow-up after host restart', async () => {
    const config = configuration(), model = new FixtureModel()
    const first = new Runtime(config, { model })
    first.receive('local', 'alice', { id: '1', thread: 'docs', text: 'Compare documents', addressed: true })
    await settle(first, () => first.store.deliveries().some(d => d.kind==='reply' && d.status === 'sent'))
    const previous=first.store.list<any>('run')[0]!
    first.store.put('run',previous.ticketId,{...previous,toolsDigest:'schema-before-upgrade'})
    await first.close()
    const second = new Runtime(config, { model }); hosts.push(second)
    second.receive('local', 'alice', { id: '2', thread: 'docs', text: 'Explain that change', addressed: true })
    await settle(second, () => second.store.deliveries().filter(d=>d.kind==='reply').length === 2 && second.store.deliveries().every(d => d.status === 'sent'))
    expect(second.store.tickets.list()).toHaveLength(1)
    expect(model.requests.at(-1)!.threadId).toBe('native-2')
    expect(model.requests.at(-1)!.workerMcp).toBeUndefined()
    expect(model.requests.at(-1)!.tools?.some(t=>t.name==='superagent_tools')).toBe(true)
    const changed=JSON.parse(model.requests.at(-1)!.input).toolsChanged
    expect(changed.tools.find((t:any)=>t.name==='superagent_browser').description).toContain('screenshot exports a PNG')
  })
  it('quarantines an ambiguous in-flight activation at restart', async () => {
    const config = configuration()
    const first = new Runtime(config, { model: new FixtureModel() })
    first.store.put('run', 'unknown', { ticketId: 'unknown', assignmentId: 'a', cwd: config.sources[0]!.cwd, phase: 'running', threadId: 'thread-a' })
    first.store.put('run', 'prior-error', { ticketId: 'prior-error', assignmentId: 'b', cwd: config.sources[0]!.cwd, phase: 'uncertain', threadId: 'thread-b',error:'Provider preflight rejected current schema' })
    await first.close()
    const second = new Runtime(config, { model: new FixtureModel() }); hosts.push(second)
    expect(second.store.get<any>('run', 'unknown').phase).toBe('uncertain')
    expect(second.store.get<any>('run', 'prior-error').error).toBe('Provider preflight rejected current schema')
  })
})

it('accepts a custom source kind through the source port, with no repository assumptions', async () => {
  const config=configuration()
  config.sources[0]!.id='queue'
  config.sources[0]!.kind='custom-queue'
  const delivered: string[]=[]
  const source={
    config:config.sources[0]!,
    trigger(input:any,actor:string) {
      return {id:'queue:'+input.id,source:'queue',actor:{source:'queue',id:actor},human:true,addressed:'direct' as const,
        threads:[{source:'queue',id:input.thread}],at:new Date().toISOString(),text:input.text,meta:{},
        channel:{source:'queue',thread:input.thread,address:{replyTo:input.id}}}
    },
    async deliver(message:any){delivered.push(message.text)},
  }
  const runtime=new Runtime(config,{model:new FixtureModel(),sources:[source]});hosts.push(runtime)
  runtime.receive('queue','alice',{id:'1',thread:'document-topic',text:'Compare documents',addressed:true})
  await settle(runtime,()=>delivered.length===2)
  expect(delivered[1]).toContain('acceptance')
  expect(runtime.store.tickets.list()[0]!.mandate.actor.source).toBe('queue')
})

it('stops an in-flight activation and fences its late result', async () => {
  const fixture=new FixtureModel()
  const delayed:Model={async run(request){
    if(request.ephemeral)return fixture.run(request)
    request.onThread?.('native-delayed');request.onTurn?.('turn-delayed')
    return new Promise((resolve,reject)=>{
      request.signal!.addEventListener('abort',()=>reject(new Error('cancelled')),{once:true})
    })
  }}
  const runtime=host(delayed)
  runtime.receive('local','alice',{id:'1',thread:'slow',text:'Compare documents',addressed:true})
  await settle(runtime,()=>runtime.store.list<any>('run').some(r=>r.phase==='running'))
  const id=runtime.store.tickets.list()[0]!.id
  await runtime.stop(id)
  await runtime.tick()
  expect(runtime.store.tickets.get(id)?.ended?.outcome).toBe('stopped')
  expect(runtime.store.deliveries().filter(d=>d.kind==='reply')).toEqual([])
  expect(runtime.status().active).toBe(0)
})

it('records proactive observations without executing them', async () => {
  const config=configuration();config.acceptMode='observe';config.rules=[{id:'compare',instruction:'Compare changed documents'}]
  const fixture=new FixtureModel()
  const model:Model={async run(request){
    if(!request.ephemeral)throw Error('Observe mode must not execute')
    const result=await fixture.run(request)
    const value=JSON.parse(result.text);value.rules=['compare'];value.ruleAssessments=[{id:'compare',matched:true,reason:'Changed documents match'}];value.direction={implementation_requested:true,target_basis:'specified',requires_design_decision:false,evidence:'Compare the changed documents'};value.intent_evidence='Requested comparison of the changed documents against their prior versions'
    return {...result,text:JSON.stringify(value)}
  }}
  const runtime=new Runtime(config,{model});hosts.push(runtime)
  runtime.receive('local','alice',{id:'1',thread:'watch',text:'Documents changed',addressed:false})
  await settle(runtime,()=>runtime.store.decisions.byThread('local:watch').length>0)
  expect(runtime.store.tickets.list()).toEqual([])
  expect(runtime.store.decisions.byThread('local:watch')[0]?.audit?.wouldAccept).toBe(true)
})

it('keeps an explicit processing pause across restarts', async () => {
  const config=configuration()
  const first=new Runtime(config,{model:new FixtureModel()})
  first.pause(true);await first.close()
  const second=new Runtime(config,{model:new FixtureModel()});hosts.push(second)
  expect(second.status().paused).toBe(true)
})

it('stores follow-ups while human control holds automatic execution', async () => {
  const model = new FixtureModel(), runtime = host(model)
  runtime.receive('local','alice',{id:'1',thread:'docs',text:'Compare documents',addressed:true})
  await settle(runtime,()=>runtime.store.deliveries().some(d=>d.kind==='reply'&&d.status==='sent'))
  const id=runtime.store.tickets.list()[0]!.id
  await runtime.takeover(id)
  const before=model.requests.filter(r=>!r.ephemeral).length
  runtime.receive('local','alice',{id:'2',thread:'docs',text:'Explain the acceptance condition',addressed:true})
  for(let i=0;i<5;i++)await runtime.tick()
  expect(runtime.store.triggers.get('local:2')).toBeDefined()
  expect(model.requests.filter(r=>!r.ephemeral)).toHaveLength(before)
  runtime.returnControl(id)
  runtime.retry(id)
  await settle(runtime,()=>runtime.store.deliveries().filter(d=>d.kind==='reply'&&d.status==='sent').length===2)
  expect(runtime.store.tickets.list()).toHaveLength(1)
})

it('refuses proactive acceptance when a rule was omitted from the assessment',async()=>{
 const config=configuration();config.acceptMode='auto';config.rules=[{id:'a',instruction:'A'},{id:'b',instruction:'B'}]
 const model:Model={async run(){return {threadId:'router',turnId:'one',text:JSON.stringify({action:'accept',title:'Work',scope:'Read',reason:'match',rules:['a'],ruleAssessments:[{id:'a',matched:true,reason:'A'}]})}}}
 const runtime=new Runtime(config,{model});hosts.push(runtime)
 runtime.receive('local','alice',{id:'1',thread:'rules',text:'Changed',addressed:false})
 await settle(runtime,()=>runtime.store.decisions.byThread('local:rules').length>0)
 expect(runtime.store.tickets.list()).toEqual([])
 expect(runtime.store.decisions.byThread('local:rules')[0]!.kind).toBe('unavailable')
})

it('routes a human stop follow-up while its worker turn remains active',async()=>{
 const fixture=new FixtureModel()
 const model:Model={async run(request){
  const data=JSON.parse(request.input)
  if(data.trigger)return {threadId:'router-stop',turnId:'one',text:JSON.stringify({action:'stop',targetTicketId:data.tickets[0].id,title:'',scope:'',reason:'Human asked to stop',rules:[],ruleAssessments:[]})}
  if(request.ephemeral)return fixture.run(request)
  request.onThread?.('worker-stop');request.onTurn?.('one')
  return new Promise((resolve,reject)=>request.signal!.addEventListener('abort',()=>reject(Error('cancelled')),{once:true}))
 }}
 const runtime=host(model)
 runtime.receive('local','alice',{id:'1',thread:'stop',text:'Compare',addressed:true})
 await settle(runtime,()=>runtime.store.list<any>('run').some(r=>r.phase==='running'))
 runtime.receive('local','alice',{id:'2',thread:'stop',text:'Stop this work',addressed:false})
 await settle(runtime,()=>runtime.store.tickets.list()[0]?.ended?.outcome==='stopped')
 expect(runtime.store.decisions.byThread('local:stop').some(d=>d.kind==='stop')).toBe(true)
})

it('cancels in-flight source polling during a graceful shutdown',async()=>{
 const config=configuration(),fixture=new FixtureModel()
 let started=false,cancelled=false
 const {MessageSource}=await import('../src/sources.ts')
 const source=new MessageSource(config.sources[0]!) as InstanceType<typeof MessageSource>&{poll:any}
 source.poll=async(ctx:any)=>{started=true;await new Promise<void>(resolve=>ctx.signal.addEventListener('abort',()=>{cancelled=true;resolve()},{once:true}))}
 const runtime=new Runtime(config,{model:fixture,sources:[source]})
 await runtime.tick()
 expect(started).toBe(true)
 await runtime.close()
 expect(cancelled).toBe(true)
})

it('quarantines a delivery interrupted after its sending intent was persisted',async()=>{
 const config=configuration(),first=new Runtime(config,{model:new FixtureModel()})
 first.store.outbox.send({id:'external-write',kind:'reply',text:'Done',channel:{source:'local',thread:'t',address:{}}})
 expect(first.store.deliveryStarted('external-write')).toBe(true)
 await first.close()
 const second=new Runtime(config,{model:new FixtureModel()});hosts.push(second)
 expect(second.store.deliveries()[0]!.status).toBe('uncertain')
 await second.tick()
 expect(second.store.deliveries()[0]!.status).toBe('uncertain')
})

it('retrieves a cross-discussion task only from its exact reference, including ended work',async()=>{
 const fixture=new FixtureModel()
 const model:Model={async run(r){const data=JSON.parse(r.input);if(r.ephemeral&&data.triggers?.[0]?.text.startsWith('Continue task ')){return {threadId:'router-cross',turnId:'cross',text:JSON.stringify({action:'attach',title:'',scope:'',reason:'Exact work reference',rules:[],ruleAssessments:[],targetTicketId:data.existing[0]?.id})}}return fixture.run(r)}}
 const runtime=host(model)
 runtime.receive('local','alice',{id:'one',thread:'original',text:'Compare documents',addressed:true})
 await settle(runtime,()=>!!runtime.store.tickets.list()[0]?.ended)
 const id=runtime.store.tickets.list()[0]!.id
 runtime.receive('local','alice',{id:'two',thread:'other',text:'Continue task '+id+' and explain it',addressed:true})
 await settle(runtime,()=>runtime.store.triggers.disposition('local:two')?.fanout.includes(id)??false)
 expect(runtime.store.tickets.list()).toHaveLength(1)
 expect(runtime.store.threads.get('local:other')?.subscriptions).toContain(id)
})

it.each([false,true])('holds a background slot and reserves the extra slot for a human follow-up (explicit pool: %s)',async(explicit)=>{
 const config=configuration();config.concurrency=1;if(explicit)config.execution.workers=[{id:'worker-1',backend:'codex'}]
 const fixture=new FixtureModel(),starts:string[]=[],holds=new Map<string,()=>void>()
 const model:Model={async run(r){
  if(r.ephemeral)return fixture.run(r)
  if(r.instructions.includes('You are a managed subagent'))return new Promise((resolve,reject)=>{r.signal!.addEventListener('abort',()=>reject(Error('cancelled')),{once:true})})
  const data=JSON.parse(r.input),origin=data.origin?.[0]?.text??'',threadId=r.threadId??(origin==='background'?'background-native':'idle-native')
  r.onThread?.(threadId);r.onTurn?.('turn-'+Date.now());starts.push(origin||threadId)
  if(origin==='background')await r.onTool!('superagent_spawn',{requestId:'held-child',prompt:'Hold until stopped'},'call')
  if(r.threadId==='idle-native')await new Promise<void>(resolve=>{holds.set('human',resolve);r.signal!.addEventListener('abort',()=>resolve(),{once:true})})
  return {threadId,turnId:'turn-'+Date.now(),text:JSON.stringify({state:'waiting',summary:'Waiting',reply:'',question:null,handbacks:[]})}
 }}
 const runtime=new Runtime(config,{model});hosts.push(runtime)
 runtime.receive('local','alice',{id:'idle',thread:'idle-topic',text:'idle',addressed:true})
 await settle(runtime,()=>runtime.store.list<any>('run').some(r=>r.phase==='idle'))
 runtime.receive('local','alice',{id:'background',thread:'bg-topic',text:'background',addressed:true})
 await settle(runtime,()=>runtime.store.list<any>('run').some(r=>r.phase==='background'))
 runtime.receive('local','alice',{id:'new',thread:'queued-topic',text:'queued-work',addressed:true})
 runtime.receive('local','alice',{id:'human',thread:'idle-topic',text:'Follow up now',addressed:true})
 await settle(runtime,()=>holds.has('human'))
 expect(starts).not.toContain('queued-work')
 expect(runtime.store.list<any>('run').filter(r=>r.phase==='background')).toHaveLength(1)
 holds.get('human')!();const bg=runtime.store.tickets.list().find(t=>runtime.store.get<any>('run',t.id)?.phase==='background')!
 await runtime.stop(bg.id)
 await settle(runtime,()=>starts.includes('queued-work'))
})

it('selects role models for new sessions and preserves the existing worker model on follow-up',async()=>{
 const config=configuration();config.models={router:'router-a',worker:'worker-a'}
 const model=new FixtureModel(),runtime=new Runtime(config,{model});hosts.push(runtime)
 runtime.receive('local','alice',{id:'one',thread:'models',text:'Compare documents',addressed:true})
 await settle(runtime,()=>!!runtime.store.tickets.list()[0]?.ended)
 expect(model.requests[0]?.model).toBe('router-a');expect(model.requests.find(r=>!r.ephemeral)?.model).toBe('worker-a')
 runtime.updateSettings(0,{models:{router:'router-b',worker:'worker-b'}})
 runtime.receive('local','alice',{id:'two',thread:'models',text:'Explain it',addressed:true})
 await settle(runtime,()=>model.requests.filter(r=>!r.ephemeral).length===2&&!!runtime.store.tickets.list()[0]?.ended)
 expect(model.requests.filter(r=>!r.ephemeral).at(-1)).toMatchObject({threadId:'native-2'})
 expect(model.requests.filter(r=>!r.ephemeral).at(-1)?.model).toBeUndefined()
})
