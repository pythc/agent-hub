/** Isolated acceptance fixture: real HTTP, SQLite and Router/Worker tool flow; deterministic model. */
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs'
import {join} from 'node:path'
import {Runtime} from '../src/runtime.ts'
import {configSchema} from '../src/config.ts'
const root=process.env.CHAT_BROWSER_DIR!;mkdirSync(root,{recursive:true})
const config=configSchema.parse({stateDir:join(root,'state'),port:0,work:{sandboxDriver:'disabled'},execution:{router:{mode:'host'},management:{enabled:true},workers:[{id:'developer',label:'开发 Worker',backend:'codex'},{id:'reviewer',label:'复核 Worker',backend:'codex'}]},sources:[{id:'local',kind:'local',cwd:root,workspace:{mode:'source'},allowedActors:['alice']}]})
const h=new Runtime(config,{model:{async run(r){const threadId=r.threadId??crypto.randomUUID();r.onThread?.(threadId);r.onTurn?.(crypto.randomUUID());let result;
 if(r.role==='worker')result={state:'ready',summary:'已确认摘要按 Unicode 码点截断。',reply:'摘要截断已修改，A😀B 在限制三个字时保持完整。回归验证通过。',question:null,askedBy:null,handbacks:[]};
 else if(JSON.parse(r.input).kind==='user_message'){const tool=await r.onTool!('worker_manage',{action:'assign',revision:0,requestId:crypto.randomUUID(),id:'developer',text:'请修复摘要遇到 emoji 被截断的问题，并运行回归验证。'},crypto.randomUUID());if(!tool.success)throw Error(JSON.stringify(tool));result={reply:'我会请开发 Worker 修复摘要截断，完成验证后给你结果。'}}
 else result={reply:'开发 Worker 已完成修复和回归验证，请验收。'};
 return {threadId,turnId:crypto.randomUUID(),text:JSON.stringify(result)}},async purge(){return {local:'verified',provider:'not_managed'}}}})
const {serve}=await import('../src/server.ts'),host=await serve(h),authorization='Bearer '+readFileSync(host.tokenPath,'utf8').trim()
const setup=await fetch(host.url+'/account/setup',{method:'POST',headers:{authorization,'content-type':'application/json',origin:host.url},body:JSON.stringify({username:'chat-review',displayName:'对话验证',password:'isolated chat browser password',remember:false})});if(setup.status!==201)throw Error('setup failed')
const cookie=setup.headers.get('set-cookie')!.split(';')[0]!
const identity=await (await fetch(host.url+'/api/chat/readiness',{headers:{cookie}})).json() as {user:{id:string}}
const chat=h.chat.space(identity.user.id,true).conversation!
writeFileSync(join(root,'fixture.json'),JSON.stringify({url:host.url,cookie,chat:chat.id}),{mode:0o600});console.log(host.url)
const stop=async()=>{host.server.closeAllConnections();await new Promise<void>(r=>host.server.close(()=>r()));await host.closeRuntime();process.exit(0)};process.on('SIGTERM',()=>void stop());process.on('SIGINT',()=>void stop())
