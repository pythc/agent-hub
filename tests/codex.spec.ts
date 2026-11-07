import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {it,expect,afterEach} from 'vitest'
import {CodexModel,nativeProtocolHistory} from '../src/codex.ts'
const roots:string[]=[]
const originalEnvFile=process.env.AGENTHUB_ENV_FILE
afterEach(()=>{for(const r of roots.splice(0))rmSync(r,{recursive:true,force:true});if(originalEnvFile===undefined)delete process.env.AGENTHUB_ENV_FILE;else process.env.AGENTHUB_ENV_FILE=originalEnvFile})
it('budgets native response items and system tools without counting duplicate telemetry',()=>{
 const root=mkdtempSync(join(tmpdir(),'native-budget-'));roots.push(root);const path=join(root,'history.jsonl')
 writeFileSync(path,[{type:'session_meta',payload:{base_instructions:{text:'base'},dynamic_tools:[{name:'host_tool'}]}},{type:'response_item',payload:{type:'additional_tools',tools:[{name:'native_tool',description:'native definition'}]}},{type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text:'current request'}]}},{type:'event_msg',payload:{type:'user_message',text:'duplicate telemetry'}},{type:'world_state',payload:{text:'duplicate world'}}].map(x=>JSON.stringify(x)).join('\n')+'\n')
 const h=JSON.stringify(nativeProtocolHistory(path));expect(h).toContain('base');expect(h).toContain('native definition');expect(h).toContain('current request');expect(h).not.toContain('duplicate')
})
it('verifies native deletion and treats retry after successful deletion as idempotent',async()=>{
 const root=mkdtempSync(join(tmpdir(),'native-delete-'));roots.push(root);const binary=join(root,'codex'),history=join(root,'rollout.jsonl');writeFileSync(history,'owned history')
 writeFileSync(binary,'#!'+process.execPath+`\nconst fs=require('node:fs');const file=${JSON.stringify(history)};require('node:readline').createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);if(!m.id)return;const send=result=>console.log(JSON.stringify({id:m.id,result}));if(m.method==='thread/read'){if(fs.existsSync(file))return send({thread:{id:'owned',path:file}});return console.log(JSON.stringify({id:m.id,error:{code:-32600,message:'thread not loaded: owned'}}))}if(m.method==='thread/delete'){if(!fs.existsSync(file))return console.log(JSON.stringify({id:m.id,error:{code:-32600,message:'no rollout found for thread id owned'}}));fs.unlinkSync(file)}send({})})\n`,{mode:0o700})
 const m=new CodexModel({codex:binary,effort:'medium',turnTimeoutMs:5000})
 expect(await m.purge('owned',root)).toEqual({local:'verified',provider:'not_managed'})
 expect(await m.purge('owned',root)).toEqual({local:'verified',provider:'not_managed'})
})

it.each([true,false])('refreshes a native Router or fails closed when MCP discovery is missing (discovered: %s)',async discovered=>{
 const root=mkdtempSync(join(tmpdir(),'native-router-tools-'));roots.push(root)
 const binary=join(root,'codex'),log=join(root,'rpc.jsonl'),invoked:string[]=[]
 writeFileSync(binary,'#!'+process.execPath+`\nconst fs=require('node:fs');let bridge;const discovered=${JSON.stringify(discovered)};const send=x=>console.log(JSON.stringify(x));const rpc=async(method,params)=>{const res=await fetch(bridge.url,{method:'POST',headers:{...bridge.http_headers,'content-type':'application/json',accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});const data=await res.json();if(data.error)throw Error(data.error.message);return data.result};require('node:readline').createInterface({input:process.stdin}).on('line',async line=>{const m=JSON.parse(line);fs.appendFileSync(${JSON.stringify(log)},line+'\\n');if(!m.id)return;try{let result={};if(m.method==='config/read')result={config:{mcp_servers:{old:{command:'unused'}},plugins:{}}};if(m.method==='thread/start')throw Error('Must preserve native Router identity');if(m.method==='thread/resume'){bridge=m.params.config.mcp_servers['roppo-router'];result={thread:{id:'existing-router'}}}if(m.method==='mcpServerStatus/list'){const list=await rpc('tools/list',{});result={data:discovered?[{name:'roppo-router',tools:Object.fromEntries(list.tools.map(t=>[t.name,t]))}]:[]}}if(m.method==='turn/start')result={turn:{id:'followup-turn'}};send({id:m.id,result});if(m.method==='turn/start'){await rpc('tools/call',{name:'orchestrator_followup_stop',arguments:{ticketId:'owned'}});send({method:'item/completed',params:{threadId:'existing-router',item:{type:'agentMessage',text:'{"reply":"stopped"}'}}});send({method:'turn/completed',params:{threadId:'existing-router',turn:{id:'followup-turn',status:'completed'}}})}}catch(error){send({id:m.id,error:{code:-32603,message:String(error)}})}})\n`,{mode:0o700})
 const model=new CodexModel({codex:binary,effort:'medium',turnTimeoutMs:10000})
 const pending=model.run({cwd:root,instructions:'Stop only the reached task',input:'stop',schema:{},role:'router',managed:true,threadId:'existing-router',tools:[{type:'function',name:'orchestrator_followup_stop',description:'Stop',inputSchema:{type:'object'}}],onTool:async(name)=>{invoked.push(name);return {success:true,contentItems:[{type:'inputText',text:'stopped'}]}}})
 if(discovered)await expect(pending).resolves.toMatchObject({threadId:'existing-router',turnId:'followup-turn'})
 else await expect(pending).rejects.toThrow('Current Router tools are unavailable')
 expect(invoked).toEqual(discovered?['orchestrator_followup_stop']:[])
 const calls=readFileSync(log,'utf8').trim().split('\n').map(s=>JSON.parse(s)),resume=calls.find(c=>c.method==='thread/resume')
 expect(calls.filter(c=>c.method==='thread/resume')).toHaveLength(1)
 expect(calls.some(c=>c.method==='turn/start')).toBe(discovered)
 expect(resume.params.config.mcp_servers.old).toEqual({enabled:false})
 expect(resume.params.config.mcp_servers['roppo-router'].required).toBe(true)
 expect(resume.params.developerInstructions).toContain('current tools and schemas')
 await expect(fetch(resume.params.config.mcp_servers['roppo-router'].url)).rejects.toThrow()
})
it('forwards scoped native assistant deltas before terminal and keeps commentary separate',async()=>{
 const root=mkdtempSync(join(tmpdir(),'native-stream-'));roots.push(root);const binary=join(root,'codex'),events:any[]=[]
 writeFileSync(binary,'#!'+process.execPath+`\nconst send=x=>console.log(JSON.stringify(x));require('node:readline').createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);if(!m.id)return;send({id:m.id,result:m.method==='thread/start'?{thread:{id:'native'}}:m.method==='turn/start'?{turn:{id:'turn'}}:{}});if(m.method==='turn/start'){const event=(method,p)=>send({method,params:{threadId:'native',turnId:'turn',...p}});event('item/started',{item:{id:'c',type:'agentMessage',phase:'commentary'}});event('item/agentMessage/delta',{itemId:'c',delta:'Public progress'});event('item/started',{item:{id:'a',type:'agentMessage',phase:'final_answer'}});event('item/agentMessage/delta',{itemId:'a',delta:'first'});event('item/agentMessage/delta',{threadId:'other',itemId:'a',delta:'foreign'});event('item/agentMessage/delta',{turnId:'older',itemId:'a',delta:'stale'});event('item/reasoning/textDelta',{itemId:'r',delta:'private'});setTimeout(()=>{event('item/agentMessage/delta',{itemId:'a',delta:' second'});event('item/completed',{item:{id:'a',type:'agentMessage',phase:'final_answer',text:'first second'}});event('turn/completed',{turn:{id:'turn',status:'completed'}})},30)}})\n`,{mode:0o700})
 const model=new CodexModel({codex:binary,effort:'high',turnTimeoutMs:10000});let settled=false
 const pending=model.run({cwd:root,instructions:'test',input:'test',schema:{},onOutput:e=>{events.push(e);if(e.type==='delta')expect(settled).toBe(false)}}).then(r=>{settled=true;return r})
 expect((await pending).text).toBe('first second')
 expect(events.filter(e=>e.type==='delta'&&e.phase==='answer').map(e=>e.text).join('')).toBe('first second')
 expect(events.some(e=>e.phase==='commentary')).toBe(true)
 expect(JSON.stringify(events)).not.toContain('private')
})
it('confirms a steered source input from native history, not the RPC acknowledgement',async()=>{
 const root=mkdtempSync(join(tmpdir(),'native-inbox-'));roots.push(root)
 const binary=join(root,'codex');let consumed=0,acknowledgedBeforeRead=false
 writeFileSync(binary,'#!'+process.execPath+`\nconst send=x=>console.log(JSON.stringify(x));require('node:readline').createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);if(!m.id)return;const result=m.method==='thread/start'?{thread:{id:'native-inbox'}}:m.method==='turn/start'?{turn:{id:'turn-inbox'}}:{};send({id:m.id,result});if(m.method==='turn/steer'){setTimeout(()=>{const item={type:'userMessage',content:m.params.input};for(const method of ['item/started','item/completed'])send({method,params:{threadId:'native-inbox',item}});send({method:'item/completed',params:{threadId:'native-inbox',item:{type:'agentMessage',text:'corrected'}}});send({method:'turn/completed',params:{threadId:'native-inbox',turn:{id:'turn-inbox',status:'completed'}}})},30)}})\n`,{mode:0o700})
 const model=new CodexModel({codex:binary,effort:'high',turnTimeoutMs:10000})
 const result=await model.run({cwd:root,instructions:'test',input:'start',schema:{},onActive:control=>{
  void control.steer('source input',()=>{consumed++}).then(()=>{acknowledgedBeforeRead=consumed===0})
 }})
 expect(acknowledgedBeforeRead).toBe(true);expect(consumed).toBe(1);expect(result.text).toBe('corrected')
})
it('waits for a native writer to release, resuming the same thread without forking',async()=>{
 const root=mkdtempSync(join(tmpdir(),'native-protocol-'));roots.push(root)
 const binary=join(root,'codex'),log=join(root,'rpc.jsonl')
 writeFileSync(binary,'#!'+process.execPath+`\nconst fs=require('node:fs');let resumes=0;const send=x=>console.log(JSON.stringify(x));require('node:readline').createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);fs.appendFileSync(${JSON.stringify(log)},line+'\\n');if(!m.id)return;if(m.method==='thread/resume'&&++resumes===1)return send({id:m.id,error:{code:-32600,message:'thread native-a already has an active writer'}});const result=m.method==='thread/resume'?{thread:{id:'native-a'}}:m.method==='turn/start'?{turn:{id:'turn-b'}}:{};send({id:m.id,result});if(m.method==='turn/start'){send({method:'item/completed',params:{threadId:'native-a',item:{type:'agentMessage',text:'done'}}});send({method:'turn/completed',params:{threadId:'native-a',turn:{id:'turn-b',status:'completed'}}})}})\n`,{mode:0o700})
 const events:string[]=[]
 const model=new CodexModel({codex:binary,model:'test',effort:'high',turnTimeoutMs:10000})
 const result=await model.run({cwd:root,instructions:'test',input:'continue',schema:{},threadId:'native-a',archiveOnComplete:true,onProgress:e=>events.push(e)})
 const calls=readFileSync(log,'utf8').trim().split('\n').map(s=>JSON.parse(s))
 expect(calls.filter(c=>c.method==='thread/resume')).toHaveLength(2)
 expect(calls.find(c=>c.method==='thread/resume').params.model).toBeUndefined()
 expect(calls.some(c=>c.method==='thread/start')).toBe(false)
 expect(calls.at(-1).method).toBe('thread/archive')
 expect(events).toContain('thread/waitingForWriter')
 expect(result).toEqual({threadId:'native-a',turnId:'turn-b',text:'done'})
})
it('does not create invalid startup entries for absent MCP aliases and disables only actual managed capabilities',async()=>{
 const root=mkdtempSync(join(tmpdir(),'native-config-'));roots.push(root)
 const envFile=join(root,'credentials.env');writeFileSync(envFile,'SYNTHETIC_ONLY=1');process.env.AGENTHUB_ENV_FILE=envFile
 const binary=join(root,'codex'),log=join(root,'rpc.jsonl')
 writeFileSync(binary,'#!'+process.execPath+`\nconst fs=require('node:fs');if(process.argv.slice(2).some(x=>x.startsWith('mcp_servers.')))process.exit(1);const send=x=>console.log(JSON.stringify(x));require('node:readline').createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);fs.appendFileSync(${JSON.stringify(log)},line+'\\n');if(!m.id)return;const result=m.method==='config/read'?{config:{mcp_servers:{existing:{command:'safe'}},plugins:{example:{enabled:true}}}}:m.method==='thread/start'?{thread:{id:'native-managed'}}:m.method==='mcpServerStatus/list'?{data:[]}:m.method==='turn/start'?{turn:{id:'turn-managed'}}:{};send({id:m.id,result});if(m.method==='turn/start'){send({method:'item/completed',params:{threadId:'native-managed',item:{type:'agentMessage',text:'done'}}});send({method:'turn/completed',params:{threadId:'native-managed',turn:{id:'turn-managed',status:'completed'}}})}})\n`,{mode:0o700})
 const model=new CodexModel({codex:binary,effort:'high',turnTimeoutMs:10000})
 await expect(model.run({cwd:root,instructions:'test',input:'test',schema:{},managed:true})).resolves.toMatchObject({text:'done'})
 const calls=readFileSync(log,'utf8').trim().split('\n').map(s=>JSON.parse(s)),config=calls.find(c=>c.method==='thread/start').params.config
 expect(config.mcp_servers).toEqual({existing:{enabled:false}})
 expect(config.plugins).toEqual({example:{enabled:false}})
 expect(config.features.shell_tool).toBe(false)
 expect(config.permissions['superagent-managed'].filesystem[envFile]).toBe('deny')
})

it('binds native output to the acknowledged turn even when notifications share its stdout chunk',async()=>{
 const root=mkdtempSync(join(tmpdir(),'native-batched-stream-'));roots.push(root);const binary=join(root,'codex'),events:any[]=[]
 writeFileSync(binary,'#!'+process.execPath+`\nconst send=x=>process.stdout.write(JSON.stringify(x)+'\\n');require('node:readline').createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);if(!m.id)return;if(m.method!=='turn/start'){send({id:m.id,result:m.method==='thread/start'?{thread:{id:'native'}}:{}});return}const e=(method,params)=>({method,params:{threadId:'native',turnId:'current',...params}});const batch=[e('item/started',{turnId:'previous',item:{id:'old',type:'agentMessage',phase:'final_answer'}}),e('item/agentMessage/delta',{turnId:'previous',itemId:'old',delta:'before-ack-stale'}),{id:m.id,result:{turn:{id:'current'}}},e('item/started',{item:{id:'answer',type:'agentMessage',phase:'final_answer'}}),e('turn/started',{turn:{id:'previous'}}),e('item/agentMessage/delta',{turnId:'previous',itemId:'answer',delta:'after-ack-stale'}),e('item/agentMessage/delta',{itemId:'answer',delta:'correct'}),e('item/completed',{item:{id:'answer',type:'agentMessage',phase:'final_answer',text:'correct'}}),e('turn/completed',{turn:{id:'current',status:'completed'}})];process.stdout.write(batch.map(JSON.stringify).join('\\n')+'\\n')})\n`,{mode:0o700})
 const model=new CodexModel({codex:binary,effort:'high',turnTimeoutMs:10000})
 await expect(model.run({cwd:root,instructions:'test',input:'test',schema:{},onOutput:e=>events.push(e)})).resolves.toMatchObject({text:'correct',turnId:'current'})
 expect(events.filter(e=>e.type==='delta').map(e=>e.text).join('')).toBe('correct')
 expect(JSON.stringify(events)).not.toContain('stale')
})
