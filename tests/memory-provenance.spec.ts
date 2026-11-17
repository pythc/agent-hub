import {describe, expect, it} from 'vitest';
import type {MemoryProjection} from '../src/router-memory.ts';
import {memoryProvenance} from '../web/chat/memory-provenance.ts';
const L = (en: string, _zh: string) => en;
const make = (extra: Partial<MemoryProjection> = {}) => ({origin:'explicit', visibility:'private', createdAt:0, freshness:{status:'verified',checkedAt:1000,capturedAt:0,sourceVersions:[]}, ...extra}) as MemoryProjection;
const values = (fact:MemoryProjection) => Object.fromEntries(memoryProvenance(fact,L).map(d=>[d.key,d.value]));
describe('compact authorized memory provenance',()=>{
 it('only shows the origin when there is no expiry',()=>{
  expect(memoryProvenance(make(),L)).toEqual([{key:'origin',value:'Explicitly requested'}]);
 });
 it('shows inference once instead of a technical explanation',()=>{
  expect(memoryProvenance(make({origin:'extracted',learning:{inferred:true,condition:'reports'}}),L)).toEqual([{key:'origin',value:'Inferred memory'}]);
 });
 it.each(['extracted','consolidated','experience'] as const)('does not label %s as an explicit instruction',origin=>{
  expect(values(make({origin})).origin).not.toContain('Explicitly requested');
 });
 it('preserves expiry as an absolute timestamp without declaring it active',()=>{
  expect(values(make({expiresAt:1000})).expiry).toBe('Expires 1970-01-01 00:00:01 UTC');
 });
 it('marks malformed expiry unknown rather than inventing lifetime validity',()=>{
  for(const expiresAt of [NaN,Infinity,1e20])expect(values(make({expiresAt})).expiry).toBe('Expiry unavailable');
 });
 it('does not add empty metadata or repeat source status explanations',()=>{
  expect(memoryProvenance(make({origin:undefined}),L)).toEqual([]);
 });
 it('does not expose source identifiers, quotes, actor identities, or task IDs',()=>{
  const fact=make({owner:'private-owner',ticketId:'private-task',sources:[{id:'private-source',version:1}],learning:{inferred:true,condition:'test',quote:'private-quote'}});
  const text=JSON.stringify(memoryProvenance(fact,L));
  for(const secret of ['private-owner','private-task','private-source','private-quote'])expect(text).not.toContain(secret);
 });
 it('localizes concise labels into Chinese',()=>{
  expect(memoryProvenance(make({learning:{inferred:true,condition:''},expiresAt:1000}),(_en,zh)=>zh)).toEqual([{key:'origin',value:'推断记忆'},{key:'expiry',value:'有效期至 1970-01-01 00:00:01 UTC'}]);
 });
});
