import {FeishuSource} from './feishu.ts'
import type {SourcePlugin} from '../../src/source-plugins.ts'

/** Bundled and external connectors use the same registry contract. */
export default {
  apiVersion:1,
  kind:'feishu',
  label:'Feishu / 飞书',
  create:config=>new FeishuSource(config),
  connection:{
    validateFields:config=>!config.feishu?.chats.length?[{field:'chats',code:'required'}]:config.feishu.chats.some(id=>!/^oc_[A-Za-z0-9_-]+$/.test(id))?[{field:'chats',code:'invalid_format'}]:[],
    validate:config=>{if(!config.feishu?.chats.length||config.feishu.chats.some(id=>!/^oc_[A-Za-z0-9_-]+$/.test(id)))throw Error('Explicit Feishu chat IDs are required')},
    scopesPath:'/feishu/chats',credentials:{APP_ID:'/feishu/appIdEnv',APP_SECRET:'/feishu/appSecretEnv'},
    setup:{serviceUrl:'https://open.feishu.cn',description:'Create an internal Feishu bot app, enable the bot, grant message read/reply and chat-member scopes, publish its version, and add it to each selected chat. This recipe uses REST polling for explicit chats. Lifecycle event streams require the existing CLI configuration. App credentials are kept in the host credential store; they are never Worker environment variables.',fields:[
      {name:'app-id',path:'/feishu/appIdEnv',label:'App ID',secret:true,required:true,help:'From Developer Console → Credentials. Used only by this source adapter.',placeholder:'cli_…'},
      {name:'app-secret',path:'/feishu/appSecretEnv',label:'App secret',secret:true,required:true,help:'From the same app. Applying stores the credential through existing onboarding.'},
      {name:'chats',path:'/feishu/chats',label:'Chat IDs',input:'tags',secret:false,required:true,help:'Add the bot to each chat, then enter explicit oc_ chat IDs separated by commas.',placeholder:'oc_…'},
    ]},
  },
  scopes:config=>config.feishu?.chats??[],
  replayCursors:config=>(config.feishu?.chats??[]).map(chat=>config.id+':'+chat),
} satisfies SourcePlugin
