import {DatabaseSync} from 'node:sqlite'
import {existsSync,mkdirSync,lstatSync,readFileSync,unlinkSync} from 'node:fs'
import {join,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {randomUUID} from 'node:crypto'
import {configSchema,loadConfig} from './config.ts'
import {MAX_DB_SCHEMA} from './store.ts'
import {atomicPrivateFile,managedFiles} from './managed-config.ts'
import {publicOriginSchema} from './http-deployment.ts'
import {probeSandbox} from './sandbox.ts'
import {AgentBrowserDriver} from './browser-driver.ts'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'

export const containerLayout=(root='/data')=>({root,state:join(root,'state'),config:join(root,'state','config.json'),receipt:join(root,'state','container-maintenance.json')})
function privateDirectory(path:string){if(existsSync(path)&&(lstatSync(path).isSymbolicLink()||!lstatSync(path).isDirectory()))throw Error('Private directory must not be a symlink: '+path);mkdirSync(path,{recursive:true,mode:0o700})}
export function inspectContainer(root='/data'){
 const layout=containerLayout(root),schemas:Record<string,number>={}
 if(existsSync(layout.config)){
  const config=loadConfig(layout.config)
  if(config.stateDir!==resolve(layout.state))throw Error('Managed container stateDir must remain '+layout.state)
 }
 if(existsSync(managedFiles(layout.state).journal))throw Error('Configuration recovery is pending; start the matching release before upgrade')
 for(const relative of ['state.sqlite','watchdog/state.sqlite']){
  const path=join(layout.state,relative);if(!existsSync(path))continue
  const db=new DatabaseSync(path,{readOnly:true})
  try{
   const schema=Number(db.prepare('PRAGMA user_version').get()!.user_version)
   if(schema>MAX_DB_SCHEMA)throw Error('Database is newer than this image; refusing downgrade')
   if(schema>0&&schema<6)throw Error('Router scope migration required before container startup')
   if(db.prepare('PRAGMA quick_check').get()!.quick_check!=='ok')throw Error('Database integrity check failed')
   const table=db.prepare("SELECT name FROM sqlite_master WHERE name='records'").get()
   const settings=table&&db.prepare("SELECT body FROM records WHERE kind='settings' AND id='current'").get()
   if(settings)configSchema.parse(JSON.parse(String(settings.body)).config)
   schemas[relative]=schema
  }finally{db.close()}
 }
 return {format:1,version:'0.10.0',maxSchema:MAX_DB_SCHEMA,schemas,compatible:true}
}
export async function initContainer(root='/data',origin=process.env.ROPPO_PUBLIC_ORIGIN??'http://127.0.0.1:4337',probe=true){
 const publicOrigin=publicOriginSchema.parse(origin),layout=containerLayout(root)
 privateDirectory(layout.root);privateDirectory(layout.state);inspectContainer(root)
 privateDirectory(join(layout.state,'home'));privateDirectory(join(layout.state,'workspace'))
 const existing=existsSync(layout.config)
 const config=existing?loadConfig(layout.config):configSchema.parse({stateDir:layout.state,port:4337,work:{sandboxDriver:'bubblewrap',network:false},browser:{executablePath:'/usr/bin/chromium'},execution:{router:{mode:'host'},management:{enabled:true},workers:[{id:'one',backend:'codex'}]},sources:[{id:'local',kind:'local',cwd:join(layout.state,'workspace'),allowedActors:['operator'],sandbox:'read-only',workspace:{mode:'source'}}]})
 if(config.port!==4337)throw Error('The container listens internally on 4337; set ROPPO_PORT for the host mapping')
 config.http={listenHost:'0.0.0.0',publicOrigin}
 configSchema.parse(config)
 if(probe)await probeSandbox(config.work.sandboxDriver,config.codex)
 // Deployment-owned HTTP fields may change with the published port. Preserve
 // every other saved setting, key, profile and source configuration.
 if(!existing||JSON.stringify(loadConfig(layout.config).http)!==JSON.stringify(config.http))atomicPrivateFile(layout.config,JSON.stringify(config,null,2)+'\n')
 return {initialized:true,created:!existing,publicOrigin,config:layout.config}
}
async function localAPI(path:string,value?:unknown,root='/data'){
 const layout=containerLayout(root),token=readFileSync(join(layout.state,'access-token'),'utf8').trim()
 const response=await fetch('http://127.0.0.1:4337'+path,{method:value?'POST':'GET',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:value?JSON.stringify(value):undefined,redirect:'error',signal:AbortSignal.timeout(30000)})
 const result=await response.json() as any
 if(!response.ok)throw Error(result.error??result.code??'Host request failed: '+response.status)
 return result
}
export async function containerCommand(action:string){
 const layout=containerLayout()
 if(action==='init')return initContainer()
 if(action==='inspect')return inspectContainer()
 if(action==='health'){
  const response=await fetch('http://127.0.0.1:4337/health',{signal:AbortSignal.timeout(2500)}),result=await response.json() as any
  if(!response.ok||!result.ok||result.restarting)throw Error('Host is not healthy')
  return {healthy:true}
 }
 if(action==='open')return localAPI('/operator-link',{})
 if(action==='prepare-upgrade'){
  if(existsSync(layout.receipt))throw Error('A maintenance receipt already exists; finish or abort it before another upgrade')
  const current=(await localAPI('/settings')).current,id=randomUUID()
  atomicPrivateFile(layout.receipt,JSON.stringify({operationId:id})+'\n')
  try{return await localAPI('/deployment/maintenance',{action:'prepare',operationId:id,expectedRevision:current.revision})}
  catch(error){
   try{await localAPI('/deployment/maintenance',{action:'abort',operationId:id});unlinkSync(layout.receipt)}catch{}
   throw error
  }
 }
 if(action==='finish-upgrade'||action==='abort-upgrade'){
  const {operationId}=JSON.parse(readFileSync(layout.receipt,'utf8'))
  const result=await localAPI('/deployment/maintenance',{action:action==='finish-upgrade'?'finish':'abort',operationId})
  unlinkSync(layout.receipt);return result
 }
 if(action==='doctor'){
  const config=loadConfig(layout.config),sandbox=await probeSandbox(config.work.sandboxDriver,config.codex)
  const root=mkdtempSync(join(tmpdir(),'roppo-browser-check-')),session={id:randomUUID(),directory:join(root,'profile')},driver=new AgentBrowserDriver(root,config.browser)
  try{
   const version=await driver.version();await driver.run(session,['open','about:blank'])
   const state=await driver.state(session)
   return {...inspectContainer(),sandbox,browser:{verified:true,version,stateAvailable:!!state}}
  }finally{await driver.close(session).catch(()=>{});rmSync(root,{recursive:true,force:true})}
 }
 throw Error('Use init, inspect, health, open, doctor, prepare-upgrade, finish-upgrade or abort-upgrade')
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))containerCommand(process.argv[2]??'inspect').then(result=>console.log(JSON.stringify(result))).catch(error=>{console.error(error instanceof Error?error.message:'Container operation failed');process.exitCode=1})
