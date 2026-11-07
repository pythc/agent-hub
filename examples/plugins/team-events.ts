import {MessageSource,type Incoming} from '../../src/sources.ts'
import type {SourcePlugin} from '../../src/source-plugins.ts'

/** Example application adapter: tenant-scoped HTTP events and callback replies. */
class TeamEvents extends MessageSource {
  validThread(thread:string){return thread.startsWith(this.config.options.tenant+'/')&&thread.length>String(this.config.options.tenant).length+1}
  override trigger(input:Incoming,actor:string,human=true){
    const trigger=super.trigger(input,actor,human)
    trigger.meta.tenant=this.config.options.tenant
    return trigger
  }
}
export default {
  apiVersion:1,kind:'team-events',label:'Team events (example)',
  validate(config){if(typeof config.options.tenant!=='string'||!/^[a-z0-9-]+$/.test(config.options.tenant))throw Error('team-events requires options.tenant')},
  create:config=>new TeamEvents(config),
} satisfies SourcePlugin
