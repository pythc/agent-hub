import {z} from 'zod'

const timestamp=z.string().datetime({offset:true})
export const timingSchema=z.object({
 kind:z.enum(['once','interval','daily','weekly']), timezone:z.string().default('Asia/Shanghai'),
 startAt:timestamp, endAt:timestamp.optional(), intervalSeconds:z.number().int().min(60).optional(),
 time:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(), weekdays:z.array(z.number().int().min(0).max(6)).min(1).optional(),
}).strict().superRefine((v,c)=>{
 try{new Intl.DateTimeFormat('en',{timeZone:v.timezone}).format()}catch{c.addIssue({code:'custom',message:'Use an IANA timezone'})}
 if(v.endAt&&Date.parse(v.endAt)<=Date.parse(v.startAt))c.addIssue({code:'custom',message:'endAt must be after startAt'})
 if(v.kind==='interval'&&!v.intervalSeconds)c.addIssue({code:'custom',message:'intervalSeconds required'})
 if(['daily','weekly'].includes(v.kind)&&!v.time)c.addIssue({code:'custom',message:'Local time required'})
 if(v.kind==='weekly'&&!v.weekdays)c.addIssue({code:'custom',message:'weekdays required (Sunday = 0)'})
})
export type Timing=z.infer<typeof timingSchema>
const formats=new Map<string,Intl.DateTimeFormat>()
function parts(at:number,zone:string){
 let f=formats.get(zone);if(!f){f=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});formats.set(zone,f)}
 return Object.fromEntries(f.formatToParts(at).filter(p=>p.type!=='literal').map(p=>[p.type,Number(p.value)])) as Record<string,number>
}
/** Resolve a local wall time. Gaps have no occurrence; folds use the first instant. */
function wall(year:number,month:number,day:number,hour:number,minute:number,zone:string){
 const nominal=Date.UTC(year,month-1,day,hour,minute),offsets=new Set<number>()
 for(const h of [-36,-12,0,12,36]){const at=nominal+h*3600000,p=parts(at,zone);offsets.add(Date.UTC(p.year!,p.month!-1,p.day!,p.hour!,p.minute!,p.second!)-at)}
 return [...offsets].map(o=>nominal-o).filter(at=>{const p=parts(at,zone);return p.year===year&&p.month===month&&p.day===day&&p.hour===hour&&p.minute===minute}).sort((a,b)=>a-b)[0]
}
// Two weekly cycles plus a day for timezone offset changes. A missing wall time
// (or an entire skipped local date) must not exhaust a recurring schedule.
const calendarHorizonDays=15
/** Inclusive lower bound; gaps are skipped and folds execute only once. */
export function nextTime(t:Timing,after:number):number|undefined{
 const start=Date.parse(t.startAt),from=Math.max(start,after),end=t.endAt?Date.parse(t.endAt):Infinity
 let found:number|undefined
 if(t.kind==='once')found=start>=after?start:undefined
 else if(t.kind==='interval')found=start+Math.max(0,Math.ceil((from-start)/(t.intervalSeconds!*1000)))*t.intervalSeconds!*1000
 else{
  const p=parts(from,t.timezone),[h,m]=t.time!.split(':').map(Number)
  for(let n=0;n<=calendarHorizonDays;n++){
   const d=new Date(Date.UTC(p.year!,p.month!-1,p.day!+n))
   if(t.kind==='weekly'&&!t.weekdays!.includes(d.getUTCDay()))continue
   const at=wall(d.getUTCFullYear(),d.getUTCMonth()+1,d.getUTCDate(),h!,m!,t.timezone)
   if(at!==undefined&&at>=from){found=at;break}
  }
 }
 return found!==undefined&&found<=end?found:undefined
}
/** Coalesce an offline backlog into the latest due occurrence, never a replay burst. */
export function latestDue(t:Timing,first:number,now:number):number{
 if(t.kind==='once')return first
 if(t.kind==='interval')return first+Math.floor((now-first)/(t.intervalSeconds!*1000))*t.intervalSeconds!*1000
 let candidate=nextTime(t,Math.max(first,now-calendarHorizonDays*86400000)),latest=first
 while(candidate!==undefined&&candidate<=now){latest=candidate;candidate=nextTime(t,candidate+1)}
 return latest
}
