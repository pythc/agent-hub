import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {it,expect,afterEach,vi} from 'vitest'
import {CodexModel,nativeContextProfile} from '../src/codex.ts'
import {BackendRegistry} from '../src/backends/registry.ts'
import {configSchema} from '../src/config.ts'
import {Store} from '../src/store.ts'
import type {ModelRequest} from '../src/model.ts'
const roots:string[]=[],stores:Store[]=[]
afterEach(()=>{vi.restoreAllMocks();for(const s of stores.splice(0))s.close();for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true})})
const directory=()=>{const root=mkdtempSync(join(tmpdir(),'native-context-'));roots.push(root);return root}
it.each([true,false])('scopes the compact context and startup tools to managed calls (%s)',async managed=>{
 const root=directory(),binary=join(root,'codex'),log=join(root,'rpc.jsonl'),argv=join(root,'argv.json')
 writeFileSync(binary,'#!'+process.execPath+`
const fs=require('node:fs');fs.writeFileSync(${JSON.stringify(argv)},JSON.stringify(process.argv.slice(2)));const send=x=>console.log(JSON.stringify(x));
require('node:readline').createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);fs.appendFileSync(${JSON.stringify(log)},line+'\\n');if(!m.id)return;
const result=m.method==='config/read'?{config:{mcp_servers:{},plugins:{}}}:m.method==='thread/start'?{thread:{id:'new'}}:m.method==='mcpServerStatus/list'?{data:[]}:m.method==='turn/start'?{turn:{id:'turn'}}:{};send({id:m.id,result});if(m.method==='turn/start'){send({method:'item/completed',params:{threadId:'new',turnId:'turn',item:{type:'agentMessage',text:'done'}}});send({method:'turn/completed',params:{threadId:'new',turn:{id:'turn',status:'completed'}}})}});
`,{mode:0o700})
 const model=new CodexModel({codex:binary,effort:'high',turnTimeoutMs:10000})
 await model.run({managed,cwd:root,instructions:'CUSTOM_TEAM_RULE_UNCHANGED',input:'test',schema:{}})
 const calls=readFileSync(log,'utf8').trim().split('\n').map(x=>JSON.parse(x)),params=calls.find(c=>c.method==='thread/start').params,args=JSON.parse(readFileSync(argv,'utf8'))
 expect(params.developerInstructions).toBe('CUSTOM_TEAM_RULE_UNCHANGED')
 expect(calls.some(c=>c.method==='thread/compact/start')).toBe(false)
 if(managed){
  expect(params.baseInstructions).toContain('Roppo');expect(params.baseInstructions.length).toBeLessThan(1000)
  expect(params.config.memories).toEqual({use_memories:false,generate_memories:false})
  expect(params.config.skills.include_instructions).toBe(false)
  expect(args).toContain('memories.use_memories=false');expect(args).toContain('skills.include_instructions=false')
  expect(args).not.toContain('code_mode_host')
 }else{expect(params.baseInstructions).toBeUndefined();expect(params.config).toBeUndefined();expect(args).toEqual(['app-server','--stdio'])}
})
it.each(['completed','failed','interrupted'])('awaits confirmed same-thread compaction before inference (%s)',async status=>{
 const root=directory(),binary=join(root,'codex'),log=join(root,'rpc.jsonl'),outputs:any[]=[];let ready=0,tools=0
 writeFileSync(binary,'#!'+process.execPath+`
const fs=require('node:fs'),send=x=>console.log(JSON.stringify(x));let compacted=false;
require('node:readline').createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);fs.appendFileSync(${JSON.stringify(log)},line+'\\n');if(!m.method||!m.id)return;
const result=m.method==='config/read'?{config:{mcp_servers:{},plugins:{}}}:m.method==='thread/resume'?{thread:{id:'old'}}:m.method==='mcpServerStatus/list'?{data:[]}:m.method==='turn/start'?{turn:{id:'task'}}:{};
if(m.method==='turn/start'&&!compacted)return send({id:m.id,error:{code:-1,message:'Compaction not finished'}});
send({id:m.id,result});
if(m.method==='thread/compact/start'){
 send({method:'turn/started',params:{threadId:'old',turn:{id:'compact'}}});
 send({id:999,method:'item/tool/call',params:{tool:'forbidden',arguments:{},callId:'during-compact'}});
 send({method:'item/completed',params:{threadId:'old',turnId:'compact',item:{type:'agentMessage',text:'PRIVATE SUMMARY'}}});
 setTimeout(()=>{send({method:'item/completed',params:{threadId:'old',turnId:'compact',item:{type:'contextCompaction',id:'summary'}}});compacted=true;send({method:'turn/completed',params:{threadId:'old',turn:{id:'compact',status:${JSON.stringify(status)}}}})},30);
}
if(m.method==='turn/start'){send({method:'item/completed',params:{threadId:'old',turnId:'task',item:{type:'agentMessage',text:'done'}}});send({method:'turn/completed',params:{threadId:'old',turn:{id:'task',status:'completed'}}})}
});
`,{mode:0o700})
 const model=new CodexModel({codex:binary,effort:'medium',turnTimeoutMs:10000})
 const promise=model.run({managed:true,threadId:'old',compactBeforeTurn:true,cwd:root,instructions:'keep mandate',input:'continue',schema:{},onContextReady:()=>ready++,onOutput:o=>outputs.push(o),onTool:async()=>{tools++;return {success:true,contentItems:[]}}})
 if(status==='completed')expect(await promise).toEqual({threadId:'old',turnId:'task',text:'done'})
 else await expect(promise).rejects.toThrow('compaction did not complete')
 const calls=readFileSync(log,'utf8').trim().split('\n').map(x=>JSON.parse(x))
 expect(calls.filter(c=>c.method==='thread/resume')).toHaveLength(1);expect(calls.some(c=>c.method==='thread/start')).toBe(false)
 expect(calls.some(c=>c.method==='turn/start')).toBe(status==='completed');expect(ready).toBe(status==='completed'?1:0);expect(tools).toBe(0)
 expect(JSON.stringify(outputs)).not.toContain('PRIVATE SUMMARY')
})
it('checkpoints new and migrated native threads, deferring migration for urgent stop classification',async()=>{
 const root=directory(),config=configSchema.parse({stateDir:root,sources:[{id:'local',kind:'local',allowedActors:['operator'],cwd:root}]}),store=new Store(join(root,'state.sqlite'));stores.push(store)
 const calls:ModelRequest[]=[];let fail=false
 vi.spyOn(CodexModel.prototype,'run').mockImplementation(async r=>{calls.push(r);const threadId=r.threadId??'new';r.onThread?.(threadId);if(fail)throw Error('compaction failed');r.onContextReady?.();return {threadId,turnId:'turn',text:'done'}})
 const backend=new BackendRegistry(config,store),request={managed:true,role:'router' as const,cwd:root,instructions:'original',input:'message',schema:{}}
 await backend.run({...request,threadId:'legacy',skipContextCompaction:true})
 expect(calls.at(-1)?.compactBeforeTurn).toBe(false);expect(store.get('native-context','legacy')).toBeUndefined()
 fail=true;await expect(backend.run({...request,threadId:'legacy'})).rejects.toThrow('failed')
 expect(store.get('native-context','legacy')).toBeUndefined()
 fail=false;await backend.run({...request,threadId:'legacy'})
 expect(calls.at(-1)?.compactBeforeTurn).toBe(true);expect(store.get<any>('native-context','legacy').version).toBe(nativeContextProfile)
 await backend.run({...request,threadId:'legacy'});expect(calls.at(-1)?.compactBeforeTurn).toBe(false)
 await backend.run(request);expect(calls.at(-1)?.compactBeforeTurn).toBe(false);expect(store.get<any>('native-context','new').version).toBe(nativeContextProfile)
})


it('cancels compaction even when abort arrives before turn/started and never starts the task',async()=>{
 const root=directory(),binary=join(root,'codex'),log=join(root,'rpc.jsonl'),controller=new AbortController();let ready=0
 writeFileSync(binary,'#!'+process.execPath+`
const fs=require('node:fs'),send=x=>console.log(JSON.stringify(x));
require('node:readline').createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);fs.appendFileSync(${JSON.stringify(log)},line+'\\n');if(!m.id)return;
const result=m.method==='config/read'?{config:{}}:m.method==='thread/resume'?{thread:{id:'old'}}:m.method==='mcpServerStatus/list'?{data:[]}:{};
send({id:m.id,result});
if(m.method==='thread/compact/start')setTimeout(()=>send({method:'turn/started',params:{threadId:'old',turn:{id:'compact'}}}),100);
if(m.method==='turn/interrupt')send({method:'turn/completed',params:{threadId:'old',turn:{id:'compact',status:'interrupted'}}});
});
`,{mode:0o700})
 const pending=new CodexModel({codex:binary,effort:'medium',turnTimeoutMs:10000}).run({managed:true,threadId:'old',compactBeforeTurn:true,cwd:root,instructions:'test',input:'continue',schema:{},signal:controller.signal,onContextReady:()=>ready++})
 const timer=setInterval(()=>{try{if(readFileSync(log,'utf8').includes('thread/compact/start'))controller.abort()}catch{}},5)
 try{await expect(pending).rejects.toThrow('compaction did not complete')}finally{clearInterval(timer)}
 const calls=readFileSync(log,'utf8').trim().split('\n').map(x=>JSON.parse(x))
 expect(calls.find(c=>c.method==='turn/interrupt')?.params.turnId).toBe('compact')
 expect(calls.some(c=>c.method==='turn/start')).toBe(false);expect(ready).toBe(0)
})
