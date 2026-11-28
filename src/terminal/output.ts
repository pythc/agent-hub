import type { Snapshot } from './client.ts'
import { publicMessage } from './conversation.ts'

// NDJSON carries message replacements, not token deltas: a streaming message keeps its ID.
export class PrintEvents {
  private messages = new Map<string, string>()
  private tasks = new Map<string, string>()
  constructor(private write: (event: unknown) => void) {}
  update(view: Snapshot, runId: string) {
    for (const message of view.messages) {
      if (message.runId !== runId || message.role !== 'assistant' || !publicMessage(message)) continue
      const value = { id: message.id, text: message.text, status: message.status, speaker: message.speaker }
      const encoded = JSON.stringify(value)
      if (this.messages.get(message.id) === encoded) continue
      this.messages.set(message.id, encoded)
      this.write({ type: 'assistant', conversationId: view.conversation.id, runId, message: value })
    }
    for (const task of view.tasks) {
      const encoded = JSON.stringify(task)
      if (this.tasks.get(task.id) === encoded) continue
      this.tasks.set(task.id, encoded)
      this.write({ type: 'task', conversationId: view.conversation.id, runId, task })
    }
  }
}
