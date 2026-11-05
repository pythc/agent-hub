import {mkdtempSync,rmSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {it,expect,vi} from 'vitest'
import {Store} from '../src/store.ts'
import {ExecutionActivity} from '../src/execution-activity.ts'
import {Runtime} from '../src/runtime.ts'
import {configSchema} from '../src/config.ts'
import {operatorWorkspace} from '../src/operator-workspace.ts'

it('keeps concurrent calls separate, retains active calls, and never rolls a terminal call back',async()=>{
 const root=mkdtempSync(join(tmpdir(),'agenthub-activity-')),store=new Store(join(root,'state.sqlite')),activity=new ExecutionActivity(store)
 const clock=vi.spyOn(Date,'now').mockReturnValue(1000)
 try{
  const context={ticketId:'ticket',workerId:'w1'},parent=activity.begin('worker','worker',context)
  let finish!:()=>void;const gate=new Promise<void>(r=>finish=r)
  const slow=activity.tool('superagent_read',context,async()=>{await gate;return {success:true}})
  await activity.tool('superagent_read',context,async()=>({success:false}))
  const tools=activity.list().filter(c=>c.kind==='tool');expect(new Set(tools.map(c=>c.id)).size).toBe(2);expect(tools.every(c=>c.parentId===parent)).toBe(true);expect(tools.map(c=>c.state)).toEqual(['running','failed'])
  finish();await slow
  const sentinel=Error('private provider error')
  await expect(activity.tool('superagent_read',context,async()=>{throw sentinel})).rejects.toBe(sentinel)
  activity.finish(parent,'failed');activity.finish(parent,'completed');expect(activity.list().find(c=>c.id===parent)?.state).toBe('failed')
  expect(JSON.stringify(activity.list())).not.toContain(sentinel.message)
  const active=activity.begin('worker','worker',{ticketId:'long-running'})
  for(let n=0;n<205;n++){const id=activity.begin('tool','read-'+n);activity.finish(id,'completed')}
  expect(activity.list().filter(c=>c.state!=='running')).toHaveLength(200);expect(activity.list().find(c=>c.id===active)?.state).toBe('running')
  expect(activity.list().at(-1)?.name).toBe('read-204')
 }finally{clock.mockRestore();store.close();rmSync(root,{recursive:true,force:true})}
})
it('marks retained calls interrupted after a restart without replaying operations',()=>{
 const root=mkdtempSync(join(tmpdir(),'agenthub-activity-restart-'))
 let store=new Store(join(root,'state.sqlite'))
 try{
  const id=new ExecutionActivity(store).begin('tool','superagent_shell',{ticketId:'task'});store.close();store=new Store(join(root,'state.sqlite'))
  const recovered=new ExecutionActivity(store).list().find(c=>c.id===id)!;expect(recovered.state).toBe('interrupted');expect(recovered.endedAt).toBeGreaterThanOrEqual(recovered.startedAt)
 }finally{store.close();rmSync(root,{recursive:true,force:true})}
})
it('projects actual Router, Worker and tool execution without prompts, inputs, output, or credentials',async()=>{
 const root=mkdtempSync(join(tmpdir(),'agenthub-activity-runtime-')),secret='sensitive-tool-argument-and-model-output'
 const config=configSchema.parse({stateDir:join(root,'state'),work:{sandboxDriver:'disabled'},execution:{workers:[{id:'worker-1',backend:'codex'}]},sources:[{id:'local',kind:'local',cwd:root,allowedActors:['operator']}]})
 const host=new Runtime(config,{model:{async run(r){
  r.onBackend?.('codex');r.onModel?.('actual-model');r.onThread?.(r.ephemeral?'router-thread':'worker-thread');r.onTurn?.('turn')
  if(r.ephemeral){await r.onTool!('superagent_read',{resource:'catalog'},'router-read');return {threadId:'router-thread',turnId:'turn',text:JSON.stringify({action:'accept',title:'Activity check',scope:'Read catalog',reason:'Explicit request',rules:[],ruleAssessments:[],targetTicketId:null})}}
  await Promise.all([r.onTool!('superagent_read',{resource:'catalog'},'read-1'),r.onTool!('superagent_read',{resource:'catalog'},'read-2')])
  try{await r.onTool!('superagent_read',{resource:secret,invalid:secret},'invalid')}catch{}
  return {threadId:'worker-thread',turnId:'turn',text:JSON.stringify({state:'ready',summary:secret,reply:secret,question:null,handbacks:[]})}
 }}})
 try{
  const incoming=host.receive('local','operator',{id:'request',thread:'activity-test',text:secret,addressed:true}) as {triggerId:string};host.store.put('entry-client-event',incoming.triggerId,{client:'codex'})
  for(let n=0;n<200;n++){await host.tick();await new Promise(r=>setTimeout(r,2));if(host.store.deliveries().some(d=>d.kind==='reply'&&d.status==='sent'))break}
  expect(host.store.deliveries().some(d=>d.kind==='reply'&&d.status==='sent')).toBe(true)
  const data=operatorWorkspace(host).architecture,records=data.activity
  expect(records.filter(c=>c.kind==='router')).toEqual([expect.objectContaining({state:'completed',entryId:'codex',model:'actual-model'})]);expect(records.filter(c=>c.kind==='worker')).toEqual([expect.objectContaining({state:'completed',workerId:'worker-1'})])
  expect(records.filter(c=>c.kind==='tool')).toHaveLength(4);expect(records.filter(c=>c.kind==='tool'&&c.state==='failed')).toHaveLength(1)
  expect(JSON.stringify(records)).not.toContain(secret);expect(records[0]).not.toHaveProperty('triggerId');expect(records[0]).not.toHaveProperty('sourceId');expect(data.tools).not.toContain('superagent_shell')
 }finally{await host.close();rmSync(root,{recursive:true,force:true})}
})
