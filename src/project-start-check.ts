import type {ProjectPolicy} from './config.ts'
const quote=(s:string)=>"'"+s.replaceAll("'","'\"'\"'")+"'"
/** Runs inside the existing supervised sandbox, so loopback does not require network expansion.
 * The runner owns the entire process group and kills remaining descendants on completion. */
export function projectStartCommand(check:NonNullable<ProjectPolicy['stages']>['startCheck']){
 const script=`
const http=require('node:http'),{spawn}=require('node:child_process'),{randomUUID}=require('node:crypto');
const spec=${JSON.stringify(check)};
if(!spec.command.startsWith('exec '))throw Error('Start-check requires an exec foreground service');
const url=new URL(spec.url);
if(url.protocol!=='http:'||!['127.0.0.1','[::1]'].includes(url.hostname)||url.username||url.password||url.hash)throw Error('Invalid start-check URL');
const probe=()=>new Promise(resolve=>{let settled=false;const done=value=>{if(!settled){settled=true;resolve(value)}};const req=http.get(url,{agent:false,timeout:250},res=>{let body='',bytes=0;res.on('data',part=>{bytes+=part.length;if(bytes>256){res.destroy();done({present:true})}else body+=part.toString()});res.on('end',()=>done({present:true,ok:res.statusCode===200,body}));res.on('error',()=>done({present:true}));});req.on('timeout',()=>{req.destroy();done({present:true})});req.on('error',e=>done({present:e.code!=='ECONNREFUSED'}));});
(async()=>{
 if((await probe()).present)throw Error('Start-check endpoint is already occupied or unavailable');
 const token=randomUUID(),child=spawn('/bin/sh',['-c',spec.command],{env:{...process.env,AGENT_HUB_START_CHECK_TOKEN:token},stdio:'ignore'});
 let exited=false;child.once('exit',()=>{exited=true});child.once('error',()=>{exited=true});
 let ready=false;
 try{const end=Date.now()+spec.timeoutMs;while(Date.now()<end&&!exited){const r=await probe();if(r.ok&&r.body===token&&!exited){ready=true;break}await new Promise(r=>setTimeout(r,50));}}
 finally{try{child.kill('SIGTERM')}catch{};await Promise.race([new Promise(r=>child.once('exit',r)),new Promise(r=>setTimeout(r,300))]);if(!exited)try{child.kill('SIGKILL')}catch{}}
 const stopped=!(await probe()).present;
 if(!stopped)throw Error('Start-check service remained reachable or termination is unknown');
 if(!ready)throw Error('Start-check did not prove this live instance ready');
 console.log('Instance readiness handshake passed; supervised service is stopped before the next stage');
})().catch(e=>{console.error(e.message);process.exitCode=1});
`
 return 'node -e '+quote(script)
}
