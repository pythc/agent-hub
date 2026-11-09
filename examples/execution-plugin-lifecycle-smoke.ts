/** Real CLI/model sessions across three processes, upgrade and code-only rollback. */
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs'
import {join,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {spawn} from 'node:child_process'
import {randomUUID} from 'node:crypto'
import {loadConfig} from '../src/config.ts'
import {Store} from '../src/store.ts'
import {BackendRegistry} from '../src/backends/registry.ts'
import {activateBackendPackages,buildBackendPackage} from '../src/backends/plugin-package.ts'
const [file,destination]=process.argv.slice(2)
if(!file||!destination)throw Error('Use execution-plugin-lifecycle-smoke.ts <dedicated-codex-plugin-config.json> <new-private-output-directory>')
const root=resolve(destination),phase=process.env.AGENTHUB_EXECUTION_PHASE
if(phase===undefined){
 if(existsSync(root))throw Error('Use a fresh evidence directory')
 mkdirSync(join(root,'workspace'),{recursive:true,mode:0o700})
 const manifest=JSON.parse(readFileSync(new URL('../plugins/backend-codex/manifest.json',import.meta.url),'utf8'))
 const entry=fileURLToPath(new URL('../plugins/backend-codex/index.ts',import.meta.url))
 const v1=await buildBackendPackage(entry,manifest,join(root,'v1')),v2=await buildBackendPackage(entry,{...manifest,version:'1.0.1'},join(root,'v2'))
 writeFileSync(join(root,'plan.json'),JSON.stringify({v1,v2,first:randomUUID(),second:randomUUID()}),{mode:0o600})
 for(let n=0;n<3;n++)await new Promise<void>((ok,fail)=>{
  const child=spawn(process.execPath,['--import','tsx',fileURLToPath(import.meta.url),file,root],{env:{...process.env,AGENTHUB_EXECUTION_PHASE:String(n)},stdio:'inherit'})
  child.on('error',fail);child.on('exit',code=>code===0?ok():fail(Error('Lifecycle phase '+n+' failed: '+code)))
 })
 const phases=[0,1,2].map(n=>JSON.parse(readFileSync(join(root,n+'.json'),'utf8')))
 const evidence={ok:phases.every(p=>p.ok),processRestarts:2,codeRollbackWithoutDatabaseRestore:true,phases}
 writeFileSync(join(root,'evidence.json'),JSON.stringify(evidence,null,2),{mode:0o600});console.log(JSON.stringify(evidence))
}else{
 const config=loadConfig(file),id=config.execution.backend,definition=config.backends[id]
 if(definition?.kind!=='plugin'||definition.plugin!=='codex-cli')throw Error('Select the Codex execution plugin')
 const plan=JSON.parse(readFileSync(join(root,'plan.json'),'utf8')),pkg=phase==='1'?plan.v2:plan.v1
 config.stateDir=join(root,'state');config.backendPlugins=[{directory:pkg.directory,digest:pkg.digest}]
 const store=new Store(join(config.stateDir,'state.sqlite'))
 try{
  activateBackendPackages(store,config)
  const model=new BackendRegistry(config,store),previous=phase==='0'?undefined:JSON.parse(readFileSync(join(root,Number(phase)-1+'.json'),'utf8'))
  const run=async(input:string,expected:string,threadId?:string)=>{
   const result=await model.run({cwd:join(root,'workspace'),onProgress:event=>console.log(JSON.stringify({phase,event})),instructions:'Remember the agreed string across turns. Return only the required JSON object.',input,threadId,model:'gpt-6.1-sol',role:'worker',managed:true,archiveOnComplete:true,sandbox:'read-only',tools:[],options:{effort:'low'},schema:{type:'object',properties:{answer:{type:'string'}},required:['answer'],additionalProperties:false}})
   if(JSON.parse(result.text).answer!==expected)throw Error('Real model did not recover the agreed string')
   return result.threadId
  }
  const first=phase==='0'?await run('记住此字符串并在 answer 返回它：'+plan.first,plan.first):previous.first
  let second=previous?.second
  if(phase==='1'){
   await run('只返回上一轮约定保存的字符串。',plan.first,first)
   second=await run('记住此字符串并在 answer 返回它：'+plan.second,plan.second)
  }
  if(phase==='2')await run('只返回上一轮约定保存的字符串。',plan.second,second)
  if(store.get<any>('backend-plugin-thread',first).digest!==plan.v1.digest||second&&store.get<any>('backend-plugin-thread',second).digest!==plan.v2.digest)throw Error('Session package binding changed')
  const history=await model.history(second??first,join(root,'workspace'))
  if(!JSON.stringify(history).includes(second?plan.second:plan.first))throw Error('Authoritative native history was not recovered')
  const evidence={ok:true,phase:Number(phase),first,second,activeDigest:pkg.digest,threads:store.list<any>('backend-plugin-thread').map(t=>({id:t.id,nativeId:t.nativeId,digest:t.digest,state:t.state})),installation:store.get('backend-plugin-installation','codex-cli')}
  writeFileSync(join(root,phase+'.json'),JSON.stringify(evidence,null,2),{mode:0o600});console.log(JSON.stringify({phase,ok:true}))
 }finally{store.close()}
}
