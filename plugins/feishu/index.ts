import {FeishuSource} from './feishu.ts'
import type {SourcePlugin} from '../../src/source-plugins.ts'

/** Bundled and external connectors use the same registry contract. */
export default {
  apiVersion:1,
  kind:'feishu',
  label:'Feishu / 飞书',
  create:config=>new FeishuSource(config),
  scopes:config=>config.feishu?.chats??[],
  replayCursors:config=>(config.feishu?.chats??[]).map(chat=>config.id+':'+chat),
} satisfies SourcePlugin
