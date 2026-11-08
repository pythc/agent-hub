import {MessageSource,type SourceContext,type SourceConfig} from '../../plugins/sdk.ts'
import {readFileSync} from 'node:fs'
class Example extends MessageSource {
  private context?:SourceContext
  start(ctx:SourceContext){this.context=ctx}
  async identity(){return {id:'fixture-bot',type:'bot',verified:true}}
  async members(){await new Promise(r=>setTimeout(r,150));return [{id:'alice',bot:false}]}
  async probe(){return {identity:await this.identity(),choices:[{id:'room',label:'Room'}]}}
  async poll(ctx:SourceContext){
    this.context=ctx
    if(this.config.options.bulk){for(let i=0;i<Number(this.config.options.bulk);i++){ctx.store.put('plugin-state','bulk',i);ctx.receive(this.trigger({id:'bulk-'+i,thread:'room:root',scope:'room',text:'backlog',addressed:false},'alice'))}return}
    const count=ctx.store.get<number>('plugin-state','count')??0
    ctx.store.put('plugin-state','count',count+1)
    const scope=String(this.config.options.scope??'room')
    if(this.config.options.badWrite)ctx.store.put('source-cursor','other:room',{since:'poison'})
    ctx.receive(this.trigger({id:'message-1',thread:scope+':root',scope,text:'plugin task',addressed:true},'alice'))
    ctx.store.put('source-cursor',this.config.id+':'+scope,{since:String(count+1)})
    if(this.config.options.crash)process.exit(4)
  }
  async read({resource}:{resource:string}){
    if(resource==='threads')return this.context!.records!('thread',{scope:'room'})
    if(resource==='foreign')return this.context!.records!('trigger',{sourceId:'foreign'})
    if(resource==='history'){let cursor:string|undefined,count=0,pages=0;do{const page=await this.context!.records!('trigger',{cursor,limit:100});count+=page.items.length;pages++;cursor=page.next}while(cursor);return {count,pages}}
    if(resource==='crash')process.exit(5)
    if(resource==='hang')await new Promise(()=>{})
    if(resource==='private'){try{return readFileSync(String(this.config.options.privatePath),'utf8')}catch{return 'denied'}}
    if(resource==='env')return {present:!!process.env.AGENTHUB_TEST_AMBIENT_SECRET,home:process.env.HOME}
    return {version:this.config.options.version??1,count:this.context?.store.get('plugin-state','count')??0,resource}
  }
  async deliver(){if(this.config.options.deliveryCrash)process.exit(9)}
}
export default {create:(config:SourceConfig)=>new Example(config)}
