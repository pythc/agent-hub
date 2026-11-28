const names = new Intl.Collator('en', { sensitivity: 'base', numeric: true, ignorePunctuation: true })

/** Shared A–Z ordering for commands, settings and named resources. */
export function byName<T>(items: readonly T[], name: (item: T) => string): T[] {
  return [...items].sort((a, b) => names.compare(name(a), name(b)))
}
