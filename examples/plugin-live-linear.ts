/** Opt-in two-process Linear acceptance against one explicitly selected test issue. */
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs'
import {resolve,join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {buildPluginPackage,readPluginPackage} from '../src/plugin-package.ts'
import {SourceRegistry} from '../src/source-plugins.ts'
import {configSchema} from '../src/config.ts'
import {Store} from '../src/store.ts'
import type {ProcessSource} from '../src/plugin-process.ts'
import type {Trigger} from '../plugins/sdk.ts'
import type {SourceContext} from '../src/sources.ts'

const phase=process.argv[2],out=resolve(process.argv[3]??'.local/linear-live')
assert(phase==='listen'||phase==='resume','Use listen or resume')
assert.equal(process.env.AGENTHUB_LIVE_SEND,'1','Explicit live-send opt-in is required')
const workspace=process.env.AGENTHUB_TEST_LINEAR_WORKSPACE??'',team=process.env.AGENTHUB_TEST_LINEAR_TEAM??'',issue=process.env.AGENTHUB_TEST_LINEAR_ISSUE??''
assert([workspace,team,issue].every(v=>/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(v)),'Explicit authorized workspace, team and issue UUIDs are required')
assert(process.env.AGENTHUB_LINEAR_TOKEN,'Linear credential is required')
const authType=process.env.AGENTHUB_LINEAR_AUTH_TYPE??'api-key';assert(['api-key','oauth'].includes(authType))
mkdirSync(out,{recursive:true,mode:0o700})
const write=(name:string,value:unknown)=>writeFileSync(join(out,name+'.json'),JSON.stringify(value,null,2)+'\n',{mode:0o600})
const read=(name:string)=>JSON.parse(readFileSync(join(out,name+'.json'),'utf8'))
if(phase==='listen')assert(!existsSync(join(out,'ready.json')),'Use a fresh directory for an incomplete listen run')
const root=fileURLToPath(new URL('../',import.meta.url)),pkgDir=join(out,'package')
const pkg=existsSync(pkgDir)?readPluginPackage(pkgDir):await buildPluginPackage(join(root,'plugins/linear/index.ts'),JSON.parse(readFileSync(join(root,'plugins/linear/manifest.json'),'utf8')),pkgDir)
const run=createHash('sha256').update(out+pkg.digest).digest('hex').slice(0,12),marker=(stage:string)=>'/agent [AgentHub Linear validation '+run+' '+stage+']'
const config=configSchema.parse({stateDir:join(out,'state'),work:{sandboxDriver:'seatbelt'},sourcePlugins:[{directory:pkg.directory,digest:pkg.digest}],sources:[{id:'linear-live',kind:'linear',cwd:out,options:{teams:[team],workspaceId:workspace,issueIds:[issue],tokenEnv:'AGENTHUB_LINEAR_TOKEN',authType,command:'/agent'}}]})
write('config',config)
const store=new Store(join(config.stateDir,'live.sqlite')),source=(await SourceRegistry.load(config)).create(config.sources[0]!) as ProcessSource
source.attach(store)
const ctx:SourceContext={store,receive(t){store.triggers.save(t)},change(e){store.put('acceptance-change',e.id,e)},bind(){throw Error('Unexpected task binding')},closed(){throw Error('Unexpected task completion')}}
async function api(query:string,variables:Record<string,unknown>){
  const r=await fetch('https://api.linear.app/graphql',{method:'POST',headers:{'content-type':'application/json',authorization:(authType==='oauth'?'Bearer ':'')+process.env.AGENTHUB_LINEAR_TOKEN},body:JSON.stringify({query,variables}),redirect:'error',signal:AbortSignal.timeout(15000)})
  const d=await r.json() as any;assert(r.ok&&!d.errors?.length&&d.data,'Independent Linear readback failed');return d.data
}
const find=(stage:string)=>store.list<Trigger>('trigger').find(t=>t.meta.scope===team&&t.meta.issueId===issue&&t.text===marker(stage))
async function verify(trigger:Trigger,stage:string){
  assert.equal(trigger.meta.scope,team);assert.equal(trigger.meta.issueId,issue);assert.equal(trigger.text,marker(stage))
  const resource=await source.read({resource:'message',trigger,pageSize:20});assert.equal(resource.message.body,trigger.text)
  const issueRead=await source.read({resource:'issue',trigger,pageSize:20});assert.equal(issueRead.issue.id,issue)
  const id='validation:'+run+':'+stage,text='[AgentHub Linear validation '+run+' '+stage+'-reply] Plugin read and reply verified.'
  const receipt=store.get<any>('acceptance-delivery',id)
  if(receipt)assert.equal(receipt.state,'sent','Uncertain delivery must be reconciled before retry')
  else{store.put('acceptance-delivery',id,{state:'sending',issue,text});await source.deliver({id,kind:'reply',channel:trigger.channel!,text});store.put('acceptance-delivery',id,{state:'sent',issue,text})}
  const matches:any[]=[];let after:string|null=null;const seen=new Set<string>()
  for(let i=0;i<20;i++){
    const data=await api('query AcceptanceReadback($id:String!,$after:String){issue(id:$id){id team{id} comments(first:100,after:$after){nodes{id body user{id} url} pageInfo{hasNextPage endCursor}}}}',{id:issue,after})
    assert.equal(data.issue.team.id,team);matches.push(...data.issue.comments.nodes.filter((c:any)=>c.body===text))
    const p=data.issue.comments.pageInfo;if(!p.hasNextPage)break
    assert(p.endCursor&&p.endCursor!==after&&!seen.has(p.endCursor)&&i<19,'Incomplete independent readback');after=p.endCursor;seen.add(p.endCursor)
  }
  assert.equal(matches.length,1,'Expected exactly one real Linear reply');assert.equal(matches[0].user.id,(await source.identity()).id.split(':')[1])
  return {stage,triggerId:trigger.id,commentId:trigger.meta.entityId,replyId:matches[0].id,url:matches[0].url,text:trigger.text}
}
try{
  await source.start(ctx)
  const identity=await source.identity(),probe=await source.probe();assert(probe.choices.some((c:any)=>c.id===team))
  assert((await source.members(team)).length>0,'Team membership must be readable')
  const savedIdentity=store.get<any>('source-identity','linear-live');if(savedIdentity)assert.equal(savedIdentity.principal,identity.id)
  store.put('source-identity','linear-live',{principal:identity.id})
  if(phase==='listen'){
    write('ready',{run,digest:pkg.digest,workspace,team,issue,identity,liveMarker:marker('live'),offlineMarker:marker('offline'),at:new Date().toISOString()})
    console.log(JSON.stringify({phase:'listening',run,marker:marker('live')}))
    const deadline=Date.now()+600000
    while(!find('live')&&Date.now()<deadline){await source.poll(ctx);if(!find('live'))await new Promise(r=>setTimeout(r,2000))}
    const trigger=find('live');assert(trigger,'Live marker was not received')
    const result=await verify(trigger,'live');assert(!find('offline'),'Offline marker arrived before shutdown')
    const cursor=store.get('source-cursor','linear-live:'+team);assert(cursor,'Durable cursor is required')
    await source.close();store.close()
    write('restart-ready',{run,digest:pkg.digest,workspace,team,issue,identity,result,cursor,offlineMarker:marker('offline'),at:new Date().toISOString()})
    console.log(JSON.stringify({phase:'offline',run,marker:marker('offline')}))
  }else{
    const prior=read('restart-ready');assert.equal(prior.run,run);assert.equal(prior.digest,pkg.digest);assert.equal(prior.identity.id,identity.id);assert.equal(prior.issue,issue);assert.equal(prior.team,team);assert.equal(prior.workspace,workspace)
    assert.deepEqual(store.get('source-cursor','linear-live:'+team),prior.cursor)
    const original=store.triggers.get(prior.result.triggerId);assert(original,'Original event did not survive restart');assert(!find('offline'),'Offline event was already present')
    await source.poll(ctx);const recovered=find('offline');assert(recovered,'Offline marker was not recovered')
    const result=await verify(recovered,'offline');await source.poll(ctx)
    assert.equal(store.list<Trigger>('trigger').filter(t=>t.text===marker('offline')).length,1)
    assert.equal(store.get<any>('acceptance-delivery','validation:'+run+':live')?.state,'sent')
    await verify(original,'live')
    const evidence={ok:true,at:new Date().toISOString(),run,digest:pkg.digest,workspace,team,issue,identity,checks:{workspaceAndTeamIdentity:true,realCommentIngress:true,pluginMessageAndIssueRead:true,realReply:true,independentReadback:true,fullProcessRestart:true,durableCursorAndReceipt:true,downtimeRecovery:true,repeatedPollDedup:true,noReplyResend:true},messages:[prior.result,result],boundary:'Isolated real Linear transport and process recovery. No production host switch or Linear-triggered model goal is implied.'}
    write('evidence',evidence);console.log(JSON.stringify(evidence))
  }
}finally{await source.close();if(store.db.isOpen)store.close()}
