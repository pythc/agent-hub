import {it,expect,afterEach} from 'vitest'
import {generateKeyPairSync,sign,createHash} from 'node:crypto'
import {mkdtempSync,rmSync,readFileSync,writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {SubscriptionAccounts} from '../src/backends/subscription.ts'
import {readResponsesStream} from '../src/backends/api.ts'
import {BackendRegistry} from '../src/backends/registry.ts'
import {configSchema} from '../src/config.ts'
const roots:string[]=[],accounts:SubscriptionAccounts[]=[]
afterEach(()=>{for(const a of accounts.splice(0))a.close();for(const r of roots.splice(0))rmSync(r,{recursive:true,force:true})})
function stream(text:string,chunk=3){const b=Buffer.from(text);let i=0;return new ReadableStream<Uint8Array>({pull(c){if(i===b.length){c.close();return}c.enqueue(b.subarray(i,Math.min(b.length,i+chunk)));i=Math.min(b.length,i+chunk)}}).getReader()}
it('reads split UTF-8 and CRLF SSE only through a completed response',async()=>{
 const response={status:'completed',output:[{type:'message',content:[{type:'output_text',text:'完成'}]}]}
 expect(await readResponsesStream(stream('event: response.created\r\ndata: {"type":"response.created"}\r\n\r\ndata: '+JSON.stringify({type:'response.completed',response})+'\r\n\r\n',1),10000,new AbortController().signal)).toEqual(response)
})
it.each(['response.failed','response.incomplete','error'])('rejects %s after partial output',async type=>{
 await expect(readResponsesStream(stream('data: {"type":"response.output_text.delta","delta":"partial"}\n\ndata: '+JSON.stringify({type,response:{error:{code:'subscription_sharing_usage_limit_exceeded'}}})+'\n\n'),10000,new AbortController().signal)).rejects.toThrow(type)
})
it('rejects EOF, malformed and oversized streams',async()=>{
 await expect(readResponsesStream(stream('data: {"type":"response.created"}\n\n'),10000,new AbortController().signal)).rejects.toThrow('before response.completed')
 await expect(readResponsesStream(stream('data: broken\n\n'),10000,new AbortController().signal)).rejects.toThrow('Invalid')
 await expect(readResponsesStream(stream('data: '+ 'x'.repeat(20)),10,new AbortController().signal)).rejects.toThrow('size limit')
})
function fixture(){
 const root=mkdtempSync(join(tmpdir(),'siwc-'));roots.push(root)
 const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048}),jwk={...publicKey.export({format:'jwk'}),kid:'test'}
 let nonce='',refreshes=0,scope='openid resource.invoke chatgpt.tokens.use.direct offline_access',badSignature=false
 const jwt=(n:string)=>{const header=Buffer.from(JSON.stringify({alg:'RS256',kid:'test'})).toString('base64url'),body=Buffer.from(JSON.stringify({iss:'https://auth.openai.com',aud:'oaiapp_test',sub:'subject',nonce:n,email:'test@example.invalid',exp:Math.floor(Date.now()/1000)+3600})).toString('base64url'),data=header+'.'+body;return data+'.'+(badSignature?Buffer.from('invalid'):sign('RSA-SHA256',Buffer.from(data),privateKey)).toString('base64url')}
 const requests:{url:string;body:URLSearchParams}[]=[]
 const fakeFetch=(async(url:any,init?:RequestInit)=>{
  const body=new URLSearchParams(String(init?.body??''));requests.push({url:String(url),body})
  if(String(url).endsWith('openid-configuration'))return Response.json({issuer:'https://auth.openai.com',jwks_uri:'https://auth.openai.com/jwks',revocation_endpoint:'https://auth.openai.com/revoke'})
  if(String(url).endsWith('/jwks'))return Response.json({keys:[jwk]})
  if(String(url).endsWith('/revoke'))return new Response(null,{status:200})
  if(String(url).endsWith('/models'))return Response.json({models:[{slug:'sol',visibility:'list'}]})
  if(body.get('grant_type')==='refresh_token'){refreshes++;await new Promise(r=>setTimeout(r,10))}
  return Response.json({access_token:'synthetic-access',refresh_token:'synthetic-refresh-'+refreshes,id_token:jwt(nonce),token_type:'Bearer',scope,expires_in:3600})
 }) as typeof fetch
 const a=new SubscriptionAccounts(root,fakeFetch);accounts.push(a)
 return {root,a,requests,setScope:(s:string)=>scope=s,setBadSignature:()=>badSignature=true,refreshes:()=>refreshes,async login(account='personal'){
  const attempt=await a.begin(account),url=new URL(attempt.url);nonce=url.searchParams.get('nonce')!
  const callback=new URL(url.searchParams.get('redirect_uri')!);callback.search=new URLSearchParams({state:url.searchParams.get('state')!,code:'synthetic-code',client_id:'oaiapp_test'}).toString()
  return {attempt,url,callback}
 }}
}
it('uses PKCE, validates identity, keeps credentials separate, serializes refresh and revokes sign-out',async()=>{
 const f=fixture(),{url,callback,attempt}=await f.login()
 expect(url.searchParams.get('client_id')).toBe('dynamic_agent_client')
 const wrong=new URL(callback);wrong.searchParams.set('state','wrong');expect((await fetch(wrong)).status).toBe(400)
 expect((await fetch(callback)).status).toBe(200);expect(f.a.status(attempt.attempt).status).toBe('completed')
 const exchange=f.requests.find(r=>r.body.get('grant_type')==='authorization_code')!
 expect(exchange.body.get('client_id')).toBe('oaiapp_test');expect(exchange.body.get('redirect_uri')).toBe(url.searchParams.get('redirect_uri'))
 expect(createHash('sha256').update(exchange.body.get('code_verifier')!).digest('base64url')).toBe(url.searchParams.get('code_challenge'))
 expect(JSON.stringify(f.a.list())).not.toContain('synthetic-access')
 const path=join(f.root,'subscription-accounts/personal.json'),record=JSON.parse(readFileSync(path,'utf8'));record.expires_at=0;writeFileSync(path,JSON.stringify(record))
 const second=new SubscriptionAccounts(f.root,(f.a as any).request);accounts.push(second)
 expect(await Promise.all([f.a.credential('personal'),second.credential('personal')])).toEqual(['synthetic-access','synthetic-access']);expect(f.refreshes()).toBe(1)
 expect(await f.a.logout('personal')).toEqual({signedOut:true,revoked:true});await expect(f.a.credential('personal')).rejects.toThrow('sign-in required')
 const again=await f.a.begin('personal');expect(new URL(again.url).searchParams.get('client_id')).toBe('oaiapp_test');expect(new URL(again.url).searchParams.get('agent_name_hint')).toBeNull()
})
it.each(['scope','signature'])('does not save credentials when %s validation fails',async reason=>{
 const f=fixture();if(reason==='scope')f.setScope('openid');else f.setBadSignature()
 const {callback,attempt}=await f.login();expect((await fetch(callback)).status).toBe(400);expect(f.a.status(attempt.attempt).status).toBe('failed');expect(f.a.list()).toEqual([])
})
it('requires a subscription owner and explicit background authorization before inference',async()=>{
 const c=configSchema.parse({stateDir:'/unused',backends:{plan:{kind:'openai-responses',baseUrl:'https://api.openai.com/v1',model:'sol',subscription:{provider:'chatgpt',account:'personal',owner:{source:'local',actor:'alice'},backgroundAuthorized:true}}},execution:{backend:'plan'},sources:[{id:'local',kind:'local',cwd:'/tmp',allowedActors:['alice']}]})
 const registry=new BackendRegistry(c,{get:()=>undefined,put:()=>{}})
 await expect(registry.run({cwd:'/tmp',input:'test',instructions:'test',schema:{},principal:{source:'local',actor:'bob'}})).rejects.toThrow('owner')
})
