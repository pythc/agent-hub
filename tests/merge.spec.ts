import {it,expect} from 'vitest'
import {mergeEligibility} from '../src/merge.ts'
import {configSchema} from '../src/config.ts'
const policy=()=>configSchema.parse({sources:[{id:'local',kind:'local',cwd:'.',allowedActors:['operator']}]}).delivery
function snapshot(){return {actor:'agent',pull:{state:'open',draft:false,merged:false,additions:100,deletions:99,mergeable:true,head:{sha:'a'}},reviews:[{id:1,state:'APPROVED',commit_id:'a',submitted_at:'one',user:{login:'reviewer',type:'User'}}],checks:{head:'a',checks:[{name:'test',status:'completed',conclusion:'success'}],statuses:[]},graph:{autoMergeRequest:null,reviewThreads:{nodes:[],pageInfo:{hasNextPage:false}}}}}
it('admits only a current-head approved, checked PR below the line threshold',()=>{
 expect(mergeEligibility(snapshot(),policy())).toEqual([])
 const s=snapshot();s.pull.deletions=100;expect(mergeEligibility(s,policy()).join()).toContain('threshold')
})
it('fails closed on incomplete provider snapshots rather than treating missing checks or line counts as approval',()=>{
 for(const field of ['additions','deletions','draft','merged']){const s:any=snapshot();delete s.pull[field];expect(mergeEligibility(s,policy())).toContain('Repository snapshot is incomplete or invalid')}
 const s:any=snapshot();delete s.reviews[0].user.type;expect(mergeEligibility(s,policy())).toContain('Repository snapshot is incomplete or invalid')
})
it('rejects stale and dismissed approvals and enforces named reviewers',()=>{
 const s=snapshot();s.reviews[0]!.commit_id='old';expect(mergeEligibility(s,policy()).join()).toContain('approval')
 s.reviews[0]!.commit_id='a';s.reviews.push({...s.reviews[0]!,id:2,state:'DISMISSED',submitted_at:'two'})
 expect(mergeEligibility(s,policy()).join()).toContain('approval')
 const p=policy();p.requiredReviewers=['other'];expect(mergeEligibility(snapshot(),p).join()).toContain('other')
})
it('rejects changes requested, failing checks, unresolved threads and externally queued merges',()=>{
 const s=snapshot();s.reviews[0]!.state='CHANGES_REQUESTED';s.checks.checks[0]!.conclusion='failure';s.graph.reviewThreads.nodes.push({isResolved:false,isOutdated:false} as never);s.graph.autoMergeRequest={} as any
 const errors=mergeEligibility(s,policy()).join(';')
 expect(errors).toContain('requested');expect(errors).toContain('CI');expect(errors).toContain('review');expect(errors).toContain('externally')
})
it('treats missing CI, incomplete review pages, unknown mergeability and bot approvals as blockers',()=>{
 const s=snapshot();s.checks.checks=[];s.pull.mergeable=null as any;s.graph.reviewThreads.pageInfo.hasNextPage=true;s.reviews[0]!.user.type='Bot'
 const errors=mergeEligibility(s,policy()).join(';')
 expect(errors).toContain('No CI');expect(errors).toContain('Mergeability');expect(errors).toContain('incomplete');expect(errors).toContain('human approval')
})

import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {execFileSync} from 'node:child_process'
import {afterEach} from 'vitest'
import {Store} from '../src/store.ts'
import {GithubSource,type GithubApi} from '../src/connectors/github.ts'
import {Merger} from '../src/merge.ts'
const fixtures:{root:string;store:Store;merger:Merger}[]=[]
afterEach(async()=>{for(const f of fixtures.splice(0)){await f.merger.close();f.store.close();rmSync(f.root,{recursive:true,force:true})}})
function integration(){
 const root=mkdtempSync(join(tmpdir(),'merge-acceptance-'))
 execFileSync('git',['init','-b','superagent/test',root],{stdio:'ignore'})
 const config=configSchema.parse({stateDir:join(root,'state'),delivery:{autoMerge:true,mergeGh:'merge-only'},sources:[{id:'github',kind:'github',repository:'test/repo',cwd:root,allowedActors:['reviewer']}]})
 const store=new Store(join(config.stateDir,'state.sqlite')),source=new GithubSource(config.sources[0]!),s:any=snapshot()
 Object.assign(s.pull,{number:1,base:{ref:'main',repo:{full_name:'test/repo'}},head:{sha:'a'.repeat(40),ref:'superagent/test',repo:{full_name:'test/repo'}}})
 s.reviews[0].commit_id=s.pull.head.sha;s.checks.head=s.pull.head.sha
 source.mergeSnapshot=async()=>s
 const ticket:any={id:'task',ended:undefined,mandate:{actor:{source:'github'}},follows:[{thread:'github:test/repo#1',own:true}],assignments:[{id:'a',state:'running',report:{state:'ready'}}],undelivered:[]}
 store.tickets.save(ticket);store.put('run','task',{ticketId:'task',assignmentId:'a',cwd:root,phase:'idle'})
 const calls:any[]=[],api:GithubApi={async request(method,path,body){calls.push({method,path,body});return method==='GET'?{login:'merge-service'}:{merged:true,sha:'merged-sha'}}}
 const host:any={config,store,sources:new Map([['github',source]]),status:()=>({paused:false}),validWork:()=>true}
 source.mergeIdentity=async()=>api.request('GET','user');source.merge=async(number,head,method)=>api.request('PUT','repos/test/repo/pulls/'+number+'/merge',{sha:head,merge_method:method});
 const merger=new Merger(host);fixtures.push({root,store,merger})
 const reset=()=>{store.db.prepare("DELETE FROM records WHERE kind='merge-attempt'").run()}
 return {store,source,host,merger,s,calls,api,reset,authorize:()=>merger.authorize('task','github',1,s.pull.head.sha)}
}
it('submits one atomic expected-head merge and keeps distinct accounts',async()=>{
 const f=integration();await f.authorize();await f.merger.tick();await f.merger.tick()
 expect(f.calls.filter(c=>c.method==='PUT')).toEqual([{method:'PUT',path:'repos/test/repo/pulls/1/merge',body:{sha:'a'.repeat(40),merge_method:'squash'}}])
 expect(f.store.get<any>('merge-attempt','github:1').phase).toBe('merged')
 expect(f.store.get<any>('run','task').phase).toBe('idle')
})
it('withdraws authorization before push and fences a revocation during preflight',async()=>{
 const f=integration();await f.authorize();await f.merger.beforePush('task','github','superagent/test');await f.merger.tick()
 expect(f.calls).toEqual([])
 await f.authorize();f.reset()
 const request=f.api.request.bind(f.api);f.api.request=async(...args)=>{if(args[0]==='GET')await f.merger.beforePush('task','github','superagent/test');return request(...args)}
 await f.merger.tick();expect(f.calls.some(c=>c.method==='PUT')).toBe(false)
})
it.each(['policy','input','authority','grant'])('rechecks %s after a repository plugin queues the write',async changed=>{
 const f=integration();await f.authorize()
 f.source.merge=async(_number,_head,_method,_identity,mayAct)=>{
  if(changed==='policy')f.host.config.delivery={...f.host.config.delivery,autoMerge:false}
  if(changed==='input')f.store.tickets.save({...f.store.tickets.get('task')!,undelivered:['new-input']})
  if(changed==='authority')f.host.validWork=()=>false
  if(changed==='grant')f.store.put('merge-grant','github:1',{...f.store.get<any>('merge-grant','github:1'),head:'b'.repeat(40)})
  expect(mayAct!()).toBe(false);throw Error('Host fenced queued write')
 }
 await f.merger.tick();expect(f.calls.some(c=>c.method==='PUT')).toBe(false)
 expect(f.store.get<any>('merge-attempt','github:1').phase).toBe('uncertain')
})
it('blocks stale heads, self approvals, same merge account, pending inputs and stopped tasks',async()=>{
 const f=integration();await f.authorize()
 f.s.pull.head.sha='b'.repeat(40);await f.merger.tick();expect(f.calls).toEqual([])
 f.s.pull.head.sha='a'.repeat(40);f.s.reviews[0].user.login='agent';f.reset();await f.merger.tick();expect(f.calls).toEqual([])
 f.s.reviews[0].user.login='reviewer';f.api.request=async(method)=>{f.calls.push({method});return {login:'agent'}};f.reset();await f.merger.tick();expect(f.calls.some(c=>c.method==='PUT')).toBe(false)
 f.store.tickets.save({...f.store.tickets.get('task')!,undelivered:['input']});f.reset();f.calls.length=0;await f.merger.tick();expect(f.calls).toEqual([])
})
it('retains uncertain write intent through restart and never retries a possible merge',async()=>{
 const f=integration();await f.authorize()
 f.api.request=async(method,path,body)=>{f.calls.push({method,path,body});if(method==='PUT')throw Error('Connection lost after write');return {login:'merge-service'}}
 await f.merger.tick();expect(f.store.get<any>('merge-attempt','github:1').phase).toBe('uncertain')
 const attempt=f.store.get<any>('merge-attempt','github:1');f.store.put('merge-attempt','github:1',{...attempt,at:0})
 await f.merger.tick();expect(f.calls.filter(c=>c.method==='PUT')).toHaveLength(1)
 f.s.pull.merged=true;f.s.pull.merge_commit_sha='confirmed';f.store.put('merge-attempt','github:1',{...attempt,at:0})
 await f.merger.tick();expect(f.store.get<any>('merge-attempt','github:1')).toMatchObject({phase:'merged',sha:'confirmed'})
})
it('does not submit after shutdown begins or silently approve a different branch',async()=>{
 const f=integration();f.s.pull.head.ref='main';await expect(f.authorize()).rejects.toThrow('outside')
 f.s.pull.head.ref='superagent/test';await f.authorize()
 f.api.request=async()=>{void f.merger.close();return {login:'merge-service'}}
 await f.merger.tick();expect(f.calls.some(c=>c.method==='PUT')).toBe(false)
 await expect(f.authorize()).rejects.toThrow('stopping')
})
it('supports explicit team-policy automatic authorization without a per-head operator call',async()=>{
 const f=integration();f.host.config.delivery.authorization='policy'
 await f.merger.tick()
 expect(f.store.get<any>('merge-grant','github:1').head).toBe('a'.repeat(40))
 expect(f.calls.some(c=>c.method==='PUT')).toBe(true)
})
it('retains uncertain merge intent when a new push or revoke is attempted',async()=>{
 const f=integration();await f.authorize();f.store.put('merge-attempt','github:1',{phase:'uncertain',id:'github:1',head:'a'.repeat(40),at:0})
 await expect(f.merger.beforePush('task','github','superagent/test')).rejects.toThrow('submitting')
 expect(f.store.get<any>('merge-attempt','github:1').phase).toBe('uncertain')
})
it('blocks disabled policy, pauses, stopped work and expired authorizations',async()=>{
 const f=integration();await f.authorize();f.host.config.delivery.autoMerge=false;await f.merger.tick();expect(f.calls).toEqual([])
 f.host.config.delivery.autoMerge=true;f.host.status=()=>({paused:true});f.reset();await f.merger.tick();expect(f.calls.some(c=>c.method==='PUT')).toBe(false)
 f.host.status=()=>({paused:false});const ticket=f.store.tickets.get('task')!;f.store.tickets.save({...ticket,ended:{by:'human',at:new Date().toISOString(),outcome:'stopped'}});f.reset();await f.merger.tick();expect(f.calls.some(c=>c.method==='PUT')).toBe(false)
 f.store.tickets.save(ticket);const grant=f.store.get<any>('merge-grant','github:1');f.store.put('merge-grant','github:1',{...grant,expiresAt:0});f.reset();await f.merger.tick()
 expect(f.store.get<any>('merge-grant','github:1').enabled).toBe(false);expect(f.store.get<any>('merge-attempt','github:1').phase).toBe('revoked')
})
it('rejects new grants and existing automatic grants for a disabled source',async()=>{
 const f=integration();await f.authorize();f.source.config.enabled=false
 await expect(f.authorize()).rejects.toThrow('disabled')
 await f.merger.tick();expect(f.calls).toEqual([])
 f.host.config.delivery.authorization='policy';f.store.db.prepare("DELETE FROM records WHERE kind IN ('merge-grant','merge-attempt')").run()
 await f.merger.tick();expect(f.store.list('merge-grant')).toHaveLength(0);expect(f.calls).toEqual([])
})
it('rechecks source enablement after asynchronous authorization reads and before submitting',async()=>{
 const f=integration(),snapshot=f.source.mergeSnapshot.bind(f.source)
 f.source.mergeSnapshot=async n=>{const result=await snapshot(n);f.source.config.enabled=false;return result}
 await expect(f.authorize()).rejects.toThrow('disabled');expect(f.store.list('merge-grant')).toHaveLength(0)
 f.source.config.enabled=true;f.source.mergeSnapshot=snapshot;await f.authorize()
 const request=f.api.request.bind(f.api)
 f.api.request=async(...args)=>{const result=await request(...args);if(args[0]==='GET')f.source.config.enabled=false;return result}
 await f.merger.tick();expect(f.calls.filter(c=>c.method==='PUT')).toHaveLength(0)
})
it.each(['submitting','uncertain'] as const)('keeps %s fenced through query errors, restart, policy disable and expiry',async phase=>{
 const f=integration();await f.authorize()
 f.store.put('merge-attempt','github:1',{id:'github:1',phase,head:'a'.repeat(40),at:0,reason:'Original write outcome unknown'})
 const snapshot=f.source.mergeSnapshot.bind(f.source)
 f.source.mergeSnapshot=async()=>{throw Error('Snapshot unavailable')}
 await f.merger.tick()
 expect(f.store.get<any>('merge-attempt','github:1')).toMatchObject({phase,reason:'Original write outcome unknown',checkError:'Error: Snapshot unavailable'})
 const age=()=>{const a=f.store.get<any>('merge-attempt','github:1');f.store.put('merge-attempt',a.id,{...a,at:0})}
 f.host.config.delivery.autoMerge=false;age();await f.merger.tick()
 expect(f.store.get<any>('merge-attempt','github:1').phase).toBe(phase)
 f.host.config.delivery.autoMerge=true;const grant=f.store.get<any>('merge-grant','github:1');f.store.put('merge-grant',grant.id,{...grant,expiresAt:0})
 age();await f.merger.tick();expect(f.store.get<any>('merge-attempt','github:1').phase).toBe(phase)
 f.store.put('merge-grant',grant.id,grant);f.source.mergeSnapshot=snapshot
 await f.merger.close();const restarted=new Merger(f.host)
 try{age();await restarted.tick();expect(f.calls.filter(c=>c.method==='PUT')).toHaveLength(0)
  f.s.pull.merged=true;f.s.pull.merge_commit_sha='confirmed';age();await restarted.tick()
  expect(f.store.get<any>('merge-attempt','github:1')).toMatchObject({phase:'merged',sha:'confirmed'})
 }finally{await restarted.close()}
})
