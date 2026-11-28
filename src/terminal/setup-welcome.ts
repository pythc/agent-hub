import { brailleCells, drawCompanion } from './companion.ts'
import { themeNames, themeSample } from './themes.ts'
import type { TerminalSettings } from './settings.ts'
import type { SetupUI } from './setup.ts'
import { clean } from './client.ts'

// Keep readline's native editing and password handling inside one replaceable page.
export async function withSetupPages<T>(base: SetupUI, prefs: TerminalSettings, run: (ui: SetupUI) => Promise<T>) {
  const out = process.stderr
  if (!out.isTTY || process.env.TERM === 'dumb') return run(base)
  const started = Date.now()
  let pending: string[] = [], active = false
  const scene = () => {
    if (out.rows < 12) return []
    return welcomeScene(prefs.motion === 'reduced' ? 1800 : Date.now()-started,
      Math.max(1,Math.min(72,out.columns-1)),prefs.animation !== false)
  }
  function page(notes: string[]) {
    active = true
    out.write('\x1b[2J\x1b[Hroppo / setup\r\n'+[...scene(),'',...notes.map(clean)].join('\r\n')+'\r\n')
  }
  function next() { page(pending); pending=[] }
  const dialog: SetupUI = {
    note(message) { pending.push(message); page(pending) },
    async text(message,options) { next(); const value=await base.text(message,options);page([]);return value },
    async choose(message,options,preview) { next();const value=await base.choose(message,options,preview);page([]);return value }
  }
  out.write('\x1b[?1049h')
  page([])
  const timer=setInterval(()=>{
    if (active && prefs.motion !== 'reduced' && out.rows >= 12)
      out.write('\x1b7\x1b[2;1H'+scene().join('\r\n')+'\x1b8')
  },180)
  try { return await run(dialog) }
  finally {active=false;clearInterval(timer);out.write('\x1b[?1049l')}
}

export function welcomeScene(time: number, width: number, companion: boolean) {
  const rows = brailleCells(drawCompanion('idle', time, time < 1180)).map(row =>
    Array.from((companion ? row.map(cell => cell.text).join('') : '').padEnd(width).slice(0,width))
  )
  const sky = Math.floor(time / 650)
  for (const [x, y] of [[23, 1], [32, 0], [44, 2], [54, 1]] as const) {
    if (x < width) rows[y]![x] = (sky + x) % 4 === 0 ? '✦' : '·'
  }
  return [...rows.map(row => row.join('')), '╌'.repeat(width)]
}

export async function chooseSetupTheme(dialog: SetupUI, prefs: TerminalSettings) {
  if (process.versions.bun && process.stdout.isTTY && process.env.TERM !== 'dumb') {
    const { chooseAppearance } = await import('./setup-appearance.ts')
    return chooseAppearance(prefs)
  }
  const names = [...themeNames].sort()
  const index = await dialog.choose('Choose your terminal theme', names, i => themeSample(names[i]!))
  return {theme: names[index]!, animation: prefs.animation !== false, motion: prefs.motion ?? 'full'}
}
