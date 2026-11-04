import {mkdirSync,writeFileSync} from 'node:fs'
import {resolve,join} from 'node:path'
import {Runtime} from '../src/runtime.ts'
import {configSchema} from '../src/config.ts'
import {serve} from '../src/server.ts'
const root=resolve('.local/panel-v4');mkdirSync(root,{recursive:true});writeFileSync(join(root,'sample.txt'),'panel-resource-evidence')
const host=new Runtime(configSchema.parse({stateDir:join(root,'state'),port:4325,sources:[{id:'local',kind:'local',cwd:root,allowedActors:['operator']}]}),{model:{async run(r){r.onThread?.('panel-native');r.onTurn?.('turn-'+Date.now());return {threadId:'panel-native',turnId:'turn-'+Date.now(),text:JSON.stringify(r.ephemeral?{action:'accept',title:'Panel synthetic task',scope:'Read synthetic files',rules:[],reason:'requested'}:{state:'waiting',summary:'Awaiting a follow-up',reply:'',question:null,handbacks:[]})}}}})
const source=host.sources.get('local')!;source.members=async()=>[{id:'operator',name:'Synthetic operator'}]
host.store.put('source-health','local',{source:'local',at:Date.now(),status:'ok',consecutiveFailures:0})
host.receive('local','operator',{id:'panel-fixture',thread:'panel',text:'Read synthetic files',addressed:true})
const server=await serve(host);console.log(server.url)
let closing=false;async function close(){if(closing)return;closing=true;server.server.close();await host.close()}
process.on('SIGTERM',()=>void close());process.on('SIGINT',()=>void close())
