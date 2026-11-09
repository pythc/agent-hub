import {createServer} from 'node:http'
import {mkdirSync,mkdtempSync,writeFileSync} from 'node:fs'
import {join,resolve} from 'node:path'
import {execFileSync} from 'node:child_process'
import {Runtime} from '../src/runtime.ts'
import {configSchema} from '../src/config.ts'
import {GithubSource,type GithubApi} from '../src/connectors/github.ts'
import {latestAssignment} from '../src/vendor/dsh-core/index.ts'
mkdirSync(resolve('validation'),{recursive:true})
mkdirSync(resolve('.local'),{recursive:true})
const root=mkdtempSync(resolve('.local/merge-isolated-'));execFileSync('git',['init','-b','superagent/isolated',root],{stdio:'ignore'})
const head='a'.repeat(40),calls:any[]=[],cases:any[]=[]
let approved=true,ci='success',unresolved=false,mergeActor='merge-account',drop=false,number=7
const pull:any={number,state:'open',draft:false,merged:false,additions:40,deletions:2,mergeable:true,head:{sha:head,ref:'superagent/isolated',repo:{full_name:'fixture/repo'}},base:{ref:'acceptance-only',repo:{full_name:'fixture/repo'}}}
const platform=createServer(async(req,res)=>{
 const chunks:Buffer[]=[];for await(const c of req)chunks.push(c)
 const body=chunks.length?JSON.parse(Buffer.concat(chunks).toString()):undefined,path=req.url!,actor=req.headers.authorization==='Bearer merger'?mergeActor:'agent-account'
 calls.push({method:req.method,path,actor,...(body?{body}:{})})
 let value:any
 if(path==='/user')value={login:actor,type:'User'}
 else if(req.method==='PUT'&&path.endsWith('/merge')){
  if(actor!=='merge-account'||body.sha!==pull.head.sha){res.writeHead(409);res.end('{}');return}
  pull.merged=true;pull.state='closed';pull.merge_commit_sha='c'.repeat(40)
  if(drop){req.socket.destroy();return}
  value={merged:true,sha:pull.merge_commit_sha}
 }else if(path==='/graphql')value={data:{repository:{pullRequest:{id:'PR',autoMergeRequest:null,reviewThreads:{nodes:[{id:'R',isResolved:!unresolved,isOutdated:false,comments:{nodes:[]}}],pageInfo:{hasNextPage:false}}}}}}
 else if(path.includes('/reviews'))value=approved?[{id:1,state:'APPROVED',commit_id:pull.head.sha,user:{login:'reviewer',type:'User'},submitted_at:new Date().toISOString()}]:[]
 else if(path.includes('/check-runs'))value={check_runs:[{name:'acceptance',status:'completed',conclusion:ci}]}
 else if(path.includes('/statuses'))value=[]
 else if(path===`/repos/fixture/repo/pulls/${number}`)value=pull
 else{res.writeHead(404);res.end('{}');return}
 res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(value))
})
await new Promise<void>(r=>platform.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+(platform.address() as any).port
function api(identity:string):GithubApi{return {async request(method,path,body){const response=await fetch(url+'/'+path,{method,headers:{authorization:'Bearer '+identity,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});if(!response.ok)throw Error('Fixture HTTP '+response.status);return response.json()}}}
const config=configSchema.parse({stateDir:join(root,'state'),delivery:{autoMerge:true,mergeGh:'isolated-merge-identity'},sources:[{id:'github',kind:'github',allowedActors:['operator'],cwd:root,repository:'fixture/repo',sandbox:'workspace-write'}]}),source=new GithubSource(config.sources[0]!,api('agent'))
const mergeTransport=api('merger');source.mergeIdentity=async()=>mergeTransport.request('GET','user');source.merge=async(number,head,method)=>mergeTransport.request('PUT','repos/'+source.config.repository+'/pulls/'+number+'/merge',{sha:head,merge_method:method});
const host=new Runtime(config,{sources:[source],model:{async run(){throw Error('No model should run in merge contract acceptance')}}})
function clear(){host.store.db.prepare("DELETE FROM records WHERE kind='merge-attempt'").run()}
const puts=()=>calls.filter(c=>c.method==='PUT').length
async function blocked(name:string){clear();const before=puts();await host.merger.tick();if(puts()!==before)throw Error(name+' submitted an unsafe merge');cases.push({name,passed:true,reason:host.store.get<any>('merge-attempt','github:'+number)?.reason})}
try{
 host.receive('github','operator',{id:'fixture',thread:'fixture/repo#7',text:'/agent isolated merge contract',addressed:true});host.engine.evaluateDue()
 const candidate=host.engine.candidate('github:fixture')!
 host.engine.decide('github:fixture',{kind:'accept',title:'Isolated merge acceptance',scope:'Synthetic fixture only',reason:'operator fixture',rules:[],evalId:candidate.evalId})
 const ticket=host.store.tickets.list()[0]!,assignment=latestAssignment(ticket)!
 host.engine.bindThread(ticket.id,{source:'github',id:'fixture/repo#7'},true)
 host.engine.inputsDelivered(ticket.id,assignment.id,ticket.undelivered);host.engine.inputsRead(ticket.id,ticket.undelivered);host.engine.turnEnded(ticket.id,assignment.id);host.engine.report(ticket.id,{state:'ready',summary:'Synthetic verified PR ready'})
 host.store.put('run',ticket.id,{ticketId:ticket.id,assignmentId:assignment.id,cwd:root,phase:'idle'})
 await host.merger.authorize(ticket.id,'github',number,head)
 pull.head.sha='b'.repeat(40);await blocked('stale-head');pull.head.sha=head
 approved=false;await blocked('approval-required');approved=true
 ci='failure';await blocked('ci-required');ci='success'
 unresolved=true;await blocked('review-resolution-required');unresolved=false
 mergeActor='agent-account';await blocked('separate-identity-required');mergeActor='merge-account'
 await host.merger.beforePush(ticket.id,'github',pull.head.ref);clear();await blocked('revoked-before-push')
 await host.merger.authorize(ticket.id,'github',number,head);clear();await host.merger.tick()
 if(puts()!==1||!pull.merged||host.store.get<any>('merge-attempt','github:7')?.phase!=='merged')throw Error('Valid merge not confirmed')
 cases.push({name:'valid-atomic-merge',passed:true,payload:calls.find(c=>c.method==='PUT').body})
 number=8;pull.number=8;pull.merged=false;pull.state='open';drop=true
 host.engine.bindThread(ticket.id,{source:'github',id:'fixture/repo#8'},true)
 await host.merger.authorize(ticket.id,'github',number,head);clear();await host.merger.tick()
 if(host.store.get<any>('merge-attempt','github:8')?.phase!=='uncertain')throw Error('Lost response must stay uncertain')
 const attempt=host.store.get<any>('merge-attempt','github:8');host.store.put('merge-attempt','github:8',{...attempt,at:0});await host.merger.tick()
 if(puts()!==2||host.store.get<any>('merge-attempt','github:8')?.phase!=='merged')throw Error('Unknown write was replayed or not reconciled')
 cases.push({name:'lost-response-observed-without-replay',passed:true,putCount:puts()})
 const evidence={at:new Date().toISOString(),passed:true,transport:'real loopback HTTP with independent fixture identities',externalWrites:false,cases,requests:calls}
 writeFileSync('validation/merge-isolated.json',JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify({passed:true,cases}))
}finally{await host.close();await new Promise<void>(r=>platform.close(()=>r()))}
