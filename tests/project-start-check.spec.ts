import {expect,it} from 'vitest'
import {spawn} from 'node:child_process'
import {createServer} from 'node:http'
import {projectStartCommand} from '../src/project-start-check.ts'
const quote=(s:string)=>"'"+s.replaceAll("'","'\"'\"'")+"'"
async function port(){const server=createServer();await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const p=(server.address() as {port:number}).port;await new Promise<void>(r=>server.close(()=>r()));return p}
async function run(command:string,url:string){
 const child=spawn('/bin/sh',['-c',projectStartCommand({command,url,timeoutMs:600})],{detached:true,stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',c=>output+=c);child.stderr.on('data',c=>output+=c)
 try{return await new Promise<{exit:number|null;output:string}>((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('wrapper hung')),4000);child.once('close',exit=>{clearTimeout(timer);resolve({exit,output})})})}finally{if(child.pid)try{process.kill(-child.pid,'SIGKILL')}catch{}}
}
const service=(p:number,body:string)=>'exec node -e '+quote(`require('node:http').createServer((req,res)=>res.end(${body})).listen(${p},'127.0.0.1')`)
it('requires a live service responding with the instance token',async()=>{
 const p=await port();expect((await run(service(p,'process.env.AGENT_HUB_START_CHECK_TOKEN'),`http://127.0.0.1:${p}`)).exit).toBe(0)
})
it('rejects command success without readiness and a wrong-token service',async()=>{
 const p=await port();expect((await run('exec true',`http://127.0.0.1:${p}`)).exit).toBe(1)
 expect((await run(service(p,JSON.stringify('not-the-token')),`http://127.0.0.1:${p}`)).exit).toBe(1)
})
it('rejects an already listening endpoint before launching a process',async()=>{
 const server=createServer((_req,res)=>res.end('preexisting'));await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));try{const p=(server.address() as {port:number}).port;expect((await run('exec echo SHOULD_NOT_RUN',`http://127.0.0.1:${p}`)).output).not.toContain('SHOULD_NOT_RUN')}finally{await new Promise<void>(r=>server.close(()=>r()))}
})
it('rejects nonloopback and redirect response without following it',async()=>{
 expect((await run('exec true','http://example.com')).exit).toBe(1)
 const p=await port(),command='exec node -e '+quote(`require('node:http').createServer((req,res)=>{res.writeHead(302,{location:'http://example.com'});res.end(process.env.AGENT_HUB_START_CHECK_TOKEN)}).listen(${p},'127.0.0.1')`)
 expect((await run(command,`http://127.0.0.1:${p}`)).exit).toBe(1)
})

import {mkdtempSync,readFileSync,rmSync,existsSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
it('rejects a detached service surviving the foreground process and cleans the fixture',async()=>{
 const root=mkdtempSync(join(tmpdir(),'start-detached-')),pidFile=join(root,'pid'),p=await port()
 const serviceScript=`require('http').createServer((q,s)=>s.end(process.env.AGENT_HUB_START_CHECK_TOKEN)).listen(${p},'127.0.0.1')`
 const script=`const c=require('child_process').spawn(process.execPath,['-e',${JSON.stringify(serviceScript)}],{detached:true,stdio:'ignore',env:process.env});require('fs').writeFileSync(${JSON.stringify(pidFile)},String(c.pid));c.unref();setInterval(()=>{},1000)`
 try{const result=await run('exec node -e '+quote(script),`http://127.0.0.1:${p}`);expect(result.exit).toBe(1);expect(result.output).toContain('remained reachable')}
 finally{if(existsSync(pidFile)){const pid=Number(readFileSync(pidFile,'utf8'));try{process.kill(-pid,'SIGKILL')}catch{}}rmSync(root,{recursive:true,force:true})}
})
