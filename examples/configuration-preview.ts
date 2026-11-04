import {mkdirSync,writeFileSync} from 'node:fs'
import {resolve,join} from 'node:path'
import {configSchema} from '../src/config.ts'
import {Runtime} from '../src/runtime.ts'
import {serve} from '../src/server.ts'
import {MessageSource} from '../src/sources.ts'

/** An isolated, persistent configuration playground. No model or office credentials required. */
const root=resolve(process.argv[2]??'.local/configuration-preview'),cwd=join(root,'workspace')
mkdirSync(cwd,{recursive:true,mode:0o700})
const config=configSchema.parse({
 stateDir:join(root,'state'),port:4335,codex:'/preview-not-installed/codex',execution:{backend:'preview-responses'},
 backends:{
  'preview-responses':{kind:'openai-responses',baseUrl:'http://127.0.0.1:9/v1',model:'preview-model',apiKeyEnv:'AGENTHUB_PREVIEW_UNUSED_KEY'},
  'preview-chat':{kind:'openai-chat',baseUrl:'http://127.0.0.1:9/v1',model:'preview-chat-model'},
  'preview-anthropic':{kind:'anthropic',baseUrl:'http://127.0.0.1:9/v1',model:'preview-anthropic-model'},
 },
 work:{sandboxDriver:'disabled',network:false},
 sources:[
  {id:'local',kind:'local',cwd,allowedActors:['preview-operator']},
  {id:'feishu',kind:'feishu',enabled:false,cwd,allowedActors:[],feishu:{cli:'lark-cli',chats:['preview-chat-only'],liveEvents:true}},
  {id:'wecom',kind:'wecom',enabled:false,cwd,allowedActors:[],wecom:{botIdEnv:'AGENTHUB_PREVIEW_UNUSED_BOT_ID',secretEnv:'AGENTHUB_PREVIEW_UNUSED_BOT_SECRET'}},
 ],
})
class PreviewSource extends MessageSource {
 async poll(){throw Error('Preview connector: no external connection is made')}
 async identity(){return {id:this.config.id+'-preview',type:'preview',verified:false}}
 async deliver(){throw Error('Preview connector cannot deliver messages')}
}
const runtime=new Runtime(config,{sources:config.sources.map(source=>new PreviewSource(source))})
runtime.pause(true)
const {server,url,tokenPath}=await serve(runtime,{configurationPreview:true})
writeFileSync(join(root,'connection.json'),JSON.stringify({url:url+'/configure',tokenPath},null,2)+'\n',{mode:0o600})
console.log(JSON.stringify({url:url+'/configure',tokenPath,isolated:true,taskExecution:false}))
let stopping=false
for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,()=>{if(stopping)return;stopping=true;server.close();void runtime.close()})
