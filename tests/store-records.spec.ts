import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { Store } from '../src/store.ts'

it('keeps record filters and observer rollback when reusing statements', () => {
  const dir = mkdtempSync(join(tmpdir(), 'store-records-'))
  const store = new Store(join(dir, 'state.sqlite'))
  try {
    const observed: unknown[] = []
    store.bodyFilter = (kind, _id, value) =>
      kind === 'observed' ? { ...value, filtered: true } : value
    store.recordObservers.set('observed', (id, current, previous) => {
      observed.push([id, current, previous])
      if (current.fail) throw Error('observer rejected record')
    })
    store.put('observed', 'one', { value: 1 })
    expect(() => store.put('observed', 'one', { value: 2, fail: true })).toThrow('observer rejected record')
    expect(store.get('observed', 'one')).toEqual({ value: 1, filtered: true })
    store.put('observed', 'one', { value: 3 })
    expect(observed.at(-1)).toEqual(['one', { value: 3, filtered: true }, { value: 1, filtered: true }])
    expect(store.get('observed', 'missing')).toBeUndefined()
  } finally {
    store.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

it('keeps records isolated across databases, savepoints, and reopen', () => {
  const dir = mkdtempSync(join(tmpdir(), 'store-records-'))
  const path = join(dir, 'one.sqlite')
  const second = new Store(join(dir, 'two.sqlite'))
  let first = new Store(path)
  try {
    first.atomic(() => {
      first.put('batch', 'cursor', 1)
      second.put('batch', 'cursor', 9)
      expect(() => first.atomic(() => {
        first.put('batch', 'cursor', 2)
        throw Error('abort inner')
      })).toThrow('abort inner')
      expect(first.get('batch', 'cursor')).toBe(1)
      first.put('batch', 'next', 3)
    })
    first.close()
    first = new Store(path)
    expect(first.get('batch', 'cursor')).toBe(1)
    expect(first.get('batch', 'next')).toBe(3)
    expect(second.get('batch', 'cursor')).toBe(9)
    expect(second.get('batch', 'next')).toBeUndefined()
  } finally {
    first.close()
    second.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
