import {randomBytes,randomUUID,createHash,createPublicKey,verify} from 'node:crypto'
import {createServer,type Server} from 'node:http'
import {existsSync,mkdirSync,readFileSync,readdirSync} from 'node:fs'
import {join} from 'node:path'
import {atomicPrivateFile} from '../managed-config.ts'
const issuer='https://auth.openai.com',resource='https://api.openai.com/v1'
const scopes='openid profile email offline_access resource.invoke chatgpt.tokens.use.direct'
const locks=new Map<string,Promise<string>>()
const epochs=new Map<string,number>(),signingOut=new Set<string>()
interface Account {client_id:string;subject:string;email?:string;access_token?:string;refresh_token?:string;id_token?:string;expires_at?:number;scopes:string[]}
interface Attempt {account:string;state:string;nonce:string;verifier:string;redirect:string;client:string;server:Server;timer:ReturnType<typeof setTimeout>;status:'pending'|'exchanging'|'completed'|'failed';error?:string}
/** Official public-client OAuth. Credentials never enter revisioned settings or status. */
export class SubscriptionAccounts {
 private directory:string
 private attempts=new Map<string,Attempt>()
 constructor(stateDir:string,private request:typeof fetch=fetch){this.directory=join(stateDir,'subscription-accounts')}
 private file(account:string){if(!/^[a-z][a-z0-9_-]{0,63}$/.test(account))throw Error('Invalid account name');return join(this.directory,account+'.json')}
 private read(account:string):Account|undefined{const path=this.file(account);return existsSync(path)?JSON.parse(readFileSync(path,'utf8')):undefined}
 private write(account:string,value:Account){mkdirSync(this.directory,{recursive:true,mode:0o700});atomicPrivateFile(this.file(account),JSON.stringify(value)+'\n')}
 list(){return existsSync(this.directory)?readdirSync(this.directory).filter(f=>f.endsWith('.json')).map(f=>{const id=f.slice(0,-5),a=this.read(id)!;return {id,email:a.email,subject:a.subject,signedIn:!!a.access_token,expiresAt:a.expires_at,usage:'unknown'}}):[]}
 private async json(url:string,init:RequestInit={}){const r=await this.request(url,{...init,redirect:'error',signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('Subscription authorization HTTP '+r.status);return r.json() as Promise<any>}
 async begin(account:string){
  const accountPath=this.file(account),epoch=epochs.get(accountPath)??0
  if(signingOut.has(accountPath))throw Error('Sign-out is in progress')
  if([...this.attempts.values()].some(a=>a.account===account&&['pending','exchanging'].includes(a.status)))throw Error('Sign-in already pending for this account')
  const saved=this.read(account),hostFile=join(this.directory,'host-id')
  mkdirSync(this.directory,{recursive:true,mode:0o700})
  if(!existsSync(hostFile))atomicPrivateFile(hostFile,'urn:uuid:'+randomUUID())
  const state=randomBytes(32).toString('base64url'),nonce=randomBytes(32).toString('base64url'),verifier=randomBytes(32).toString('base64url')
  const server=createServer((req,res)=>{void (async()=>{
   const url=new URL(req.url??'/',attempt.redirect)
   if(url.pathname!=='/auth/callback'){res.writeHead(404);res.end();return}
   if(url.searchParams.get('state')!==state||attempt.status!=='pending'){res.writeHead(400);res.end('Invalid sign-in attempt');return}
   try{
    attempt.status='exchanging' // consume callback before any network operation
    if(url.searchParams.has('error'))throw Error('Authorization declined; no credentials changed')
    const client=url.searchParams.get('client_id')??saved?.client_id
    if(!client||client==='dynamic_agent_client'||saved&&client!==saved.client_id)throw Error('Invalid issued client ID')
    const code=url.searchParams.get('code');if(!code)throw Error('Missing authorization code')
    const tokens=await this.token({grant_type:'authorization_code',client_id:client,code,code_verifier:verifier,redirect_uri:attempt.redirect,resource})
    const claims=await this.identity(tokens.id_token,client,nonce)
    if(saved&&claims.sub!==saved.subject)throw Error('Signed-in identity does not match the selected account')
    if((epochs.get(accountPath)??0)!==epoch||attempt.status!=='exchanging')throw Error('Sign-in was cancelled')
    this.write(account,this.record(tokens,{client_id:client,subject:claims.sub,email:claims.email,scopes:[]}))
    attempt.status='completed';res.end('Signed in. You can close this window and return to AgentHub.')
   }catch(error){attempt.status='failed';attempt.error=String(error);res.writeHead(400);res.end('Sign-in failed. Return to AgentHub to inspect the status.')}
   finally{clearTimeout(attempt.timer);server.close()}
  })().catch(()=>{res.writeHead(500);res.end();server.close()})})
  await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)})
  const redirect='http://127.0.0.1:'+(server.address() as any).port+'/auth/callback'
  const attempt:Attempt={account,state,nonce,verifier,redirect,client:saved?.client_id??'dynamic_agent_client',server,status:'pending',timer:setTimeout(()=>{attempt.status='failed';attempt.error='Sign-in expired';server.close()},600000)}
  attempt.timer.unref();this.attempts.set(state,attempt)
  const query=new URLSearchParams({client_id:attempt.client,ext_agent_host_id:readFileSync(hostFile,'utf8'),response_type:'code',redirect_uri:redirect,scope:scopes,resource,state,nonce,code_challenge_method:'S256',code_challenge:createHash('sha256').update(verifier).digest('base64url'),...(!saved?{agent_name_hint:'AgentHub'}:{})})
  return {attempt:state,url:issuer+'/api/accounts/authorize?'+query,expiresIn:600}
 }
 status(id:string){const a=this.attempts.get(id);if(!a)throw Error('Unknown sign-in attempt');return {account:a.account,status:a.status,error:a.error}}
 private token(values:Record<string,string>){return this.json(issuer+'/api/accounts/oauth/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams(values)})}
 private async identity(token:string,client:string,nonce?:string){
  if(typeof token!=='string')throw Error('Missing identity token')
  const parts=token.split('.');if(parts.length!==3)throw Error('Invalid identity token')
  const header=JSON.parse(Buffer.from(parts[0]!,'base64url').toString()),claims=JSON.parse(Buffer.from(parts[1]!,'base64url').toString())
  const metadata=await this.json(issuer+'/.well-known/openid-configuration')
  if(metadata.issuer!==issuer||new URL(metadata.jwks_uri).origin!==issuer)throw Error('Unexpected identity issuer')
  const keys=await this.json(metadata.jwks_uri),key=keys.keys?.find((k:any)=>k.kid===header.kid&&k.kty==='RSA')
  if(header.alg!=='RS256'||!key||!verify('RSA-SHA256',Buffer.from(parts[0]+'.'+parts[1]),createPublicKey({key,format:'jwk'}),Buffer.from(parts[2]!,'base64url')))throw Error('Invalid identity signature')
  if(claims.iss!==issuer||!(Array.isArray(claims.aud)?claims.aud.includes(client):claims.aud===client)||Array.isArray(claims.aud)&&claims.aud.length>1&&claims.azp!==client||!Number.isFinite(claims.exp)||claims.exp<=Date.now()/1000||nonce!==undefined&&claims.nonce!==nonce||typeof claims.sub!=='string'||!claims.sub)throw Error('Invalid identity claims')
  return claims
 }
 private record(tokens:any,previous:Account):Account{
  const granted=typeof tokens.scope==='string'?tokens.scope.split(' '):previous.scopes
  if(!granted.includes('chatgpt.tokens.use.direct')||!granted.includes('resource.invoke'))throw Error('ChatGPT plan inference permission was not granted')
  if(typeof tokens.access_token!=='string'||!tokens.access_token||!Number.isFinite(tokens.expires_in)||tokens.expires_in<=0||String(tokens.token_type).toLowerCase()!=='bearer')throw Error('Invalid OAuth token response')
  return {...previous,access_token:tokens.access_token,refresh_token:tokens.refresh_token??previous.refresh_token,id_token:tokens.id_token??previous.id_token,expires_at:Date.now()+tokens.expires_in*1000,scopes:granted}
 }
 async credential(account:string):Promise<string>{
  const key=this.file(account),epoch=epochs.get(key)??0,pending=locks.get(key);if(signingOut.has(key))throw Error('Subscription sign-out is in progress');if(pending)return pending
  const work=(async()=>{const a=this.read(account);if(!a?.access_token)throw Error('Subscription sign-in required')
   if(a.expires_at&&a.expires_at>Date.now()+60000)return a.access_token
   if(!a.refresh_token)throw Error('Subscription sign-in expired')
   const tokens=await this.token({grant_type:'refresh_token',client_id:a.client_id,refresh_token:a.refresh_token,resource})
   if(tokens.id_token){const identity=await this.identity(tokens.id_token,a.client_id);if(identity.sub!==a.subject)throw Error('Refreshed account identity changed')}
   const next=this.record(tokens,a);if((epochs.get(key)??0)!==epoch)throw Error('Subscription session changed');this.write(account,next);return next.access_token!
  })();locks.set(key,work)
  try{return await work}finally{if(locks.get(key)===work)locks.delete(key)}
 }
 async logout(account:string){
  const key=this.file(account);signingOut.add(key);epochs.set(key,(epochs.get(key)??0)+1)
  try{
  for(const a of this.attempts.values())if(a.account===account&&['pending','exchanging'].includes(a.status)){a.status='failed';a.error='Signed out';clearTimeout(a.timer);a.server.close()}
  await locks.get(this.file(account))?.catch(()=>{})
  const a=this.read(account);if(!a)return {signedOut:true,revoked:false}
  let revoked=false
  try{if(a.refresh_token){const metadata=await this.json(issuer+'/.well-known/openid-configuration');if(new URL(metadata.revocation_endpoint).origin!==issuer)throw Error('Unexpected revocation endpoint');const r=await this.request(metadata.revocation_endpoint,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({token:a.refresh_token,token_type_hint:'refresh_token',client_id:a.client_id}),signal:AbortSignal.timeout(20000),redirect:'error'});revoked=r.ok}}catch{}
  const {access_token,refresh_token,id_token,expires_at,...identity}=a;this.write(account,identity)
  return {signedOut:true,revoked}
  }finally{signingOut.delete(key)}
 }
 async models(account:string){return this.json(resource+'/models',{headers:{authorization:'Bearer '+await this.credential(account)}})}
 close(){for(const a of this.attempts.values()){if(['pending','exchanging'].includes(a.status)){a.status='failed';a.error='Host stopped'}clearTimeout(a.timer);a.server.close()}}
}
