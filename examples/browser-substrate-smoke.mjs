import {createServer} from 'node:http'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {mkdtemp,writeFile,rm,mkdir,access} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import assert from 'node:assert/strict'
import {WebSocket} from 'ws'

// Research-only browser substrate check. Does not connect to Roppo or any real account.
const exec=promisify(execFile)
const directory=await mkdtemp(join(tmpdir(),'roppo-browser-probe-'))
const evidence=resolve(process.argv[2]||'.local/browser-substrate-evidence')
await mkdir(evidence,{recursive:true})
const config=join(directory,'config.json')
await writeFile(config,'{}')
const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('AGENT_BROWSER_')))
const binary=process.env.ROPPO_BROWSER_PROBE_BIN||'agent-browser'
const systemChrome='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const chrome=process.env.ROPPO_BROWSER_PROBE_CHROME||(process.platform==='darwin'&&await access(systemChrome).then(()=>true,()=>false)?systemChrome:undefined)
const prefix='roppo-probe-'+process.pid
const sessions=['a','b'].map(id=>prefix+'-'+id)
const sockets=[]
const checks=[]
const result={scope:'Browser substrate only; no Router or Worker model execution',checks}
const server=createServer((req,res)=>{
 const url=new URL(req.url,'http://localhost')
 if(url.pathname==='/favicon.ico'){res.writeHead(204);res.end();return}
 const label=url.searchParams.get('worker')==='b'?'b':'a'
 const initialize=url.searchParams.get('restore')==='1'?'':`document.cookie='owner=${label}; Path=/; Max-Age=3600; SameSite=Lax';localStorage.setItem('owner','${label}');sessionStorage.setItem('owner','${label}')`
 res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'})
 res.end(`<!doctype html><html><head><title>Probe ${label}</title><style>body{font:24px system-ui;padding:40px}button,input{font:inherit;margin:16px;padding:12px}</style></head><body><h1>Session ${label}</h1><label>Value<input id="value" aria-label="Value"></label><button id="increment" onclick="document.querySelector('#count').textContent=String(++window.count)">Increment</button><output id="count">0</output><script>window.count=0;${initialize}</script></body></html>`)
})
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
const base='http://127.0.0.1:'+server.address().port
async function call(id,...args){
 const {stdout}=await exec(binary,['--config',config,'--session',id,'--profile',join(directory,id),...(chrome?['--executable-path',chrome]:[]),'--json',...args],{env,cwd:directory,timeout:30000,maxBuffer:4*1024*1024})
 const value=JSON.parse(stdout)
 if(!value.success)throw Error(JSON.stringify(value))
 return value.data
}
async function inspect(id){return call(id,'eval','JSON.stringify({cookie:document.cookie,local:localStorage.getItem("owner"),session:sessionStorage.getItem("owner"),value:document.querySelector("#value").value,count:document.querySelector("#count").textContent,url:location.href})').then(data=>JSON.parse(data.result))}
function passed(name,detail){checks.push({name,passed:true,detail});console.log(name+': passed')}
async function parallel(promises){
 const settled=await Promise.allSettled(promises)
 const failed=settled.find(item=>item.status==='rejected')
 if(failed)throw failed.reason
 return settled.map(item=>item.value)
}
async function stream(id,index){
 const status=await call(id,'stream','status')
 const port=status.port
 assert.equal(typeof port,'number',JSON.stringify(status))
 const socket=new WebSocket('ws://127.0.0.1:'+port,{origin:'http://127.0.0.1'})
 sockets.push(socket)
 const first=await new Promise((resolve,reject)=>{
  const timeout=setTimeout(()=>{socket.terminate();reject(Error('Timed out waiting for frame'))},10000)
  socket.on('error',error=>{clearTimeout(timeout);reject(error)})
  socket.on('message',raw=>{
   const message=JSON.parse(raw)
   if(message.type==='frame'){clearTimeout(timeout);resolve(message)}
  })
 })
 const bytes=Buffer.from(first.data,'base64')
 assert.ok(bytes.length>1000)
 const extension=bytes[0]===0xff?'jpg':'png'
 await writeFile(join(evidence,`session-${index}.${extension}`),bytes)
 return {socket,port,bytes:bytes.length,width:first.metadata.deviceWidth,height:first.metadata.deviceHeight}
}
try{
 result.version=(await exec(binary,['--version'],{env})).stdout.trim()
 await parallel(sessions.map((id,i)=>call(id,'open',base+'/?worker='+['a','b'][i])))
 await parallel(sessions.map((id,i)=>call(id,'fill','#value','value-'+i)))
 const [a,b]=await parallel(sessions.map(inspect))
 assert.equal(a.cookie,'owner=a');assert.equal(b.cookie,'owner=b')
 assert.equal(a.local,'a');assert.equal(b.local,'b')
 assert.equal(a.session,'a');assert.equal(b.session,'b')
 assert.equal(a.value,'value-0');assert.equal(b.value,'value-1')
 passed('Concurrent sessions isolate cookies, localStorage, sessionStorage and input values')
 const snapshots=await parallel(sessions.map(id=>call(id,'snapshot','-i')))
 assert.ok(snapshots.every(s=>JSON.stringify(s).includes('Increment')))
 passed('Structured interactive snapshots contain the page controls')
 await call(sessions[0],'click','#increment')
 assert.equal((await inspect(sessions[0])).count,'1');assert.equal((await inspect(sessions[1])).count,'0')
 passed('An automated click in session A does not click session B')
 const streams=await parallel(sessions.map(stream))
 assert.notEqual(streams[0].port,streams[1].port)
 passed('Independent WebSocket streams deliver real browser frames',streams.map(({port,bytes,width,height})=>({port,bytes,width,height})))
 const boxResult=await call(sessions[1],'get','box','#increment')
 const box=boxResult
 assert.equal(typeof box.x,'number','Missing bounding box: '+JSON.stringify(boxResult))
 for(const eventType of ['mousePressed','mouseReleased'])streams[1].socket.send(JSON.stringify({type:'input_mouse',eventType,x:box.x+box.width/2,y:box.y+box.height/2,button:'left',clickCount:1}))
 await call(sessions[1],'wait','--fn','window.count === 1')
 assert.equal((await inspect(sessions[0])).count,'1')
 passed('Remote mouse input reaches only its selected browser')
 await call(sessions[0],'tab','new',base+'/?worker=a&tab=2')
 const tabs=await parallel(sessions.map(id=>call(id,'tab','list')))
 assert.equal(tabs[0].tabs.length,2);assert.equal(tabs[1].tabs.length,1)
 passed('Opening a tab in session A leaves session B unchanged')
 sockets.forEach(socket=>socket.close())
 await call(sessions[0],'close')
 await call(sessions[1],'click','#increment')
 assert.equal((await inspect(sessions[1])).count,'2')
 passed('Closing session A leaves session B operable')
 await call(sessions[0],'open',base+'/?worker=a&restore=1')
 const restored=await inspect(sessions[0])
 assert.equal(restored.cookie,'owner=a');assert.equal(restored.local,'a')
 assert.equal((await inspect(sessions[1])).count,'2')
 passed('Reopening the same profile preserves persistent cookies and localStorage without reseeding')
 result.passed=true
}catch(error){result.passed=false;result.error=String(error);process.exitCode=1;console.error(error)}
finally{
 sockets.forEach(socket=>socket.terminate())
 const cleanup=await Promise.allSettled(sessions.map(id=>call(id,'close')))
 result.cleanup=cleanup.map((entry,index)=>({session:['a','b'][index],closed:entry.status==='fulfilled'}))
 if(cleanup.some(entry=>entry.status==='rejected')){result.passed=false;process.exitCode=1}
 await new Promise(resolve=>server.close(resolve))
 if(cleanup.every(entry=>entry.status==='fulfilled'))await rm(directory,{recursive:true,force:true})
 await writeFile(join(evidence,'substrate-result.json'),JSON.stringify(result,null,2)+'\n')
}
