import {FeishuSource} from './feishu.ts'
import type {SourceConfig} from '../sdk.ts'
class PackagedFeishu extends FeishuSource {
  async probe(){return {identity:await this.identity(),choices:this.config.feishu!.chats.map(id=>({id,label:id}))}}
}
export default {create:(config:SourceConfig)=>new PackagedFeishu(config)}
