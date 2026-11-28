import type { Snapshot } from './client.ts'

// The personal conversation has one public assistant: the Router. Internal
// handoffs, acknowledgement cards and Worker replies belong to diagnostics.
export function publicMessage(message: Snapshot['messages'][number]) {
  return !message.recipient && !message.opening && !message.id.startsWith('card-preview:') &&
    message.speaker?.kind !== 'worker'
}
