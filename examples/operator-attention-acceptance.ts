/** Cloud-local Runtime/account/GET fixture. All requests/effects are synthetic. */
import {createHash,randomUUID} from 'node:crypto'
import {existsSync,mkdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs'
import {join,resolve} from 'node:path'
import {Runtime} from '../src/runtime.ts'
import {configSchema} from '../src/config.ts'
import {serve} from '../src/server.ts'
import {OperatorAttention} from '../src/operator-attention.ts'
const root=resolve(process.argv[2]??'.local/operator-attention-acceptance'),cwd=join(root,'workspace')
mkdirSync(cwd,{recursive:true,mode:0o700});if(existsSync(join(root,'browser.json')))throw Error('Use a fresh private acceptance directory')
let modelCalls=0,historyCalls=0,externalCalls=0,attentionRequests=0,closing=false
const host=new Runtime(configSchema.parse({stateDir:join(root,'state'),port:0,watchdog:{enabled:false},acceptMode:'auto',work:{sandboxDriver:'disabled',autoRecover:false},execution:{router:{mode:'host'},management:{enabled:true,maxWorkers:1},workers:[{id:'one',backend:'codex'}]},sources:[{id:'local',kind:'local',cwd,workspace:{mode:'source'},allowedActors:['operator']}]}),{model:{describe:()=>({id:'codex',kind:'codex',resume:true,tools:true,images:false,nativeTakeover:false,steering:false,promptRefresh:false}),async history(){historyCalls++;throw Error('History invocation forbidden')},async run(){modelCalls++;throw Error('Model calls forbidden')}}})
host.pause(true);host.sources.get('local')!.deliver=async()=>{externalCalls++;throw Error('Delivery forbidden')}
host.scopes.command({action:'scope.put',operationId:'scope',expectedRevision:0,scope:{id:'team',tenantId:'org',name:'Team',contextBytes:128000,managers:[JSON.stringify(['local','operator'])],workerIds:['one'],sourceIds:['local'],backendIds:['codex']}})
host.scopes.command({action:'entry.bind',operationId:'entry',expectedRevision:0,scopeId:'team',sourceId:'local',accountNamespace:'local',nativeId:'topic',history:'group'})
const received=host.receive('local','operator',{id:'local-fixture-request',thread:'topic',scope:'topic',text:'Continuously inspect this local fixture and report findings',addressed:true}) as {triggerId:string}
const trigger=host.store.triggers.get(received.triggerId)!,context=host.scopes.context(trigger,'local:topic')!,assigned=await host.manager.call({action:'assign',id:'one',revision:host.settings.current().revision,requestId:'local-task',text:'Inspect local fixture'},{discussion:'local:topic',trigger,scoped:context}),ticket=host.store.tickets.get(assigned.ticketId)!,assignment=ticket.assignments.at(-1)!
host.engine.assignmentStarted(ticket.id,assignment.id)
host.store.put('run',ticket.id,{ticketId:ticket.id,assignmentId:assignment.id,cwd,phase:'human',threadId:'local-fixture-session',turnId:'local-fixture-turn',backendId:'codex',workerId:'one'})
host.engine.report(ticket.id,{state:'blocked',summary:'Local fixture waiting for input',question:'Which local document should be inspected?'})
for(const method of ['item/commandExecution/requestApproval','item/permissions/requestApproval','acp/permission']){
 const promise=host.approvals.request(ticket.id,{id:randomUUID(),method,params:{threadId:'local-fixture-session',turnId:'local-fixture-turn',...(method==='acp/permission'?{expiresAt:Date.now()+60_000}:{}),...(method==='item/permissions/requestApproval'?{permissions:{network:{enabled:false}}}:{})}});void promise.catch(()=>{})
 const item=host.store.list<{id:string;createdAt:number}>('approval').at(-1)!
 host.store.put('approval',item.id,{...host.store.get('approval',item.id) as object,createdAt:Math.max(item.createdAt,Date.parse(host.store.tickets.get(ticket.id)!.assignments.at(-1)!.startedAt!)+1)})
}
const now=Date.now();host.store.put('approval','local-expired',{id:'local-expired',ticketId:ticket.id,createdAt:now-240000,expiresAt:now-120000,status:'expired',native:{id:'local-expired-native',method:'item/commandExecution/requestApproval',params:{threadId:'local-fixture-session',turnId:'local-fixture-turn'}}})
host.store.put('tool-receipt','local-unknown-effect',{id:'local-unknown-effect',ticketId:ticket.id,state:'uncertain',at:now})
const owner=host.scopes.ownership(ticket.id)!,entry=host.scopes.binding(owner.originEntry),target={key:'local-workflow',entryId:entry.id,teamId:'topic',issueId:'local-issue'}
host.config.sources[0]!.options.statusTargets=[target];host.config.sources[0]!.capabilities.resources=true
host.sources.get('local')!.applyWorkflowState=async()=>{externalCalls++;throw Error('External state changes forbidden')}
host.store.put('workflow-action','local-stale-workflow',{id:'local-stale-workflow',ticketId:ticket.id,originTriggerId:trigger.id,notificationTriggerId:trigger.id,sourceId:'local',target,entryRevision:entry.revision,ownerEpoch:0,dataRevision:owner.dataRevision??1,view:{account:'Local fixture',issue:'local-issue',label:'Local workflow review',revision:'local-v1',current:{id:'todo',name:'To do'},states:[]},next:{id:'done',name:'Done'},state:'pending',at:now})
const server=await serve(host);clearInterval((host as unknown as {timer:ReturnType<typeof setInterval>}).timer)
server.server.on('request',request=>{if(new URL(request.url??'/',server.url).pathname==='/entry-workspace/attention')attentionRequests++})
const token=readFileSync(server.tokenPath,'utf8').trim(),account=await fetch(server.url+'/account/setup',{method:'POST',headers:{authorization:'Bearer '+token,origin:server.url,'content-type':'application/json'},body:JSON.stringify({username:'attention-preview',displayName:'Local attention acceptance',password:'Local-'+randomUUID()+'A!',remember:true})})
if(!account.ok)throw Error('Local fixture account setup failed')
const mode='Real cloud-local Runtime, operator account and protected GET; synthetic local native/ACP/workflow/effect records; no provider or third-party acceptance'
writeFileSync(join(root,'browser.json'),JSON.stringify({base:server.url,url:server.url+'/configure#attention',cookie:account.headers.get('set-cookie')!.split(';')[0]!,mode}),{mode:0o600})
function facts(){const rows:Record<string,unknown>={};for(const row of host.store.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()){const name=String(row.name);if(/^[a-z_0-9]+$/.test(name))rows[name]=host.store.db.prepare('SELECT * FROM '+name).all()}return JSON.stringify(rows,(_,v)=>typeof v==='bigint'?String(v):v instanceof Uint8Array?Array.from(v):v)}
function observation(){const before=facts(),changes=Number(host.store.db.prepare('SELECT total_changes() AS n').get()!.n),snapshot=new OperatorAttention(()=>host).snapshot(),after=facts();return {modelCalls,historyCalls,externalCalls,attentionRequests,dbDigest:createHash('sha256').update(after).digest('hex'),readOnlyProjectionStable:before===after&&changes===Number(host.store.db.prepare('SELECT total_changes() AS n').get()!.n),pendingWaiters:(host.approvals as unknown as {pending:Map<string,unknown>}).pending.size,total:snapshot.total,states:snapshot.items.map(item=>item.state)}}
const observations:unknown[]=[];let previous=''
const timer=setInterval(()=>{try{const path=join(root,'control.json');if(!existsSync(path))return;const raw=readFileSync(path,'utf8');if(raw===previous||raw.length>256)return;previous=raw;const command=JSON.parse(raw);if(command.action!=='observe'||typeof command.id!=='string'||!/^[a-f0-9-]{36}$/.test(command.id))return;const evidence={id:command.id,...observation()};observations.push(evidence);writeFileSync(join(root,'runtime-evidence.json'),JSON.stringify({mode,realProviders:false,observations},null,2),{mode:0o600});writeFileSync(join(root,'control-result.json'),JSON.stringify(evidence),{mode:0o600})}catch{writeFileSync(join(root,'control-failed.json'),JSON.stringify({code:'local_observation_failed'}),{mode:0o600})}},40)
console.log(JSON.stringify({ready:true,mode}))
async function close(){if(closing)return;closing=true;clearInterval(timer);server.server.closeAllConnections();await new Promise<void>(done=>server.server.close(()=>done()));await server.closeRuntime();rmSync(join(root,'control.json'),{force:true})}
process.once('SIGTERM',()=>void close());process.once('SIGINT',()=>void close())
