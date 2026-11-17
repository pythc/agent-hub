import {expect,it} from 'vitest'
import {executionProblem,projectExecutionBlocker} from '../src/execution-blocker.ts'
it.each([
 ['HTTP 429 insufficient_quota SECRET','quota_exhausted','quotaExhausted'],
 ['quota_exhausted','quota_exhausted','quotaExhausted'],
 ['HTTP 429 rate limit','rate_limited','rateLimited'],
 ['authentication failed SECRET','auth_required','authRequired'],
 ['authentication failed; outcome_unknown','outcome_unknown','outcomeUnknown'],
 ['configuration_invalid','configuration_invalid','configuration'],
 ['context_permissions_changed','context_permissions_changed','contextChanged'],
])('projects %s without raw provider information',(error,problem,kind)=>{
 expect(executionProblem(error)).toBe(problem)
 const value=projectExecutionBlocker(problem,false)
 expect(value).toMatchObject({version:1,kind,retryPolicy:{automatic:false}})
 expect(JSON.stringify(value)).not.toContain('SECRET')
})
it('unknown effects take precedence over every repair suggestion',()=>{
 for(const problem of ['auth_required','quota_exhausted','rate_limited','interrupted'])expect(projectExecutionBlocker(problem,true)).toMatchObject({kind:'outcomeUnknown',lastEffectState:'unknown',resolution:'reconcile',retryPolicy:{mode:'never'}})
 expect(executionProblem('auth_required',true)).toBe('outcome_unknown')
})
it('uses only valid authoritative scheduling metadata and invents no retry time',()=>{
 expect(projectExecutionBlocker('rate_limited',false)?.retryPolicy).toEqual({mode:'after_repair',automatic:false})
 expect(projectExecutionBlocker('rate_limited',false,1234)?.retryPolicy.notBefore).toBe(1234)
 for(const value of [NaN,Infinity,-1,0,1.1])expect(projectExecutionBlocker('rate_limited',false,value)?.retryPolicy.notBefore).toBeUndefined()
 expect(projectExecutionBlocker('none',false)).toBeNull()
})
