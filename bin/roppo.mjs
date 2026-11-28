#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
const args = process.argv.slice(2)
const interactive = process.stdin.isTTY && process.stdout.isTTY && process.env.TERM !== 'dumb' &&
  process.env.ROPPO_LEGACY_TUI !== '1' && !args.some(arg => ['-p', '--print', '--json', '--output-format', '-h', '--help', '-V', '--version', 'login', 'logout', 'lang'].includes(arg))
if (interactive && !process.versions.bun) {
  const require = createRequire(import.meta.url)
  const bun = require.resolve('bun/bin/bun.exe')
  const child = spawn(bun, [fileURLToPath(import.meta.url), ...args], { stdio: 'inherit', env: { ...process.env, ROPPO_NODE: process.execPath } })
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => child.kill(signal))
  child.on('error', error => { console.error('Could not start Roppo terminal: ' + error.message); process.exitCode = 1 })
  child.on('exit', (code, signal) => { process.exitCode = code ?? (signal ? 130 : 1) })
} else {
  if (!process.versions.bun) {
    const { register } = await import('tsx/esm/api')
    register()
  }
  const { main } = await import('../src/terminal/main.ts')
  process.exitCode = await main(args)
}
