import {afterEach,expect,it,vi} from 'vitest'
import {FeishuSource} from '../plugins/feishu/feishu.ts'
import {configSchema} from '../src/config.ts'
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs()})
function fixture(){
 vi.stubEnv('FEISHU_RACE_ID','app');vi.stubEnv('FEISHU_RACE_SECRET','A')
 const config=configSchema.shape.sources.element.parse({id:'feishu',kind:'feishu',cwd:'/tmp',allowedActors:['operator'],feishu:{appIdEnv:'FEISHU_RACE_ID',appSecretEnv:'FEISHU_RACE_SECRET',chats:['oc_fixture']}})
 return new FeishuSource(config)
}
const token=(value:string)=>Response.json({code:0,tenant_access_token:value,expire:7200})
it('rejects an old token response after the new credential token won without overwriting its cache',async()=>{
 const source=fixture(),seen:string[]=[];let release!:(r:Response)=>void
 const fetcher=vi.fn(async(url:string,options:any)=>{
  if(url.includes('tenant_access_token')){const secret=JSON.parse(options.body).app_secret;seen.push('auth:'+secret);if(secret==='A')return new Promise<Response>(resolve=>{release=resolve});return token('token-B')}
  seen.push(options.headers.authorization);return Response.json({code:0,bot:{open_id:'ou_B'}})
 });vi.stubGlobal('fetch',fetcher)
 const old=source.identity(),rejected=expect(old).rejects.toThrow('credentials changed')
 vi.stubEnv('FEISHU_RACE_SECRET','B')
 expect(await source.identity()).toMatchObject({id:'ou_B',verified:true})
 release(token('token-A'));await rejected
 expect(await source.identity()).toMatchObject({id:'ou_B',verified:true})
 expect(seen).toEqual(['auth:A','auth:B','Bearer token-B','Bearer token-B'])
})
it('does not let an old API failure expire the new credential token or clear its identity cache',async()=>{
 const source=fixture(),seen:string[]=[];let release!:(r:Response)=>void,entered!:()=>void
 const barrier=new Promise<void>(resolve=>{entered=resolve})
 vi.stubGlobal('fetch',vi.fn(async(url:string,options:any)=>{
  if(url.includes('tenant_access_token')){const secret=JSON.parse(options.body).app_secret;seen.push('auth:'+secret);return token('token-'+secret)}
  seen.push(options.headers.authorization)
  if(options.headers.authorization==='Bearer token-A')return new Promise<Response>(resolve=>{release=resolve;entered()})
  return Response.json({code:0,bot:{open_id:'ou_B'}})
 }))
 const old=source.identity(),rejected=expect(old).rejects.toThrow('credentials changed')
 // Wait for an explicit fake transport barrier, not elapsed time.
 await barrier
 vi.stubEnv('FEISHU_RACE_SECRET','B');await source.identity()
 const cache=(source as any).identityCache
 release(Response.json({code:99991663}));await rejected
 expect((source as any).identityCache).toBe(cache)
 await source.identity()
 expect(seen.filter(s=>s.startsWith('auth:'))).toEqual(['auth:A','auth:B'])
})
