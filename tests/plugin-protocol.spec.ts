import {it,expect} from 'vitest'
import {spawn} from 'node:child_process'
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {createInterface} from 'node:readline'
import {fileURLToPath} from 'node:url'
const delay=(ms:number)=>new Promise(r=>setTimeout(r,ms))
async function protocol(run:(h:{frames:any[];send:(v:any)=>void;until:(f:()=>boolean)=>Promise<void>})=>Promise<void>){
 const dir=mkdtempSync(join(tmpdir(),'plugin-wire-')),module=join(dir,'plugin.mjs')
 writeFileSync(module,`export default {create:()=>({config:{},start(ctx){this.ctx=ctx},poll(ctx){ctx.store.put('plugin-state','count',1);setImmediate(async()=>{await ctx.checkpoint();process.stdout.write(JSON.stringify({type:'platform-ack'})+'\\n')})},async read({resource}){if(resource==='query-race'){setTimeout(()=>{this.ctx.store.put('source-message-observation','test:message',1);process.stdout.write(JSON.stringify({type:'local-write'})+'\\n')},20);const page=await this.ctx.records('source-message-observation',{ids:['test:message']});return page.items[0].value}if(resource==='arm'){setTimeout(()=>this.ctx.store.put('plugin-state','count',1),20);return true}const n=this.ctx.store.get('plugin-state','count')+1;this.ctx.store.put('plugin-state','count',n);return n}})}`)
 const child=spawn(process.execPath,[fileURLToPath(new URL('../src/plugin-worker.mjs',import.meta.url))],{stdio:['pipe','pipe','pipe']}),frames:any[]=[]
 child.stderr.resume();const lines=createInterface({input:child.stdout});lines.on('line',l=>frames.push(JSON.parse(l)))
 const send=(v:any)=>child.stdin.write(JSON.stringify(v)+'\n'),until=async(f:()=>boolean)=>{for(let i=0;i<200&&!f();i++)await delay(5);expect(f()).toBe(true)}
 try{send({type:'init',id:1,module,config:{}});await until(()=>frames.some(f=>f.id===1));send({type:'call',id:2,method:'start',snapshot:[],stateAck:0});await until(()=>frames.some(f=>f.type==='result'&&f.id===2));frames.length=0;await run({frames,send,until})}
 finally{child.kill('SIGKILL');lines.close();rmSync(dir,{recursive:true,force:true})}
}
it('holds the method result and platform acknowledgement until its event batch is committed',async()=>protocol(async({frames,send,until})=>{
 send({type:'call',id:3,method:'poll',snapshot:[],stateAck:0});await until(()=>frames.some(f=>f.type==='events'));await delay(40)
 expect(frames.some(f=>f.type==='result'||f.type==='platform-ack')).toBe(false)
 for(const frame of frames.filter(f=>f.type==='events'))send({type:'ack',id:frame.id})
 await until(()=>frames.some(f=>f.type==='platform-ack')&&frames.some(f=>f.type==='result'&&f.id===3))
}))
it('merges live writes omitted by a host snapshot using its committed event watermark',async()=>protocol(async({frames,send,until})=>{
 send({type:'call',id:3,method:'read',args:[{resource:'arm'}],snapshot:[],stateAck:0});await until(()=>frames.some(f=>f.type==='events'))
 send({type:'call',id:4,method:'read',args:[{resource:'increment'}],snapshot:[{kind:'plugin-state',id:'count',value:0}],stateAck:0})
 await until(()=>frames.filter(f=>f.type==='events').length===2)
 for(const frame of frames.filter(f=>f.type==='events'))send({type:'ack',id:frame.id})
 await until(()=>frames.some(f=>f.type==='result'&&f.id===4));expect(frames.find(f=>f.type==='result'&&f.id===4).result).toBe(2)
}))

it('does not let a delayed record response overwrite a later local event observation',async()=>protocol(async({frames,send,until})=>{
 send({type:'call',id:3,method:'read',args:[{resource:'query-race'}],snapshot:[{kind:'source-message-observation',id:'test:message',value:0}],stateAck:0})
 await until(()=>frames.some(f=>f.type==='records')&&frames.some(f=>f.type==='local-write'))
 const query=frames.find(f=>f.type==='records');send({type:'records-result',id:query.id,stateAck:0,result:{items:[{id:'test:message',value:0}]}})
 await until(()=>frames.some(f=>f.type==='events'));for(const frame of frames.filter(f=>f.type==='events'))send({type:'ack',id:frame.id})
 await until(()=>frames.some(f=>f.type==='result'&&f.id===3));expect(frames.find(f=>f.type==='result'&&f.id===3).result).toBe(1)
}))
