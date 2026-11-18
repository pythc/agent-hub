import {mkdtempSync,rmSync,existsSync,mkdirSync,writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterEach,it,expect} from 'vitest'
import {configSchema} from '../src/config.ts'
import {Store} from '../src/store.ts'
import {backupState,restoreState} from '../src/backup.ts'
import {deliverDraft} from '../src/delivery.ts'
import {Reviews} from '../src/review.ts'
import {GithubSource} from '../src/connectors/github.ts'
const roots:string[]=[]
afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true})})
function fixture(){
 const root=mkdtempSync(join(tmpdir(),'restore-repository-'));roots.push(root)
 const config=configSchema.parse({stateDir:join(root,'state'),sources:[{id:'github',kind:'github',repository:'owner/repo',cwd:root}]})
 const file=join(config.stateDir,'state.sqlite'),backup=join(root,'backup'),current=join(root,'current')
 return {root,config,file,backup,current}
}
const family=['pr-delivery','review-action','merge-attempt','merge-grant'] as const
for(const change of ['insert','update','delete'] as const)it.each(family)(`rejects repository %s ${change} without rolling back live records; current backup remains restorable`,async kind=>{
 const f=fixture(),store=new Store(f.file),before={id:'receipt',ticketId:'task',phase:'pending',enabled:true,head:'old'}
 store.put('sample','unchanged',{value:1})
 if(change!=='insert')store.put(kind,'receipt',before)
 store.close();await backupState(f.config,f.backup)
 const live=new Store(f.file)
 if(change==='delete')live.db.prepare('DELETE FROM records WHERE kind=? AND id=?').run(kind,'receipt')
 else live.put(kind,'receipt',{...before,phase:'uncertain',enabled:false,head:'new'})
 const records=live.db.prepare('SELECT kind,id,body FROM records ORDER BY kind,id').all();live.close()
 await expect(restoreState(f.config,f.backup)).rejects.toThrow('effects advanced after backup')
 const checked=new Store(f.file)
 try{expect(checked.db.prepare('SELECT kind,id,body FROM records ORDER BY kind,id').all()).toEqual(records)}finally{checked.close()}
 expect(existsSync(join(f.config.stateDir,'host.lock'))).toBe(false)
 await backupState(f.config,f.current)
 expect((await restoreState(f.config,f.current)).restored).toBe(true)
 const restored=new Store(f.file)
 try{expect(restored.get(kind,'receipt')).toEqual(change==='delete'?undefined:{...before,phase:'uncertain',enabled:false,head:'new'})}finally{restored.close()}
})
it('preserves a production review resolution even when ticket and run never changed',async()=>{
 const f=fixture(),store=new Store(f.file),source=new GithubSource(f.config.sources[0]!)
 store.tickets.save({id:'task',mandate:{},origin:{triggerIds:[]},inputs:[]} as any)
 store.put('run','task',{ticketId:'task',phase:'idle'})
 store.put('review-action','review',{id:'review',ticketId:'task',source:'github',number:7,thread:'thread',phase:'pending'})
 const ticket=store.tickets.get('task'),run=store.get('run','task');store.close();await backupState(f.config,f.backup)
 const live=new Store(f.file);let resolutions=0
 source.resolveReview=async()=>{resolutions++}
 const reviews=new Reviews({store:live,sources:new Map([['github',source]]),canWrite:()=>true} as any)
 await reviews.tick();await reviews.tick()
 expect(resolutions).toBe(1)
 expect(live.tickets.get('task')).toEqual(ticket);expect(live.get('run','task')).toEqual(run)
 const resolved=live.get('review-action','review');expect(resolved).toMatchObject({phase:'resolved'});live.close()
 await expect(restoreState(f.config,f.backup)).rejects.toThrow('effects advanced after backup')
 const checked=new Store(f.file)
 try{expect(checked.get('review-action','review')).toEqual(resolved)}finally{checked.close()}
 await backupState(f.config,f.current);expect((await restoreState(f.config,f.current)).restored).toBe(true)
 const restored=new Store(f.file)
 try{await new Reviews({store:restored,sources:new Map([['github',source]]),canWrite:()=>true} as any).tick();expect(resolutions).toBe(1)}finally{restored.close()}
})

it('retains uncertain production draft publication after its run returns to the original phase',async()=>{
 const f=fixture(),source=new GithubSource(f.config.sources[0]!),store=new Store(f.file),branch='superagent/test',sha='a'.repeat(40),key='task:'+branch
 const ticket={id:'task',mandate:{actor:{source:'github'}}},run={ticketId:'task',assignmentId:'a',cwd:f.root,phase:'idle'}
 store.tickets.save(ticket as any);store.put('run','task',run)
 store.put('pr-delivery',key,{phase:'pushed',id:'task',branch,sha});store.close()
 await backupState(f.config,f.backup)
 const bin=join(f.root,'bin');mkdirSync(bin)
 // A local deterministic git executable: no transport or external process effect.
 writeFileSync(join(bin,'git'),'#!'+process.execPath+'\nconst args=process.argv.slice(2);if(args.includes("get-url"))console.log('+JSON.stringify(source.code.remotes[0])+');else if(args.includes("--show-current"))console.log('+JSON.stringify(branch)+');else if(args.includes("rev-parse"))console.log('+JSON.stringify(sha)+');else if(!args.includes("status"))process.exit(3)\n',{mode:0o700})
 const live=new Store(f.file),path=process.env.PATH;let creates=0
 source.draft=async()=>{creates++;throw Error('Unconfirmed fixture response')}
 const host:any={store:live,config:f.config,sources:new Map([['github',source]]),canWrite:()=>true,validWork:()=>true,merger:{beforePush:async()=>{}}}
 let receipt:unknown
 try{
  process.env.PATH=bin+':'+path
  await expect(deliverDraft(host,'task','github','Title','Body')).rejects.toThrow('Unconfirmed fixture response')
  expect(live.tickets.get('task')).toEqual(ticket);expect(live.get('run','task')).toEqual(run)
  receipt=live.get('pr-delivery',key);expect(receipt).toMatchObject({phase:'uncertain'})
  await expect(deliverDraft(host,'task','github','Title','Body')).rejects.toThrow('requires reconciliation')
  expect(creates).toBe(1)
 }finally{if(path===undefined)delete process.env.PATH;else process.env.PATH=path;live.close()}
 await expect(restoreState(f.config,f.backup)).rejects.toThrow('effects advanced after backup')
 const checked=new Store(f.file)
 try{expect(checked.get('pr-delivery',key)).toEqual(receipt);expect(checked.get('run','task')).toEqual(run)}finally{checked.close()}
 await backupState(f.config,f.current);expect((await restoreState(f.config,f.current)).restored).toBe(true)
})
