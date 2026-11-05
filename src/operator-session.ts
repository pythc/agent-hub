import {randomBytes,createHash} from 'node:crypto'
import type {IncomingMessage,ServerResponse} from 'node:http'

const digest=(value:string)=>createHash('sha256').update(value).digest('hex')
/** Local operator pairing is separate from the read-only instructions shared with coworkers. */
export class OperatorSessions {
 private cookieName='agenthub_operator'
 private pairs=new Map<string,number>()
 private sessions=new Map<string,number>()
 bindOrigin(origin:string){this.cookieName='agenthub_operator_'+new URL(origin).port}
 private prune(){const now=Date.now();for(const map of [this.pairs,this.sessions])for(const [key,expires]of map)if(expires<=now)map.delete(key)}
 link(origin:string){this.prune();if(this.pairs.size>=20)this.pairs.delete(this.pairs.keys().next().value!);const code=randomBytes(32).toString('base64url');this.pairs.set(digest(code),Date.now()+600000);return origin+'/configure#pair='+code}
 pair(code:string,response:ServerResponse){
  this.prune();const key=digest(code)
  if(!this.pairs.delete(key))return false
  if(this.sessions.size>=100)this.sessions.delete(this.sessions.keys().next().value!)
  const session=randomBytes(32).toString('base64url');this.sessions.set(digest(session),Date.now()+12*60*60*1000)
  response.setHeader('set-cookie',this.cookieName+'='+session+'; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200')
  return true
 }
 authorized(request:IncomingMessage){this.prune();const prefix=this.cookieName+'=',cookie=String(request.headers.cookie??'').split(';').map(v=>v.trim()).find(v=>v.startsWith(prefix))?.slice(prefix.length);return !!cookie&&this.sessions.has(digest(cookie))}
 logout(request:IncomingMessage,response:ServerResponse){const prefix=this.cookieName+'=',cookie=String(request.headers.cookie??'').split(';').map(v=>v.trim()).find(v=>v.startsWith(prefix))?.slice(prefix.length);if(cookie)this.sessions.delete(digest(cookie));response.setHeader('set-cookie',this.cookieName+'=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0')}
}
