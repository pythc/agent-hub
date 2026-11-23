/** A fixed vocabulary. Never carry provider payloads, identifiers or exception text. */
export type ConnectorFailureKind = 'auth_required' | 'throttled' | 'timeout' | 'terminal' | 'unknown'
export interface ConnectorFailure {
  kind: ConnectorFailureKind
  effectUnknown: boolean
  retryAfterMs?: number
}
const maxRetryMs = 86_400_000
export function retryDelay(value: string | null, now = Date.now()): number | undefined {
  if (!value) return
  const field = value.trim()
  const delay = /^\d+$/.test(field) ? Number(field) * 1000
    : /^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(field) ? Date.parse(field) - now
    : NaN
  if (!Number.isFinite(delay)) return
  return Math.min(maxRetryMs, Math.max(0, delay))
}

export function readFailureHint(value: unknown): Pick<ConnectorFailure,'kind'|'retryAfterMs'> | undefined {
  if (!value || typeof value !== 'object') return
  const input = value as Record<string,unknown>
  const kind = input.kind
  if (kind !== 'auth_required' && kind !== 'throttled' && kind !== 'timeout' && kind !== 'terminal' && kind !== 'unknown') return
  const delay = input.retryAfterMs
  return {kind,...(kind === 'throttled' && typeof delay === 'number' && Number.isSafeInteger(delay) && delay >= 0
    ? {retryAfterMs:Math.min(delay,maxRetryMs)} : {})}
}

export function recoveryText(failure: ConnectorFailure): string {
  const condition = {
    auth_required: 'Connector credentials or permissions need attention.',
    throttled: 'Connector rate limited.',
    timeout: 'Connector request timed out.',
    terminal: 'Connector rejected the operation.',
    unknown: 'Connector operation failed.',
  }[failure.kind]
  if (failure.effectUnknown) return condition + ' Check the original destination; the effect is unknown.'
  if (failure.kind === 'throttled') return condition + ' Wait before issuing a new request.'
  return condition
}

export class ConnectorOperationError extends Error {
  readonly connectorFailure: ConnectorFailure
  constructor(kind: ConnectorFailureKind, effectUnknown: boolean, retryAfterMs?: number) {
    const failure = {...(readFailureHint({kind,retryAfterMs})??{kind:'unknown' as const}),effectUnknown}
    super(recoveryText(failure))
    this.connectorFailure = failure
  }
}

export function requestFailure(error: unknown, effectUnknown: boolean): ConnectorOperationError {
  if (error instanceof ConnectorOperationError) {
    const {kind,retryAfterMs} = error.connectorFailure
    return new ConnectorOperationError(kind,effectUnknown||error.connectorFailure.effectUnknown,retryAfterMs)
  }
  const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')
  return new ConnectorOperationError(timedOut ? 'timeout' : 'unknown',effectUnknown)
}
