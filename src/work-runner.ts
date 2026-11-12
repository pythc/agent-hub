import {spawn} from 'node:child_process'
import {readFileSync,writeFileSync,renameSync,openSync,writeSync,closeSync,mkdtempSync,rmSync} from 'node:fs'
import {delimiter,join} from 'node:path'
import {tmpdir} from 'node:os'
import {sandboxCommand} from './sandbox.ts'
const spec=JSON.parse(readFileSync(process.argv[2]!,'utf8'))
const output=openSync(join(spec.directory,spec.id+'.output'),'a',0o600)
let bytes=0,droppedBytes=0,stopping=false,killTimer:ReturnType<typeof setTimeout>|undefined
const scratch=mkdtempSync(join(tmpdir(),'agenthub-job-'))
let launch:ReturnType<typeof sandboxCommand>
try{launch=sandboxCommand({...spec,scratch})}catch(error){closeSync(output);rmSync(scratch,{recursive:true,force:true});throw error}
const env=Object.fromEntries(['PATH','USER','LOGNAME','LANG','LC_ALL','SYSTEMROOT','SystemRoot'].filter(key=>process.env[key]!==undefined).map(key=>[key,process.env[key]!]))
Object.assign(env,{HOME:scratch,TMPDIR:scratch,TMP:scratch,TEMP:scratch})
// Keep higher-priority tools and bypass Apple's shim, which writes a cache outside the job's temp directory.
if(launch.developerBin&&env.PATH){
 const paths=env.PATH.split(delimiter)
 const systemBin=paths.indexOf('/usr/bin')
 if(systemBin>=0){
  paths.splice(systemBin,0,launch.developerBin)
  env.PATH=paths.join(delimiter)
 }
}
const child=spawn(launch.command,launch.args,{cwd:spec.cwd,env,stdio:['ignore','pipe','pipe'],shell:false})

const append=(chunk:Buffer)=>{const count=Math.min(chunk.length,Math.max(0,spec.maxOutputBytes-bytes));if(count)writeSync(output,chunk.subarray(0,count));bytes+=count;droppedBytes+=chunk.length-count}
child.stdout.on('data',append);child.stderr.on('data',append)
const stop=()=>{
 if(stopping)return;stopping=true
 try{process.platform==='win32'?child.kill('SIGTERM'):process.kill(-process.pid,'SIGTERM')}catch{}
 killTimer=setTimeout(()=>{try{process.platform==='win32'?child.kill('SIGKILL'):process.kill(-process.pid,'SIGKILL')}catch{}},2000)
}
process.on('SIGTERM',stop);process.on('SIGINT',stop)
const monitor=setInterval(()=>{try{process.kill(spec.hostPid,0);if(readFileSync(spec.hostLock,'utf8').trim()!==String(spec.hostPid))stop()}catch{stop()}},300)
let failure:string|undefined
child.once('error',error=>{failure=String(error)})
child.once('close',(exitCode,signal)=>{
 clearInterval(monitor);if(killTimer)clearTimeout(killTimer);closeSync(output);rmSync(scratch,{recursive:true,force:true})
 const destination=join(spec.directory,spec.id+'.result.json'),temporary=destination+'.new'
 writeFileSync(temporary,JSON.stringify({id:spec.id,exitCode,signal,endedAt:Date.now(),bytes,droppedBytes,...(failure?{error:failure}:{})}),{mode:0o600});renameSync(temporary,destination)
})
