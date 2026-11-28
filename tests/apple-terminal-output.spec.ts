import { Writable } from 'node:stream'
import { once } from 'node:events'
import { expect, test } from 'vitest'
import { AppleTerminalOutput } from '../src/terminal/apple-terminal-output.ts'

test('Apple Terminal output removes unsupported probes without altering text or supported controls', async () => {
  const visible = '\x1b[?1049h\x1b[38;5;123m中文 👋\x1b[0m\x1b]11;?\x07\x1b[?1006h\x1b[?1049l'
  const probes = '\x1bP+q4d73\x1b\\\x1b_Gi=31337,s=1,v=1,a=q,t=d,f=24;AAAA\x1b\\' +
    '\x1b[?1016$p\x1b[?2026$p\x1b[?u\x1b[>0q\x1b]66;w=1; \x1b\\'
  const bytes = Buffer.from(probes + visible)
  // Native output can split an escape sequence or UTF-8 character at any byte.
  for (const chunkSize of [1, 7, bytes.length]) {
    let output = ''
    const sink = new Writable({ write(chunk, _encoding, done) { output += chunk.toString(); done() } })
    const filtered = new AppleTerminalOutput(sink as NodeJS.WriteStream)
    for (let offset = 0; offset < bytes.length; offset += chunkSize) filtered.write(bytes.subarray(offset, offset + chunkSize))
    filtered.end()
    await once(filtered, 'finish')
    expect(output).toBe(visible)
  }
})

test('growing Apple Terminal restores the measured shell cursor, not its shifted save slot', async () => {
  let output = ''
  const sink = Object.assign(new Writable({ write(chunk, _encoding, done) { output += chunk.toString(); done() } }),
    { rows: 30, columns: 120 })
  const filtered = new AppleTerminalOutput(sink as NodeJS.WriteStream)
  // Captured from Terminal.app 470.2: shell CPR 6;1, then width-probe CPRs 2;1.
  filtered.rememberCursor(Buffer.from('\x1b[6;'))
  filtered.rememberCursor(Buffer.from('1R\x1b[2;1R\x1b[2;1R'))
  filtered.write('\x1b[?1049h')
  sink.rows = 60; sink.columns = 207
  filtered.end('\x1b[?1049l')
  await once(filtered, 'finish')
  expect(output).toBe('\x1b[H\x1b[24L\x1b[30;1H\x1b[?1049h\x1b[?1049l\x1b[H\x1b[24M\x1b[6;1H')
})

test.each([[6, 6], [55, 30]])('shrinking restores shell row %i to visible row %i', async (originalRow, row) => {
  let output = ''
  const sink = Object.assign(new Writable({ write(chunk, _encoding, done) { output += chunk.toString(); done() } }),
    { rows: 60, columns: 207 })
  const filtered = new AppleTerminalOutput(sink as NodeJS.WriteStream)
  filtered.rememberCursor(Buffer.from(`\x1b[${originalRow};1R`))
  sink.rows = 30; sink.columns = 120
  filtered.end('\x1b[?1049l')
  await once(filtered, 'finish')
  expect(output).toBe(`\x1b[?1049l\x1b[${row};1H`)
})
