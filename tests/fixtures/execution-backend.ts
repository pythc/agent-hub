// Synthetic adapter for protocol/fault-injection tests, never a real-model claim.
import {readFileSync,writeFileSync,existsSync} from 'node:fs'
import {join} from 'node:path'
import {spawn} from 'node:child_process'
import {randomUUID} from 'node:crypto'
import type {BackendPlugin} from '../../plugins/backend-sdk.ts'
export default {
 create(config,{dataDirectory}){
  return {
   async probe(){return {available:true,authenticated:true,remoteVerified:false,accountIdentity:process.env.FIXTURE_ACCOUNT??'a'.repeat(64)}},
   async run(r){
    const id=r.input==='replace'?'replaced':r.threadId??randomUUID(),file=join(dataDirectory,id+'.json')
    const history:string[]=existsSync(file)?JSON.parse(readFileSync(file,'utf8')):[]
    if(r.input==='descendant'){const child=spawn(process.execPath,['-e',`setTimeout(()=>require('node:fs').writeFileSync(${JSON.stringify(join(dataDirectory,'escaped'))},'escaped'),1000)`],{stdio:'ignore'});writeFileSync(join(dataDirectory,'descendant'),String(child.pid))}
    r.onThread?.(id);r.onTurn?.(r.input==='replay'?'stable-turn':randomUUID())
    r.onConfiguration?.({requested:r.options??{},sent:{parameters:r.options?.parameters}})
    r.onContextReady?.()
    if(r.input==='diagnostic')throw Object.assign(Error('secret-provider-message'),{diagnostic:{reason:'rpc_rejected',nativeMethod:'thread/start',rpcCode:-32000,message:'secret-value'}})
    if(r.input==='fence'){try{await r.onTool!('allowed',{value:3},'first')}catch{};await r.onTool!('allowed',{value:4},'second')}
    if(r.input==='crash')process.exit(3)
    if(r.input==='hang'||r.input==='descendant')await new Promise(()=>{})
    if(r.input==='malformed'){process.stdout.write('malformed\n');await new Promise(()=>{})}
    if(r.input==='invalid-schema')return {threadId:id,turnId:'bad',text:'not-json'}
    if(r.input==='tool'||r.input==='replay')await r.onTool!('allowed',{value:3},'same-call')
    if(r.input==='unknown-tool')await r.onTool!('forbidden',{},'bad-call')
    if(r.input==='bad-args')await r.onTool!('allowed',{value:'wrong'},'bad-call')
    if(r.input==='isolation'){
     if(process.env.PRIVATE_FIXTURE_SECRET)throw Error('Inherited secret')
     try{readFileSync(String(config.secret));throw Error('Private file exposed')}catch(e:any){if(!['EPERM','EACCES'].includes(e.code))throw e}
     try{writeFileSync(join(r.cwd,'native-write'),'bad');throw Error('Workspace write escaped')}catch(e:any){if(!['EPERM','EACCES'].includes(e.code))throw e}
    }
    if(r.input==='steer')await new Promise<void>(done=>r.onActive?.({interrupt:async()=>done(),steer:async(text,onRead)=>{history.push(text);onRead?.();done()},refresh:async()=>{}}))
    history.push(r.input);writeFileSync(file,JSON.stringify(history))
    const turn='completed-'+history.length;r.onTurn?.(turn)
    return {threadId:id,turnId:turn,text:JSON.stringify({history,version:config.version??1})}
   },
   async history(id){return JSON.parse(readFileSync(join(dataDirectory,id+'.json'),'utf8'))},
   async catalog(){return {models:[{id:'fixture'}]}}
  }
 }
} satisfies BackendPlugin
