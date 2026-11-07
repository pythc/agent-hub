/** Synthetic UI contract server. It never authenticates providers or executes agents. */
import {createServer} from 'node:http'
import {mkdirSync,readFileSync,writeFileSync,existsSync} from 'node:fs'
import {resolve,join} from 'node:path'
import {configSchema} from '../src/config.ts'
import {Runtime} from '../src/runtime.ts'
import {serve} from '../src/server.ts'
import {configurationPage} from '../src/ui/configuration.ts'

const root=resolve(process.argv[2]||'.local/frontend-contract-preview')
mkdirSync(root,{recursive:true})
const runtime=new Runtime(configSchema.parse({stateDir:join(root,'source-state'),port:0,
  codex:'/preview-not-installed/codex',work:{sandboxDriver:'disabled',network:false},
  sources:[{id:'local',kind:'local',cwd:root,allowedActors:['preview-operator']}],
  backends:{research:{kind:'openai-responses',label:'Research API',baseUrl:'http://127.0.0.1:9/v1',model:'preview-model'}}
}),{model:{async run(){throw Error('Frontend preview never executes model requests')}}})
runtime.pause(true)
const source=await serve(runtime,{configurationPreview:true})
const auth={authorization:'Bearer '+readFileSync(source.tokenPath,'utf8').trim()}
const base:Record<string,any>={}
for(const path of ['/configuration','/entry-setup','/entry-workspace','/entry-guide','/connect-info','/health','/prompts','/integrations']) {
  const response=await fetch(source.url+path,{headers:auth})
  if(response.ok)base[path]=await response.json()
}
await new Promise<void>(done=>source.server.close(()=>done()));await source.closeRuntime()
type Workspace={id:string;name:string;kind:'personal'|'organization';role:string;revision:number;config:any;history:any[]}
const initial=(id:string,name:string,kind:Workspace['kind']):Workspace=>{
  const config=structuredClone(base['/configuration'].current.config)
  config.execution={...config.execution,router:{backend:'codex',model:'gpt-6.1-terra',mode:'host',effort:'medium'},
    management:{enabled:true,maxWorkers:10},workers:Array.from({length:kind==='personal'?4:2},(_,index)=>({
      id:'worker-'+(index+1),label:(kind==='personal'?['研究','实现','验证','整理']:['分析','评审'])[index],
      backend:kind==='personal'?'codex':'research',model:kind==='personal'?'gpt-6.1-sol':'preview-model',effort:'high',
      prompt:'',parameters:{},state:'enabled'
    }))}
  config.concurrency=config.execution.workers.length
  return {id,name,kind,role:'owner',revision:0,config,history:[]}
}
const stateFile=join(root,'workspaces.json')
const workspaces:Workspace[]=existsSync(stateFile)?JSON.parse(readFileSync(stateFile,'utf8')):[initial('personal','我的工作区','personal'),initial('studio','研究团队','organization')]
const receipts=new Map<string,any>(),checks=new Map<string,any>(),signins=new Map<string,any>()
const persist=()=>writeFileSync(stateFile,JSON.stringify(workspaces,null,2)+'\n')
const inventory=(currentId='personal')=>({version:1,currentId,canCreate:true,items:workspaces.map(({id,name,kind,role})=>({id,name,kind,role}))})
const configuration=(workspace:Workspace)=>({...structuredClone(base['/configuration']),preview:true,
  current:{...base['/configuration'].current,revision:workspace.revision,config:workspace.config},history:workspace.history,
  capabilities:{agentOptions:true,workerManagement:true},agentCapabilities:{codex:{efforts:['low','medium','high','xhigh'],parameters:false},research:{efforts:['none','low','medium','high'],parameters:true}}})
const entries=(workspace:Workspace)=>{
  const data=structuredClone(base['/entry-setup']);data.preview=true;data.revision=workspace.revision
  data.connections=Object.entries({codex:{kind:'codex',label:'Codex CLI',model:'gpt-6.1-terra'},...workspace.config.backends}).map(([id,value])=>({id,...value as object}))
  return data
}
const work=(workspace:Workspace)=>{
  const data=structuredClone(base['/entry-workspace']);data.preview=true
  data.architecture.router={...data.architecture.router,backend:workspace.config.execution.router.backend,model:workspace.config.execution.router.model}
  data.architecture.workers=workspace.config.execution.workers.map((worker:any)=>({...worker,active:[]}))
  return data
}
const server=createServer(async(req,res)=>{
  const url=new URL(req.url||'/','http://127.0.0.1'),path=url.pathname
  res.setHeader('cache-control','no-store')
  const json=(status:number,value:unknown)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value))}
  try {
    if(path==='/'||path==='/configure') {res.writeHead(200,{'content-type':'text/html; charset=utf-8'});res.end(configurationPage);return}
    if(path==='/session') {json(200,{operator:true});return}
    let body:any={}
    if(req.method==='POST'){let text='';for await(const chunk of req){text+=chunk;if(text.length>2000000)throw Error('Request too large')}body=JSON.parse(text||'{}')}
    if(path==='/workspaces') {
      if(req.method==='POST') {
        if(receipts.has(body.requestId)){json(200,receipts.get(body.requestId));return}
        if(typeof body.name!=='string'||!body.name.trim()||!['personal','organization'].includes(body.kind)||!body.requestId){json(400,{error:'Invalid workspace'});return}
        const id='workspace-'+crypto.randomUUID().slice(0,8),workspace=initial(id,body.name.trim(),body.kind)
        workspace.config.execution.workers=[{id:'worker-1',backend:'codex'}];workspace.config.concurrency=1
        workspaces.push(workspace);persist();const response=inventory(id);receipts.set(body.requestId,response);json(200,response);return
      }
      json(200,inventory());return
    }
    if(['/health','/entry-guide','/connect-info'].includes(path)){json(200,base[path]);return}
    if(path==='/preview-sign-in'){
      const id=url.searchParams.get('id'),signin=id&&signins.get(id)
      if(signin){signin.state='connected'}
      res.writeHead(200,{'content-type':'text/html; charset=utf-8'});res.end('<!doctype html><html lang="zh-CN"><title>协议预览</title><h1>协议预览已完成</h1><p>这是本机 UI 夹具，没有登录服务商，也没有获得订阅授权。请返回 AgentHub 检查状态。</p></html>');return
    }
    const match=/^\/workspaces\/([a-zA-Z0-9_-]+)(\/.*)$/.exec(path)
    if(!match){json(404,{error:'Preview route not implemented'});return}
    const workspace=workspaces.find(item=>item.id===match[1]),route=match[2]!
    if(!workspace){json(404,{error:'Workspace not found'});return}
    const save=(patch:any)=>{workspace.history.unshift(configuration(workspace).current);Object.assign(workspace.config,patch);workspace.revision++;persist()}
    if(route==='/configuration'||route==='/settings'&&req.method==='GET'){json(200,configuration(workspace));return}
    if(route==='/settings'){
      if(body.revision!==workspace.revision){json(409,{code:'settings_conflict',currentRevision:workspace.revision,error:'Settings changed'});return}
      if(body.patch?.execution?.workers?.some((worker:any)=>worker.parameters?.model)){json(400,{code:'validation_error',issues:[{path:['execution','workers'],message:'Managed model cannot be replaced in provider parameters'}]});return}
      save(body.patch);json(200,{revision:workspace.revision,config:workspace.config});return
    }
    if(route==='/entry-setup'){json(200,entries(workspace));return}
    if(route.startsWith('/entry-workspace')){json(200,work(workspace));return}
    if(route==='/status'){json(200,{paused:true,sources:[],setup:null});return}
    if(route==='/onboarding'){json(200,{preview:true,backend:entries(workspace).backend,entries:[]});return}
    if(route==='/integrations'){json(200,base['/integrations']);return}
    if(route==='/prompts'){json(200,base['/prompts']);return}
    if(route==='/prompt-preview'){json(200,{text:'Synthetic prompt preview\n'+(body.prompts?.[body.role]||''),revision:workspace.revision});return}
    if(route==='/connection-capabilities'){json(200,{version:1,subscriptionProviders:[{id:'chatgpt',label:'ChatGPT · 协议预览'}],cliProviders:[{id:'gemini',label:'Gemini CLI · 协议预览'}]});return}
    if(route==='/connections/subscription/start'){
      const id='auth-'+crypto.randomUUID();signins.set(id,{state:'pending',workspace:workspace.id,name:body.name});json(200,{id,authorizationUrl:'http://127.0.0.1:'+((server.address() as any).port)+'/preview-sign-in?id='+id});return
    }
    if(route.startsWith('/connections/subscription/')){
      const signin=signins.get(route.split('/').at(-1)!);if(!signin||signin.workspace!==workspace.id){json(404,{error:'Unknown sign-in'});return}
      if(signin.state==='connected'&&!signin.saved){save({backends:{...workspace.config.backends,['subscription-'+crypto.randomUUID().slice(0,6)]:{kind:'openai-responses',label:signin.name,baseUrl:'https://api.openai.com/v1',model:'preview-model',subscription:{provider:'chatgpt'}}}});signin.saved=true}
      json(200,{state:signin.state,message:'本机 UI 协议预览，不代表实际账号授权。'});return
    }
    if(route==='/connections/cli/check'){const checkId=crypto.randomUUID();checks.set(checkId,{...body,workspace:workspace.id});json(200,{checkId,ok:true,checks:[{label:'UI 协议夹具',status:'ok',detail:'未启动 CLI，仅验证前端检查与保存流程'}]});return}
    if(route==='/connections/cli'){
      const check=checks.get(body.checkId);if(!check||check.workspace!==workspace.id){json(400,{error:'Check again'});return}
      if(!receipts.has(body.requestId)){save({backends:{...workspace.config.backends,['cli-'+crypto.randomUUID().slice(0,6)]:{kind:'codex',label:check.name,model:check.model,command:check.command,args:check.args}}});receipts.set(body.requestId,{saved:true})}
      json(200,receipts.get(body.requestId));return
    }
    if(route==='/entry-setup/model/plan'){const id=crypto.randomUUID();checks.set(id,{...body,workspace:workspace.id});json(200,{id,revision:workspace.revision,connection:body.connection,name:body.name});return}
    if(route==='/entry-setup/model/check'){json(200,{ok:true,preview:true,checks:[{id:'preview',status:'ok',detail:'本机配置预览，不请求模型服务'}]});return}
    if(route==='/entry-setup/model/apply'){
      const plan=checks.get(body.planId||body.id);if(!plan){json(400,{error:'Preview plan not found'});return}
      const id='connection-'+crypto.randomUUID().slice(0,6),c=plan.connection
      save({backends:{...workspace.config.backends,[id]:c.kind==='api'?{kind:c.protocol,label:plan.name||'Preview API',baseUrl:c.baseUrl,model:c.model}:{kind:'codex',label:plan.name||'Preview CLI'}}})
      json(200,{revision:workspace.revision,connection:{id},applied:true});return
    }
    json(404,{error:'This preview does not implement '+route})
  }catch(error){json(400,{error:String(error)})}
})
server.listen(Number(process.argv[3]||4348),'127.0.0.1',()=>console.log(JSON.stringify({url:'http://127.0.0.1:'+((server.address() as any).port)+'/configure',synthetic:true,taskExecution:false})))
process.once('SIGTERM',()=>server.close());process.once('SIGINT',()=>server.close())
