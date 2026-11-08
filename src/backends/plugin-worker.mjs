// Stdio transport only. The adapter runs in its own OS-sandboxed process.
import {createInterface} from 'node:readline'
import {pathToFileURL} from 'node:url'
let model,controller,control,busy=false,sequence=0
const pending=new Map(),codes=new Set(['auth_required','provider_rejected','quota_exhausted','rate_limited','transient','cancelled','invalid_output','unsupported','process_failed','outcome_unknown','configuration_invalid','context_budget_exceeded'])
const emit=value=>process.stdout.write(JSON.stringify(value)+'\n')
const event=(name,value)=>emit({type:'event',event:name,...value===undefined?{}:{value}})
const ask=(method,params)=>new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});emit({type:'request',id,method,params})})
console.log=(...args)=>console.error(...args)
function request(raw){
 const {callbacks=[],...input}=raw
 controller=new AbortController()
 const r={...input,signal:controller.signal}
 const events={onThread:'thread',onTurn:'turn',onModel:'model',onConfiguration:'configuration',onCapabilities:'capabilities',onProgress:'progress',onOutput:'output',onBudget:'budget',onContextReady:'contextReady'}
 for(const [key,name] of Object.entries(events))if(callbacks.includes(key))r[key]=value=>event(name,value)
 r.onActive=value=>{control=value;event('active',{steering:typeof value.steer==='function',refresh:typeof value.refresh==='function'})}
 if(callbacks.includes('onTool'))r.onTool=(name,args,callId)=>ask('tool',{name,args,callId})
 if(callbacks.includes('onHumanRequest'))r.onHumanRequest=value=>ask('human',{request:value})
 if(callbacks.includes('retainToolResult'))r.retainToolResult=(callId,result)=>ask('retain',{callId,result})
 return r
}
async function handle(m){
 if(m.type==='response'){
  const waiter=pending.get(m.id);if(!waiter)throw Error('Unexpected callback response')
  pending.delete(m.id)
  if(m.error)waiter.reject(Object.assign(new Error(m.error.code),m.error));else waiter.resolve(m.result)
  return
 }
 if(m.type==='cancel'){controller?.abort();await control?.interrupt();return}
 if(m.type!=='call'||!Number.isSafeInteger(m.id)||m.id<=0)throw Error('Invalid request')
 try{
  let result
  if(m.method==='control'){
   if(!busy||!control)throw Object.assign(new Error('No active turn'),{code:'unsupported'})
   if(m.params.action==='steer')result=await control.steer(m.params.text,()=>event('inputRead',m.id))
   else if(m.params.action==='refresh'&&control.refresh)result=await control.refresh(m.params.text)
   else if(m.params.action==='interrupt')result=await control.interrupt()
   else throw Object.assign(new Error('Unsupported control'),{code:'unsupported'})
  }else{
   if(busy)throw Error('An operation is already running')
   busy=true
   try{
    if(m.method==='initialize'){
     if(model)throw Error('Already initialized')
     const plugin=(await import(pathToFileURL(m.params.module).href)).default
     model=await plugin.create(m.params.config,{dataDirectory:m.params.dataDirectory})
     if(typeof model?.run!=='function')throw Error('Invalid backend adapter')
     result={ready:true}
    }else{
     if(!model)throw Error('Backend is not initialized')
     if(m.method==='run')result=await model.run(request(m.params))
     else if(['history','purge','expose','catalog','probe'].includes(m.method)&&typeof model[m.method]==='function')result=await model[m.method](...(m.params.args??[]))
     else throw Object.assign(new Error('Unsupported method'),{code:'unsupported'})
    }
   }finally{busy=false;control=undefined;controller=undefined}
  }
  emit({type:'result',id:m.id,result:result??null})
 }catch(error){emit({type:'result',id:m.id,error:{code:codes.has(error?.code)?error.code:'process_failed'}})}
}
const lines=createInterface({input:process.stdin})
lines.on('line',line=>{
 if(Buffer.byteLength(line)>16_000_000)process.exit(2)
 let value;try{value=JSON.parse(line)}catch{process.exit(2)}
 void handle(value).catch(()=>process.exit(2))
})
// The host launches this worker as a dedicated process group. On host crash,
// stdin closes; terminate the entire group so a native CLI cannot outlive it.
function stop(){controller?.abort();try{process.kill(0,'SIGKILL')}catch{process.exit(1)}}
lines.on('close',stop)
process.once('SIGTERM',stop)
