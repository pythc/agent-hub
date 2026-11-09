import {existsSync,readFileSync,writeFileSync,mkdirSync,renameSync,unlinkSync,openSync,closeSync,fsyncSync,lstatSync} from 'node:fs'
import {join,dirname} from 'node:path'
import {randomUUID} from 'node:crypto'
import {DatabaseSync} from 'node:sqlite'
import {z} from 'zod'
import {configSchema,type Config} from './config.ts'
import {backendsSchema} from './backend-config.ts'
import {sourceDeployment} from './connector-config.ts'
import {MAX_DB_SCHEMA} from './store.ts'

const overlaySchema=z.object({format:z.literal(1),backends:backendsSchema,sources:z.array(configSchema.shape.sources.element)}).strict()
const secretsSchema=z.record(z.string().regex(/^AGENTHUB_SETUP_[A-Z0-9_]+$/),z.string().min(1).max(16000))
export type ManagedConnections=z.infer<typeof overlaySchema>
const same=(a:unknown,b:unknown):boolean=>JSON.stringify(normalize(a))===JSON.stringify(normalize(b))
function normalize(value:any):any{return Array.isArray(value)?value.map(normalize):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,normalize(value[k])])):value}
const deployment=sourceDeployment
export const managedFiles=(state:string)=>({directory:join(state,'setup'),connections:join(state,'setup','connections.json'),secrets:join(state,'setup','credentials.json'),journal:join(state,'setup','transaction.json')})
export function atomicPrivateFile(path:string,text:string){
 mkdirSync(dirname(path),{recursive:true,mode:0o700})
 const temporary=path+'.'+randomUUID()+'.tmp',fd=openSync(temporary,'wx',0o600)
 try{writeFileSync(fd,text);fsyncSync(fd)}finally{closeSync(fd)}
 try{renameSync(temporary,path)}catch(error){try{unlinkSync(temporary)}catch{}throw error}
}
function read(path:string){if(!existsSync(path))return undefined;if(lstatSync(path).isSymbolicLink())throw Error('Managed configuration must not be a symbolic link');return readFileSync(path,'utf8')}
function restore(path:string,previous:string|undefined){if(previous===undefined){if(existsSync(path))unlinkSync(path)}else atomicPrivateFile(path,previous)}
export function managedConnections(state:string):ManagedConnections{
 const text=read(managedFiles(state).connections);return text?overlaySchema.parse(JSON.parse(text)):{format:1,backends:{},sources:[]}
}
export function managedSecrets(state:string){const text=read(managedFiles(state).secrets);return text?secretsSchema.parse(JSON.parse(text)):{} }
interface Journal {id:string;connections?:string;secrets?:string;restore?:boolean}
/** Decide crash recovery from the atomic DB commit marker, not a second file phase. */
export function recoverManagedFiles(state:string){
 const files=managedFiles(state),text=read(files.journal);if(!text)return
 const journal=JSON.parse(text) as Journal;let committed=false
 const file=join(state,'state.sqlite')
 if(existsSync(file)){
  const db=new DatabaseSync(file,{readOnly:true})
  try{
   if(Number(db.prepare('PRAGMA user_version').get()!.user_version)>MAX_DB_SCHEMA)throw Error('Database is newer than this program')
   const table=db.prepare("SELECT name FROM sqlite_master WHERE name='records'").get()
   committed=!!table&&!!db.prepare('SELECT id FROM records WHERE kind=? AND id=?').get(journal.restore?'restore-commit':'onboarding-deployment',journal.id)
  }finally{db.close()}
 }
 if(!committed){restore(files.connections,journal.connections);restore(files.secrets,journal.secrets)}
 unlinkSync(files.journal)
}
export function loadManagedConfig(config:Config){
 recoverManagedFiles(config.stateDir)
 const overlay=managedConnections(config.stateDir),next=configSchema.parse(config)
 for(const [id,backend] of Object.entries(overlay.backends)){
  if(next.backends[id]&&!same(next.backends[id],backend))throw Error('Managed connection conflicts with startup backend: '+id)
  next.backends[id]=backend
 }
 for(const source of overlay.sources){
  const existing=next.sources.find(s=>s.id===source.id)
  if(existing&&!same(deployment(existing),deployment(source)))throw Error('Managed workspace conflicts with startup source: '+source.id)
  if(!existing)next.sources.push(source)
 }
 for(const [key,value] of Object.entries(managedSecrets(config.stateDir)))process.env[key]=value
 Object.assign(config,next)
}
/** Files are reversible until the matching settings revision is committed. */
export function prepareManagedFiles(state:string,id:string,next:{connections?:string;secrets?:string;restore?:boolean}){
 const files=managedFiles(state)
 if(existsSync(files.journal))throw Error('A configuration change needs recovery before another can start')
 const journal:Journal={id,connections:read(files.connections),secrets:read(files.secrets),restore:next.restore}
 atomicPrivateFile(files.journal,JSON.stringify(journal))
 try{restore(files.secrets,next.secrets);restore(files.connections,next.connections)}
 catch(error){restore(files.connections,journal.connections);restore(files.secrets,journal.secrets);unlinkSync(files.journal);throw error}
 return {
  finish(){if(existsSync(files.journal))unlinkSync(files.journal)},
  rollback(){restore(files.connections,journal.connections);restore(files.secrets,journal.secrets);if(existsSync(files.journal))unlinkSync(files.journal)},
 }
}
export function prepareManagedConfig(state:string,id:string,connections:ManagedConnections,secrets:Record<string,string>){return prepareManagedFiles(state,id,{connections:JSON.stringify(overlaySchema.parse(connections)),secrets:JSON.stringify(secretsSchema.parse(secrets))})}
export function validateManagedSnapshot(config:Config,connections?:string,secrets?:string){
 const overlay=connections?overlaySchema.parse(JSON.parse(connections)):{backends:{},sources:[]},keys=secrets?secretsSchema.parse(JSON.parse(secrets)):{}
 for(const [id,backend]of Object.entries(overlay.backends)){
  if(!same(config.backends[id],backend))throw Error('Backup configuration and managed connections differ')
  if('apiKeyEnv'in backend&&backend.apiKeyEnv?.startsWith('AGENTHUB_SETUP_')&&!keys[backend.apiKeyEnv])throw Error('Backup is missing managed credentials')
 }
 for(const source of overlay.sources){const saved=config.sources.find(s=>s.id===source.id);if(!saved||!same(deployment(saved),deployment(source)))throw Error('Backup configuration and managed workspaces differ')}
 return overlay
}
