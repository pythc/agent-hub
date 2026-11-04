import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {it,expect,afterEach} from 'vitest'
import {CodexModel} from '../src/codex.ts'
const roots:string[]=[]
const originalEnvFile=process.env.AGENTHUB_ENV_FILE
afterEach(()=>{for(const r of roots.splice(0))rmSync(r,{recursive:true,force:true});if(originalEnvFile===undefined)delete process.env.AGENTHUB_ENV_FILE;else process.env.AGENTHUB_ENV_FILE=originalEnvFile})
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
