const dark = { bg: '#0b0b0b', panel: '#1c1c1c', selected: '#333333', fg: '#e3e3e3', muted: '#939393', accent: '#a795ff', warm: '#e2ae76' }
const light = { bg: '#fafafa', panel: '#eeeeee', selected: '#dadada', fg: '#252525', muted: '#656565', accent: '#6553be', warm: '#946322' }

export const presets = ['black-blue','black-red','mono','white-blue','white-red'] as const
export const themeNames = [...presets,'system','dark','light'] as const
export type ThemeName = typeof themeNames[number]
export function paletteFor(theme: ThemeName = 'system', systemLight = false) {
  if (theme === 'system') return systemLight ? light : dark
  if (theme === 'dark' || theme === 'light') return theme === 'dark' ? dark : light
  if (theme === 'mono') return { ...dark, accent: dark.fg, warm: dark.fg }
  const base = theme.startsWith('white') ? light : dark
  const accent = { 'black-blue':'#85baff', 'black-red':'#ff969b', 'white-blue':'#1757ac', 'white-red':'#a32236' }[theme]
  return { ...base, accent, warm: accent }
}
export function themeSample(theme: ThemeName) {
  const p = paletteFor(theme)
  const rgb = (hex:string) => hex.slice(1).match(/../g)!.map(pair=>parseInt(pair,16)).join(';')
  return '\x1b[48;2;' + rgb(p.bg) + ';38;2;' + rgb(p.fg) + 'm Router  ' +
    '\x1b[38;2;' + rgb(p.accent) + 'mconst ready' + '\x1b[38;2;' + rgb(p.fg) + 'm = true  \x1b[0m'
}
