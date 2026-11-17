import type {BackendErrorCode} from '../backend-sdk.ts'
export function cliFailure(text:string):BackendErrorCode{
 if(/\b401\b|unauthorized|not logged in|login required|invalid.api.key|invalid.*credential/i.test(text))return 'auth_required'
 if(/\b402\b|insufficient.*(?:credit|balance)|quota.*exhausted|billing.*(?:required|limit)|credit balance|free usage.*(?:limit|exceed)|insufficient_quota/i.test(text))return 'quota_exhausted'
 if(/\b429\b|rate.?limit/i.test(text))return 'rate_limited'
 if(/\b403\b|forbidden|unsupported.?country/i.test(text))return 'provider_rejected'
 if(/unknown option|invalid auth method|error processing settings|model.{0,30}not found/i.test(text))return 'configuration_invalid'
 return 'process_failed'
}
