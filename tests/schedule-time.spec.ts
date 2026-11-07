import {it,expect} from 'vitest'
import {timingSchema,nextTime,latestDue} from '../src/schedule-time.ts'
const utc=(x:number|undefined)=>x===undefined?undefined:new Date(x).toISOString()
it('validates timing fields, zones, interval bounds and end limits',()=>{
 for(const extra of [{timezone:'Moon/Base'},{kind:'interval',intervalSeconds:59},{kind:'weekly',time:'09:00'},{endAt:'2026-01-01T00:00:00Z'}])expect(()=>timingSchema.parse({kind:'once',startAt:'2026-11-07T00:00:00Z',...extra})).toThrow()
 const t=timingSchema.parse({kind:'once',startAt:'2026-11-07T09:00:00+08:00'})
 expect(utc(nextTime(t,0))).toBe('2026-11-07T01:00:00.000Z');expect(nextTime(t,Date.parse(t.startAt)+1)).toBeUndefined()
})
it('aligns fixed intervals and coalesces downtime without accumulating drift',()=>{
 const t=timingSchema.parse({kind:'interval',intervalSeconds:60,startAt:'2026-11-07T00:00:00Z',endAt:'2026-11-07T00:10:00Z'}),start=Date.parse(t.startAt)
 expect(nextTime(t,start+1000)).toBe(start+60000);expect(latestDue(t,start,start+9*60000+2500)).toBe(start+9*60000);expect(nextTime(t,start+11*60000)).toBeUndefined()
})
it('uses local calendar dates across midnight and weekly boundaries',()=>{
 const t=timingSchema.parse({kind:'weekly',time:'00:15',timezone:'Asia/Shanghai',weekdays:[1],startAt:'2026-11-07T00:00:00Z'})
 expect(utc(nextTime(t,Date.parse(t.startAt)))).toBe('2026-11-08T16:15:00.000Z')
 const daily=timingSchema.parse({...t,kind:'daily',startAt:'2026-01-01T00:00:00Z'})
 expect(utc(latestDue(daily,Date.parse('2026-01-01T16:15:00Z'),Date.parse('2026-11-07T20:00:00Z')))).toBe('2026-11-07T16:15:00.000Z')
})
it('skips nonexistent DST times and executes a repeated local time only once',()=>{
 const spring=timingSchema.parse({kind:'daily',time:'02:30',timezone:'America/New_York',startAt:'2026-03-07T00:00:00Z'})
 expect(utc(nextTime(spring,Date.parse('2026-03-08T00:00:00Z')))).toBe('2026-03-09T06:30:00.000Z')
 const fall=timingSchema.parse({...spring,time:'01:30',startAt:'2026-11-01T00:00:00Z'})
 const first=nextTime(fall,Date.parse(fall.startAt))!
 expect(utc(first)).toBe('2026-11-01T05:30:00.000Z');expect(utc(nextTime(fall,first+1))).toBe('2026-11-02T06:30:00.000Z')
})
