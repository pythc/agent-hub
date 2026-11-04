import {mkdirSync,writeFileSync,existsSync,chmodSync,readdirSync} from 'node:fs'
import {resolve,join} from 'node:path'
import {configSchema} from './config.ts'
const quote=(s:string)=>"'"+s.replace(/'/g,"'\\''")+"'"
/** Local scaffolding only: never creates a remote bot or grants sender access. */
export function initOffice(platform:'feishu'|'wecom',directory:string,chat?:string,actor?:string){
 const root=resolve(directory),file=join(root,'config.json'),envFile=join(root,'credentials.env'),cwd=join(root,'workspace')
 if([file,envFile].some(existsSync))throw Error('Office configuration already exists; it was not overwritten')
 if(existsSync(root)&&readdirSync(root).length)throw Error('Select a new or empty office configuration directory')
 const source=platform==='wecom'?{id:'wecom',kind:'wecom',cwd,allowedActors:actor?[actor]:[],wecom:{botIdEnv:'AGENTHUB_WECOM_BOT_ID',secretEnv:'AGENTHUB_WECOM_BOT_SECRET'}}:{id:'feishu',kind:'feishu',cwd,enabled:!!chat,allowedActors:actor?[actor]:[],feishu:{cli:'lark-cli',chats:[chat??'oc_REPLACE_WITH_TEST_CHAT_ID'],liveEvents:true}}
 const config=configSchema.parse({stateDir:join(root,'state'),port:platform==='feishu'?4332:4333,work:{sandboxDriver:process.platform==='darwin'?'seatbelt':process.platform==='linux'?'bubblewrap':'disabled',network:false},sources:[{id:'local',kind:'local',cwd,allowedActors:['operator']},source]})
 mkdirSync(root,{recursive:true,mode:0o700});chmodSync(root,0o700);mkdirSync(cwd,{recursive:true,mode:0o700})
 writeFileSync(join(root,'.gitignore'),'/credentials.env\n/state/\n/workspace/\n*.log\n',{mode:0o600,flag:'wx'})
 writeFileSync(file,JSON.stringify(config,null,2)+'\n',{mode:0o600,flag:'wx'})
 writeFileSync(envFile,platform==='wecom'?'AGENTHUB_WECOM_BOT_ID=\nAGENTHUB_WECOM_BOT_SECRET=\n':'# Existing lark-cli bot profile; no user token or secret copied here.\n',{mode:0o600,flag:'wx'})
 return {platform,config:file,envFile,workspace:cwd,url:'http://127.0.0.1:'+config.port,start:'AGENTHUB_ENV_FILE='+quote(envFile)+' ./start.sh serve '+quote(file),next:platform==='wecom'?'Fill the two local credential variables, start the host, send a test DM, then allow the exact observed user in Sources.':'Set the allowed test chat ID and enable the source; use the existing bot login, then allow the exact observed sender in Sources.',backend:'codex (legacy default; configure any supported API backend instead if desired)'}
}
