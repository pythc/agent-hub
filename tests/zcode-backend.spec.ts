import {it,expect} from 'vitest'
import {zcodeResult,classifyZcodeFailure} from '../plugins/backend-zcode/index.ts'
it('accepts the CLI result envelope and rejects an error even when a result is also present',()=>{
 const result=JSON.stringify({type:'result',sessionId:'sess_test',turnId:'turn_test',response:'你好'})
 expect(zcodeResult(result)).toEqual({threadId:'sess_test',turnId:'turn_test',text:'你好'})
 expect(()=>zcodeResult(result+'\n'+JSON.stringify({type:'error',message:'HTTP 405 unusual activity'}))).toThrow('provider_rejected')
 expect(()=>zcodeResult(result+'\n'+result)).toThrow('invalid_output')
 expect(()=>zcodeResult(JSON.stringify({type:'result',sessionId:'sess_test',response:''}))).toThrow('invalid_output')
})
it('does not classify quota exhaustion or provider rejection as transient retries',()=>{
 expect(classifyZcodeFailure('HTTP 429 business 1113')).toBe('quota_exhausted')
 expect(classifyZcodeFailure('HTTP 405 business 3012')).toBe('provider_rejected')
 expect(classifyZcodeFailure('HTTP 429')).toBe('rate_limited')
 expect(classifyZcodeFailure('HTTP 401')).toBe('auth_required')
 expect(classifyZcodeFailure('Select a model before sending a message')).toBe('configuration_invalid')
})
