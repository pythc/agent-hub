import {spawn} from 'node:child_process'
import {readFileSync,writeFileSync,renameSync,openSync,writeSync,closeSync} from 'node:fs'
import {join} from 'node:path'
const spec=JSON.parse(readFileSync(process.argv[2]!,'utf8'))
const output=openSync(join(spec.directory,spec.id+'.output'),'a',0o600)
let bytes=0,droppedBytes=0,stopping=false,killTimer:ReturnType<typeof setTimeout>|undefined
const profile='superagent-managed'
const entries:Record<string,string>={':root':'deny',':minimal':'read','/opt/homebrew':'read',':tmpdir':'write',':slash_tmp':'write',[spec.cwd]:spec.sandbox==='read-only'?'read':'write'}
if(spec.privateState)entries[spec.privateState]='deny'
if(spec.gitDirectory)entries[spec.gitDirectory]='read'
for(const attachment of spec.attachments??[])entries[attachment]='read'
const args=['sandbox','-P',profile,'-c','permissions.'+profile+'.extends='+JSON.stringify(spec.sandbox==='read-only'?':read-only':':workspace'),'-c','permissions.'+profile+'.network.enabled='+String(spec.network)]
args.push('-c','permissions.'+profile+'.filesystem={'+Object.entries(entries).map(([path,access])=>JSON.stringify(path)+'='+JSON.stringify(access)).join(',')+'}')
args.push('-C',spec.cwd,'--',process.platform==='win32'?'cmd.exe':'/bin/sh',...(process.platform==='win32'?['/d','/s','/c']:['-c']),spec.command)
const env=Object.fromEntries(['PATH','HOME','USER','LOGNAME','LANG','LC_ALL','TMPDIR','SYSTEMROOT','SystemRoot','CODEX_HOME'].filter(key=>process.env[key]!==undefined).map(key=>[key,process.env[key]!]))
const child=spawn(spec.codex,args,{cwd:spec.cwd,env,stdio:['ignore','pipe','pipe'],shell:false})

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
 clearInterval(monitor);if(killTimer)clearTimeout(killTimer);closeSync(output)
 const destination=join(spec.directory,spec.id+'.result.json'),temporary=destination+'.new'
 writeFileSync(temporary,JSON.stringify({id:spec.id,exitCode,signal,endedAt:Date.now(),bytes,droppedBytes,...(failure?{error:failure}:{})}),{mode:0o600});renameSync(temporary,destination)
})
