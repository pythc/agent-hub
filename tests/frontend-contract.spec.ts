import {readFileSync} from 'node:fs'
import {createContext,runInContext} from 'node:vm'
import {expect,it} from 'vitest'

function browser(config:any,capabilities:any={}) {
  const context=createContext({structuredClone,URL,URLSearchParams,Map,Set,console,crypto,
    document:{getElementById:()=>null,querySelector:()=>null},localStorage:{getItem:()=>null},
    CSS:{escape:(text:string)=>text},location:{origin:'http://localhost',host:'localhost'}})
  for(const file of ['controls.js','control-center.js','team-studio.js','workspaces.js','connection-studio.js','integrations.js'])
    runInContext(readFileSync(new URL('../src/ui/'+file,import.meta.url),'utf8'),context)
  context.initial=config;context.features=capabilities
  runInContext(`S.base={revision:4,config:structuredClone(initial)};S.draft=structuredClone(initial);S.snap={capabilities:features};
    function updateBar(){} function render(){} function confirmWorkspaceAction(a,b,c,callback){callback()}
    const entryModel={touched:false},entryState={touched:false};`,context)
  return {get:(text:string)=>runInContext(text,context),context}
}
const configuration=()=>({execution:{backend:'codex',roles:{},workers:[
  {id:'worker-1',backend:'codex',model:'old-model',effort:'high',parameters:{temperature:0.4,nested:{keep:null}},extension:{keep:true}},
  {id:'worker-2',backend:'api',model:'second',effort:'low'}]},backends:{api:{kind:'openai-responses',baseUrl:'https://example.org/v1',model:'default'}},models:{router:'legacy-router'},concurrency:2,prompts:{worker:'shared'},effort:'high'})

it('edits one Worker while preserving independent options, unknown fields and every other Worker',()=>{
  const b=browser(configuration(),{agentOptions:true})
  b.get(`teamStudio.selected='worker-1';teamWrite('model','new-model');teamWrite('effort','medium')`)
  expect(b.get('S.draft.execution.workers[0]')).toMatchObject({model:'new-model',effort:'medium',parameters:{temperature:0.4,nested:{keep:null}},extension:{keep:true}})
  expect(b.get('S.draft.execution.workers[1]')).toEqual(configuration().execution.workers[1])
  expect(b.get('S.base.config.execution.workers[0].model')).toBe('old-model')
})
it('represents inheritance by omission and preserves explicit provider null',()=>{
  const b=browser(configuration(),{agentOptions:true})
  b.get(`teamStudio.selected='worker-1';teamWrite('effort',undefined)`)
  expect(b.get(`Object.hasOwn(S.draft.execution.workers[0],'effort')`)).toBe(false)
  expect(b.get('S.draft.execution.workers[0].parameters.nested.keep')).toBeNull()
})
it('reads the new Router override before the legacy role selection',()=>{
  const config:any=configuration();config.execution.router={backend:'api',model:'new-router',effort:'medium'}
  const b=browser(config)
  expect(b.get('executionDraft()')).toMatchObject({router:'api',routerModel:'new-router'})
  b.get(`teamWrite('model','updated-router')`)
  expect(b.get('S.draft.execution.router')).toMatchObject({backend:'api',model:'updated-router',effort:'medium'})
  expect(b.get('S.draft.models.router')).toBe('legacy-router')
})
it('keeps legacy hosts editable without writing unsupported Router fields',()=>{
  const config:any=configuration();config.execution.workers=config.execution.workers.map(({id,backend,model}:any)=>({id,backend,model}))
  const b=browser(config)
  expect(b.get('teamFeatures().options')).toBe(false)
  b.get(`teamWrite('model','legacy-updated');teamWrite('backend','api');teamWrite('prompt','router instruction')`)
  expect(b.get('S.draft.execution.router')).toBeUndefined()
  expect(b.get('S.draft.models.router')).toBe('legacy-updated')
  expect(b.get('S.draft.execution.roles.router')).toBe('api')
  expect(b.get('S.draft.prompts.router')).toBe('router instruction')
})
it('does not materialize profiles merely by reading a legacy pool',()=>{
  const config:any=configuration();delete config.execution.workers
  const b=browser(config,{agentOptions:true})
  expect(b.get('teamWorkers().length')).toBe(2)
  b.get(`teamStudio.selected='worker-2';teamCurrent()`)
  expect(b.get('S.draft.execution.workers')).toBeUndefined()
  b.get(`teamWrite('prompt','only this worker')`)
  expect(b.get('Array.isArray(S.draft.execution.workers)')).toBe(true)
  expect(b.get('S.draft.execution.workers[1].prompt')).toBe('only this worker')
})
it('copies all options into a new stable identity and caps the pool at ten',()=>{
  const b=browser(configuration(),{agentOptions:true})
  b.get(`teamStudio.selected='worker-1';teamAddWorker(true)`)
  expect(b.get('S.draft.execution.workers[2]')).toMatchObject({id:'worker-3',parameters:{temperature:0.4},extension:{keep:true}})
  b.get(`for(let index=0;index<12;index++)teamAddWorker()`)
  expect(b.get('teamWorkers().length')).toBe(10)
  expect(b.get('new Set(teamWorkers().map(worker=>worker.id)).size')).toBe(10)
})
it('moves invalid field buffers with their Worker when another Worker is removed',()=>{
  const b=browser(configuration(),{agentOptions:true})
  b.get(`S.buffers.set('execution.workers.1.parameters',{type:'json',text:'{broken'});S.errors.set('execution.workers.1.parameters',['Invalid','错误']);teamStudio.selected='worker-1';teamRemoveWorker()`)
  expect(b.get('teamWorkers()[0].id')).toBe('worker-2')
  expect(b.get(`S.buffers.get('execution.workers.0.parameters').text`)).toBe('{broken')
  expect(b.get(`S.errors.has('execution.workers.0.parameters')`)).toBe(true)
  expect(b.get(`S.errors.has('execution.workers.1.parameters')`)).toBe(false)
})
it('requires an explicit workspace inventory and scopes reads and writes without an unscoped fallback',()=>{
  const b=browser(configuration())
  expect(b.get(`workspacePath('/settings',false,'studio')`)).toBe('/settings')
  b.get(`workspaceContext.managed=true;workspaceContext.activeId='studio'`)
  expect(b.get(`workspacePath('/settings',false,'studio')`)).toBe('/workspaces/studio/settings')
  expect(b.get(`workspacePath('/configuration',false,'personal')`)).toBe('/workspaces/personal/configuration')
  expect(b.get(`workspacePath('/workspaces',false,'studio')`)).toBe('/workspaces')
  expect(b.get(`workspacePath('/session',true,'studio')`)).toBe('/session')
})
it('rejects ambiguous or malformed workspace inventories',()=>{
  const b=browser(configuration())
  for(const body of [
    `{version:1,currentId:'missing',items:[{id:'a',name:'A',kind:'personal'}]}`,
    `{version:1,currentId:'../escape',items:[{id:'../escape',name:'A',kind:'personal'}]}`,
    `{version:1,currentId:'a',items:[{id:'a',name:'A',kind:'personal'},{id:'a',name:'B',kind:'organization'}]}`
  ])expect(()=>b.get(`workspaceValidate(${body})`)).toThrow('Invalid workspace inventory')
})
it('does not treat every CLI connection as a subscription and retains its own model',()=>{
  const config:any=configuration();config.backends.cli={kind:'codex',model:'own-model',label:'CLI'};config.backends.plan={kind:'openai-responses',baseUrl:'https://api.openai.com/v1',model:'plan-model',subscription:{provider:'chatgpt'}}
  const b=browser(config)
  expect(b.get(`controlConnections().find(item=>item.id==='cli')`)).toMatchObject({connectionType:'cli',model:'own-model'})
  expect(b.get(`controlConnections().find(item=>item.id==='plan').connectionType`)).toBe('subscription')
})
it('invalidates a CLI check and authorization result when its fields change',()=>{
  const b=browser(configuration())
  b.get(`connectionStudio.check={ok:true,checkId:'old'};connectionStudio.auth={id:'old'};connectionStudio.requestId='old';connectionEdit('command','different')`)
  expect(b.get('connectionStudio.check')).toBeNull()
  expect(b.get('connectionStudio.auth')).toBeNull()
  expect(b.get('connectionStudio.requestId')).toBe('')
  expect(b.get('connectionStudio.touched')).toBe(true)
})
it('clears background consent and owner when a subscription account changes',()=>{
  const b=browser(configuration())
  b.get(`Object.assign(connectionStudio,{native:true,kind:'subscription',account:'first',background:true,ownerSource:'local',ownerActor:'first-owner',model:'old-model',auth:{state:'connected'}});connectionEdit('account','second')`)
  expect(b.get('connectionStudio')).toMatchObject({account:'second',background:false,ownerSource:'',ownerActor:'',model:'',auth:null})
})

it('keeps external tool grants independent and distinguishes empty from inherited grants',()=>{
  const config:any=configuration();config.execution.workers[0].toolConnections=['docs'];config.toolConnections={docs:{enabled:true}}
  const b=browser(config,{agentOptions:true})
  b.get(`teamStudio.selected='worker-1';teamWrite('toolConnections',[])`)
  expect(b.get('S.draft.execution.workers[0].toolConnections')).toEqual([])
  expect(b.get('S.draft.execution.workers[1]')).toEqual(config.execution.workers[1])
  expect(b.get('S.base.config.execution.workers[0].toolConnections')).toEqual(['docs'])
  b.get(`teamWrite('toolConnections',undefined)`)
  expect(b.get(`Object.hasOwn(S.draft.execution.workers[0],'toolConnections')`)).toBe(false)
})
it('clears integration resources and deployment drafts when identity changes',()=>{
  const b=browser(configuration())
  b.get(`integrations.data={tools:[{id:'private'}]};integrations.draft='private';integrations.resources.set('tool-call/private',{content:'private'});integrationsReset()`)
  expect(b.get('integrations.data')).toBeNull()
  expect(b.get('integrations.draft')).toBe('')
  expect(b.get('integrations.resources.size')).toBe(0)
})
it('rejects malformed integration inventory and clears stale data',async()=>{
  const b=browser(configuration())
  b.context.api=async()=>({tools:[],sources:[]})
  b.get(`integrations.data={tools:[{id:'old'}]}`)
  await b.get('integrationsDiscover()')
  expect(b.get('integrations.data')).toBeNull()
  expect(b.get('integrations.error')).toBe('Invalid integration inventory')
})
it('treats legacy inventory 404 as unsupported without masking operational errors',async()=>{
  const b=browser(configuration())
  b.context.api=async()=>{throw {status:404,message:'missing'}}
  await b.get('integrationsDiscover()');expect(b.get('integrations.error')).toBe('')
  b.context.api=async()=>{throw {status:503,message:'unavailable'}}
  await b.get('integrationsDiscover()');expect(b.get('integrations.error')).toBe('unavailable')
})
it('ignores inventory responses rejected by the workspace epoch guard',async()=>{
  const b=browser(configuration())
  b.context.api=async()=>{throw {status:409,payload:{code:'workspace_obsolete'}}}
  b.get(`integrations.data={tools:[{id:'current-workspace'}]}`)
  await b.get('integrationsDiscover()')
  expect(b.get('integrations.data.tools[0].id')).toBe('current-workspace')
})
