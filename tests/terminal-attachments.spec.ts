import { afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync, openSync, ftruncateSync, closeSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir, homedir } from 'node:os'
import { attachmentPath, readAttachment } from '../src/terminal/attachments.ts'
import { TerminalClient } from '../src/terminal/client.ts'

const directories: string[] = []
const directory = () => { const path = mkdtempSync(join(tmpdir(), 'roppo-attachments-')); directories.push(path); return path }
afterEach(() => { for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true }) })

it('accepts quoted and escaped local paths and rejects folders and oversized files', async () => {
  const dir = directory(), file = join(dir, '旅行 notes.txt')
  writeFileSync(file, 'travel notes')
  for (const input of ['"旅行 notes.txt"', "'旅行 notes.txt'", '旅行\\ notes.txt']) {
    expect(attachmentPath(input, dir)).toBe(file)
    expect(await readAttachment(attachmentPath(input, dir))).toMatchObject({ name: '旅行 notes.txt', bytes: 12 })
  }
  expect(attachmentPath('~/Desktop/photo.png', dir)).toBe(join(homedir(), 'Desktop/photo.png'))
  await expect(readAttachment(dir)).rejects.toThrow('Choose a file')
  const big = join(dir, 'large.bin'), fd = openSync(big, 'w')
  ftruncateSync(fd, 100 * 1024 * 1024 + 1); closeSync(fd)
  await expect(readAttachment(big)).rejects.toThrow('100 MiB')
})

it('uploads binary attachments once and submits an attachment-only message with their IDs', async () => {
  const file = join(directory(), 'photo.png'), bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  writeFileSync(file, bytes)
  const client = new TerminalClient('http://127.0.0.1:4319')
  const request = vi.spyOn(client, 'request').mockResolvedValue({ runId: 'attached-run' })
  expect(await client.send('chat', '', [file, file], 'en')).toEqual({ runId: 'attached-run' })
  expect(request).toHaveBeenCalledTimes(2)
  const upload = request.mock.calls[0]!, message = request.mock.calls[1]!
  expect(upload[0]).toMatch(/^\/api\/chat\/conversations\/chat\/attachments\/.+\?name=photo.png$/)
  expect(upload[2]?.binary).toEqual(bytes)
  const id = upload[0].split('/').at(-1)!.split('?')[0]
  expect(message[0]).toBe('/api/chat/conversations/chat/messages')
  expect(message[1]).toMatchObject({ text: '', attachments: [id], locale: 'en' })
})
