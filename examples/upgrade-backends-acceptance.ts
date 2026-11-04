import {mkdtempSync,mkdirSync,writeFileSync,readFileSync} from 'node:fs'
import {resolve,join} from 'node:path'
import {pathToFileURL} from 'node:url'
import {Runtime} from '../src/runtime.ts'
import {configSchema} from '../src/config.ts'
import {backupState,verifyBackup,restoreState} from '../src/backup.ts'
const oldRoot=process.argv[2]
if(!oldRoot)throw Error('Provide an extracted AgentHub 0.5.0, 0.6.0, 0.7.0 or 0.8.0 source directory')
const baselineVersion=JSON.parse(readFileSync(resolve(oldRoot,'package.json'),'utf8')).version,baselineSchema=baselineVersion==='0.5.0'?2:baselineVersion==='0.6.0'?3:['0.7.0','0.8.0'].includes(baselineVersion)?4:undefined
if(!baselineSchema)throw Error('Baseline must be AgentHub 0.5.0, 0.6.0, 0.7.0 or 0.8.0')
const {Store:OldStore}=await import(pathToFileURL(resolve(oldRoot,'src/store.ts')).href)
const {Runtime:OldRuntime}=await import(pathToFileURL(resolve(oldRoot,'src/runtime.ts')).href)
const {loadConfig:loadOldConfig}=await import(pathToFileURL(resolve(oldRoot,'src/config.ts')).href)
mkdirSync('.local',{recursive:true});const root=mkdtempSync(resolve('.local/upgrade-backends-'))
const original={stateDir:join(root,'state'),sources:[{id:'local',kind:'local',cwd:root,allowedActors:['operator']}]},originalFile=join(root,'config-original.json')
writeFileSync(originalFile,JSON.stringify(original,null,2)+'\n');const config=configSchema.parse(original)
const file=join(config.stateDir,'state.sqlite'),steps:any[]=[]
let old=new OldRuntime(loadOldConfig(originalFile));old.store.put('run','synthetic',{ticketId:'synthetic',threadId:'retained-native-thread',cwd:root,phase:'idle'});await old.close()
const before=await backupState(config,join(root,'before'));if(before.schema!==baselineSchema)throw Error('Unexpected baseline schema')
let host=new Runtime(config);const currentSchema=Number(host.store.db.prepare('PRAGMA user_version').get()!.user_version);if(host.store.get<any>('run','synthetic')?.threadId!=='retained-native-thread')throw Error('Native identity lost on upgrade');host.store.put('backend-binding','api:test:fixture',{id:'test',kind:'openai-chat',endpoint:'http://127.0.0.1:1/v1'});await host.close();steps.push({action:'upgrade',schema:currentSchema,nativeThreadRetained:true,runtimeOpened:true})
let refused=false;try{new OldStore(file)}catch(error){refused=String(error).includes('newer')}
if(!refused)throw Error('Old program did not refuse multi-backend data');steps.push({action:'old-program-refusal',passed:true})
await restoreState(config,join(root,'before'));old=new OldRuntime(loadOldConfig(originalFile));if(old.store.get('run','synthetic').threadId!=='retained-native-thread')throw Error('Rollback identity lost');await old.close();steps.push({action:'restore-pre-upgrade',schema:baselineSchema,originalConfigUsed:true,runtimeOpened:true})
host=new Runtime(config);if(host.store.get<any>('run','synthetic')?.threadId!=='retained-native-thread')throw Error('Re-upgrade identity lost');await host.close();steps.push({action:'re-upgrade',schema:currentSchema,runtimeOpened:true})
const evidence={at:new Date().toISOString(),passed:true,baselineVersion,baselineSchema:verifyBackup(join(root,'before')).schema,steps};writeFileSync(join(root,'report.json'),JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify(evidence))
