/** Opt-in real model smoke. Reads a private backend definition, never embeds keys.
 * tsx tests/manual/cli-live.ts claude|gemini|opencode /absolute/definition.json
 * Uses a disposable workspace and an independent file validator with injected
 * artifact corruption. This is CLI acceptance, not production Router acceptance.
 */
import {mkdtempSync,readFileSync,writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {strict as assert} from 'node:assert'
import {configSchema} from '../../src/config.ts'
import {Store} from '../../src/store.ts'
import {BackendRegistry} from '../../src/backends/registry.ts'
import {buildBackendPackage,activateBackendPackages} from '../../src/backends/plugin-package.ts'
import type {ModelRequest} from '../../src/model.ts'
const kind=process.argv[2]!,definition=JSON.parse(readFileSync(process.argv[3]!,'utf8'))
if(!['claude','gemini','opencode'].includes(kind))throw Error('Unknown reference CLI')
const root=mkdtempSync(join(tmpdir(),'roppo-cli-live-'+kind+'-')),reportFile=join(root,'report.json')
const manifest=JSON.parse(readFileSync(resolve('plugins/backend-'+kind+'/manifest.json'),'utf8'))
const pkg=await buildBackendPackage(resolve('plugins/backend-'+kind+'/index.ts'),manifest,join(root,'package'))
const config=configSchema.parse({stateDir:join(root,'state'),sources:[{id:'local',kind:'local',cwd:root,allowedActors:['operator']}],work:{sandboxDriver:process.platform==='darwin'?'seatbelt':'bubblewrap'},turnTimeoutMs:180000,backendPlugins:[{directory:pkg.directory,digest:pkg.digest}],backends:{external:{kind:'plugin',plugin:manifest.id,...definition}},execution:{backend:'external'}})
let store=new Store(join(config.stateDir,'state.sqlite')),registry=new BackendRegistry(config,store)
activateBackendPackages(store,config)
const events:any[]=[]
const record=(event:any)=>{events.push({...event,at:new Date().toISOString()});writeFileSync(reportFile,JSON.stringify({kind,root,events},null,2));console.log(JSON.stringify(event))}
const artifact=join(root,'result.json'),calls:string[]=[]
const request:ModelRequest={cwd:root,instructions:'You are validating a CLI plugin. Use only the provided Roppo tools. The fixed goal is to compute 21 times 2 and save {"total":42} using write_result. Read back using inspect_result before declaring success. Return JSON {"answer":"..."}.',input:'Complete the fixed goal now.',managed:definition.config.authMode!=='anonymous',schema:{type:'object',properties:{answer:{type:'string'}},required:['answer'],additionalProperties:false},contextBudget:{maxBytes:300000,outputReserveBytes:12000,toolReserveBytes:6000},tools:[{type:'function',name:'write_result',description:'Write the validation artifact.',inputSchema:{type:'object',properties:{total:{type:'number'}},required:['total'],additionalProperties:false}},{type:'function',name:'inspect_result',description:'Read the current validation artifact.',inputSchema:{type:'object',properties:{},additionalProperties:false}}],onTool:async(name,args)=>{calls.push(name);if(name==='write_result')writeFileSync(artifact,JSON.stringify(args));return {success:true,contentItems:[{type:'inputText',text:readFileSync(artifact,'utf8')}]}}}
try{
 record({stage:'probe',probe:await registry.probe('external')})
 const first=await registry.run(request),native=store.get<any>('backend-plugin-thread',first.threadId).nativeId
 assert.equal(JSON.parse(readFileSync(artifact,'utf8')).total,42);record({stage:'initial-validated',threadId:first.threadId,calls:[...calls]})
 writeFileSync(artifact,'{"total":41}');assert.notEqual(JSON.parse(readFileSync(artifact,'utf8')).total,42)
 record({stage:'independent-rejection',actual:41,expected:42})
 store.close();store=new Store(join(config.stateDir,'state.sqlite'));registry=new BackendRegistry(config,store)
 const repaired=await registry.run({...request,threadId:first.threadId,input:'Independent validation rejected the artifact: actual total is 41, required total is still 42. Inspect it and repair it. The original goal and acceptance criteria remain unchanged.'})
 assert.equal(repaired.threadId,first.threadId);assert.equal(store.get<any>('backend-plugin-thread',first.threadId).nativeId,native);assert.equal(JSON.parse(readFileSync(artifact,'utf8')).total,42)
 record({stage:'repair-after-restart-validated',nativeSessionPreserved:true,turns:(await registry.history(first.threadId,root)).turns.length,calls})
 record({result:'pass'})
}catch(error){record({result:'blocked',error:String(error)});process.exitCode=1}
finally{store.close()}
