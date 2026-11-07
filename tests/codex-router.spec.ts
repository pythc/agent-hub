import {it,expect,afterEach} from 'vitest'
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {createServer,type Server} from 'node:http'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {configSchema} from '../src/config.ts'
import {codexRouterCommand,runCodexRouter} from '../src/codex-router.ts'
const roots:string[]=[],servers:Server[]=[],exec=promisify(execFile)
afterEach(async()=>{for(const s of servers.splice(0)){s.closeAllConnections();await new Promise<void>(r=>s.close(()=>r()))}for(const p of roots.splice(0))rmSync(p,{recursive:true,force:true})})
function fixture(){const root=mkdtempSync(join(tmpdir(),'codex-router-test-'));roots.push(root);return {root,config:configSchema.parse({stateDir:join(root,'state'),execution:{router:{mode:'client',model:'gpt-6.1-terra',effort:'medium'},management:{enabled:true},workers:Array.from({length:4},(_,i)=>({id:'worker-'+i,backend:'codex',model:'gpt-6.1-sol',effort:'high'}))},sources:[{id:'local',kind:'local',cwd:root,allowedActors:['operator']}]})}}
const launch={url:'http://127.0.0.1:4319',tokenFile:'/private/token',prompt:'Delegate four tasks',json:true}
function settings(args:string[]){return Object.fromEntries(args.flatMap((v,i)=>v==='-c'?[args[i+1]!.split(/=(.*)/s).slice(0,2)]:[]).map(([k,v])=>[k,JSON.parse(v!)]))}
it('routes MCP calls through native approval review with only the Router tool exposed',()=>{
 const {config}=fixture(),c=codexRouterCommand(config,launch),s=settings(c.args)
 expect(s).toMatchObject({approval_policy:'on-request',approvals_reviewer:'auto_review',model_reasoning_effort:'medium','mcp_servers.agenthub-router.tools.worker_manage.approval_mode':'prompt','mcp_servers.agenthub-router.enabled_tools':['worker_manage']})
 expect(c.args).toContain('--approve-for-me');expect(c.args).not.toContain('--dangerously-bypass-approvals-and-sandbox');expect(c.args).not.toContain('approval_policy="never"')
 expect(c.model).toBe('gpt-6.1-terra');expect(s.developer_instructions).toContain('sole user-facing Router');expect(c.args).not.toContain('gpt-6.1-sol')
})
it('resumes an explicitly selected Router conversation while retaining its approval mechanism',()=>{
 const {config}=fixture(),id='00000000-0000-0000-0000-000000000001',c=codexRouterCommand(config,{...launch,resume:id})
 expect(c.args.slice(-3)).toEqual(['resume',id,launch.prompt]);expect(settings(c.args).approvals_reviewer).toBe('auto_review')
 expect(()=>codexRouterCommand(config,{...launch,resume:'--last'})).toThrow('exact Router')
})
it('rejects incompatible frontend settings instead of silently starting a different Router',()=>{
 const {config}=fixture();config.execution.router!.mode='host';expect(()=>codexRouterCommand(config,launch)).toThrow('mode=client')
 config.execution.router!.mode='client';config.execution.router!.parameters={turn:{serviceTier:'flex'}};expect(()=>codexRouterCommand(config,launch)).toThrow('native CLI configuration')
 delete config.execution.router!.parameters;config.execution.router!.tools=['worker_manage','unexpected'];expect(()=>codexRouterCommand(config,launch)).toThrow('only worker_manage')
 delete config.execution.router!.tools;config.execution.management!.enabled=false;expect(()=>codexRouterCommand(config,launch)).toThrow('execution.management')
})
it('the public CLI entry reads host settings and launches the selected native CLI without editing config files',async()=>{
 const {root,config}=fixture(),binary=join(root,'fixture-cli'),log=join(root,'argv.json'),tokenFile=join(root,'token'),kept=join(root,'config.toml')
 writeFileSync(tokenFile,'synthetic-router-token');writeFileSync(kept,'model="keep"\n')
 writeFileSync(binary,'#!'+process.execPath+'\n'+`require('node:fs').writeFileSync(${JSON.stringify(log)},JSON.stringify(process.argv.slice(2)));console.log('fixture native CLI invoked')`,{mode:0o700});config.codex=binary
 const server=createServer((req,res)=>{if(req.url!=='/settings'||req.headers.authorization!=='Bearer synthetic-router-token'){res.writeHead(403);res.end();return}res.setHeader('content-type','application/json');res.end(JSON.stringify({current:{revision:7,config}}))});servers.push(server);await new Promise<void>(r=>server.listen(0,'127.0.0.1',r))
 const url='http://127.0.0.1:'+(server.address() as any).port
 const result=await exec(process.execPath,['--import',resolve('node_modules/tsx/dist/loader.mjs'),resolve('src/cli.ts'),'router',url,tokenFile,'--prompt','user message','--json'],{timeout:15000})
 expect(result.stdout).toContain('fixture native CLI invoked');const args=JSON.parse(readFileSync(log,'utf8'));expect(args.at(-1)).toBe('user message');expect(settings(args).approval_policy).toBe('on-request');expect(readFileSync(kept,'utf8')).toBe('model="keep"\n')
 await expect(runCodexRouter({...launch,url:'https://example.com',tokenFile})).rejects.toThrow('loopback')
})
