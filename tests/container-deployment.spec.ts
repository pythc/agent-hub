import {afterEach,expect,it} from 'vitest'
import {request as httpRequest} from 'node:http'
import {mkdtempSync,mkdirSync,rmSync,readFileSync,writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {randomUUID} from 'node:crypto'
import {Runtime} from '../src/runtime.ts'
import {Store,MAX_DB_SCHEMA} from '../src/store.ts'
import {configSchema} from '../src/config.ts'
import {serve} from '../src/server.ts'
import {deploymentMaintenance} from '../src/deployment-maintenance.ts'
import {initContainer,inspectContainer} from '../src/container-cli.ts'
import {publicOriginSchema,requestHostOrigin} from '../src/http-deployment.ts'
const roots:string[]=[],hosts:Runtime[]=[],closers:(()=>Promise<void>)[]=[]
afterEach(async()=>{for(const c of closers.splice(0))await c();for(const h of hosts.splice(0))if(!h.shuttingDown)await h.close();for(const p of roots.splice(0))rmSync(p,{recursive:true,force:true})})
function root(){const p=mkdtempSync(join(tmpdir(),'roppo-container-'));roots.push(p);return p}
function host(path=root()){
 const config=configSchema.parse({stateDir:join(path,'state'),port:0,work:{sandboxDriver:'disabled'},execution:{router:{mode:'host'},management:{enabled:true},workers:[{id:'one',backend:'codex'}]},sources:[{id:'local',kind:'local',cwd:path,allowedActors:['operator']}]})
 const h=new Runtime(config,{model:{async run(){throw Error('No model invocation in deployment unit checks')}}});hosts.push(h);return h
}
async function mappedRequest(url:string,headers:Record<string,string>,body?:string){
 return new Promise<{status:number;json:()=>any}>((resolve,reject)=>{
  const req=httpRequest(url,{method:body?'POST':'GET',headers},res=>{let data='';res.setEncoding('utf8');res.on('data',s=>data+=s);res.on('end',()=>resolve({status:res.statusCode!,json:()=>JSON.parse(data)}))})
  req.on('error',reject);req.end(body)
 })
}
const prepare=(h:Runtime,id=randomUUID())=>deploymentMaintenance(h,{action:'prepare',operationId:id,expectedRevision:h.settings.current().revision})
it('initializes once and changes only deployment-owned origin when reopening a container volume',async()=>{
 const p=root();await initContainer(p,'http://127.0.0.1:55001',false)
 const file=join(p,'state/config.json'),config=JSON.parse(readFileSync(file,'utf8'));config.prompts.router='Retain my prompt';config.work.network=true;writeFileSync(file,JSON.stringify(config))
 expect(await initContainer(p,'http://127.0.0.1:55002',false)).toMatchObject({created:false})
 const after=JSON.parse(readFileSync(file,'utf8'));expect(after.prompts.router).toBe('Retain my prompt');expect(after.work.network).toBe(true);expect(after.http.publicOrigin).toBe('http://127.0.0.1:55002')
 expect(after.sources[0].cwd).toBe(join(p,'state/workspace'))
})
it('rejects a newer DB before modifying the saved container config',async()=>{
 const p=root();await initContainer(p,'http://localhost:55001',false);const file=join(p,'state/config.json'),before=readFileSync(file,'utf8'),db=new Store(join(p,'state/state.sqlite'))
 db.db.exec('PRAGMA user_version='+(MAX_DB_SCHEMA+1));db.close()
 expect(()=>inspectContainer(p)).toThrow('newer than this image')
 await expect(initContainer(p,'http://localhost:55002',false)).rejects.toThrow('newer than this image')
 expect(readFileSync(file,'utf8')).toBe(before)
})
it.each(['https://127.0.0.1:4337','http://example.com:4337','http://user@localhost:4337','http://localhost:4337/path','http://localhost:4337/','http://localhost:4337?x=1'])('rejects unsupported public origin %s',value=>{expect(publicOriginSchema.safeParse(value).success).toBe(false)})
it('retains native defaults and enforces mapped Host and browser Origin independently',async()=>{
 const h=host();expect(h.config.http).toBeUndefined();h.config.http={listenHost:'127.0.0.1',publicOrigin:'http://127.0.0.1:55009'}
 const s=await serve(h);closers.push(async()=>{s.server.closeAllConnections();await new Promise<void>(r=>s.server.close(()=>r()));await s.closeRuntime()})
 const token=readFileSync(s.tokenPath,'utf8').trim(),headers={authorization:'Bearer '+token,'content-type':'application/json',host:'127.0.0.1:55009',origin:'http://127.0.0.1:55009'}
 expect(s.operatorUrl).toMatch(/^http:\/\/127\.0\.0\.1:55009\/configure#pair=/)
 expect(JSON.parse(readFileSync(s.connectionFile,'utf8')).url).toBe(s.url)
 const response=await mappedRequest(s.url+'/operator-link',headers,'{}');expect(response.status).toBe(200);expect(response.json().url).toMatch(/^http:\/\/127\.0\.0\.1:55009\//)
 expect((await mappedRequest(s.url+'/operator-link',{...headers,origin:'http://127.0.0.1:55008'},'{}')).status).toBe(403)
 expect((await mappedRequest(s.url+'/health',{host:'untrusted.invalid:55009'})).status).toBe(403)
 expect((await mappedRequest(s.url+'/health',{host:'127.0.0.1:55008','x-forwarded-host':'127.0.0.1:55009'})).status).toBe(403)
 expect(requestHostOrigin('localhost:'+new URL(s.url).port,s.url,h.config.http.publicOrigin)).toBe('http://localhost:'+new URL(s.url).port)
})
it('prepares idempotently, blocks another operation, and restores only its own maintenance pause',async()=>{
 const h=host(),id=randomUUID();await prepare(h,id);expect(h.schedulingPaused).toBe(true)
 expect(await prepare(h,id)).toMatchObject({state:'prepared'})
 await expect(prepare(h)).rejects.toThrow('existing maintenance')
 expect(await deploymentMaintenance(h,{action:'finish',operationId:id})).toMatchObject({resumed:true})
 expect(h.schedulingPaused).toBe(false)
 const count=()=>h.store.db.prepare("SELECT COUNT(*) n FROM audit WHERE json_extract(body,'$.type')='pause'").get()!.n,before=count()
 expect(await deploymentMaintenance(h,{action:'finish',operationId:id})).toMatchObject({state:'finished',resumed:true})
 expect(count()).toBe(before)
})
it('keeps a later human pause even when its boolean value did not change',async()=>{
 const h=host(),id=randomUUID();await prepare(h,id);h.pause(true)
 expect(await deploymentMaintenance(h,{action:'finish',operationId:id})).toMatchObject({resumed:false,reason:'pause_control_changed'})
 expect(h.schedulingPaused).toBe(true)
})
it('preserves an originally paused instance and a prepared receipt across restart',async()=>{
 const h=host();h.pause(true);const id=randomUUID();await prepare(h,id);const config=h.config;await h.close()
 const next=new Runtime(config,{model:{async run(){throw Error('No model')}}});hosts.push(next)
 expect(await deploymentMaintenance(next,{action:'finish',operationId:id})).toMatchObject({resumed:false})
 expect(next.schedulingPaused).toBe(true)
})
it('rejects unfinished work without pausing or inventing a completed maintenance',async()=>{
 const h=host();h.receive('local','operator',{id:'work',thread:'work',text:'Do a bounded task',addressed:true})
 await expect(prepare(h)).rejects.toThrow('Unsettled work')
 expect(h.schedulingPaused).toBe(false)
})
it('a human override while quiescing cannot be undone by the installer',async()=>{
 const h=host();let release!:()=>void;(h as any).tickIdle=new Promise<void>(r=>release=r)
 const pending=prepare(h);h.pause(true);release()
 await expect(pending).rejects.toThrow('Pause control changed')
 expect(h.schedulingPaused).toBe(true)
})
it('aborts interrupted preparation after restart without leaving an unrecoverable maintenance lock',async()=>{
 const h=host(),id=randomUUID();h.store.put('deployment-maintenance',id,{id,state:'preparing',wasPaused:false,at:Date.now()});h.pause(true,id)
 const config=h.config;await h.close();const next=new Runtime(config,{model:{async run(){throw Error('No model')}}});hosts.push(next)
 expect(await deploymentMaintenance(next,{action:'abort',operationId:id})).toMatchObject({state:'aborted',resumed:true})
 expect(next.schedulingPaused).toBe(false)
 await expect(prepare(next)).resolves.toMatchObject({state:'prepared'})
})
it('fences a delayed prepare request after concurrent abort',async()=>{
 const h=host(),id=randomUUID();let release!:()=>void;(h as any).tickIdle=new Promise<void>(r=>release=r)
 const pending=prepare(h,id)
 expect(await deploymentMaintenance(h,{action:'abort',operationId:id})).toMatchObject({state:'aborted',resumed:true})
 release();await expect(pending).rejects.toThrow('cancelled')
 expect(h.schedulingPaused).toBe(false)
 expect(h.store.get<any>('deployment-maintenance',id).state).toBe('aborted')
})
it('requires a current revision and safely aborts a request that never prepared',async()=>{
 const h=host(),id=randomUUID()
 await expect(deploymentMaintenance(h,{action:'prepare',operationId:id,expectedRevision:99})).rejects.toThrow('current settings revision')
 expect(await deploymentMaintenance(h,{action:'abort',operationId:id})).toMatchObject({state:'not_found',resumed:false})
 expect(h.schedulingPaused).toBe(false)
})

it('normalizes an explicitly published HTTP default port',()=>{expect(publicOriginSchema.parse('http://127.0.0.1:80')).toBe('http://127.0.0.1');expect(requestHostOrigin('127.0.0.1','http://127.0.0.1:4337','http://127.0.0.1')).toBe('http://127.0.0.1')})
