import {z} from 'zod'
const time=z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)
export const quietHoursSchema=z.object({timezone:z.string().min(1).max(100),start:time,end:time}).strict().superRefine((v,c)=>{
 try{new Intl.DateTimeFormat('en',{timeZone:v.timezone}).format()}catch{c.addIssue({code:'custom',message:'Use an IANA timezone'})}
 if(v.start===v.end)c.addIssue({code:'custom',message:'Quiet window start and end must differ'})
})
export type QuietHours=z.infer<typeof quietHoursSchema>
/** Wall-clock membership, including both copies of a folded hour. Gaps release at
 * the first existing minute outside the window, not a fabricated local instant. */
export function quietUntil(window:QuietHours|null|undefined,now:number):number|undefined{
 if(!window)return
 const format=new Intl.DateTimeFormat('en-GB',{timeZone:window.timezone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'})
 const inside=(at:number)=>{const p=format.formatToParts(at),time=p.find(p=>p.type==='hour')!.value+':'+p.find(p=>p.type==='minute')!.value;return window.start<window.end?time>=window.start&&time<window.end:time>=window.start||time<window.end}
 if(!inside(now))return
 let next=Math.floor(now/60000)*60000+60000
 for(let i=0;i<2880;i++,next+=60000)if(!inside(next))return next
 // Bound unusual timezone jumps conservatively; the next flush reevaluates.
 return next
}
