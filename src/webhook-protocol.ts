import {createHmac,timingSafeEqual} from 'node:crypto'
import {lookup} from 'node:dns/promises'
import {BlockList,isIP} from 'node:net'
import {request as httpRequest} from 'node:http'
import {request as httpsRequest} from 'node:https'
import {z} from 'zod'

export class WebhookError extends Error {
 constructor(readonly status:number,readonly code:string,message=code){super(message)}
}
export const webhookConfigSchema=z.object({port:z.number().int().min(0).max(65535),loopbackCallbackOrigins:z.array(z.string().url()).max(10).default([])}).strict()
export const cloudEventSchema=z.object({specversion:z.literal('1.0'),id:z.string().min(1).max(200),source:z.string().url().max(1000),type:z.string().min(1).max(200),subject:z.string().max(1000).optional(),time:z.iso.datetime({offset:true}).optional(),datacontenttype:z.literal('application/json').optional(),data:z.record(z.string(),z.unknown())}).strict()
export type CloudEvent=z.infer<typeof cloudEventSchema>
export const headerId=/^[A-Za-z0-9_-]{1,200}$/
export function secretFromEnv(name:string):Buffer {
 const value=process.env[name]
 if(!value||!/^whsec_[A-Za-z0-9+/]+={0,2}$/.test(value))throw new WebhookError(503,'credential_unavailable')
 const key=Buffer.from(value.slice(6),'base64')
 if(key.length<24||key.length>64||key.toString('base64')!==value.slice(6))throw new WebhookError(503,'credential_unavailable')
 return key
}
export function signWebhook(key:Buffer,id:string,timestamp:string,body:Buffer|string){
 if(!headerId.test(id)||!/^\d{1,12}$/.test(timestamp))throw new WebhookError(400,'invalid_signature_headers')
 return 'v1,'+createHmac('sha256',key).update(id+'.'+timestamp+'.').update(body).digest('base64')
}
export function verifyWebhook(keys:Buffer[],headers:Record<string,string|undefined>,body:Buffer,now=Date.now()){
 const id=headers['webhook-id']??'',timestamp=headers['webhook-timestamp']??'',signatures=headers['webhook-signature']??''
 if(!headerId.test(id)||!/^\d{1,12}$/.test(timestamp)||Math.abs(now/1000-Number(timestamp))>300||signatures.length>2000)throw new WebhookError(401,'invalid_signature')
 const candidates=signatures.split(' ').filter(s=>/^v1,[A-Za-z0-9+/]{43}=$/.test(s)).map(s=>Buffer.from(s.slice(3),'base64'))
 let valid=false
 for(const key of keys){const expected=Buffer.from(signWebhook(key,id,timestamp,body).slice(3),'base64');for(const candidate of candidates)valid=timingSafeEqual(expected,candidate)||valid}
 if(!valid)throw new WebhookError(401,'invalid_signature')
 return id
}

// Reject non-public destinations, including mapped IPv4, special-use ranges and
// transition addresses. DNS is resolved on every attempt and pinned to the socket.
const specialAddresses=new BlockList(),globalV6=new BlockList()
for(const [address,prefix] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.88.99.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4]] as const)specialAddresses.addSubnet(address,prefix,'ipv4')
for(const [address,prefix] of [['2001::',23],['2001:db8::',32],['2002::',16],['3fff::',20]] as const)specialAddresses.addSubnet(address,prefix,'ipv6')
globalV6.addSubnet('2000::',3,'ipv6')
export function publicAddress(address:string):boolean {
 if(isIP(address)===4)return !specialAddresses.check(address,'ipv4')
 if(isIP(address)===6)return globalV6.check(address,'ipv6')&&!specialAddresses.check(address,'ipv6')
 return false
}
export function callbackURL(value:string,loopbackOrigins:readonly string[]=[]){
 const url=new URL(value),host=url.hostname.replace(/^\[|\]$/g,'')
 const local=loopbackOrigins.includes(url.origin)&&['127.0.0.1','::1'].includes(host)
 if(url.username||url.password||url.hash||url.search||url.href.length>2000||(!local&&url.protocol!=='https:')||local&&!['http:','https:'].includes(url.protocol)||isIP(host)&&!local&&!publicAddress(host))throw new WebhookError(400,'callback_target_forbidden')
 return {url,host,local}
}
export async function postWebhook(target:string,body:string,headers:Record<string,string>,loopbackOrigins:readonly string[],signal:AbortSignal,authorize:()=>void=()=>{}):Promise<{status:number;retryAfter?:string}>{
 const {url,host,local}=callbackURL(target,loopbackOrigins)
 const addresses=isIP(host)?[{address:host,family:isIP(host)}]:await new Promise<{address:string;family:number}[]>((resolve,reject)=>{
  const abort=()=>reject(signal.reason);if(signal.aborted){abort();return}signal.addEventListener('abort',abort,{once:true})
  lookup(host,{all:true,verbatim:true}).then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort))
 })
 if(!addresses.length||addresses.some(a=>!local&&!publicAddress(a.address)))throw new WebhookError(400,'callback_dns_forbidden')
 if(signal.aborted)throw signal.reason
 authorize()
 const pinned=addresses[0]!
 return new Promise((resolve,reject)=>{
  const request=(url.protocol==='https:'?httpsRequest:httpRequest)(url,{method:'POST',agent:false,signal,headers:{...headers,'content-type':'application/cloudevents+json','content-length':String(Buffer.byteLength(body))},lookup:(_hostname,options,done)=>options.all?done(null,[{address:pinned.address,family:pinned.family}] as any):done(null,pinned.address,pinned.family)},response=>{
   // Never follow redirects or retain untrusted response bodies.
   resolve({status:response.statusCode??0,retryAfter:response.headers['retry-after']});response.destroy()
  })
  request.once('error',reject);request.setTimeout(15000,()=>request.destroy(Error('Callback timeout')));request.end(body)
 })
}
