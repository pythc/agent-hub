import {mkdtempSync,rmSync,readFileSync,statSync} from 'node:fs'
import {join,relative} from 'node:path'
import {execFileSync} from 'node:child_process'
import {tmpdir} from 'node:os'
import {it,expect,afterEach} from 'vitest'
import {initOffice} from '../src/office.ts'
import {loadConfig} from '../src/config.ts'
import {Runtime} from '../src/runtime.ts'
import {MessageSource} from '../src/sources.ts'
const roots:string[]=[]
afterEach(()=>{for(const p of roots.splice(0))rmSync(p,{recursive:true,force:true})})
it.each(['feishu','wecom'] as const)('creates an isolated %s setup without granting sender access or overwriting credentials',platform=>{
 const root=mkdtempSync(join(tmpdir(),'office-init-'));roots.push(root);const result=initOffice(platform,join(root,'with space'))
 const config=loadConfig(result.config),office=config.sources.find(s=>s.kind===platform)!
 expect(office.allowedActors).toEqual([]);expect(config.sources.find(s=>s.kind==='local')!.allowedActors).toEqual(['operator'])
 expect(readFileSync(result.envFile,'utf8')).not.toContain('synthetic-wecom-secret');expect(statSync(result.envFile).mode&0o777).toBe(0o600)
 execFileSync('git',['init','--quiet',root]);expect(execFileSync('git',['-C',root,'check-ignore',relative(root,result.envFile)],{encoding:'utf8'}).trim()).toBe(relative(root,result.envFile))
 expect(()=>initOffice(platform,join(root,'with space'))).toThrow('not overwritten')
 expect(office.enabled).toBe(platform==='wecom')
})
it('initializes a configured Feishu test chat with an explicit sender',()=>{
 const root=mkdtempSync(join(tmpdir(),'office-feishu-'));roots.push(root);const result=initOffice('feishu',root,'oc_test','ou_test'),config=loadConfig(result.config)
 expect(config.sources[1]).toMatchObject({enabled:true,allowedActors:['ou_test'],feishu:{liveEvents:true,chats:['oc_test']}})
})
it('allows a confirmed sender for future messages without replaying an ignored earlier request',async()=>{
 const root=mkdtempSync(join(tmpdir(),'office-admission-'));roots.push(root);const result=initOffice('wecom',root),config=loadConfig(result.config),source=new MessageSource(config.sources[1]!);source.deliver=async()=>{}
 let calls=0;const host=new Runtime(config,{sources:[source],model:{async run(r){calls++;const threadId=r.threadId??'fixture-thread',turnId='fixture-turn';r.onThread?.(threadId);r.onTurn?.(turnId);return {threadId,turnId,text:JSON.stringify(r.ephemeral?{action:'accept',title:'Test',scope:'Read',reason:'Explicit',rules:[],ruleAssessments:[],targetTicketId:null}:{state:'ready',summary:'Done',reply:'Done',question:null,handbacks:[]})}}}})
 try{
  host.receive('wecom','alice',{id:'old',thread:'single:alice',text:'Read',addressed:true});await host.tick();expect(calls).toBe(0);expect(host.status().observedSenders[0]).toMatchObject({actor:'alice',allowed:false})
  host.updateSettings(0,{sources:config.sources.map(s=>s.id==='wecom'?{...s,allowedActors:['alice']}:s)})
  await host.tick();expect(calls).toBe(0)
  host.receive('wecom','alice',{id:'new',thread:'single:alice',text:'Read',addressed:true})
  for(let i=0;i<60&&!host.store.tickets.list().length;i++){await host.tick();await new Promise(r=>setTimeout(r,5))}
  expect(host.store.tickets.list()).toHaveLength(1);expect(host.status().observedSenders[0]!.allowed).toBe(true)
 }finally{await host.close()}
})
