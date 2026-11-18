import type {MemoryProjection} from '../../src/router-memory.ts';

type Labels = (en: string, zh: string) => string;
export type MemoryDetail = {key: string; value: string};

/** Compact display of authorized metadata; never grants authority or claims truth. */
export function memoryProvenance(fact: MemoryProjection, L: Labels): MemoryDetail[] {
  const origins: Record<string, string> = {
    explicit: L('Explicitly requested', '明确要求记住'),
    manual: L('Saved by hand', '手动保存'),
    extracted: L('From conversation', '来自会话'),
    consolidated: L('Combined memories', '整理自已有记忆'),
    experience: L('Recorded experience', '经验记录'),
  };
  const origin = fact.learning?.inferred ? L('Inferred memory', '推断记忆') : origins[fact.origin ?? ''];
  const details: MemoryDetail[] = origin ? [{key:'origin',value:origin}] : [];
  if (fact.expiresAt !== undefined) {
    const instant = new Date(fact.expiresAt);
    const date = Number.isFinite(fact.expiresAt) && !Number.isNaN(instant.getTime())
      ? instant.toISOString().replace('T',' ').replace(/\.000Z$/,'Z').replace('Z',' UTC') : null;
    details.push({key:'expiry',value:date ? L('Expires '+date,'有效期至 '+date) : L('Expiry unavailable','有效期未知')});
  }
  return details;
}
