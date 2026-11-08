/** A third-party reference with no platform-specific host changes. Used by opt-in native acceptance. */
import {MessageSource,bodyDigest,type SourceConfig,type SourceContext,type Trigger,type OutboundMessage} from '../../plugins/sdk.ts'
class CheckpointSource extends MessageSource {
  private host?:SourceContext
  async identity(){return {id:'checkpoint-operator',type:'bot',verified:true}}
  start(ctx:SourceContext){this.host=ctx}
  async poll(ctx:SourceContext){
    this.host=ctx
    const text=String(this.config.options.instruction),at=String(this.config.options.at)
    ctx.receive(this.trigger({id:'audit',thread:'audit',scope:'audit',text,at,addressed:true},'operator'))
    ctx.store.put('source-cursor',this.config.id+':audit',{since:at})
  }
  async read({resource,trigger}:{resource:string;trigger?:Trigger}){if(resource!=='message'||trigger?.source!==this.config.id)throw Error('An admitted message is required');return {text:trigger.text}}
  async deliver(message:OutboundMessage){
    if(!this.host)throw Error('Start the connection first')
    const key='delivery:'+message.id,fingerprint=bodyDigest(message),old=this.host.store.get<any>('plugin-state',key)
    if(old&&old.fingerprint!==fingerprint)throw Error('Delivery identity conflict')
    this.host.store.put('plugin-state',key,{fingerprint,text:message.text})
  }
}
export default {create:(config:SourceConfig)=>new CheckpointSource(config)}
