import {createHash} from 'node:crypto'
import { spawn,execFile } from 'node:child_process'
import {promisify} from 'node:util'
import { MessageSource, UncertainDelivery, bodyDigest, type SourceContext } from '../sources.ts'
import type { SourceConfig } from '../config.ts'
import type { Trigger, OutboundMessage } from '../vendor/dsh-core/index.ts'

export interface GithubApi { request(method:string,path:string,body?:unknown,signal?:AbortSignal):Promise<any> }
/** Native REST transport; credentials stay in memory and are sent only to api.github.com. */
export class GithubHttpApi implements GithubApi {
  private token=''
  private expires=0
  constructor(private readonly binary='gh',private readonly tokenEnv?:string){}
  private async credential(){
    if(this.tokenEnv){const token=process.env[this.tokenEnv];if(!token)throw Error('Configured GitHub credential is unavailable');return token}
    if(Date.now()>=this.expires){
      try{const result=await promisify(execFile)(this.binary,['auth','token','--hostname','github.com'],{timeout:10000,encoding:'utf8'});this.token=result.stdout.trim();this.expires=Date.now()+300000}
      catch{throw Error('GitHub CLI authentication is unavailable')}
    }
    if(!this.token)throw Error('GitHub credential is empty')
    return this.token
  }
  async request(method:string,path:string,body?:unknown,signal?:AbortSignal):Promise<any>{
    const url=new URL(path,'https://api.github.com/')
    if(url.origin!=='https://api.github.com')throw Error('GitHub request must stay on api.github.com')
    const token=await this.credential()
    for(let attempt=0;;attempt++){
      signal?.throwIfAborted()
      try{
        const response=await fetch(url,{method,headers:{authorization:'Bearer '+token,accept:'application/vnd.github+json','x-github-api-version':'2022-11-28','user-agent':'agent-hub/0.5.0',...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)}),redirect:'error',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(15000)]):AbortSignal.timeout(15000)})
        if(!response.ok){if(response.status===401)this.expires=0;throw Error('GitHub API HTTP '+response.status)}
        if(response.status===204)return null
        return await response.json()
      }catch(error){
        if(method!=='GET'||signal?.aborted||attempt>=2||String(error).includes('GitHub API HTTP'))throw error
        await new Promise(resolve=>setTimeout(resolve,250*2**attempt))
      }
    }
  }
}
export class GhApi implements GithubApi {
  constructor(private readonly binary='gh'){}
  async request(method:string,path:string,body?:unknown,signal?:AbortSignal):Promise<any>{
    for(let attempt=0;;attempt++){
      signal?.throwIfAborted()
      try{return await this.once(method,path,body,signal)}
      catch(error){
        if(method!=='GET'||attempt>=2||!/(EOF|timeout|connection|TLS|closed)/i.test(String(error)))throw error
        await new Promise(resolve=>setTimeout(resolve,250*2**attempt))
      }
    }
  }
  private once(method:string,path:string,body?:unknown,signal?:AbortSignal):Promise<any>{
    return new Promise((resolve,reject)=>{
      const child=spawn(this.binary,['api','--method',method,path,...(body===undefined?[]:['--input','-'])],{signal,stdio:['pipe','pipe','pipe'],shell:false,env:{...process.env,GODEBUG:(process.env.GODEBUG?process.env.GODEBUG+',':'')+'http2client=0'}})
      let output='',errors=''
      const timeout=setTimeout(()=>child.kill('SIGTERM'),20000)
      child.stdout.on('data',chunk=>{output+=chunk;if(output.length>8_000_000)child.kill('SIGTERM')})
      child.stderr.on('data',chunk=>{if(errors.length<500)errors+=chunk})
      child.on('error',error=>{clearTimeout(timeout);reject(error)})
      child.on('close',code=>{clearTimeout(timeout);if(code!==0)reject(Error('GitHub API failed ('+code+'): '+errors.slice(0,200)));else{try{resolve(output.trim()?JSON.parse(output):null)}catch{reject(Error('Invalid GitHub response'))}}})
      child.stdin.end(body===undefined?undefined:JSON.stringify(body))
    })
  }
}
export class GithubSource extends MessageSource {
  static authorizeRead(config:SourceConfig,ticket:import('../vendor/dsh-core/index.ts').Ticket,resource:string){
    const source=config.id,threads=[...ticket.channels.filter(c=>c.source===source).map(c=>c.thread),...(ticket.follows??[]).filter(f=>f.thread.startsWith(source+':')).map(f=>f.thread.slice(source.length+1))]
    const match=/^(?:github\/)?(?:issues|pulls)\/(\d+)/.exec(resource)
    if(match&&!threads.some(t=>t.split('#').at(-1)===match[1]))throw Error('GitHub conversation is outside this worker')
  }
  override get verificationCommand(){return this.config.github?.command??'/agent'}
  replay(_scope:string|undefined,since:string){return {key:this.config.id,since}}
  references(thread:string){return this.validThread(thread)?['https://github.com/'+this.repo+'/pull/'+thread.split('#').at(-1)]:[]}
  private readonly api:GithubApi
  private account?:string
  constructor(config:SourceConfig,api?:GithubApi){super(config);if(!config.repository)throw Error('GitHub repository required');this.api=api??(config.github?.transport==='gh'?new GhApi(config.github.gh):new GithubHttpApi(config.github?.gh,config.github?.tokenEnv))}
  private get repo(){return this.config.repository!}
  async identity(){const user=await this.api.request('GET','user');this.account=user.login;return {id:user.login,type:user.type==='Bot'?'bot':'user'}}
  async isPullRequest(trigger:Trigger):Promise<boolean>{
    const thread=trigger.threads.find(t=>t.source===this.config.id)?.id
    if(!thread||!this.validThread(thread))return false
    const issue=await this.api.request('GET','repos/'+this.repo+'/issues/'+Number(thread.split('#').at(-1)))
    return !!issue.pull_request
  }
  async members(){return (await this.pages('repos/'+this.repo+'/collaborators')).map(u=>({id:u.login,name:u.name,bot:u.type==='Bot'}))}
  private addressed(text:string){return text.includes(this.config.github?.command??'/agent')||!!this.account&&new RegExp('(^|[^a-zA-Z0-9_])@'+this.account+'(?![a-zA-Z0-9_-])','i').test(text)}
  validThread(thread:string){const number=Number(thread.split('#').at(-1));return Number.isSafeInteger(number)&&number>0&&thread===this.thread(number)}
  private thread(number:number){return this.repo+'#'+number}
  private async pages(path:string,key?:string,signal?:AbortSignal):Promise<any[]>{
    const result:any[]=[]
    for(let page=1;page<=20;page++){
      signal?.throwIfAborted()
      const data=await this.api.request('GET',path+(path.includes('?')?'&':'?')+'per_page=100&page='+page,undefined,signal)
      const items=key?data[key]:data
      if(!Array.isArray(items))throw Error('Invalid GitHub page')
      result.push(...items)
      if(items.length<100)return result
    }
    throw Error('GitHub pagination limit reached; cursor retained')
  }
  private event(item:any,number:number,kind:string,text:string):Trigger{
    const trigger=this.trigger({id:kind+':'+item.id+':'+bodyDigest(text),thread:this.thread(number),text,addressed:this.addressed(text)},item.user?.login??'github-ci',item.user?.type!=='Bot'&&!!item.user)
    trigger.meta={scope:kind,number,url:item.html_url,repository:this.repo,...(item.commit_id?{head:item.commit_id}:{})}
    trigger.channel!.address={number:String(number),url:item.html_url??'',...(kind==='review-comments'?{reviewComment:String(item.in_reply_to_id??item.id)}:{})}
    return trigger
  }
  async poll(ctx:SourceContext):Promise<void>{
    if(!this.account)this.account=(await this.api.request('GET','user',undefined,ctx.signal))?.login
    const state=ctx.store.get<{since:string}>('source-cursor',this.config.id)
    const since=state?.since??new Date(Date.now()-10000).toISOString()
    if(!ctx.store.get('source-cursor',this.config.id))ctx.store.put('source-cursor',this.config.id,{since})
    const boundary=new Date().toISOString()
    for(const kind of ['issues','issues/comments']){
      for(let page=1;page<=20;page++){
        const items=await this.api.request('GET','repos/'+this.repo+'/'+kind+'?since='+encodeURIComponent(since)+'&sort=updated&direction=asc&per_page=100&page='+page,undefined,ctx.signal)
        if(!Array.isArray(items))throw Error('Invalid GitHub event list')
        for(const item of items){
          const number=kind==='issues'?item.number:Number(item.issue_url?.split('/').at(-1))
          if(!Number.isSafeInteger(number))continue
          const text=kind==='issues'?(item.title??'')+'\n'+(item.body??''):item.body??''
          if(kind==='issues'&&item.pull_request){
            const pull=await this.api.request('GET','repos/'+this.repo+'/pulls/'+number,undefined,ctx.signal)
            if(pull.head?.repo?.full_name?.toLowerCase()===this.repo.toLowerCase()){
              const ticket=ctx.store.tickets.list().find(t=>t.mandate.actor.source===this.config.id&&pull.head.ref==='superagent/'+createHash('sha256').update(t.id).digest('hex').slice(0,20))
              if(ticket)ctx.bind(ticket.id,this.thread(number),true)
            }
          }
          if(text.includes('<!-- superagent:'))continue
          const subscribed=!!ctx.store.threads.get(this.config.id+':'+this.thread(number))?.subscriptions.length
          if(this.config.github?.receiveAll||this.addressed(text)||subscribed)ctx.receive(this.event(item,number,kind==='issues'?'issue':'comment',text))
        }
        if(items.length<100)break
        if(page===20)throw Error('GitHub pagination limit reached; cursor retained')
      }
    }
    for(const thread of ctx.store.threads.list().filter(t=>t.ref.source===this.config.id&&t.subscriptions.length)){
      const tickets=thread.subscriptions.map(id=>ctx.store.tickets.get(id))
      const activity=[thread.lastAt??thread.createdAt,...tickets.map(ticket=>ticket?.ended?.at??'')].map(Date.parse).filter(Number.isFinite)
      // Match the prototype: retain polling for live work or two weeks after the latest message/completion.
      if(!tickets.some(ticket=>ticket&&!ticket.ended)&&Date.now()-Math.max(...activity)>=14*24*3600000)continue
      const cursorKey=this.config.id+':'+thread.ref.id,threadSince=ctx.store.get<{since:string}>('thread-cursor',cursorKey)?.since??since
      let success=false
      try{
      const number=Number(thread.ref.id.split('#').at(-1))
      const issue=await this.api.request('GET','repos/'+this.repo+'/issues/'+number,undefined,ctx.signal)
      const pull=issue.pull_request?await this.api.request('GET','repos/'+this.repo+'/pulls/'+number,undefined,ctx.signal):undefined
      if(issue.state==='closed')ctx.closed(thread.ref.id,pull?.merged_at?'merged':'closed',issue.closed_at??boundary)
      if(issue.pull_request){
        for(const suffix of ['comments','reviews']){
          const items=await this.pages('repos/'+this.repo+'/pulls/'+number+'/'+suffix,undefined,ctx.signal)
          for(const item of items){const text=suffix==='reviews'?[item.state,item.body??''].filter(Boolean).join('\n'):item.body??'';if((item.submitted_at??item.updated_at??'')>=threadSince&&text&&!text.includes('<!-- superagent:'))ctx.receive(this.event(item,number,'review-'+suffix,text))}
        }
        const checks=issue.state==='closed'?[]:await this.pages('repos/'+this.repo+'/commits/'+pull.head.sha+'/check-runs','check_runs',ctx.signal)
        for(const check of checks){
          if(check.status!=='completed')continue
          const trigger=this.event({id:check.id,updated_at:check.completed_at,user:{login:'github-ci',type:'Bot'}},number,'ci',JSON.stringify({sha:pull.head.sha,name:check.name,conclusion:check.conclusion,url:check.html_url}))
          ctx.receive(trigger)
        }
      }
      success=true
      }catch(error){const previous=ctx.store.get<any>('thread-health',cursorKey);ctx.store.put('thread-health',cursorKey,{thread:thread.key,source:this.config.id,at:Date.now(),consecutiveFailures:(previous?.consecutiveFailures??0)+1,error:String(error).slice(0,300)})}
      finally{if(success){ctx.store.put('thread-cursor',cursorKey,{since:new Date(Date.parse(boundary)-2000).toISOString()});ctx.store.put('thread-health',cursorKey,{thread:thread.key,source:this.config.id,at:Date.now(),consecutiveFailures:0})}}
    }
    ctx.store.put('source-cursor',this.config.id,{since:new Date(Date.parse(boundary)-2000).toISOString()})
  }
  async context(thread:string){const number=Number(thread.split('#').at(-1));if(!Number.isSafeInteger(number)||thread!==this.thread(number))throw Error('Thread is outside configured repository');return {issue:await this.api.request('GET','repos/'+this.repo+'/issues/'+number),comments:await this.pages('repos/'+this.repo+'/issues/'+number+'/comments')}}
  async read(request:{resource:string;pageSize:number}){
    const resource=request.resource.replace(/^github\//,''),message=(x:any)=>({id:String(x.id??x.number),from:x.user?.login??'github',at:x.submitted_at??x.created_at,text:x.body??'',bot:x.user?.type==='Bot',url:x.html_url,...(x.path?{path:x.path,line:x.line??x.original_line}:{}),...(x.in_reply_to_id?{reply_to:String(x.in_reply_to_id)}:{})})
    const file=/^(file|directory)\/(.*)$/.exec(resource)
    if(file){
      const parts=file[2]!.split('/').filter(Boolean)
      if(parts.some(p=>p==='..'||p.startsWith('.')||p==='node_modules'))throw Error('Repository path is outside source resources')
      const result=await this.api.request('GET','repos/'+this.repo+'/contents/'+parts.map(encodeURIComponent).join('/'))
      if(file[1]==='directory'){if(!Array.isArray(result))throw Error('Not a directory');return result.filter(x=>!x.name.startsWith('.')&&x.name!=='node_modules').map(x=>({name:x.name,type:x.type}))}
      if(result.type!=='file'||result.encoding!=='base64'||result.size>8000000)throw Error('File is unavailable or too large')
      const data=Buffer.from(result.content,'base64');if(data.includes(0))throw Error('Binary repository file');return data.toString('utf8')
    }
    const commit=/^commits\/([a-f0-9]{7,40})\/checks$/.exec(resource)
    if(commit)return this.checks(commit[1]!)
    const m=/^(issues|pulls)\/([1-9]\d*)(?:\/(comments|reviews|checks|thread)(?:\/([1-9]\d*))?)?$/.exec(resource)
    if(!m)throw Error('Unknown GitHub resource')
    const [,kind,number,section,page='1']=m
    if(kind==='issues'&&['reviews','checks','thread'].includes(section??''))throw Error('PR resource required')
    const path='repos/'+this.repo+'/'+kind+'/'+number
    if(!section){const x=await this.api.request('GET',path);return {number:x.number,title:x.title,state:x.state,draft:x.draft,merged:x.merged,head:x.head?.sha,base:x.base?.ref,...message(x)}}
    if(section==='checks'){if(m[4])throw Error('Checks do not take a page');const pull=await this.api.request('GET',path);return this.checks(pull.head.sha)}
    if(section==='thread'){
      if(!m[4])throw Error('Name an inline review comment')
      const comments=await this.pages(path+'/comments'),at=comments.find(x=>String(x.id)===page),root=at?.in_reply_to_id??at?.id
      if(!root)throw Error('Unknown review thread')
      return {messages:comments.filter(x=>x.id===root||x.in_reply_to_id===root).map(message)}
    }
    const items=await this.api.request('GET',path+'/'+section+'?per_page='+request.pageSize+'&page='+page)
    return {messages:items.map((x:any)=>({...message(x),...(section==='reviews'?{state:x.state,head:x.commit_id}:{})})),next_resource:items.length===request.pageSize?'github/'+kind+'/'+number+'/'+section+'/'+(Number(page)+1):null}
  }
  async checks(head:string){
    const checks=await this.pages('repos/'+this.repo+'/commits/'+head+'/check-runs','check_runs')
    const statuses=await this.pages('repos/'+this.repo+'/commits/'+head+'/statuses')
    const latest=new Map<string,any>();for(const s of statuses)if(!latest.has(s.context))latest.set(s.context,s)
    return {head,checks:checks.map(x=>({name:x.name,status:x.status,conclusion:x.conclusion})),statuses:[...latest.values()].map(x=>({context:x.context,state:x.state}))}
  }
  async reviewGraph(number:number){
    const nodes:any[]=[],query='query($owner:String!,$repo:String!,$number:Int!,$after:String){repository(owner:$owner,name:$repo){pullRequest(number:$number){id autoMergeRequest{enabledAt} reviewThreads(first:100,after:$after){nodes{id isResolved isOutdated comments(first:1){nodes{databaseId}}} pageInfo{hasNextPage endCursor}}}}}'
    let after:string|undefined
    for(let page=0;page<20;page++){
      const data=await this.api.request('POST','graphql',{query,variables:{owner:this.repo.split('/')[0],repo:this.repo.split('/')[1],number,...(after?{after}:{})}})
      if(data.errors)throw Error('Review snapshot unavailable')
      const pull=data.data?.repository?.pullRequest,threads=pull?.reviewThreads
      if(!threads||!Array.isArray(threads.nodes))throw Error('Incomplete review snapshot')
      nodes.push(...threads.nodes)
      if(!threads.pageInfo.hasNextPage)return {...pull,reviewThreads:{nodes,pageInfo:{hasNextPage:false}}}
      if(!threads.pageInfo.endCursor||threads.pageInfo.endCursor===after)throw Error('Invalid review page cursor')
      after=threads.pageInfo.endCursor
    }
    throw Error('Review pagination limit reached')
  }
  async mergeSnapshot(number:number){
    const pull=await this.api.request('GET','repos/'+this.repo+'/pulls/'+number),reviews=await this.pages('repos/'+this.repo+'/pulls/'+number+'/reviews'),checks=await this.checks(pull.head.sha),actor=await this.api.request('GET','user')
    return {pull,reviews,checks,actor:actor.login,graph:await this.reviewGraph(number)}
  }
  async deliver(message:OutboundMessage):Promise<void>{
    const number=Number(message.channel.address.number)
    if(!Number.isSafeInteger(number))throw Error('Invalid GitHub reply address')
    const marker='<!-- superagent:'+message.id+' -->'
    const review=message.channel.address.reviewComment
    if(review&&!/^[1-9]\d*$/.test(review))throw Error('Invalid review reply address')
    const existing=await this.pages('repos/'+this.repo+(review?'/pulls/':'/issues/')+number+'/comments')
    if(existing.some((item:any)=>String(item.body).includes(marker)))return
    try{await this.api.request('POST','repos/'+this.repo+(review?'/pulls/'+number+'/comments/'+review+'/replies':'/issues/'+number+'/comments'),{body:message.text+'\n\n'+marker})}
    catch{throw new UncertainDelivery('GitHub comment outcome unknown; reconcile marker before replay')}
  }
  async resolveReview(number:number,threadId:string,mayAct:()=>boolean=()=>true){
    const graph=await this.reviewGraph(number),thread=graph.reviewThreads.nodes.find((t:any)=>t.id===threadId)
    if(!thread)throw Error('Review thread is outside this PR')
    if(thread.isResolved)return
    if(!mayAct())throw Error('Review mutation is no longer authorized')
    const result=await this.api.request('POST','graphql',{query:'mutation($id:ID!){resolveReviewThread(input:{threadId:$id}){thread{isResolved}}}',variables:{id:threadId}})
    if(result.errors||!result.data?.resolveReviewThread?.thread?.isResolved)throw Error('Review resolution unconfirmed')
  }
  async draft(head:string,title:string,body:string){
    if(!/^superagent\/[a-z0-9-]+$/.test(head))throw Error('Only a superagent branch can be delivered')
    const metadata=await this.api.request('GET','repos/'+this.repo)
    const base=metadata.default_branch
    const existing=await this.api.request('GET','repos/'+this.repo+'/pulls?state=open&head='+encodeURIComponent(this.repo.split('/')[0]+':'+head))
    return existing[0]??this.api.request('POST','repos/'+this.repo+'/pulls',{head,base,title,body:body+'\n\n<!-- superagent:branch:'+head+' -->',draft:true})
  }
}
