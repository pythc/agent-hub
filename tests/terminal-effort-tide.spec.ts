import { expect, it } from 'vitest'
import { effortTideColors, effortTideFrame } from '../src/terminal/effort-tide.ts'

it('sweeps a multi-row pixel curtain over the entire track, including beyond the selected level', () => {
  const visited = new Set<number>(), rows = new Set<number>()
  for (let time = 0; time < 2700; time += 50) {
    const frame = effortTideFrame(74, 5, 5, 0, time, true)
    expect(frame[2]![0]!.text).toBe('●')
    frame.forEach((row, y) => row.forEach((cell, x) => {
      if (/[░▒▓]/.test(cell.text)) { visited.add(x); rows.add(y) }
    }))
  }
  expect(visited.size).toBe(74)
  expect(rows.size).toBe(5)
  const rest = effortTideFrame(74, 5, 5, 3, 3000, true)
  expect(rest).toEqual(effortTideFrame(74, 5, 5, 3, 900, false))
  expect(rest[2]!.filter(cell => cell.text === '●')).toHaveLength(1)
})

it('keeps level colors stable across model capability lists and supports monochrome', () => {
  const levels = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']
  for (const theme of ['dark', 'light'] as const) {
    expect(new Set(levels.map(level => effortTideColors(level, theme)[0])).size).toBe(levels.length)
  }
  expect(effortTideColors('xhigh', 'dark')[0]).toBe('#d0b0ff')
  expect(effortTideColors('low', 'mono')).toEqual(effortTideColors('max', 'mono'))
})
