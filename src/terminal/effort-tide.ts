const colors: Record<string, [string, string]> = {
  none: ['#83939e', '#c4d0d8'], minimal: ['#589b89', '#ace3cf'],
  low: ['#169b6e', '#95f3c9'], medium: ['#079bb5', '#8cecff'],
  high: ['#487ff0', '#aecaff'], xhigh: ['#9966e8', '#d0b0ff'],
  max: ['#cb851c', '#ffd38c'], ultra: ['#d86a86', '#ffb6cc']
}

export function effortTideColors(level: string, theme: 'light' | 'dark' | 'mono') {
  const base = theme === 'mono' ? '#e3e3e3' : (colors[level] ?? colors.medium!)[theme === 'light' ? 0 : 1]
  const target = theme === 'light' ? '#fff4d9' : '#ffffff'
  return Array.from({ length: 8 }, (_, step) => {
    const mix = step / 7 * .58
    return '#' + [1, 3, 5].map(offset => {
      const from = parseInt(base.slice(offset, offset + 2), 16)
      const to = parseInt(target.slice(offset, offset + 2), 16)
      return Math.round(from + (to - from) * mix).toString(16).padStart(2, '0')
    }).join('')
  })
}

/** Five character rows form one horizontal curtain; the sweep spans the whole track. */
export function effortTideFrame(columns: number, rows: number, count: number, index: number, elapsed: number, animated: boolean) {
  const knob = Math.round(index / Math.max(1, count - 1) * (columns - 1))
  const stops = new Set(Array.from({ length: count }, (_, i) => Math.round(i / Math.max(1, count - 1) * (columns - 1))))
  const middle = Math.floor(rows / 2)
  const phase = elapsed % 3500 / 2700
  const band = columns * .32
  const front = -5 + phase * (columns + band + 10)
  const offsets = [-1, 1, 0, 2, -2]
  return Array.from({ length: rows }, (_, y) => Array.from({ length: columns }, (_, x) => {
    const depth = front + offsets[y]! - x
    const grain = (x * 17 + y * 31) % 29 / 29
    const density = animated && phase < 1 && depth >= 0 && depth < band ? Math.min(1, depth / 3) * (1 - depth / band) : 0
    let text = y === middle ? (x === knob ? '●' : stops.has(x) ? '·' : x < knob ? '━' : '─') : ' '
    let tone = x <= knob ? 0 : -1
    if (density > .07 && grain < Math.min(1, density * 1.65)) {
      text = density > .64 ? '▓' : density > .4 ? '▒' : density > .2 ? '░' : '·'
      tone = Math.round(density * 7)
    }
    if (y === middle && x === knob) { text = '●'; tone = 0 }
    return { text, tone }
  }))
}
