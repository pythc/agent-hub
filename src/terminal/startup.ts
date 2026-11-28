import { RGBA, type OptimizedBuffer } from '@opentui/core'
import { companionBody, brailleCells, companionWidth, companionRows, companionSourceWidth, scaleCompanion, paintCompanionEyes } from './companion.ts'

export const tideDuration = 2000
export const greetingDuration = 1400
export const startupDuration = tideDuration + greetingDuration
const smooth = (t: number) => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t) }

/** The same small R silhouette, walking across the curtain or peeking into its top slot. */
export function entryPixels(time: number, greeting: boolean) {
  const pixels = Array.from({ length: 12 }, () => Array<number>(companionSourceWidth * 2).fill(0))
  const p = Math.min(1, time / greetingDuration)
  const rise = greeting ? Math.round((1 - smooth(p / .42)) * 11) : -Math.round(Math.abs(Math.sin(time / 100)))
  const dot = (x: number, y: number, value = 1) => { if (pixels[y]?.[x] !== undefined) pixels[y]![x] = value }
  companionBody.forEach((row, y) => Array.from(row).forEach((value, x) => {
    if (value === '#') dot(10 + x + (!greeting && y >= 9 ? Math.round(Math.sin(time / 90 + (x < 6 ? 0 : Math.PI))) : 0), y + rise)
  }))
  if (greeting && p > .62 && p < .92) {
    const hand = 3 + Math.round(Math.sin(time / 42))
    dot(21, hand); dot(22, hand + 1)
  }
  const scaled = scaleCompanion(pixels)
  paintCompanionEyes(scaled, 16.5, 4 + rise, greeting && p > .48 && p < .58)
  return scaled
}

/** Paint only the unrevealed cells and the wavefront; the conversation remains live underneath. */
export function paintStartupTide(buffer: OptimizedBuffer, width: number, height: number, time: number,
  palette: { bg: string; fg: string; muted: string }) {
  const p = Math.min(1, time / tideDuration), front = -14 + (width + 30) * p
  const bg = RGBA.fromHex(palette.bg), fg = RGBA.fromHex(palette.fg), muted = RGBA.fromHex(palette.muted)
  for (let y = 0; y < height; y++) {
    const edge = Math.round(front + 3 * Math.sin(y * .4 - p * 7) + Math.sin(y * .95 + p * 9))
    if (edge < width) buffer.fillRect(Math.max(0, edge), y, width - Math.max(0, edge), 1, bg)
    for (let x = Math.max(0, edge - 8); x < Math.min(width, edge + 6); x++) {
      const density = x < edge ? (x - edge + 8) / 8 : (edge + 6 - x) / 6
      let mask = 0
      for (let bit = 0; bit < 8; bit++) if ((x * 17 + y * 31 + bit * 23) % 97 / 97 < density * .65) mask |= 1 << bit
      if (mask) buffer.drawText(String.fromCodePoint(0x2800 + mask), x, y, muted, bg)
    }
  }
  const left = Math.round(front) - 4, top = Math.floor((height - companionRows) / 2)
  buffer.fillRect(left + Math.floor(companionWidth / 2) - 4, top, 8, companionRows, bg)
  brailleCells(entryPixels(time, false)).forEach((row, y) => row.forEach((cell, x) => {
    if (cell.text !== ' ' && left + x >= 0 && left + x < width && top + y >= 0 && top + y < height)
      buffer.drawText(cell.text, left + x, top + y, fg, bg)
  }))
}
