/** Offline lifecycle acceptance against an already completed real-model plugin goal. */
import {readFileSync,writeFileSync,existsSync} from 'node:fs'
import {join,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {Runtime} from '../src/runtime.ts'
import {Store} from '../src/store.ts'
import {loadConfig} from '../src/config.ts'
import {stableDigest} from '../src/sources.ts'
import {pluginCommand} from '../src/plugin-cli.ts'
import {buildPluginPackage,readPluginPackage,pluginManifestSchema} from '../src/plugin-package.ts'
const root=resolve(process.argv[2]??''),evidence=JSON.parse(readFileSync(join(root,'evidence.json'),'utf8'))
if(!evidence.ok)throw Error('Real-model goal acceptance must pass first')
const config=loadConfig(join(root,'config.json')),v1=readPluginPackage(join(root,'package'))
const {apiVersion,entry,codeSha256,...baseManifest}=v1.manifest
const definition=pluginManifestSchema.omit({apiVersion:true,entry:true,codeSha256:true}).parse({...baseManifest,version:'1.1.0'})
const v2=await buildPluginPackage(fileURLToPath(new URL('./plugins/checkpoint-source.ts',import.meta.url)),definition,join(root,'package-1.1.0'))
const quiet={async run(){throw Error('No model turn expected during controlled package activation')}}
function snapshot(directory:string){
 const store=new Store(join(directory,'state.sqlite'))
 try{return {goals:store.list('router-goal'),tickets:store.tickets.list(),deliveries:store.deliveries(),protected:store.db.prepare("SELECT kind,id,body FROM records WHERE kind NOT IN ('settings','plugin-installation') ORDER BY kind,id").all()}}
 finally{store.close()}
}
const unfinished=join(root,'unfinished-state'),beforeBlocked=snapshot(unfinished)
let refusal=''
try{const host=await Runtime.create({...loadConfig(join(root,'config.json')),stateDir:unfinished,sourcePlugins:[{directory:v2.directory,digest:v2.digest,replaceBuiltin:false,readPaths:[]}]},{model:quiet});await host.close();throw Error('Upgrade unexpectedly activated with an unfinished real goal')}
catch(error){refusal=String(error);if(!refusal.includes('Drain'))throw error}
if(stableDigest(snapshot(unfinished))!==stableDigest(beforeBlocked)||existsSync(join(unfinished,'host.lock')))throw Error('Failed upgrade changed protected state or left the host locked')
const before=snapshot(config.stateDir),steps:any[]=[]
for(const [pkg,input,output] of [[v2,join(root,'config.json'),join(root,'upgrade.json')],[v1,join(root,'upgrade.json'),join(root,'rollback.json')]] as const){
 await pluginCommand(['stage',input,pkg.directory,pkg.digest,output])
 const host=await Runtime.create(loadConfig(output),{model:quiet})
 try{const source=host.sources.get('local')!;const identity=await source.identity!();steps.push({version:pkg.manifest.version,digest:pkg.digest,identity,installation:host.store.get('plugin-installation','local')})}
 finally{await host.close()}
 const after=snapshot(config.stateDir)
 if(stableDigest(before)!==stableDigest(after))throw Error('Code switch changed protected goals, permissions, evidence or receipts')
}
const result={ok:true,at:new Date().toISOString(),goalId:(before.goals[0] as any).id,checks:{unfinishedRealGoalBlocksUpgrade:true,failedActivationAtomic:true,upgrade:true,rollback:true,sameGoalAndCriteria:true,sameAuthorization:true,sameTaskAndDeliveryReceipts:true,noModelWorkRerun:true},steps,protectedStateHash:stableDigest(before),refusal}
writeFileSync(join(root,'lifecycle-evidence.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result))
