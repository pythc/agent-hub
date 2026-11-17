import {TransientModelError} from '../model.ts'

/** Fixed diagnostics only: never retain upstream messages, URLs, headers or credentials. */
export type ApiFailureCode='api_key_rejected'|'api_quota_exhausted'|'api_rate_limited'|'api_request_rejected'|'api_model_or_endpoint_missing'|'api_service_unavailable'|'api_http_error'|'connection_timeout'|'connection_network_failed'|'model_output_truncated'|'model_reply_invalid'
export class ApiFailure extends Error {
 constructor(readonly code:ApiFailureCode,readonly httpStatus?:number){super(httpStatus!==undefined?'Backend HTTP '+httpStatus+': '+code:code==='model_reply_invalid'?'Backend final output failed the required JSON schema':code);this.name='ApiFailure'}
}
export class ApiNetworkFailure extends TransientModelError {
 constructor(readonly code:'connection_timeout'|'connection_network_failed'){super(code);this.name='ApiNetworkFailure'}
}
