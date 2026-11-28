import { byName } from './list-order.ts'
import type { CapabilitySnapshot } from '../capability-types.ts'
import { execFile } from 'node:child_process'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { commands, pendingDecisions } from './commands.ts'
import type { Snapshot } from './client.ts'
import { isApprovalPending } from '../chat-workflow.ts'

const exec = promisify(execFile)
export interface Choice {
  label: string
  detail: string
  value: string
  submit?: boolean
}
export interface Suggestions {
  title: string
  kind?: 'commands' | 'capabilities' | 'files'
  items: Choice[]
  start: number
  end: number
  empty?: string
}

export async function projectFiles(cwd: string): Promise<string[]> {
  try {
    const { stdout } = await exec(
      'git',
      ['ls-files', '-co', '--exclude-standard', '-z', '--', '.'],
      {
        cwd,
        maxBuffer: 32 * 1024 * 1024,
        timeout: 7000
      }
    )
    return byName([...new Set(stdout.split('\0').filter(Boolean))], name => name)
  } catch {
    // Outside a Git project, offer regular files without following directory symlinks.
    const dirs = [''],
      files: string[] = []
    for (let i = 0; i < dirs.length && i < 1000 && files.length < 20000; i++) {
      const dir = dirs[i]!
      const entries = await readdir(join(cwd, dir), { withFileTypes: true }).catch(() => [])
      for (const entry of entries) {
        if (
          entry.name.startsWith('.') ||
          ['node_modules', 'dist', 'build', 'target'].includes(entry.name)
        )
          continue
        const path = join(dir, entry.name)
        if (entry.isDirectory()) dirs.push(path)
        else if (entry.isFile()) files.push(path)
      }
    }
    return byName(files, name => name)
  }
}

function candidates(
  line: string,
  cursor: number,
  tasks: Snapshot['tasks'],
  files?: string[],
  view?: Snapshot,
  library?: CapabilitySnapshot
): Suggestions | undefined {
  const before = line.slice(0, cursor)
  if (/^\/[\w-]*$/.test(before) && cursor === line.length) {
    const q = before.slice(1).toLowerCase()
    const list = commands(!!q)
    const exact = list.find((c) => c.name === before)
    const matches = exact
      ? [exact]
      : list
          .filter((c) => c.name.includes(q) || c.description.toLowerCase().includes(q))

    return {
      kind: 'commands',
      title: 'Commands',
      start: 0,
      end: cursor,
      empty: 'No matching commands',
      items: matches.map((c) => ({
        label: c.name,
        detail: c.description,
        value: c.name + (c.usage ? ' ' : ''),
        submit: !c.usage
      }))
    }
  }
  if (
    before.startsWith('/tools ') &&
    cursor === line.length &&
    !before.startsWith('/tools --inspect ')
  ) {
    const words = before.slice(7).trim().toLowerCase().split(/\s+/u)
    const matches = (library?.items ?? [])
      .filter((item) => {
        const haystack = [item.name, item.sourceGroup, item.source, item.kind, item.description]
          .join(' ')
          .toLowerCase()
        return words.every((w) => haystack.includes(w))
      })

    return {
      kind: 'capabilities',
      title: 'Capabilities',
      start: 0,
      end: cursor,
      empty:
        library?.warnings[0] ??
        (library
          ? 'No matching capabilities'
          : 'Loading workspace capabilities…'),
      items: matches.map((item) => ({
        label: item.name,
        detail: (item.sourceGroup ?? item.source) + ' · ' + item.kind,
        value: '/tools --inspect ' + encodeURIComponent(item.id),
        submit: true
      }))
    }
  }
  const choose = /^\/choose\s+([^\n]*)$/.exec(before)
  if (choose && view && cursor === line.length) {
    const pending = pendingDecisions(view),
      query = choose[1]!.toLowerCase()
    const items = pending
      .flatMap((message) =>
        message.decision!.options.map((option, index) => ({
          label: option.label,
          detail: pending.length > 1 ? message.decision!.question : (option.detail ?? ''),
          value: '/choose ' + message.id + ' ' + (index + 1),
          submit: true
        }))
      )
      .filter((option) => (option.label + ' ' + option.detail).toLowerCase().includes(query))
    return {
      title:
        pending.length === 1
          ? pending[0]!.decision!.question
          : 'Open questions',
      items,
      start: 0,
      end: cursor,
      empty: 'No matching choices'
    }
  }
  const approval = /^\/(approve|decline|answer)\s+(\S+)\s+(\S*)$/.exec(before)
  if (approval && view && cursor === line.length) {
    const items = view.approvals
      .filter(
        (a) =>
          a.ticketId === approval[2] &&
          isApprovalPending(a) &&
          (approval[1] === 'answer') === (a.method === 'item/tool/requestUserInput')
      )
      .map((a) => ({
        label: a.facts.command ?? a.questions[0]?.question ?? a.facts.tool ?? a.method,
        detail: a.facts.cwd ?? a.workerId,
        value:
          '/' + approval[1] + ' ' + a.ticketId + ' ' + a.id + (approval[1] === 'answer' ? ' ' : '')
      }))
      .filter((a) => (a.label + ' ' + a.value).toLowerCase().includes(approval[3]!.toLowerCase()))
    return {
      title: 'Pending requests',
      items,
      start: 0,
      end: cursor,
      empty: 'No matching pending requests'
    }
  }
  const match = /^\/(diff|approvals|stop|approve|decline|answer)\s+(\S*)$/.exec(before)
  if (match && cursor === line.length) {
    const name = match[1]!,
      q = match[2]!.toLowerCase(),
      needsId = ['approve', 'decline', 'answer'].includes(name)
    const showRequests = needsId || name === 'approvals'
    const candidates = new Map<
      string,
      { id: string; title: string; workerId: string; state: string }
    >(tasks.map((task) => [task.id, task]))
    if (showRequests && view) {
      for (const a of view.approvals) {
        if (!isApprovalPending(a) || candidates.has(a.ticketId)) continue
        if (needsId && (name === 'answer') !== (a.method === 'item/tool/requestUserInput')) continue
        candidates.set(a.ticketId, {
          id: a.ticketId,
          title: a.facts.tool ?? a.method,
          workerId: a.workerId,
          state: 'pending'
        })
      }
    }
    const items = [...candidates.values()]
      .filter((t) => [t.id, t.title, t.workerId, t.state].join(' ').toLowerCase().includes(q))
      .map((t) => ({
        label: t.title || t.id,
        detail: t.workerId + ' · ' + t.state,
        value: '/' + name + ' ' + t.id + (needsId ? ' ' : ''),
        submit: !needsId && name !== 'stop'
      }))
    return {
      title: showRequests
        ? 'Tasks and requests'
        : 'Worker tasks',
      items,
      start: 0,
      end: cursor,
      empty: 'No matching tasks'
    }
  }
  const mention = /(?:^|\s)@(?:"([^"\n]*)|([^\s"@]*))$/.exec(before)
  if (!mention) return
  const term = (mention[1] ?? mention[2] ?? '').toLowerCase()
  const after = line.slice(cursor)
  const tail = mention[1] !== undefined ? /^[^"\n]*"?/.exec(after) : /^[^\s"]*/.exec(after)
  const start = before.lastIndexOf('@', cursor - term.length)
  const items: Choice[] = []
  if (files) {
    const matches = files.filter(
      (f) => !/[\x00-\x1f\x7f]/.test(f) && f.toLowerCase().includes(term)
    )
    for (const path of matches) {
      items.push({
        label: path,
        detail: '',
        value:
          '@' +
          (/[\s"\\]/.test(path) ? JSON.stringify(path) : path) +
          (after.slice(tail?.[0].length).startsWith(' ') ? '' : ' ')
      })
    }
  }
  return {
    kind: 'files',
    title: 'Project files',
    items,
    start,
    end: cursor + (tail?.[0].length ?? 0),
    empty: files
      ? 'No matching files'
      : 'Finding project files…'
  }
}

export function suggestions(...args: Parameters<typeof candidates>): Suggestions | undefined {
  const result = candidates(...args)
  if (result) result.items = byName(result.items, item => item.label)
  return result
}
