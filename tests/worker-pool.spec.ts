import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterEach,it,expect} from 'vitest'
import {configSchema} from '../src/config.ts'
import {Runtime} from '../src/runtime.ts'
import {workerProfiles} from '../src/worker-pool.ts'
import {validateBackendSelection} from '../src/backend-config.ts'
import type {Model,ModelRequest} from '../src/model.ts'

const roots:string[]=[],hosts:Runtime[]=[]
afterEach(async()=>{for(const h of hosts.splice(0))await h.close();for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true})})
function config(count=2){const root=mkdtempSync(join(tmpdir(),'agenthub-workers-'));roots.push(root);return configSchema.parse({stateDir:join(root,'state'),work:{sandboxDriver:'disabled'},backends:{alpha:{kind:'openai-chat',baseUrl:'http://127.0.0.1:9/v1',model:'alpha-default'},beta:{kind:'anthropic',baseUrl:'http://127.0.0.1:9/v1',model:'beta-default'}},execution:{backend:'codex',roles:{router:'alpha'},workers:Array.from({length:count},(_,i)=>({id:'worker-'+(i+1),backend:i%2?'beta':'alpha',model:'model-'+(i+1)}))},sources:[{id:'local',kind:'local',cwd:root,allowedActors:['operator']}]})}
const ready={state:'ready',summary:'Done',reply:'Actual result',question:null,handbacks:[]}
const router=(r:ModelRequest)=>{const input=JSON.parse(r.input);return {threadId:'router-'+Date.now(),turnId:'router-turn',text:JSON.stringify({action:input.trigger?'ignore':'accept',title:input.triggers?.[0]?.text??'',scope:'Reply to this request',reason:'Explicit request',rules:[],ruleAssessments:[],targetTicketId:null})}}
async function ticks(h:Runtime,until:()=>boolean,max=200){for(let i=0;i<max;i++){await h.tick();await new Promise(r=>setTimeout(r,2));if(until())return}throw Error('Worker pool did not settle')}
it('accepts one through ten workers, rejects eleven, duplicates and unavailable services',()=>{
 expect(workerProfiles(config(1))).toHaveLength(1);expect(workerProfiles(config(10))).toHaveLength(10)
 expect(()=>config(11)).toThrow();const c=config();c.execution.workers![1]!.id='worker-1';expect(()=>validateBackendSelection(c)).toThrow('Duplicate worker');c.execution.workers![1]!.id='worker-2';c.execution.workers![1]!.backend='missing';expect(()=>validateBackendSelection(c)).toThrow('Unknown execution backend')
})
it.each([1,2,10])('dispatches %i workers with independent models and queues new requests until a slot is free',async(count)=>{
 const calls:ModelRequest[]=[],release:(()=>void)[]=[],c=config(count),model:Model={async run(r){if(r.ephemeral)return router(r);calls.push(r);const id='worker-thread-'+calls.length;r.onThread?.(id);r.onModel?.(r.model!);r.onTurn?.('turn-'+calls.length);await new Promise<void>(resolve=>{release.push(resolve);r.signal?.addEventListener('abort',()=>resolve(),{once:true})});return {threadId:id,turnId:'done-'+calls.length,text:JSON.stringify(ready)}}}
 const h=new Runtime(c,{model});hosts.push(h);expect(h.config.concurrency).toBe(count)
 for(let i=0;i<count+1;i++)h.receive('local','operator',{id:String(i),thread:'topic-'+i,text:'Request '+i,addressed:true})
 await ticks(h,()=>calls.length===count);for(let i=0;i<10;i++)await h.tick();expect(calls.map(r=>[r.backendId,r.model])).toEqual(c.execution.workers!.map(w=>[w.backend,w.model]));expect(h.store.list<any>('run').filter(r=>r.phase==='running')).toHaveLength(count)
 release[0]!();await ticks(h,()=>calls.length===count+1);expect(calls[count]).toMatchObject({backendId:'alpha',model:'model-1'});release.slice(1).forEach(fn=>fn());await ticks(h,()=>h.store.tickets.list().every(t=>!!t.ended))
})
it('preserves sessions on worker edits and reloads the saved worker pool after restart',async()=>{
 const c=config(1),requests:ModelRequest[]=[],model:Model={async run(r){if(r.ephemeral)return router(r);requests.push(r);const id=r.threadId??'persistent-worker';r.onThread?.(id);return {threadId:id,turnId:'turn-'+requests.length,text:JSON.stringify(ready)}}},h=new Runtime(c,{model});hosts.push(h)
 h.receive('local','operator',{id:'one',thread:'same-topic',text:'Start',addressed:true});await ticks(h,()=>h.store.tickets.list().some(t=>!!t.ended))
 h.updateSettings(0,{execution:{...c.execution,roles:{router:'beta'},workers:[{id:'worker-1',backend:'beta',model:'new-model'}]}})
 h.receive('local','operator',{id:'two',thread:'same-topic',text:'Continue',addressed:true});await ticks(h,()=>requests.length===2&&h.store.tickets.list().every(t=>!!t.ended))
 expect(requests[1]!.threadId).toBe('persistent-worker');expect(requests[1]!.model).toBeUndefined();const native=h.store.list<any>('run')[0].threadId
 await h.close();hosts.splice(hosts.indexOf(h),1);const restored=new Runtime(c,{model});hosts.push(restored);expect(workerProfiles(restored.config)).toMatchObject([{backend:'beta',model:'new-model'}]);expect(restored.store.list<any>('run')[0].threadId).toBe(native)
})
it('does not cancel active work when the worker count is reduced',async()=>{
 const c=config(2),release:(()=>void)[]=[],calls:ModelRequest[]=[],h=new Runtime(c,{model:{async run(r){if(r.ephemeral)return router(r);calls.push(r);r.onThread?.('thread-'+calls.length);r.onTurn?.('turn-'+calls.length);await new Promise<void>(resolve=>{release.push(resolve);r.signal?.addEventListener('abort',()=>resolve(),{once:true})});return {threadId:'thread-'+calls.length,turnId:'done',text:JSON.stringify(ready)}}}});hosts.push(h)
 for(let i=0;i<2;i++)h.receive('local','operator',{id:String(i),thread:'work-'+i,text:'Work '+i,addressed:true});await ticks(h,()=>calls.length===2)
 h.updateSettings(0,{execution:{...c.execution,workers:[c.execution.workers![0]!]}});expect(h.config.concurrency).toBe(1);expect(calls.every(r=>!r.signal?.aborted)).toBe(true)
 h.receive('local','operator',{id:'later',thread:'later',text:'Later',addressed:true});for(let i=0;i<10;i++)await h.tick();expect(calls).toHaveLength(2)
 release[0]!();release[1]!();await ticks(h,()=>calls.length===3);release[2]!();await ticks(h,()=>h.store.tickets.list().every(t=>!!t.ended))
})
