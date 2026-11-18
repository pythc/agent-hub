import {expect,it} from 'vitest'
import {quietHoursSchema,quietUntil} from '../src/notification-quiet-hours.ts'
const until=(timezone:string,start:string,end:string,now:string)=>{const at=quietUntil({timezone,start,end},Date.parse(now));return at===undefined?undefined:new Date(at).toISOString()}
it('uses inclusive start and exclusive end with same-day and cross-midnight windows',()=>{
 expect(until('Asia/Shanghai','22:00','08:00','2026-11-18T14:00:00Z')).toBe('2026-11-19T00:00:00.000Z')
 expect(until('Asia/Shanghai','22:00','08:00','2026-11-19T00:00:00Z')).toBeUndefined()
 expect(until('UTC','09:00','10:00','2026-11-18T09:59:12Z')).toBe('2026-11-18T10:00:00.000Z')
 expect(until('UTC','09:00','10:00','2026-11-18T08:59:59Z')).toBeUndefined()
})
it('releases at the first real non-quiet minute at DST gaps and protects repeated hours',()=>{
 expect(until('America/New_York','01:00','02:30','2026-03-08T06:30:00Z')).toBe('2026-03-08T07:00:00.000Z')
 expect(until('America/New_York','01:00','02:00','2026-11-01T05:30:00Z')).toBe('2026-11-01T07:00:00.000Z')
 expect(until('America/New_York','01:00','01:45','2026-11-01T06:15:00Z')).toBe('2026-11-01T06:45:00.000Z')
})
it('rejects invalid zones, invalid local time and ambiguous all-day windows',()=>{
 for(const value of [{timezone:'Not/AZone',start:'09:00',end:'10:00'},{timezone:'UTC',start:'24:00',end:'10:00'},{timezone:'UTC',start:'09:00',end:'09:00'}])expect(quietHoursSchema.safeParse(value).success).toBe(false)
})
