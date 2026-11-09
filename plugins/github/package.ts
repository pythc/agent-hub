import {GithubSource,GithubHttpApi,type GithubApi} from './github.ts'
import type {SourceConfig,SourceContext,Trigger} from '../sdk.ts'

type HostContext=SourceContext&{beforeRepositoryWrite():Promise<void>}
function transport(config:SourceConfig,context:HostContext,tokenEnv:string):GithubApi {
 const api=new GithubHttpApi('unavailable',tokenEnv,config.options.apiBase as string|undefined)
 return {async request(method,path,body,signal){
  const write=method==='PUT'||method==='POST'&&(/\/pulls$/.test(path)||path==='graphql'&&/^\s*mutation\b/.test(String((body as any)?.query)))
  if(write)await context.beforeRepositoryWrite()
  return api.request(method,path,body,signal)
 }}
}
export class PackagedGithub extends GithubSource {
 constructor(config:SourceConfig,private host:HostContext){
  if(!config.github?.tokenEnv||config.github.transport!=='http'||!Array.isArray(config.options.repositories)||config.options.repositories.length!==1||config.options.repositories[0]!==config.repository)throw Error('GitHub package requires an explicit repository and HTTP token identity')
  super(config,transport(config,host,config.github.tokenEnv))
 }
 protected override mergeApi():GithubApi {
  const env=this.config.options.mergeTokenEnv
  if(typeof env!=='string'||!env)throw Error('A separate merge credential is required')
  return transport(this.config,this.host,env)
 }
 async probe(){
  const identity=await this.identity(),repo=await this.api.request('GET','repos/'+this.repo)
  if(repo.full_name?.toLowerCase()!==this.repo.toLowerCase())throw Error('Repository identity mismatch')
  return {identity,choices:[{id:this.repo,label:repo.full_name}],permissions:{read:repo.permissions?.pull===true,push:repo.permissions?.push===true},version:'1.0.0'}
 }
 async close(){}
 override async read(request:{resource:string;pageSize:number;trigger?:Trigger}){
  if(!['message','thread','issue','pull','checks','files'].includes(request.resource))return super.read(request)
  const t=request.trigger,number=t?.meta.number
  if(!t||t.source!==this.config.id||t.meta.scope!==this.repo||t.meta.repository!==this.repo||!Number.isSafeInteger(number)||t.threads[0]?.id!==this.repo+'#'+number)throw Error('Repository resource requires a reached native trigger')
  if(request.resource==='thread')return super.read({resource:'issues/'+number+'/comments',pageSize:request.pageSize})
  if(request.resource==='issue'||request.resource==='pull')return super.read({resource:(request.resource==='issue'?'issues/':'pulls/')+number,pageSize:request.pageSize})
  if(request.resource==='checks')return super.read({resource:'pulls/'+number+'/checks',pageSize:request.pageSize})
  if(request.resource==='files'){
   const pull=await this.repositoryPull(Number(number)),files=await this.api.request('GET','repos/'+this.repo+'/pulls/'+number+'/files?per_page='+request.pageSize+'&page=1')
   return {head:pull.head,files,truncated:files.length===request.pageSize}
  }
  const kind=String(t.meta.eventKind),id=String(t.meta.nativeId)
  if(!/^\d+$/.test(id))throw Error('Native message identity unavailable')
  let item:any,text:string
  if(kind==='issue'){item=await this.api.request('GET','repos/'+this.repo+'/issues/'+number);text=(item.title??'')+'\n'+(item.body??'')}
  else if(kind==='comment'){item=await this.api.request('GET','repos/'+this.repo+'/issues/comments/'+id);if(Number(item.issue_url?.split('/').at(-1))!==number)throw Error('Comment moved outside its Issue');text=item.body??''}
  else if(kind==='review-comments'){item=await this.api.request('GET','repos/'+this.repo+'/pulls/comments/'+id);if(Number(item.pull_request_url?.split('/').at(-1))!==number)throw Error('Review moved outside its PR');text=item.body??''}
  else if(kind==='review-reviews'){item=await this.api.request('GET','repos/'+this.repo+'/pulls/'+number+'/reviews/'+id);text=[item.state,item.body??''].filter(Boolean).join('\n')}
  else if(kind==='ci'||kind==='ci-status'){const event=JSON.parse(t.text);return {event,checks:await this.checks(event.sha)}}
  else throw Error('Unsupported native message kind')
  if(text!==t.text||item.user?.login!==t.actor.id)throw Error('Admitted message changed; obtain fresh evidence')
  return {message:{id,text,actor:item.user.login,url:item.html_url}}
 }
}
export default {create:(config:SourceConfig,context:HostContext)=>new PackagedGithub(config,context)}
