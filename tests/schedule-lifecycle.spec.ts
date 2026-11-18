import {expect,it} from 'vitest'
import {scheduledRunLifecycle,schedulePlanState} from '../src/schedule-lifecycle.ts'
import type {ScheduledRun} from '../src/router-proactive.ts'
const run={id:'r',scheduleId:'plan',scopeId:'s',revision:3,scheduledAt:1000,createdAt:1200,state:'completed',taskIds:[],delivery:'sent'} as unknown as ScheduledRun
it('separates active, due, paused and expired plans with explicit fixed policies',()=>{
 expect(schedulePlanState({active:true,nextAt:1500,revision:2},1000)).toMatchObject({state:'scheduled',nextDueAt:1500,misfire:'coalesce_latest',overlap:'skip'})
 expect(schedulePlanState({active:true,nextAt:500,revision:2},1000).state).toBe('due')
 expect(schedulePlanState({active:false,nextAt:500,revision:2},1000)).toMatchObject({state:'paused',nextDueAt:null})
 expect(schedulePlanState({active:true,revision:2},1000)).toMatchObject({state:'expired',nextDueAt:null})
})
it('does not invent legacy queued/started times or recipient confirmation from execution success',()=>{
 const result=scheduledRunLifecycle(run,[])
 expect(result).toMatchObject({plan:{id:'plan',revision:3},trigger:{kind:'unknown',dueAt:1000,observedAt:1200,firstDueAt:null,backlog:'unknown'},execution:{state:'completed',queuedAt:null,startedAt:null,finishedAt:null},delivery:{state:'none',recipientReadback:'not_observed'}})
})
it('keeps planned, observed, queued, first-start and finish observations distinct',()=>{
 expect(scheduledRunLifecycle({...run,firstDueAt:100,triggerKind:'scheduled',queuedAt:1200,startedAt:1300,finishedAt:1400},[{status:'sent'}])).toMatchObject({trigger:{dueAt:1000,observedAt:1200,firstDueAt:100,backlog:'coalesced'},execution:{queuedAt:1200,startedAt:1300,finishedAt:1400},delivery:{state:'sent',messages:1,recipientReadback:'not_observed'}})
})
it.each([['uncertain','unknown'],['sending','sending'],['held','held'],['dropped','dropped'],['failed','failed'],['pending','pending'],['sent','sent'],['__proto__','unknown'],['new-status','unknown']])('projects %s conservatively as %s', (status,expected)=>{
 expect(scheduledRunLifecycle(run,[{status}]).delivery).toMatchObject({state:expected,messages:1,recipientReadback:'not_observed'})
})
it('does not let one sent message hide unknown, pending or failed companions',()=>{
 for(const [status,state] of [['uncertain','unknown'],['pending','pending'],['failed','failed']])expect(scheduledRunLifecycle(run,[{status:'sent'},{status:status!}]).delivery.state).toBe(state)
})
it('rejects malformed times and provenance without rewriting old records',()=>{
 const legacy={...run,firstDueAt:2000,queuedAt:NaN,startedAt:-1,finishedAt:Infinity,triggerKind:'forged'} as unknown as ScheduledRun
 const before=JSON.stringify(legacy)
 expect(scheduledRunLifecycle(legacy,[])).toMatchObject({trigger:{kind:'unknown',backlog:'unknown'},execution:{queuedAt:null,startedAt:null,finishedAt:null}})
 expect(JSON.stringify(legacy)).toBe(before)
})
