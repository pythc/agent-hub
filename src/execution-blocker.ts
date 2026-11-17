/** A read-only explanation, not an authorization or a retry scheduler.
 * Only fixed vocabulary and authoritative scheduled timestamps cross this boundary. */
export interface ExecutionBlocker {
 version:1
 kind:'authRequired'|'rateLimited'|'quotaExhausted'|'outcomeUnknown'|'contextChanged'|'configuration'|'interrupted'|'failed'
 owner:'operator'|'runtime'
 resource:'task'|'backend'|'context'|'effects'
 resolution:'reconnect_same_account'|'wait_for_policy'|'review_rate_limit'|'review_quota'|'reconcile'|'review_context'|'review_configuration'|'inspect'
 retryPolicy:{mode:'never'|'after_repair'|'scheduled'|'manual';automatic:false;notBefore?:number}
 lastEffectState:'unknown'|'not_established'
}
export function executionProblem(error:string,uncertain=false):string {
 // An authentication error accompanying an ambiguous effect cannot make replay safe.
 if(uncertain||/outcome_unknown|uncertain|unconfirmed|reconciliation required/i.test(error))return 'outcome_unknown'
 if(/context_permissions_changed/.test(error))return 'context_permissions_changed'
 if(/context_budget_exceeded/.test(error))return 'context_budget_exceeded'
 if(/quota_exhausted|insufficient_quota|quota exceeded|quota exhausted|billing.?hard.?limit|usage limit reached/i.test(error))return 'quota_exhausted'
 if(/auth_required|credentials required|authentication|\b401\b/i.test(error))return 'auth_required'
 if(/configuration_invalid|configuration or credentials/i.test(error))return 'configuration_invalid'
 if(/rate_limited|rate.?limit|\b429\b/i.test(error))return 'rate_limited'
 if(/transient/.test(error))return 'transient'
 return 'none'
}
export function projectExecutionBlocker(problem:string,unknown:boolean,scheduledAt?:number,hasScheduledJob=false):ExecutionBlocker|null {
 const base={version:1 as const,lastEffectState:unknown?'unknown' as const:'not_established' as const}
 const retry=(mode:ExecutionBlocker['retryPolicy']['mode']):ExecutionBlocker['retryPolicy']=>({mode,automatic:false})
 if(unknown||problem==='outcome_unknown')return {...base,kind:'outcomeUnknown',owner:'operator',resource:'effects',resolution:'reconcile',retryPolicy:retry('never')}
 if(problem==='auth_required')return {...base,kind:'authRequired',owner:'operator',resource:'backend',resolution:'reconnect_same_account',retryPolicy:retry('after_repair')}
 if(problem==='quota_exhausted')return {...base,kind:'quotaExhausted',owner:'operator',resource:'backend',resolution:'review_quota',retryPolicy:retry('after_repair')}
 if(problem==='rate_limited'){
  const timed=Number.isSafeInteger(scheduledAt)&&scheduledAt!>0,scheduled=hasScheduledJob||timed
  return {...base,kind:'rateLimited',owner:scheduled?'runtime':'operator',resource:'backend',resolution:scheduled?'wait_for_policy':'review_rate_limit',retryPolicy:scheduled?{...retry('scheduled'),...(timed?{notBefore:scheduledAt}:{})}:retry('after_repair')}
 }
 if(['context_permissions_changed','context_budget_exceeded'].includes(problem))return {...base,kind:'contextChanged',owner:'operator',resource:'context',resolution:'review_context',retryPolicy:retry('after_repair')}
 if(problem==='configuration_invalid')return {...base,kind:'configuration',owner:'operator',resource:'backend',resolution:'review_configuration',retryPolicy:retry('after_repair')}
 if(['interrupted','failed','transient'].includes(problem))return {...base,kind:problem==='interrupted'?'interrupted':'failed',owner:'operator',resource:'task',resolution:'inspect',retryPolicy:retry('manual')}
 return null
}
