import {mkdtempSync,rmSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {afterEach,it,expect} from 'vitest'
import {Store} from '../src/store.ts'
import {Settings} from '../src/settings.ts'
import {configSchema} from '../src/config.ts'
import {Approvals} from '../src/approvals.ts'
const roots:string[]=[],stores:Store[]=[]
function store(){const r=mkdtempSync(join(tmpdir(),'agent-setting-'));roots.push(r);const s=new Store(join(r,'state.db'));stores.push(s);return s}
afterEach(()=>{for(const s of stores.splice(0))s.close();for(const r of roots.splice(0))rmSync(r,{recursive:true,force:true})})
it('preserves prompt versions and refuses stale writes',()=>{
 const s=store(),config=configSchema.parse({sources:[{id:'local',kind:'local',allowedActors:['operator'],cwd:'.'}]})
 const settings=new Settings(s,config)
 settings.save(0,{prompts:{shared:'Use Chinese',router:'',worker:'',delivery:''}})
 expect(settings.history()).toHaveLength(2)
 expect(()=>settings.save(0,{concurrency:3})).toThrow('conflict')
 const restored=new Settings(s,configSchema.parse({sources:[{id:'local',kind:'local',allowedActors:['operator'],cwd:'.'}]}))
 expect(restored.config.prompts.shared).toBe('Use Chinese')
})
it('binds approvals to a live native request and refuses replay',async()=>{
 const s=store(),approvals=new Approvals(s)
 const pending=approvals.request('work',{id:'native-1',method:'item/commandExecution/requestApproval',params:{threadId:'t',turnId:'u',command:'test'}})
 const record=s.list<any>('approval')[0]
 approvals.answer(record.id,'accept')
 await expect(pending).resolves.toEqual({decision:'accept'})
 expect(()=>approvals.answer(record.id,'accept')).toThrow('expired')
 approvals.close()
})
it('expires persisted requests after host restart',async()=>{
 const s=store(),first=new Approvals(s)
 const pending=first.request('work',{id:'n',method:'item/fileChange/requestApproval',params:{}})
 const rejected=pending.catch(e=>e.message)
 first.close()
 expect(await rejected).toBe('Approval expired')
 const second=new Approvals(s)
 expect(s.list<any>('approval')[0].status).toBe('expired')
 second.close()
})

it('rejects prompt overrides that drop environment or policy placeholders',()=>{
 const c={sources:[{id:'local',kind:'local',allowedActors:['operator'],cwd:'.'}]}
 expect(()=>configSchema.parse({...c,prompts:{overrides:{environment:{text:'No variables',base:'a'.repeat(64)}}}})).toThrow('placeholders')
 expect(()=>configSchema.parse({...c,prompts:{overrides:{unknown:{text:'Unknown',base:'a'.repeat(64)}}}})).toThrow()
})
it('reports an upgraded default without discarding the team override',async()=>{
 const {promptStatus,compose}=await import('../src/prompts.ts')
 const config=configSchema.parse({sources:[{id:'local',kind:'local',allowedActors:['operator'],cwd:'.'}],prompts:{overrides:{worker:{text:'Team work instructions',base:'a'.repeat(64)}}}})
 expect(promptStatus(config).find(p=>p.id==='worker')!.defaultChanged).toBe(true)
 expect(compose(config,'worker',{cwd:'.'},'v')).toContain('Team work instructions')
})

it('keeps in-memory settings unchanged when the database commit fails',()=>{
 const s=store(),config=configSchema.parse({sources:[{id:'local',kind:'local',allowedActors:['operator'],cwd:'.'}]}),settings=new Settings(s,config)
 const original=s.db.exec.bind(s.db)
 s.db.exec=(sql:string)=>{if(sql==='COMMIT')throw Error('Injected commit failure');return original(sql)}
 try{
  expect(()=>settings.save(0,{concurrency:4})).toThrow('commit failure')
  expect(config.concurrency).toBe(2)
  expect(settings.current().revision).toBe(0)
 }finally{s.db.exec=original}
})
it('retains transaction rollback after a failed transaction start',()=>{
 const s=store(),original=s.db.exec.bind(s.db)
 s.db.exec=(sql:string)=>{if(sql==='BEGIN IMMEDIATE')throw Error('Injected busy');return original(sql)}
 expect(()=>s.atomic(()=>s.put('test','x',1))).toThrow('busy')
 s.db.exec=original
 expect(()=>s.atomic(()=>{s.put('test','x',1);throw Error('rollback')})).toThrow('rollback')
 expect(s.get('test','x')).toBeUndefined()
})
