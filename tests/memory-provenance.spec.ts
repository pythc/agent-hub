import {describe, expect, it} from 'vitest';
import type {MemoryProjection} from '../src/router-memory.ts';
import {memoryProvenance,memoryCategory,memoryCategoryLabel,memoryDetails} from '../web/chat/memory-provenance.ts';
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

describe('memory layers and optional detail',()=>{
 it('never guesses project decisions from words or task kind',()=>{
  expect(memoryCategory(make({kind:'task',content:'User approved shipment'}))).toBe('fact');
  expect(memoryCategory(make({category:'project_decision'}))).toBe('project_decision');
  expect(memoryCategory(make({kind:'preference'}))).toBe('preference');
  expect(memoryCategory(make({origin:'experience'}))).toBe('method');
  expect(memoryCategoryLabel('method',(_en,zh)=>zh)).toBe('方法');
 });
 it('shows saved time and audience without exposing scope identifiers',()=>{
  const rows=memoryDetails(make({visibility:'task',scopeId:'private-scope',ticketId:'private-ticket'}),L);
  expect(rows).toEqual([{key:'saved',value:'Saved 1970-01-01 00:00:00 UTC'},{key:'scope',value:'This task only'}]);
  expect(JSON.stringify(rows)).not.toContain('private-');
  expect(memoryDetails(make({createdAt:NaN}),L)[0]?.value).toBe('Save time unavailable');
 });
 it('uses an explicit newer task record, not the remembered status',()=>{
  const rows=memoryDetails(make({content:'Task is ongoing',taskRecord:{state:'completed',updatedAt:'2026-11-17T06:00:00Z',newerThanMemory:true}}),L);
  expect(rows).toContainEqual({key:'task',value:'Current task record: Completed'});
  expect(rows.some(row=>row.key==='task-newer')).toBe(true);
  expect(memoryDetails(make({kind:'task',content:'Task is completed'}),L).some(row=>row.key==='task')).toBe(false);
 });
});
