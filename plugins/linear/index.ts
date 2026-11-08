import {createHash} from 'node:crypto'
import {MessageSource,UncertainDelivery,bodyDigest,record,type SourceContext,type SourceConfig,type Trigger,type OutboundMessage} from '../sdk.ts'

interface Options {
  teams:string[]; workspaceId:string; tokenEnv:string; authType?:'api-key'|'oauth';
  issueIds?:string[]; command?:string; apiBase?:string; pageSize?:number
}
type Request=(query:string,variables?:Record<string,unknown>)=>Promise<any>
type Stream='issues'|'comments'
interface Window {since:string;until:string;stream:Stream;after:string|null;filterHash:string}
interface Observation {hash?:string;revised?:boolean;outgoing?:boolean}
const uuid=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(value)
const date=(value:unknown):value is string=>typeof value==='string'&&Number.isFinite(Date.parse(value))
const userFields='id name active app'
const issueFields=`id identifier title description createdAt updatedAt archivedAt trashed url team { id } creator { ${userFields} } botActor { id } state { id name type } project { id name }`
const commentFields=`id body createdAt updatedAt editedAt archivedAt url user { ${userFields} } botActor { id } parent { id } issue { id team { id } archivedAt trashed }`
const pageFields='pageInfo { hasNextPage endCursor }'

/** Issue/comment transport. Platform workflow state never completes an AgentHub goal. */
export class LinearSource extends MessageSource {
  private current?:SourceContext
  private account?:{id:string;user:string;type:string;verified:true}
  private api:Request
  private get options(){return this.config.options as unknown as Options}
  override get verificationCommand(){return this.options.command??'/agent'}
  constructor(config:SourceConfig,api?:Request){super(config);this.api=api??this.request.bind(this)}

  private async request(query:string,variables:Record<string,unknown>={}){
    if((this.current?.store.get<number>('plugin-state','retryAt')??0)>Date.now())throw Error('Linear retry window has not elapsed')
    const token=process.env[this.options.tokenEnv]
    if(!token)throw Error('Linear credential is unavailable')
    const url=new URL(this.options.apiBase??'https://api.linear.app/graphql')
    if(url.href!=='https://api.linear.app/graphql'&&!(url.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(url.hostname)&&!url.username&&!url.password))throw Error('Linear API must use its official endpoint or a local test service')
    const response=await fetch(url,{method:'POST',headers:{'content-type':'application/json',authorization:(this.options.authType==='oauth'?'Bearer ':'')+token},body:JSON.stringify({query,variables}),redirect:'error',signal:AbortSignal.timeout(15000)})
    if(response.status===429){this.defer(response.headers.get('retry-after'));throw Error('Linear rate limited')}
    if(!response.ok)throw Error('Linear HTTP request failed: '+response.status)
    const reader=response.body?.getReader();if(!reader)throw Error('Linear response is empty')
    const chunks:Uint8Array[]=[];let size=0
    try{for(;;){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.byteLength;if(size>4_000_000)throw Error('Linear response exceeds limit');chunks.push(chunk.value)}}finally{await reader.cancel()}
    const result=JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if(result.errors?.length){
      if(result.errors.some((e:any)=>e.extensions?.code==='RATELIMITED'))this.defer(response.headers.get('retry-after'))
      // Never expose server text that could contain request content or credentials.
      throw Error('Linear GraphQL operation failed; partial data rejected')
    }
    if(!result.data||typeof result.data!=='object')throw Error('Linear response has no data')
    return result.data
  }
  private defer(value:string|null){const seconds=Number(value);this.current?.store.put('plugin-state','retryAt',Date.now()+Math.min(86400,Number.isFinite(seconds)&&seconds>0?seconds:60)*1000)}
  private allowed(team:unknown):team is string{return typeof team==='string'&&this.options.teams.includes(team)}
  private allowedIssue(id:unknown):id is string{return uuid(id)&&(!this.options.issueIds||this.options.issueIds.includes(id))}
  validThread(thread:string){const [team,id,...extra]=thread.split(':');return extra.length===0&&this.allowed(team)&&this.allowedIssue(id)}
  private assertIssue(issue:any,team:string,id?:string){
    if(!issue||!this.allowed(team)||issue.team?.id!==team||!this.allowedIssue(issue.id)||id&&issue.id!==id||issue.archivedAt||issue.trashed)throw Error('Linear issue is unavailable or outside connection')
    return issue
  }
  private next(connection:any,previous:string|null):string|null{
    if(!connection||!Array.isArray(connection.nodes)||typeof connection.pageInfo?.hasNextPage!=='boolean')throw Error('Linear page is incomplete')
    if(!connection.pageInfo.hasNextPage)return null
    const next=connection.pageInfo.endCursor
    if(typeof next!=='string'||!next||next.length>1000||next===previous)throw Error('Linear pagination did not advance')
    return next
  }
  async identity(){
    const data=await this.api(`query AgentHubIdentity { viewer { ${userFields} } organization { id } }`)
    if(data.organization?.id!==this.options.workspaceId||!uuid(data.viewer?.id)||typeof data.viewer.app!=='boolean'||data.viewer.active!==true)throw Error('Linear workspace or account identity mismatch')
    this.account={id:this.options.workspaceId+':'+data.viewer.id,user:data.viewer.id,type:data.viewer.app?'bot':'user',verified:true}
    const saved=this.current?.store.get<any>('source-identity',this.config.id)
    if(saved&&saved.principal!==this.account.id)throw Error('Linear connection account changed')
    return this.account
  }
  async start(context:SourceContext){this.current=context;await this.identity()}
  async close(){this.current=undefined}
  async probe(){
    const identity=await this.identity(),choices:{id:string;label:string}[]=[]
    // Probe only configured teams; no workspace-wide issue discovery.
    for(const id of this.options.teams){
      const {team}=await this.api('query AgentHubTeam($id:String!){team(id:$id){id name archivedAt organization{id}}}',{id})
      if(team?.id!==id||team.archivedAt||team.organization?.id!==this.options.workspaceId)throw Error('Linear team is unavailable')
      choices.push({id,label:team.name})
    }
    return {identity,choices}
  }
  async members(team=this.options.teams[0]!){
    if(!this.allowed(team))throw Error('Linear team is outside connection')
    await this.identity();let after:string|null=null;const members=new Map<string,{id:string;name:string;bot:boolean}>(),seen=new Set<string>()
    for(let page=0;page<100;page++){
      const data=await this.api(`query AgentHubMembers($id:String!,$after:String){team(id:$id){id archivedAt organization{id} members(first:100,after:$after){nodes{${userFields}} ${pageFields}}}}`,{id:team,after})
      if(data.team?.id!==team||data.team.archivedAt||data.team.organization?.id!==this.options.workspaceId)throw Error('Linear team membership is unavailable')
      const next=this.next(data.team.members,after)
      for(const user of data.team.members.nodes){if(!uuid(user.id)||typeof user.app!=='boolean'||typeof user.active!=='boolean')throw Error('Linear member identity is incomplete');if(user.active)members.set(user.id,{id:user.id,name:user.name,bot:user.app})}
      if(!next)return [...members.values()]
      if(seen.has(next))throw Error('Linear membership cursor repeated');seen.add(next);after=next
    }
    throw Error('Linear membership exceeds page limit')
  }
  private issueText(issue:any){if(typeof issue.title!=='string'||issue.description!=null&&typeof issue.description!=='string')throw Error('Linear issue content is invalid');return issue.title+(issue.description?'\n\n'+issue.description:'')}
  private async observe(item:any,stream:Stream,team:string,ctx:SourceContext){
    const issue=stream==='issues'?item:item.issue
    if(!issue||issue.team?.id!==team||!this.allowedIssue(issue.id))throw Error('Linear response escaped configured issue scope')
    if(!uuid(item.id)||!date(item.createdAt)||!date(item.updatedAt))throw Error('Linear event identity is invalid')
    const messageId=(stream==='issues'?'issue:':'comment:')+item.id,key=this.config.id+':'+team+':'+messageId
    const old=await record<Observation>(ctx,'source-message-observation',key)
    if(old?.revised||old?.outgoing||await record(ctx,'source-message-state',bodyDigest([this.config.id,team,messageId])))return
    const text=stream==='issues'?this.issueText(item):item.body
    if(typeof text!=='string'||text.length>100000)throw Error('Linear message content exceeds limit or is invalid')
    const hash=bodyDigest(text),deleted=!!(item.archivedAt||issue.archivedAt||issue.trashed)
    const revised=deleted||!!old&&old.hash!==hash||stream==='comments'&&!!item.editedAt
    if(revised){
      ctx.store.put('source-message-observation',key,{sourceId:this.config.id,scope:team,messageId,hash,revised:true})
      ctx.change?.({id:'linear:'+messageId+':'+hash+':'+item.updatedAt,kind:deleted?'message.deleted':'message.updated',scope:team,messageId,...(!deleted?{contentHash:hash}:{}),at:Date.parse(item.updatedAt)})
      return
    }
    if(old)return
    const actor=stream==='issues'?item.creator:item.user
    // An unseen modified issue cannot safely be attributed to its original creator.
    if(stream==='issues'&&item.createdAt!==item.updatedAt)return
    if(!actor||!uuid(actor.id)||actor.active!==true||typeof actor.app!=='boolean'||!text.trim())return
    if(actor.id===this.account?.user&&actor.app)return
    ctx.store.put('source-message-observation',key,{sourceId:this.config.id,scope:team,messageId,hash})
    const human=!actor.app&&!item.botActor
    const trigger=this.trigger({id:'message:'+team+':'+messageId+':'+hash,thread:team+':'+issue.id,text,addressed:text===this.verificationCommand||text.startsWith(this.verificationCommand+' ')||text.startsWith(this.verificationCommand+'\n'),scope:team,at:new Date(item.createdAt).toISOString()},actor.id,human)
    trigger.meta={scope:team,issueId:issue.id,messageId,entityId:item.id,entityType:stream==='issues'?'issue':'comment'}
    trigger.channel!.address={team,issueId:issue.id,messageId,entityId:item.id,entityType:stream==='issues'?'issue':'comment',contentHash:hash}
    ctx.receive(trigger)
  }
  async poll(context:SourceContext){
    this.current=context
    if((context.store.get<number>('plugin-state','retryAt')??0)>Date.now())throw Error('Linear retry window has not elapsed')
    await this.identity()
    for(const team of this.options.teams){
      const key=this.config.id+':'+team,since=context.store.get<{since:string}>('source-cursor',key)?.since??new Date(Date.now()-10000).toISOString()
      if(!date(since))throw Error('Linear replay cursor is invalid')
      if(!context.store.get('source-cursor',key))context.store.put('source-cursor',key,{since})
      const progressKey='window:'+team,filterHash=bodyDigest(this.options.issueIds??null),saved=context.store.get<Window>('plugin-state',progressKey)
      let window:Window=saved?.since===since&&saved.filterHash===filterHash?saved:{since,until:new Date().toISOString(),stream:'issues',after:null,filterHash}
      const seen=new Set<string>()
      for(let page=0;page<5;page++){
        const position=window.stream+':'+window.after;if(seen.has(position))throw Error('Linear pagination cursor repeated');seen.add(position)
        const issueFilter={team:{id:{eq:team}},...(this.options.issueIds?{id:{in:this.options.issueIds}}:{})}
        const filter={...(window.stream==='issues'?issueFilter:{issue:issueFilter}),updatedAt:{gte:window.since,lte:window.until}}
        const stream=window.stream,query=stream==='issues'?`query AgentHubIssues($filter:IssueFilter!,$after:String,$first:Int!){issues(filter:$filter,after:$after,first:$first,includeArchived:true,orderBy:updatedAt){nodes{${issueFields}} ${pageFields}}}`:`query AgentHubComments($filter:CommentFilter!,$after:String,$first:Int!){comments(filter:$filter,after:$after,first:$first,includeArchived:true,orderBy:updatedAt){nodes{${commentFields}} ${pageFields}}}`
        const data=await this.api(query,{filter,after:window.after,first:this.options.pageSize??50}),connection=data[stream],next=this.next(connection,window.after)
        for(const item of [...connection.nodes].reverse())await this.observe(item,stream,team,context)
        if(next)window={...window,after:next}
        else if(stream==='issues')window={...window,stream:'comments',after:null}
        else{
          context.store.put('plugin-state',progressKey,null)
          context.store.put('source-cursor',key,{since:new Date(Math.max(Date.parse(since),Date.parse(window.until)-2000)).toISOString()})
          await context.checkpoint?.();break
        }
        context.store.put('plugin-state',progressKey,window);await context.checkpoint?.()
      }
    }
  }
  private async issue(team:string,id:string){
    if(!this.allowed(team)||!this.allowedIssue(id))throw Error('Linear issue is outside connection')
    const data=await this.api(`query AgentHubIssue($id:String!){issue(id:$id){${issueFields}}}`,{id})
    return this.assertIssue(data.issue,team,id)
  }
  private async anchor(trigger:Trigger){
    const {scope,issueId,entityId,entityType,messageId}=trigger.meta
    if(trigger.source!==this.config.id||!this.allowed(scope)||!this.allowedIssue(issueId)||!uuid(entityId)||!['issue','comment'].includes(String(entityType))||messageId!==entityType+':'+entityId)throw Error('An authorized Linear trigger is required')
    const issue=await this.issue(scope,issueId)
    let message:any=issue
    if(entityType==='comment'){
      const data=await this.api(`query AgentHubComment($id:String!){comment(id:$id){${commentFields}}}`,{id:entityId});message=data.comment
      if(!message||message.id!==entityId||message.issue?.id!==issueId||message.archivedAt||message.editedAt)throw Error('Linear comment is unavailable or changed')
      this.assertIssue(message.issue,scope,issueId)
    }else if(entityId!==issueId)throw Error('Linear issue anchor mismatch')
    if(bodyDigest(entityType==='issue'?this.issueText(message):message.body)!==bodyDigest(trigger.text))throw Error('Linear source content changed')
    return {issue,message,team:scope,issueId}
  }
  async read({resource,trigger,pageSize}:{resource:string;trigger?:Trigger;pageSize:number}){
    if(!trigger)throw Error('An authorized Linear trigger is required')
    await this.identity();const {issue,message,team,issueId}=await this.anchor(trigger)
    const [kind,encoded,...extra]=resource.split('/');if(extra.length||encoded&&kind!=='thread')throw Error('Invalid Linear resource')
    if(kind==='message')return {message}
    if(kind==='issue')return {issue}
    if(kind!=='thread')throw Error('Unknown Linear resource')
    const after=encoded?decodeURIComponent(encoded):null
    if(after&&after.length>1000)throw Error('Linear cursor exceeds limit')
    const data=await this.comments(team,issueId,Math.max(1,Math.min(100,pageSize)),after),next=this.next(data,after)
    return {messages:data.nodes,next_resource:next?'trigger-source/'+trigger.id+'/thread/'+encodeURIComponent(next):null}
  }
  private async comments(team:string,id:string,first:number,after:string|null){
    const data=await this.api(`query AgentHubThread($id:String!,$first:Int!,$after:String){issue(id:$id){id team{id} archivedAt trashed comments(first:$first,after:$after){nodes{${commentFields}} ${pageFields}}}}`,{id,first,after})
    this.assertIssue(data.issue,team,id);this.next(data.issue.comments,after)
    for(const c of data.issue.comments.nodes)this.assertIssue(c.issue,team,id)
    return data.issue.comments
  }
  async context(thread:string){
    if(!this.validThread(thread))throw Error('Linear thread is outside connection')
    await this.identity();const [team,id]=thread.split(':') as [string,string],issue=await this.issue(team,id),comments=await this.comments(team,id,50,null)
    return {issue,comments:comments.nodes,hasMore:comments.pageInfo.hasNextPage}
  }
  async deliver(message:OutboundMessage){
    const {team,issueId,entityId,entityType,messageId,contentHash}=message.channel.address
    if(!this.current||message.channel.source!==this.config.id||!this.validThread(message.channel.thread)||message.channel.thread!==team+':'+issueId||!uuid(entityId)||!['issue','comment'].includes(entityType??'')||messageId!==entityType+':'+entityId||!contentHash||!/^[a-f0-9]{64}$/.test(contentHash))throw Error('Linear reply is outside an active connection')
    await this.identity();const issue=await this.issue(team!,issueId!)
    if(entityType==='comment'){
      const data=await this.api(`query AgentHubReplyAnchor($id:String!){comment(id:$id){${commentFields}}}`,{id:entityId})
      if(data.comment?.id!==entityId||data.comment.archivedAt||data.comment.editedAt)throw Error('Linear reply anchor changed or disappeared')
      this.assertIssue(data.comment.issue,team!,issueId!)
      if(bodyDigest(data.comment.body)!==contentHash)throw Error('Linear reply anchor content changed')
    }else if(entityId!==issueId||bodyDigest(this.issueText(issue))!==contentHash)throw Error('Linear reply anchor mismatch')
    const hash=createHash('sha256').update(this.config.id+':'+message.id).digest('hex'),id=hash.slice(0,8)+'-'+hash.slice(8,12)+'-4'+hash.slice(13,16)+'-a'+hash.slice(17,20)+'-'+hash.slice(20,32)
    // Fence our own comment even if the mutation succeeds but its response is lost.
    this.current.store.put('source-message-observation',this.config.id+':'+team+':comment:'+id,{sourceId:this.config.id,scope:team,messageId:'comment:'+id,hash:bodyDigest(message.text),outgoing:true})
    await this.current.checkpoint?.()
    try{
      const data=await this.api('mutation AgentHubReply($input:CommentCreateInput!){commentCreate(input:$input){success comment{id body issue{id team{id}}}}}',{input:{id,issueId,body:message.text}})
      if(data.commentCreate?.success!==true||data.commentCreate.comment?.id!==id||data.commentCreate.comment.body!==message.text)throw Error('Linear comment receipt mismatch')
      this.assertIssue(data.commentCreate.comment.issue,team!,issueId!)
    }catch{throw new UncertainDelivery('Linear reply outcome unknown; reconcile the deterministic comment ID before retry')}
  }
}
export default {create:(config:SourceConfig)=>new LinearSource(config)}
