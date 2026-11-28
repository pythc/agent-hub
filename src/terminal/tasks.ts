import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { managedWorkspacePath } from '../workspace.ts'
import type { Runtime } from '../runtime.ts'
import { projectWorkspace, type CodeReceipt } from '../project-code.ts'
import type { Run } from '../store.ts'
import type { Approval } from '../approvals.ts'
import { ChatError } from '../chat-errors.ts'
import { isApprovalPending } from '../chat-workflow.ts'

const exec = promisify(execFile)
export async function terminalTask(
  host: Runtime,
  owner: string,
  input: {
    conversation: string
    ticket: string
    action: 'diff' | 'stop' | 'approvals' | 'answer'
    approval?: string
    answer?: unknown
  }
) {
  const { conversation, ticket } = input
  const view = host.chat.view(conversation, owner)
  const hasTask = view.tasks.some((t) => t.id === ticket)
  if (input.action === 'approvals' || input.action === 'answer') {
    const requests = view.approvals.filter((a) => a.ticketId === ticket)
    if (!hasTask && !requests.length)
      throw new ChatError('task_missing', 'Task not found in this conversation.', 404)
    const legacy = hasTask
      ? host.store.list<Approval>('approval').filter(
          (a) => !a.chat && a.ticketId === ticket && a.status === 'pending' && a.expiresAt > Date.now()
        )
      : []
    if (input.action === 'approvals')
      return {
        pending: [
          ...requests.filter((a) => isApprovalPending(a)).map((a) => ({
            id: a.id,
            method: a.method,
            params: { ...a.facts, ...(a.questions.length ? { questions: a.questions } : {}) },
            expiresAt: a.expiresAt
          })),
          ...legacy.map((a) => ({
            id: a.id,
            method: a.native.method,
            params: a.native.params,
            expiresAt: a.expiresAt
          }))
        ]
      }
    if (input.approval && requests.some((a) => a.id === input.approval))
      host.chat.answerApproval(conversation, owner, input.approval, input.answer)
    else if (input.approval && legacy.some((a) => a.id === input.approval))
      host.approvals.answer(input.approval, input.answer)
    else
      throw new ChatError('approval_missing', 'No matching request.', 404)
    return { answered: input.approval }
  }
  if (!hasTask)
    throw new ChatError('task_missing', 'Task not found in this conversation.', 404)
  if (input.action === 'stop') {
    await host.stop(ticket)
    return { stopped: ticket }
  }
  const receipt = host.store
    .list<CodeReceipt>('project-commit')
    .findLast((r) => r.ticketId === ticket && r.diff)
  if (receipt)
    return { diff: receipt.diff!.text, truncated: receipt.diff!.truncated, head: receipt.head }
  const run = host.store.get<Run>('run', ticket)
  const task = host.store.tickets.get(ticket)!
  const source = host.sources.get(task.mandate.actor.source)!.config
  const project = host.goals.forTask(ticket)?.project
  const expected = project ? projectWorkspace(host.config.stateDir, ticket)
    : managedWorkspacePath(host.config.stateDir, run?.workspaceId ?? ticket)
  const root = view.conversation.project ?? source.cwd
  if (!run || !existsSync(join(run.cwd, '.git')) ||
    (await realpath(run.cwd).catch(() => null)) !== (await realpath(expected).catch(() => undefined)))
    throw new ChatError('diff_unavailable', 'No Git diff is available for this Worker task. Use /files for delivered files.', 404)
  const git = async (cwd: string, args: string[]) =>
    (
      await exec('git', ['--no-pager', '-c', 'core.fsmonitor=false', '-C', cwd, ...args], {
        timeout: 5000,
        maxBuffer: 2_000_000
      })
    ).stdout
  const head = (await git(root, ['rev-parse', 'HEAD'])).trim()
  const base = project?.base ?? (await git(run.cwd, ['merge-base', head, 'HEAD'])).trim()
  const diff = await git(run.cwd, ['diff', '--no-ext-diff', '--no-textconv', base, '--'])
  const untracked = (await git(run.cwd, ['ls-files', '--others', '--exclude-standard', '-z']))
    .split('\0')
    .filter(Boolean)
  return { diff, untracked, base }
}
