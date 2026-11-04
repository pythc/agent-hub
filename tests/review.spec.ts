import {it,expect,afterEach} from 'vitest'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {Store} from '../src/store.ts'
import {Reviews} from '../src/review.ts'
import {GithubSource} from '../src/connectors/github.ts'
import {configSchema} from '../src/config.ts'
const fixtures:{store:Store;root:string}[]=[]
afterEach(()=>{for(const f of fixtures.splice(0)){f.store.close();rmSync(f.root,{recursive:true,force:true})}})
function fixture(){
 const root=mkdtempSync(join(tmpdir(),'review-flow-')),store=new Store(join(root,'state.sqlite'));fixtures.push({root,store})
 const source=new GithubSource(configSchema.parse({sources:[{id:'github',kind:'github',cwd:root,repository:'owner/repo'}]}).sources[0]!)
 source.reviewGraph=async()=>({reviewThreads:{nodes:[{id:'thread-id',isResolved:false,comments:{nodes:[{databaseId:42}]}}]}})
 const resolved:number[]=[];source.resolveReview=async n=>{resolved.push(n)}
 const trigger:any={id:'review-trigger',source:'github',meta:{number:7},channel:{source:'github',thread:'owner/repo#7',address:{number:'7',reviewComment:'42'}}};store.triggers.save(trigger)
 store.tickets.save({id:'task',mandate:{},origin:{triggerIds:[]},inputs:[{id:'input',kind:'trigger',triggerId:trigger.id}],follows:[{thread:'github:owner/repo#7',own:true}]} as any)
 const host:any={store,sources:new Map([['github',source]]),validWork:()=>true,canWrite:()=>true},reviews=new Reviews(host),owner:any={ticketId:'task',assignmentId:'a',sandbox:'workspace-write',cwd:root}
 return {store,source,host,reviews,owner,resolved}
}
it('queues one inline decline explanation and resolves only after it is delivered',async()=>{
 const f=fixture(),first=await f.reviews.act(f.owner,'review-trigger','decline','The behavior is required by the public API')
 expect(await f.reviews.act(f.owner,'review-trigger','decline','Repeat')).toEqual(first)
 expect(f.store.deliveries()).toHaveLength(1)
 await f.reviews.tick();expect(f.resolved).toEqual([])
 f.store.delivered(first.messageId!);await f.reviews.tick();await f.reviews.tick()
 expect(f.resolved).toEqual([7]);expect(f.store.get<any>('review-action',first.id).phase).toBe('resolved')
})
it('refuses unverified fixes, subagent decisions, and assignments ended during verification',async()=>{
 const f=fixture()
 await expect(f.reviews.act(f.owner,'review-trigger','fixed','Fixed')).rejects.toThrow('verification job')
 await expect(f.reviews.act({...f.owner,agentId:'child'},'review-trigger','decline','No')).rejects.toThrow('root')
 f.host.validWork=()=>false
 await expect(f.reviews.act(f.owner,'review-trigger','decline','No')).rejects.toThrow('ended')
 expect(f.store.deliveries()).toEqual([])
})
it('does not resolve a fixed thread after the verified PR head changes',async()=>{
 const f=fixture();f.store.put('review-action','fixed',{id:'fixed',ticketId:'task',source:'github',number:7,thread:'thread-id',expectedHead:'old',phase:'pending'})
 f.source.read=async()=>({head:'new'} as any)
 await f.reviews.tick();expect(f.resolved).toEqual([]);expect(f.store.get<any>('review-action','fixed').phase).toBe('stale')
})
