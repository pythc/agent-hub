import {createHash} from 'node:crypto'
import type {Store} from './store.ts'

export interface ApiSample {method:string;path:string;measurement:'http-request'|'cli-operation';ok:boolean;durationMs:number}
interface Bucket extends Omit<ApiSample,'ok'|'durationMs'> {day:string;source:string;provider:'feishu';count:number;failures:number;totalMs:number;maxMs:number}
const dayAt=(now:number)=>new Date(now+8*3600_000).toISOString().slice(0,10)
/** Calendar months, clamped at month end, using Beijing business dates. */
export function retentionDay(now:number){
  const [year,month,day]=dayAt(now).split('-').map(Number) as [number,number,number]
  const target=new Date(Date.UTC(year,month-3,1)),last=new Date(Date.UTC(target.getUTCFullYear(),target.getUTCMonth()+1,0)).getUTCDate()
  target.setUTCDate(Math.min(day,last));return target.toISOString().slice(0,10)
}
export function interfacePath(path:string){
  const p=path.split('?')[0]!.replace(/^\//,'').replace(/^open-apis\//,'')
  if(['bot/v3/info','auth/v3/tenant_access_token/internal','im/v1/messages'].includes(p))return '/open-apis/'+p
  if(/^im\/v1\/messages\/[^/]+\/resources\/[^/]+$/.test(p))return '/open-apis/im/v1/messages/:message_id/resources/:file_key'
  if(/^im\/v1\/messages\/[^/]+\/reply$/.test(p))return '/open-apis/im/v1/messages/:message_id/reply'
  if(/^im\/v1\/messages\/[^/]+$/.test(p))return '/open-apis/im/v1/messages/:message_id'
  if(/^im\/v1\/chats\/[^/]+\/members$/.test(p))return '/open-apis/im/v1/chats/:chat_id/members'
  if(/^typed\/threads\/[^/]+$/.test(p))return 'cli:thread-messages-list'
  return 'other'
}
export class ApiUsage {
  private prunedDay=''
  constructor(private store:Store,private clock=Date.now){}
  private prune(){
    const today=dayAt(this.clock());if(today===this.prunedDay)return
    this.store.db.prepare("DELETE FROM records WHERE kind='api-usage' AND json_extract(body,'$.day')<?").run(retentionDay(this.clock()))
    this.prunedDay=today
  }
  record(source:string,sample:ApiSample){
    this.prune()
    const day=dayAt(this.clock()),path=interfacePath(sample.path),method=sample.method.toUpperCase(),measurement=sample.measurement
    const id=createHash('sha256').update(JSON.stringify([day,source,method,path,measurement])).digest('hex')
    const old=this.store.get<Bucket>('api-usage',id),ms=Number.isFinite(sample.durationMs)?Math.max(0,Math.round(sample.durationMs)):0
    this.store.put('api-usage',id,{day,source,provider:'feishu',method,path,measurement,count:(old?.count??0)+1,failures:(old?.failures??0)+(sample.ok?0:1),totalMs:(old?.totalMs??0)+ms,maxMs:Math.max(old?.maxMs??0,ms)})
  }
  snapshot(){
    this.prune()
    const daily=this.store.list<Bucket>('api-usage').sort((a,b)=>b.day.localeCompare(a.day)||a.source.localeCompare(b.source)||a.path.localeCompare(b.path))
    const grouped=new Map<string,any>()
    for(const row of daily){const key=JSON.stringify([row.source,row.method,row.path,row.measurement]),old=grouped.get(key)??{source:row.source,provider:row.provider,method:row.method,path:row.path,measurement:row.measurement,count:0,failures:0,totalMs:0,maxMs:0};old.count+=row.count;old.failures+=row.failures;old.totalMs+=row.totalMs;old.maxMs=Math.max(old.maxMs,row.maxMs);grouped.set(key,old)}
    const interfaces=[...grouped.values()].map(({totalMs,...row})=>({...row,successes:row.count-row.failures,averageMs:Math.round(totalMs/row.count)})).sort((a,b)=>b.count-a.count)
    return {scope:'AgentHub Feishu connector operations only; excludes other applications and CLI internal HTTP calls. Not the provider quota ledger.',retention:{months:2,timezone:'Asia/Shanghai',granularity:'day',from:retentionDay(this.clock()),through:dayAt(this.clock())},interfaces,daily}
  }
}

export function apiUsagePage(snapshot:ReturnType<ApiUsage['snapshot']>){
  const escape=(value:unknown)=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!))
  const rows=snapshot.interfaces.map(r=>'<tr>'+[r.source,r.method+' '+r.path,r.measurement==='cli-operation'?'CLI 操作':'HTTP 请求',r.count,r.successes,r.failures,r.averageMs+' ms',r.maxMs+' ms'].map(c=>'<td>'+escape(c)+'</td>').join('')+'</tr>').join('')
  return '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>飞书接口统计</title><style>body{font:16px/1.6 system-ui,sans-serif;margin:0;background:#f4f6fa;color:#17243a}main{max-width:1280px;margin:40px auto;padding:24px}h1{font-size:26px}p{color:#54637a}section{overflow:auto;background:white;border:1px solid #d9e0eb;border-radius:12px;padding:16px}table{border-collapse:collapse;min-width:880px;width:100%;font-size:14px}th,td{text-align:left;padding:12px;border-bottom:1px solid #e6ebf2}th{background:#eef3fa}a{color:#2459b7}header{display:flex;align-items:center;justify-content:space-between;gap:20px}</style><main><header><h1>飞书接口统计</h1><a href="/api-usage/view">刷新统计</a></header><p>保留最近两个月，按北京时间每日汇总。当前范围：'+snapshot.retention.from+' 至 '+snapshot.retention.through+'。</p><p>统计本服务飞书连接的请求与 CLI 操作，不含其他应用和 CLI 内部请求，不等同于飞书配额账单。旧记录自动滚动清理。</p><section><table><thead><tr>'+['连接','接口','计量方式','调用','成功','失败','平均耗时','最大耗时'].map(c=>'<th scope="col">'+c+'</th>').join('')+'</tr></thead><tbody>'+ (rows||'<tr><td colspan="8">尚无接口调用记录</td></tr>')+'</tbody></table></section><p><a href="/api-usage">查看每日 JSON 数据</a> · <a href="/configure">返回工作台</a></p></main></html>'
}
