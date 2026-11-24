// Host-owned read-only discovery. Never use plugin-supplied endpoints or
// ambient credential references. No adapter construction or provider writes.
export type TargetDiscoveryAuth =
 | {kind:'feishu';appId:string;secret:string}
 | {kind:'slack';token:string;teamId:string}
export class TargetDiscoveryError extends Error {
 constructor(readonly code:'connector_discovery_unavailable'|'connector_discovery_throttled'|'connector_discovery_identity'){super(code)}
}
const fail=()=>new TargetDiscoveryError('connector_discovery_unavailable')
const pageLimit=3,pageSize=30,maxBytes=256_000
export async function discoverConnectorTargets(auth:TargetDiscoveryAuth,check:()=>void,signal:AbortSignal,request:typeof fetch=fetch){
 const deadline=AbortSignal.any([signal,AbortSignal.timeout(15_000)]),privateValues=auth.kind==='feishu'?[auth.appId,auth.secret]:[auth.token]
 const json=async(url:URL,options:RequestInit={})=>{
  check();deadline.throwIfAborted()
  const response=await request(url,{...options,signal:deadline,redirect:'error',cache:'no-store'})
  if(!response.ok){await response.body?.cancel().catch(()=>{});throw response.status===429?new TargetDiscoveryError('connector_discovery_throttled'):fail()}
  const reader=response.body?.getReader();if(!reader)throw fail()
  const decoder=new TextDecoder('utf-8',{fatal:true});let size=0,body=''
  try{while(true){const next=await reader.read();if(next.done)break;size+=next.value.length;if(size>maxBytes)throw fail();body+=decoder.decode(next.value,{stream:true})}body+=decoder.decode()}
  finally{await reader.cancel().catch(()=>{});reader.releaseLock()}
  check();deadline.throwIfAborted()
  return JSON.parse(body)
 }
 const rows=new Map<string,{id:string;label:string}>(),seen=new Set<string>()
 const add=(id:unknown,name:unknown)=>{
  const pattern=auth.kind==='feishu'?/^oc_[A-Za-z0-9_-]{1,96}$/:/^[CG][A-Z0-9]{1,96}$/
  if(typeof id!=='string'||!pattern.test(id)||privateValues.some(secret=>id.includes(secret)))throw fail()
  const clean=typeof name==='string'?name.replace(/[\p{Cc}\p{Cf}]/gu,' ').trim():''
  const label=clean&&clean.length<=160&&!privateValues.some(secret=>clean.includes(secret))?clean:id
  if(rows.size<pageLimit*pageSize&&!rows.has(id))rows.set(id,{id,label})
 }
 let cursor='',truncated=false
 let bearer:string
 if(auth.kind==='feishu'){
  const payload=await json(new URL('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal'),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({app_id:auth.appId,app_secret:auth.secret})})
  if(payload?.code!==0||typeof payload.tenant_access_token!=='string'||!/^[-_A-Za-z0-9.]{8,4096}$/.test(payload.tenant_access_token))throw fail()
  bearer=payload.tenant_access_token;privateValues.push(bearer)
 }else{
  bearer=auth.token
  const result=await json(new URL('https://slack.com/api/auth.test'),{method:'POST',headers:{authorization:'Bearer '+bearer}})
  if(result?.ok!==true||result.team_id!==auth.teamId||typeof result.bot_id!=='string'||!/^B[A-Z0-9]+$/.test(result.bot_id))throw new TargetDiscoveryError('connector_discovery_identity')
 }
 for(let page=0;page<pageLimit;page++){
  let next:unknown
  if(auth.kind==='feishu'){
   const url=new URL('https://open.feishu.cn/open-apis/im/v1/chats');url.searchParams.set('page_size',String(pageSize))
   if(cursor)url.searchParams.set('page_token',cursor)
   const result=await json(url,{headers:{authorization:'Bearer '+bearer}}),data=result?.data
   if(result?.code!==0||!Array.isArray(data?.items)||data.items.length>pageSize||typeof data.has_more!=='boolean')throw fail()
   for(const item of data.items)add(item?.chat_id,item?.name)
   next=data.has_more?data.page_token:''
   if(data.has_more&&!next)throw fail()
  }else{
   // List only conversations the verified bot is already a member of.
   const url=new URL('https://slack.com/api/users.conversations')
   url.searchParams.set('types','public_channel,private_channel');url.searchParams.set('exclude_archived','true')
   url.searchParams.set('limit',String(pageSize));if(cursor)url.searchParams.set('cursor',cursor)
   const result=await json(url,{headers:{authorization:'Bearer '+bearer}})
   if(result?.ok!==true||!Array.isArray(result.channels)||result.channels.length>pageSize)throw fail()
   const metadata=result.response_metadata
   if(metadata!==undefined&&(!metadata||typeof metadata!=='object'||Array.isArray(metadata)))throw fail()
   for(const item of result.channels){if(item?.is_archived===true)continue;add(item?.id,item?.name)}
   next=metadata?.next_cursor??''
  }
  if(typeof next!=='string'||next.length>1000||(next&&seen.has(next)))throw fail()
  if(!next){truncated=false;break}
  seen.add(next);cursor=next;truncated=true
 }
 check();deadline.throwIfAborted()
 return {targets:[...rows.values()],truncated}
}
