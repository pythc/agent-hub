#!/usr/bin/env node
import { copyFile, mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

if (process.platform !== 'darwin') {
  console.error('This profile is for macOS Terminal. Other terminals can use assets/terminal/RoppoMono-Regular.ttf directly.')
  process.exitCode = 1
} else {
  const fontDirectory = join(homedir(), 'Library', 'Fonts')
  const profileDirectory = join(homedir(), '.roppo', 'terminal')
  await mkdir(fontDirectory, { recursive: true })
  await mkdir(profileDirectory, { recursive: true })
  await copyFile(new URL('../assets/terminal/RoppoMono-Regular.ttf', import.meta.url), join(fontDirectory, 'RoppoMono-Regular.ttf'))
  await copyFile(new URL('../assets/terminal/Roppo.terminal', import.meta.url), join(profileDirectory, 'Roppo.terminal'))
  console.log('Installed Roppo Mono and the separate Roppo Terminal profile.')
  console.log('Open the profile, then run roppo in its window:')
  console.log('  open ~/.roppo/terminal/Roppo.terminal')
}
